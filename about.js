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
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        vis = es[0].isIntersecting && !document.hidden;
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
        { opacity: 0.12, y: 14, filter: "blur(3px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", ease: "none", stagger: 0.15,
          scrollTrigger: { trigger: p, start: "top 88%", end: "bottom 35%", scrub: true } }
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
    if(campImg){
      gsap.fromTo(campImg,
        { yPercent: -7, scale: 1.1 },
        { yPercent: 7, scale: 1.02, ease: "none",
          scrollTrigger: { trigger: "#college", start: "top bottom", end: "bottom top", scrub: true } }
      );
    }
    return true;
  }

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
        var prog = clamp((vh * 0.84 - pr.top) / Math.max(1, pr.height + vh * 0.36), 0, 1);
        var n = words.length;
        for(var i = 0; i < n; i++){
          var wp = clamp((prog * (n + 6) - i) / 6, 0, 1);
          words[i].style.opacity = (0.16 + 0.84 * wp).toFixed(3);
          words[i].style.transform = "translate3d(0," + ((1 - wp) * 8).toFixed(1) + "px,0)";
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
        campImg.style.transform = "translate3d(0," + (-7 + 14 * cp).toFixed(1) + "%,0) scale(1.08)";
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
