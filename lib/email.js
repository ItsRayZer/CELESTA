// lib/email.js — SPARK 2K26 mail: raw SMTP to Gmail, zero npm deps.
// Uses Node's built-in `tls` (smtp.gmail.com:465, implicit TLS) so no new
// dependency is added to package.json and no lockfile change is needed.
// Everything here is best-effort: sendMail() returns true/false and never
// throws to its caller, so a mail failure can never break a registration.
//
// Env vars (set in Vercel, never in code):
//   GMAIL_USER          e.g. sparkfest.mac@gmail.com
//   GMAIL_APP_PASSWORD  Gmail App Password (2FA app password, NOT the login
//                       password). When either is absent, mail is skipped
//                       silently and sendMail() returns false.
import tls from 'node:tls';

export const MAIL_FROM_NAME = 'SPARK 2K26';
export const FEST_WHEN = 'Fri, 27 Nov 2026 · 10 AM';
export const FEST_VENUE = 'Mar Augusthinose College, Ramapuram';
export const TICKET_URL = (id) => 'https://spark.maraugusthinosecollege.org/ticket?id=' + id;

export function mailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

// Base64, wrapped at 76 chars per line (RFC 2045).
function b64wrap(str) {
  return Buffer.from(String(str), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function randomBoundary() {
  return 'spark2k26-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// --- Raw SMTP ------------------------------------------------------------
// One SMTP session: greeting, EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA,
// message, QUIT. Whole session is capped at `timeoutMs` (default 8s) so a
// slow Gmail can never blow the Vercel 10s function timeout.
function smtpSend({ from, to, raw, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let sock = null;
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), timeoutMs);
    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (sock) sock.destroy(); } catch {}
      reject(err);
    };
    const ok = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (sock) sock.end(); } catch {}
      resolve();
    };

    // Reply reader: SMTP replies are one or more lines; the last line is
    // "NNN " (code + space), continuations are "NNN-". Queue one waiter
    // per command; the greeting gets the first waiter.
    let buf = '';
    const lines = [];
    const waiters = [];
    const nextReply = () => new Promise((res) => waiters.push(res));
    const onLine = (line) => {
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        const code = parseInt(line.slice(0, 3), 10);
        const text = lines.join('\n');
        lines.length = 0;
        const w = waiters.shift();
        if (w) w({ code, text });
      }
    };

    sock = tls.connect(
      { host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' },
      () => {}
    );
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        onLine(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    });
    sock.on('error', (e) => fail(e));
    sock.on('close', () => { if (!done) fail(new Error('SMTP connection closed')); });

    const cmd = async (text, want) => {
      const p = nextReply();
      sock.write(text + '\r\n');
      const r = await p;
      if (want && r.code !== want) throw new Error('SMTP ' + r.code + ': ' + r.text);
      return r;
    };

    (async () => {
      try {
        const greet = await nextReply();
        if (greet.code !== 220) throw new Error('SMTP greeting ' + greet.code + ': ' + greet.text);
        await cmd('EHLO spark2k26', 250);
        await cmd('AUTH LOGIN', 334);
        await cmd(Buffer.from(process.env.GMAIL_USER, 'utf8').toString('base64'), 334);
        await cmd(Buffer.from(process.env.GMAIL_APP_PASSWORD, 'utf8').toString('base64'), 235);
        await cmd('MAIL FROM:<' + process.env.GMAIL_USER + '>', 250);
        await cmd('RCPT TO:<' + to + '>', 250);
        await cmd('DATA', 354);
        // Dot-stuff: any body line starting with "." gets an extra "." so
        // the server never mistakes it for the end-of-data marker.
        const stuffed = String(raw).split('\r\n').map(l => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
        const p = nextReply();
        sock.write(stuffed + '\r\n.\r\n');
        const r = await p;
        if (r.code !== 250) throw new Error('SMTP DATA ' + r.code + ': ' + r.text);
        try { await cmd('QUIT', 221); } catch {}
        ok();
      } catch (e) {
        fail(e);
      }
    })();
  });
}

