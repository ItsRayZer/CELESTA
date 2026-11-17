// Activity log — append-only audit trail for the admin dashboard.
// GET  /api/activity-log — list entries, newest first (full-access admins only)
// POST /api/activity-log — undo a change entry (full-access only). Body: { id }
//   Undo is two clicks in the UI (Undo -> Confirm). The original entry is never
//   edited or deleted: the undo is itself a new entry that points at it.
// Entries are capped at 500 (oldest trimmed) — keeps the whole fest's
// history at ~250KB. Logging never throws and never
// breaks the action it records.
// What is captured: time, role, what changed, device type + browser (from the
// user-agent), IP address, and city/country (from Vercel's IP headers).
// Browsers never send a device name, SIM or drive details, so those can't be logged.
// What the admin page DOES send (no permission needed): a device fingerprint —
// model (Client Hints), GPU string (WebGL), canvas hash, screen, cores, memory,
// timezone — as X-Device-* headers. A fingerprint seen for the first time is
// flagged NEW DEVICE, so a change from an unfamiliar device stands out.
// Deliberately NOT fingerprinted: battery, network speed, WebGL extension list
// (Brave randomises it per session) — they change constantly and would fake new devices.
import { Redis } from '@upstash/redis';
import { verify, parseVal } from './admin-login.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'celesta:activity';
const MAX_ENTRIES = 500;

// Device type + browser, parsed from the user-agent. Best effort only.
function parseDevice(ua) {
  if (!ua) return 'Unknown device';
  let os = 'Unknown OS';
  if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  let br = 'Browser';
  if (/edg/i.test(ua)) br = 'Edge';
  else if (/opr|opera/i.test(ua)) br = 'Opera';
  else if (/chrome|crios/i.test(ua)) br = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) br = 'Firefox';
  else if (/safari/i.test(ua)) br = 'Safari';
  return os + ' · ' + br;
}

export function clientInfo(req) {
  const h = (req && req.headers) || {};
  const dec = (v) => { try { return v ? decodeURIComponent(String(v)) : null; } catch { return String(v); } };
  const xf = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xf || String(h['x-real-ip'] || '') || null;
  const ua = String(h['user-agent'] || '') || null;
  const country = h['x-vercel-ip-country'] ? String(h['x-vercel-ip-country']) : null;
  const city = h['x-vercel-ip-city'] ? decodeURIComponent(String(h['x-vercel-ip-city'])) : null;
  const fp = h['x-device-fp'] ? String(h['x-device-fp']).slice(0, 32) : null;
  const fpjs = h['x-device-fpjs'] ? String(h['x-device-fpjs']).slice(0, 32) : null;
  const model = dec(h['x-device-model']);
  const gpu = dec(h['x-device-gpu']);
  const info = dec(h['x-device-info']);
  return { ip, ua, country, city, device: parseDevice(ua), fp, fpjs, model, gpu, info };
}

// Append an entry. Never throws.
export async function appendLog(entry, req) {
  try {
    const info = clientInfo(req);
    const rec = {
      id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(),
      type: entry.type || 'change',
      actor: entry.actor || 'write',
      action: entry.action || '',
      detail: entry.detail || '',
      target: entry.target || null,
      undo: entry.undo || null,
      undoes: entry.undoes || null,
      ip: info.ip,
      country: info.country,
      city: info.city,
      device: info.device,
      ua: info.ua ? info.ua.slice(0, 200) : null,
      fp: info.fp || null,
      fpjs: info.fpjs || null,
      model: info.model || null,
      gpu: info.gpu || null,
      info: info.info || null,
      newDevice: false,
    };
    // NEW DEVICE only when NEITHER identifier was seen before: the local code
    // is the stable one, the FingerprintJS visitorId the richer one. If either
    // matches a known device, the device is known.
    if (info.fp || info.fpjs) {
      try {
        let known = false;
        if (info.fp) {
          const added = await redis.sadd('celesta:known-fps', info.fp);
          if (added === 0) known = true;
        }
        if (info.fpjs) {
          const added = await redis.sadd('celesta:known-fpjs', info.fpjs);
          if (added === 0) known = true;
        }
        rec.newDevice = !known;
      } catch { /* flag stays false */ }
    }
    await redis.lpush(KEY, JSON.stringify(rec));
    await redis.ltrim(KEY, 0, MAX_ENTRIES - 1);
    return rec;
  } catch { return null; }
}

export async function recentEntries(n) {
  try {
    const raw = await redis.lrange(KEY, 0, (n || 20) - 1);
    return (raw || []).map(v => parseVal(v)).filter(Boolean);
  } catch { return []; }
}

