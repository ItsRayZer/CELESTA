// /api/fees — Fees app for SPARK 2K26 (ADMIN-ONLY).
// Chest numbers, payment collection, funds, history, students.
// Auth: the same HMAC tokens as the dashboard (./admin-login.js verify).
// GET reads accept any valid role; POST writes require the 'write' role.
// The phone lookup here (?action=lookup) is ADMIN-ONLY, behind the token.
// There is deliberately NO public phone lookup anywhere on this site —
// the public /api/ticket?phone= endpoint was removed for that reason.
import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';
import { verify, canWrite, canCollect, parseVal, normPhone } from './admin-login.js';
import { loadEvents } from './events.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// PDF order: 01 Prompting, 02 Quiz, 03 Treasure Hunt, 04 Reels.
// Idea Presentation is hidden and gets no code.
const EVENT_CODES = { 'prompting': '01', 'quiz': '02', 'treasure-hunt': '03', 'reels-competition': '04' };
const EVENT_ORDER = ['prompting', 'quiz', 'treasure-hunt', 'reels-competition'];
const HISTORY_KEY = 'celesta:fees:history';
const HISTORY_CAP = 500;

// Fee strings are like "₹100 per team" / "₹50 per participant" — pull the number.
function parseFee(feeStr) {
  const m = String(feeStr || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function chestFor(slug, seq) {
  return (EVENT_CODES[slug] || '00') + String(seq).padStart(3, '0');
}

// Atomic per-event sequence: the only source of chest numbers, so two
// simultaneous registrations or payments never collide.
async function nextChest(slug) {
  const seq = await redis.incr('celesta:chestseq:' + slug);
  return chestFor(slug, seq);
}

async function loadAllRegs() {
  const all = await redis.hgetall('celesta:regs');
  if (!all) return [];
  return Object.values(all).map(v => parseVal(v)).filter(Boolean);
}

async function readHistory(limit) {
  const raw = await redis.lrange(HISTORY_KEY, 0, (limit || HISTORY_CAP) - 1);
  return (raw || []).map(v => parseVal(v)).filter(Boolean);
}

async function pushHistory(entry) {
  await redis.lpush(HISTORY_KEY, JSON.stringify(entry));
  try { await redis.ltrim(HISTORY_KEY, 0, HISTORY_CAP - 1); } catch { /* cap is a nicety */ }
}

// One registration, as the fees page needs it. fee is the live event fee
// string; feeAmount is its number, used for funds math. `invalid` is
// included so the fees page and ticket can refuse voided records (#3).
function pubReg(r, feeStr) {
  return {
    id: r.id,
    chest: r.chest || '',
    event: r.event,
    eventSlug: r.eventSlug,
    name: r.name,
    school: r.school,
    team: r.team,
    teamName: r.teamName || '',
    members: Array.isArray(r.members) ? r.members : [],
    phone: r.phone,
    fee: feeStr || '',
    feeAmount: parseFee(feeStr),
    paid: !!r.paid,
    invalid: !!r.invalid,
    amount: Number(r.amount || 0),
    paidMethod: r.paidMethod || '',
    paidAt: r.paidAt || '',
    at: r.at || '',
  };
}

// Sort by chest number (numeric); records without a chest go last.
function byChest(a, b) {
  const ca = a.chest || '', cb = b.chest || '';
  if (!ca && !cb) return String(b.at || '').localeCompare(String(a.at || ''));
  if (!ca) return 1;
  if (!cb) return -1;
  return ca.localeCompare(cb, undefined, { numeric: true });
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const role = verify(token);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });

  const action = String(req.query.action || 'overview');

  // ---------- GET ----------
  if (req.method === 'GET') {
    // Live events in PDF order; fall back to a built-in list if storage is down.
    let events = [];
    try {
      const all = await loadEvents();
      const bySlug = {};
      (all || []).forEach(function (e) { if (e && e.slug) bySlug[e.slug] = e; });
      events = EVENT_ORDER.filter(function (s) { return bySlug[s]; }).map(function (s) { return bySlug[s]; });
    } catch (e) {
      console.error('fees events lookup failed', e);
      events = [
        { slug: 'prompting', name: 'Prompting', fee: '₹50 per participant' },
        { slug: 'quiz', name: 'Quiz', fee: '₹100 per team' },
        { slug: 'treasure-hunt', name: 'Treasure Hunt', fee: '₹200 per team' },
        { slug: 'reels-competition', name: 'Reels', fee: '₹100 per team' },
      ];
    }
    const feeMap = {};
    events.forEach(function (e) { feeMap[e.slug] = e.fee || ''; });

    if (action === 'overview') {
      try {
        const regs = await loadAllRegs();
        const history = await readHistory(HISTORY_CAP);
        // Removed receipts must NOT count in any money split (#1): the
        // removed audit entry keeps the original amount/method, so without
        // this filter Funds would show removed money as still in hand.
        const methodSum = { cash: 0, gpay: 0 };
        history.forEach(function (h) {
          if (h.removed) return;
          if (h.method === 'cash') methodSum.cash += Number(h.amount || 0);
          else if (h.method === 'gpay') methodSum.gpay += Number(h.amount || 0);
        });
        const evList = events.map(function (ev) {
          // Invalid (void) registrations are excluded from every fees
          // total and list (#3): they are not collectable.
          const list = regs.filter(function (r) { return !r.invalid && (r.eventSlug === ev.slug || r.event === ev.name); });
          const paidList = list.filter(function (r) { return r.paid; });
          // Only fall back to the live fee when amount is missing/null/
          // undefined. An explicit amount of 0 is 0, not the full fee.
          const collected = paidList.reduce(function (s, r) { return s + (r.amount === undefined || r.amount === null ? parseFee(feeMap[ev.slug]) : Number(r.amount || 0)); }, 0);
          const remaining = list.filter(function (r) { return !r.paid; }).reduce(function (s) { return s + parseFee(feeMap[ev.slug]); }, 0);
          const evHist = history.filter(function (h) { return !h.removed && h.eventSlug === ev.slug; });
          return {
            slug: ev.slug, name: ev.name, fee: feeMap[ev.slug], feeAmount: parseFee(feeMap[ev.slug]),
            registered: list.length, paid: paidList.length, pending: list.length - paidList.length,
            collected, remaining,
            cash: evHist.filter(function (h) { return h.method === 'cash'; }).reduce(function (s, h) { return s + Number(h.amount || 0); }, 0),
            gpay: evHist.filter(function (h) { return h.method === 'gpay'; }).reduce(function (s, h) { return s + Number(h.amount || 0); }, 0),
          };
        });
        const totals = evList.reduce(function (t, e) {
          t.registered += e.registered; t.paid += e.paid; t.pending += e.pending;
          t.collected += e.collected; t.remaining += e.remaining;
          return t;
        }, { registered: 0, paid: 0, pending: 0, collected: 0, remaining: 0 });
        return res.status(200).json({ ok: true, role, events: evList, totals, cash: methodSum.cash, gpay: methodSum.gpay });
      } catch (e) {
        console.error('fees overview failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      }
    }

    if (action === 'students') {
      const slug = String(req.query.event || '').trim();
      if (!EVENT_ORDER.includes(slug)) return res.status(400).json({ error: 'Unknown event' });
      try {
        const regs = await loadAllRegs();
        const ev = events.find(function (e) { return e.slug === slug; }) || { slug, name: slug, fee: feeMap[slug] || '' };
        // Invalid (void) registrations are not listed or collectable (#3).
        // Slug-or-name match (#57): a legacy record with a name but no
        // slug is still shown instead of being counted-but-uncollectable.
        const list = regs
          .filter(function (r) { return !r.invalid && (r.eventSlug === slug || r.event === ev.name); })
          .map(function (r) { return pubReg(r, feeMap[slug]); })
          .sort(byChest);
        return res.status(200).json({ ok: true, event: ev, regs: list });
      } catch (e) {
        console.error('fees students failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      }
    }

    if (action === 'history') {
      const slug = String(req.query.event || '').trim();
      try {
        let entries = await readHistory(HISTORY_CAP);
        if (slug) {
          if (!EVENT_ORDER.includes(slug)) return res.status(400).json({ error: 'Unknown event' });
          entries = entries.filter(function (h) { return h.eventSlug === slug; });
        }
        return res.status(200).json({ ok: true, entries });
      } catch (e) {
        console.error('fees history failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      }
    }

    if (action === 'lookup') {
      // ADMIN-ONLY phone lookup. The phone is the identifier the student
      // gave at registration; this route requires the admin token, so only
      // the logged-in fees admin can use it. Never expose it without auth.
      // Accepts a partial number (4+ digits) so Collect can find a student
      // as the admin types; a full 10-digit number still matches exactly.
      // Substring match on the normalised phone, capped at 20 results.
      const digits = normPhone(String(req.query.phone || '').trim());
      if (digits.length < 4) {
        return res.status(400).json({ error: 'Enter at least 4 digits of the mobile number.' });
      }
      try {
        const regs = await loadAllRegs();
        const list = regs
          .filter(function (r) { return !r.invalid && normPhone(r.phone).includes(digits); })
          .map(function (r) { return pubReg(r, feeMap[r.eventSlug] || ''); })
          .sort(byChest)
          .slice(0, 20);
        return res.status(200).json({ ok: true, regs: list });
      } catch (e) {
        console.error('fees lookup failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ---------- POST ----------
  if (req.method === 'POST') {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });
    // Role split (#2): mark-paid is the counter's job, so the limited
    // 'fees' role may do it. mark-unpaid reverses a payment, so it is
    // admin-only (write/lead) — a fees token gets 403 here, and the
    // Remove receipt re-auth (verifyWrite) is enforced server-side too.
    if (action === 'mark-paid' && !canCollect(role)) return res.status(403).json({ error: 'Write access required' });
    if (action === 'mark-unpaid' && !canWrite(role)) return res.status(403).json({ error: 'Write access required' });
    if (action !== 'mark-paid' && action !== 'mark-unpaid') return res.status(400).json({ error: 'Unknown action' });

    if (action === 'mark-paid') {
      const method = String(body.method || '').trim();
      if (method !== 'cash' && method !== 'gpay') {
        return res.status(400).json({ error: 'Method must be cash or gpay' });
      }
      // Per-registration lock: two admins tapping mark-paid at once must
      // not both read paid=false and both write + push history. The lock
      // is best-effort (10s TTL); a contender re-reads the record and
      // reports its current state instead of writing.
      const lockKey = 'celesta:paylock:' + id;
      const lockVal = crypto.randomUUID();
      let locked = false;
      try {
        const got = await redis.set(lockKey, lockVal, { nx: true, ex: 10 });
        locked = !!got;
        if (!locked) {
          const cur = parseVal(await redis.hget('celesta:regs', id));
          if (!cur) return res.status(404).json({ error: 'Not found' });
          if (cur.paid) {
            const feeMap = {};
            try {
              (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
            } catch { /* fee display falls back to the record */ }
            return res.status(200).json({ ok: true, reg: pubReg(cur, feeMap[cur.eventSlug] || ''), already: true });
          }
          return res.status(409).json({ error: 'already being processed, try again' });
        }
        // Re-read under the lock: the record may have been paid between
        // the lock attempt and now.
        const rec = parseVal(await redis.hget('celesta:regs', id));
        if (!rec) return res.status(404).json({ error: 'Not found' });
        // Invalid (void) registrations cannot be paid (#3).
        if (rec.invalid) return res.status(400).json({ error: 'This registration is invalid and cannot be paid' });
        // Resolve the event slug from the event name for legacy records
        // that have no slug (#57). Without a slug there is no fee and no
        // chest code, so refuse instead of assigning a 00xxx chest at ₹0.
        let slug = rec.eventSlug || '';
        if (!slug && rec.event) {
          try {
            const evs = await loadEvents();
            const ev = (evs || []).find(function (e) { return e && e.name === rec.event; });
            if (ev) slug = ev.slug;
          } catch { /* slug stays empty; refused below */ }
        }
        if (!slug) return res.status(400).json({ error: 'Cannot determine the event for this registration' });
        rec.eventSlug = slug;
        // Idempotent: already paid → return unchanged, no double-count,
        // no second history entry, and never overwrite paidAt/paidMethod.
        // A paid record without a chest only gets a chest assigned; its
        // payment fields are left exactly as they were.
        if (rec.paid) {
          if (!rec.chest) {
            try {
              rec.chest = await nextChest(rec.eventSlug);
              await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
            } catch (e) { console.error('fees chest assign failed', e); }
          }
          const feeMap = {};
          try {
            (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
          } catch { /* fee display falls back to the record */ }
          return res.status(200).json({ ok: true, reg: pubReg(rec, feeMap[rec.eventSlug] || ''), already: true });
        }
        // Chest first if the record has none (registrations made before
        // chest numbers existed). Same atomic INCR as registration time.
        if (!rec.chest) {
          try { rec.chest = await nextChest(rec.eventSlug); }
          catch (e) { console.error('fees chest assign failed', e); }
        }
        const feeMap = {};
        try {
          (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
        } catch { /* fee display falls back to the record */ }
        // Amount (#22): an admin-set stored amount (non-zero) wins over
        // the live fee, so a discounted/adjusted amount is not silently
        // overwritten. A normal unpaid record stores 0, so it pays the
        // live fee. If neither resolves, refuse (#57) — never a ₹0 payment.
        const amount = Number(rec.amount || 0) || parseFee(feeMap[rec.eventSlug]);
        if (!amount) return res.status(400).json({ error: 'Fee cannot be determined for this registration' });
        rec.paid = true;
        rec.amount = amount;
        rec.paidMethod = method;
        rec.paidAt = new Date().toISOString();
        await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
        // Fresh payment only — under the lock, and after the re-read
        // above, this runs at most once per record. If the history write
        // fails AFTER the payment was saved (#8), do NOT 500: the payment
        // is real. Return 200 with historyPending so the counter knows
        // the ledger entry is missing instead of being told it failed.
        try {
          await pushHistory({
            id: rec.id, chest: rec.chest || '', event: rec.event, eventSlug: rec.eventSlug,
            name: rec.name, phone: rec.phone || '', amount, method, at: rec.paidAt, by: 'admin',
          });
        } catch (e) {
          console.error('fees mark-paid history failed (payment saved)', e);
          return res.status(200).json({ ok: true, reg: pubReg(rec, feeMap[rec.eventSlug] || ''), historyPending: true });
        }
        return res.status(200).json({ ok: true, reg: pubReg(rec, feeMap[rec.eventSlug] || '') });
      } catch (e) {
        console.error('fees mark-paid failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      } finally {
        if (locked) {
          // Token-checked release: only delete the lock if it is still
          // ours (a plain DEL could remove a successor's lock).
          try { await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end", [lockKey], [lockVal]); } catch { /* lock expires on its own */ }
        }
      }
    }

    if (action === 'mark-unpaid') {
      // Same per-registration paylock as mark-paid: a concurrent mark-paid
      // and mark-unpaid on the same record must not both push/remove
      // history. Best-effort (10s TTL); a contender re-reads the record
      // and reports its current state instead of writing.
      const lockKey = 'celesta:paylock:' + id;
      const lockVal = crypto.randomUUID();
      let locked = false;
      try {
        const got = await redis.set(lockKey, lockVal, { nx: true, ex: 10 });
        locked = !!got;
        if (!locked) {
          const cur = parseVal(await redis.hget('celesta:regs', id));
          if (!cur) return res.status(404).json({ error: 'Not found' });
          if (!cur.paid) {
            const feeMap = {};
            try {
              (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
            } catch { /* fee display falls back to the record */ }
            return res.status(200).json({ ok: true, reg: pubReg(cur, feeMap[cur.eventSlug] || ''), already: true });
          }
          return res.status(409).json({ error: 'already being processed, try again' });
        }
        // Re-read under the lock: the record may have been paid/unpaid
        // between the lock attempt and now.
        const rec = parseVal(await redis.hget('celesta:regs', id));
        if (!rec) return res.status(404).json({ error: 'Not found' });
        if (!rec.paid) {
          const feeMap = {};
          try {
            (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
          } catch { /* fee display falls back to the record */ }
          return res.status(200).json({ ok: true, reg: pubReg(rec, feeMap[rec.eventSlug] || ''), already: true });
        }
        // Keep the old payment details for the removal audit entry below.
        const oldAmount = Number(rec.amount || 0);
        const oldMethod = rec.paidMethod || '';
        const oldAt = rec.paidAt || '';
        rec.paid = false;
        rec.amount = 0;
        rec.paidMethod = '';
        rec.paidAt = '';
        // Keep the chest: it was assigned at registration and belongs to
        // the student, not to the payment.
        await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
        // Remove only LIVE payment entries (#9): a second removal must
        // not delete the first removal's audit entry (p.removed), or the
        // audit trail is destroyed by using the feature twice.
        try {
          const raw = await redis.lrange(HISTORY_KEY, 0, HISTORY_CAP - 1);
          const targets = [...new Set((raw || []).filter(function (v) {
            const p = parseVal(v);
            return p && p.id === id && !p.removed;
          }))];
          for (const target of targets) await redis.lrem(HISTORY_KEY, 0, target);
        } catch (e) {
          // History removal failure is fatal (#8): the record is already
          // unpaid, so roll it back to paid and report the failure —
          // otherwise the history still counts the payment while the
          // record is unpaid, and a retry would see "already unpaid".
          console.error('fees history removal failed', e);
          try {
            rec.paid = true; rec.amount = oldAmount; rec.paidMethod = oldMethod; rec.paidAt = oldAt;
            await redis.hset('celesta:regs', { [id]: JSON.stringify(rec) });
          } catch (e2) { console.error('fees mark-unpaid rollback failed', e2); }
          return res.status(500).json({ error: 'Storage unavailable — payment NOT reversed, try again' });
        }
        // Leave a visible removal record in history so the receipt shows
        // as removed / not paid instead of vanishing without a trace.
        // Amount is kept for audit; the History tab excludes removed
        // entries from its totals. The ticket reverts to unpaid because
        // the registration itself is now unpaid. Method (#15): keep the
        // real method, or blank — never fabricate 'cash'.
        try {
          await pushHistory({
            id: rec.id, chest: rec.chest || '', event: rec.event, eventSlug: rec.eventSlug,
            name: rec.name, phone: rec.phone || '', amount: oldAmount, method: oldMethod || '', at: oldAt || new Date().toISOString(),
            removed: true, removedAt: new Date().toISOString(), by: 'admin',
          });
        } catch (e) {
          console.error('fees removal audit failed', e);
        }
        const feeMap = {};
        try {
          (await loadEvents()).forEach(function (e) { if (e && e.slug) feeMap[e.slug] = e.fee || ''; });
        } catch { /* fee display falls back to the record */ }
        return res.status(200).json({ ok: true, reg: pubReg(rec, feeMap[rec.eventSlug] || '') });
      } catch (e) {
        console.error('fees mark-unpaid failed', e);
        return res.status(500).json({ error: 'Storage unavailable' });
      } finally {
        if (locked) {
          // Token-checked release: only delete the lock if it is still ours.
          try { await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end", [lockKey], [lockVal]); } catch { /* lock expires on its own */ }
        }
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
