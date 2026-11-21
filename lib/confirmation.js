// Shared confirmation-card rendering + confirmation-email builder.
// Used by api/confirmation-card.js (PNG download) and api/register.js
// (email with the PNG attached + download button). No OTP anywhere.
//
// IMPORTANT: @vercel/og + React are imported LAZILY inside renderCardPNG
// (dynamic import), never at the top level. If the image library ever fails
// to load, only the PNG fails — the registration flow and the email text
// still work. A top-level import would break ALL registrations if the
// library failed.

// Escape for HTML email bodies.
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtFee(fee) {
  if (!fee) return '—';
  return String(fee);
}

// ---------------------------------------------------------------------------
// PNG confirmation card (1200 x 750), SPARK dark-purple design.
// reg: the registration record. ev: the event object from loadEvents().
// Returns a Buffer with PNG bytes.
// ---------------------------------------------------------------------------
export async function renderCardPNG(reg, ev) {
  // Lazy-load the image stack so a library failure cannot break registration.
  const React = (await import('react')).default;
  const { ImageResponse } = await import('@vercel/og');
  const el = React.createElement;
  const name = String(reg.name || '—');
  const school = String(reg.school || '—');
  const eventName = String(ev.name || reg.event || '—');
  const team = reg.team || 1;
  const teamName = String(reg.teamName || '—');
  const members = Array.isArray(reg.members) ? reg.members.filter(Boolean) : [];
  const fee = fmtFee(ev.fee);
  const regId = String(reg.id || '—');
  const dateLine = 'Friday, 27 November 2026 · 10:00 AM';
  const venue = 'Mar Augusthinose College, Ramapuram';
  const report = 'Report by 9:30 AM with a valid school ID';

  const row = (label, value) =>
    el('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      el('div', { style: { fontSize: 20, letterSpacing: 2, color: '#9b8ec4', textTransform: 'uppercase' } }, label),
      el('div', { style: { fontSize: 30, color: '#ffffff', fontWeight: 600 } }, value));

  const tree = el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(135deg, #1a0b2e 0%, #0a0a12 60%, #12081f 100%)',
      color: '#fff', padding: 48, fontFamily: 'sans-serif',
    },
  },
    // Header
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      el('div', { style: { display: 'flex', flexDirection: 'column' } },
        el('div', { style: { fontSize: 54, fontWeight: 800, letterSpacing: 2 } }, 'SPARK 2K26'),
        el('div', { style: { fontSize: 20, letterSpacing: 4, color: '#d4a853', marginTop: 4 } }, 'NEXUS · DECODE YOUR FUTURE')),
      el('div', {
        style: {
          background: '#d4a853', color: '#1a0b2e', fontSize: 22, fontWeight: 700,
          padding: '12px 22px', borderRadius: 999, letterSpacing: 1,
        },
      }, 'REGISTRATION CONFIRMED')),
    // Event name
    el('div', { style: { fontSize: 64, fontWeight: 800, marginTop: 36, lineHeight: 1.1 } }, eventName),
    el('div', { style: { fontSize: 30, color: '#cfc8e8', marginTop: 10 } }, name + '  ·  ' + school),
    // Details grid
    el('div', { style: { display: 'flex', gap: 48, marginTop: 40 } },
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: 26 } },
        row('Team', 'Team of ' + team + (teamName !== '—' ? ' · ' + teamName : '')),
        row('Members', members.length ? members.join(', ') : '—'),
        row('Fee', fee + ' · pay at venue')),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: 26 } },
        row('Registration ID', regId),
        row('Date', dateLine),
        row('Venue', venue))),
    // Footer
    el('div', {
      style: {
        marginTop: 'auto', paddingTop: 28, borderTop: '1px solid rgba(255,255,255,0.18)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      },
    },
      el('div', { style: { fontSize: 22, color: '#d4a853', fontWeight: 600 } }, report),
      el('div', { style: { fontSize: 20, color: '#9b8ec4' } }, 'spark.maraugusthinosecollege.org')),
  );

  const res = new ImageResponse(tree, { width: 1200, height: 750 });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

// ---------------------------------------------------------------------------
// Confirmation email (HTML + plain text). cardUrl is the absolute download
// link for the PNG (https://spark.maraugusthinosecollege.org/api/confirmation-card?id=...&download=1).
// The PNG itself is attached to the message with CID "confirmation-card" and
// shown inline via <img src="cid:confirmation-card">.
// ---------------------------------------------------------------------------
export function buildConfirmationEmail(reg, ev, cardUrl) {
  const name = String(reg.name || 'there');
  const school = String(reg.school || '—');
  const eventName = String(ev.name || reg.event || '—');
  const team = reg.team || 1;
  const teamName = String(reg.teamName || '');
  const members = Array.isArray(reg.members) ? reg.members.filter(Boolean) : [];
  const fee = fmtFee(ev.fee);
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
    + '<div style="text-align:center;margin-top:20px;">'
    + '<img src="cid:confirmation-card" alt="SPARK 2K26 confirmation card" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto;" />'
    + '</div>'
    + '<div style="text-align:center;margin-top:20px;">'
    + '<a href="' + escHtml(cardUrl) + '" style="display:inline-block;background:#d4a853;color:#1a0b2e;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:999px;">Download confirmation</a>'
    + '</div>'
    + '<p style="text-align:center;color:#9b8ec4;font-size:13px;line-height:1.6;margin-top:20px;">Questions? Ananthu Anil 7510142466 &middot; Bista Mariya Jojo 9746446739<br>SPARK 2K26 &middot; NEXUS &middot; Mar Augusthinose College, Ramapuram</p>'
    + '</div></body></html>';

  const text = 'SPARK 2K26 — Registration confirmed\n\n'
    + 'Hi ' + name + ',\nYou are registered for ' + eventName + ' at SPARK 2K26.\n\n'
    + 'Name: ' + name + '\nSchool: ' + school + '\nEvent: ' + eventName + '\n'
    + 'Team: Team of ' + team + (teamName ? ' · ' + teamName : '') + '\n'
    + (members.length ? 'Members: ' + members.join(', ') + '\n' : '')
    + 'Fee: ' + fee + ' · pay at venue\nRegistration ID: ' + regId + '\n'
    + 'Date: Friday, 27 November 2026 · 10:00 AM\nVenue: Mar Augusthinose College, Ramapuram\n\n'
    + 'Report by 9:30 AM with a valid school ID card.\n\n'
    + 'Download your confirmation card: ' + cardUrl + '\n\n'
    + 'Questions? Ananthu Anil 7510142466 · Bista Mariya Jojo 9746446739';

  return { subject, html, text };
}
