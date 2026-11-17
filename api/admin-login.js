// POST /api/admin-login — verify password, return role token
import { createHmac } from 'crypto';
import { appendLog, recentEntries, clientInfo } from './activity-log.js';

const SECRET = process.env.ADMIN_SECRET || 'celesta-admin-fallback-secret-change-me';

function sign(role) {
  const exp = Date.now() + 12 * 3600 * 1000; // 12 hours
  const payload = role + '.' + exp;
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  return payload + '.' + sig;
}

export function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (!['read', 'write'].includes(role)) return null;
  if (Date.now() > parseInt(exp, 10)) return null;
  const expected = createHmac('sha256', SECRET).update(role + '.' + exp).digest('hex').slice(0, 32);
  if (sig !== expected) return null;
  return role;
}

// Parse a value read from Redis. The Upstash client auto-parses JSON strings
// into objects, so a stored record may come back as an object already —
// calling JSON.parse on an object throws, which emptied every list.
export function parseVal(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { password } = req.body || {};
  const readPw = process.env.ADMIN_READ_PW;
  const writePw = process.env.ADMIN_WRITE_PW;
  
  if (!readPw || !writePw) {
    return res.status(500).json({ error: 'Admin passwords not configured in Vercel env vars' });
  }
  
  if (password === writePw) {
    await appendLog({ type: 'login', actor: 'write', action: 'Full-access admin logged in' }, req);
    return res.status(200).json({ ok: true, role: 'write', token: sign('write') });
  }
  if (password === readPw) {
    await appendLog({ type: 'login', actor: 'read', action: 'Read-only admin logged in' }, req);
    return res.status(200).json({ ok: true, role: 'read', token: sign('read') });
  }
  // Log failed attempts, but at most one per IP every 5 minutes so a flood
  // of wrong passwords can't flush real entries out of the capped log.
  try {
    const info = clientInfo(req);
    const recent = await recentEntries(5);
    const lastFail = recent.find(e => e.type === 'login' && e.actor === 'failed' && e.ip === info.ip);
    if (!lastFail || Date.now() - Date.parse(lastFail.at) > 5 * 60 * 1000) {
      await appendLog({ type: 'login', actor: 'failed', action: 'Failed login attempt' }, req);
    }
  } catch { /* login still fails the same way */ }
  return res.status(401).json({ error: 'Wrong password' });
}
