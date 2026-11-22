// GET    /api/coordinators — public list (the contact page reads this; falls back to built-in list if storage is down)
// POST   /api/coordinators — add or update a coordinator (write role only). Body: { id?, name, team, event?, cls?, phone? }
// DELETE /api/coordinators?id=... — remove a coordinator (write role only).
import { Redis } from '@upstash/redis';
import { verify, parseVal, normPhone, validPhone } from './admin-login.js';
import { appendLog } from './activity-log.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Seed data: the team lists RayZer shared (16 Nov 2026). Phones are empty until added from the admin.
const DEFAULTS = [
  { id: 'ev-1', name: 'Sree Lakshmi', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'ev-2', name: 'Anaswara G Nair', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'ev-3', name: 'Alfiya Siraj', team: 'Event Coordinators', event: '', cls: '', phone: '' },
  { id: 'de-1', name: 'Midhun R Nair', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-2', name: 'Ann Maria Sunnil', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-3', name: 'Aswin R Nair', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'de-4', name: 'Deleena Tomy', team: 'Decoration Team', event: '', cls: '', phone: '' },
  { id: 'te-1', name: 'Aben Sojan', team: 'Technical Team', event: '', cls: '', phone: '' },
  { id: 'me-1', name: 'Alan Lal', team: 'Media Team', event: '', cls: '', phone: '' },
  { id: 'me-2', name: 'Thomas Augustin', team: 'Media Team', event: '', cls: '', phone: '' },
  { id: 'ma-1', name: 'Alphons Binoy', team: 'Marketing Team', event: '', cls: '', phone: '' },
  { id: 'ma-2', name: 'Simona Jaimon', team: 'Marketing Team', event: '', cls: '', phone: '' },
  { id: 'fi-1', name: 'Leon Mathew Tony', team: 'Finance Team', event: '', cls: '', phone: '' },
  { id: 'ex-1', name: 'Aby Bijo', team: 'Exhibition Team', event: '', cls: '', phone: '' },
  { id: 'og-1', name: 'Basil Shiju', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'og-2', name: 'Midhun R Nair', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'og-3', name: 'Alphons Binoy', team: 'Open Games', event: '', cls: '', phone: '' },
  { id: 'sc-1', name: 'Aleena Joseph', team: 'Student Coordinators', event: 'Quiz', cls: '3rd BCA A', phone: '7306704199' },
  { id: 'sc-2', name: 'Niya Raj Thomas', team: 'Student Coordinators', event: 'Quiz', cls: '3rd BCA B', phone: '' },
  { id: 'sc-3', name: 'Abhinav Babu', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '3rd BCA A', phone: '8590792481' },
  { id: 'sc-4', name: 'Ashwin PS', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '', phone: '9778249397' },
  { id: 'sc-5', name: 'Adithya Rajagopal', team: 'Student Coordinators', event: 'Prompting', cls: '3rd BCA A', phone: '7902604501' },
  { id: 'sc-8', name: 'Agnivesh Santhosh', team: 'Student Coordinators', event: 'Reels Competition', cls: '3rd BCA A', phone: '7012745327' },
  { id: 'sc-9', name: 'Daniel Paul Jacob', team: 'Student Coordinators', event: 'Reels Competition', cls: '3rd BCA A', phone: '8848929570' },
];

