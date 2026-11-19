// POST /api/spark-chat — SPARK Bot AI fallback.
// The client-side keyword matcher answers what it knows (score >= 3).
// Anything else comes here: this function builds a facts-only system
// prompt from the LIVE events + coordinators, calls the GptOpen relay
// (Groq, then OpenRouter, with the owner's server keys) and returns
// the answer. The browser never talks to the relay directly (no CORS).
// No API keys live in this repo. Never logs the question or the answer.
import { Redis } from '@upstash/redis';
import { loadEvents, DEFAULT_EVENTS } from './events.js';
import { parseVal } from './admin-login.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RELAY_URL = 'https://gptopen.vercel.app/api/relay';
const RELAY_TIMEOUT_MS = 25000;

// Abuse protection (all in Redis, so it holds across every serverless
// instance — the old in-memory per-IP limit did not):
// 1. Origin/Referer allowlist — stops casual direct calls to the endpoint
//    from curl or another site. A determined caller can spoof Origin, so
//    this is a first layer only; the rate limit and daily cap are the
//    real guards. Deployment URLs are NOT allowlisted, so the AI silently
//    falls back to local answers when the site is opened via one.
// 2. Per-IP rate limit: 60 requests per 10 minutes (venue Wi-Fi shares
//    one public IP for 150-200 students, so 20 was too low).
// 3. Daily global cap: 1000 AI calls per day. Past that, 429. This is
//    the real token guard: even a distributed attack cannot drain the
//    relay beyond 1000 calls/day. The bot falls back to its local
//    answers, so students still get a reply.
// Rate-limit and cap checks fail OPEN when Redis is down, so a Redis
// outage never kills the bot; the relay's own 60/10min limit is the
// backstop then.
const RATE_WINDOW_S = 10 * 60;
const RATE_MAX = 60;
const DAILY_MAX = 1000;

const ALLOWED_HOSTS = new Set([
  'spark-fest.vercel.app',
  'celesta-fest.vercel.app',
  'spark.maraugusthinosecollege.org',
  'celesta.maraugusthinosecollege.org',
  'localhost',
  '127.0.0.1',
]);
function originAllowed(req) {
  const val = String(req.headers['origin'] || req.headers['referer'] || '').trim();
  if (!val) return false;
  try { return ALLOWED_HOSTS.has(new URL(val).hostname); } catch { return false; }
}
async function redisRateLimited(ip) {
  try {
    const key = 'celesta:sparkchat:rl:' + ip;
    const n = await redis.incr(key);
    if (n === 1) {
      // Never leave a key with no TTL: if expire fails, delete the key
      // instead, or the IP stays blocked forever (see api/visits.js).
      try { await redis.expire(key, RATE_WINDOW_S); }
      catch { try { await redis.del(key); } catch {} }
    }
    return n > RATE_MAX;
  } catch { return false; }
}
async function dailyCapHit() {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = 'celesta:sparkchat:daily:' + day;
    const n = await redis.incr(key);
    if (n === 1) {
      // Never leave a key with no TTL: a stuck daily key would kill the
      // AI for everyone once the counter passes DAILY_MAX.
      try { await redis.expire(key, 24 * 60 * 60); }
      catch { try { await redis.del(key); } catch {} }
    }
    return n > DAILY_MAX;
  } catch { return false; }
}

// Key contacts (from the official poster). Always in the prompt, even
// when the coordinators store is unreachable.
const KEY_CONTACTS = [
  'Student Lead - Ananthu Anil - 7510142466',
  'Associate Lead - Bista Mariya Jojo - 9746446739',
  'Faculty - Shibu Kallarackal - 9446375272',
  'Faculty - Archana Gopinath - 9495955010',
];

// Admin-editable text (event fields, coordinator names) goes into the
// system prompt, so newlines are stripped: a forged newline could
// otherwise smuggle a fake RULES section or an instruction into it.
// Fields are also length-capped upstream (cleanEvent), and the finished
// prompt is truncated below.
function safeField(v) {
  return String(v || '').replace(/[\r\n]+/g, ' ').trim();
}

function eventLine(e) {
  const team = 'Team ' + e.teamMin + '-' + e.teamMax;
  const prize = e.prize2
    ? 'Prizes: 1st Rs.' + e.prize1 + ', 2nd Rs.' + e.prize2
    : 'Prize: Rs.' + e.prize1 + ' winner-takes-all (single prize, no 2nd)';
  const join = (arr) => (arr || []).filter(Boolean).map(safeField).join(' | ');
  let s = '- ' + safeField(e.name) + ' (' + team + '). ' + prize + '. '
    + safeField(e.when) + ' · ' + safeField(e.where) + ' · ' + safeField(e.duration) + '. '
    + safeField(e.about);
  if (e.how && e.how.length) s += '\n  Rounds: ' + join(e.how);
  if (e.rules && e.rules.length) s += '\n  Rules: ' + join(e.rules);
  if (e.reqs && e.reqs.length) s += '\n  Needs: ' + join(e.reqs);
  return s;
}

function contactsBlock(coords) {
  const lines = KEY_CONTACTS.slice();
  const sc = (coords || []).filter(c =>
    c && c.team === 'Student Coordinators' && c.event && c.name);
  for (const c of sc) {
    // A phone is listed only when the stored record actually has one.
    // Never invent a phone number.
    let line = '  ' + safeField(c.name) + ' - ' + safeField(c.event) + ' coordinator'
      + (c.cls ? ' (' + safeField(c.cls) + ')' : '');
    if (c.phone) line += ' - ' + safeField(c.phone);
    lines.push(line);
  }
  return lines.join('\n');
}

