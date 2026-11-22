// POST /api/register — save a new registration (Upstash Redis direct)
// Validates against the events database: the event must exist, be visible,
// have registrations open, and the team size must fit its limits.
// BOT CHECK (runs on every submit, no extra latency, nothing to install):
//  - honeypot: a hidden "website" field humans never see; bots fill it
//    and are rejected outright with a generic error (no reason given).
//  - timing: the form records when it was opened; a submit in under 2
//    seconds is too fast for a human and gets flagged.
//  - per-IP rate limit: 600 registrations per 10 minutes (spam flood guard)
//  - phone must be a valid Indian 10-digit mobile (after +91 / leading 0)
//  - same phone or email already registered for the same event → duplicate
//  - gibberish / junk names, schools and emails are FLAGGED, not blocked:
//    the student still registers, the admin sees a CHECK or BOT badge.
// Flagged records never block a real student — only a filled honeypot,
// a bad phone, a duplicate, or the rate limit reject a submit.
import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';
import { loadEvents } from './events.js';
import { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';
import { sendMail, buildConfirmationEmail, mailConfigured } from '../lib/email.js';
export { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';

// Redis client (was missing: every redis.* call threw ReferenceError and
// every registration failed with "Storage unavailable").
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 600 per 10 min per IP: the whole venue shares one public IP, and the
// 9:30-10:00 rush is ~135-150 submissions. 300 would 429 students once
// timed-out retries burn counts. Duplicates are already blocked per
// phone+email, and junk is flagged.
const RL_LIMIT = 600;
const RL_WINDOW = 600;   // per 10 minutes

// Marker TTL is single-sourced from api/admin-login.js (shared MARKER_TTL,
// imported above): every marker path uses the same value, so a marker set
// here and a marker set by the PATCH/undo paths always agree.
// (The marker only bounds the uniqueness claim; the stored record is the
// real duplicate guard, via the hgetall scan backstop.)

// One generic duplicate message for BOTH phone and email matches: the two
// old messages ("This phone number is…" vs "This email is…") acted as an
// oracle revealing which identifier was already registered.
const DUPLICATE_ERROR = 'Already registered for this event';

// Scan the stored records for a real duplicate of this phone/email for
// this event. Returns 'phone' | 'email' | null. THROWS if the scan itself
// fails, so callers can fail closed instead of guessing.
// (A marker key alone is NOT proof: a function killed between the marker
// SET NX and the HSET leaves an orphan marker with no record behind it.)
async function findDuplicate(ev, phoneNorm, emailNorm) {
  const all = await redis.hgetall('celesta:regs');
  if (!all) return null;
  for (const v of Object.values(all)) {
    let r = null;
    try { r = typeof v === 'object' ? v : JSON.parse(v); } catch { r = null; }
    if (!r || (r.eventSlug !== ev.slug && r.event !== ev.name)) continue;
    if (normPhone(r.phone) === phoneNorm) return 'phone';
    if (emailNorm && r.email && String(r.email).trim().toLowerCase() === emailNorm.toLowerCase()) return 'email';
  }
  return null;
}

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
    const events = await loadEvents({ strict: true });
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
  // Email format is validated HERE, before the duplicate scan / marker
  // claim: without this, an invalid string like "not-an-email" is treated
  // as a real identity and matches a stored record (or a leftover marker)
  // carrying the same string, returning a misleading 409 "Already
  // registered". Email is optional (empty = no email), but a supplied
  // email must be well-formed.
  if (emailNorm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  // Duplicate: same phone or same email already registered for THIS event.
  // (Same student in a different event is fine.) One generic 409 either
  // way — never reveal which identifier matched.
  // FAIL CLOSED: if the scan itself fails we cannot prove this is not a
  // duplicate, so refuse (503) instead of writing blind.
  try {
    if (await findDuplicate(ev, phoneNorm, emailNorm)) {
      return res.status(409).json({ error: DUPLICATE_ERROR });
    }
  } catch (e) {
    console.error('duplicate scan failed', e);
    return res.status(503).json({ error: 'Please try again' });
  }

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
  } catch (e) {
    // Rate limiting is a soft guard: log the failure and continue.
    console.error('rate limit check failed', e);
  }

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

  // Registration ID = the verify code. Short, typeable, human-friendly:
  // "SPK-" + 8 chars from a clean alphabet (no 0/O, 1/I/L — nothing that
  // reads wrong on a card or over the phone). ~40 bits of entropy: with the
  // ticket rate limit (60/10min/IP) brute-forcing is infeasible, and the ID
  // is random, NOT sequential, so it cannot be counted up like a chest
  // number. This one ID is the ticket key AND the verify code — the student
  // says it, writes it, types it; the admin searches it. The chest number
  // stays separate (sequential, display-only, never a lookup key).
  var ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function newRegId() {
    var b = randomBytes(8), s = 'SPK-';
    for (var i = 0; i < 8; i++) s += ID_ALPHABET[b[i] % ID_ALPHABET.length];
    return s;
  }
  var id = newRegId();
  // Uniqueness safety net: 40 bits makes a collision ~1 in 10 billion at
  // fest scale, but never overwrite another student's record. Regenerate
  // on the (essentially impossible) collision.
  for (var attempt = 0; attempt < 5; attempt++) {
    try {
      var existing = await redis.hget('celesta:regs', id);
      if (!existing) break;
    } catch (e) { break; }
    id = newRegId();
  }
  // Final uniqueness check: the loop above can exit with an unchecked id —
  // the 5th-attempt regenerate is never checked, and an HGET error breaks
  // out unchecked. One last hget; if the id exists (or the check itself
  // fails), refuse instead of writing.
  try {
    const finalCheck = await redis.hget('celesta:regs', id);
    if (finalCheck) return res.status(503).json({ error: 'Please try again' });
  } catch (e) {
    console.error('final id check failed', e);
    return res.status(503).json({ error: 'Please try again' });
  }
  const record = {
    id, event: ev.name, eventSlug: ev.slug, name, school, phone: phoneNorm, email: emailNorm, team: teamSize,
    teamName: teamName || '', members: Array.isArray(members) ? members.map(String) : [],
    paid: false, amount: 0, at: new Date().toISOString(),
    risk: { level: riskLevelFor(reasons), reasons, at: new Date().toISOString() },
  };

  // Atomic uniqueness claim: SET NX so two concurrent submissions with the
  // same phone/email for this event cannot both write (the scan above is the
  // backstop for rows created before markers existed).
  // A marker that exists with NO stored record behind it is an orphan
  // (the function was killed between the marker SET and the HSET, or a
  // failed write never rolled it back): delete it and reclaim the claim
  // instead of blocking the real student forever. A 409 is returned only
  // when a real stored record exists.
  const mk = regMarkerKeys(ev.slug, phoneNorm, emailNorm);
  try {
    if (mk.phone) {
      let ok = await redis.set(mk.phone, id, { nx: true, ex: MARKER_TTL });
      if (!ok) {
        let dup;
        try { dup = await findDuplicate(ev, phoneNorm, emailNorm); }
        catch (e) { console.error('duplicate verify failed', e); return res.status(503).json({ error: 'Please try again' }); }
        if (dup) return res.status(409).json({ error: DUPLICATE_ERROR });
        try { await redis.del(mk.phone); } catch {}
        ok = await redis.set(mk.phone, id, { nx: true, ex: MARKER_TTL });
        if (!ok) return res.status(409).json({ error: DUPLICATE_ERROR });
      }
    }
    if (mk.email) {
      let ok = await redis.set(mk.email, id, { nx: true, ex: MARKER_TTL });
      if (!ok) {
        let dup;
        try { dup = await findDuplicate(ev, phoneNorm, emailNorm); }
        catch (e) {
          console.error('duplicate verify failed', e);
          if (mk.phone) try { await redis.del(mk.phone); } catch {}
          return res.status(503).json({ error: 'Please try again' });
        }
        if (dup) {
          if (mk.phone) try { await redis.del(mk.phone); } catch {}
          return res.status(409).json({ error: DUPLICATE_ERROR });
        }
        try { await redis.del(mk.email); } catch {}
        ok = await redis.set(mk.email, id, { nx: true, ex: MARKER_TTL });
        if (!ok) {
          if (mk.phone) try { await redis.del(mk.phone); } catch {}
          return res.status(409).json({ error: DUPLICATE_ERROR });
        }
      }
    }
  } catch (e) {
    // Marker store failed: the scan already passed, so a failed marker
    // means the uniqueness backstop is gone. Fail closed (503) and roll
    // back any marker already claimed, so the retry is not blocked.
    console.error('marker store failed', e);
    if (mk.phone) try { await redis.del(mk.phone); } catch {}
    if (mk.email) try { await redis.del(mk.email); } catch {}
    return res.status(503).json({ error: 'Please try again' });
  }

  // Chest number, assigned at REGISTRATION time (owner's call). Per-event
  // atomic sequence (Redis INCR) so two simultaneous registrations never
  // collide. Format: 2-digit event code (PDF order: Prompting 01, Quiz 02,
  // Treasure Hunt 03, Reels 04) + 3-digit sequence, e.g. Prompting #1 =
  // 01001, Quiz #1 = 02001. A team gets ONE chest number. This runs AFTER
  // the duplicate/marker checks, so a rejected registration never consumes
  // a number. If the write below then fails, the number is skipped (a gap
  // is fine; numbers are never reused). If INCR itself fails, the
  // registration still goes through and the fees app assigns a chest on
  // mark-paid instead.
  const CHEST_CODES = { 'prompting': '01', 'quiz': '02', 'treasure-hunt': '03', 'reels-competition': '04' };
  try {
    const seq = await redis.incr('celesta:chestseq:' + ev.slug);
    record.chest = (CHEST_CODES[ev.slug] || '00') + String(seq).padStart(3, '0');
  } catch (e) {
    console.error('chest number failed', e);
  }

  try {
    // HSET + ZADD together in one pipeline so they land atomically: two
    // separate awaits could leave the record in the hash but missing from
    // reglist (invisible in the admin list, yet blocking re-registration)
    // if Vercel kills the function between them. Falls back to sequential
    // calls only if the client has no pipeline (local test stubs).
    if (typeof redis.pipeline === 'function') {
      const p = redis.pipeline();
      p.hset('celesta:regs', { [id]: JSON.stringify(record) });
      p.zadd('celesta:reglist', { score: Date.now(), member: id });
      await p.exec();
    } else {
      await redis.hset('celesta:regs', { [id]: JSON.stringify(record) });
      await redis.zadd('celesta:reglist', { score: Date.now(), member: id });
    }
  } catch (e) {
    console.error('register write failed', e);
    // Roll the markers back so a failed write doesn't block the student.
    if (mk.phone) try { await redis.del(mk.phone); } catch {}
    if (mk.email) try { await redis.del(mk.email); } catch {}
    // Remove a half-written record (hset ok, zadd failed) so the retry
    // doesn't hit a false "already registered" duplicate.
    try { await redis.hdel('celesta:regs', id); } catch {}
    return res.status(500).json({ error: 'Storage unavailable' });
  }

  // Confirmation email, best-effort and NOT awaited: it is fired in the
  // background so the 8s SMTP step never sits inside the 10s Vercel limit
  // (a kill mid-send used to leave the student seeing a failure, then a
  // confusing 409 on retry with no ticket id). emailSent reports whether
  // mail is configured, i.e. whether an email will be sent. A mail failure
  // NEVER fails the registration or changes the ticket the student gets.
  // When Gmail is not configured, no mail is sent and emailSent is false.
  let emailSent = false;
  if (emailNorm) {
    try {
      const mail = buildConfirmationEmail({
        event: ev.name, name, school, members: record.members,
        phone: phoneNorm, fee: ev.fee || '', id, team: teamSize,
      });
      if (mailConfigured()) {
        emailSent = true;
        const sendPromise = sendMail({ to: emailNorm, ...mail });
        sendPromise.catch(e => console.error('confirmation email failed', e));
        // Keep the send alive past the response when the platform offers
        // waitUntil (Vercel @vercel/functions). That package is NOT a
        // dependency here, so the dynamic import fails fast and is caught
        // — the send stays best-effort fire-and-forget and nothing crashes
        // if waitUntil is unavailable. If the package is ever added, the
        // same code starts using it with no further change.
        try {
          const { waitUntil } = await import('@vercel/functions');
          if (typeof waitUntil === 'function') waitUntil(sendPromise);
        } catch {}
      }
    } catch (e) {
      console.error('confirmation email failed', e);
      emailSent = false;
    }
  }
  return res.status(200).json(emailNorm ? { ok: true, id, emailSent } : { ok: true, id });
}
