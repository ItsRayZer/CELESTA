// GET  /api/visits — public visit totals (total + today). No auth: it's a public stat.
// POST /api/visits — count one visit. Called once per browser session by the site beacon.
//      Only counts when the request comes from the site itself (Referer/Origin check),
//      so other sites can't inflate it. One session = one visit, refreshes don't count.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function todayStr(){ return new Date().toISOString().slice(0,10); }

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
          fromSite = host === 'celesta-fest.vercel.app' || host === 'localhost';
        }
      } catch { fromSite = false; }
      if (fromSite) {
        await redis.incr('celesta:visits:total');
        await redis.hincrby('celesta:visits:daily', day, 1);
      }
    }
    const total = Number(await redis.get('celesta:visits:total') || 0);
    const today = Number(await redis.hget('celesta:visits:daily', day) || 0);
    return res.status(200).json({ total, today });
  } catch (e) {
    return res.status(200).json({ total: 0, today: 0 });
  }
}
