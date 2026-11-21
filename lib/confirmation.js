// Shared confirmation-card rendering + confirmation-email builder.
// Used by api/confirmation-card.js (card download) and api/register.js
// (email with the card attached + download button). No OTP anywhere.
//
// The card is a pure SVG (built as a string, zero dependencies). SVG is a
// real image: it downloads, opens in any browser/phone, and shares. PNG
// rendering via @vercel/og was REMOVED because it broke every API function
// on deploy (dpl_5zrF1nsFaVDjGPkJ7h4mE6cojJo5, 21 Nov 2026) — the site was
// rolled back to dpl_6QC1Jksu6HFQgEq1hxhfuBsMPgmv. Do NOT re-add @vercel/og
// or react without a canary deploy.

// Escape for HTML email bodies.
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape for XML/SVG text nodes.
function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fmtFee(fee) {
  if (!fee) return '—';
  return String(fee);
}

// ---------------------------------------------------------------------------
// SVG confirmation card (1200 x 750), SPARK dark-purple design.
// reg: the registration record. ev: the event object from loadEvents().
// Returns the SVG source string.
// ---------------------------------------------------------------------------
export function renderCardSVG(reg, ev) {
  const name = String(reg.name || '—');
  const school = String(reg.school || '—');
  const eventName = String(ev.name || reg.event || '—');
  const team = reg.team || 1;
  const teamName = String(reg.teamName || '');
  const members = Array.isArray(reg.members) ? reg.members.filter(Boolean) : [];
  const fee = fmtFee(ev.fee);
  const regId = String(reg.id || '—');
  const dateLine = 'Friday, 27 November 2026 · 10:00 AM';
  const venue = 'Mar Augusthinose College, Ramapuram';
  const report = 'Report by 9:30 AM with a valid school ID';

  const teamLine = 'Team of ' + team + (teamName ? ' · ' + teamName : '');
  const memberLine = members.length ? members.join(', ') : '—';

  const label = (x, y, t) =>
    '<text x="' + x + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="20" letter-spacing="2" fill="#9b8ec4">' + escXml(t) + '</text>';
  const value = (x, y, t, size) =>
    '<text x="' + x + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="' + (size || 30) + '" font-weight="600" fill="#ffffff">' + escXml(t) + '</text>';

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
    + label(648, 452, 'DATE') + value(648, 488, dateLine)
    + label(648, 548, 'VENUE') + value(648, 584, venue)
    + '<line x1="48" y1="648" x2="1152" y2="648" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>'
    + '<text x="48" y="694" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="600" fill="#d4a853">' + escXml(report) + '</text>'
    + '<text x="1152" y="694" font-family="Arial,Helvetica,sans-serif" font-size="20" text-anchor="end" fill="#9b8ec4">spark.maraugusthinosecollege.org</text>'
    + '</svg>';
}

// ---------------------------------------------------------------------------
// Confirmation email (HTML + plain text). cardUrl is the absolute download
// link for the card (https://spark.maraugusthinosecollege.org/api/confirmation-card?id=...&download=1).
// The SVG is attached to the message with CID "confirmation-card" and shown
// inline via <img src="cid:confirmation-card">. (Gmail does not render SVG
// inline, so the email also carries the full details as HTML text and the
// download button — the card itself downloads as an image file.)
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
    + '<a href="' + escHtml(cardUrl) + '" style="display:inline-block;background:#d4a853;color:#1a0b2e;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:999px;">Download confirmation</a>'
    + '</div>'
    + '<p style="text-align:center;color:#9b8ec4;font-size:13px;line-height:1.6;margin-top:20px;">Your confirmation card is attached to this email.<br>Questions? Ananthu Anil 7510142466 &middot; Bista Mariya Jojo 9746446739<br>SPARK 2K26 &middot; NEXUS &middot; Mar Augusthinose College, Ramapuram</p>'
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
