// GET /api/ticket?id=reg_xxx — public read of ONE registration, for the
// standalone ticket page. No auth: the id is a random unguessable token
// (reg_ + 16 chars), so the link itself is the ticket. Only the fields the
// ticket needs are returned; nothing sensitive beyond what the ticket shows.
//
// There is deliberately NO phone lookup here. A phone number is a public-ish
// identifier, so a ?phone= endpoint would let anyone with a number pull a
// student's full details. My Registrations works from the device's own saved
// ticket IDs instead; on another device the student opens their ticket link.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
import { parseVal } from './admin-login.js';
import { loadEvents } from './events.js';

function toTicket(rec, fee) {
  return {
    id: rec.id,
    chest: rec.chest || '',
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
  };
}

// Fee comes from the live event record so the ticket always shows the
// current fee, not a stale copy. loadEvents returns the array directly.
async function feeBySlug() {
  const map = {};
  try {
    const events = await loadEvents();
    (events || []).forEach(function (e) { if (e && e.slug) map[e.slug] = e.fee || ''; });
  } catch (e) { console.error('ticket fee lookup failed', e); }
  return map;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'Missing ticket id' });
  }
  // --- Single ticket by id (unchanged behaviour). ---
  if (!/^reg_[A-Za-z0-9_-]{8,32}$/.test(id)) {
    return res.status(400).json({ error: 'Missing ticket id' });
  }
  try {
    const raw = await redis.hget('celesta:regs', id);
    const rec = parseVal(raw);
    if (!rec) return res.status(404).json({ error: 'Ticket not found' });
    const fees = await feeBySlug();
    return res.status(200).json({ ok: true, ticket: toTicket(rec, fees[rec.eventSlug] || '') });
  } catch (e) {
    console.error('ticket lookup failed', e);
    return res.status(500).json({ error: 'Storage unavailable' });
  }
}