// --- MIME message --------------------------------------------------------
function buildMessage({ from, to, subject, html, text, attachments }) {
  const mixed = randomBoundary();
  const alt = randomBoundary();
  const lines = [];
  lines.push('From: "' + MAIL_FROM_NAME + '" <' + from + '>');
  lines.push('To: <' + to + '>');
  // Subject is kept ASCII-only by every builder below, so no RFC 2047
  // encoding is needed.
  lines.push('Subject: ' + subject);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: multipart/mixed; boundary="' + mixed + '"');
  lines.push('Message-ID: <spark-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '@spark.maraugusthinosecollege.org>');
  lines.push('Date: ' + new Date().toUTCString());
  lines.push('');
  lines.push('--' + mixed);
  lines.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
  lines.push('');
  lines.push('--' + alt);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(b64wrap(text));
  lines.push('--' + alt);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(b64wrap(html));
  lines.push('--' + alt + '--');
  for (const a of attachments || []) {
    const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), 'utf8');
    lines.push('--' + mixed);
    lines.push('Content-Type: ' + (a.contentType || 'application/octet-stream') + '; name="' + a.filename + '"');
    lines.push('Content-Disposition: attachment; filename="' + a.filename + '"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(content.toString('base64').replace(/(.{76})/g, '$1\r\n'));
  }
  lines.push('--' + mixed + '--');
  return lines.join('\r\n');
}

// Send one email. Returns true on success, false on any failure (including
// "mail not configured"). Never throws.
export async function sendMail({ to, subject, html, text, attachments }) {
  if (!mailConfigured()) return false;
  const addr = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  const from = String(process.env.GMAIL_USER).trim();
  try {
    const raw = buildMessage({ from, to: addr, subject, html, text, attachments });
    await smtpSend({ from, to: addr, raw, timeoutMs: 8000 });
    return true;
  } catch (e) {
    console.error('sendMail failed', e);
    return false;
  }
}

// --- Ticket SVG (1200x750, matches the site ticket) -----------------------
// No QR in the image: the email already links to the ticket page, which
// carries the scannable dot QR. Keeps the attachment simple and reliable.
export function buildTicketSvg({ event, name, school, members, phone, fee, id, team }) {
  const memberList = [name].concat(Array.isArray(members) ? members : []);
  const membersStr = memberList.join(', ') + '  ·  Team of ' + team;
  const rows = [
    { k: 'Event', v: event },
    { k: 'Leader', v: name },
    { k: 'School', v: school },
    { k: 'Members', v: membersStr.length > 64 ? membersStr.slice(0, 61) + '…' : membersStr },
    { k: 'Phone', v: phone },
  ];
  if (fee) rows.push({ k: 'Fee', v: fee + '  ·  Pay at the venue' });
  const W = 1200, H = 750, px = 80;
  let y = px;
  let s = '';
  s += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  s += '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b3dff"/><stop offset=".45" stop-color="#8f47e6"/><stop offset="1" stop-color="#3d1596"/></linearGradient></defs>';
  s += '<rect width="' + W + '" height="' + H + '" rx="48" fill="url(#bg)"/>';
  s += '<text x="' + px + '" y="' + (y + 26) + '" font-family="Arial,sans-serif" font-size="28" letter-spacing="5" fill="rgba(255,255,255,.75)">SPARK 2K26 · REGISTERED</text>';
  y += 64;
  s += '<text x="' + px + '" y="' + (y + 40) + '" font-family="Georgia,serif" font-size="58" font-weight="700" fill="#fff">' + esc(event) + '</text>';
  y += 88;
  s += '<text x="' + px + '" y="' + (y + 10) + '" font-family="Arial,sans-serif" font-size="28" fill="rgba(255,255,255,.85)">' + esc(FEST_WHEN) + ' · ' + esc(FEST_VENUE) + '</text>';
  y += 44;
  s += '<line x1="' + px + '" y1="' + y + '" x2="' + (W - px) + '" y2="' + y + '" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="10 8"/>';
  y += 28;
  const rowH = 46;
  for (const r of rows) {
    s += '<text x="' + px + '" y="' + (y + 10) + '" font-family="Arial,sans-serif" font-size="28" fill="rgba(255,255,255,.75)">' + esc(r.k) + '</text>';
    s += '<text x="' + (W - px) + '" y="' + (y + 10) + '" text-anchor="end" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">' + esc(r.v) + '</text>';
    y += rowH;
  }
  y += 12;
  s += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="rgba(255,255,255,.5)" stroke-width="3" stroke-dasharray="14 12"/>';
  s += '<circle cx="0" cy="' + y + '" r="26" fill="#060608"/>';
  s += '<circle cx="' + W + '" cy="' + y + '" r="26" fill="#060608"/>';
  y += 48;
  s += '<text x="' + px + '" y="' + (y + 8) + '" font-family="Arial,sans-serif" font-size="24" letter-spacing="3" fill="rgba(255,255,255,.75)">REGISTRATION ID</text>';
  y += 46;
  s += '<text x="' + px + '" y="' + (y + 8) + '" font-family="monospace" font-size="36" font-weight="700" letter-spacing="1" fill="#fff">' + esc(id) + '</text>';
  y += 52;
  s += '<text x="' + px + '" y="' + (y + 8) + '" font-family="Arial,sans-serif" font-size="26" fill="rgba(255,255,255,.85)">Show this ticket at the registration desk · Carry a valid school ID</text>';
  s += '<text x="' + (W / 2) + '" y="' + (H - 36) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" letter-spacing="4" fill="rgba(255,255,255,.6)">NEXUS · SPARK 2K26</text>';
  s += '</svg>';
  return s;
}

