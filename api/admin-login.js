// POST /api/admin-login — verify password, return role token
// Lockout: 5 wrong passwords from one IP → 15 minutes blocked (429).
// The counter lives in Redis; a Redis failure never blocks a real login.
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { Redis } from '@upstash/redis';
import { appendLog, recentEntries, clientInfo } from './activity-log.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SECRET = process.env.ADMIN_SECRET || '';
// SECURITY: no fallback secret. If ADMIN_SECRET is unset, verify() refuses
// every token and the login handler answers 500 — a publicly-known default
// secret would let anyone forge a write token (the repo is public).
const LOCK_AFTER = 5;     // wrong attempts
const LOCK_WINDOW = 900;  // 15 minutes

function sign(role) {
  const exp = Date.now() + 12 * 3600 * 1000; // 12 hours
  const payload = role + '.' + exp;
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  return payload + '.' + sig;
}

export function verify(token) {
  if (!token || !SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (!['read', 'write', 'lead'].includes(role)) return null;
  if (!/^\d+$/.test(exp)) return null; // non-numeric expiry must not pass
  if (Date.now() > parseInt(exp, 10)) return null;
  const expected = createHmac('sha256', SECRET).update(role + '.' + exp).digest('hex').slice(0, 32);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return role;
}

// Tech Lead can do everything write can, plus delete. Read cannot write.
export function canWrite(role) { return role === 'write' || role === 'lead'; }

// Parse a value read from Redis. The Upstash client auto-parses JSON strings
// into objects, so a stored record may come back as an object already —
// calling JSON.parse on an object throws, which emptied every list.
// --- Registration helpers shared by register.js, registrations.js, activity-log.js ---
// Phone normalisation: strip +91 / leading 0, keep 10 digits.
export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return d;
}
export function validPhone(p) { return /^[6-9]\d{9}$/.test(String(p || '')); }

// Uniqueness markers: SET NX claims so two concurrent submissions with the
// same phone/email for the same event cannot both write (the hgetall scan in
// register.js is the backstop for rows created before markers existed).
export function regMarkerKeys(slug, phoneNorm, emailNorm) {
  return {
    phone: phoneNorm ? 'celesta:reg:phone:' + slug + ':' + phoneNorm : null,
    email: emailNorm ? 'celesta:reg:email:' + slug + ':' + String(emailNorm).trim().toLowerCase() : null,
  };
}
export const MARKER_TTL = 7 * 24 * 3600; // 7 days: bounds damage from a stale marker

