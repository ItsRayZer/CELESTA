// GET  /api/poster?event=quiz — serve the custom poster image (404 = no custom poster, site falls back to the static asset)
// POST /api/poster — upload/replace a poster (write role only). Body: { event, image } where image is a data-URL webp.
// DELETE /api/poster?event=quiz — remove the custom poster, back to the static asset (write role only).
import { Redis } from '@upstash/redis';
import { verify } from './admin-login.js';

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
      res.setHeader('Cache-Control', 'no-store');
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
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const b64 = image.split(',')[1] || '';
    if (!b64 || b64.length > MAX_B64) {
      return res.status(400).json({ error: 'Image too large (max ~650KB after compression)' });
    }
    try {
      await redis.hset('celesta:posters', { [event]: b64 });
      return res.status(200).json({ ok: true, event });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    const event = req.query.event;
    if (!EVENTS[event]) return res.status(400).json({ error: 'Unknown event' });
    try {
      await redis.hdel('celesta:posters', event);
      return res.status(200).json({ ok: true, event });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