// --- Confirmation email --------------------------------------------------
export function buildConfirmationEmail({ event, name, school, members, phone, fee, id, team }) {
  const memberList = [name].concat(Array.isArray(members) ? members : []);
  const ticketUrl = TICKET_URL(id);
  const subject = "You're registered for SPARK 2K26 - " + event;
  const row = (k, v) => '<tr><td style="padding:8px 0;color:#8a7bb8;font-size:14px;">' + esc(k) + '</td><td style="padding:8px 0;text-align:right;color:#1a0b2e;font-size:14px;font-weight:600;">' + esc(v) + '</td></tr>';
  const html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f1fa;font-family:Arial,sans-serif;">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px 16px;">'
    + '<div style="background:linear-gradient(135deg,#7b3dff,#3d1596);border-radius:20px 20px 0 0;padding:28px 28px 20px;text-align:center;">'
    + '<div style="color:rgba(255,255,255,.75);font-size:12px;letter-spacing:4px;">SPARK 2K26</div>'
    + '<div style="color:#fff;font-size:26px;font-weight:700;margin-top:8px;">You\'re registered!</div>'
    + '<div style="color:rgba(255,255,255,.85);font-size:14px;margin-top:6px;">' + esc(event) + ' · ' + esc(FEST_WHEN) + '</div>'
    + '</div>'
    + '<div style="background:#fff;border-radius:0 0 20px 20px;padding:24px 28px;">'
    + '<table style="width:100%;border-collapse:collapse;">'
    + row('Event', event)
    + row('Leader', name)
    + row('School', school)
    + row('Members', memberList.join(', ') + ' (Team of ' + team + ')')
    + row('Phone', phone)
    + (fee ? row('Fee', fee + ' - pay at the venue') : '')
    + '</table>'
    + '<div style="border-top:2px dashed #d9cdf2;margin:16px 0;"></div>'
    + '<div style="font-size:12px;letter-spacing:2px;color:#8a7bb8;">REGISTRATION ID</div>'
    + '<div style="font-family:monospace;font-size:18px;font-weight:700;color:#1a0b2e;margin-top:4px;">' + esc(id) + '</div>'
    + '<div style="text-align:center;margin:24px 0 8px;"><a href="' + escAttr(ticketUrl) + '" style="display:inline-block;background:#7b3dff;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:999px;">View your ticket</a></div>'
    + '<p style="font-size:13px;color:#5b5470;line-height:1.6;text-align:center;">Report by 9:30 AM on 27 November 2026 at ' + esc(FEST_VENUE) + '.<br>Carry a valid school ID card for every member. Show this ticket at the registration desk.</p>'
    + '</div>'
    + '<p style="font-size:12px;color:#8a7bb8;text-align:center;margin-top:16px;">NEXUS · SPARK 2K26 · Mar Augusthinose College, Ramapuram</p>'
    + '</div></body></html>';
  const text = "You're registered for SPARK 2K26 - " + event + "\n\n"
    + 'Event: ' + event + '\n'
    + 'Leader: ' + name + '\n'
    + 'School: ' + school + '\n'
    + 'Members: ' + memberList.join(', ') + ' (Team of ' + team + ')\n'
    + 'Phone: ' + phone + '\n'
    + (fee ? 'Fee: ' + fee + ' - pay at the venue\n' : '')
    + 'Registration ID: ' + id + '\n'
    + 'When: ' + FEST_WHEN + '\n'
    + 'Where: ' + FEST_VENUE + '\n\n'
    + 'View your ticket: ' + ticketUrl + '\n\n'
    + 'Report by 9:30 AM on 27 November 2026. Carry a valid school ID card for every member.\n'
    + 'NEXUS - SPARK 2K26';
  const svg = buildTicketSvg({ event, name, school, members, phone, fee, id, team });
  return {
    subject, html, text,
    attachments: [{ filename: 'SPARK-2K26-ticket-' + id + '.svg', contentType: 'image/svg+xml', content: svg }],
  };
}