async function ensureSeeded() {
  const n = await redis.hlen('celesta:coordinators');
  if (n === 0) {
    const obj = {};
    DEFAULTS.forEach(c => { obj[c.id] = JSON.stringify(c); });
    await redis.hset('celesta:coordinators', obj);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Coordinators change rarely; the contact and register pages fetch this
    // on every load. Public variant gets a shared cache so the CDN serves
    // most hits without touching Redis; an admin (token) always gets fresh
    // data after an edit, so it is never shared-cached.
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const role = token ? verify(token) : null;
    if (role) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    }
    res.setHeader('Vary', 'Authorization');
    try {
      await ensureSeeded();
      const vals = await redis.hvals('celesta:coordinators');
      let list = (vals || []).map(v => parseVal(v)).filter(Boolean);
      // One-time cleanup: drop the student coordinators of the event the
      // NEXUS leader removed (18 Nov 2026). After the first run they are gone,
      // so this never writes again. (Reels Competition was restored 19 Nov 2026,
      // so its coordinators sc-8/sc-9 are no longer removed.)
      const REMOVED_COORDS = new Set(['sc-6', 'sc-7']);
      const stale = list.filter(c => REMOVED_COORDS.has(c.id));
      if (stale.length) {
        await redis.hdel('celesta:coordinators', ...stale.map(c => c.id));
        list = list.filter(c => !REMOVED_COORDS.has(c.id));
      }
      // Restore: Reels Competition is back (19 Nov 2026), so put its two
      // student coordinators back into the stored list if they were removed.
      const RESTORED_COORDS = DEFAULTS.filter(c => c.id === 'sc-8' || c.id === 'sc-9');
      const missing = RESTORED_COORDS.filter(c => !list.some(x => x.id === c.id));
      if (missing.length) {
        const obj = {};
        missing.forEach(c => { obj[c.id] = JSON.stringify(c); });
        await redis.hset('celesta:coordinators', obj);
        list = list.concat(missing);
      }
      // Phones added 19 Nov 2026 (RayZer sent the numbers): fill them into
      // the stored records that still have no phone. Only empty phones are
      // touched, so an admin-set phone is never overwritten. Once filled,
      // this never writes again.
      const PHONE_FIXES = {
        'sc-1': '7306704199', 'sc-2': '9562133922', 'sc-3': '8590792481', 'sc-4': '9778249397', 'sc-5': '7902604501',
        'sc-8': '7012745327', 'sc-9': '8848929570',
      };
      const phoneMissing = list.filter(c => PHONE_FIXES[c.id] && !c.phone);
      if (phoneMissing.length) {
        const obj = {};
        phoneMissing.forEach(c => { obj[c.id] = JSON.stringify({ ...c, phone: PHONE_FIXES[c.id] }); });
        await redis.hset('celesta:coordinators', obj);
        list = list.map(c => (PHONE_FIXES[c.id] && !c.phone) ? { ...c, phone: PHONE_FIXES[c.id] } : c);
      }
      // Flag-gated one-time migration: NAME_FIXES / COORD_FIXES used to
      // re-apply whenever an admin deliberately renamed someone back to an
      // old value. They now run at most once, guarded by the stored flag
      // celesta:coord_migrated_v1, set after the first pass completes.
      let coordMigrated = false;
      try { coordMigrated = !!(await redis.get('celesta:coord_migrated_v1')); } catch { coordMigrated = false; }
      if (!coordMigrated) {
      // Treasure Hunt coordinator change (21 Nov 2026, official PDF is the
      // source of truth): Aadhil Kabeer is replaced by Ashwin PS (9778249397),
      // and Abhinavu Babu is spelled Abhinav Babu in the PDF. One-time: the
      // stored records are corrected in place; after this the names no longer
      // match the old values, so this never writes again.
      const COORD_FIXES = {
        'sc-3': { id: 'sc-3', name: 'Abhinav Babu', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '3rd BCA A', phone: '8590792481' },
        'sc-4': { id: 'sc-4', name: 'Ashwin PS', team: 'Student Coordinators', event: 'Treasure Hunt', cls: '', phone: '9778249397' },
      };
      const coordStale = list.filter(c => (c.id === 'sc-3' && c.name === 'Abhinavu Babu') || (c.id === 'sc-4' && c.name === 'Aadhil Kabeer'));
      if (coordStale.length) {
        const obj = {};
        coordStale.forEach(c => { obj[c.id] = JSON.stringify(COORD_FIXES[c.id]); });
        await redis.hset('celesta:coordinators', obj);
        list = list.map(c => (COORD_FIXES[c.id] && ((c.id === 'sc-3' && c.name === 'Abhinavu Babu') || (c.id === 'sc-4' && c.name === 'Aadhil Kabeer'))) ? COORD_FIXES[c.id] : c);
      }
      // Full official names (21 Nov 2026, NEXUS EXECOM posters + Sir's note):
      // first-name-only and nickname entries are corrected to their official
      // full names (Turbo is Leon Mathew Tony). One-time: the stored records
      // are corrected in place; after this the names no longer match the old
      // values, so this never writes again.
      const NAME_FIXES = {
        'ev-2': 'Anaswara G Nair', 'ev-3': 'Alfiya Siraj', 'de-1': 'Midhun R Nair',
        'de-2': 'Ann Maria Sunnil', 'de-3': 'Aswin R Nair', 'de-4': 'Deleena Tomy',
        'me-2': 'Thomas Augustin', 'fi-1': 'Leon Mathew Tony', 'og-2': 'Midhun R Nair',
        'sc-1': 'Aleena Joseph', 'sc-2': 'Niya Raj Thomas', 'sc-9': 'Daniel Paul Jacob',
      };
      const OLD_NAMES = {
        'ev-2': 'Anaswara', 'ev-3': 'Alfiya', 'de-1': 'Midhun', 'de-2': 'Ann Mariya',
        'de-3': 'Aswin', 'de-4': 'Deleena', 'me-2': 'Thomas', 'fi-1': 'Turbo',
        'og-2': 'Midhun', 'sc-1': 'Aleena', 'sc-2': 'Niya', 'sc-9': 'Daniel',
      };
      const nameStale = list.filter(c => NAME_FIXES[c.id] && c.name === OLD_NAMES[c.id]);
      if (nameStale.length) {
        const obj = {};
        nameStale.forEach(c => { obj[c.id] = JSON.stringify({ ...c, name: NAME_FIXES[c.id] }); });
        await redis.hset('celesta:coordinators', obj);
        list = list.map(c => (NAME_FIXES[c.id] && c.name === OLD_NAMES[c.id]) ? { ...c, name: NAME_FIXES[c.id] } : c);
      }
        // Set the flag only after the pass completes, so a failed hset
        // above (which throws to the outer catch) does not skip a needed
        // migration. A no-op pass also sets it: nothing was stale.
        await redis.set('celesta:coord_migrated_v1', '1');
      }
      return res.status(200).json({ coordinators: list });
    } catch (e) {
      return res.status(200).json({ coordinators: DEFAULTS });
    }
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (verify(token) !== 'write') return res.status(403).json({ error: 'Write access required' });

  if (req.method === 'POST') {
    const c = req.body || {};
    if (!c.name || !c.team) return res.status(400).json({ error: 'Name and team are required' });
    const id = c.id ? String(c.id).trim() : ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    if (!/^[A-Za-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid coordinator id' });
    // A coordinator phone, when given, must be a real 10-digit Indian
    // mobile: the contact page publishes it, so a typo becomes a wrong
    // number students call.
    const phoneNorm = String(c.phone || '').trim() ? normPhone(String(c.phone).trim()) : '';
    if (phoneNorm && !validPhone(phoneNorm)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    const rec = {
      id,
      name: String(c.name).trim().slice(0, 100),
      team: String(c.team).trim().slice(0, 100),
      event: String(c.event || '').trim().slice(0, 100),
      cls: String(c.cls || '').trim().slice(0, 100),
      phone: phoneNorm,
    };
    try {
      const old = parseVal(await redis.hget('celesta:coordinators', rec.id));
      await redis.hset('celesta:coordinators', { [rec.id]: JSON.stringify(rec) });
      await appendLog({
        actor: 'write', action: old ? 'Coordinator updated' : 'Coordinator added',
        detail: rec.name + ' (' + rec.team + (rec.event ? ' · ' + rec.event : '') + ')' + (old && old.phone !== rec.phone ? ': phone ' + (old.phone || '—') + ' → ' + (rec.phone || '—') : ''),
        target: { kind: 'coordinator', id: rec.id, name: rec.name },
        undo: old ? { kind: 'coord-update', record: old } : { kind: 'coord-delete', id: rec.id },
      }, req);
      return res.status(200).json({ ok: true, coordinator: rec });
    } catch (e) {
      console.error('coordinators handler failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const old = parseVal(await redis.hget('celesta:coordinators', id));
      await redis.hdel('celesta:coordinators', id);
      if (old) {
        await appendLog({
          actor: 'write', action: 'Coordinator removed',
          detail: old.name + ' (' + old.team + (old.event ? ' · ' + old.event : '') + ')',
          target: { kind: 'coordinator', id, name: old.name },
          undo: { kind: 'coord-add', record: old },
        }, req);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('coordinators handler failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
