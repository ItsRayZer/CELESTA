/* Age of Heroes: pinned, scroll-scrubbed intro. Hands meet, then the five events appear one by one.
   Needs GSAP + ScrollTrigger (loaded from cdnjs in index.html). Falls back to a plain list. */
(function () {
  "use strict";
  var sec = document.getElementById("heroes");
  if (!sec) return;

  /* starfield */
  var cv = sec.querySelector(".age-stars");
  function stars() {
    var d = Math.min(window.devicePixelRatio || 1, 2), w = cv.width = sec.clientWidth * d, h = cv.height = sec.clientHeight * d, x = cv.getContext("2d");
    x.clearRect(0, 0, w, h); x.fillStyle = "#fff";
    for (var i = 0, n = w * h / 5000; i < n; i++) {
      x.globalAlpha = .15 + Math.random() * .75;
      x.beginPath(); x.arc(Math.random() * w, Math.random() * h, (.3 + Math.random() * Math.random() * 1.3) * d, 0, 6.283); x.fill();
    }
  }
  var rt; stars();
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(stars, 250); });

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !window.gsap || !window.ScrollTrigger) { sec.classList.add("static"); return; }

  gsap.registerPlugin(ScrollTrigger);
  var stage = sec.querySelector(".stage");
  var u = function (n) { return function () { return n * stage.clientWidth / 100; }; };

  var tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: sec, start: "top top", end: "+=720%", scrub: 1, pin: true, anticipatePin: 1, invalidateOnRefresh: true }
  });

  /* 1. hands reach, birds drift in */
  tl.to(".age .robot", { x: u(7.5), duration: 1 }, 0)
    .to(".age .human", { x: u(-7.5), duration: 1 }, 0)
    .fromTo(".age .b1", { x: 0, y: 0, scale: 1 }, { x: u(42), y: u(-5), scale: 1.15, duration: 3.2 }, 0)
    .fromTo(".age .b2", { x: u(-22), y: u(2), opacity: 0 }, { x: u(27), y: u(-4), opacity: .65, duration: 3.2 }, 0)
  /* 2. the touch: a flash of light */
    .fromTo(".age .spark", { opacity: 0, scale: .3 }, { opacity: .9, scale: 1.6, duration: .12, ease: "power2.out" }, .96)
    .to(".age .spark", { opacity: 0, scale: 2.4, duration: .35 }, 1.08)
  /* 3. the card rises */
    .fromTo(".age-card", { y: function () { return window.innerHeight * .7; }, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 1.1)
    .fromTo(".age-card .slide:first-child img", { scale: 1.15 }, { scale: 1, duration: .7 }, 1.1);

  /* 4. events change one by one */
  var slides = gsap.utils.toArray(".age-card .slide");
  for (var i = 1; i < slides.length; i++) {
    var at = 1.8 + i * .8 - .25, a = slides[i - 1], b = slides[i];
    tl.to(a, { opacity: 0, duration: .25, ease: "power1.inOut" }, at)
      .to(a.querySelector(".ev"), { y: -18, filter: "blur(6px)", duration: .25 }, at)
      .fromTo(b, { opacity: 0 }, { opacity: 1, duration: .25, ease: "power1.inOut" }, at)
      .fromTo(b.querySelector(".ev"), { y: 18, filter: "blur(6px)" }, { y: 0, filter: "blur(0px)", duration: .25 }, at)
      .fromTo(b.querySelector("img"), { scale: 1.15 }, { scale: 1, duration: .8 }, at);
  }
  tl.to({}, { duration: .01 }, 1.8 + (slides.length - 1) * .8 + .55);
})();
