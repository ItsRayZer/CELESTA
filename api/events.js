// GET    /api/events — public list of events, sorted by order (seeds the 5 current events on first read)
// POST   /api/events — create an event (write role only)
// PATCH  /api/events — update an event by slug (write role only). The slug never changes, so links keep working after a rename.
// DELETE /api/events?slug=... — delete (write role only). Blocked when registrations exist; hide the event instead.
import { Redis } from '@upstash/redis';
import { verify, parseVal } from './admin-login.js';
import { appendLog } from './activity-log.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const DEFAULT_EVENTS = [
    {
    "slug": "quiz",
    "name": "Quiz",
    "tagline": "Battle of wits across tech, science and general knowledge.",
    "about": "A fast, team-based quiz covering General Knowledge and Technology. Think quickly, trust your team, and outscore every other school.",
    "prize1": 2000,
    "prize2": 1000,
    "teamMin": 2,
    "teamMax": 2,
    "fee": "\u20b950 per team",
    "duration": "\u2248 90 minutes",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "General Knowledge and Technology. The quiz consists of questions based on General Knowledge and Technology.",
      "Multiple rounds. Teams are shortlisted after each round based on performance; only shortlisted teams move to the next round.",
      "Final round. The team with the highest score in the final round is declared the winner."
    ],
    "rules": [
      "Each team must consist of exactly 2 members.",
      "The registration fee is \u20b950 per team.",
      "Participants must answer within the given time limit.",
      "Electronic gadgets are strictly prohibited during the competition.",
      "Team members are not allowed to seek help from the audience.",
      "Any form of cheating or unfair practice will lead to disqualification.",
      "The quiz master's decision will be final."
    ],
    "reqs": [
      "Valid school ID card for every participant.",
      "Report at the registration desk by 9:30 AM.",
      "Open to school students only. One team per student, per event."
    ],
    "order": 3,
    "visible": true,
    "regOpen": true,
    "rulesV": 3
  },
  {
    "slug": "treasure-hunt",
    "name": "Treasure Hunt",
    "tagline": "Race across the campus solving clues to find the treasure.",
    "about": "Teams receive a first clue and race across the campus, solving clues and completing tasks that lead to the next checkpoint — and finally to the treasure.",
    "prize1": 6000,
    "prize2": 0,
    "teamMin": 4,
    "teamMax": 4,
    "fee": "\u20b9200 per team",
    "duration": "\u2248 2 hours",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "Multiple rounds. The competition will be conducted in multiple rounds, with a separate task in each round.",
      "Separate time limits. Each round will have a separate time limit, which must be strictly followed.",
      "Solve the clues. Teams solve the clues and complete the tasks within the given time.",
      "Collect all clues. Teams must collect all the clues to complete the Treasure Hunt.",
      "Finish first. The team that collects all the clues and finds the treasure first, by following all the rules, is declared the winner."
    ],
    "rules": [
      "Each team must consist of exactly 4 members.",
      "The registration fee is \u20b9200 per team.",
      "Mobile phones are strictly prohibited during the game.",
      "Participants must follow the instructions given by the coordinators.",
      "Sharing clues or answers with other teams is not allowed.",
      "Participants must not leave the designated game area.",
      "Any form of cheating will lead to disqualification.",
      "Damaging college property or disturbing others is strictly prohibited.",
      "Participants must maintain discipline throughout the competition.",
      "Teams that fail to find the treasure within the allotted time must follow the additional instructions given by the organisers.",
      "The decision of the organisers will be final."
    ],
    "reqs": [
      "Valid school ID card for every participant.",
      "Report at the registration desk by 9:30 AM.",
      "Open to school students only. One team per student, per event.",
      "Comfortable footwear and a water bottle."
    ],
    "order": 4,
    "visible": true,
    "regOpen": true,
    "rulesV": 3
  },
  {
    "slug": "prompting",
    "name": "Prompting",
    "tagline": "Craft the sharpest prompt and make AI deliver.",
    "about": "Test how well you can talk to AI. You will be given a task, and you must write a prompt that makes the AI give the best answer — accurate, creative and to the point.",
    "prize1": 1500,
    "prize2": 750,
    "teamMin": 1,
    "teamMax": 1,
    "fee": "\u20b9100 per participant",
    "duration": "30 minutes",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "One task, 30 minutes. All participants are given the same task and 30 minutes to complete it.",
      "One AI tool only. Only the AI tool assigned by the organisers may be used; switching between AI tools is not allowed.",
      "Judging. The AI output is evaluated on creativity, accuracy and relevance; the quality and clarity of the prompts is also considered."
    ],
    "rules": [
      "Each participant must compete individually.",
      "Only the AI tools permitted by the organisers can be used.",
      "Participants must use their own creativity and ideas while writing prompts.",
      "Copying prompts from other participants or external sources is strictly prohibited.",
      "Participants must not use mobile phones or other devices except those permitted by the organisers.",
      "Participants must not switch between different AI tools; they must use only the AI tool assigned by the organisers.",
      "Sharing or switching devices during the competition is strictly prohibited.",
      "The decision of the judges will be final.",
      "Any form of malpractice will lead to disqualification."
    ],
    "reqs": [
      "Valid school ID card for every participant.",
      "Report at the registration desk by 9:30 AM.",
      "Open to school students only. One team per student, per event.",
      "Use only the AI tool and devices assigned by the organisers."
    ],
    "order": 2,
    "visible": true,
    "regOpen": true,
    "rulesV": 3
  },
  {
    "slug": "idea-presentation",
    "name": "Idea Presentation",
    "tagline": "Pitch a bold idea to the judges.",
    "about": "Bring an original idea — a product, app, or solution to a real problem — and present it to a panel of judges. Clear thinking and a confident pitch win.",
    "prize1": 2000,
    "prize2": 1000,
    "teamMin": 2,
    "teamMax": 4,
    "duration": "\u2248 7 minutes per team",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "Pitch. 5 minutes to present your idea with slides.",
      "Q&A. 2 minutes of questions from the judges.",
      "Results. Top teams are announced at the closing session."
    ],
    "rules": [
      "Maximum 8 slides; the idea must be original.",
      "Every team member should take part in the presentation.",
      "Time limits are strict — the pitch is stopped at 5 minutes.",
      "Judges' and organizers' decisions are final.",
      "Misconduct or cheating leads to disqualification."
    ],
    "reqs": [
      "Valid school ID card for every participant.",
      "Report at the registration desk by 9:30 AM.",
      "Open to school students only. One team per student, per event.",
      "Your slides (PPT / PDF) on a pen drive, plus a backup copy by email.",
      "Any prototype or demo you want to show (optional)."
    ],
    "order": 5,
    "visible": false,
    "regOpen": true
  },
  {
    "slug": "reels-competition",
    "name": "Reels Competition",
    "tagline": "Tell a story in under a minute.",
    "about": "Make a short reel on the spot. Plan, shoot and edit it within the competition time — creativity and storytelling decide the winner.",
    "prize1": 2000,
    "prize2": 1000,
    "teamMin": 2,
    "teamMax": 2,
    "fee": "\u20b9100 per team",
    "duration": "\u2248 2 hours",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "Create in 2 hours. The reel must be created entirely within the competition time (2 hours).",
      "Shoot on campus. All footage must be shot within the fest venue/campus, using your own mobile phone and equipment.",
      "Submit one reel. Each team submits only one reel; your own voice-overs are allowed.",
      "Judged on creativity and originality, video quality and editing, content and presentation, and overall impact."
    ],
    "rules": [
      "Each team must consist of exactly 2 members.",
      "The registration fee is ₹100 per team.",
      "No pre-recorded videos or previously edited clips are allowed.",
      "No assistance from college staff, organisers, or external persons is allowed.",
      "Participants must shoot and edit their reels independently.",
      "Offensive, inappropriate, or disrespectful content is strictly prohibited.",
      "Dangerous stunts or activities that disrupt the fest are not allowed.",
      "The organisers' decision is final.",
      "The college reserves the right to use, share, publish or reproduce the submitted reels on its official social media platforms, website and other promotional materials."
    ],
    "reqs": [
      "Valid school ID card for every participant.",
      "Report at the registration desk by 9:30 AM.",
      "Open to school students only. One team per student, per event.",
      "Your own mobile phone and equipment.",
      "Video: 30\u201390 seconds, MP4, 9:16 portrait, minimum 720p.",
      "Editing must be completed within the allotted competition time.",
      "Basic editing apps and copyright-safe audio are permitted."
    ],
    "order": 1,
    "visible": true,
    "regOpen": true,
    "rulesV": 3
  }
];

