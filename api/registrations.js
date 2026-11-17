// GET /api/registrations — list all (read/write)
// PATCH /api/registrations — update payment status (write only)
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
import { verify, parseVal } from './admin-login.js';
import { appendLog } from './activity-log.js';

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const role = verify(token);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const ids = await redis.zrange('celesta:reglist', 0, -1, { rev: true });
      if (!ids.length) return res.status(200).json({ regs: [] });
      const vals = await redis.hmget('celesta:regs', ...ids);
      const regs = Object.values(vals || {}).map(v => parseVal(v)).filter(Boolean);
      return res.status(200).json({ regs, role });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'PATCH') {
    if (role !== 'write') return res.status(403).json({ error: 'Write access required' });
    const { id, paid, amount } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const raw = await redis.hget('celesta:regs', id);
      const rec = parseVal(raw);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const before = {};
      for (const k of ['paid', 'amount', 'name', 'school', 'phone', 'email', 'teamName', 'team', 'members']) before[k] = rec[k];
      if (typeof paid === 'boolean') rec.paid = paid;
      if (typeof amount === 'number') rec.amount = amount;
      // full edit: name, school, phone, email, team size, team name, members
      for (const k of ['name', 'school', 'phone', 'email', 'teamName']) {
        if (typeof req.body[k] === 'string') rec[k] = req.body[k].trim();
      }
      if (typeof req.body.team === 'number') rec.team = req.body.team;
      if (Array.isArray(req.body.members)) rec.members = req.body.members.map(String);
      await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
      // Log only what actually changed, with the old values for undo.
      const changed = {};
      const bits = [];
      const show = (v) => Array.isArray(v) ? v.join(', ') : String(v);
      for (const k of Object.keys(before)) {
        if (JSON.stringify(before[k]) !== JSON.stringify(rec[k])) {
          changed[k] = before[k];
          bits.push(k === 'paid' ? 'paid ' + (before[k] ? 'yes' : 'no') + ' → ' + (rec[k] ? 'yes' : 'no')
            : k === 'amount' ? 'amount ₹' + (before[k] || 0) + ' → ₹' + (rec[k] || 0)
            : k + ' ' + show(before[k]) + ' → ' + show(rec[k]));
        }
      }
      if (bits.length) {
        await appendLog({
          actor: 'write', action: 'Registration updated',
          detail: rec.event + ' — ' + rec.name + ': ' + bits.join(', '),
          target: { kind: 'registration', id, name: rec.name },
          undo: { kind: 'reg-update', id, before: changed },
        }, req);
      }
      return res.status(200).json({ ok: true, reg: rec });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    if (role !== 'write') return res.status(403).json({ error: 'Write access required' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const rec = parseVal(await redis.hget('celesta:regs', id));
      await redis.hdel('celesta:regs', id);
      await redis.zrem('celesta:reglist', id);
      if (rec) {
        await appendLog({
          actor: 'write', action: 'Registration deleted',
          detail: rec.event + ' — ' + rec.name + ' (Team ' + (rec.team || '?') + ')',
          target: { kind: 'registration', id, name: rec.name },
          undo: { kind: 'reg-add', record: rec },
        }, req);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