// --- Reminder email ------------------------------------------------------
// kind: 'tomorrow' (26 Nov) or 'today' (27 Nov morning).
export function buildReminderEmail({ reg, fee, kind }) {
  const ticketUrl = TICKET_URL(reg.id);
  const isToday = kind === 'today';
  const subject = isToday
    ? 'Today is SPARK 2K26 - see you at 9:30 AM'
    : 'Tomorrow is SPARK 2K26 - see you at 9:30 AM';
  const head = isToday ? 'Today is the day!' : 'Tomorrow is SPARK 2K26!';
  const html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f1fa;font-family:Arial,sans-serif;">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px 16px;">'
    + '<div style="background:linear-gradient(135deg,#7b3dff,#3d1596);border-radius:20px 20px 0 0;padding:28px;text-align:center;">'
    + '<div style="color:rgba(255,255,255,.75);font-size:12px;letter-spacing:4px;">SPARK 2K26</div>'
    + '<div style="color:#fff;font-size:24px;font-weight:700;margin-top:8px;">' + head + '</div>'
    + '<div style="color:rgba(255,255,255,.85);font-size:14px;margin-top:6px;">' + esc(reg.event) + ' · ' + esc(FEST_WHEN) + '</div>'
    + '</div>'
    + '<div style="background:#fff;border-radius:0 0 20px 20px;padding:24px 28px;">'
    + '<p style="font-size:15px;color:#1a0b2e;line-height:1.6;">Hi ' + esc(reg.name) + ',</p>'
    + '<p style="font-size:14px;color:#5b5470;line-height:1.7;">Your SPARK 2K26 registration is confirmed. A quick reminder before you head out:</p>'
    + '<ul style="font-size:14px;color:#1a0b2e;line-height:1.9;padding-left:20px;">'
    + '<li><b>Report by 9:30 AM</b> at ' + esc(FEST_VENUE) + '</li>'
    + '<li>Carry a <b>valid school ID card</b> for every member</li>'
    + (fee ? '<li>Fee: <b>' + esc(fee) + '</b> - pay at the venue</li>' : '')
    + '<li>Registration ID: <b style="font-family:monospace;">' + esc(reg.id) + '</b></li>'
    + '</ul>'
    + '<div style="text-align:center;margin:24px 0 8px;"><a href="' + escAttr(ticketUrl) + '" style="display:inline-block;background:#7b3dff;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:999px;">View your ticket</a></div>'
    + '<p style="font-size:13px;color:#5b5470;line-height:1.6;text-align:center;">Show your ticket at the registration desk.</p>'
    + '</div>'
    + '<p style="font-size:12px;color:#8a7bb8;text-align:center;margin-top:16px;">NEXUS · SPARK 2K26 · Mar Augusthinose College, Ramapuram</p>'
    + '</div></body></html>';
  const text = head + '\n\n'
    + 'Hi ' + reg.name + ',\n\n'
    + 'Your SPARK 2K26 registration (' + reg.event + ') is confirmed.\n\n'
    + 'Report by 9:30 AM at ' + FEST_VENUE + '.\n'
    + 'Carry a valid school ID card for every member.\n'
    + (fee ? 'Fee: ' + fee + ' - pay at the venue.\n' : '')
    + 'Registration ID: ' + reg.id + '\n\n'
    + 'View your ticket: ' + ticketUrl + '\n\n'
    + 'NEXUS - SPARK 2K26';
  return { subject, html, text, attachments: [] };
}