export async function loadEvents() {
  let vals = await redis.hvals('celesta:events');
  if (!vals || !vals.length) {
    const obj = {};
    DEFAULT_EVENTS.forEach(e => { obj[e.slug] = JSON.stringify(e); });
    await redis.hset('celesta:events', obj);
    vals = Object.values(obj);
  }
  const list = vals.map(v => parseVal(v)).filter(Boolean);
  list.sort((a, b) => (a.order || 99) - (b.order || 99) || String(a.name).localeCompare(String(b.name)));
  // One-time correction of stale wording from when the fest was inter-college:
  // fix the stored copy in place so the site shows the right text. After the
  // first run nothing is stale anymore, so this never writes again.
  let dirty = false;
  for (const e of list) if (normalizeEvent(e)) dirty = true;
  // The one-time HIDDEN/RESTORED/POSTER_ORDER/PRIZE_FIXES forcing blocks
  // below were removed 20 Nov 2026: they already ran, and leaving them in
  // meant every read silently overwrote admin edits (reorder, Treasure Hunt
  // prizes, and the Visible checkbox for Idea Presentation / Reels). The
  // stored copy already holds the right values, and the admin UI is now
  // the source of truth for order, prizes, and visibility.
  // Real rules (20 Nov 2026): the official rules replace the sample
  // rules. One-time: a stored event whose rulesV differs from the default
  // takes the official
  // team size, fee, duration and how/rules/reqs from DEFAULT_EVENTS.
  // Admin edits after this stick, because rulesV is then already at the default.
  const defBySlug = {};
  DEFAULT_EVENTS.forEach(d => { defBySlug[d.slug] = d; });
  for (const e of list) {
    const d = defBySlug[e.slug];
    if (d && e.rulesV !== d.rulesV) {
      e.teamMin = d.teamMin; e.teamMax = d.teamMax; e.fee = d.fee;
      e.duration = d.duration; e.about = d.about;
      e.how = (d.how || []).slice(); e.rules = (d.rules || []).slice(); e.reqs = (d.reqs || []).slice();
      e.rulesV = d.rulesV; dirty = true;
    }
  }
  if (dirty) {
    const obj = {};
    list.forEach(e => { obj[e.slug] = JSON.stringify(e); });
    await redis.hset('celesta:events', obj);
    // The order migration above can change sort keys, so re-sort before return.
    list.sort((a, b) => (a.order || 99) - (b.order || 99) || String(a.name).localeCompare(String(b.name)));
  }
  return list;
}

