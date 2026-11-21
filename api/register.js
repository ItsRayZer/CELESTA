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
import tls from 'tls';
import { loadEvents } from './events.js';
import { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';
export { normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';

// --- Confirmation card + email (inlined here, no lib/ import) ---
// The card is a pure SVG string (zero extra dependencies). It is attached to
// the confirmation email and also built client-side in register.html for the
// Download button, so no separate card endpoint is needed.
function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function renderCardSVG(reg, ev) {
  const name = String(reg.name || '—');
  const school = String(reg.school || '—');
  const eventName = String(ev.name || reg.event || '—');
  const team = reg.team || 1;
  const teamName = String(reg.teamName || '');
  const members = Array.isArray(reg.members) ? reg.members.filter(Boolean) : [];
  const fee = String(ev.fee || '—');
  const regId = String(reg.id || '—');
  const teamLine = 'Team of ' + team + (teamName ? ' · ' + teamName : '');
  const memberLine = members.length ? members.join(', ') : '—';
  const label = (x, y, t) =>
    '<text x="' + x + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="20" letter-spacing="2" fill="#9b8ec4">' + escXml(t) + '</text>';
  const value = (x, y, t) =>
    '<text x="' + x + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="600" fill="#ffffff">' + escXml(t) + '</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">'
    + '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#1a0b2e"/><stop offset="0.6" stop-color="#0a0a12"/><stop offset="1" stop-color="#12081f"/>'
    + '</linearGradient></defs>'
    + '<rect width="1200" height="750" fill="url(#bg)"/>'
    + '<text x="48" y="96" font-family="Arial,Helvetica,sans-serif" font-size="54" font-weight="800" letter-spacing="2" fill="#ffffff">SPARK 2K26</text>'
    + '<text x="48" y="132" font-family="Arial,Helvetica,sans-serif" font-size="20" letter-spacing="4" fill="#d4a853">NEXUS · DECODE YOUR FUTURE</text>'
    + '<rect x="838" y="52" width="314" height="52" rx="26" fill="#d4a853"/>'
    + '<text x="995" y="86" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#1a0b2e">REGISTRATION CONFIRMED</text>'
    + '<text x="48" y="232" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="800" fill="#ffffff">' + escXml(eventName) + '</text>'
    + '<text x="48" y="282" font-family="Arial,Helvetica,sans-serif" font-size="30" fill="#cfc8e8">' + escXml(name) + '  ·  ' + escXml(school) + '</text>'
    + label(48, 356, 'TEAM') + value(48, 392, teamLine)
    + label(48, 452, 'MEMBERS') + value(48, 488, memberLine)
    + label(48, 548, 'FEE') + value(48, 584, fee + ' · pay at venue')
    + label(648, 356, 'REGISTRATION ID') + value(648, 392, regId)
    + label(648, 452, 'DATE') + value(648, 488, 'Friday, 27 November 2026 · 10:00 AM')
    + label(648, 548, 'VENUE') + value(648, 584, 'Mar Augusthinose College, Ramapuram')
    + '<line x1="48" y1="648" x2="1152" y2="648" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>'
    + '<text x="48" y="694" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="600" fill="#d4a853">Report by 9:30 AM with a valid school ID</text>'
    + '<text x="1152" y="694" font-family="Arial,Helvetica,sans-serif" font-size="20" text-anchor="end" fill="#9b8ec4">spark.maraugusthinosecollege.org</text>'
    + '</svg>';
}
function buildConfirmationEmail(reg, ev) {
  const name = String(reg.name || 'there');
  const school = String(reg.school || '—');
  const eventName = String(ev.name || reg.event || '—');
  const team = reg.team || 1;
  const teamName = String(reg.teamName || '');
  const members = Array.isArray(reg.members) ? reg.members.filter(Boolean) : [];
  const fee = String(ev.fee || '—');
  const regId = String(reg.id || '—');
  const subject = 'SPARK 2K26 — Registration confirmed: ' + eventName;
  const html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a12;font-family:Arial,Helvetica,sans-serif;color:#fff;">'
    + '<div style="max-width:600px;margin:0 auto;padding:24px;">'
    + '<div style="text-align:center;padding:24px 0 8px;">'
    + '<div style="font-size:30px;font-weight:800;letter-spacing:2px;">SPARK 2K26</div>'
    + '<div style="font-size:12px;letter-spacing:4px;color:#d4a853;margin-top:4px;">NEXUS &middot; DECODE YOUR FUTURE</div>'
    + '</div>'
    + '<div style="background:#1a0b2e;border:1px solid rgba(255,255,255,0.14);border-radius:16px;padding:28px 24px;margin-top:16px;">'
    + '<div style="font-size:22px;font-weight:700;">Registration confirmed</div>'
    + '<p style="color:#cfc8e8;line-height:1.6;">Hi ' + escHtml(name) + ',<br>You are registered for <strong style="color:#fff;">' + escHtml(eventName) + '</strong> at SPARK 2K26. Here are your details.</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:15px;">'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Name</td><td style="padding:8px 0;text-align:right;">' + escHtml(name) + '</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">School</td><td style="padding:8px 0;text-align:right;">' + escHtml(school) + '</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Event</td><td style="padding:8px 0;text-align:right;">' + escHtml(eventName) + '</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Team</td><td style="padding:8px 0;text-align:right;">Team of ' + escHtml(team) + (teamName ? ' &middot; ' + escHtml(teamName) : '') + '</td></tr>'
    + (members.length ? '<tr><td style="padding:8px 0;color:#9b8ec4;">Members</td><td style="padding:8px 0;text-align:right;">' + escHtml(members.join(', ')) + '</td></tr>' : '')
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Fee</td><td style="padding:8px 0;text-align:right;">' + escHtml(fee) + ' &middot; pay at venue</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Registration ID</td><td style="padding:8px 0;text-align:right;">' + escHtml(regId) + '</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Date</td><td style="padding:8px 0;text-align:right;">Friday, 27 November 2026 &middot; 10:00 AM</td></tr>'
    + '<tr><td style="padding:8px 0;color:#9b8ec4;">Venue</td><td style="padding:8px 0;text-align:right;">Mar Augusthinose College, Ramapuram</td></tr>'
    + '</table>'
    + '<p style="color:#d4a853;font-weight:700;margin:18px 0 0;">Report by 9:30 AM with a valid school ID card.</p>'
    + '</div>'
    + '<p style="text-align:center;color:#9b8ec4;font-size:13px;line-height:1.6;margin-top:20px;">Your confirmation card is attached to this email. Download it from the registration page too.<br>Questions? Ananthu Anil 7510142466 &middot; Bista Mariya Jojo 9746446739<br>SPARK 2K26 &middot; NEXUS &middot; Mar Augusthinose College, Ramapuram</p>'
    + '</div></body></html>';
  const text = 'SPARK 2K26 — Registration confirmed\n\n'
    + 'Hi ' + name + ',\nYou are registered for ' + eventName + ' at SPARK 2K26.\n\n'
    + 'Name: ' + name + '\nSchool: ' + school + '\nEvent: ' + eventName + '\n'
    + 'Team: Team of ' + team + (teamName ? ' · ' + teamName : '') + '\n'
    + (members.length ? 'Members: ' + members.join(', ') + '\n' : '')
    + 'Fee: ' + fee + ' · pay at venue\nRegistration ID: ' + regId + '\n'
    + 'Date: Friday, 27 November 2026 · 10:00 AM\nVenue: Mar Augusthinose College, Ramapuram\n\n'
    + 'Report by 9:30 AM with a valid school ID card.\n\n'
    + 'Questions? Ananthu Anil 7510142466 · Bista Mariya Jojo 9746446739';
  return { subject, html, text };
}

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
//
// SMTP is spoken directly over Node's built-in tls module (no npm package):
// adding nodemailer to package.json broke EVERY api function on deploy
// (dpl_5zrF1nsFaVDjGPkJ7h4mE6cojJo5, dpl_Au2DkSQuPe6L3cPx8Xm2UB1k9WV9,
// dpl_2uS4bTMcvFrLuWMPNFZBy4nSPt2r, dpl_3wNjx6ByJuTLcD3ZjqQc7SquqY5i).
// Do NOT add an email library without a canary deploy.

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

// Minimal SMTP client (implicit TLS, port 465). Resolves when the server
// accepts the message (250 after DATA), rejects on any unexpected reply.
function sendSmtp({ user, pass, from, to, subject, text, html, attachName, attachContent, attachType }) {
  return new Promise((resolve, reject) => {
    const boundary = 'spark2k26-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const lines = [
      'From: ' + from,
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      text,
      '--' + boundary,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
      '--' + boundary,
      'Content-Type: ' + attachType + '; name="' + attachName + '"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + attachName + '"',
      '',
      Buffer.from(attachContent, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
      '--' + boundary + '--',
      '',
    ];
    // Dot-stuff any line starting with a dot (SMTP DATA rule).
    const body = lines.join('\r\n').split('\r\n').map(l => (l.startsWith('.') ? '.' + l : l)).join('\r\n');

    const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
    let buf = '';
    let step = 0;
    let done = false;
    const fail = (msg) => { if (!done) { done = true; try { socket.destroy(); } catch {} reject(new Error(msg)); } };
    const timer = setTimeout(() => fail('smtp timeout'), 8000);
    const cleanup = () => clearTimeout(timer);
    socket.on('error', (e) => fail('smtp error: ' + (e && e.message)));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // Process complete lines; SMTP replies end with \r\n and the last line
      // of a multi-line reply has a space after the 3-digit code.
      while (buf.includes('\r\n')) {
        const idx = buf.indexOf('\r\n');
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const code = line.slice(0, 3);
        const cont = line.charAt(3) === '-';
        if (cont) continue; // more lines of this reply coming
        const send = (s) => { try { socket.write(s + '\r\n'); } catch (e) { fail('smtp write failed'); } };
        try {
          if (step === 0) { // greeting 220
            if (code !== '220') return fail('smtp greeting ' + code);
            step = 1; send('EHLO spark.maraugusthinosecollege.org');
          } else if (step === 1) { // EHLO 250
            if (code !== '250') return fail('smtp EHLO ' + code);
            step = 2; send('AUTH LOGIN');
          } else if (step === 2) { // AUTH LOGIN -> 334 (username)
            if (code !== '334') return fail('smtp AUTH ' + code);
            step = 3; send(b64(user));
          } else if (step === 3) { // username -> 334 (password)
            if (code !== '334') return fail('smtp AUTH user ' + code);
            step = 4; send(b64(pass));
          } else if (step === 4) { // password -> 235
            if (code !== '235') return fail('smtp AUTH pass ' + code);
            step = 5; send('MAIL FROM:<' + user + '>');
          } else if (step === 5) { // MAIL FROM 250
            if (code !== '250') return fail('smtp MAIL FROM ' + code);
            step = 6; send('RCPT TO:<' + to + '>');
          } else if (step === 6) { // RCPT TO 250
            if (code !== '250') return fail('smtp RCPT ' + code);
            step = 7; send('DATA');
          } else if (step === 7) { // DATA -> 354
            if (code !== '354') return fail('smtp DATA ' + code);
            step = 8; send(body + '\r\n.');
          } else if (step === 8) { // message accepted 250
            if (code !== '250') return fail('smtp message ' + code);
            step = 9; send('QUIT');
          } else if (step === 9) { // QUIT 221
            if (!done) { done = true; cleanup(); try { socket.end(); } catch {} resolve(true); }
          }
        } catch (e) { fail('smtp step failed: ' + (e && e.message)); }
      }
    });
    socket.on('close', () => { if (step === 9 && !done) { done = true; cleanup(); resolve(true); } });
  });
}

async function sendConfirmationEmail(record, ev) {
  const to = String(record.email || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!user || !pass) return false;
  const svg = renderCardSVG(record, ev);
  const { subject, html, text } = buildConfirmationEmail(record, ev);
  const from = '"SPARK 2K26" <' + user + '>';
  // 8s cap so a slow SMTP handshake cannot push the function past the
  // 10s Hobby limit and turn a saved registration into a timeout.
  await Promise.race([
    sendSmtp({
      user, pass, from, to, subject, text, html,
      attachName: 'spark-2k26-confirmation.svg',
      attachContent: svg,
      attachType: 'image/svg+xml',
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
