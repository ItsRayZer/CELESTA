// POST /api/register — save a new registration (Upstash Redis direct)
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { event, name, school, phone, email, team, teamName, members } = req.body || {};
  
  if (!event || !name || !school || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const id = 'reg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const record = {
    id, event, name, school, phone, email: email || '', team: team || 1,
    teamName: teamName || '', members: members || [],
    paid: false, amount: 0, at: new Date().toISOString()
  };
  
  try {
    await redis.hset('celesta:regs', { [id]: JSON.stringify(record) });
    await redis.zadd('celesta:reglist', { score: Date.now(), member: id });
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ error: 'Storage unavailable: ' + e.message });
  }
}
