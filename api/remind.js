// GET /api/remind — daily reminder cron (Vercel cron, 1:00 AM UTC = 6:30 AM
// IST). Sends reminder emails ONLY on 26 Nov 2026 ("tomorrow is SPARK") and
// 27 Nov 2026 ("today is the day"). On any other date it does nothing.
// Idempotent: mailed reg IDs are SADDed to one Redis Set per reminder day
// IMMEDIATELY after each successful send, so a Vercel kill mid-run (or a
// re-trigger) never resends to someone already mailed. Redis cost per run:
// loadEvents HVALS + HGETALL + SMEMBERS + one SADD + EXPIRE per sent mail.
// Auth: ONLY ?secret= matching the REMIND_SECRET env var, or an
// Authorization header carrying it. The bare x-vercel-cron header alone
// NEVER authorises (it is forgeable with curl). Anything else gets 403.
// Skips silently (ok) when Gmail is not configured.
import { Redis } from '@upstash/redis';
import { sendMail, buildReminderEmail, mailConfigured } from '../lib/email.js';
import { loadEvents } from './events.js';
import { parseVal } from './admin-login.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Reminder days, in Asia/Kolkata dates: 26 Nov = "tomorrow", 27 Nov = "today".
const REMIND_DAYS = { '2026-11-26': 'tomorrow', '2026-11-27': 'today' };
// Gmail free limit is 500/day; stay under it.
const MAX_RECIPIENTS = 400;

function istToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Secret required on EVERY invocation. The bare x-vercel-cron header is
  // NOT trusted: anyone can forge `x-vercel-cron: 1` with curl, so the
  // header alone must never authorise. Only ?secret= matching REMIND_SECRET
  // or an Authorization header carrying it (bare or "Bearer <secret>")
  // authorises. If REMIND_SECRET is unset, nothing authorises (fail closed).
  const secret = String(req.query.secret || '');
  const authHeader = String(req.headers.authorization || '').trim();
  const headerSecret = authHeader.replace(/^Bearer\s+/i, '').trim();
  const secretOk = !!process.env.REMIND_SECRET
    && ((secret !== '' && secret === process.env.REMIND_SECRET)
      || (headerSecret !== '' && headerSecret === process.env.REMIND_SECRET));
  if (!secretOk) return res.status(403).json({ error: 'Forbidden' });

  const day = istToday();
  const kind = REMIND_DAYS[day];
  if (!kind) return res.status(200).json({ ok: true, sent: 0, note: 'not a reminder day', day });
  if (!mailConfigured()) return res.status(200).json({ ok: true, sent: 0, note: 'email not configured', day });

  try {
    // Fee lookup (1 HVALS inside loadEvents).
    const events = await loadEvents();
    const feeBySlug = {};
    for (const e of events || []) if (e && e.slug) feeBySlug[e.slug] = e.fee || '';

    // All registrations (1 HGETALL); keep only the ones with an email.
    const all = await redis.hgetall('celesta:regs');
    const regs = [];
    if (all) {
      for (const v of Object.values(all)) {
        const r = parseVal(v);
        if (r && r.id && r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email).trim())) regs.push(r);
      }
    }

    // Already mailed today (1 SMEMBERS).
    const key = 'celesta:reminded:' + day;
    let already = [];
    try {
      already = await redis.smembers(key);
    } catch (e) {
      console.error('remind smembers failed', e);
    }
    const done = new Set(Array.isArray(already) ? already : []);
    const pendingAll = regs.filter(r => !done.has(r.id));
    const pending = pendingAll.slice(0, MAX_RECIPIENTS);
    const remaining = pendingAll.length - pending.length;

    let sent = 0;
    let failed = 0;
    // R3-m35 (batch math, fixed): the old fan-out (400 max, ~3 s per
    // 10-mail batch) needed ~120 s, far past the 10 s Vercel cap, so a
    // run was always killed mid-batch. A run now stops on an 8 s wall
    // clock budget and reports `remaining`, so the next trigger (manual
    // re-run with the secret, or the next cron) continues where it left
    // off instead of dying silently mid-list. SADD-after-send (not
    // before): a student is marked mailed only AFTER their mail
    // succeeds — the old mark-first design marked unmailed students as
    // mailed when the run was killed between the SADD and the send.
    // (A kill between a successful send and its SADD can re-send one
    // reminder on the next run; a duplicate reminder is the safer
    // failure than a silently missed one.)
    // NOTE (R3-m35, auth — NOT fixed, see fix log): the Vercel cron
    // still cannot authorise — the cron path carries no secret and the
    // x-vercel-cron header is forgeable, so no secret may live in the
    // public repo's vercel.json. The cron entry was removed; reminders
    // are triggered manually by the owner with ?secret= (or an
    // Authorization header) until the secret is supplied another way.
    const RUN_STARTED = Date.now();
    const RUN_BUDGET_MS = 8000;
    const BATCH_SIZE = 10;
    const sendOne = async (r) => {
      try {
        const mail = buildReminderEmail({ reg: r, fee: feeBySlug[r.eventSlug] || '', kind });
        const ok = await sendMail({ to: String(r.email).trim(), ...mail, timeoutMs: 3000 });
        if (ok) {
          sent++;
          try {
            await redis.sadd(key, r.id);
            await redis.expire(key, 604800); // 7 days
          } catch (e) {
            // Mail went out but the mark failed: count it sent (it was),
            // and let the next run possibly re-send — never silently drop.
            console.error('remind sadd failed after send', r.id, e);
          }
        } else {
          failed++;
        }
      } catch (e) {
        console.error('remind send failed', r.id, e);
        failed++;
      }
    };
    let stoppedEarly = false;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (Date.now() - RUN_STARTED > RUN_BUDGET_MS) { stoppedEarly = true; break; }
      await Promise.allSettled(pending.slice(i, i + BATCH_SIZE).map(sendOne));
    }
    // What is left: pending minus what this run attempted (sent + failed),
    // plus the slice beyond MAX_RECIPIENTS that was never attempted.
    const attempted = sent + failed;
    const left = Math.max(0, pendingAll.length - attempted);

    return res.status(200).json({ ok: true, sent, failed, day, kind, total: regs.length, remaining: left, stoppedEarly });
  } catch (e) {
    console.error('remind failed', e);
    return res.status(500).json({ error: 'Reminder run failed' });
  }
}
