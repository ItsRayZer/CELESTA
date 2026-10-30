/* Age of Heroes — scroll-synced hero + event cards. 5 event slides, no repetition. */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  var stage = document.querySelector(".ah-stage");
  if(!stage) return;
  var u = function(n){ return function(){ return n * stage.clientWidth / 100; }; };

  /* Star canvas */
  var c = document.getElementById("ah-stars"), x = c.getContext("2d");
  function draw(){
    var d = Math.min(window.devicePixelRatio||1, 2),
        w = c.width = stage.clientWidth * d,
        h = c.height = stage.clientHeight * d;
    x.clearRect(0,0,w,h);
    for(var i=0, n=w*h/6000; i<n; i++){
      x.globalAlpha = .15 + Math.random()*.7; x.fillStyle = "#fff";
      x.beginPath();
      x.arc(Math.random()*w, Math.random()*h, (.3+Math.random()*Math.random()*1.2)*d, 0, 6.283);
      x.fill();
    }
  }
  draw();
  var t; addEventListener("resize", function(){ clearTimeout(t); t=setTimeout(draw, 200); });

  gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", function(){
    var tl = gsap.timeline({
      defaults:{ ease:"none" },
      scrollTrigger:{ trigger:".ah-hero", start:"top top", end:"+=380%", scrub:1, pin:true, anticipatePin:1, invalidateOnRefresh:true }
    });
    /* Hands come together, birds drift — synced to scroll */
    tl.to(".ah-robot", { x:u(7.5), duration:1 }, 0)
      .to(".ah-human", { x:u(-7.5), duration:1 }, 0)
      .fromTo(".ah-b1", { x:0, y:0, scale:1 }, { x:u(42), y:u(-5), scale:1.15, duration:1.6 }, 0)
      .fromTo(".ah-b2", { x:u(-22), y:u(2), opacity:0 }, { x:u(27), y:u(-4), opacity:.65, duration:1.6 }, 0)
      /* Card rises into the middle */
      .fromTo(".ah-card", { y:function(){ return innerHeight*.7; }, opacity:0 }, { y:0, opacity:1, duration:.7 }, .9)
      .fromTo(".ah-card .ah-slide:first-child img", { scale:1.15 }, { scale:1, duration:.7 }, .9);

    /* 5 event slides — one per scroll segment, slow crossfade, no repetition */
    var slides = gsap.utils.toArray(".ah-card .ah-slide");
    var seg = .62, startAt = 1.6;
    for(var i=1; i<slides.length; i++){
      var at = startAt + (i-1)*seg,
          a = slides[i-1], b = slides[i];
      tl.to(a, { opacity:0, duration:.22 }, at)
        .to(a.querySelector(".ah-label"), { y:-24, filter:"blur(6px)", duration:.22 }, at)
        .fromTo(b, { opacity:0 }, { opacity:1, duration:.22 }, at)
        .fromTo(b.querySelector(".ah-label"), { y:24, filter:"blur(6px)" }, { y:0, filter:"blur(0px)", duration:.22 }, at)
        .fromTo(b.querySelector("img"), { scale:1.15 }, { scale:1, duration:.4 }, at);
    }
    tl.to({}, { duration:.3 });

    /* Gallery cards — one by one, alternating sides, exact file UI */
    gsap.utils.toArray(".ah-gcard").forEach(function(card, i){
      var d = i%2 ? 1 : -1;
      gsap.fromTo(card, { y:90, x:d*60, opacity:0 }, { y:0, x:0, opacity:1, ease:"power2.out",
        scrollTrigger:{ trigger:card, start:"top 95%", end:"top 55%", scrub:.8 } });
      var pass = { trigger:card, start:"top bottom", end:"bottom top", scrub:true };
      gsap.fromTo(card.querySelector("img"), { yPercent:-9 }, { yPercent:9, ease:"none", scrollTrigger:pass });
      gsap.fromTo(card.querySelector(".ah-glabel"), { letterSpacing:"0.05em" }, { letterSpacing:"0.28em", ease:"none", scrollTrigger:pass });
    });
  });
})();
