// GET /api/ticket?id=reg_xxx — public read of ONE registration, for the
// standalone ticket page. No auth: the id is a random unguessable token
// (reg_ + 16 chars), so the link itself is the ticket. Only the fields the
// ticket needs are returned; nothing sensitive beyond what the ticket shows.
//
// GET /api/ticket?phone=<10-digit> — public lookup of ALL registrations for
// one phone number, for the "My Registrations" page. No auth: the phone is
// the identifier the student gave at registration (same as an order lookup
// by phone). Returns {ok:true, tickets:[...]} sorted newest first, or an
// empty list when nothing matches. The ?id= path below is unchanged.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
import { parseVal, normPhone, validPhone } from './admin-login.js';
import { loadEvents } from './events.js';

function toTicket(rec, fee) {
  return {
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
  const phoneRaw = String(req.query.phone || '').trim();
  if (!id && !phoneRaw) {
    return res.status(400).json({ error: 'Missing ticket id or phone' });
  }
  // --- Phone lookup: all registrations for one number, newest first. ---
  if (!id && phoneRaw) {
    const phone = normPhone(phoneRaw);
    if (!validPhone(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    }
    try {
      const all = await redis.hgetall('celesta:regs');
      const fees = await feeBySlug();
      const list = [];
      if (all) {
        Object.values(all).forEach(function (v) {
          const rec = parseVal(v);
          if (!rec || normPhone(rec.phone) !== phone) return;
          list.push(toTicket(rec, fees[rec.eventSlug] || ''));
        });
      }
      list.sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
      return res.status(200).json({ ok: true, tickets: list });
    } catch (e) {
      console.error('ticket phone lookup failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
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
