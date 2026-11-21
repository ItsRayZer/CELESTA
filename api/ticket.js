// GET /api/ticket?id=reg_xxx — public read of ONE registration, for the
// standalone ticket page. No auth: the id is a random unguessable token
// (reg_ + 16 chars), so the link itself is the ticket. Only the fields the
// ticket needs are returned; nothing sensitive beyond what the ticket shows.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
import { parseVal } from './admin-login.js';
import { loadEvents } from './events.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query.id || '').trim();
  if (!id || !/^reg_[A-Za-z0-9_-]{8,32}$/.test(id)) {
    return res.status(400).json({ error: 'Missing ticket id' });
  }
  try {
    const raw = await redis.hget('celesta:regs', id);
    const rec = parseVal(raw);
    if (!rec) return res.status(404).json({ error: 'Ticket not found' });
    // Fee comes from the live event record so the ticket always shows the
    // current fee, not a stale copy. loadEvents returns the array directly.
    let fee = '';
    try {
      const events = await loadEvents();
      const ev = (events || []).find(e => e.slug === rec.eventSlug);
      if (ev && ev.fee) fee = ev.fee;
    } catch {}
    return res.status(200).json({
      ok: true,
      ticket: {
        id: rec.id,
        event: rec.event,
        eventSlug: rec.eventSlug,
        name: rec.name,
        school: rec.school,
        team: rec.team,
        teamName: rec.teamName || '',
        members: Array.isArray(rec.members) ? rec.members : [],
        phone: rec.phone,
        fee,
        paid: !!rec.paid,
        at: rec.at || '',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Storage unavailable' });
  }
}
