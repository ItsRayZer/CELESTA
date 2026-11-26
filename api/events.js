// GET    /api/events — public list of events, sorted by order (seeds the 5 current events on first read)
// POST   /api/events — create an event (write role only)
// PATCH  /api/events — update an event by slug (write role only). The slug never changes, so links keep working after a rename.
// DELETE /api/events?slug=... — delete (write role only). Blocked when registrations exist; hide the event instead.
import { Redis } from '@upstash/redis';
import { verify, canWrite, parseVal } from './admin-login.js';
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
    "about": "A fast, team-based quiz covering General Knowledge. Think quickly, trust your team, and outscore every other school.",
    "prize1": 2000,
    "prize2": 1000,
    "teamMin": 2,
    "teamMax": 2,
    "fee": "\u20b9100 per team",
    "duration": "\u2248 90 minutes",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "General Knowledge. The quiz consists of questions based on General Knowledge.",
      "Preliminary Round. The competition begins with a Preliminary Round, from which 5 teams are selected to compete in 4 further rounds.",
      "Highest total score wins. The team with the highest total score across all four rounds is declared the winner."
    ],
    "rules": [
      "Each team must consist of exactly 2 members.",
      "The registration fee is \u20b9100 per team.",
      "The quiz will consist of questions based on General Knowledge.",
      "Participants must answer within the given time limit.",
      "Electronic gadgets are strictly prohibited during the competition.",
      "Team members are not allowed to seek help from the audience.",
      "Any form of cheating or unfair practice will lead to disqualification.",
      "The competition will begin with a Preliminary Round, from which 5 teams will be selected.",
      "The shortlisted 5 teams will compete in 4 further rounds.",
      "The team with the highest total score across all four rounds will be declared the winner.",
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
    "rulesV": 5
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
      "Registration fee: \u20b9200 per team.",
      "The competition will consist of multiple rounds, each with a separate task.",
      "Each round will have a specific time limit, which must be strictly followed.",
      "Teams must solve all clues and complete the assigned tasks within the given time.",
      "All clues must be collected to complete the Treasure Hunt.",
      "Mobile phones are strictly prohibited during the competition.",
      "Participants must follow all instructions given by the coordinators.",
      "Sharing clues or answers with other teams is strictly prohibited.",
      "Participants must remain within the designated game area.",
      "Any form of cheating will result in disqualification.",
      "Damaging college property or disturbing others is strictly prohibited.",
      "Participants must maintain discipline throughout the competition.",
      "Teams unable to find the treasure within the allotted time must follow the additional instructions provided by the organisers.",
      "The team that collects all clues and finds the treasure first, while following all rules, will be declared the winner.",
      "Note: The organisers' decision will be final and binding."
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
    "rulesV": 5
  },
  {
    "slug": "prompting",
    "name": "Prompting",
    "tagline": "Craft the sharpest prompt and make AI deliver.",
    "about": "Prompt Match is a creative challenge in prompt engineering. You get a computer, an AI image-generation tool and the same reference image as everyone else. Recreate the image as closely as possible with carefully written prompts. Observe every detail — subject, colours, lighting, background, mood, camera angle, art style — and turn it into precise prompts. No technical background is needed, just a sharp eye and a way with words. Look closely. Describe carefully. Make it match.",
    "prize1": 1500,
    "prize2": 750,
    "teamMin": 1,
    "teamMax": 1,
    "fee": "\u20b950 per participant",
    "duration": "30 minutes",
    "when": "Fri, 27 Nov 2026 \u00b7 10 AM",
    "where": "Mar Augusthinose College, Ramapuram",
    "how": [
      "One task, 30 minutes. Everyone gets the same reference image and 30 minutes to recreate it with prompts.",
      "One AI tool only. Only the AI image-generation tool assigned by the organisers may be used; switching between AI tools is not allowed.",
      "Judging. The generated images are judged on similarity to the reference image; the closest match wins."
    ],
    "rules": [
      "Each participant must compete individually.",
      "The registration fee is \u20b950 per participant.",
      "The competition will test participants' prompt-writing skills using AI tools.",
      "Participants must complete the task within the allotted time of 30 minutes.",
      "A common reference image and task will be provided to all participants.",
      "Participants must use the assigned AI tool to generate an image resembling the reference image.",
      "Only AI tools approved by the organisers are permitted.",
      "Prompts must be written independently using creativity and imagination.",
      "Copying prompts from other participants or external sources is strictly prohibited.",
      "Mobile phones and unauthorised devices are not permitted.",
      "Switching between AI tools during the competition is strictly prohibited.",
      "Sharing or exchanging devices is not allowed.",
      "Any form of malpractice will result in disqualification.",
      "The judges' decision will be final and binding."
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
    "rulesV": 4
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
      "The reel must be created entirely within the competition time of 2 hours.",
      "Participants must shoot and edit the reel only within the college campus.",
      "The video should be of 30\u201390 seconds in length.",
      "The video format should be MP4, 9:16 portrait orientation, and a minimum resolution of 720p.",
      "Each team should submit only one reel.",
      "Participants can use their own voice-overs and background music, but copyrighted music is not allowed.",
      "Only the team members can shoot and edit the reel; no assistance from college staff, organisers or external persons is allowed.",
      "Pre-recorded videos or previously edited clips are strictly prohibited.",
      "Reels that are not created on the event theme will be disqualified.",
      "Editing must be completed within the allotted competition time.",
      "Dangerous stunts or activities that disrupt the fest are strictly prohibited.",
      "Offensive, inappropriate or disrespectful content is strictly prohibited.",
      "Participants must not post the reel on any social media platform before the results are announced.",
      "The college reserves the right to use, share, publish or reproduce the submitted reels on its official social media platforms, website and other promotional materials.",
      "The organisers' decision will be final.",
      "Teams must report to the venue at the reporting time."
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
    "rulesV": 4
  }
];