// Rewrites wording left over from the inter-college version. Returns true if
// anything changed. The venue name ("Mar Augusthinose College") is correct
// and is never touched.

// The one-time HIDDEN/RESTORED/POSTER_ORDER/PRIZE_FIXES constants were
// removed 20 Nov 2026 (see loadEvents): they already ran, and keeping the
// forcing meant every read silently overwrote admin edits. The stored copy
// already holds the right values (Idea Presentation hidden, Reels visible,
// poster order 1-5, Treasure Hunt 6000 winner-takes-all), and the admin UI
// is now the source of truth.
const STALE_FIXES = [
  ['Valid college ID card', 'Valid school ID card'],
  ['outscore every other college', 'outscore every other school'],
  ['Fri, 20 Nov 2026', 'Fri, 27 Nov 2026'],
];
function normalizeEvent(e) {
  let changed = false;
  const fixText = (s) => {
    let v = s;
    for (const [a, b] of STALE_FIXES) v = v.split(a).join(b);
    if (v !== s) changed = true;
    return v;
  };
  for (const k of ['about', 'tagline', 'when']) {
    if (typeof e[k] === 'string') e[k] = fixText(e[k]);
  }
  for (const k of ['how', 'rules', 'reqs']) {
    if (Array.isArray(e[k])) e[k] = e[k].map(fixText);
  }
  return changed;
}

