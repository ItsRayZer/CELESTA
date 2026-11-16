/* Age of Heroes — one-shot auto-playing hero intro + event cards. */
(function(){
  "use strict";
  var hero = document.querySelector(".ah-hero");
  var stage = document.querySelector(".ah-stage");
  if(!hero || !stage) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var u = function(n){ return function(){ return n * stage.clientWidth / 100; }; };

  /* ---------- 1. Star Canvas ---------- */
  var c = document.getElementById("ah-stars"), x = c ? c.getContext("2d") : null, lw = 0, lh = 0;
  function draw(force){
    if(!c || !x) return;
    var cw = c.clientWidth || window.innerWidth, ch = c.clientHeight || window.innerHeight;
    if(!force && cw === lw && Math.abs(ch - lh) < 120) return;
    lw = cw; lh = ch;
    var d = Math.min(window.devicePixelRatio||1, 2),
        w = c.width = Math.round(cw * d),
        h = c.height = Math.round(ch * d);
    x.clearRect(0,0,w,h);
    x.fillStyle = "#fff";
    for(var i=0, n=Math.min(w*h/6000, 900); i<n; i++){
      x.globalAlpha = .15 + Math.random()*.7;
      x.beginPath();
      x.arc(Math.random()*w, Math.random()*h, (.3+Math.random()*Math.random()*1.2)*d, 0, 6.283);
      x.fill();
    }
    x.globalAlpha = 1;
  }
  draw(true);
  var tResize;
  window.addEventListener("resize", function(){ clearTimeout(tResize); tResize = setTimeout(draw, 200); }, { passive:true });
  window.addEventListener("load", function(){ draw(true); if(window.ScrollTrigger) window.ScrollTrigger.refresh(); });

  /* ---------- 2. Auto-cycling Event Card ---------- */
  var slides = Array.prototype.slice.call(document.querySelectorAll(".ah-card .ah-slide")),
      si = 0, timer = 0, cardOn = true, inView = true;
  function cycle(){
    if(!slides.length) return;
    slides[si].classList.remove("on");
    si = (si + 1) % slides.length;
    slides[si].classList.add("on");
  }
  function sync(){
    var run = cardOn && inView && !document.hidden;
    if(run && !timer){ timer = setInterval(cycle, 450); }
    else if(!run && timer){ clearInterval(timer); timer = 0; }
  }
  if("IntersectionObserver" in window){
    new IntersectionObserver(function(es){ inView = es[0].isIntersecting; sync(); }).observe(hero);
  }
  document.addEventListener("visibilitychange", sync);
  sync();

  if(reduced) return; /* reduced motion: skip the intro, show the final layout */

  /* ---------- 3. One-shot, auto-playing hand-touching animation ----------
     No pin, no scrubbing, no scroll lock. When the section is ~full screen the animation
     plays ONCE by time. The user can keep scrolling normally at any moment. */
  var robot  = stage.querySelector(".ah-robot"),
      human  = stage.querySelector(".ah-human"),
      spark  = stage.querySelector(".ah-spark"),
      b1     = stage.querySelector(".ah-b1"),
      b2     = stage.querySelector(".ah-b2"),
      card   = stage.querySelector(".ah-card"),
      gcards = Array.prototype.slice.call(document.querySelectorAll(".ah-gcard"));

  var DURATION = 3400;   /* ms the intro plays for */
  var played = false, playing = false;

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  /* p: 0..1 progress of the intro. Same choreography as before, driven by time. */
  function render(p){
    var vh = window.innerHeight || 800;
    var t = p * 1.9;
    var cqw = (stage.clientWidth || 360) / 100;

    /* hands close in */
    var ph = clamp(t / 1.0, 0, 1);
    ph = ph * ph * (3 - 2 * ph); /* smoothstep so they glide in */
    if(robot) robot.style.transform = "translate3d(" + (ph * 7.5 * cqw).toFixed(2) + "px,0,0)";
    if(human) human.style.transform = "translate3d(" + (-ph * 7.5 * cqw).toFixed(2) + "px,0,0)";

    /* spark flashes on contact */
    if(spark){
      var sc = 0, op = 0, rot = 0;
      if(t >= 0.98 && t <= 1.16){
        var k1 = (t - 0.98) / 0.18, e1 = 1 - (1 - k1) * (1 - k1);
        sc = e1; op = e1; rot = 25 * e1;
      } else if(t > 1.16 && t <= 1.61){
        var k2 = (t - 1.16) / 0.45, e2 = k2 * k2;
        sc = 1 + 0.2 * e2; op = 1 - e2; rot = 25;
      }
      spark.style.transform = "translate(-50%,-50%) scale(" + sc.toFixed(3) + ") rotate(" + rot.toFixed(1) + "deg)";
      spark.style.opacity = op.toFixed(3);
    }

    /* birds drift */
    var pb = clamp(t / 1.6, 0, 1);
    if(b1) b1.style.transform = "translate3d(" + (pb * 42 * cqw).toFixed(2) + "px," + (-pb * 5 * cqw).toFixed(2) + "px,0) scale(" + (1 + 0.15 * pb).toFixed(3) + ")";
    if(b2){
      b2.style.transform = "translate3d(" + ((-22 + 49 * pb) * cqw).toFixed(2) + "px," + ((2 - 6 * pb) * cqw).toFixed(2) + "px,0)";
      b2.style.opacity = (0.65 * pb).toFixed(3);
    }

    /* event card rises into the gap */
    if(card){
      var pc = clamp((t - 0.9) / 0.7, 0, 1);
      pc = 1 - (1 - pc) * (1 - pc);
      card.style.transform = "translate3d(0," + ((1 - pc) * vh * 0.3).toFixed(2) + "px,0)";
      card.style.opacity = pc.toFixed(3);
    }
  }

  render(0); /* start state: hands apart, card hidden */

  /* ----- play once, no scroll lock: user can scroll away any time ----- */
  function finish(){
    played = true; playing = false;
    render(1);
  }

  function play(){
    if(played || playing) return;
    playing = true;
    var start = 0;
    function frame(now){
      if(!playing) return;
      if(!start) start = now;
      var p = clamp((now - start) / DURATION, 0, 1);
      render(p);
      if(p < 1) requestAnimationFrame(frame); else finish();
    }
    requestAnimationFrame(frame);
  }

  function check(){
    if(played || playing) return;
    var r = hero.getBoundingClientRect(), vh = window.innerHeight || 800;
    if(r.bottom <= 0){ finish(); return; }               /* jumped past it: show end state */
    var vis = Math.min(r.bottom, vh) - Math.max(r.top, 0); /* visible height */
    if(vis >= Math.min(r.height, vh) * 0.9) play();        /* section is ~full screen */
  }

  var raf = 0;
  function onScroll(){ if(!raf) raf = requestAnimationFrame(function(){ raf = 0; check(); }); }
  window.addEventListener("scroll", onScroll, { passive:true });
  window.addEventListener("resize", onScroll, { passive:true });
  window.addEventListener("celesta:view", onScroll);
  window.addEventListener("load", onScroll);
  check();

  /* ---------- 4. Gallery cards: alternating entrance + parallax (scroll-based) ---------- */
  function galleryGSAP(){
    if(!window.gsap || !window.ScrollTrigger) return false;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize:true, limitCallbacks:true });
    gcards.forEach(function(card, i){
      var d = i%2 ? 1 : -1;
      gsap.fromTo(card, { y:90, x:d*60, opacity:0 }, { y:0, x:0, opacity:1, ease:"power2.out",
        scrollTrigger:{ trigger:card, start:"top 95%", end:"top 55%", scrub:true } });
      var pass = { trigger:card, start:"top bottom", end:"bottom top", scrub:true };
      gsap.fromTo(card.querySelector("img"), { yPercent:-9 }, { yPercent:9, ease:"none", scrollTrigger:pass });
      gsap.fromTo(card.querySelector(".ah-glabel"), { letterSpacing:"0.05em" }, { letterSpacing:"0.28em", ease:"none", scrollTrigger:pass });
    });
    return true;
  }

  function galleryNative(){
    function upd(){
      var vh = window.innerHeight || 800;
      for(var i = 0; i < gcards.length; i++){
        var gc = gcards[i], gr = gc.getBoundingClientRect(), d = (i % 2) ? 1 : -1;
        var gp = clamp((vh * 0.95 - gr.top) / (vh * 0.4), 0, 1), ge = 1 - (1 - gp) * (1 - gp);
        gc.style.transform = "translate3d(" + ((1 - ge) * d * 60).toFixed(1) + "px," + ((1 - ge) * 90).toFixed(1) + "px,0)";
        gc.style.opacity = ge.toFixed(3);
        var pp = clamp((vh - gr.top) / (vh + gr.height), 0, 1);
        var img = gc.querySelector("img"), lbl = gc.querySelector(".ah-glabel");
        if(img) img.style.transform = "translate3d(0," + (-9 + 18 * pp).toFixed(2) + "%,0)";
        if(lbl) lbl.style.letterSpacing = (0.05 + 0.23 * pp).toFixed(3) + "em";
      }
    }
    var r2 = 0;
    function go(){ if(!r2) r2 = requestAnimationFrame(function(){ r2 = 0; upd(); }); }
    window.addEventListener("scroll", go, { passive:true });
    window.addEventListener("resize", go, { passive:true });
    upd();
  }

  var galleryDone = false;
  function initGallery(){
    if(galleryDone) return;
    if(galleryGSAP()){ galleryDone = true; return; }
  }
  if(gcards.length){
    if(window.gsap && window.ScrollTrigger){ initGallery(); }
    else {
      /* GSAP didn't load (blocked CDN etc.) — fall back to the built-in scroll handler */
      window.addEventListener("load", function(){
        if(galleryDone) return;
        if(window.gsap && window.ScrollTrigger){ initGallery(); }
        else { galleryDone = true; galleryNative(); }
      });
    }
  }
})();
