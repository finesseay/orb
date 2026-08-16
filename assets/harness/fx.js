/* TraceLayer Harness — hero effect layer.
   Systems, each with a graceful fallback:
   1. Fluid silk field (WebGL2): the reference site's flowmap fluid shader,
      ported faithfully and recolored to the TraceLayer indigo→teal gradient.
      Slow silky ribbons; the cursor stirs the field through a quarter-res
      flowmap. Falls back to the CSS gradient orb on no-WebGL2.
   2. Interactive dot-grid (2D canvas): grid nodes repel from the cursor and
      spring back. Skipped on touch devices.
   3. Pixel logo (three.js instanced voxels): the pulse mark as a cloud of
      3D cubes — assembles on load, wobbles, repels from the cursor, tilts
      with pointer parallax. Falls back to the 2D pixel cloud.
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

  function hex2rgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }

  /* ============ 1. fluid silk field (WebGL2, ported from the reference) ============ */
  function initFluid() {
    var host = document.getElementById('tl-hero-bg');
    if (!host) return false;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    var gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, powerPreference: 'low-power' });
    } catch (e) { return false; }
    if (!gl) return false;
    host.insertBefore(canvas, host.firstChild);

    var P = {
      mouseRadius: 0.09, mouseStrength: 1.8, mouseSmoothing: 0.1, mouseVelocity: 0.2, decay: 0.925,
      distortBoost: 1.0, swirlBoost: 0.4,
      glowIntensity: 0, glowColors: ['#f4fff9', '#2dd4bf', '#4640c4'],
      speed: 28, scale: 1.77, offsetX: -124, offsetY: -48, grain: 0.005,
      colors: ['#10182b', '#3f46b0', '#12716a', '#f0fbf7', '#101725'],
      lightX: 0.89, lightY: 0.46, lightCore: 0.14, lightHalo: 0.2, vignette: 0.30, lightFollow: 0.63,
      bloomThreshold: 0.61, bloomRange: 0.18, bloomStrength: 0.4
    };

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    function prog(fsSrc) {
      var vs = sh(gl.VERTEX_SHADER, '#version 300 es\nin vec4 a_position;\nout vec2 vUv;\nvoid main() {\n  vUv = a_position.xy * 0.5 + 0.5;\n  gl_Position = a_position;\n}\n');
      var fs = sh(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
    }

    var flowProg = prog('#version 300 es\nprecision mediump float;\nin vec2 vUv;\nuniform sampler2D u_prev;\nuniform vec2 u_mouse;\nuniform vec2 u_velocity;\nuniform float u_brushRadius;\nuniform float u_brushStrength;\nuniform float u_decay;\nout vec4 fragColor;\n\nvoid main() {\n  vec4 prev = texture(u_prev, vUv);\n\n  prev.r *= u_decay;\n  prev.gb = mix(vec2(0.5), prev.gb, u_decay);\n\n  float dist = distance(vUv, u_mouse);\n\n  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));\n  influence = max(0.0, influence - 0.01);\n\n  float speed = length(u_velocity);\n  float presenceStrength = u_brushStrength * 0.3;\n  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;\n  float totalStrength = presenceStrength + velBonus;\n\n  prev.r = max(prev.r, influence * totalStrength);\n  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;\n  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);\n  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);\n\n  fragColor = prev;\n}\n');

    var fluidProg = prog('#version 300 es\nprecision mediump float;\nin vec2 vUv;\nuniform float u_time;\nuniform vec2 u_resolution;\nuniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;\nuniform float u_scale;\nuniform vec2 u_offset;\nuniform float u_grain;\nuniform sampler2D u_flowmap;\nuniform float u_distortBoost;\nuniform float u_swirlBoost;\nuniform float u_glowIntensity;\nuniform vec3 u_glowColor1;\nuniform vec3 u_glowColor2;\nuniform vec3 u_glowColor3;\nuniform vec2 u_lightPos;\nuniform float u_lightCore;\nuniform float u_lightHalo;\nuniform float u_vignette;\nuniform float u_bloomThreshold;\nuniform float u_bloomRange;\nuniform float u_bloomStrength;\nout vec4 fragColor;\n\nvec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}\nvec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}\nvec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}\nvec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}\n\nfloat snoise(vec3 v){\n  const vec2 C=vec2(1./6.,1./3.);\n  const vec4 D=vec4(0.,.5,1.,2.);\n  vec3 i=floor(v+dot(v,C.yyy));\n  vec3 x0=v-i+dot(i,C.xxx);\n  vec3 g=step(x0.yzx,x0.xyz);\n  vec3 l=1.-g;\n  vec3 i1=min(g.xyz,l.zxy);\n  vec3 i2=max(g.xyz,l.zxy);\n  vec3 x1=x0-i1+C.xxx;\n  vec3 x2=x0-i2+C.yyy;\n  vec3 x3=x0-D.yyy;\n  i=mod289v3(i);\n  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));\n  float n_=.142857142857;\n  vec3 ns=n_*D.wyz-D.xzx;\n  vec4 j=p-49.*floor(p*ns.z*ns.z);\n  vec4 x_=floor(j*ns.z);\n  vec4 y_=floor(j-7.*x_);\n  vec4 x=x_*ns.x+ns.yyyy;\n  vec4 y=y_*ns.x+ns.yyyy;\n  vec4 h=1.-abs(x)-abs(y);\n  vec4 b0=vec4(x.xy,y.xy);\n  vec4 b1=vec4(x.zw,y.zw);\n  vec4 s0=floor(b0)*2.+1.;\n  vec4 s1=floor(b1)*2.+1.;\n  vec4 sh=-step(h,vec4(0.));\n  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;\n  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;\n  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);\n  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);\n  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));\n  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;\n  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);\n  m=m*m;\n  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));\n}\n\nfloat hash(vec2 p){\n  vec3 p3=fract(vec3(p.xyx)*.1031);\n  p3+=dot(p3,p3.yzx+33.33);\n  return fract((p3.x+p3.y)*p3.z);\n}\n\nfloat fbm(vec3 p){\n  float v=0.,amp=.6;vec3 shift=vec3(100.);\n  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}\n  return v;\n}\n\nfloat fluidNoise(vec2 uv,float t){\n  float n1=fbm(vec3(uv*.6,t*.06));\n  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));\n  vec2 w1=vec2(n1,n2)*.6;\n  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));\n  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));\n  vec2 w2=vec2(n3,n4)*.5;\n  return fbm(vec3((uv+w1+w2)*.5,t*.04));\n}\n\nvec2 curlish(vec2 uv,float t){\n  float eps=.02;\n  float n=snoise(vec3(uv*.8,t));\n  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));\n  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));\n  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;\n}\n\nvoid main(){\n  float aspect=u_resolution.x/u_resolution.y;\n  vec2 uv=gl_FragCoord.xy/u_resolution;\n  vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;\n  float t=u_time;\n\n  vec4 flow = texture(u_flowmap, uv);\n  float influence = flow.r;\n  vec2 flowDir = (flow.gb - 0.5) * 2.0;\n\n  suv += flowDir * influence * u_distortBoost * 0.8;\n  float swirlAngle = influence * u_swirlBoost * 2.5;\n  float cs = cos(swirlAngle), sn = sin(swirlAngle);\n  vec2 delta = suv - vec2(uv.x * aspect, uv.y) * u_scale;\n  suv += (mat2(cs, sn, -sn, cs) * delta - delta) * influence;\n\n  vec2 curl=curlish(suv,t*.04);\n  vec2 uvD=suv+curl*12.;\n  float f=fluidNoise(uvD,t);\n  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;\n  float n=f*.5+.5;\n  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));\n  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));\n  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);\n  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);\n\n  float glow = smoothstep(0.0, 0.8, influence);\n  float glowNoise = snoise(vec3(uvD * 1.5, t * 0.08)) * 0.5 + 0.5;\n  float glowDist = smoothstep(0.0, 1.0, influence);\n  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);\n  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);\n  col = mix(col, glowMix, glow * u_glowIntensity);\n\n  if(u_grain>0.0){\n    vec2 flowOffset = (uvD - suv) * u_resolution.y;\n    vec2 gp = floor((gl_FragCoord.xy + flowOffset) / 5.0);\n    float gr=hash(gp)*2.-1.;\n    col+=gr*u_grain;\n  }\n\n  float luma=dot(col,vec3(.299,.587,.114));\n  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);\n  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;\n\n  float ld=length((uv-u_lightPos)*vec2(aspect,1.));\n  float core=exp(-ld*ld*4.5);\n  float halo=exp(-ld*1.8);\n  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;\n\n  float vig=1.-smoothstep(.35,.75,length(uv-.5));\n  col=mix(col*(1.-u_vignette),col,vig);\n  fragColor=vec4(col,1.);\n}\n');

    if (!flowProg || !fluidProg) { canvas.remove(); return false; }

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    function bindQuad(p) {
      var loc = gl.getAttribLocation(p, 'a_position');
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    function U(p, n) { return gl.getUniformLocation(p, n); }
    var fu = { prev: U(flowProg, 'u_prev'), mouse: U(flowProg, 'u_mouse'), velocity: U(flowProg, 'u_velocity'), brushRadius: U(flowProg, 'u_brushRadius'), brushStrength: U(flowProg, 'u_brushStrength'), decay: U(flowProg, 'u_decay') };
    var mu = {
      time: U(fluidProg, 'u_time'), resolution: U(fluidProg, 'u_resolution'), scale: U(fluidProg, 'u_scale'),
      offset: U(fluidProg, 'u_offset'), grain: U(fluidProg, 'u_grain'), flowmap: U(fluidProg, 'u_flowmap'),
      distortBoost: U(fluidProg, 'u_distortBoost'), swirlBoost: U(fluidProg, 'u_swirlBoost'),
      glowIntensity: U(fluidProg, 'u_glowIntensity'),
      glowColor1: U(fluidProg, 'u_glowColor1'), glowColor2: U(fluidProg, 'u_glowColor2'), glowColor3: U(fluidProg, 'u_glowColor3'),
      c1: U(fluidProg, 'u_c1'), c2: U(fluidProg, 'u_c2'), c3: U(fluidProg, 'u_c3'), c4: U(fluidProg, 'u_c4'), c5: U(fluidProg, 'u_c5'),
      lightPos: U(fluidProg, 'u_lightPos'), lightCore: U(fluidProg, 'u_lightCore'), lightHalo: U(fluidProg, 'u_lightHalo'),
      vignette: U(fluidProg, 'u_vignette'),
      bloomThreshold: U(fluidProg, 'u_bloomThreshold'), bloomRange: U(fluidProg, 'u_bloomRange'), bloomStrength: U(fluidProg, 'u_bloomStrength')
    };

    var FDPR = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(2, Math.round(canvas.clientWidth * FDPR));
    var h = Math.max(2, Math.round(canvas.clientHeight * FDPR));
    canvas.width = w; canvas.height = h;
    var fw = Math.round(w / 4), fh = Math.round(h / 4);
    function flowTex() {
      var neutral = new Uint8Array(fw * fh * 4);
      for (var i = 0; i < fw * fh; i++) { neutral[4 * i] = 0; neutral[4 * i + 1] = 128; neutral[4 * i + 2] = 128; neutral[4 * i + 3] = 255; }
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, neutral);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo: fbo, tex: tex };
    }
    var texA = flowTex(), texB = flowTex(), flip = false;

    var m = { x: 0.5, y: 0.5, smoothX: 0.5, smoothY: 0.5, svx: 0, svy: 0 };
    if (!touch) {
      window.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        if (r.height < 2) return;
        m.x = (e.clientX - r.left) / r.width;
        m.y = 1 - (e.clientY - r.top) / r.height;
      }, { passive: true });
    }

    var glow1 = hex2rgb(P.glowColors[0]), glow2 = hex2rgb(P.glowColors[1]), glow3 = hex2rgb(P.glowColors[2]);
    var cols = P.colors.map(hex2rgb);
    var visible = true, last = 0, STEP = 1000 / 30, t0 = performance.now();
    function tick(now) {
      requestAnimationFrame(tick);
      if (!visible || now - last < STEP) return;
      last = now - ((now - last) % STEP);
      var nw = Math.max(2, Math.round(canvas.clientWidth * FDPR));
      var nh = Math.max(2, Math.round(canvas.clientHeight * FDPR));
      if (nw !== w || nh !== h) { w = nw; h = nh; canvas.width = w; canvas.height = h; }

      m.smoothX += (m.x - m.smoothX) * P.mouseSmoothing;
      m.smoothY += (m.y - m.smoothY) * P.mouseSmoothing;
      m.svx += ((m.x - m.smoothX) * 0.5 - m.svx) * P.mouseVelocity;
      m.svy += ((m.y - m.smoothY) * 0.5 - m.svy) * P.mouseVelocity;

      var src = flip ? texA : texB, dst = flip ? texB : texA;
      flip = !flip;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, fw, fh);
      gl.useProgram(flowProg);
      bindQuad(flowProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(fu.prev, 0);
      gl.uniform2f(fu.mouse, m.smoothX, m.smoothY);
      gl.uniform2f(fu.velocity, m.svx, m.svy);
      gl.uniform1f(fu.brushRadius, P.mouseRadius);
      gl.uniform1f(fu.brushStrength, touch ? 0 : P.mouseStrength);
      gl.uniform1f(fu.decay, P.decay);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);

      var t = (performance.now() - t0) * 0.001 * (P.speed / 100);
      gl.useProgram(fluidProg);
      bindQuad(fluidProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1i(mu.flowmap, 0);
      gl.uniform1f(mu.time, t);
      gl.uniform2f(mu.resolution, w, h);
      gl.uniform1f(mu.scale, P.scale);
      gl.uniform2f(mu.offset, P.offsetX / 100, P.offsetY / 100);
      gl.uniform1f(mu.grain, P.grain);
      gl.uniform1f(mu.distortBoost, P.distortBoost);
      gl.uniform1f(mu.swirlBoost, P.swirlBoost);
      var lf = touch ? 0 : P.lightFollow;
      gl.uniform2f(mu.lightPos, P.lightX + (m.smoothX - P.lightX) * lf, P.lightY);
      gl.uniform1f(mu.lightCore, touch ? 0 : P.lightCore);
      gl.uniform1f(mu.lightHalo, touch ? 0 : P.lightHalo);
      gl.uniform1f(mu.vignette, P.vignette);
      gl.uniform1f(mu.bloomThreshold, P.bloomThreshold);
      gl.uniform1f(mu.bloomRange, P.bloomRange);
      gl.uniform1f(mu.bloomStrength, P.bloomStrength);
      gl.uniform1f(mu.glowIntensity, P.glowIntensity);
      gl.uniform3f(mu.glowColor1, glow1[0], glow1[1], glow1[2]);
      gl.uniform3f(mu.glowColor2, glow2[0], glow2[1], glow2[2]);
      gl.uniform3f(mu.glowColor3, glow3[0], glow3[1], glow3[2]);
      gl.uniform3f(mu.c1, cols[0][0], cols[0][1], cols[0][2]);
      gl.uniform3f(mu.c2, cols[1][0], cols[1][1], cols[1][2]);
      gl.uniform3f(mu.c3, cols[2][0], cols[2][1], cols[2][2]);
      gl.uniform3f(mu.c4, cols[3][0], cols[3][1], cols[3][2]);
      gl.uniform3f(mu.c5, cols[4][0], cols[4][1], cols[4][2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(tick);
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
    return true;
  }

  /* ============ 2. interactive dot-grid ============ */
  function initDotGrid() {
    if (touch) return;
    var host = document.getElementById('tl-hero-bg');
    if (!host) return;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var SP = 90, R = 140, LINE = 'rgba(210,240,235,', DOT = 'rgba(220,245,240,';
    var LINE_A = 0.05, DOT_A = 0.14;
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

  /* 2D fallback: pixel cloud + pointer repulsion, tamed scroll scatter */
  function initLogo2D() {
    var canvas = document.getElementById('tl-logo-pixels');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var pts = [], w = 0, h = 0, jolt = 0, lastSy = null, firstBuild = true;
    var mouse = { x: NaN, y: NaN };
    function build() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = w * DPR; canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      pts = samplePoints(w, h, canvas).pts;
      pts.forEach(function (p) {
        if (firstBuild) {
          p.x = p.tx + (p.x - p.tx) * 0.5;
          p.y = p.ty + (p.y - p.ty) * 0.5;
        } else {
          p.x = p.tx + (Math.random() - 0.5) * 80;
          p.y = p.ty + (Math.random() - 0.5) * 60;
        }
        if (TEST) { p.x = p.tx; p.y = p.ty; }
      });
      firstBuild = false;
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
        p.x += (gx - p.x) * 0.07; p.y += (gy - p.y) * 0.07;
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
    var mesh = null, meta = [], glyphCx = 0, glyphCy = 0, firstBuild = true;
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
          x: p.tx + (p.x - p.tx) * 0.28, y: p.ty + (p.y - p.ty) * 0.28,
          z: (Math.random() - 0.5) * 120,
          sz: p.sz * 1.05, a: p.a, dx: p.dx, dy: p.dy, ph: p.ph,
          accent: p.accent, boost: 0
        };
        if (!firstBuild) {
          m.x = m.tx + (Math.random() - 0.5) * 80;
          m.y = m.ty + (Math.random() - 0.5) * 60;
          m.z = m.tz + (Math.random() - 0.5) * 30;
        }
        if (TEST) { m.x = m.tx; m.y = m.ty; m.z = m.tz; }
        return m;
      });
      firstBuild = false;
      if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
      var geo = new THREE.BoxGeometry(1, 1, 1);
      var mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      mesh = new THREE.InstancedMesh(geo, mat, meta.length);
      var col = new THREE.Color();
      for (var i = 0; i < meta.length; i++) {
        var m = meta[i];
        col.copy(m.accent ? TEAL : SLATE).multiplyScalar(m.a * 2.4);
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
          col2.copy(m.accent ? TEAL : SLATE).multiplyScalar(m.a * 2.4 * (1 + boost * 1.4));
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

  var fluidOk = initFluid();
  var orb = document.getElementById('tl-orb');
  if (fluidOk && orb) orb.style.display = 'none';
  initDotGrid();
  if (hasGL) loadThree(initLogo3D, initLogo2D);
  else initLogo2D();
})();
