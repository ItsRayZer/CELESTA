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

// Per-IP rate limit: 600 requests per 10 minutes (raised from 60: the
// ticket poll shares this bucket venue-wide with counter QR scans, and 60
// 429s the counters in the rush — see V2-M1. Brute-force math still holds
// at 600/10 min, ~27,000 years per IP against the 31^8 id space). Each
// fetch costs 2 Redis commands; the private max-age=60 cache header below
// is what keeps the poll affordable — do NOT remove it.
const TICKET_RL_LIMIT = 600;
const TICKET_RL_WINDOW = 600;

function parseFee(fee) {
  var m = String(fee || '').match(/(\d[\d,]*)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

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
    // Member names only (V3-m03): member phone/email are not needed on
    // the public-by-id ticket and must not leak through it.
    members: Array.isArray(rec.members) ? rec.members.map(function(m){ return typeof m === 'string' ? m : (m && m.name ? String(m.name) : ''); }).filter(Boolean) : [],
    phone: rec.phone,
    fee,
    feeAmount: parseFee(fee),
    // Invalid (void) registrations are never a paid ticket (#3): force
    // paid off and flag invalid, so the ticket page renders VOID instead
    // of a valid receipt for a cancelled registration.
    invalid: !!rec.invalid,
    paid: !!rec.paid && !rec.invalid,
    // Payment receipt fields (only meaningful when paid). Same ticket the
    // owner already sees via the unguessable id, so no new exposure.
    amount: rec.amount || 0,
    paidMethod: rec.paidMethod || '',
    paidAt: rec.paidAt || '',
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
  // Validate the id BEFORE the rate-limit INCR (V3-m10): malformed/empty
  // ids must not burn the shared venue-IP bucket (3-4 commands each).
  const id = String(req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'Missing ticket id' });
  }
  // --- Single ticket by id (unchanged behaviour). ---
  // Accepts both the old reg_xxx ids (existing tickets keep working) and
  // the new SPK-XXXXXXXX ids (the verify code, which IS the registration
  // id). A bare chest number (01001) is deliberately NOT accepted here —
  // it is sequential and guessable, so it must never open a ticket.
  if (!/^(reg_[A-Za-z0-9_-]{8,32}|SPK-[A-Z0-9]{8})$/.test(id)) {
    return res.status(400).json({ error: 'Invalid ticket id' });
  }
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
  } catch (e) { console.error('ticket rate limit check failed', e); /* rate limit unavailable — serve the ticket */ }
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
