// POST /api/register — save a new registration (Upstash Redis direct)
// Validates against the events database: the event must exist, be visible,
// have registrations open, and the team size must fit its limits.
// BOT CHECK (runs on every submit, no extra latency, nothing to install):
//  - honeypot: a hidden "website" field humans never see; bots fill it
//    and are rejected outright with a generic error (no reason given).
//  - timing: the form records when it was opened; a submit in under 2
//    seconds is too fast for a human and gets flagged.
//  - per-IP rate limit: 100 registrations per 10 minutes (spam flood guard)
//  - phone must be a valid Indian 10-digit mobile (after +91 / leading 0)
//  - same phone or email already registered for the same event → duplicate
//  - gibberish / junk names, schools and emails are FLAGGED, not blocked:
//    the student still registers, the admin sees a CHECK or BOT badge.
// Flagged records never block a real student — only a filled honeypot,
// a bad phone, a duplicate, or the rate limit reject a submit.
import { Redis } from '@upstash/redis';
import nodemailer from 'nodemailer';
import { loadEvents } from './events.js';
import { renderCardPNG, buildConfirmationEmail } from '../lib/confirmation.js';
import { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';
export { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 300 per 10 min per IP: the whole venue shares one public IP, and the
// 9:30-10:00 rush is ~135-150 submissions. 100 would 429 students past #100.
// Duplicates are already blocked per phone+email, and junk is flagged.
const RL_LIMIT = 300;
const RL_WINDOW = 600;   // per 10 minutes

// Client IP: trust only what the platform sets. Vercel overwrites x-real-ip
// with the connecting IP and appends it as the LAST entry of X-Forwarded-For.
// The FIRST XFF entry is client-supplied and spoofable, so never use [0].
function clientIp(req) {
  const h = (req && req.headers) || {};
  const real = String(h['x-real-ip'] || '').trim();
  if (real) return real;
  const parts = String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
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

// Bot-check level from the flag count: 0 = ok, 1-2 = review (check it),
// 3+ = suspicious (looks like a bot). Exported so it can be unit-tested.
export function riskLevelFor(reasons) {
  const n = Array.isArray(reasons) ? reasons.length : 0;
  return n >= 3 ? 'suspicious' : n ? 'review' : 'ok';
}

// Confirmation email (no OTP — just a confirmation). Sent after the record
// is saved, only when the student gave an email. Any failure here must
// NEVER fail the registration, so the caller wraps it in try/catch and the
// response still returns ok:true. Requires GMAIL_USER + GMAIL_APP_PASSWORD
// (Gmail App Password for sparkfest.mac@gmail.com) in Vercel env vars;
// when they are absent the email is skipped silently.
function mailTransport() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

async function sendConfirmationEmail(record, ev) {
  const to = String(record.email || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
  const transport = mailTransport();
  if (!transport) return false;
  const base = 'https://spark.maraugusthinosecollege.org';
  const cardUrl = base + '/api/confirmation-card?id=' + encodeURIComponent(record.id) + '&download=1';
  const png = await renderCardPNG(record, ev);
  const { subject, html, text } = buildConfirmationEmail(record, ev, cardUrl);
  const from = '"SPARK 2K26" <' + String(process.env.GMAIL_USER || 'sparkfest.mac@gmail.com').trim() + '>';
  // 8s cap so a slow SMTP handshake cannot push the function past the
  // 10s Hobby limit and turn a saved registration into a timeout.
  await Promise.race([
    transport.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments: [{ filename: 'spark-2k26-confirmation.png', content: png, contentType: 'image/png', cid: 'confirmation-card' }],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('email timeout')), 8000)),
  ]);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { event, name, school, phone, email, team, teamName, members, website, startedAt } = req.body || {};
  // Normalise at the door: trim free text so stored records carry no stray
  // spaces, and reject non-string member names (a number/boolean/object in
  // the array is a malformed client, not a name).
  if (typeof name === 'string') name = name.trim();
  if (typeof school === 'string') school = school.trim();
  if (typeof teamName === 'string') teamName = teamName.trim();
  if (Array.isArray(members) && members.some(m => typeof m !== 'string')) {
    return res.status(400).json({ error: 'Member names must be text' });
  }
  if (Array.isArray(members)) members = members.map(m => m.trim());

  // Honeypot FIRST: the "website" field is hidden from humans. A bot that
  // fills it is rejected with a generic error — no reason is ever given.
  if (website && String(website).trim()) {
    return res.status(400).json({ error: 'Registration failed. Please try again.' });
  }

  if (!event || !name || !school || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Length caps: a real name/school is never thousands of characters.
  // Without these, a bot can store a multi-KB blob per registration and
  // bloat the admin list. (Client inputs carry matching maxlengths.)
  if (String(name).length > 100 || String(school).length > 150
      || String(email || '').length > 254 || String(teamName || '').length > 80) {
    return res.status(400).json({ error: 'A field is too long — please shorten it and try again.' });
  }
  if (Array.isArray(members) && (members.length > 20 || members.some(m => String(m).length > 100))) {
    return res.status(400).json({ error: 'Member names are too long or there are too many members.' });
  }

  // Validate the event against the database (falls back to the built-in list if storage is down).
  let ev = null;
  let storageDown = false;
  try {
    const events = await loadEvents();
    ev = events.find(e => e.slug === event || e.name === event) || null;
  } catch (e) {
    storageDown = true;
  }
  // If storage itself failed, say so honestly (503) instead of misleading
  // the student with "Unknown event" for a real event.
  if (storageDown) return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again in a moment.' });
  if (!ev) return res.status(400).json({ error: 'Unknown event' });
  if (!ev.visible) return res.status(403).json({ error: 'This event is no longer listed' });
  if (!ev.regOpen) return res.status(403).json({ error: 'Registrations are closed for this event' });

  const teamSize = Number(team);
  if (!Number.isInteger(teamSize) || teamSize < ev.teamMin || teamSize > ev.teamMax) {
    return res.status(400).json({ error: 'Team size for ' + ev.name + ' must be ' + ev.teamMin + '–' + ev.teamMax });
  }
  // members are the OTHER team members (leader excluded): at most teamMax - 1.
  if (Array.isArray(members) && members.length > ev.teamMax - 1) {
    return res.status(400).json({ error: 'Too many team members for ' + ev.name });
  }
  if (teamSize > 1 && (!Array.isArray(members) || members.filter(m => String(m || '').trim()).length < teamSize - 1)) {
    return res.status(400).json({ error: 'Add the other team members for a team of ' + teamSize });
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

  // Rate limit AFTER validation: invalid requests don't burn quota, and a
  // flood of junk still gets stopped before the write. Fail open: if Redis is
  // down here, the main write below will fail anyway.
  try {
    const key = 'celesta:rl:' + clientIp(req);
    const n = await redis.incr(key);
    if (n === 1) {
      try { await redis.expire(key, RL_WINDOW); }
      catch { try { await redis.del(key); } catch {} } // never leave a key with no TTL
    }
    if (n > RL_LIMIT) return res.status(429).json({ error: 'Too many registrations from this device. Try again in a few minutes.' });
  } catch { /* rate limit unavailable — continue */ }

  // Soft flags for the admin (never blocks a real student).
  const reasons = [];
  if (junkText(name)) reasons.push('name looks off');
  const schoolLow = String(school).trim().toLowerCase();
  if (junkText(school) || JUNK_SCHOOLS.has(schoolLow)) reasons.push('school looks off');
  if (emailNorm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) reasons.push('email looks off');
  if (Array.isArray(members) && members.some(m => junkText(m))) reasons.push('member name looks off');
  if (teamName && junkText(teamName)) reasons.push('team name looks off');
  // Timing: a submit in under 2 seconds is too fast for a human. A missing
  // timestamp means the request didn't come from the form at all.
  // (A negative elapsed is just clock skew between phone and server.)
  const started = Number(startedAt);
  if (!started || isNaN(started)) reasons.push('no form timing');
  else { const elapsed = Date.now() - started; if (elapsed >= 0 && elapsed < 2000) reasons.push('submitted too fast'); }

  const id = 'reg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const record = {
    id, event: ev.name, eventSlug: ev.slug, name, school, phone: phoneNorm, email: emailNorm, team: teamSize,
    teamName: teamName || '', members: Array.isArray(members) ? members.map(String) : [],
    paid: false, amount: 0, at: new Date().toISOString(),
    risk: { level: riskLevelFor(reasons), reasons, at: new Date().toISOString() },
  };

  // Atomic uniqueness claim: SET NX so two concurrent submissions with the
  // same phone/email for this event cannot both write (the scan above is the
  // backstop for rows created before markers existed).
  const mk = regMarkerKeys(ev.slug, phoneNorm, emailNorm);
  try {
    if (mk.phone) {
      const ok = await redis.set(mk.phone, id, { nx: true, ex: MARKER_TTL });
      if (!ok) return res.status(409).json({ error: 'This phone number is already registered for ' + ev.name });
    }
    if (mk.email) {
      const ok = await redis.set(mk.email, id, { nx: true, ex: MARKER_TTL });
      if (!ok) {
        if (mk.phone) try { await redis.del(mk.phone); } catch {}
        return res.status(409).json({ error: 'This email is already registered for ' + ev.name });
      }
    }
  } catch { /* marker store unavailable — fall through to the scan-checked write */ }

  try {
    await redis.hset('celesta:regs', { [id]: JSON.stringify(record) });
    await redis.zadd('celesta:reglist', { score: Date.now(), member: id });
  } catch (e) {
    // Roll the markers back so a failed write doesn't block the student.
    if (mk.phone) try { await redis.del(mk.phone); } catch {}
    if (mk.email) try { await redis.del(mk.email); } catch {}
    return res.status(500).json({ error: 'Storage unavailable' });
  }

  // Confirmation email (best effort — a mail failure never fails the
  // registration the student just completed).
  let emailSent = false;
  if (emailNorm) {
    try { emailSent = await sendConfirmationEmail(record, ev); }
    catch { emailSent = false; }
  }
  return res.status(200).json({ ok: true, id, emailSent });
}
