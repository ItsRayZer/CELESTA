/* Celesta 2K26 — hero: stars + astronaut ⇄ astral guardian WebGL morph.
   Scene flips every 6s on its own and again as you scroll through the hero. */
(function () {
  "use strict";
  var hx = document.getElementById("top");
  if (!hx || !hx.classList.contains("hx")) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sky = hx.querySelector(".hx-stars"), c = sky.getContext("2d");
  var cx = hx.querySelector(".hx-fx"), fw = hx.querySelector(".hx-fw"), ew = hx.querySelector(".hx-ew");
  var W = 0, H = 0, st = [], motes = [], vis = true, raf = 0;
  var TINT = ["#e8f0ff", "#b9d8ff", "#ffe2b0"];

  /* ---------- Stars (dense, lots of black between) ---------- */
  function fxSize() {
    var r = Math.min(window.devicePixelRatio || 1, 2);
    cx.width = Math.round(cx.clientWidth * r); cx.height = Math.round(cx.clientHeight * r);
    if (gl) gl.viewport(0, 0, cx.width, cx.height);
  }
  function size() {
    var r = Math.min(window.devicePixelRatio || 1, 2);
    W = sky.clientWidth; H = sky.clientHeight;
    sky.width = W * r; sky.height = H * r; c.setTransform(r, 0, 0, r, 0, 0);
    var n = Math.round(Math.min(340, W * H / 1400)); st = [];
    for (var i = 0; i < n; i++) {
      var k = Math.random(), big = k > .97, mid = k > .82, q = Math.random();
      st.push({ x: Math.random() * W, y: Math.random() * H * .8, r: big ? 1.5 : mid ? 1 : .55, a: big ? 1 : mid ? .7 : .45,
        ph: Math.random() * 6.28, sp: .4 + Math.random() * 1.2, col: q < .18 ? 1 : q < .3 ? 2 : 0, z: Math.random() * .6 + .1, big: big });
    }
    motes = [];
    var mn = Math.round(Math.min(26, W * H / 26000));
    for (var j = 0; j < mn; j++) {
      motes.push({ x: Math.random() * W, y: Math.random() * H,
        r: 1.6 + Math.random() * 3.2, a: .12 + Math.random() * .3,
        vx: (.12 + Math.random() * .35) * (Math.random() < .5 ? -1 : 1),
        vy: -(.08 + Math.random() * .25),
        ph: Math.random() * 6.28, sp: .5 + Math.random() * 1.1,
        col: Math.random() < .7 ? "#ffe2b0" : "#b9d8ff" });
    }
    fxSize(); if (reduced) drawSky(0, 0);
  }
  function drawSky(t, y) {
    c.clearRect(0, 0, W, H);
    for (var i = 0; i < st.length; i++) {
      var q = st[i], a = q.a * (reduced ? 1 : .55 + .45 * Math.sin(t * q.sp + q.ph)), sy = q.y - y * q.z * .25;
      c.globalAlpha = a; c.fillStyle = TINT[q.col];
      c.beginPath(); c.arc(q.x, sy, q.r, 0, 6.283); c.fill();
      if (q.big) { c.globalAlpha = a * .5; c.fillRect(q.x - 6, sy - .4, 12, .8); c.fillRect(q.x - .4, sy - 6, .8, 12); }
    }
    /* living dots: drift + breathe */
    for (var m = 0; m < motes.length; m++) {
      var o = motes[m];
      if (!reduced) {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -12) o.x = W + 12; if (o.x > W + 12) o.x = -12;
        if (o.y < -12) o.y = H + 12; if (o.y > H + 12) o.y = -12;
      }
      var pulse = reduced ? 1 : .6 + .4 * Math.sin(t * o.sp + o.ph);
      var dx = reduced ? 0 : Math.sin(t * .6 + o.ph) * 14, dy = reduced ? 0 : Math.cos(t * .5 + o.ph) * 10;
      c.globalAlpha = o.a * pulse; c.fillStyle = o.col;
      c.beginPath(); c.arc(o.x + dx, o.y + dy - y * .12, o.r * pulse, 0, 6.283); c.fill();
      c.globalAlpha = o.a * pulse * .25;
      c.beginPath(); c.arc(o.x + dx, o.y + dy - y * .12, o.r * 2.6, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }

  /* ---------- WebGL morph ---------- */
  var gl = null, U = {}, ready = 0, mp = 0;
  try { gl = cx.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true }); } catch (e) { gl = null; }
  function fail() { hx.classList.add("nogl"); gl = null; }
  if (!gl) { fail(); } else {
    var vs = "attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
    var fs = [
      "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
      "varying vec2 v;uniform sampler2D A,K;uniform float P,T;",
      "float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}",
      "float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}",
      "float fb(vec2 q){return n(q)*.5+n(q*2.1)*.3+n(q*4.3)*.2;}",
      "vec4 smp(sampler2D s,vec2 uv,float ar,float hs,float ox){",
      "  vec2 q=vec2((uv.x-.5-ox)*.75/(ar*hs)+.5,uv.y/hs);",
      "  if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return vec4(0.);",
      "  vec4 c=texture2D(s,q);return vec4(c.rgb*c.a,c.a);}",
      "void main(){",
      "  float t=T;vec2 uv=v;",
      "  float a=sin(t*.8)*.012;vec2 o=uv-vec2(.5,.35);",
      "  uv=vec2(.5,.35)+mat2(cos(a),-sin(a),sin(a),cos(a))*o;",
      "  uv.y+=sin(t*1.1)*.012;uv.x+=sin(t*.7)*.006;",
      "  float ps=smoothstep(0.,1.,P);",
      "  float f=v.y*.62+fb(v*vec2(3.,4.)+vec2(0.,t*.15))*.42;",
      "  float d=f-mix(-.08,1.12,ps);",
      "  float km=1.-smoothstep(-.03,.03,d);",
      "  float e=exp(-abs(d)*22.)*sin(3.14159*ps);",
      "  vec2 uk=uv;uk.x+=sin(uk.y*9.-t*2.)*.008*(1.-uk.y);",
      "  vec4 c=smp(A,uv,.538,.9,.02)*(1.-km)+smp(K,uk,.727,.86,0.)*km;",
      "  float cr=e*.014;",
      "  c.r+=(smp(A,uv+vec2(cr,0.),.538,.9,.02).r*(1.-km)+smp(K,uk+vec2(cr,0.),.727,.86,0.).r*km-c.r)*.7;",
      "  vec3 gc=mix(vec3(.45,.8,1.),vec3(1.,.72,.3),ps);",
      "  float sp=step(.975,h(floor(v*vec2(70.,90.))+floor(t*7.)))*e*4.;",
      "  c.rgb+=(gc*e*1.5+(vec3(1.)+gc)*sp)*clamp(c.a*1.6,0.,1.);",
      "  gl_FragColor=vec4(min(c.rgb,vec3(1.)),c.a);}"
    ].join("\n");
    var sh = function (ty, src) { var s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { fail(); } else {
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var lc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      ["assets/hero-astronaut.webp", "assets/hero-guardian.webp"].forEach(function (src, i) {
        var im = new Image();
        im.onload = function () {
          if (!gl) return;
          try {
            var tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
            [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (q) { gl.texParameteri(gl.TEXTURE_2D, q, gl.LINEAR); });
            [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (q) { gl.texParameteri(gl.TEXTURE_2D, q, gl.CLAMP_TO_EDGE); });
            ready++; if (reduced && ready > 1) drawFx(0);
          } catch (e) { fail(); }   /* e.g. opened from file:// -> CSS crossfade fallback */
        };
        im.onerror = fail;
        im.src = src;
      });
      gl.uniform1i(gl.getUniformLocation(pr, "A"), 0); gl.uniform1i(gl.getUniformLocation(pr, "K"), 1);
      U.P = gl.getUniformLocation(pr, "P"); U.T = gl.getUniformLocation(pr, "T");
    }
  }
  function drawFx(t) {
    if (!gl || ready < 2) return;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.P, mp); gl.uniform1f(U.T, t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ---------- Scene driver ---------- */
  var t0 = performance.now(), last = t0, cur = -1;
  function frame(now) {
    if (!vis) { raf = 0; return; }
    var t = (now - t0) / 1000, vh = window.innerHeight, sy = Math.min(window.scrollY, vh * 1.2);
    var sc = (Math.floor(t / 6) + Math.floor(Math.min(window.scrollY, vh) / (vh * .28))) % 2;
    if (sc !== cur) { cur = sc; hx.classList.toggle("b", sc === 1); }
    var dt = Math.min((now - last) / 1000, .05); last = now;
    var stp = dt / 2.6; mp += Math.max(-stp, Math.min(stp, sc - mp));
    fw.style.transform = "translate3d(0," + (sy * .22).toFixed(1) + "px,0) scale(" + (1 + Math.min(sy / vh, 1) * .07).toFixed(3) + ")";
    ew.style.transform = "translate3d(0," + (sy * .1).toFixed(1) + "px,0)";
    drawSky(t, sy); drawFx(t);
    raf = requestAnimationFrame(frame);
  }
  size(); window.addEventListener("resize", size);
  if (!reduced) {
    raf = requestAnimationFrame(frame);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        vis = es[0].isIntersecting;               /* pause everything when hero is off-screen */
        if (vis && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      }).observe(hx);
    }
  }
})();
