// GET /api/registrations — list all (read/write)
// PATCH /api/registrations — update payment status (write only)
import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
import { verify, canWrite, parseVal, normPhone, validPhone, regMarkerKeys, MARKER_TTL } from './admin-login.js';
import { appendLog } from './activity-log.js';
import { loadEvents } from './events.js';

const HISTORY_KEY = 'celesta:fees:history';
const HISTORY_CAP = 500;

// Same entry shape as api/fees.js pushHistory: {id, chest, event,
// eventSlug, name, amount, method, at, by}. Kept local (not imported from
// fees.js) to avoid a circular import.
async function pushHistory(entry) {
  await redis.lpush(HISTORY_KEY, JSON.stringify(entry));
  try { await redis.ltrim(HISTORY_KEY, 0, HISTORY_CAP - 1); } catch { /* cap is a nicety */ }
}

// Remove only the LIVE payment history for one registration (#9).
// A removal's audit entry (removed:true) is never a target, so a
// second removal cannot destroy the first removal's audit trail.
// Duplicates from a past race may differ in `at`, so match by id and
// remove each distinct stored string.
async function removeHistoryFor(id) {
  const raw = await redis.lrange(HISTORY_KEY, 0, HISTORY_CAP - 1);
  const targets = [...new Set((raw || []).filter(function (v) {
    const p = parseVal(v);
    return p && p.id === id && !p.removed;
  }))];
  for (const target of targets) await redis.lrem(HISTORY_KEY, 0, target);
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const role = verify(token);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    // Paginated: ?limit= (default 50, max 200) &offset= (default 0), newest first.
    // Totals are computed server-side so the admin stats stay right on any page.
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    try {
      const total = await redis.zcard('celesta:reglist');
      const ids = await redis.zrange('celesta:reglist', offset, offset + limit - 1, { rev: true });
      let regs = [];
      if (ids.length) {
        const vals = await redis.hmget('celesta:regs', ...ids);
        // Row order (#35): build the rows in the ids array's order,
        // never relying on hmget object key order. A stored value that
        // is null or unparseable is skipped; a row without an id is
        // never kept.
        regs = ids.map(function (id) { return parseVal(vals ? vals[id] : null); }).filter(function (r) { return r && r.id; });
      }
      // Totals: when this page already holds every registration (the normal
      // case — limit 200 covers the whole fest), total them from the rows we
      // just fetched instead of a second full-table read. Otherwise fall back
      // to the full scan so paged views stay exact. Saves 1 Redis command
      // on every admin list load.
      let paidCount = 0, paidAmount = 0;
      const byEvent = {};
      const tally = (list) => {
        for (const r of list) {
          if (!r) continue;
          const k = r.eventSlug || r.event;
          const b = byEvent[k] || (byEvent[k] = { n: 0, paid: 0, amount: 0 });
          b.n++;
          if (r.paid) { paidCount++; paidAmount += Number(r.amount || 0); b.paid++; b.amount += Number(r.amount || 0); }
        }
      };
      if (regs.length === total) {
        tally(regs);
      } else {
        try {
          const all = await redis.hgetall('celesta:regs');
          if (all) tally(Object.values(all).map(v => parseVal(v)));
        } catch { /* totals stay 0 on a read failure */ }
      }
      return res.status(200).json({ regs, role, total, paidCount, paidAmount, byEvent });
    } catch (e) {
      console.error('registrations GET failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'PATCH') {
    if (!canWrite(role)) return res.status(403).json({ error: 'Write access required' });
    const { id, paid, amount, invalid } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    // Paylock state lives outside the try so the finally can always
    // release it, even on a 500 (V3-m02). releasePaylock is idempotent.
    const lockKey = 'celesta:paylock:' + id;
    const lockVal = crypto.randomUUID();
    let locked = false, skipHistory = false;
    const releasePaylock = async () => {
      if (!locked) return;
      locked = false;
      try { await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end", [lockKey], [lockVal]); } catch { /* lock expires on its own */ }
    };
    try {
      const raw = await redis.hget('celesta:regs', id);
      let rec = parseVal(raw);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      // --- Validate the edit the same way /api/register validates a submit ---
      // (an admin typo must not write a negative amount, a bad phone, or a
      // team size the event doesn't allow).
      if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100000)) {
        return res.status(400).json({ error: 'Amount must be a number between ₹0 and ₹1,00,000' });
      }
      if (paid !== undefined && typeof paid !== 'boolean') {
        return res.status(400).json({ error: 'Paid must be true or false' });
      }
      if (invalid !== undefined && typeof invalid !== 'boolean') {
        return res.status(400).json({ error: 'Invalid must be true or false' });
      }
      const caps = { name: 100, school: 150, email: 254, teamName: 80 };
      for (const k of Object.keys(caps)) {
        if (typeof req.body[k] === 'string' && req.body[k].trim().length > caps[k]) {
          return res.status(400).json({ error: k + ' is too long' });
        }
      }
      if (typeof req.body.email === 'string' && req.body.email.trim()
          && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email.trim())) {
        return res.status(400).json({ error: 'Enter a valid email address' });
      }
      let newPhone = null;
      if (typeof req.body.phone === 'string') {
        newPhone = normPhone(req.body.phone);
        if (!validPhone(newPhone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
      }
      // The event's team limits (falls back to the record's own values if the
      // event was since deleted).
      let ev = null;
      try {
        const events = await loadEvents();
        ev = events.find(e => e.slug === rec.eventSlug || e.name === rec.event) || null;
      } catch { ev = null; }
      // Fail closed (#33): if the event record could not be loaded and
      // the team size is being changed, refuse rather than validating
      // against a made-up 1–20 range.
      if (!ev && req.body.team !== undefined) {
        return res.status(503).json({ error: 'Could not load event rules — try again' });
      }
      const teamMin = ev ? ev.teamMin : 1, teamMax = ev ? ev.teamMax : 20;
      if (req.body.team !== undefined && (!Number.isInteger(req.body.team) || req.body.team < teamMin || req.body.team > teamMax)) {
        return res.status(400).json({ error: 'Team size must be ' + teamMin + '–' + teamMax + ' for ' + (ev ? ev.name : rec.event) });
      }
      if (Array.isArray(req.body.members)) {
        // members exclude the leader: at most teamMax - 1 other names.
        if (req.body.members.length > teamMax - 1 || req.body.members.some(m => String(m).length > 100)) {
          return res.status(400).json({ error: 'Member names are too long or there are too many members' });
        }
      }
      // Duplicate phone/email on edit (same event, different registration).
      const newEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : null;
      if (newPhone || newEmail) {
        try {
          const all = await redis.hgetall('celesta:regs');
          if (all) for (const [k, v] of Object.entries(all)) {
            if (k === id) continue;
            const r = parseVal(v);
            // Invalid (void) registrations do not block an edit (#4):
            // their phone/email are free, so a re-registered student is
            // never stranded by a voided record.
            if (!r || r.invalid || (r.eventSlug !== rec.eventSlug && r.event !== rec.event)) continue;
            if (newPhone && normPhone(r.phone) === newPhone) {
              return res.status(409).json({ error: 'Already registered for this event' });
            }
            if (newEmail && r.email && String(r.email).trim().toLowerCase() === newEmail) {
              return res.status(409).json({ error: 'Already registered for this event' });
            }
          }
        } catch (e) {
          // Fail closed: a scan failure must not let an edit create a
          // duplicate phone/email (mirrors api/register.js).
          console.error('registrations duplicate scan failed', e);
          return res.status(503).json({ error: 'Please try again' });
        }
      }
      // A paid flip needs a payment method: without one the history entry
      // counts in neither cash nor gpay and the ledger understates.
      let flipMethod = null;
      if (paid === true && !rec.paid) {
        flipMethod = typeof req.body.paidMethod === 'string' ? req.body.paidMethod.trim() : '';
        if (flipMethod !== 'cash' && flipMethod !== 'gpay') {
          return res.status(400).json({ error: 'Payment method (cash/gpay) is required' });
        }
      }
      // Paylock (same as fees mark-paid): two admins flipping the same
      // record at once must not both push history. Only when the paid
      // state is changing. Best-effort, 10s TTL.
      const paidFlipping = typeof paid === 'boolean' && paid !== !!rec.paid;
      if (paidFlipping) {
        try {
          locked = !!(await redis.set(lockKey, lockVal, { nx: true, ex: 10 }));
        } catch { locked = false; }
        if (!locked) {
          // Contender holds the lock: re-read. If the flip already
          // happened, keep our other edits but do not push history again.
          const cur = parseVal(await redis.hget('celesta:regs', id));
          if (!cur) return res.status(404).json({ error: 'Not found' });
          if (!!cur.paid === paid) skipHistory = true;
          else return res.status(409).json({ error: 'already being processed, try again' });
          // Use the fresh record so our edits do not overwrite a
          // concurrent payment's method/amount/paidAt (V3-M5).
          rec = cur;
        } else {
          // Re-read under the lock: the record may have been flipped
          // between our first read and the lock.
          const fresh = parseVal(await redis.hget('celesta:regs', id));
          if (!fresh) { await releasePaylock(); return res.status(404).json({ error: 'Not found' }); }
          if (!!fresh.paid === paid) skipHistory = true;
          // Use the fresh record (same V3-M5 fix as the contention path).
          rec = fresh;
        }
      }
      // The undo snapshot must cover the payment fields too (#10), or an
      // undo of a paid flip cannot restore paidMethod/paidAt.
      const before = {};
      for (const k of ['paid', 'amount', 'invalid', 'name', 'school', 'phone', 'email', 'teamName', 'team', 'members', 'paidMethod', 'paidAt']) before[k] = rec[k];
      if (typeof paid === 'boolean') rec.paid = paid;
      if (typeof invalid === 'boolean') rec.invalid = invalid;
      if (flipMethod) rec.paidMethod = flipMethod;
      if (typeof amount === 'number') rec.amount = amount;
      // Paid flip (#10): stamp paidAt when a record becomes paid, and
      // clear the payment fields when it becomes unpaid, so a payment is
      // never half-recorded and an un-flip never leaves a stale method,
      // amount or paidAt behind.
      if (typeof paid === 'boolean') {
        if (paid && !before.paid) rec.paidAt = new Date().toISOString();
        if (!paid && before.paid) { rec.amount = 0; rec.paidMethod = ''; rec.paidAt = ''; }
      }
      // full edit: name, school, phone, email, team size, team name, members
      for (const k of ['name', 'school', 'phone', 'email', 'teamName']) {
        if (typeof req.body[k] === 'string') rec[k] = req.body[k].trim();
      }
      if (newPhone) rec.phone = newPhone;
      if (typeof req.body.team === 'number') rec.team = req.body.team;
      if (Array.isArray(req.body.members)) {
        // The admin edit modal sends member NAMES only. Keep each member's
        // stored phone/email when the name is unchanged, so an admin name
        // fix never silently wipes a member's contact details. A renamed
        // member is a different person, so it starts with no phone/email.
        const byName = new Map();
        if (Array.isArray(rec.members)) for (const m of rec.members) {
          const nm = typeof m === 'string' ? m.trim() : (m && m.name ? String(m.name).trim() : '');
          if (nm && !byName.has(nm)) byName.set(nm, m);
        }
        rec.members = req.body.members.map(function (s) {
          const nm = String(s).trim();
          const old = byName.get(nm);
          if (old && typeof old === 'object') return { name: nm, phone: old.phone || '', email: old.email || '' };
          return { name: nm, phone: '', email: '' };
        });
      }
      // Keep the uniqueness markers in step with an edited phone/email.
      // Claim the new markers FIRST: if either is taken, refuse before the
      // record is saved (and before the old markers are dropped). A marker
      // already pointing at this record is our own (that field didn't
      // change), not a conflict.
      let oldMk = null, mk = null;
      if (newPhone || newEmail) {
        oldMk = regMarkerKeys(rec.eventSlug || rec.event, normPhone(before.phone), before.email);
        mk = regMarkerKeys(rec.eventSlug || rec.event, normPhone(rec.phone), rec.email);
        try {
          const claimedNew = [];
          let ok = true;
          for (const key of [mk.phone, mk.email]) {
            if (!key) continue;
            const r = await redis.set(key, id, { nx: true, ex: MARKER_TTL });
            if (r) { claimedNew.push(key); continue; }
            const owner = await redis.get(key);
            if (owner === id) continue;
            ok = false; break;
          }
          if (!ok) {
            for (const k of claimedNew) { try { await redis.del(k); } catch {} }
            await releasePaylock();
            return res.status(409).json({ error: 'This phone/email is already registered for ' + rec.event });
          }
        } catch (e) {
          // Fail closed (#33): a marker-store failure must not let an
          // edit create a duplicate phone/email. The record is not saved.
          console.error('registrations marker claim failed', e);
          await releasePaylock();
          return res.status(503).json({ error: 'Please try again' });
        }
      }
      await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
      // Drop the old markers only AFTER the save succeeded: a failed save
      // must never leave the old phone/email unprotected, and a successful
      // save must never leave the new phone/email blocked by an orphan.
      if (oldMk && mk) {
        try {
          if (oldMk.phone && oldMk.phone !== mk.phone) await redis.del(oldMk.phone);
          if (oldMk.email && oldMk.email !== mk.email) await redis.del(oldMk.email);
        } catch { /* markers are a backstop */ }
      }
      // Mirror the payment history (the same source api/fees.js reads for
      // cash/gpay): a paid flip or an amount change here must move the
      // history with it, or funds and history diverge. A history failure
      // must not fail the PATCH — the record is already saved.
      try {
        const wasPaid = !!before.paid, isPaid = !!rec.paid;
        if (!skipHistory && !wasPaid && isPaid) {
          await pushHistory({
            id: rec.id, chest: rec.chest || '', event: rec.event, eventSlug: rec.eventSlug,
            name: rec.name, amount: Number(rec.amount || 0), method: rec.paidMethod || '',
            at: rec.paidAt || new Date().toISOString(), by: 'admin',
          });
        } else if (wasPaid && !isPaid) {
          // Un-pay (#11): remove the live payment entry AND leave a
          // REMOVED audit row, so the History tab shows it as removed
          // instead of the payment vanishing without a trace. The audit
          // row keeps the original amount/method, and the record's
          // cleared fields are already saved above.
          await removeHistoryFor(id);
          await pushHistory({
            id: rec.id, chest: rec.chest || '', event: rec.event, eventSlug: rec.eventSlug,
            name: rec.name, phone: rec.phone || '', amount: Number(before.amount || 0),
            method: before.paidMethod || '', at: before.paidAt || new Date().toISOString(),
            removed: true, removedAt: new Date().toISOString(), by: 'admin',
          });
        } else if (wasPaid && isPaid && typeof amount === 'number' && amount !== before.amount) {
          // Amount changed on a still-paid record: rewrite its history
          // entry with the new amount, keeping the original method/at.
          let prev = null;
          try {
            const rawHist = await redis.lrange(HISTORY_KEY, 0, HISTORY_CAP - 1);
            for (const v of rawHist || []) {
              const p = parseVal(v);
              if (p && p.id === id) { prev = p; break; }
            }
          } catch { /* fall back to the record's own payment fields */ }
          await removeHistoryFor(id);
          await pushHistory({
            id: rec.id, chest: rec.chest || '', event: rec.event, eventSlug: rec.eventSlug,
            name: rec.name, amount: Number(rec.amount || 0),
            method: (prev && prev.method) || rec.paidMethod || '',
            at: (prev && prev.at) || rec.paidAt || new Date().toISOString(), by: 'admin',
          });
        }
      } catch (e) {
        console.error('registrations history mirror failed', e);
      }
      await releasePaylock();
      // Log only what actually changed, with the old values for undo.
      const changed = {};
      const bits = [];
      const show = (v) => Array.isArray(v) ? v.join(', ') : String(v);
      for (const k of Object.keys(before)) {
        if (JSON.stringify(before[k]) !== JSON.stringify(rec[k])) {
          changed[k] = before[k];
          bits.push(k === 'paid' ? 'paid ' + (before[k] ? 'yes' : 'no') + ' → ' + (rec[k] ? 'yes' : 'no')
            : k === 'amount' ? 'amount ₹' + (before[k] || 0) + ' → ₹' + (rec[k] || 0)
            : k === 'invalid' ? 'invalid ' + (before[k] ? 'yes' : 'no') + ' → ' + (rec[k] ? 'yes' : 'no')
            : k + ' ' + show(before[k]) + ' → ' + show(rec[k]));
        }
      }
      if (bits.length) {
        await appendLog({
          actor: role, action: 'Registration updated',
          detail: rec.event + ' — ' + rec.name + ': ' + bits.join(', '),
          target: { kind: 'registration', id, name: rec.name },
          undo: { kind: 'reg-update', id, before: changed },
        }, req);
      }
      return res.status(200).json({ ok: true, reg: rec });
    } catch (e) {
      console.error('registrations PATCH failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    } finally {
      // Always release the paylock, even on a 500 (V3-m02), so the next
      // retry does not 409 for up to 10 s.
      await releasePaylock();
    }
  }

  if (req.method === 'DELETE') {
    if (role !== 'lead') return res.status(403).json({ error: 'Tech Lead access required' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    // Paylock (#13): a concurrent PATCH/mark-paid on the same record
    // must not resurrect it after this delete. Take the lock, re-check
    // existence under it, then delete.
    const lockKey = 'celesta:paylock:' + id;
    const lockVal = crypto.randomUUID();
    let locked = false;
    try {
      const got = await redis.set(lockKey, lockVal, { nx: true, ex: 10 });
      locked = !!got;
      if (!locked) return res.status(409).json({ error: 'already being processed, try again' });
      const rec = parseVal(await redis.hget('celesta:regs', id));
      // 404 when the id does not exist (#13): silently succeeding would
      // let the admin believe a record was deleted when nothing was.
      if (!rec) return res.status(404).json({ error: 'Registration not found' });
      await redis.hdel('celesta:regs', id);
      await redis.zrem('celesta:reglist', id);
      try {
        const mk = regMarkerKeys(rec.eventSlug || rec.event, normPhone(rec.phone), rec.email);
        if (mk.phone) await redis.del(mk.phone);
        if (mk.email) await redis.del(mk.email);
      } catch { /* markers expire on their own; the record is already gone */ }
      // A deleted paid registration must not leave its money in history.
      if (rec.paid) {
        try { await removeHistoryFor(id); }
        catch (e) { console.error('registrations history removal failed', e); }
      }
      // Undo keeps the FULL record (phone, email, member contacts
      // included) so a mistaken delete can be fully restored. The
      // delete removes it from the live list; the copy lives only in
      // the secure admin undo log (see privacy.html §5).
      await appendLog({
        type: 'delete',
        actor: 'lead', action: 'Registration deleted',
        detail: rec.event + ' — ' + rec.name + ' (Team ' + (rec.team || '?') + ')',
        target: { kind: 'registration', id, name: rec.name },
        undo: { kind: 'reg-deleted', id, record: rec },
      }, req);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('registrations DELETE failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    } finally {
      if (locked) {
        try { await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end", [lockKey], [lockVal]); } catch { /* lock expires on its own */ }
      }
    }
  }

  if (req.method === 'POST') {
    if (!canWrite(role)) return res.status(403).json({ error: 'Write access required' });
    const { action, dryRun } = req.body || {};
    if (action !== 'backfill-chest') return res.status(400).json({ error: 'Unknown action' });
    // Backfill chest numbers for registrations that have none. Some
    // registrations were stored without a chest when the INCR at
    // registration time failed (the record still went through, and the
    // fees app only assigns a chest on mark-paid). This gives them a
    // chest NOW, in registration-time order per event, continuing the
    // existing per-event sequence (never renumbers anyone who already
    // has a chest, never reuses a number, never deletes anything).
    const CHEST_CODES = { 'prompting': '01', 'quiz': '02', 'treasure-hunt': '03', 'reels-competition': '04' };
    // Cross-tab lock (#28): two admins backfilling at once must not
    // hand out duplicate chest numbers from the same INCR sequence.
    const lockKey = 'celesta:backfill-lock';
    const lockVal = crypto.randomUUID();
    let locked = false;
    try {
      const got = await redis.set(lockKey, lockVal, { nx: true, ex: 60 });
      locked = !!got;
      if (!locked) return res.status(409).json({ error: 'A chest backfill is already running' });
      const all = await redis.hgetall('celesta:regs');
      // Counter guard (#28): if a counter was ever reset or lags behind
      // the highest chest already handed out, fast-forward it first, so
      // the INCR below never reissues a number that already exists.
      const maxSeq = {};
      if (all) for (const v of Object.values(all)) {
        const r = parseVal(v);
        if (r && r.chest) {
          const m = String(r.chest).match(/^(\d{2})(\d{3})$/);
          if (m) {
            const slug = Object.keys(CHEST_CODES).find(function (s) { return CHEST_CODES[s] === m[1]; });
            if (slug) maxSeq[slug] = Math.max(maxSeq[slug] || 0, parseInt(m[2], 10));
          }
        }
      }
      for (const slug of Object.keys(maxSeq)) {
        try {
          const cur = Number(await redis.get('celesta:chestseq:' + slug) || 0);
          if (maxSeq[slug] > cur) await redis.set('celesta:chestseq:' + slug, maxSeq[slug]);
        } catch (e) { console.error('registrations backfill counter guard failed', e); }
      }
      const missing = [];
      if (all) for (const [k, v] of Object.entries(all)) {
        const r = parseVal(v);
        if (r && !r.chest) missing.push(r);
      }
      // Earliest registrant first, per event.
      missing.sort(function (a, b) { return new Date(a.at || 0) - new Date(b.at || 0); });
      const assigned = [];
      for (const r of missing) {
        const slug = r.eventSlug || '';
        const code = CHEST_CODES[slug] || '00';
        if (dryRun) {
          assigned.push({ id: r.id, name: r.name, event: r.event, eventSlug: slug, at: r.at, wouldBe: code + '???' });
          continue;
        }
        const seq = await redis.incr('celesta:chestseq:' + slug);
        const chest = code + String(seq).padStart(3, '0');
        r.chest = chest;
        await redis.hset('celesta:regs', { [r.id]: JSON.stringify(r) });
        assigned.push({ id: r.id, name: r.name, event: r.event, eventSlug: slug, at: r.at, chest });
      }
      if (!dryRun && assigned.length) {
        await appendLog({
          actor: role, action: 'Chest numbers backfilled',
          detail: assigned.length + ' registration(s) given a chest number: ' + assigned.map(function (a) { return a.name + ' ' + a.chest; }).join(', '),
          target: { kind: 'registration', id: assigned[0].id, name: assigned[0].name },
        }, req);
      }
      return res.status(200).json({ ok: true, dryRun: !!dryRun, count: assigned.length, assigned });
    } catch (e) {
      console.error('registrations backfill-chest failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    } finally {
      if (locked) {
        try { await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end", [lockKey], [lockVal]); } catch { /* lock expires on its own */ }
      }
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
