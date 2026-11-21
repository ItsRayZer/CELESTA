// GET /api/remind — daily reminder cron (Vercel cron, 1:00 AM UTC = 6:30 AM
// IST). Sends reminder emails ONLY on 26 Nov 2026 ("tomorrow is SPARK") and
// 27 Nov 2026 ("today is the day"). On any other date it does nothing.
// Idempotent: mailed reg IDs are kept in one Redis Set per reminder day, so
// a re-run on the same day never resends. Redis cost per run: ~4 commands
// (loadEvents HVALS + HGETALL + SMEMBERS + one SADD).
// Auth: the Vercel cron header (x-vercel-cron: 1) OR ?secret= matching the
// REMIND_SECRET env var. Anything else gets 403.
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

  const isCron = req.headers['x-vercel-cron'] === '1';
  const secret = String(req.query.secret || '');
  const secretOk = !!process.env.REMIND_SECRET && secret !== '' && secret === process.env.REMIND_SECRET;
  if (!isCron && !secretOk) return res.status(403).json({ error: 'Forbidden' });

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
    const sentIds = [];
    for (const r of pending) {
      try {
        const mail = buildReminderEmail({ reg: r, fee: feeBySlug[r.eventSlug] || '', kind });
        const ok = await sendMail({ to: String(r.email).trim(), ...mail });
        if (ok) { sent++; sentIds.push(r.id); } else failed++;
      } catch (e) {
        console.error('remind send failed', r.id, e);
        failed++;
      }
    }

    // Record the mailed ids in ONE SADD, then let the key tidy itself up.
    if (sentIds.length) {
      try {
        await redis.sadd(key, ...sentIds);
        await redis.expire(key, 604800); // 7 days
      } catch (e) {
        console.error('remind sadd failed', e);
      }
    }

    return res.status(200).json({ ok: true, sent, failed, day, kind, total: regs.length, remaining });
  } catch (e) {
    console.error('remind failed', e);
    return res.status(500).json({ error: 'Reminder run failed' });
  }
}