// Apply the inverse of a logged change. Returns { ok, message }.
async function applyUndo(u) {
  try {
    if (u.kind === 'reg-update') {
      const rec = parseVal(await redis.hget('celesta:regs', u.id));
      if (!rec) return { ok: false, error: 'Registration no longer exists' };
      Object.assign(rec, u.before || {});
      await redis.hset('celesta:regs', { [u.id]: JSON.stringify(rec) });
      return { ok: true, message: 'Registration restored to its previous values' };
    }
    if (u.kind === 'reg-add') {
      const rec = u.record;
      const exists = await redis.hget('celesta:regs', rec.id);
      if (exists) return { ok: false, error: 'Registration already exists' };
      await redis.hset('celesta:regs', { [rec.id]: JSON.stringify(rec) });
      await redis.zadd('celesta:reglist', { score: Date.parse(rec.at) || Date.now(), member: rec.id });
      return { ok: true, message: 'Registration restored' };
    }
    if (u.kind === 'event-delete') {
      const ev = parseVal(await redis.hget('celesta:events', u.slug));
      if (ev) return { ok: false, error: 'Event already exists' };
      const regVals = await redis.hvals('celesta:regs');
      const n = (regVals || []).filter(v => {
        const r = parseVal(v);
        return r && (r.eventSlug === u.slug || r.event === u.name);
      }).length;
      if (n > 0) return { ok: false, error: 'Event has ' + n + ' registration(s) now — hide it instead' };
      await redis.hdel('celesta:events', u.slug);
      await redis.hdel('celesta:posters', u.slug);
      return { ok: true, message: 'Event removed' };
    }
    if (u.kind === 'event-update') {
      const ev = parseVal(await redis.hget('celesta:events', u.slug));
      if (!ev) return { ok: false, error: 'Event no longer exists' };
      const before = u.before || {};
      const curName = ev.name;
      await redis.hset('celesta:events', { [u.slug]: JSON.stringify(before) });
      // If the edit renamed the event, move registrations back to the old name.
      if (before.name && curName && before.name !== curName) {
        try {
          const regIds = await redis.zrange('celesta:reglist', 0, -1);
          if (regIds.length) {
            const vals = await redis.hmget('celesta:regs', ...regIds);
            const updates = {};
            vals.forEach((v, i) => {
              const r = parseVal(v);
              if (r && r.event === curName && (r.eventSlug === u.slug || !r.eventSlug)) {
                r.event = before.name;
                updates[regIds[i]] = JSON.stringify(r);
              }
            });
            if (Object.keys(updates).length) await redis.hset('celesta:regs', updates);
          }
        } catch { /* event restored; registrations keep the newer name */ }
      }
      return { ok: true, message: 'Event restored to its previous values' };
    }
    if (u.kind === 'event-add') {
      const exists = await redis.hget('celesta:events', u.event.slug);
      if (exists) return { ok: false, error: 'Event already exists' };
      await redis.hset('celesta:events', { [u.event.slug]: JSON.stringify(u.event) });
      return { ok: true, message: 'Event restored — its poster was not restored' };
    }
    if (u.kind === 'coord-delete') {
      await redis.hdel('celesta:coordinators', u.id);
      return { ok: true, message: 'Coordinator removed' };
    }
    if (u.kind === 'coord-add') {
      const exists = await redis.hget('celesta:coordinators', u.record.id);
      if (exists) return { ok: false, error: 'Coordinator already exists' };
      await redis.hset('celesta:coordinators', { [u.record.id]: JSON.stringify(u.record) });
      return { ok: true, message: 'Coordinator restored' };
    }
    if (u.kind === 'coord-update') {
      await redis.hset('celesta:coordinators', { [u.record.id]: JSON.stringify(u.record) });
      return { ok: true, message: 'Coordinator restored to its previous values' };
    }
    if (u.kind === 'poster-restore') {
      if (u.prev) await redis.hset('celesta:posters', { [u.slug]: u.prev });
      else await redis.hdel('celesta:posters', u.slug);
      return { ok: true, message: u.prev ? 'Previous poster restored' : 'Poster reset to the original' };
    }
    return { ok: false, error: 'Unknown undo type' };
  } catch {
    return { ok: false, error: 'Storage unavailable' };
  }
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (verify(token) !== 'write') return res.status(403).json({ error: 'Full-access admin only' });

  if (req.method === 'GET') {
    try {
      const entries = await recentEntries(MAX_ENTRIES);
      return res.status(200).json({ entries });
    } catch {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'POST') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const entries = await recentEntries(MAX_ENTRIES);
      const orig = entries.find(e => e.id === id);
      if (!orig || !orig.undo) return res.status(400).json({ error: 'Nothing to undo for this entry' });
      if (entries.some(e => e.type === 'undo' && e.undoes === id)) {
        return res.status(409).json({ error: 'Already undone' });
      }
      const r = await applyUndo(orig.undo);
      if (!r.ok) return res.status(400).json({ error: r.error });
      await appendLog({
        type: 'undo', actor: 'write',
        action: 'Undid: ' + orig.action, detail: orig.detail,
        target: orig.target, undoes: id,
      }, req);
      return res.status(200).json({ ok: true, message: r.message });
    } catch {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
