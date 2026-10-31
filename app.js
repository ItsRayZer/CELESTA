/* Celesta 2K26 static site — loader, countdown, pill morph, reveals, parallax, registration.
   NOTE: registration forms save to the visitor's browser localStorage only.
   The real registration backend lives on the CELESTA web artifact; this static
   mirror is honest about local-only storage. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Loader: fast, fades out into hero ---------- */
  var loader = document.getElementById("loader");
  function hideLoader() {
    if (!loader || loader.classList.contains("done")) return;
    loader.classList.add("done");
    setTimeout(function () { loader.remove(); }, 600);
  }
  if (loader) {
    if (reduced) { hideLoader(); }
    else {
      window.addEventListener("load", function () { setTimeout(hideLoader, 900); });
      setTimeout(hideLoader, 1500); /* hard cap: never block longer than ~1.5s */
    }
  }

  /* ---------- Countdown to 20 Nov 2026, 10:00 AM IST ---------- */
  var TARGET = new Date("2026-11-20T10:00:00+05:30").getTime();
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var cd = { d: document.getElementById("cd-d"), h: document.getElementById("cd-h"),
             m: document.getElementById("cd-m"), s: document.getElementById("cd-s") };
  var cdTimer = 0;
  function tick() {
    var diff = TARGET - Date.now(), d = 0, h = 0, m = 0, s = 0;
    if (diff > 0) {
      d = Math.floor(diff / 86400000);
      h = Math.floor((diff % 86400000) / 3600000);
      m = Math.floor((diff % 3600000) / 60000);
      s = Math.floor((diff % 60000) / 1000);
    }
    if (cd.d) cd.d.textContent = pad(d);
    if (cd.h) cd.h.textContent = pad(h);
    if (cd.m) cd.m.textContent = pad(m);
    if (cd.s) cd.s.textContent = pad(s);
  }
  if (cd.s) {
    tick(); cdTimer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", function () {
      clearInterval(cdTimer);
      if (!document.hidden) { tick(); cdTimer = setInterval(tick, 1000); }
    });
  }

  /* ---------- Pill: countdown in hero, liquid morph to menu on scroll ---------- */
  var pill = document.getElementById("pill");
  var hero = document.getElementById("top");
  if (pill && hero) {
    var want = true, busy = false, vh = window.innerHeight, rafP = 0;
    function apply() {
      var has = pill.classList.contains("countdown-mode");
      if (has === want) return;
      if (reduced) { pill.classList.toggle("countdown-mode", want); return; }
      busy = true;
      pill.classList.add("morphing");
      setTimeout(function () {
        pill.classList.toggle("countdown-mode", want);
        /* force reflow so the liquid-in animation restarts every time */
        void pill.offsetWidth;
        /* re-trigger animation on the now-visible element */
        var vis = want ? pill.querySelector(".p-count") : pill.querySelector(".p-menu");
        if (vis) { vis.style.animation = "none"; void vis.offsetWidth; vis.style.animation = ""; }
        setTimeout(function () {
          pill.classList.remove("morphing");
          busy = false;
          apply(); /* user kept scrolling during the morph: settle on the latest state */
        }, 420);
      }, 220);
    }
    function onScroll() {
      rafP = 0;
      want = window.scrollY < vh * 0.4 && hero.offsetParent !== null;
      if (!busy) apply();
    }
    window.addEventListener("scroll", function () {
      if (!rafP) rafP = requestAnimationFrame(onScroll);
    }, { passive: true });
    window.addEventListener("resize", function () { vh = window.innerHeight; }, { passive: true });
    onScroll();
    window.addEventListener("celesta:view", onScroll);
    window.addEventListener("load", function () { setTimeout(onScroll, 400); });
  }

  /* ---------- Anchor links: smooth scroll in JS (native smooth fights pinned scrub) ---------- */
  document.addEventListener("click", function (e) {
    var l = e.target.closest && e.target.closest('a[href^="#"], a[href^="/about#"]');
    if (!l) return;
    var href = l.getAttribute("href"), id = href.slice(href.indexOf("#") + 1);
    var onIndex = /(\/about|\/)$/i.test(location.pathname) || location.pathname.slice(-1) === "/";
    if (href.indexOf("/about#") === 0 && !onIndex) return;
    var t = id && document.getElementById(id);
    if (!t) return;
    e.preventDefault();
    var y = t.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y, behavior: reduced ? "auto" : "smooth" });
    if (history.replaceState) history.replaceState(null, "", "#" + id);
  });

  /* ---------- Scroll reveals ---------- */
  var revs = document.querySelectorAll(".reveal");
  if (revs.length && !reduced && "IntersectionObserver" in window) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); rio.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revs.forEach(function (el) { rio.observe(el); });
  } else {
    revs.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Gentle parallax (transform-only) ---------- */
  var plx = document.querySelectorAll("[data-plx]");
  if (plx.length && !reduced) {
    var ticking = false;
    function upd() {
      var vh = window.innerHeight;
      plx.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var p = (r.top + r.height / 2 - vh / 2) / vh; /* -0.5..0.5 */
        var sp = parseFloat(el.getAttribute("data-plx")) || 0.08;
        el.style.transform = "translate3d(0," + (-p * sp * vh).toFixed(1) + "px,0)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(upd); }
    }, { passive: true });
    upd();
  }

  /* ---------- Registration (localStorage; honest about it) ---------- */
  var form = document.getElementById("reg-form");
  if (form) {
    var teamSel = document.getElementById("in-team"), mem = document.getElementById("f-members");
    function syncMembers() {
      if (!teamSel || !mem) return;
      var n = parseInt(teamSel.value, 10) || 1;
      mem.hidden = n < 2;
      var lab = mem.querySelector("label");
      if (lab) lab.textContent = n < 2 ? "Other team members" : "Other team members (" + (n - 1) + " more)";
    }
    if (teamSel) { teamSel.addEventListener("change", syncMembers); syncMembers(); }
    /* clear red state as soon as the field is edited */
    form.addEventListener("input", function (e) {
      var f = e.target.closest && e.target.closest(".field");
      if (f) f.classList.remove("invalid");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true, first = null;
      function mark(id, good) {
        var f = document.getElementById("f-" + id);
        if (f) f.classList.toggle("invalid", !good);
        if (!good) { ok = false; if (!first) first = f; }
      }
      function val(id) { var el = document.getElementById("in-" + id); return el ? el.value.trim() : ""; }
      var name = val("name"), school = val("school"), phone = val("phone").replace(/\s+/g, ""), email = val("email"),
          team = parseInt(val("team"), 10), teamname = val("teamname"), members = val("members");
      var min = parseInt(form.getAttribute("data-min"), 10) || 1, max = parseInt(form.getAttribute("data-max"), 10) || 10;
      var list = members.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      mark("name", name.length >= 2);
      mark("school", school.length >= 2);
      mark("phone", /^[6-9]\d{9}$/.test(phone));
      mark("email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      mark("team", team >= min && team <= max);
      if (team > 1) mark("members", list.length >= team - 1);
      var agree = document.getElementById("in-agree");
      if (agree) mark("agree", agree.checked);
      if (!ok) {
        if (first && first.scrollIntoView) first.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        return;
      }
      var ev = form.getAttribute("data-event") || "Celesta 2K26";
      try {
        localStorage.setItem("celesta_reg_" + Date.now(), JSON.stringify({
          event: ev, name: name, school: school, phone: phone, email: email,
          team: team, teamName: teamname, members: list, at: new Date().toISOString()
        }));
      } catch (err) { /* storage unavailable; still confirm */ }
      var box = document.getElementById("ok-msg");
      if (box) {
        box.innerHTML = "<h3>Registration noted</h3><p><strong>" + esc(ev) + "</strong><br>" +
          (teamname ? esc(teamname) + " · " : "") + esc(name) + " · " + esc(school) + " · Team of " + esc(team) + "</p>" +
          "<p class='reg-note'>Saved on this device only (static site demo). Carry a valid ID card on 20 November 2026 and report by 9:30 AM. The organizers will announce confirmation and payment details soon — please keep a screenshot.</p>";
        box.classList.add("show");
        box.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }
      form.reset(); syncMembers();
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- Active menu link ---------- */
  var path = (location.pathname.split("/").pop() || "about").toLowerCase();
  /* map clean URLs to menu hrefs */
  var cleanMap = {"":"/about","about":"/about","events":"/events","maps":"/maps","contact":"/contact","gallery":"/gallery"};
  var cleanPath = cleanMap[path] || path;
  document.querySelectorAll("#pill .p-menu a").forEach(function (a) {
    var href = (a.getAttribute("href") || "").toLowerCase();
        if (href === cleanPath) a.classList.add("on");
  });
})();
