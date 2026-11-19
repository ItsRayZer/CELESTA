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

// Per-IP rate limit: 20 requests per 10 minutes (in-memory sliding
// window, same pattern as the relay — per serverless instance).
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const ipHits = {};
function clientIp(req) {
  const real = req.headers['x-real-ip'] || req.headers['X-Real-Ip'] || '';
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || '';
  const parts = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (ipHits[ip] = (ipHits[ip] || []).filter(t => now - t < RATE_WINDOW_MS));
  if (arr.length >= RATE_MAX) return true;
  arr.push(now);
  return false;
}

// Key contacts (from the official poster). Always in the prompt, even
// when the coordinators store is unreachable.
const KEY_CONTACTS = [
  'Student Lead - Ananthu Anil - 7510142466',
  'Associate Lead - Bista Mariya Jojo - 9746446739',
  'Faculty - Shibu Kallarackal - 9446375272',
  'Faculty - Archana Gopinath - 9495955010',
];

function eventLine(e) {
  const team = 'Team ' + e.teamMin + '-' + e.teamMax;
  const prize = e.prize2
    ? 'Prizes: 1st Rs.' + e.prize1 + ', 2nd Rs.' + e.prize2
    : 'Prize: Rs.' + e.prize1 + ' winner-takes-all (single prize, no 2nd)';
  return '- ' + e.name + ' (' + team + '). ' + prize + '. '
    + (e.when || '') + ' · ' + (e.where || '') + ' · ' + (e.duration || '') + '. '
    + (e.about || '');
}

function contactsBlock(coords) {
  const lines = KEY_CONTACTS.slice();
  const sc = (coords || []).filter(c =>
    c && c.team === 'Student Coordinators' && c.event && c.name);
  for (const c of sc) {
    // A phone is listed only when the stored record actually has one.
    // Never invent a phone number.
    let line = '  ' + c.name + ' - ' + c.event + ' coordinator'
      + (c.cls ? ' (' + c.cls + ')' : '');
    if (c.phone) line += ' - ' + c.phone;
    lines.push(line);
  }
  return lines.join('\n');
}

export function buildSystemPrompt(events, coords, lang) {
  const evLines = (events || []).filter(e => e && e.visible !== false).map(eventLine);
  const lines = [
    'You are SPARK Bot, the assistant for NEXUS SPARK 2K26 ("Decode Your Future"),',
    'an inter-school fest on Fri 27 Nov 2026, 10 AM, at Mar Augusthinose College,',
    'Ramapuram, Kottayam, Kerala, India, for 12th standard school students.',
    'A valid school ID card is required. There is no entry fee.',
    'College students cannot participate.',
    '',
    'EVENTS (live):',
    evLines.join('\n') || '- (no events listed)',
    '',
    'Total prize pool: Rs.14,250. Instagram: @celesta2k26.',
    '',
    'CONTACTS:',
    contactsBlock(coords),
    '',
    'RULES:',
    '- Answer ONLY from the facts given above. Never invent dates, prizes,',
    '  contacts, bus routes, timings, or rules.',
    '- If the facts do not cover something (dress code, certificates, judging',
    '  criteria, deadline, accommodation, parking, end time, bus routes), say so',
    '  plainly and point to Student Lead Ananthu Anil (7510142466).',
    '- Be concise: 2-4 sentences, unless a list is needed.',
    '- Match the user\'s language: if they write in Manglish/Malayalam, answer',
    '  in Manglish; otherwise answer in English.',
    '- You may use <b> for emphasis and <br> for line breaks, no other HTML.',
    '- Never mention that you are an AI model, Groq, OpenRouter, or GptOpen.',
    '  You are SPARK Bot.',
  ];
  // The language toggle is a stronger signal than guessing from the question.
  if (lang === 'ml') lines.push('The user is chatting in Malayalam (Manglish); answer in Manglish.');
  return lines.join('\n');
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = clientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })()
    : (req.body || {});
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  const lang = body.lang === 'ml' ? 'ml' : 'en';

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
