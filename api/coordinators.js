// GET    /api/coordinators — public list (the contact page reads this; falls back to built-in list if storage is down)
// POST   /api/coordinators — add or update a coordinator (write role only). Body: { id?, name, team, event?, cls?, phone? }
// DELETE /api/coordinators?id=... — remove a coordinator (write role only).
import { Redis } from '@upstash/redis';
import { verify, parseVal } from './admin-login.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Seed data: the team lists RayZer shared (16 Nov 2026). Phones are empty until added from the admin.
const DEFAULTS = [
  { id: 'ev-1', name: 'Sree Lakshmi', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'ev-2', name: 'Anaswara', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'ev-3', name: 'Alfiya', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'de-1', name: 'Midhun', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-2', name: 'Ann Mariya', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-3', name: 'Aswin', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-4', name: 'Deleena', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'te-1', name: 'Aben Sojan', team: 'Technical Team', event: '', cls: '', phone: '' },
  { id: 'me-1', name: 'Alan Lal', team: 'Media Team', event: '', cls: '', phone: '' },
  { id: 'me-2', name: 'Thomas', team: 'Media Team', event: '', cls: '', phone: '' },
  { id: 'ma-1', name: 'Alphons Binoy', team: 'Marketing Team', event: '', cls: '', phone: '' },
  { id: 'ma-2', name: 'Simona Jaimon', team: 'Marketing Team', event: '', cls: '', phone: '' },
  { id: 'fi-1', name: 'Turbo', team: 'Finance Team', event: '', cls: '', phone: '' },
  { id: 'ex-1', name: 'Aby Bijo', team: 'Exhibition Team', event: '', cls: '', phone: '' },
  { id: 'og-1', name: 'Basil Shiju', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'og-2', name: 'Midhun', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'og-3', name: 'Alphons Binoy', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'sc-1', name: 'Aleena', team: 'Student Coordinators', event: 'Quiz', cls: '3rd BCA A', phone: '' },
  { id: 'sc-2', name: 'Niya', team: 'Student Coordinators', event: 'Quiz', cls: '3rd BCA B', phone: '' },
  { id: 'sc-3', name: 'Abhinavu Babu', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '3rd BCA A', phone: '' },
  { id: 'sc-4', name: 'Aadhil Kabeer', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '2nd BCA A', phone: '' },
  { id: 'sc-5', name: 'Adithya Rajagopal', team: 'Student Coordinators', event: 'Prompting', cls: '3rd BCA A', phone: '' },
  { id: 'sc-6', name: 'Vedhajith', team: 'Student Coordinators', event: 'Idea Presentation', cls: '3rd BCA B', phone: '' },
  { id: 'sc-7', name: 'Navaneeth', team: 'Student Coordinators', event: 'Idea Presentation', cls: '3rd BCA B', phone: '' },
  { id: 'sc-8', name: 'Agnivesh Santhosh', team: 'Student Coordinators', event: 'Reels Competition', cls: '3rd BCA A', phone: '' },
  { id: 'sc-9', name: 'Daniel', team: 'Student Coordinators', event: 'Reels Competition', cls: '3rd BCA A', phone: '' },
];

async function ensureSeeded() {
  const n = await redis.hlen('celesta:coordinators');
  if (n === 0) {
    const obj = {};
    DEFAULTS.forEach(c => { obj[c.id] = JSON.stringify(c); });
    await redis.hset('celesta:coordinators', obj);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      await ensureSeeded();
      const vals = await redis.hvals('celesta:coordinators');
      const list = (vals || []).map(v => parseVal(v)).filter(Boolean);
      return res.status(200).json({ coordinators: list });
    } catch (e) {
      return res.status(200).json({ coordinators: DEFAULTS });
    }
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (verify(token) !== 'write') return res.status(403).json({ error: 'Write access required' });

  if (req.method === 'POST') {
    const c = req.body || {};
    if (!c.name || !c.team) return res.status(400).json({ error: 'Name and team are required' });
    const rec = {
      id: c.id || ('c' + Date.now().toString(36)),
      name: String(c.name).trim(),
      team: String(c.team).trim(),
      event: String(c.event || '').trim(),
      cls: String(c.cls || '').trim(),
      phone: String(c.phone || '').trim(),
    };
    try {
      await redis.hset('celesta:coordinators', { [rec.id]: JSON.stringify(rec) });
      return res.status(200).json({ ok: true, coordinator: rec });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      await redis.hdel('celesta:coordinators', id);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
