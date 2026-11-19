/* SPARK 2K26 — live purple background (poster style): deep violet, slow flowing light bands, soft glow.
   Fixed behind every page except the first screen. WebGL at reduced resolution, CSS gradient fallback. */
(function () {
  "use strict";
  if (document.getElementById("livebg")) return;
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
    "varying vec2 v;uniform float T,AR;",
    "float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}",
    "float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}",
    "float fb(vec2 q){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n(q);q=q*2.03+vec2(1.7,9.2);a*=.5;}return s;}",
    "void main(){",
    "  float t=T;vec2 p=vec2(v.x*AR,v.y);",
    "  vec2 q=p+.34*vec2(fb(p*1.3+vec2(0.,t*.045)),fb(p*1.3+vec2(5.2,-t*.04)));",
    "  float s=q.x*.55+q.y*.95+.38*sin(q.x*1.7+t*.11)+.55*fb(q*1.7+vec2(t*.03,0.));",
    "  float band=.5+.5*sin(s*2.2-t*.16);",
    "  float glow=pow(band,1.7);",
    "  float core=pow(band,6.);",
    "  float blob=smoothstep(.35,.9,fb(q*.9+vec2(3.,t*.02)));",
    "  vec3 base=vec3(.05,.012,.16);",
    "  vec3 vio=vec3(.30,.07,.78);",
    "  vec3 lav=vec3(.72,.50,1.);",
    "  vec3 mag=vec3(.85,.20,.85);",
    "  vec3 c=base+vio*glow*1.45+mag*glow*blob*.22+lav*core*.95;",
    "  c*=1.-.38*blob*(1.-core);",
    "  float vg=smoothstep(1.25,.25,length((v-.5)*vec2(1.,1.15)));",
    "  c*=.7+.3*vg;",
    "  c+=(h(v*vec2(900.,700.)+t)-.5)*.018;",
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
  var uT = gl.getUniformLocation(pr, "T"), uA = gl.getUniformLocation(pr, "AR");

  function size() {
    var w = Math.max(2, Math.round(window.innerWidth * .5)), h = Math.max(2, Math.round(window.innerHeight * .5));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform1f(uA, w / h);
  }
  var t0 = performance.now(), last = 0, raf = 0, vis = true;
  function draw(now) {
    raf = 0; if (!vis) return;
    if (now - last > 30) { last = now; gl.uniform1f(uT, (now - t0) / 1000 + 20.); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    if (!reduced) raf = requestAnimationFrame(draw);
  }
  size(); gl.uniform1f(uT, 24.); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { size(); if (reduced) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }, 150); }, { passive: true });
  cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); fallback(); }, false);
  document.addEventListener("visibilitychange", function () { vis = !document.hidden; if (vis && !raf && !reduced) raf = requestAnimationFrame(draw); });
  if (!reduced) raf = requestAnimationFrame(draw);
})();