// The Treasure Hunt phone ban (official PDF rules, rulesV 5, rule 7).
// It must stay live no matter what an admin customises (R3-m32): any
// served Treasure Hunt ruleset that lacks it gets it appended.
const PHONE_BAN_RULE = 'Mobile phones are strictly prohibited during the competition.';
function ensurePhoneBan(e) {
  if (e.slug !== 'treasure-hunt' || !Array.isArray(e.rules)) return false;
  // A rule that ALLOWS a phone contradicts the ban and must go first,
  // or the served ruleset tells students both "phones banned" and "one
  // phone allowed" (the round-3 m32 regression: stale rulesV 4 set +
  // appended ban left the old "one mobile phone" rule in place).
  const before = e.rules.length;
  e.rules = e.rules.filter(function (r) {
    const t = String(r).toLowerCase();
    return !(t.includes('mobile phone') && (t.includes('only one') || t.includes('allowed') || t.includes('navigation')));
  });
  const removed = e.rules.length !== before;
  if (e.rules.some(function (r) { return String(r).toLowerCase().includes('mobile phones are strictly prohibited'); })) return removed;
  e.rules = e.rules.slice();
  e.rules.splice(6, 0, PHONE_BAN_RULE);
  return true;
}

export async function loadEvents(options) {
  // options: { allowWrite, strict }
  // - Default (public) path: read-only, non-strict. NEVER writes to Redis
  //   (no seeding, no normalize/rulesV migration) and returns only what is
  //   stored; on a Redis error it falls back to DEFAULT_EVENTS.
  // - { allowWrite: true, strict: true }: admin write paths only. Seeding
  //   and the one-time migrations run here, behind admin auth, and a Redis
  //   error THROWS so the caller fails honestly (register.js turns a
  //   thrown error into a 500) instead of silently serving stale defaults.
  const allowWrite = !!(options && options.allowWrite);
  const strict = !!(options && options.strict);
  const defaultsCopy = () => DEFAULT_EVENTS.map(e => JSON.parse(JSON.stringify(e)))
    .sort((a, b) => (a.order || 99) - (b.order || 99) || String(a.name).localeCompare(String(b.name)));
  let vals;
  try {
    vals = await redis.hvals('celesta:events');
  } catch (e) {
    if (strict) throw e;
    // Redis down / rate-limited: serve built-in defaults so the public
    // site and registration keep working instead of a 500.
    return defaultsCopy();
  }
  if (!vals || !vals.length) {
    if (!allowWrite) return defaultsCopy();
    const obj = {};
    DEFAULT_EVENTS.forEach(e => { obj[e.slug] = JSON.stringify(e); });
    try { await redis.hset('celesta:events', obj); }
    catch (e) { if (strict) throw e; }
    vals = Object.values(obj);
  }
  const list = vals.map(v => parseVal(v)).filter(Boolean);
  list.sort((a, b) => (a.order || 99) - (b.order || 99) || String(a.name).localeCompare(String(b.name)));
  if (!allowWrite) return list;
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
  // rules. One-time: a stored event whose rules are OLDER than the
  // official set takes the official RULES (and rulesV) only (#9). Fee,
  // team size, duration, about, how and reqs are admin-owned and are
  // never clobbered by this migration. A stored rulesV HIGHER than the
  // default is newer, not stale — it is left alone, never downgraded.
  const defBySlug = {};
  DEFAULT_EVENTS.forEach(d => { defBySlug[d.slug] = d; });
  for (const e of list) {
    const d = defBySlug[e.slug];
    // R3-m32 (fixed): an admin's own custom rules are NEVER replaced.
    // A ruleset is STALE, not custom, when its rulesV is BELOW the
    // official set — the old rulesV 4 set differs from the default
    // rulesV 5 set precisely because it is old, not because an admin
    // customised it (the round-3 "differing = custom" check wrongly
    // treated that stale set as custom, so it was never upgraded and
    // the appended phone ban contradicted its old "one phone allowed"
    // rule). Custom means: rulesCustom flag set, OR rulesV at/above
    // the default with differing content (an admin edited the
    // current-version rules). A custom ruleset keeps its own wording —
    // only the Treasure Hunt phone ban is enforced on top of it.
    const isStale = !!(d && (e.rulesV || 0) < (d.rulesV || 0));
    const looksCustom = e.rulesCustom || (!isStale && d && Array.isArray(e.rules) && JSON.stringify(e.rules) !== JSON.stringify(d.rules || []));
    if (looksCustom) { if (ensurePhoneBan(e)) dirty = true; continue; }
    if (isStale) {
      e.rules = (d.rules || []).slice();
      e.rulesV = d.rulesV; dirty = true;
    }
    if (ensurePhoneBan(e)) dirty = true;
  }
  if (dirty) {
    const obj = {};
    list.forEach(e => { obj[e.slug] = JSON.stringify(e); });
    try { await redis.hset('celesta:events', obj); }
    catch (e) { if (strict) throw e; }
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
  const stripCRLF = (s) => String(s).replace(/[\r\n]+/g, ' ');
  const str = (k, d = '', max = 200) => {
    const v = typeof body[k] === 'string' ? body[k].trim() : (existing ? existing[k] : d);
    // Strip CR/LF from every string field: the event name lands in the
    // email Subject, so a \r or \n in any stored field is an SMTP header
    // injection hole. Replaced with a space, not dropped, so words stay apart.
    return typeof v === 'string' ? stripCRLF(v).slice(0, max) : v;
  };
  const num = (k, d = 0) => { const n = Number(body[k]); return Number.isFinite(n) ? n : (existing ? existing[k] : d); };
  const arr = (k, maxItem = 500, maxLen = 50) => (Array.isArray(body[k]) ? body[k].map(String).map(s => stripCRLF(s.trim()).slice(0, maxItem)).filter(Boolean).slice(0, maxLen) : (existing ? existing[k] || [] : []));
  const bool = (k, d = true) => (typeof body[k] === 'boolean' ? body[k] : (existing ? existing[k] : d));
  e.name = str('name', '', 100);
  if (!e.name) throw new Error('Name is required');
  e.tagline = str('tagline', '', 200);
  e.about = str('about', '', 2000);
  e.prize1 = Math.min(1000000, Math.max(0, Math.round(num('prize1'))));
  e.prize2 = Math.min(1000000, Math.max(0, Math.round(num('prize2'))));
  e.teamMin = Math.min(20, Math.max(1, Math.round(num('teamMin', 1))));
  e.teamMax = Math.min(20, Math.max(e.teamMin, Math.round(num('teamMax', e.teamMin))));
  // Fee format: "₹<amount> per team|participant". parseFee() takes the
  // first number in the string, so "2 members ₹100" would parse as 2 — a
  // malformed fee must never be stored (#42): reject it with 400 and
  // name the required format instead of silently keeping the old one.
  // The same applies to a non-string fee or an explicit empty string
  // (#31): an absent fee keeps the old value, but a fee that IS sent
  // must be valid text (or empty to clear it) — never silently ignored.
  let feeVal;
  if (body.fee === undefined) {
    feeVal = existing ? (existing.fee || '') : '';
  } else if (typeof body.fee !== 'string') {
    throw new Error('Fee must be text like "₹100 per team" or "₹50 per participant"');
  } else {
    feeVal = str('fee', '', 100);
    if (feeVal !== '' && !/^₹\d+ per (team|participant)$/.test(feeVal)) {
      throw new Error('Fee must be like "₹100 per team" or "₹50 per participant"');
    }
  }
  e.fee = feeVal;
  e.rulesV = num('rulesV', 0);
  e.duration = str('duration', '', 100);
  e.when = str('when', 'Fri, 27 Nov 2026 \u00b7 10 AM', 100);
  e.where = str('where', 'Mar Augusthinose College, Ramapuram', 200);
  e.how = arr('how');
  e.rules = arr('rules');
  e.reqs = arr('reqs');
  // R3-m32: when the admin explicitly supplies rules, record whether
  // they are their own custom set (differ from the official default for
  // this slug). A custom set is never masked by the GET override or the
  // loadEvents migration. Rules equal to the default are not custom,
  // and their rulesV is raised to the default so they are never
  // "stale". When rules are not supplied, keep the stored flag.
  if (Array.isArray(body.rules)) {
    const d = DEFAULT_EVENTS.find(function (x) { return x.slug === (existing ? existing.slug : slugify(body.name || '')); });
    const isDefault = d && JSON.stringify(e.rules) === JSON.stringify(d.rules || []);
    e.rulesCustom = !isDefault;
    if (isDefault && d) e.rulesV = d.rulesV;
  } else if (existing) {
    e.rulesCustom = !!existing.rulesCustom;
  }
  e.order = Math.min(1000, Math.max(-100, num('order', 99)));
  e.visible = bool('visible', true);
  e.regOpen = bool('regOpen', true);
  return e;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Events change rarely; the public site fetches this on every page load.
    // 10s server cache + stale-while-revalidate keeps it fast without
    // ever showing a stale event for long.
    // Authenticated (admin) responses include hidden events, so they must
    // never be shared-cached: only the public variant gets s-maxage.
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const role = token ? verify(token) : null;
    if (role) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    }
    res.setHeader('Vary', 'Authorization');
    try {
      const events = await loadEvents();
      // Read-time rulesV override (#14, narrowed #9): a stored event
      // whose rules are OLDER than the official set serves the official
      // RULES in the response, so the public site shows the correct PDF
      // rules immediately (Treasure Hunt rule 7, the phone ban, rulesV 5).
      // RULES ONLY — fee, team size, duration and about are never
      // touched here, so an admin-set fee or team size is never masked
      // from the admin GET and the fee source never splits. A stored
      // rulesV higher than the default is newer, not stale, and is left
      // alone. This does NOT write to Redis (the public path never
      // writes); the stored copy is migrated by the admin write paths
      // the next time an admin saves an event.
      const defBySlug = {};
      DEFAULT_EVENTS.forEach(d => { defBySlug[d.slug] = d; });
      for (const e of events) {
        const d = defBySlug[e.slug];
        // R3-m32 (fixed): an admin's own custom rules are never masked
        // by this override. A ruleset is STALE, not custom, when its
        // rulesV is BELOW the official set — the old rulesV 4 set
        // differs from the default rulesV 5 set because it is old, not
        // because an admin customised it. Custom means: rulesCustom
        // flag set, OR rulesV at/above the default with differing
        // content. The Treasure Hunt phone ban is enforced on top of
        // any served ruleset, custom or not.
        const isStale = !!(d && (e.rulesV || 0) < (d.rulesV || 0));
        const looksCustom = e.rulesCustom || (!isStale && d && Array.isArray(e.rules) && JSON.stringify(e.rules) !== JSON.stringify(d.rules || []));
        if (looksCustom) { ensurePhoneBan(e); continue; }
        if (d && (e.rulesV || 0) < (d.rulesV || 0)) {
          e.rules = (d.rules || []).slice();
          e.rulesV = d.rulesV;
        }
        ensurePhoneBan(e);
      }
      // One lookup for all custom posters: pages use this flag to skip the
      // /api/poster call entirely when no custom poster exists. That call
      // 404s and burns a Redis command per event per student, so skipping
      // it is the single biggest free-tier saving on fest day.
      // Keys only (HKEYS): the base64 poster bodies are ~900KB each and
      // would be fetched on every public events call for no reason.
      let posterSlugs = new Set();
      try { posterSlugs = new Set(await redis.hkeys('celesta:posters') || []); } catch {}
      // Per-event registration counts (#37): one scan, so the events
      // page can show how many teams are in for each event. Invalid
      // registrations are excluded (they are not participants).
      const regCounts = {};
      try {
        const regVals = await redis.hvals('celesta:regs');
        for (const v of (regVals || [])) {
          const r = parseVal(v);
          if (r && !r.invalid) {
            const k = r.eventSlug || r.event;
            regCounts[k] = (regCounts[k] || 0) + 1;
          }
        }
      } catch { /* counts stay 0; the list is the priority */ }
      // Unauthenticated callers see listed events only; a logged-in admin
      // (read or write token) sees hidden ones too, for the admin UI.
      const list = (role ? events : events.filter(e => e.visible))
        .map(e => ({ ...e, poster: posterSlugs.has(e.slug), regCount: regCounts[e.slug] || regCounts[e.name] || 0 }));
      return res.status(200).json({ events: list });
    } catch (e) {
      console.error('events list failed, serving defaults', e);
      // Authenticated callers must not silently get stale defaults
      // (V3-m09): an admin loading the dashboard would see built-in
      // events with no warning they are stale. Return 503 so the admin
      // UI surfaces the outage. The public site still gets the defaults
      // so students see the events even if storage is down.
      if (role) {
        return res.status(503).json({ error: 'Events unavailable — storage is down. Please try again.' });
      }
      return res.status(200).json({ events: DEFAULT_EVENTS.filter(e => e.visible) });
    }
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const role = verify(token);
  if (!canWrite(role)) return res.status(403).json({ error: 'Write access required' });

  if (req.method === 'POST') {
    try {
      const events = await loadEvents({ allowWrite: true, strict: true });
      let slug = slugify(req.body && req.body.name);
      if (events.some(e => e.slug === slug)) slug = slug + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let e;
      try { e = cleanEvent(req.body || {}, null); }
      catch (err) { return res.status(400).json({ error: err.message || 'Invalid event' }); }
      // Duplicate name (#43): two events with the same name would
      // collide in the registration form and the admin UI.
      const nameKey = String(e.name || '').trim().toLowerCase();
      if (events.some(function (ev) { return String(ev.name || '').trim().toLowerCase() === nameKey; })) {
        return res.status(400).json({ error: 'An event named "' + e.name + '" already exists' });
      }
      e.slug = slug;
      await redis.hset('celesta:events', { [slug]: JSON.stringify(e) });
      await appendLog({
        actor: role, action: 'Event created',
        detail: e.name + ' (1st ₹' + e.prize1 + ' / 2nd ₹' + e.prize2 + ', Team ' + e.teamMin + '–' + e.teamMax + ')',
        target: { kind: 'event', id: slug, name: e.name },
        undo: { kind: 'event-delete', slug, name: e.name },
      }, req);
      return res.status(200).json({ ok: true, event: e });
    } catch (e) {
      console.error('events handler failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const events = await loadEvents({ allowWrite: true, strict: true });
      const slug = req.body && req.body.slug;
      const old = events.find(e => e.slug === slug);
      if (!old) return res.status(404).json({ error: 'Event not found' });
      let e;
      try { e = cleanEvent(req.body || {}, old); }
      catch (err) { return res.status(400).json({ error: err.message || 'Invalid event' }); }
      e.slug = old.slug; // slug never changes — links keep working after a rename
      // Duplicate name on rename (#43): another event already has it.
      const nameKey = String(e.name || '').trim().toLowerCase();
      if (old.name !== e.name && events.some(function (ev) { return ev.slug !== old.slug && String(ev.name || '').trim().toLowerCase() === nameKey; })) {
        return res.status(400).json({ error: 'An event named "' + e.name + '" already exists' });
      }
      // Shrinking team limits must not strand existing registrations
      // (#34): refuse when a registered team's size falls outside the
      // new limits, instead of leaving them in an event they no longer fit.
      if (e.teamMin !== old.teamMin || e.teamMax !== old.teamMax) {
        try {
          const regVals = await redis.hvals('celesta:regs');
          const stranded = (regVals || []).filter(function (v) {
            const r = parseVal(v);
            return r && !r.invalid && (r.eventSlug === old.slug || r.event === old.name) && (Number(r.team) < e.teamMin || Number(r.team) > e.teamMax);
          });
          if (stranded.length) {
            return res.status(400).json({ error: stranded.length + ' registration(s) have a team size outside ' + e.teamMin + '–' + e.teamMax + '. Fix or remove them first.' });
          }
        } catch (e2) {
          // A scan failure must not let a bad shrink through.
          console.error('events PATCH team-limit check failed', e2);
          return res.status(503).json({ error: 'Could not check existing registrations — try again' });
        }
      }
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
          actor: role, action: 'Event updated',
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
      console.error('events handler failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  if (req.method === 'DELETE') {
    if (role !== 'lead') return res.status(403).json({ error: 'Tech Lead access required' });
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'Missing slug' });
    try {
      const events = await loadEvents({ allowWrite: true, strict: true });
      const ev = events.find(e => e.slug === slug);
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      // Blocked when registrations exist — hide the event instead of deleting it.
      const regVals = await redis.hvals('celesta:regs');
      const n = (regVals || []).filter(v => {
        const r = parseVal(v);
        return r && (r.eventSlug === slug || r.event === ev.name);
      }).length;
      if (n > 0) return res.status(409).json({ error: 'This event has ' + n + ' registration(s). Hide it instead of deleting.' });
      // Re-check immediately before the delete (#44): a registration
      // created between the first count and here must block the delete,
      // or it becomes an orphan pointing at a deleted event.
      const regVals2 = await redis.hvals('celesta:regs');
      const n2 = (regVals2 || []).filter(v => {
        const r = parseVal(v);
        return r && (r.eventSlug === slug || r.event === ev.name);
      }).length;
      if (n2 > 0) return res.status(409).json({ error: 'This event has ' + n2 + ' registration(s). Hide it instead of deleting.' });
      // Save the custom poster before dropping it (#26): the undo
      // payload carries the key, and applyUndo restores the poster from it.
      let posterKey = null;
      try {
        const poster = await redis.hget('celesta:posters', slug);
        if (poster) {
          posterKey = 'del-' + slug;
          await redis.set('celesta:poster-prev:' + posterKey, poster);
        }
      } catch { /* poster restore is best-effort; the event delete proceeds */ }
      await redis.hdel('celesta:events', slug);
      await redis.hdel('celesta:posters', slug); // drop its custom poster too
      await appendLog({
        actor: role, action: 'Event deleted',
        detail: ev.name + ' (custom poster removed too)',
        target: { kind: 'event', id: slug, name: ev.name },
        undo: { kind: 'event-add', event: ev, posterKey: posterKey },
      }, req);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('events handler failed', e);
      return res.status(500).json({ error: 'Storage unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
