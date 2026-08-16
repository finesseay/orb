/* TraceLayer Harness — hero effect layer.
   Three systems, each with a graceful fallback:
   1. Interactive dot-grid (2D canvas): grid nodes repel from the cursor and
      spring back. Skipped on touch devices; the static CSS grid remains.
   2. Fluid glow (WebGL fragment shader): domain-warped tri-color glow that
      leans toward the pointer. Falls back to the CSS gradient orb.
   3. Pixel logo (three.js instanced voxels): the pulse mark as a cloud of
      3D cubes — assembles on load, wobbles, repels from the cursor, tilts
      with pointer parallax. Falls back to the 2D pixel cloud (which also
      gets pointer repulsion).
   Everything is skipped under prefers-reduced-motion. */
(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  var touch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  /* ?fxtest=1 spawns the logo pre-assembled — used by headless render checks */
  var TEST = /[?&]fxtest=1/.test(location.search);

  /* shared scroll position (capture phase — an inner container may scroll) */
  var sy = 0;
  function readSy() {
    return (document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0;
  }
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    sy = (t && t.nodeType === 1 && typeof t.scrollTop === 'number' && t.scrollTop > 0) ? t.scrollTop : readSy();
  }, { capture: true, passive: true });
  sy = readSy();

  function webglOk() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }
  var hasGL = webglOk();

  /* ============ 1. interactive dot-grid ============ */
  function initDotGrid() {
    if (touch) return;
    var host = document.getElementById('tl-hero-bg');
    if (!host) return;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var SP = 90, R = 140, LINE = 'rgba(94,180,170,', DOT = 'rgba(94,180,170,';
    var LINE_A = 0.07, DOT_A = 0.16;
    var pts = [], cols = 0, rows = 0, w = 0, h = 0, raf = 0, resizeT = null;
    var mouse = { x: NaN, y: NaN }, asleep = false, visible = true;
    function layout() {
      cols = Math.ceil(w / SP) + 1;
      rows = Math.ceil(h / SP) + 1;
      var ox = (w - (cols - 1) * SP) / 2, oy = (h - (rows - 1) * SP) / 2;
      pts = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var x = ox + c * SP, y = oy + r * SP;
        pts.push({ rx: x, ry: y, x: x, y: y, vx: 0, vy: 0 });
      }
    }
    function size() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * DPR; canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    size(); layout();
    new ResizeObserver(function () {
      size();
      clearTimeout(resizeT);
      resizeT = setTimeout(layout, 150);
    }).observe(canvas);
    function wake() { if (asleep) { asleep = false; raf = requestAnimationFrame(tick); } }
    window.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      wake();
    }, { passive: true });
    var last = 0, STEP = 1000 / 30;
    function tick(now) {
      if (!visible) return;
      if (now - last < STEP) { raf = requestAnimationFrame(tick); return; }
      last = now - ((now - last) % STEP);
      ctx.clearRect(0, 0, w, h);
      var mx = mouse.x, my = mouse.y, maxV = 0, i, p;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        var dx = p.x - mx, dy = p.y - my;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < R && d > 0.1) {
          var f = (1 - d / R) * 30;
          p.vx += (dx / d) * f * 0.1;
          p.vy += (dy / d) * f * 0.1;
        }
        p.vx += (p.rx - p.x) * 0.05;
        p.vy += (p.ry - p.y) * 0.05;
        p.vx *= 0.85; p.vy *= 0.85;
        p.x += p.vx; p.y += p.vy;
        var v = Math.abs(p.vx) + Math.abs(p.vy);
        if (v > maxV) maxV = v;
      }
      ctx.strokeStyle = LINE + LINE_A + ')';
      ctx.lineWidth = 0.5;
      var a, b, ux, uy, dd, r2, c2;
      for (r2 = 0; r2 < rows; r2++) for (c2 = 0; c2 < cols - 1; c2++) {
        a = pts[r2 * cols + c2]; b = pts[r2 * cols + c2 + 1];
        ux = b.x - a.x; uy = b.y - a.y; dd = Math.sqrt(ux * ux + uy * uy);
        if (dd < 20) continue;
        ux /= dd; uy /= dd;
        ctx.beginPath();
        ctx.moveTo(a.x + 10 * ux, a.y + 10 * uy);
        ctx.lineTo(b.x - 10 * ux, b.y - 10 * uy);
        ctx.stroke();
      }
      for (c2 = 0; c2 < cols; c2++) for (r2 = 0; r2 < rows - 1; r2++) {
        a = pts[r2 * cols + c2]; b = pts[(r2 + 1) * cols + c2];
        ux = b.x - a.x; uy = b.y - a.y; dd = Math.sqrt(ux * ux + uy * uy);
        if (dd < 20) continue;
        ux /= dd; uy /= dd;
        ctx.beginPath();
        ctx.moveTo(a.x + 10 * ux, a.y + 10 * uy);
        ctx.lineTo(b.x - 10 * ux, b.y - 10 * uy);
        ctx.stroke();
      }
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        var n = 1.8, al = DOT_A;
        if (!isNaN(mx)) {
          var ex = p.x - mx, ey = p.y - my;
          var l = Math.max(0, 1 - Math.sqrt(ex * ex + ey * ey) / R);
          n = 1.8 + 2 * l;
          al = DOT_A + 0.4 * l;
        }
        ctx.globalAlpha = al;
        ctx.fillStyle = DOT + '1)';
        ctx.fillRect(p.x - n, p.y - n, 2 * n, 2 * n);
      }
      ctx.globalAlpha = 1;
      if (maxV < 0.01) { asleep = true; return; }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) { asleep = false; raf = requestAnimationFrame(tick); }
    }, { threshold: 0 }).observe(canvas);
  }

  /* ============ 2. fluid glow (WebGL) ============ */
  function initGlow() {
    var layer = document.getElementById('tl-fx-layer');
    var orb = document.getElementById('tl-orb');
    if (!layer || !hasGL) return;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    var gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return;
    layer.insertBefore(canvas, layer.firstChild);
    if (orb) orb.style.display = 'none';
    var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    var FS = [
      'precision mediump float;',
      'uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;uniform float u_mw;',
      'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);',
      ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
      'float fbm(vec2 p){float v=0.;float a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<3;i++){v+=a*noise(p);p=r*p*2.03;a*=.5;}return v;}',
      'float glow(vec2 uv,vec2 c,float r){float d=length(uv-c);return exp(-d*d/(r*r));}',
      'void main(){',
      ' vec2 uv=gl_FragCoord.xy/u_res;uv.x*=u_res.x/u_res.y;',
      ' vec2 m=u_m;m.x*=u_res.x/u_res.y;',
      ' float t=u_t*.06;',
      ' vec2 warp=vec2(fbm(uv*2.2+t),fbm(uv*2.2-t))-.5;',
      ' vec2 p=uv+warp*.15;',
      ' vec2 base=vec2(u_res.x/u_res.y*.5+.07,.5);',
      ' vec2 lean=(m-base)*.18*u_mw;',
      ' vec2 c1=base+lean+vec2(sin(t*1.3)*.06-.05,cos(t*1.1)*.05-.03);',
      ' vec2 c2=base+lean*.6+vec2(cos(t*.9)*.07+.06,sin(t*1.4)*.06+.03);',
      ' vec2 c3=base+lean*1.3+vec2(sin(t*.7)*.05,cos(t*.8)*.05);',
      ' vec3 col=vec3(0.);',
      ' col+=vec3(.37,.92,.83)*glow(p,c1,.22)*.26;',
      ' col+=vec3(.39,.40,.95)*glow(p,c2,.25)*.22;',
      ' col+=vec3(.18,.83,.75)*glow(p,c3,.32)*.15;',
      ' col+=col*fbm(p*3.5+t*1.7)*.35;',
      ' float contain=exp(-dot(uv-base,uv-base)/.34);',
      ' col*=contain;',
      ' col+=(hash(gl_FragCoord.xy+fract(u_t)*7.)-.5)*.014;',
      ' col=max(col,0.);',
      ' float a=clamp(max(max(col.r,col.g),col.b),0.,1.);',
      ' gl_FragColor=vec4(col,a);',
      '}'].join('\n');
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { canvas.remove(); if (orb) orb.style.display = ''; return; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); if (orb) orb.style.display = ''; return; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uRes = gl.getUniformLocation(prog, 'u_res'),
        uT = gl.getUniformLocation(prog, 'u_t'),
        uM = gl.getUniformLocation(prog, 'u_m'),
        uMw = gl.getUniformLocation(prog, 'u_mw');
    var GDPR = Math.min(window.devicePixelRatio || 1, 1.25);
    var w = 0, h = 0;
    function size() {
      w = Math.max(2, Math.round(canvas.clientWidth * GDPR));
      h = Math.max(2, Math.round(canvas.clientHeight * GDPR));
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    size();
    new ResizeObserver(size).observe(canvas);
    var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5, mw = 0;
    if (!touch) {
      window.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        if (r.height < 2) return;
        tx = (e.clientX - r.left) / r.width;
        ty = 1 - (e.clientY - r.top) / r.height;
        mw = 1;
      }, { passive: true });
    }
    var visible = true, last = 0, STEP = 1000 / 30, t0 = performance.now();
    function tick(now) {
      requestAnimationFrame(tick);
      if (!visible || now - last < STEP) return;
      last = now - ((now - last) % STEP);
      mx += (tx - mx) * 0.045; my += (ty - my) * 0.045;
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.uniform2f(uM, mx, my);
      gl.uniform1f(uMw, mw);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(tick);
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
  }

  /* ============ 3. pixel logo ============ */
  var PULSE = 'M2 12h3l2.5-6 5 12 2.5-6h3';
  function samplePoints(w, h, refEl) {
    var off = document.createElement('canvas');
    off.width = w; off.height = h;
    var oc = off.getContext('2d', { willReadFrequently: true });
    var s = 430 / 16;
    var anchor = document.getElementById('tl-anchor');
    var left = w * 0.42, cy = h * 0.4;
    if (anchor && refEl) {
      var ar = anchor.getBoundingClientRect(), cr = refEl.getBoundingClientRect();
      left = ar.left - cr.left + ar.width * 0.35;
      cy = ar.top - cr.top + ar.height / 2;
    }
    var cx = left + 8 * s;
    oc.setTransform(s, 0, 0, s, left - 2 * s, cy - 12 * s);
    oc.lineWidth = 2.1; oc.lineCap = 'round'; oc.lineJoin = 'round';
    oc.strokeStyle = '#fff';
    oc.stroke(new Path2D(PULSE));
    var data = oc.getImageData(0, 0, w, h).data;
    var pts = [];
    var cell = 5;
    var x0 = Math.max(0, Math.floor(cx - 300)), x1 = Math.min(w, Math.ceil(cx + 300));
    var y0 = Math.max(0, Math.floor(cy - 300)), y1 = Math.min(h, Math.ceil(cy + 300));
    for (var y = y0; y < y1; y += cell) for (var x = x0; x < x1; x += cell) {
      if (data[(y * w + x) * 4 + 3] > 100 && Math.random() < 0.62) {
        pts.push({
          tx: x + (Math.random() - 0.5) * cell * 0.9,
          ty: y + (Math.random() - 0.5) * cell * 0.9,
          x: cx + (Math.random() - 0.5) * 900,
          y: cy + (Math.random() - 0.5) * 700,
          sz: 1.6 + Math.random() * 2.2,
          a: 0.10 + Math.random() * 0.30,
          dx: Math.random() - 0.5, dy: Math.random() - 0.9,
          ph: Math.random() * Math.PI * 2,
          accent: Math.random() < 0.15
        });
      }
    }
    var glyph = pts.slice();
    for (var i = 0; i < glyph.length * 0.35; i++) {
      var b = glyph[(Math.random() * glyph.length) | 0];
      pts.push({
        tx: b.tx + (Math.random() - 0.5) * 190,
        ty: b.ty + (Math.random() - 0.5) * 190,
        x: cx + (Math.random() - 0.5) * 900,
        y: cy + (Math.random() - 0.5) * 700,
        sz: 1.2 + Math.random() * 1.4,
        a: 0.03 + Math.random() * 0.10,
        dx: Math.random() - 0.5, dy: Math.random() - 0.9,
        ph: Math.random() * Math.PI * 2,
        accent: Math.random() < 0.1
      });
    }
    return { pts: pts, cx: cx, cy: cy };
  }

  /* 2D fallback: original pixel cloud + pointer repulsion, tamed scroll scatter */
  function initLogo2D() {
    var canvas = document.getElementById('tl-logo-pixels');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var pts = [], w = 0, h = 0, jolt = 0, lastSy = null;
    var mouse = { x: NaN, y: NaN };
    function build() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = w * DPR; canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      pts = samplePoints(w, h, canvas).pts;
      if (TEST) pts.forEach(function (p) { p.x = p.tx; p.y = p.ty; });
    }
    build();
    new ResizeObserver(build).observe(canvas);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
    setTimeout(build, 1400);
    if (!touch) {
      window.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      }, { passive: true });
    }
    var t = 0;
    (function tick() {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      jolt = jolt * 0.92 + Math.min(60, Math.abs(sy - (lastSy === null ? sy : lastSy))) * 0.3;
      lastSy = sy;
      var dz = Math.min(1, jolt / 26);
      var lift = sy * 0.12;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var amp = 1 + dz * 1.6;
        var scat = dz * 90;
        var gx = p.tx + Math.sin(t * 0.9 + p.ty * 0.018 + p.ph) * 5 * amp + p.dx * scat;
        var gy = p.ty + Math.cos(t * 0.7 + p.tx * 0.014 + p.ph) * 4 * amp + p.dy * scat - lift * 0.35;
        var boost = 0;
        if (!isNaN(mouse.x)) {
          var ex = p.tx - mouse.x, ey = p.ty - mouse.y;
          var d = Math.sqrt(ex * ex + ey * ey);
          if (d < 140 && d > 0.1) {
            var l = 1 - d / 140;
            gx += (ex / d) * l * 34;
            gy += (ey / d) * l * 34;
            boost = l;
          }
        }
        p.x += (gx - p.x) * 0.045; p.y += (gy - p.y) * 0.045;
        var tw = p.a * (0.75 + 0.25 * Math.sin(t * 1.6 + p.ph)) * (1 - dz * 0.35) * (1 + boost * 1.2);
        if (tw <= 0.004) continue;
        ctx.fillStyle = p.accent
          ? 'rgba(94,234,212,' + Math.min(1, tw).toFixed(3) + ')'
          : 'rgba(160,176,174,' + Math.min(1, tw).toFixed(3) + ')';
        var sz2 = p.sz * (1 + boost * 0.35);
        ctx.fillRect(p.x, p.y, sz2, sz2);
      }
      requestAnimationFrame(tick);
    })();
  }

  /* 3D voxel logo (three.js) */
  function initLogo3D(THREE) {
    var host = document.getElementById('tl-logo-pixels');
    if (!host || !host.parentElement) return initLogo2D();
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen';
    host.parentElement.appendChild(canvas);
    host.style.display = 'none';
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
    } catch (e) { canvas.remove(); host.style.display = ''; return initLogo2D(); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(0, 2, 0, 2, -2000, 2000);
    var group = new THREE.Group();
    scene.add(group);
    var mesh = null, meta = [], glyphCx = 0, glyphCy = 0;
    var dummy = new THREE.Object3D();
    var SLATE = new THREE.Color(0.627, 0.690, 0.682);
    var TEAL = new THREE.Color(0.369, 0.918, 0.831);
    var w = 0, h = 0;
    function build() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.right = w; camera.bottom = h;
      camera.updateProjectionMatrix();
      var sample = samplePoints(w, h, canvas);
      glyphCx = sample.cx; glyphCy = sample.cy;
      meta = sample.pts.map(function (p) {
        var m = {
          tx: p.tx, ty: p.ty, tz: (Math.random() - 0.5) * 16,
          x: p.tx + (p.x - p.tx) * 0.55, y: p.ty + (p.y - p.ty) * 0.55,
          z: (Math.random() - 0.5) * 240,
          sz: p.sz * 1.05, a: p.a, dx: p.dx, dy: p.dy, ph: p.ph,
          accent: p.accent, boost: 0
        };
        if (TEST) { m.x = m.tx; m.y = m.ty; m.z = m.tz; }
        return m;
      });
      if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
      var geo = new THREE.BoxGeometry(1, 1, 1);
      var mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      mesh = new THREE.InstancedMesh(geo, mat, meta.length);
      var col = new THREE.Color();
      for (var i = 0; i < meta.length; i++) {
        var m = meta[i];
        col.copy(m.accent ? TEAL : SLATE).multiplyScalar(m.a * 1.0);
        mesh.setColorAt(i, col);
        dummy.position.set(m.x, m.y, m.z);
        dummy.scale.setScalar(m.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      group.add(mesh);
    }
    build();
    var rebuildT = null;
    new ResizeObserver(function () { clearTimeout(rebuildT); rebuildT = setTimeout(build, 150); }).observe(canvas);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { build(); });
    setTimeout(build, 1400);
    var mouse = { x: NaN, y: NaN }, tiltX = 0, tiltY = 0;
    if (!touch) {
      window.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      }, { passive: true });
    }
    var t = 0, jolt = 0, lastSy = null, visible = true;
    var col2 = new THREE.Color();
    function tick() {
      requestAnimationFrame(tick);
      if (!visible || !mesh) return;
      t += 0.016;
      jolt = jolt * 0.92 + Math.min(60, Math.abs(sy - (lastSy === null ? sy : lastSy))) * 0.3;
      lastSy = sy;
      var dz = Math.min(1, jolt / 26);
      var lift = sy * 0.12 * 0.35;
      /* pointer parallax tilt around the glyph centre */
      var wantX = 0, wantY = 0;
      if (!isNaN(mouse.x) && w > 0) {
        wantY = ((mouse.x - glyphCx) / w) * 0.30;
        wantX = ((mouse.y - glyphCy) / h) * -0.22;
      }
      tiltY += (wantY - tiltY) * 0.06;
      tiltX += (wantX - tiltX) * 0.06;
      group.position.set(glyphCx, glyphCy - lift, 0);
      group.rotation.set(tiltX, tiltY + Math.sin(t * 0.3) * 0.05, 0);
      var needColor = false;
      for (var i = 0; i < meta.length; i++) {
        var m = meta[i];
        var amp = 1 + dz * 1.6;
        var scat = dz * 90;
        var gx = m.tx + Math.sin(t * 0.9 + m.ty * 0.018 + m.ph) * 5 * amp + m.dx * scat;
        var gy = m.ty + Math.cos(t * 0.7 + m.tx * 0.014 + m.ph) * 4 * amp + m.dy * scat;
        var gz = m.tz + Math.sin(t * 0.5 + m.ph) * 6;
        var boost = 0;
        if (!isNaN(mouse.x)) {
          var ex = m.tx - mouse.x, ey = m.ty - mouse.y;
          var d = Math.sqrt(ex * ex + ey * ey);
          if (d < 140 && d > 0.1) {
            var l = 1 - d / 140;
            gx += (ex / d) * l * 34;
            gy += (ey / d) * l * 34;
            gz += l * 26;
            boost = l;
          }
        }
        m.x += (gx - m.x) * 0.07;
        m.y += (gy - m.y) * 0.07;
        m.z += (gz - m.z) * 0.07;
        if (Math.abs(boost - m.boost) > 0.02) {
          m.boost = boost;
          col2.copy(m.accent ? TEAL : SLATE).multiplyScalar(m.a * 1.0 * (1 + boost * 2.6));
          mesh.setColorAt(i, col2);
          needColor = true;
        }
        dummy.position.set(m.x - glyphCx, m.y - glyphCy, m.z);
        dummy.scale.setScalar(m.sz * (1 + boost * 0.4));
        dummy.rotation.set(t * 0.2 + m.ph, t * 0.15 + m.ph, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (needColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      renderer.render(scene, camera);
    }
    tick();
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
  }

  function loadThree(cb, fail) {
    if (window.THREE) return cb(window.THREE);
    var s = document.createElement('script');
    s.src = '/assets/vendor/three.min.js';
    s.onload = function () { window.THREE ? cb(window.THREE) : fail(); };
    s.onerror = fail;
    document.head.appendChild(s);
  }

  initDotGrid();
  initGlow();
  if (hasGL) loadThree(initLogo3D, initLogo2D);
  else initLogo2D();
})();