export function buildSystemPrompt(events, coords, lang) {
  const visible = (events || []).filter(e => e && e.visible !== false);
  const evLines = visible.map(eventLine);
  // Prize pool computed from the live events, never hardcoded, so an
  // admin prize edit is reflected in the AI's answers too.
  const pool = visible.reduce((s, e) => s + (e.prize1 || 0) + (e.prize2 || 0), 0);
  const lines = [
    'You are SPARK Bot, the assistant for NEXUS SPARK 2K26 ("Decode Your Future"),',
    'an inter-school fest on Fri 27 Nov 2026, 10 AM, at Mar Augusthinose College,',
    'Ramapuram, Kottayam, Kerala, India, for 12th standard school students.',
    'Organised by NEXUS, the BCA department Association of Computer Applications.',
    'Technical Lead: Aben Sojan. Instagram: @celesta2k26.',
    '',
    'REGISTRATION - READ THIS FIRST:',
    '- Registration is ONLINE on this website: open the Events page, tap an event,',
    '  fill the form (name, school, phone, email, team name, team members).',
    '- Registration is FREE. There is NO fee and NO online payment of any kind.',
    '  There is no payment link, no UPI, no ticket booking, no seat booking.',
    '- "Book online" means register online (free). A student may join more than',
    '  one event, but only one team per student per event.',
    '- Report at the registration desk by 9:30 AM on 27 Nov with a valid school ID.',
    '- A valid school ID card is required for every participant. College students',
    '  cannot participate. No registration deadline is published.',
    '',
    'EVENTS (live, full details):',
    evLines.join('\n') || '- (no events listed)',
    '',
    'Total prize pool: Rs.' + pool.toLocaleString('en-IN') + '.',
    '',
    'HOW TO REACH (researched):',
    '- Address: Mar Augusthinose College, Pala Ramapuram Road, Ramapuram Bazar P.O.,',
    '  Kottayam, Kerala 686576. Near St. Augustine\'s Forane Church and St. Augustine\'s HSS.',
    '- Ramapuram is about 32 km north of Kottayam town; Pala is about 12 km away,',
    '  Thodupuzha about 15 km away.',
    '- By bus: buses from Kottayam, Pala, Thodupuzha and Koothattukulam go to Ramapuram',
    '  town / bus stand. The college is about 0.5 km from Ramapuram town on Pala',
    '  Ramapuram Road, a short walk. Do NOT invent bus numbers or bus timings.',
    '- By train: there is no railway station near Ramapuram (none within 10 km).',
    '  Nearest major station is Kottayam (about 32 km), then take a bus to Ramapuram.',
    '',
    'ABOUT THE COLLEGE:',
    '- Mar Augusthinose College, established 1995, managed by St. Augustine\'s Forane',
    '  Church, Ramapuram. Affiliated to Mahatma Gandhi University (MGU), Kottayam.',
    '  NAAC B grade. Around 1,700 students, 5-acre campus. Courses include BCA, BBA,',
    '  BCom, BSc, BA and PG courses. Official site: maraugusthinosecollege.org.',
    '  College office phone: 04822-261440.',
    '',
    'SPONSORS: SpicyJack, Cafe Classico, Ajay Electronics, KLOG, Fisat Computers.',
    '',
    'CONTACTS:',
    contactsBlock(coords),
    '',
    'RULES:',
    '- Answer ONLY from the facts given above. Never invent dates, prizes,',
    '  contacts, bus numbers, bus timings, fees, payments, or rules.',
    '- If the facts do not cover something (dress code, certificates, judging',
    '  criteria, registration deadline, food, accommodation, parking, end time,',
    '  detailed timetable), say so plainly and point to Student Lead Ananthu Anil (7510142466).',
    '- Be concise: 2-4 sentences, unless a list is needed.',
    '- Match the user\'s language: if they write in Manglish/Malayalam, answer',
    '  in Manglish; otherwise answer in English.',
    '- You may use <b> for emphasis and <br> for line breaks, no other HTML.',
    '- Never mention that you are an AI model, Groq, OpenRouter, or GptOpen.',
    '  You are SPARK Bot.',
  ];
  // The language toggle is a stronger signal than guessing from the question.
  if (lang === 'ml') lines.push('The user is chatting in Malayalam (Manglish); answer in Manglish.');
  // Cap the prompt so a huge admin-edited event can never blow past the
  // model's context and 502 every AI answer.
  const prompt = lines.join('\n');
  return prompt.length > 12000 ? prompt.slice(0, 12000) : prompt;
}

async function loadCoords() {
  try {
    const vals = await redis.hvals('celesta:coordinators');
    const list = (vals || []).map(v => parseVal(v)).filter(Boolean);
    return list.length ? list : null;
  } catch { return null; }
}

async function askRelay(systemPrompt, question) {
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, RELAY_TIMEOUT_MS);
  try {
    const r = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'auto',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const text = j && j.choices && j.choices[0] && j.choices[0].message
      ? String(j.choices[0].message.content || '').trim() : '';
    return text || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function clientIp(req) {
  const real = req.headers['x-real-ip'] || req.headers['X-Real-Ip'] || '';
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || '';
  const parts = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const ip = clientIp(req);
  if (await redisRateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })()
    : (req.body || {});
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  const lang = body.lang === 'ml' ? 'ml' : 'en';

  // Daily global cap, counted only on validated questions that are
  // about to call the relay.
  if (await dailyCapHit()) return res.status(429).json({ error: 'daily_cap' });

  let events;
  try {
    events = (await loadEvents()).filter(e => e.visible);
  } catch { events = DEFAULT_EVENTS.filter(e => e.visible); }
  const coords = await loadCoords();
  const systemPrompt = buildSystemPrompt(events, coords, lang);

  const answer = await askRelay(systemPrompt, question);
  if (!answer) return res.status(502).json({ error: 'ai_unavailable' });
  return res.status(200).json({ answer });
}
