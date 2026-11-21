// GET /api/confirmation-card?id=<reg_id>[&download=1]
// Returns the SPARK-designed SVG confirmation card for a registration.
// The registration ID is a random unguessable token, so no auth is needed.
// ?download=1 serves it as an attachment (download); otherwise inline.
// (SVG, not PNG: @vercel/og broke every API function on deploy — see
// lib/confirmation.js. SVG is a real image, downloads and opens anywhere.)
import { Redis } from '@upstash/redis';
import { loadEvents } from './events.js';
import { renderCardSVG } from '../lib/confirmation.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String((req.query && req.query.id) || '').trim();
  if (!id || !/^reg_[a-z0-9]+$/i.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid registration id' });
  }
  let raw = null;
  try {
    raw = await redis.hget('celesta:regs', id);
  } catch {
    return res.status(503).json({ error: 'Storage unavailable' });
  }
  if (!raw) return res.status(404).json({ error: 'Registration not found' });
  let reg = null;
  try { reg = typeof raw === 'object' ? raw : JSON.parse(raw); } catch { reg = null; }
  if (!reg) return res.status(404).json({ error: 'Registration not found' });

  let ev = null;
  try {
    const events = await loadEvents();
    ev = events.find(e => e.slug === reg.eventSlug || e.name === reg.event) || null;
  } catch { ev = null; }
  if (!ev) ev = { name: reg.event || 'SPARK 2K26', fee: '' };

  let svg;
  try {
    svg = renderCardSVG(reg, ev);
  } catch (e) {
    return res.status(500).json({ error: 'Could not render confirmation card' });
  }
  const download = String((req.query && req.query.download) || '') === '1';
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (download) {
    res.setHeader('Content-Disposition', 'attachment; filename="spark-2k26-confirmation-' + id + '.svg"');
  } else {
    res.setHeader('Content-Disposition', 'inline; filename="spark-2k26-confirmation-' + id + '.svg"');
  }
  return res.status(200).send(svg);
}