function slugify(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
}

function cleanEvent(body, existing) {
  const e = existing ? { ...existing } : {};
  // Caps mirror register.js: a write token must not be able to store
  // multi-MB blobs that are then served to every public visitor.
  const str = (k, d = '', max = 200) => {
    const v = typeof body[k] === 'string' ? body[k].trim() : (existing ? existing[k] : d);
    return typeof v === 'string' ? v.slice(0, max) : v;
  };
  const num = (k, d = 0) => { const n = Number(body[k]); return Number.isFinite(n) ? n : (existing ? existing[k] : d); };
  const arr = (k, maxItem = 500, maxLen = 50) => (Array.isArray(body[k]) ? body[k].map(String).map(s => s.trim().slice(0, maxItem)).filter(Boolean).slice(0, maxLen) : (existing ? existing[k] || [] : []));
  const bool = (k, d = true) => (typeof body[k] === 'boolean' ? body[k] : (existing ? existing[k] : d));
  e.name = str('name', '', 100);
  if (!e.name) throw new Error('Name is required');
  e.tagline = str('tagline', '', 200);
  e.about = str('about', '', 2000);
  e.prize1 = Math.max(0, Math.round(num('prize1')));
  e.prize2 = Math.max(0, Math.round(num('prize2')));
  e.teamMin = Math.max(1, Math.round(num('teamMin', 1)));
  e.teamMax = Math.max(e.teamMin, Math.round(num('teamMax', e.teamMin)));
  e.fee = str('fee', '', 100);
  e.rulesV = num('rulesV', 0);
  e.duration = str('duration', '', 100);
  e.when = str('when', 'Fri, 27 Nov 2026 \u00b7 10 AM', 100);
  e.where = str('where', 'Mar Augusthinose College, Ramapuram', 200);
  e.how = arr('how');
  e.rules = arr('rules');
  e.reqs = arr('reqs');
  e.order = num('order', 99);
  e.visible = bool('visible', true);
  e.regOpen = bool('regOpen', true);
  return e;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Events change rarely; the public site fetches this on every page load.
    // 60s server cache + stale-while-revalidate keeps it fast without
    // ever showing a stale event for long.
    // Authenticated (admin) responses include hidden events, so they must
    // never be shared-cached: only the public variant gets s-maxage.
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const role = token ? verify(token) : null;
    if (role) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    }
    res.setHeader('Vary', 'Authorization');
    try {
      const events = await loadEvents();
      // One lookup for all custom posters: pages use this flag to skip the
      // /api/poster call entirely when no custom poster exists. That call
      // 404s and burns a Redis command per event per student, so skipping
      // it is the single biggest free-tier saving on fest day.
      let posters = {};
      try { posters = await redis.hgetall('celesta:posters') || {}; } catch {}
      // Unauthenticated callers see listed events only; a logged-in admin
      // (read or write token) sees hidden ones too, for the admin UI.
      const list = (role ? events : events.filter(e => e.visible))
        .map(e => ({ ...e, poster: !!posters[e.slug] }));
      return res.status(200).json({ events: list });
    } catch (e) {
      return res.status(200).json({ events: DEFAULT_EVENTS.filter(e => e.visible) });
    }
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (verify(token) !== 'write') return res.status(403).json({ error: 'Write access required' });

  if (req.method === 'POST') {
    try {
      const events = await loadEvents();
      let slug = slugify(req.body && req.body.name);
      if (events.some(e => e.slug === slug)) slug = slug + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const e = cleanEvent(req.body || {}, null);
      e.slug = slug;
      await redis.hset('celesta:events', { [slug]: JSON.stringify(e) });
      await appendLog({
        actor: 'write', action: 'Event created',
        detail: e.name + ' (1st ₹' + e.prize1 + ' / 2nd ₹' + e.prize2 + ', Team ' + e.teamMin + '–' + e.teamMax + ')',
        target: { kind: 'event', id: slug, name: e.name },
        undo: { kind: 'event-delete', slug, name: e.name },
      }, req);
      return res.status(200).json({ ok: true, event: e });
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid event' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const events = await loadEvents();
      const slug = req.body && req.body.slug;
      const old = events.find(e => e.slug === slug);
      if (!old) return res.status(404).json({ error: 'Event not found' });
      const e = cleanEvent(req.body || {}, old);
      e.slug = old.slug; // slug never changes — links keep working after a rename
      await redis.hset('celesta:events', { [slug]: JSON.stringify(e) });
      const evBits = [];
      if (old.name !== e.name) evBits.push('name ' + old.name + ' → ' + e.name);
      if (old.prize1 !== e.prize1 || old.prize2 !== e.prize2) evBits.push('prizes ₹' + old.prize1 + '/' + old.prize2 + ' → ₹' + e.prize1 + '/' + e.prize2);
      if (old.teamMin !== e.teamMin || old.teamMax !== e.teamMax) evBits.push('team ' + old.teamMin + '–' + old.teamMax + ' → ' + e.teamMin + '–' + e.teamMax);
      if (old.visible !== e.visible) evBits.push('visible ' + (old.visible ? 'yes' : 'no') + ' → ' + (e.visible ? 'yes' : 'no'));
      if (old.regOpen !== e.regOpen) evBits.push('registration ' + (old.regOpen ? 'open' : 'closed') + ' → ' + (e.regOpen ? 'open' : 'closed'));
      if (old.tagline !== e.tagline || old.about !== e.about || old.duration !== e.duration || old.when !== e.when || old.where !== e.where || JSON.stringify(old.how) !== JSON.stringify(e.how) || JSON.stringify(old.rules) !== JSON.stringify(e.rules) || JSON.stringify(old.reqs) !== JSON.stringify(e.reqs) || old.order !== e.order) evBits.push('details edited');
      if (evBits.length) {
        await appendLog({
          actor: 'write', action: 'Event updated',
          detail: e.name + ': ' + evBits.join(', '),
          target: { kind: 'event', id: slug, name: e.name },
          undo: { kind: 'event-update', slug, before: old },
        }, req);
      }
      // If the event was renamed, update existing registrations so they stay matched to it.
      if (old.name !== e.name) {
        try {
          const regIds = await redis.zrange('celesta:reglist', 0, -1);
          if (regIds.length) {
            const vals = await redis.hmget('celesta:regs', ...regIds);
            const updates = {};
            vals.forEach((v, i) => {
              const r = parseVal(v);
              if (r && r.event === old.name && (r.eventSlug === slug || !r.eventSlug)) {
                r.event = e.name;
                updates[regIds[i]] = JSON.stringify(r);
              }
            });
            if (Object.keys(updates).length) await redis.hset('celesta:regs', updates);
          }
        } catch { /* rename still saved; registrations keep the old name */ }
      }
      return res.status(200).json({ ok: true, event: e });
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid event' });
    }
  }

  if (req.method === 'DELETE') {
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'Missing slug' });
    try {
      const events = await loadEvents();
      const ev = events.find(e => e.slug === slug);
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      // Blocked when registrations exist — hide the event instead of deleting it.
      const regVals = await redis.hvals('celesta:regs');
      const n = (regVals || []).filter(v => {
        const r = parseVal(v);
        return r && (r.eventSlug === slug || r.event === ev.name);
      }).length;
      if (n > 0) return res.status(409).json({ error: 'This event has ' + n + ' registration(s). Hide it instead of deleting.' });
      await redis.hdel('celesta:events', slug);
      await redis.hdel('celesta:posters', slug); // drop its custom poster too
      await appendLog({
        actor: 'write', action: 'Event deleted',
        detail: ev.name + ' (custom poster removed too)',
        target: { kind: 'event', id: slug, name: ev.name },
        undo: { kind: 'event-add', event: ev },
      }, req);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
