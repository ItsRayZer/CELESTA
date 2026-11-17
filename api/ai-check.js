// POST /api/ai-check — on-demand AI review of unchecked registrations (write role only)
// Calls NVIDIA Nemotron (free tier) for up to 5 unchecked registrations per tap
// and writes the verdict into each record's `ai` field: {level, reason, at}.
// level: 'ok' | 'review' | 'suspicious'. The verdict is advisory only — it
// never changes, blocks or deletes a registration.
// Needs the NVIDIA_API_KEY env var in Vercel (the key itself is never in code).
// Without it the endpoint answers 503 with a clear message.
import { Redis } from '@upstash/redis';
import { verify, parseVal } from './admin-login.js';
import { appendLog } from './activity-log.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const BATCH = 5;

async function checkOne(reg) {
  const prompt = 'You check student fest registrations for spam or fake entries. '
    + 'Registration: name="' + reg.name + '", school="' + reg.school + '", phone="' + reg.phone
    + '", email="' + (reg.email || '') + '", team="' + (reg.teamName || '') + '", event="' + reg.event + '". '
    + 'Reply with ONLY this JSON, no other text: {"level":"ok"|"review"|"suspicious","reason":"one short line"}. '
    + 'Mark suspicious only for clear fakes: gibberish names, fake or test schools, test entries. '
    + 'A normal Indian student name and a real school is ok.';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.NVIDIA_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 120,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    const m = text.match(/\{[^}]*\}/);
    if (!m) return { level: 'review', reason: 'AI reply unclear' };
    const v = JSON.parse(m[0]);
    if (!['ok', 'review', 'suspicious'].includes(v.level)) return { level: 'review', reason: 'AI reply unclear' };
    return { level: v.level, reason: String(v.reason || '').slice(0, 120) || 'No reason given' };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (verify(token) !== 'write') return res.status(403).json({ error: 'Write access required' });
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(503).json({ error: 'AI not configured — add NVIDIA_API_KEY in Vercel env vars' });
  }
  try {
    const all = await redis.hgetall('celesta:regs');
    const unchecked = [];
    if (all) for (const v of Object.values(all)) {
      const r = parseVal(v);
      if (r && !r.ai) unchecked.push(r);
    }
    // Oldest first (they waited longest).
    unchecked.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
    const batch = unchecked.slice(0, BATCH);
    if (!batch.length) return res.status(200).json({ ok: true, checked: 0, suspicious: 0, remaining: 0 });
    const verdicts = await Promise.all(batch.map(checkOne));
    let suspicious = 0, checked = 0;
    for (let i = 0; i < batch.length; i++) {
      const v = verdicts[i];
      if (!v) continue; // AI call failed for this one — leave it unchecked
      checked++;
      if (v.level === 'suspicious') suspicious++;
      const rec = batch[i];
      rec.ai = { level: v.level, reason: v.reason, at: new Date().toISOString() };
      await redis.hset('celesta:regs', { [rec.id]: JSON.stringify(rec) });
    }
    const remaining = unchecked.length - checked;
    await appendLog({
      actor: 'write', action: 'AI check ran',
      detail: checked + ' checked, ' + suspicious + ' suspicious, ' + remaining + ' remaining',
    }, req);
    return res.status(200).json({ ok: true, checked, suspicious, remaining });
  } catch (e) {
    return res.status(500).json({ error: 'Storage unavailable' });
  }
}
