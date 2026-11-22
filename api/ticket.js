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

// Client IP, same rule as visits.js / register.js: Vercel sets x-real-ip;
// otherwise the LAST X-Forwarded-For entry (the first is spoofable).
function clientIp(req) {
  const h = (req && req.headers) || {};
  const real = String(h['x-real-ip'] || '').trim();
  if (real) return real;
  const parts = String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

// Per-IP rate limit: 60 requests per 10 minutes. Each fetch costs 2 Redis
// commands, so without this ~5,000 bogus fetches exhaust the daily budget.
const TICKET_RL_LIMIT = 60;
const TICKET_RL_WINDOW = 600;

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
  // Rate limit counts only requests that reach this handler (GETs here;
  // preflight / other methods return 405 above and are not counted).
  try {
    const rlKey = 'celesta:rl:ticket:' + clientIp(req);
    const n = await redis.incr(rlKey);
    if (n === 1) {
      try { await redis.expire(rlKey, TICKET_RL_WINDOW); }
      catch { try { await redis.del(rlKey); } catch {} } // never leave a key with no TTL
    }
    if (n > TICKET_RL_LIMIT) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
  } catch { /* rate limit unavailable — serve the ticket */ }
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
    // Paid status changes slowly; a private 60s cache lets My Registrations
    // (one fetch per saved id) reuse the response. Errors are never cached.
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ ok: true, ticket: toTicket(rec, fees[rec.eventSlug] || '') });
  } catch (e) {
    console.error('ticket lookup failed', e);
    return res.status(500).json({ error: 'Storage unavailable' });
  }
}
