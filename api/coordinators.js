// GET    /api/coordinators — public list (the contact page reads this; falls back to built-in list if storage is down)
// POST   /api/coordinators — add or update a coordinator (write role only). Body: { id?, name, team, event?, cls?, phone? }
// DELETE /api/coordinators?id=... — remove a coordinator (write role only).
import { Redis } from '@upstash/redis';
import { verify, parseVal } from './admin-login.js';
import { appendLog } from './activity-log.js';

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
      let list = (vals || []).map(v => parseVal(v)).filter(Boolean);
      // One-time cleanup: drop the student coordinators of the two events the
      // NEXUS leader removed (18 Nov 2026). After the first run they are gone,
      // so this never writes again.
      const REMOVED_COORDS = new Set(['sc-6', 'sc-7', 'sc-8', 'sc-9']);
      const stale = list.filter(c => REMOVED_COORDS.has(c.id));
      if (stale.length) {
        await redis.hdel('celesta:coordinators', ...stale.map(c => c.id));
        list = list.filter(c => !REMOVED_COORDS.has(c.id));
      }
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
    const id = c.id ? String(c.id).trim() : ('c' + Date.now().toString(36));
    if (!/^[A-Za-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid coordinator id' });
    const rec = {
      id,
      name: String(c.name).trim(),
      team: String(c.team).trim(),
      event: String(c.event || '').trim(),
      cls: String(c.cls || '').trim(),
      phone: String(c.phone || '').trim(),
    };
    try {
      const old = parseVal(await redis.hget('celesta:coordinators', rec.id));
      await redis.hset('celesta:coordinators', { [rec.id]: JSON.stringify(rec) });
      await appendLog({
        actor: 'write', action: old ? 'Coordinator updated' : 'Coordinator added',
        detail: rec.name + ' (' + rec.team + (rec.event ? ' · ' + rec.event : '') + ')' + (old && old.phone !== rec.phone ? ': phone ' + (old.phone || '—') + ' → ' + (rec.phone || '—') : ''),
        target: { kind: 'coordinator', id: rec.id, name: rec.name },
        undo: old ? { kind: 'coord-update', record: old } : { kind: 'coord-delete', id: rec.id },
      }, req);
      return res.status(200).json({ ok: true, coordinator: rec });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const old = parseVal(await redis.hget('celesta:coordinators', id));
      await redis.hdel('celesta:coordinators', id);
      if (old) {
        await appendLog({
          actor: 'write', action: 'Coordinator removed',
          detail: old.name + ' (' + old.team + (old.event ? ' · ' + old.event : '') + ')',
          target: { kind: 'coordinator', id, name: old.name },
          undo: { kind: 'coord-add', record: old },
        }, req);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
