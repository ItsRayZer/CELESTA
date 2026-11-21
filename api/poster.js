// GET  /api/poster?event=quiz — serve the custom poster image (404 = no custom poster, site falls back to the static asset)
// POST /api/poster — upload/replace a poster (write role only). Body: { event, image } where image is a data-URL webp.
// DELETE /api/poster?event=quiz — remove the custom poster, back to the static asset (write role only).
import { Redis } from '@upstash/redis';
import { verify } from './admin-login.js';
import { appendLog } from './activity-log.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const EVENTS = {
  quiz: 'Quiz',
  'treasure-hunt': 'Treasure Hunt',
  prompting: 'Prompting',
  'idea-presentation': 'Idea Presentation',
  'reels-competition': 'Reels Competition',
};

// ~650KB of image data max (base64 chars). Admin compresses client-side before upload.
const MAX_B64 = 900000;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const event = req.query.event;
    if (!EVENTS[event]) return res.status(400).json({ error: 'Unknown event' });
    try {
      const b64 = await redis.hget('celesta:posters', event);
      if (!b64) return res.status(404).json({ error: 'No custom poster' });
      const buf = Buffer.from(b64, 'base64');
      res.setHeader('Content-Type', 'image/webp');
      // Posters change rarely; browsers + CDN may cache 5 minutes. The admin
      // appends a cache-buster (?v=) after an upload/reset, so it always
      // sees the fresh poster right away.
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).send(buf);
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (verify(token) !== 'write') return res.status(403).json({ error: 'Write access required' });
  }

  if (req.method === 'POST') {
    const { event, image } = req.body || {};
    if (!EVENTS[event]) return res.status(400).json({ error: 'Unknown event' });
    // Format check: only webp/png/jpeg data-URLs, valid base64, and the right
    // magic bytes — an admin (or a stolen token) must not be able to store an
    // arbitrary blob that the site then serves as image/webp.
    const m = typeof image === 'string' ? image.match(/^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) return res.status(400).json({ error: 'Image must be a webp, png or jpeg data-URL' });
    const fmt = m[1], b64 = m[2];
    if (!b64 || b64.length > MAX_B64) {
      return res.status(400).json({ error: 'Image too large (max ~650KB after compression)' });
    }
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { return res.status(400).json({ error: 'Image is not valid base64' }); }
    const okMagic = fmt === 'webp' ? (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
      : fmt === 'png' ? (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
      : (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF);
    if (!okMagic) return res.status(400).json({ error: 'Image data does not match its declared format' });
    try {
      const prev = await redis.hget('celesta:posters', event);
      await redis.hset('celesta:posters', { [event]: b64 });
      // The previous poster goes to a Redis snapshot key, NOT into the log
      // entry: a ~900KB base64 blob in every undo entry would bloat the
      // 500-entry activity log past the free tier.
      let prevKey = null;
      if (prev) {
        prevKey = event + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        try { await redis.set('celesta:poster-prev:' + prevKey, prev, { ex: 30 * 24 * 3600 }); } catch { prevKey = null; }
      }
      await appendLog({
        actor: 'write', action: 'Poster updated',
        detail: EVENTS[event] + ' poster ' + (prev ? 'replaced (was custom)' : 'changed from the original'),
        target: { kind: 'poster', id: event, name: EVENTS[event] },
        undo: { kind: 'poster-restore', slug: event, prevKey },
      }, req);
      return res.status(200).json({ ok: true, event });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    const event = req.query.event;
    if (!EVENTS[event]) return res.status(400).json({ error: 'Unknown event' });
    try {
      const prev = await redis.hget('celesta:posters', event);
      await redis.hdel('celesta:posters', event);
      if (prev) {
        let prevKey = event + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        try { await redis.set('celesta:poster-prev:' + prevKey, prev, { ex: 30 * 24 * 3600 }); } catch { prevKey = null; }
        await appendLog({
          actor: 'write', action: 'Poster reset',
          detail: EVENTS[event] + ' poster reset to the original',
          target: { kind: 'poster', id: event, name: EVENTS[event] },
          undo: { kind: 'poster-restore', slug: event, prevKey },
        }, req);
      }
      return res.status(200).json({ ok: true, event });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
