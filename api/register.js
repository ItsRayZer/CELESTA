// POST /api/register — save a new registration (Upstash Redis direct)
// Validates against the events database: the event must exist, be visible,
// have registrations open, and the team size must fit its limits.
import { Redis } from '@upstash/redis';
import { loadEvents } from './events.js';

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

  // Validate the event against the database (falls back to the built-in list if storage is down).
  let ev = null;
  try {
    const events = await loadEvents();
    ev = events.find(e => e.slug === event || e.name === event) || null;
  } catch (e) {
    ev = null;
  }
  if (!ev) return res.status(400).json({ error: 'Unknown event' });
  if (!ev.visible) return res.status(403).json({ error: 'This event is no longer listed' });
  if (!ev.regOpen) return res.status(403).json({ error: 'Registrations are closed for this event' });

  const teamSize = Number(team) || 1;
  if (teamSize < ev.teamMin || teamSize > ev.teamMax) {
    return res.status(400).json({ error: 'Team size for ' + ev.name + ' must be ' + ev.teamMin + '–' + ev.teamMax });
  }

  const id = 'reg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const record = {
    id, event: ev.name, eventSlug: ev.slug, name, school, phone, email: email || '', team: teamSize,
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