export function parseVal(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { password, verifyWrite, verifyLead } = req.body || {};
  const readPw = process.env.ADMIN_READ_PW;
  const writePw = process.env.ADMIN_WRITE_PW;
  const feesPw = process.env.FEES_PW;
  const leadPw = process.env.TECH_LEAD_PW;

  if (!readPw || !writePw || !process.env.ADMIN_SECRET) {
    console.error('admin-login config missing: ADMIN_READ_PW/ADMIN_WRITE_PW/ADMIN_SECRET not set');
    return res.status(500).json({ error: 'Admin passwords not configured in Vercel env vars' });
  }

  const info = clientInfo(req);
  const failKey = 'celesta:loginfail:' + (info.ip || 'unknown');
  // No pre-check GET here: a check-then-act read lets concurrent bursts all
  // see < LOCK_AFTER before any increment. The lockout is enforced below,
  // atomically, by INCR-ing on each failed password and checking the
  // returned count. A correct password still logs in (and clears the key)
  // even inside the window, so a shared venue IP is not locked out for
  // everyone by one person's wrong guesses.

  // Constant-time compare: hash both sides with SHA-256 (always 32 bytes,
  // so timingSafeEqual never throws on length) instead of ===, which
  // short-circuits on the first differing character.
  const pwHash = typeof password === 'string' ? createHash('sha256').update(password).digest() : null;
  const writeHash = createHash('sha256').update(writePw).digest();
  const readHash = createHash('sha256').update(readPw).digest();
  const feesHash = feesPw ? createHash('sha256').update(feesPw).digest() : null;
  const leadHash = leadPw ? createHash('sha256').update(leadPw).digest() : null;
  // verifyLead mode: re-confirm the TECH LEAD password before a delete
  // (registration or event). Only the Tech Lead password passes — the
  // admin write, fees and read-only passwords do NOT. A wrong password
  // falls through to the normal lockout counting below.
  if (verifyLead) {
    if (leadHash && pwHash && timingSafeEqual(pwHash, leadHash)) {
      try { await redis.del(failKey); } catch { /* ignore */ }
      await appendLog({ type: 'login', actor: 'lead', action: 'Tech Lead password re-confirmed for a delete' }, req);
      return res.status(200).json({ ok: true, role: 'lead' });
    }
  }
  // verifyWrite mode: re-confirm the ADMIN write password before a
  // sensitive action (event delete, mark invalid/valid). Only the true
  // admin write password passes — the fees counter password and the
  // read-only password do NOT. A wrong password falls through to the
  // normal lockout counting below.
  if (verifyWrite) {
    if (pwHash && timingSafeEqual(pwHash, writeHash)) {
      try { await redis.del(failKey); } catch { /* ignore */ }
      await appendLog({ type: 'login', actor: 'write', action: 'Admin password re-confirmed for a sensitive action' }, req);
      return res.status(200).json({ ok: true, role: 'write' });
    }
  } else if (pwHash && timingSafeEqual(pwHash, writeHash)) {
    try { await redis.del(failKey); } catch { /* ignore */ }
    await appendLog({ type: 'login', actor: 'write', action: 'Full-access admin logged in' }, req);
    return res.status(200).json({ ok: true, role: 'write', token: sign('write') });
  }
  // Tech Lead: the only role that can delete. Full powerful mode — can do
  // everything write can, plus delete registrations and events. Only the
  // Technical Lead (RayZer) has this password. Never accepted in
  // verifyWrite mode (that mode is for the admin write password only).
  if (!verifyWrite && !verifyLead && leadHash && pwHash && timingSafeEqual(pwHash, leadHash)) {
    try { await redis.del(failKey); } catch { /* ignore */ }
    await appendLog({ type: 'login', actor: 'lead', action: 'Tech Lead logged in' }, req);
    return res.status(200).json({ ok: true, role: 'lead', token: sign('lead') });
  }
  // Fees counter password: same full access as the admin write password,
  // so the counters can mark payments in /fees. The admin login still
  // works for /fees too. Only share this password with trusted counters.
  // Never accepted in verifyWrite mode (re-auth for sensitive actions).
  if (!verifyWrite && !verifyLead && feesHash && pwHash && timingSafeEqual(pwHash, feesHash)) {
    try { await redis.del(failKey); } catch { /* ignore */ }
    await appendLog({ type: 'login', actor: 'write', action: 'Fees counter logged in' }, req);
    return res.status(200).json({ ok: true, role: 'write', token: sign('write') });
  }
  if (!verifyWrite && !verifyLead && pwHash && timingSafeEqual(pwHash, readHash)) {
    try { await redis.del(failKey); } catch { /* ignore */ }
    await appendLog({ type: 'login', actor: 'read', action: 'Read-only admin logged in' }, req);
    return res.status(200).json({ ok: true, role: 'read', token: sign('read') });
  }
  // Wrong password: INCR FIRST (atomic), then check the returned count.
  // The increment is the enforcement, so concurrent bursts cannot all
  // slip under the threshold. n > LOCK_AFTER (i.e. the 6th wrong attempt
  // in the window) is a 429; earlier failures are a 401.
  let failCount = 0;
  try {
    failCount = await redis.incr(failKey);
    if (failCount === 1) {
      try { await redis.expire(failKey, LOCK_WINDOW); }
      catch { try { await redis.del(failKey); } catch {} } // never leave a key with no TTL
    }
  } catch { /* ignore — Redis failure never blocks a real login */ }
  if (failCount > LOCK_AFTER) {
    return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  }
  // Log failed attempts, but at most one per IP every 5 minutes so a flood
  // of wrong passwords can't flush real entries out of the capped log.
  try {
    const recent = await recentEntries(5);
    const lastFail = recent.find(e => e.type === 'login' && e.actor === 'failed' && e.ip === info.ip);
    if (!lastFail || Date.now() - Date.parse(lastFail.at) > 5 * 60 * 1000) {
      await appendLog({ type: 'login', actor: 'failed', action: 'Failed login attempt' }, req);
    }
  } catch { /* login still fails the same way */ }
  return res.status(401).json({ error: 'Wrong password' });
}
