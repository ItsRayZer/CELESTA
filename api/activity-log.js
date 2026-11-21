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
import { verify, parseVal, regMarkerKeys, normPhone, MARKER_TTL } from './admin-login.js';

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
  // Trust only what the platform sets: x-real-ip, else the LAST X-Forwarded-For
  // entry (Vercel appends the real client IP; the first entry is spoofable).
  const real = String(h['x-real-ip'] || '').trim();
  const xff = String(h['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  const ip = real || (xff.length ? xff[xff.length - 1] : null);
  const ua = String(h['user-agent'] || '') || null;
  const country = h['x-vercel-ip-country'] ? String(h['x-vercel-ip-country']) : null;
  const city = dec(h['x-vercel-ip-city']);
  const fp = h['x-device-fp'] ? String(h['x-device-fp']).slice(0, 32) : null;
  const fpjs = h['x-device-fpjs'] ? String(h['x-device-fpjs']).slice(0, 32) : null;
  // Client-asserted fields are capped like ua/fp: a hostile client must not be
  // able to grow log entries without bound.
  const cap = (v, n) => { const d = dec(v); return d ? d.slice(0, n) : null; };
  const model = cap(h['x-device-model'], 200);
  const gpu = cap(h['x-device-gpu'], 200);
  const info = cap(h['x-device-info'], 500);
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
      action: String(entry.action || '').slice(0, 200),
      detail: String(entry.detail || '').slice(0, 1000),
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
      const curMk = regMarkerKeys(rec.eventSlug || rec.event, normPhone(rec.phone), rec.email);
      const restored = { ...rec, ...(u.before || {}) };
      const newMk = regMarkerKeys(restored.eventSlug || restored.event, normPhone(restored.phone), restored.email);
      // Claim the restored markers BEFORE saving: if another record took that
      // phone/email, refuse the undo. A marker already pointing at this
      // record is our own, not a conflict.
      try {
        const claimed = [];
        for (const key of [newMk.phone, newMk.email]) {
          if (!key) continue;
          const ok = await redis.set(key, u.id, { nx: true, ex: MARKER_TTL });
          if (ok) claimed.push(key);
          else {
            const owner = await redis.get(key);
            if (owner !== u.id) {
              for (const k of claimed) { try { await redis.del(k); } catch {} }
              return { ok: false, error: 'That phone/email is now registered to someone else — undo blocked' };
            }
          }
        }
      } catch { /* markers are a backstop; continue */ }
      await redis.hset('celesta:regs', { [u.id]: JSON.stringify(restored) });
      try {
        if (curMk.phone && curMk.phone !== newMk.phone) await redis.del(curMk.phone);
        if (curMk.email && curMk.email !== newMk.email) await redis.del(curMk.email);
      } catch { /* markers are a backstop */ }
      return { ok: true, message: 'Registration restored to its previous values' };
    }
    if (u.kind === 'reg-add') {
      const rec = u.record;
      if (!rec || !rec.id) return { ok: false, error: 'Nothing to restore' };
      const exists = await redis.hget('celesta:regs', rec.id);
      if (exists) return { ok: false, error: 'Registration already exists' };
      // Claim the markers BEFORE restoring: if another record took that
      // phone/email, refuse the undo.
      const mk = regMarkerKeys(rec.eventSlug || rec.event, normPhone(rec.phone), rec.email);
      try {
        const claimed = [];
        for (const key of [mk.phone, mk.email]) {
          if (!key) continue;
          const ok = await redis.set(key, rec.id, { nx: true, ex: MARKER_TTL });
          if (ok) claimed.push(key);
          else {
            const owner = await redis.get(key);
            if (owner !== rec.id) {
              for (const k of claimed) { try { await redis.del(k); } catch {} }
              return { ok: false, error: 'That phone/email is now registered to someone else — undo blocked' };
            }
          }
        }
      } catch { /* markers are a backstop; continue */ }
      await redis.hset('celesta:regs', { [rec.id]: JSON.stringify(rec) });
      await redis.zadd('celesta:reglist', { score: Date.parse(rec.at) || Date.now(), member: rec.id });
      return { ok: true, message: 'Registration restored' };
    }
    if (u.kind === 'event-delete') {
      const ev = parseVal(await redis.hget('celesta:events', u.slug));
      if (!ev) return { ok: false, error: 'Event no longer exists' };
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
      if (!u.event || !u.event.slug) return { ok: false, error: 'Nothing to restore' };
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
      if (!u.record || !u.record.id) return { ok: false, error: 'Nothing to restore' };
      const exists = await redis.hget('celesta:coordinators', u.record.id);
      if (exists) return { ok: false, error: 'Coordinator already exists' };
      await redis.hset('celesta:coordinators', { [u.record.id]: JSON.stringify(u.record) });
      return { ok: true, message: 'Coordinator restored' };
    }
    if (u.kind === 'coord-update') {
      if (!u.record || !u.record.id) return { ok: false, error: 'Nothing to restore' };
      await redis.hset('celesta:coordinators', { [u.record.id]: JSON.stringify(u.record) });
      return { ok: true, message: 'Coordinator restored to its previous values' };
    }
    if (u.kind === 'poster-restore') {
      let prev = u.prev || null; // legacy entries carried the poster inline
      if (!prev && u.prevKey) {
        prev = await redis.get('celesta:poster-prev:' + u.prevKey) || null;
      }
      if (prev) await redis.hset('celesta:posters', { [u.slug]: prev });
      else await redis.hdel('celesta:posters', u.slug);
      if (u.prevKey) { try { await redis.del('celesta:poster-prev:' + u.prevKey); } catch {} }
      return { ok: true, message: prev ? 'Previous poster restored' : 'Poster reset to the original' };
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
