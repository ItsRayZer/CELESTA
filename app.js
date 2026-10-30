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
  function tick() {
    var diff = TARGET - Date.now(), d, h, m, s;
    if (diff <= 0) { d = h = m = s = 0; }
    else {
      d = Math.floor(diff / 86400000);
      h = Math.floor((diff % 86400000) / 3600000);
      m = Math.floor((diff % 3600000) / 60000);
      s = Math.floor((diff % 60000) / 1000);
    }
    var map = { "cd-d": d, "cd-h": h, "cd-m": m, "cd-s": s };
    for (var id in map) {
      var el = document.getElementById(id);
      if (el) el.textContent = pad(map[id]);
    }
  }
  tick(); setInterval(tick, 1000);

  /* ---------- Pill: countdown in hero, menu on scroll (home only) ---------- */
  var pill = document.getElementById("pill");
  var hero = document.getElementById("top");
  if (pill && hero && !reduced) {
    pill.classList.add("countdown-mode");
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        pill.classList.toggle("countdown-mode", e.isIntersecting);
      });
    }, { threshold: 0.25 });
    io.observe(hero);
  }

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
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true;
      function chk(id, valid) {
        var f = document.getElementById("f-" + id);
        var v = document.getElementById("in-" + id).value.trim();
        var good = valid(v);
        if (f) f.classList.toggle("invalid", !good);
        if (!good) ok = false;
        return v;
      }
      var name = chk("name", function (v) { return v.length >= 2; });
      var college = chk("college", function (v) { return v.length >= 2; });
      var phone = chk("phone", function (v) { return /^[6-9]\d{9}$/.test(v); });
      var email = chk("email", function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); });
      var team = chk("team", function (v) { var n = parseInt(v, 10); return n >= 1 && n <= 10; });
      if (!ok) return;
      var ev = form.getAttribute("data-event") || "Celesta 2K26";
      try {
        localStorage.setItem("celesta_reg_" + Date.now(), JSON.stringify({
          event: ev, name: name, college: college, phone: phone,
          email: email, team: parseInt(team, 10), at: new Date().toISOString()
        }));
      } catch (err) { /* storage unavailable; still confirm */ }
      var box = document.getElementById("ok-msg");
      if (box) {
        box.innerHTML = "<h3>Registration noted</h3><p><strong>" + esc(ev) + "</strong><br>" +
          esc(name) + " · " + esc(college) + " · Team of " + esc(team) + "</p>" +
          "<p class='reg-note'>Saved on this device only (static site demo). The organizers will announce confirmation details soon — please keep a screenshot.</p>";
        box.classList.add("show");
        box.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }
      form.reset();
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- Active menu link ---------- */
  var path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("#pill .p-menu a").forEach(function (a) {
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href === path || (path === "" && href === "index.html")) a.classList.add("on");
  });
})();
