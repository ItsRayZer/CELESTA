/* Home Section 4 ("wb-realm"): White Sky & Sacred Blueprint aesthetic + unique multi-stage scroll animations.
   Works with GSAP ScrollTrigger when loaded, and includes a built-in native requestAnimationFrame
   scroll-scrub fallback so every animation works even if external scripts are deferred or offline. */
(function(){
  "use strict";
  var realm = document.getElementById("about");
  if(!realm) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. Ambient Sacred Blueprint Canvas (#wb-canvas) ---------- */
  var cvs = document.getElementById("wb-canvas");
  if(cvs && cvs.getContext){
    var ctx = cvs.getContext("2d"), W = 0, H = 0, motes = [], vis = false, raf = 0, t0 = performance.now();
    function sizeCanvas(){
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = cvs.clientWidth || window.innerWidth;
      H = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.round(W * dpr);
      cvs.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = Math.min(24, Math.max(12, Math.round((W * H) / 42000)));
      motes = [];
      for(var i = 0; i < count; i++){
        motes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 1.2 + Math.random() * 2.4,
          vx: (Math.random() - 0.5) * 0.28,
          vy: -0.1 - Math.random() * 0.22,
          ph: Math.random() * 6.28,
          gold: Math.random() < 0.45
        });
      }
    }
    var lastT = 0;
    function drawCanvas(now){
      if(!vis){ raf = 0; return; }
      if(now - lastT < 33){ raf = requestAnimationFrame(drawCanvas); return; }
      lastT = now;
      var t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for(var i = 0; i < motes.length; i++){
        var m = motes[i];
        if(!reduced){
          m.x += m.vx + Math.sin(t * 0.5 + m.ph) * 0.15;
          m.y += m.vy;
          if(m.x < -10) m.x = W + 10;
          if(m.x > W + 10) m.x = -10;
          if(m.y < -10) m.y = H + 10;
        }
        var alpha = 0.14 + 0.12 * Math.sin(t * 1.3 + m.ph);
        ctx.fillStyle = m.gold ? "rgba(181,137,56," + alpha.toFixed(3) + ")" : "rgba(35,37,44," + (alpha * 0.75).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, 6.283);
        ctx.fill();
      }
      if(!reduced) raf = requestAnimationFrame(drawCanvas);
    }
    sizeCanvas();
    var rTimer = 0;
    window.addEventListener("resize", function(){
      clearTimeout(rTimer);
      rTimer = setTimeout(sizeCanvas, 180);
    }, { passive: true });
    if("IntersectionObserver" in window){
      new IntersectionObserver(function(es){
        /* the purple theme hides this canvas (display:none) — skip the loop entirely then */
        vis = es[0].isIntersecting && !document.hidden && cvs.offsetParent !== null;
        realm.classList.toggle("is-live", vis);
        if(vis && !raf && !reduced) raf = requestAnimationFrame(drawCanvas);
      }, { threshold: 0.02 }).observe(realm);
    }
  }

  /* ---------- 2. Adaptive Floating Pill when over White Section ---------- */
  var pill = document.getElementById("pill");
  if(pill && "IntersectionObserver" in window){
    new IntersectionObserver(function(es){
      pill.classList.toggle("on-light", es[0].isIntersecting);
    }, { rootMargin: "-75% 0px -8% 0px", threshold: 0 }).observe(realm);
  }

  /* ---------- 3. Split Manifesto Words ---------- */
  var p = document.getElementById("fi-text");
  var words = [];
  if(p){
    var raw = p.textContent.trim().replace(/SPEARHEADED/gi, "PRESENTED").split(/\s+/);
    p.innerHTML = raw.map(function(w){ return '<span class="w">' + w + '</span>'; }).join(" ");
    words = Array.prototype.slice.call(p.querySelectorAll(".w"));
  }

  if(reduced) return;

  var initialized = false;
  function initGSAP(){
    if(initialized || !window.gsap || !window.ScrollTrigger) return false;
    initialized = true;
    gsap.registerPlugin(ScrollTrigger);

    var head = document.getElementById("wb-head");
    if(head){
      gsap.fromTo(".wb-wordmark",
        { y: 30, opacity: 0, scale: 0.92 },
        { y: 0, opacity: 1, scale: 1, ease: "power2.out",
          scrollTrigger: { trigger: head, start: "top 80%", end: "top 40%", scrub: 0.6 } }
      );
      gsap.fromTo(".wb-title",
        { y: 36, opacity: 0, scale: 0.94 },
        { y: 0, opacity: 1, scale: 1, ease: "power2.out",
          scrollTrigger: { trigger: head, start: "top 76%", end: "top 36%", scrub: 0.6 } }
      );
      gsap.fromTo(".wb-date",
        { y: 20, opacity: 0, scale: 0.94 },
        { y: 0, opacity: 1, scale: 1, ease: "power2.out",
          scrollTrigger: { trigger: head, start: "top 72%", end: "top 34%", scrub: 0.6 } }
      );
    }

    gsap.fromTo(".wb-hatch-top",
      { xPercent: -4, yPercent: -6 },
      { xPercent: 4, yPercent: 8, ease: "none",
        scrollTrigger: { trigger: ".wb-sky-transition", start: "top bottom", end: "bottom top", scrub: true } }
    );
    gsap.fromTo(".wb-hatch-mid",
      { xPercent: -6, yPercent: 10 },
      { xPercent: 6, yPercent: -10, ease: "none",
        scrollTrigger: { trigger: ".wb-manifesto-wrap", start: "top bottom", end: "bottom top", scrub: true } }
    );

    if(words.length){
      gsap.fromTo(words,
        { opacity: 0.12, y: 26 },
        { opacity: 1, y: 0, ease: "none", stagger: 0.08,
          scrollTrigger: { trigger: p, start: "top 96%", end: "bottom 55%", scrub: 0.5 } }
      );
    }

    /* Powered-by lines: elegant fade-up on scroll */
    var powered = document.querySelector(".wb-powered");
    if(powered){
      gsap.fromTo(powered.children,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, ease: "none", stagger: 0.25,
          scrollTrigger: { trigger: powered, start: "top 90%", end: "top 55%", scrub: true } }
      );
    }

    var stage = document.getElementById("wb-stage");
    if(stage){
      gsap.fromTo("#wb-art img",
        { yPercent: 8, scale: 0.92, opacity: 0.25 },
        { yPercent: -6, scale: 1.03, opacity: 1, ease: "power2.out",
          scrollTrigger: { trigger: stage, start: "top 88%", end: "bottom 25%", scrub: 0.6 } }
      );
    }

    var nxBox = document.getElementById("nexus");
    if(nxBox){
      gsap.fromTo(nxBox,
        { y: 44, opacity: 0 },
        { y: 0, opacity: 1, ease: "power3.out",
          scrollTrigger: { trigger: nxBox, start: "top 88%", end: "top 52%", scrub: 0.5 } }
      );
    }

    var campImg = document.getElementById("wb-campus-img");
    var campLayers = [campImg, document.getElementById("wb-reels-fallback"),
      document.getElementById("wb-reel-a"), document.getElementById("wb-reel-b")];
    campLayers.forEach(function(el){
      if(!el) return;
      gsap.fromTo(el,
        { yPercent: -7, scale: 1.1 },
        { yPercent: 7, scale: 1.02, ease: "none",
          scrollTrigger: { trigger: "#college", start: "top bottom", end: "bottom top", scrub: true } }
      );
    });
    return true;
  }

  /* Reels rotator: the 8 Instagram reels, cut into 32 five-second clips
     (4 per reel), played one at a time for 5s each. The reel order is
     shuffled and each reel's clips are shuffled too, so no reel and no
     five-second part repeats until every reel has played. Two videos
     crossfade (1.2s opacity) so there is no cut, and the next clip is
     preloaded into the hidden video while the current one plays, so there
     is no loading flash. If a clip fails to load or play, the college
     photo underneath stays visible and the rotator moves on. */
  function initReelsRotator(){
    var va = document.getElementById("wb-reel-a");
    var vb = document.getElementById("wb-reel-b");
    if(!va || !vb) return;
    var vids = [va, vb];
    var SEG = 5; /* seconds per clip */
    var REELS = 8, PER = 4;
    function shuffle(a){
      for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
      return a;
    }
    /* per-reel shuffled clip numbers, refilled when a reel's clips run out */
    var pool = [];
    for(var r=0;r<REELS;r++) pool.push(shuffle([1,2,3,4]));
    /* shuffled reel order, reshuffled after every full round of 8 */
    var order = shuffle([0,1,2,3,4,5,6,7]);
    var oi = 0;
    var lastReel = -1;
    function nextClip(){
      if(oi >= order.length){
        /* a new round must not start with the reel that just played */
        do { order = shuffle([0,1,2,3,4,5,6,7]); } while(order[0] === lastReel);
        oi = 0;
      }
      var ri = order[oi++];
      lastReel = ri;
      if(!pool[ri].length) pool[ri] = shuffle([1,2,3,4]);
      var ci = pool[ri].pop();
      return "/assets/reels/r" + (ri+1) + "-" + ci + ".mp4";
    }
    var active = 0; /* index of the visible video */
    var timer = null;
    var cached = null; /* next clip src, already prepared in the hidden video */
    function prepare(src, vid, done){
      var ok = false;
      function fin(v){ if(!ok){ ok = true; done(v); } }
      if(vid.dataset.clip === src){
        if(vid.readyState >= 2){ fin(true); return; }
        vid.addEventListener("canplay", function(){ fin(true); }, { once:true });
        vid.addEventListener("error", function(){ fin(false); }, { once:true });
        setTimeout(function(){ fin(vid.readyState >= 2); }, 4000);
        return;
      }
      vid.addEventListener("canplay", function(){ fin(true); }, { once:true });
      vid.addEventListener("error", function(){ fin(false); }, { once:true });
      vid.dataset.clip = src;
      vid.src = src;
      vid.load();
      setTimeout(function(){ fin(vid.readyState >= 2); }, 4000);
    }
    function reveal(src){
      var next = vids[1-active];
      var pr = next.play ? next.play() : null;
      if(pr && pr.catch) pr.catch(function(){});
      next.classList.add("on");
      vids[active].classList.remove("on");
      try{ vids[active].pause(); }catch(e){}
      active = 1-active;
      var following = nextClip();
      cached = following;
      prepare(following, vids[1-active], function(ok){ if(!ok) cached = null; });
      if(timer) clearTimeout(timer);
      timer = setTimeout(advance, SEG*1000);
    }
    function advance(){
      var src = cached || nextClip();
      cached = null;
      var next = vids[1-active];
      if(next.dataset.clip === src && next.readyState >= 2){
        reveal(src);
      } else {
        prepare(src, next, function(ok){
          if(ok) reveal(src);
          else { if(timer) clearTimeout(timer); timer = setTimeout(advance, 1200); }
        });
      }
    }
    /* boot: prepare the first clip, then reveal it (the photo shows meanwhile) */
    var first = nextClip();
    prepare(first, vids[0], function(ok){
      if(ok) reveal(first);
      else { if(timer) clearTimeout(timer); timer = setTimeout(advance, 1200); }
    });
    /* pause when the tab is hidden so it does not burn battery or data */
    document.addEventListener("visibilitychange", function(){
      if(document.hidden){
        vids.forEach(function(v){ try{ v.pause(); }catch(e){} });
        if(timer) clearTimeout(timer);
      } else {
        var cur = vids[active];
        if(cur && cur.paused) cur.play().catch(function(){});
        if(timer) clearTimeout(timer);
        timer = setTimeout(advance, SEG*1000);
      }
    });
  }
  initReelsRotator();

  function initNativeScrub(){
    if(initialized) return;
    initialized = true;
    var stage = document.getElementById("wb-stage"),
        sealSvg = document.querySelector("#wb-seal .wb-seal-svg"),
        orbsA = Array.prototype.slice.call(document.querySelectorAll(".wb-orb.o1, .wb-orb.o3")),
        orbsB = Array.prototype.slice.call(document.querySelectorAll(".wb-orb.o2, .wb-orb.o4")),
        artImg = document.querySelector("#wb-art img"),
        campImg = document.getElementById("wb-campus-img"),
        colSec = document.getElementById("college");

    function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
    function upd(){
      var vh = window.innerHeight || 800;
      if(p && words.length){
        var pr = p.getBoundingClientRect();
        var prog = clamp((vh * 0.96 - pr.top) / Math.max(1, pr.height + vh * 0.18), 0, 1);
        var n = words.length;
        for(var i = 0; i < n; i++){
          var wp = clamp((prog * (n + 4) - i) / 4, 0, 1);
          words[i].style.opacity = (0.16 + 0.84 * wp).toFixed(3);
          words[i].style.transform = "translate3d(0," + ((1 - wp) * 18).toFixed(1) + "px,0)";
        }
      }
      if(stage){
        var sr = stage.getBoundingClientRect();
        var sp = clamp((vh - sr.top) / Math.max(1, vh + sr.height), 0, 1);
        if(sealSvg) sealSvg.style.transform = "rotate(" + (-45 + 230 * sp).toFixed(1) + "deg)";
        orbsA.forEach(function(el){ el.style.transformOrigin = "50% 50%"; el.style.transform = "rotate(" + (90 * sp).toFixed(1) + "deg)"; });
        orbsB.forEach(function(el){ el.style.transformOrigin = "50% 50%"; el.style.transform = "rotate(" + (-110 * sp).toFixed(1) + "deg)"; });
        if(artImg){
          var ap = clamp((vh * 0.88 - sr.top) / Math.max(1, sr.height * 0.9), 0, 1);
          artImg.style.opacity = (0.25 + 0.75 * ap).toFixed(3);
          artImg.style.transform = "translate3d(0," + ((8 - 14 * sp)).toFixed(1) + "%,0) scale(" + (0.92 + 0.11 * ap).toFixed(3) + ")";
        }
      }
      if(campImg && colSec){
        var cr = colSec.getBoundingClientRect();
        var cp = clamp((vh - cr.top) / Math.max(1, vh + cr.height), 0, 1);
        var campT = "translate3d(0," + (-7 + 14 * cp).toFixed(1) + "%,0) scale(1.08)";
        campImg.style.transform = campT;
        ["wb-reels-fallback", "wb-reel-a", "wb-reel-b"].forEach(function(id){
          var el = document.getElementById(id);
          if(el) el.style.transform = campT;
        });
      }
    }
    var rafS = 0;
    function onS(){ if(!rafS) rafS = requestAnimationFrame(function(){ rafS = 0; upd(); }); }
    window.addEventListener("scroll", onS, { passive:true });
    window.addEventListener("resize", onS, { passive:true });
    upd();
  }

  if(!initGSAP()){
    document.addEventListener("DOMContentLoaded", function(){
      if(!initGSAP()) initNativeScrub();
    });
    window.addEventListener("load", function(){
      if(!initialized){
        if(!initGSAP()) initNativeScrub();
      }
    });
    setTimeout(function(){
      if(!initialized){
        if(!initGSAP()) initNativeScrub();
      }
    }, 400);
  }
})();
