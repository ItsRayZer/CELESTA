// GET  /api/visits — public visit totals (total + today). No auth: it's a public stat.
// POST /api/visits — count one visit. Called once per browser session by the site beacon.
//      Only counts when the request comes from the site itself (Referer/Origin check),
//      so other sites can't inflate it. One session = one visit, refreshes don't count.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function todayStr(){ return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}); }

// Client IP, same rule as register.js: Vercel sets x-real-ip; otherwise the
// LAST X-Forwarded-For entry. The first entry is client-supplied, never use it.
function clientIp(req) {
  const h = (req && req.headers) || {};
  const real = String(h['x-real-ip'] || '').trim();
  if (real) return real;
  const parts = String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

// Per-IP cap on counted visits: 60 per 10 minutes. Generous on purpose — a
// whole venue on shared Wi-Fi shares one public IP — but it stops a script
// inflating the counter without bound. Over the cap, the visit just isn't
// counted; the totals still return.
const VISIT_RL_LIMIT = 60;
const VISIT_RL_WINDOW = 600;

export default async function handler(req, res) {
  const day = todayStr();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (req.method === 'POST') {
      // Exact-host match: the old substring check let ANY *.vercel.app (or a
      // URL merely containing the string) inflate the counter.
      let fromSite = false;
      try {
        const ref = (req.headers.referer || req.headers.origin || '');
        if (ref) {
          const host = new URL(ref).hostname;
          fromSite = host === 'celesta-fest.vercel.app' || host === 'spark-fest.vercel.app' || host === 'spark.maraugusthinosecollege.org' || host === 'localhost';
        }
      } catch { fromSite = false; }
      if (fromSite) {
        let allowed = true;
        try {
          const rlKey = 'celesta:visits:rl:' + clientIp(req);
          const n = await redis.incr(rlKey);
          if (n === 1) {
            try { await redis.expire(rlKey, VISIT_RL_WINDOW); }
            catch { try { await redis.del(rlKey); } catch {} }
          }
          if (n > VISIT_RL_LIMIT) allowed = false;
        } catch { /* rate limit unavailable — count the visit */ }
        if (allowed) {
          await redis.incr('celesta:visits:total');
          await redis.hincrby('celesta:visits:daily', day, 1);
        }
      }
    }
    const total = Number(await redis.get('celesta:visits:total') || 0);
    const today = Number(await redis.hget('celesta:visits:daily', day) || 0);
    return res.status(200).json({ total, today });
  } catch (e) {
    return res.status(200).json({ total: 0, today: 0 });
  }
}
