// GET /api/registrations — list all (read/write)
// PATCH /api/registrations — update payment status (write only)
import { kv } from '@vercel/kv';
import { verify } from './admin-login.js';

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const role = verify(token);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const ids = await kv.zrange('celesta:reglist', 0, -1, { rev: true });
      if (!ids.length) return res.status(200).json({ regs: [] });
      const vals = await kv.hmget('celesta:regs', ...ids);
      const regs = Object.values(vals || {}).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
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
      const raw = await kv.hget('celesta:regs', id);
      if (!raw) return res.status(404).json({ error: 'Not found' });
      const rec = JSON.parse(raw);
      if (typeof paid === 'boolean') rec.paid = paid;
      if (typeof amount === 'number') rec.amount = amount;
      await kv.hset('celesta:regs', { [id]: JSON.stringify(rec) });
      return res.status(200).json({ ok: true, reg: rec });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
