/* SPARK 2K26 — live background built from the supplied purple glow artwork (assets/bg-live.jpg).
   Two copies of the art flow through each other with liquid warping, rotation, zoom and drift,
   plus expanding ring waves — all moving continuously in different directions. WebGL @ half res,
   CSS-animated image fallback. Fixed behind every page except the first screen. */
(function () {
  "use strict";
  if (document.getElementById("livebg")) return;
  var IMG = "/assets/bg-live.jpg?v=1";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cv = document.createElement("canvas");
  cv.id = "livebg"; cv.setAttribute("aria-hidden", "true");
  document.body.insertBefore(cv, document.body.firstChild);
  document.documentElement.classList.add("has-livebg");

  var gl = null;
  try { gl = cv.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
  function fallback() { document.documentElement.classList.add("livebg-fb"); if (cv.parentNode) cv.parentNode.removeChild(cv); gl = null; }
  if (!gl) { fallback(); return; }

  var vs = "attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
  var fs = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
    "varying vec2 v;uniform float T,AR;uniform sampler2D B;",
    "const float IA=.7073;",
    "float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}",
    "vec2 mir(vec2 x){return 1.-abs(1.-2.*fract(x*.5));}",
    "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
    /* layer: warp -> rotate -> zoom -> pan -> sample (mirrored so it never runs out) */
    "vec3 layer(vec2 p,float t,float ang,float zoom,vec2 pan,float wa,float wf,float sp,float ph){",
    "  p+=wa*vec2(sin(p.y*wf+t*sp+ph)+.45*sin(p.y*wf*2.3-t*sp*.7),sin(p.x*wf*1.1-t*sp*.9+ph)+.45*sin(p.x*wf*2.1+t*sp*.6));",
    "  p=rot(ang)*p;",
    "  p=p/zoom+pan;",
    "  vec2 q=p/vec2(IA,1.)/max(1.,AR/IA)+.5;",
    "  return texture2D(B,mir(q)).rgb;}",
    "void main(){",
    "  float t=T;vec2 p=(v-.5)*vec2(AR,1.);",
    "  vec3 a=layer(p,t,sin(t*.045)*.55+t*.01,1.35+.10*sin(t*.11),vec2(sin(t*.07),cos(t*.053))*.16,.060,3.1,.55,0.);",
    "  vec3 b=layer(p,t,-sin(t*.037+1.)*.7+1.571,1.9+.14*sin(t*.09+2.),vec2(cos(t*.061),sin(t*.083))*.22,.085,2.3,-.42,2.1);",
    "  b=b.bgr*vec3(1.05,.8,1.0)+b*vec3(0.,.0,.12);",
    "  vec3 c=1.-(1.-a*.96)*(1.-b*.62);",
    /* expanding ring waves from two drifting centres */
    "  vec2 c1=vec2(sin(t*.09)*.55,cos(t*.07)*.35-.1),c2=vec2(cos(t*.06+1.)*.6,sin(t*.08+2.)*.4);",
    "  float w1=.5+.5*sin(length(p-c1)*7.5-t*.75+sin(p.y*2.+t*.3)*.8);",
    "  float w2=.5+.5*sin(length(p-c2)*5.5+t*.55+sin(p.x*2.4-t*.25)*.9);",
    "  vec3 ring=vec3(.52,.22,.95)*pow(w1,4.)*.20+vec3(.80,.45,.95)*pow(w2,5.)*.14;",
    "  c+=ring*(.35+.65*(1.-dot(c,vec3(.33))));",
    "  c*=.9;",
    "  float vg=smoothstep(1.3,.3,length((v-.5)*vec2(1.,1.2)));",
    "  c*=.72+.28*vg;",
    "  c+=(h(v*vec2(900.,700.)+t)-.5)*.016;",
    "  gl_FragColor=vec4(c,1.);}"
  ].join("\n");
  function sh(ty, src) { var s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { fallback(); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var lc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);
  var uT = gl.getUniformLocation(pr, "T"), uA = gl.getUniformLocation(pr, "AR"), uB = gl.getUniformLocation(pr, "B");

  function size() {
    var w = Math.max(2, Math.round(window.innerWidth * .5)), h = Math.max(2, Math.round(window.innerHeight * .5));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform1f(uA, w / h);
  }
  var t0 = performance.now(), last = 0, raf = 0, vis = true, ready = false;
  /* slow ambient background: 20fps is plenty on a phone, ~33fps elsewhere */
  var frameMs = window.innerWidth < 720 ? 50 : 30;
  function draw(now) {
    raf = 0; if (!vis || !ready) return;
    if (now - last > frameMs) { last = now; gl.uniform1f(uT, (now - t0) / 1000 + 20.); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    if (!reduced) raf = requestAnimationFrame(draw);
  }
  function start() {
    ready = true; size(); gl.uniform1f(uT, 24.); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reduced && !raf) raf = requestAnimationFrame(draw);
  }
  var im = new Image();
  im.onload = function () {
    var tx = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uB, 0); start();
  };
  im.onerror = fallback;
  im.src = IMG;
  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (!ready) return; size(); if (reduced) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }, 150); }, { passive: true });
  cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); fallback(); }, false);
  document.addEventListener("visibilitychange", function () { vis = !document.hidden; if (vis && ready && !raf && !reduced) raf = requestAnimationFrame(draw); });
})();
