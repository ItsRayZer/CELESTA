// POST /api/register — save a new registration (Upstash Redis direct)
// Validates against the events database: the event must exist, be visible,
// have registrations open, and the team size must fit its limits.
// Instant checks (no AI, no extra latency on the submit path):
//  - per-IP rate limit: 5 registrations per 10 minutes (spam flood guard)
//  - phone must be a valid Indian 10-digit mobile (after +91 / leading 0)
//  - same phone or email already registered for the same event → duplicate
//  - gibberish / junk names, schools and emails are FLAGGED, not blocked:
//    the student still registers, the admin sees a REVIEW badge.
// The AI check (Nemotron) runs separately, after the fact, and writes its
// verdict into the record's `ai` field — it never slows the form down.
import { Redis } from '@upstash/redis';
import { loadEvents } from './events.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 20 per 10 min per IP: still stops a flood from one device, but a whole
// venue on shared Wi-Fi (one public IP) can register normally. Duplicates
// are already blocked per phone+event, and junk is flagged for review.
const RL_LIMIT = 20;
const RL_WINDOW = 600;   // per 10 minutes

function clientIp(req) {
  const h = (req && req.headers) || {};
  return String(h['x-forwarded-for'] || '').split(',')[0].trim() || String(h['x-real-ip'] || '') || 'unknown';
}

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

function validPhone(d) {
  return /^[6-9]\d{9}$/.test(d);
}

// Junk-text detector: repeated chars, no vowel, digits in a name, too short.
// Used for flagging only — a real name that trips it still registers.
function junkText(s) {
  if (s == null) return false;
  const t = String(s).trim();
  if (t.length < 3) return true;
  if (/(.)\1{3,}/.test(t)) return true;
  const low = t.toLowerCase();
  if (/(asdf|qwer|zxcv|poiuy|lkjh|1234|abcd)/.test(low)) return true;
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 4 && !/[aeiouAEIOU]/.test(letters)) return true;
  // 4+ consonants in a row inside one word (per-word, so "St. Mary's" is safe).
  if (t.split(/[^a-zA-Z]+/).some(w => /[^aeiouAEIOU]{4,}/i.test(w))) return true;
  if (/\d/.test(t)) return true;
  return false;
}

const JUNK_SCHOOLS = new Set(['test', 'abc', 'xyz', 'asdf', 'demo', 'test school', 'abc school', 'school', 'college', 'na', 'n/a', '-', '...', 'xxx']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { event, name, school, phone, email, team, teamName, members } = req.body || {};

  if (!event || !name || !school || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Rate limit first (cheap, stops floods before any other work).
  // Fail open: if Redis is down here, the main write below will fail anyway.
  try {
    const key = 'celesta:rl:' + clientIp(req);
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, RL_WINDOW);
    if (n > RL_LIMIT) return res.status(429).json({ error: 'Too many registrations from this device. Try again in a few minutes.' });
  } catch { /* rate limit unavailable — continue */ }

  // Validate the event against the database (falls back to the built-in list if storage is down).
  let ev = null;
  try {
    const events = await loadEvents();
    ev = events.find(e => e.slug === event || e.name === event) || null;
  } catch (e) {
    ev = null;
  }
  if (!ev) return res.status(400).json({ error: 'Unknown event' });
  if (!ev.visible) return res.status(403).json({ error: 'This event is no longer listed' });
  if (!ev.regOpen) return res.status(403).json({ error: 'Registrations are closed for this event' });

  const teamSize = Number(team) || 1;
  if (teamSize < ev.teamMin || teamSize > ev.teamMax) {
    return res.status(400).json({ error: 'Team size for ' + ev.name + ' must be ' + ev.teamMin + '–' + ev.teamMax });
  }

  const phoneNorm = normPhone(phone);
  if (!validPhone(phoneNorm)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  }
  const emailNorm = String(email || '').trim();

  // Duplicate: same phone or same email already registered for THIS event.
  // (Same student in a different event is fine.)
  try {
    const all = await redis.hgetall('celesta:regs');
    if (all) {
      for (const v of Object.values(all)) {
        let r = null;
        try { r = typeof v === 'object' ? v : JSON.parse(v); } catch { r = null; }
        if (!r || (r.eventSlug !== ev.slug && r.event !== ev.name)) continue;
        if (normPhone(r.phone) === phoneNorm) {
          return res.status(409).json({ error: 'This phone number is already registered for ' + ev.name });
        }
        if (emailNorm && r.email && String(r.email).trim().toLowerCase() === emailNorm.toLowerCase()) {
          return res.status(409).json({ error: 'This email is already registered for ' + ev.name });
        }
      }
    }
  } catch { /* duplicate check unavailable — continue, storage write will still run */ }

  // Soft flags for the admin (never blocks a real student).
  const reasons = [];
  if (junkText(name)) reasons.push('name looks off');
  const schoolLow = String(school).trim().toLowerCase();
  if (junkText(school) || JUNK_SCHOOLS.has(schoolLow)) reasons.push('school looks off');
  if (emailNorm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) reasons.push('email looks off');
  if (Array.isArray(members) && members.some(m => junkText(m))) reasons.push('member name looks off');
  if (teamName && junkText(teamName)) reasons.push('team name looks off');

  const id = 'reg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const record = {
    id, event: ev.name, eventSlug: ev.slug, name, school, phone: phoneNorm, email: emailNorm, team: teamSize,
    teamName: teamName || '', members: members || [],
    paid: false, amount: 0, at: new Date().toISOString(),
    risk: { level: reasons.length ? 'review' : 'ok', reasons, at: new Date().toISOString() },
    ai: null,
  };

  try {
    await redis.hset('celesta:regs', { [id]: JSON.stringify(record) });
    await redis.zadd('celesta:reglist', { score: Date.now(), member: id });
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ error: 'Storage unavailable: ' + e.message });
  }
}
