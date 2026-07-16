// ---------------------------------------------------------------------------
// tracelayer orb — shared WebGL module.
//
// initOrb(config) builds the volumetric orb and starts its render loop. The
// `mode` selects which internal structure the raymarcher draws:
//   'fractal' — the original complex space-folding motion
//   'pulse'   — concentric energy shells radiating out from the core
//   'voice'   — a horizontal waveform that undulates like a speaking voice
// All modes share the same sphere, atmosphere halo, chromatic-aberration pass,
// starfield, framing and graceful WebGL fallback.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- Fragment shader assembled from a shared head, a per-mode structure
//     function, and a shared raymarch tail. ---
const FRAG_HEAD = `
    uniform float uTime;
    uniform vec3 uLocalCamPos;
    uniform vec3 uPrimaryColor;
    uniform vec3 uSecondaryColor;
    uniform float uDensity;
    uniform float uFractalIters;
    uniform float uFractalScale;
    uniform float uFractalDecay;
    uniform float uInternalAnim;
    uniform float uSmoothness;
    uniform float uAsymmetry;
    uniform vec3 uRimColor;
    uniform float uRimStrength;
    varying vec3 vLocalPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
`;

const STRUCT = {
    // Original: iterative space folding → organic, complex interior motion.
    fractal: `
    float evaluateStructure(vec3 pos) {
        float densityAcc = 0.0;
        vec3 anchor = pos;
        float animTime = uTime * uInternalAnim;
        float s = sin(animTime); float c = cos(animTime);
        mat2 rotAnim = mat2(c, s, -s, c);
        float a = 0.5 * uAsymmetry;
        mat2 rotAsym1 = mat2(cos(a), sin(a), -sin(a), cos(a));
        float b = 0.3 * uAsymmetry;
        mat2 rotAsym2 = mat2(cos(b), sin(b), -sin(b), cos(b));
        for (int step = 0; step < 12; ++step) {
            if (float(step) >= uFractalIters) break;
            pos.xy *= rotAnim; pos.yz *= rotAnim;
            pos.xz *= rotAsym1; pos.yz *= rotAsym2;
            pos += vec3(0.05, -0.02, 0.03) * uAsymmetry;
            vec3 foldedPos = sqrt(pos * pos + uSmoothness);
            float magnitudeSq = max(dot(foldedPos, foldedPos), 0.00001);
            pos = (uFractalScale * foldedPos / magnitudeSq) - uFractalScale;
            float ySq = pos.y * pos.y; float zSq = pos.z * pos.z;
            float yz2 = 2.0 * pos.y * pos.z;
            pos.yz = vec2(ySq - zSq, yz2);
            pos = vec3(pos.z, pos.x, pos.y);
            densityAcc += exp(uFractalDecay * abs(dot(pos, anchor)));
        }
        return densityAcc * 0.5;
    }`,

    // Concentric shells expanding outward from a bright, breathing core.
    pulse: `
    float evaluateStructure(vec3 pos) {
        float r = length(pos);
        float t = uTime;
        // Sharp, well-defined expanding rings (pow tightens the bright band).
        float shell = pow(0.5 + 0.5 * sin(r * 7.0 - t * 4.5), 2.5);
        float fine  = pow(0.5 + 0.5 * sin(r * 15.0 - t * 7.0), 3.0);
        float core = pow(smoothstep(2.0, 0.0, r), 1.3);
        float breathe = 0.8 + 0.2 * sin(t * 1.8);
        return core * (0.45 + 1.5 * shell + 0.5 * fine) * breathe;
    }`,

    // A horizontal waveform ribbon that wiggles and pulses like a voice, plus
    // concentric rings that radiate on the loud beats (sound leaving the orb).
    voice: `
    float evaluateStructure(vec3 pos) {
        float t = uTime;
        float x = pos.x;
        float r = length(pos);
        // Shared speech-like envelope: irregular peaks with quiet rests, so the
        // whole orb feels like it is speaking rather than looping a sine.
        float speech = 0.30 + 0.70 * abs(sin(t * 2.3) * sin(t * 0.9 + 1.0));
        // Waveform curve along x.
        float w = 0.0;
        w += 0.32 * sin(x * 3.0  + t * 5.0);
        w += 0.16 * sin(x * 6.3  - t * 7.7);
        w += 0.09 * sin(x * 11.0 + t * 10.5);
        w += 0.07 * sin(x * 19.0 - t * 13.0);   // spikier high-frequency detail
        float env = exp(-x * x * 0.55) * speech;
        w *= env;
        float dy = pos.y - w;
        float line = exp(-(dy * dy) / 0.014);    // thinner, sharper waveform
        float zfade = exp(-pos.z * pos.z * 0.6);
        float xin = exp(-x * x * 0.10);
        float core = smoothstep(2.0, 0.1, r);
        float ribbon = line * zfade * xin * core * 2.2;   // more energy
        // Radiating rings, brightened by the same envelope so they pulse on peaks.
        float rings = pow(0.5 + 0.5 * sin(r * 5.0 - t * 3.5), 4.0);
        float ringGlow = rings * smoothstep(2.0, 0.2, r) * (0.10 + 0.45 * speech) * 0.4;
        // Soft moving internal haze so the orb reads as a deep sphere (volume),
        // not a flat lit disc — sits behind the waveform at low amplitude.
        float haze = (0.5 + 0.5 * sin(pos.x * 2.0 + t * 0.5))
                   * (0.5 + 0.5 * sin(pos.y * 2.3 - t * 0.4))
                   * (0.5 + 0.5 * sin(pos.z * 1.8 + t * 0.3));
        haze *= smoothstep(2.0, 0.15, r) * 0.13;
        return ribbon + ringGlow + haze;
    }`,

    // Equalizer: vertical bars rising symmetrically from the centre line.
    bars: `
    float evaluateStructure(vec3 pos) {
        float t = uTime; float x = pos.x; float y = pos.y; float r = length(pos);
        float speech = 0.30 + 0.70 * abs(sin(t * 2.3) * sin(t * 0.9 + 1.0));
        float N = 17.0; float slot = 4.0 / N;
        float idx = floor((x + 2.0) / slot);
        float bcx = -2.0 + (idx + 0.5) * slot;
        float within = smoothstep(slot * 0.46, slot * 0.26, abs(x - bcx));
        float amp = 0.12 + 0.60 * abs(sin(idx * 1.7 + t * 5.0) * sin(idx * 0.7 - t * 2.7));
        amp *= exp(-bcx * bcx * 0.14) * (0.5 + 0.9 * speech);
        float col = smoothstep(amp, amp - 0.05, abs(y));
        float zfade = exp(-pos.z * pos.z * 0.6);
        float core = smoothstep(2.0, 0.1, r);
        float bars = within * col * zfade * core * 2.1;
        float haze = (0.5 + 0.5 * sin(x * 2.0 + t * 0.5)) * (0.5 + 0.5 * sin(y * 2.3 - t * 0.4)) * (0.5 + 0.5 * sin(pos.z * 1.8 + t * 0.3));
        haze *= smoothstep(2.0, 0.15, r) * 0.10;
        return bars + haze;
    }`,

    // Mirror: a symmetric filled waveform band that breathes like a voice.
    mirror: `
    float evaluateStructure(vec3 pos) {
        float t = uTime; float x = pos.x; float y = pos.y; float r = length(pos);
        float speech = 0.30 + 0.70 * abs(sin(t * 2.3) * sin(t * 0.9 + 1.0));
        float w = 0.0;
        w += 0.34 * sin(x * 3.0 + t * 5.0);
        w += 0.18 * sin(x * 6.3 - t * 7.7);
        w += 0.10 * sin(x * 11.0 + t * 10.5);
        float env = exp(-x * x * 0.5) * (0.35 + 0.65 * speech);
        w = abs(w) * env + 0.015;
        float band = smoothstep(w, w - 0.05, abs(y));
        float edge = exp(-(abs(y) - w) * (abs(y) - w) / 0.006); // bright rim on the band
        float xin = exp(-x * x * 0.10);
        float zfade = exp(-pos.z * pos.z * 0.6);
        float core = smoothstep(2.0, 0.1, r);
        float ribbon = (band * 1.4 + edge * 0.9) * xin * zfade * core;
        float haze = (0.5 + 0.5 * sin(x * 2.0 + t * 0.5)) * (0.5 + 0.5 * sin(y * 2.3 - t * 0.4)) * (0.5 + 0.5 * sin(pos.z * 1.8 + t * 0.3));
        haze *= smoothstep(2.0, 0.15, r) * 0.11;
        return ribbon + haze;
    }`,

    // Ribbon: three flowing offset waveform strands (Siri-like) — kept calm and
    // delicate (the preferred, gentler read; not a loud energised band).
    ribbon: `
    float evaluateStructure(vec3 pos) {
        float t = uTime; float x = pos.x; float y = pos.y; float r = length(pos);
        float speech = 0.30 + 0.70 * abs(sin(t * 2.3) * sin(t * 0.9 + 1.0));
        float env = exp(-x * x * 0.5) * (0.35 + 0.65 * speech);
        float w1 = 0.30 * sin(x * 3.0 + t * 5.0) * env;
        float w2 = 0.24 * sin(x * 4.4 - t * 6.6 + 1.0) * env;
        float w3 = 0.18 * sin(x * 6.1 + t * 8.2 + 2.2) * env;
        float th = 0.010;
        float l = exp(-(y - w1) * (y - w1) / th)
                + 0.8 * exp(-(y - w2) * (y - w2) / th)
                + 0.6 * exp(-(y - w3) * (y - w3) / th);
        float xin = exp(-x * x * 0.12);
        float zfade = exp(-pos.z * pos.z * 0.6);
        float core = smoothstep(2.0, 0.1, r);
        float haze = (0.5 + 0.5 * sin(x * 2.0 + t * 0.5)) * (0.5 + 0.5 * sin(y * 2.3 - t * 0.4)) * (0.5 + 0.5 * sin(pos.z * 1.8 + t * 0.3));
        haze *= smoothstep(2.0, 0.15, r) * 0.11;
        return l * xin * zfade * core * 1.7 + haze;
    }`
};

function fragTail(twist) {
    const twistCode = twist ? `
        float tw = uTime * 0.1;
        float sw = sin(tw); float cw = cos(tw);
        mat2 rotXZ = mat2(cw, sw, -sw, cw);
        rayOrig.xz *= rotXZ; rayDir.xz *= rotXZ;` : ``;
    return `
    vec2 getVolumeBounds(vec3 origin, vec3 dir, float radius) {
        float b = dot(origin, dir);
        float c = dot(origin, origin) - radius * radius;
        float discriminant = b * b - c;
        if (discriminant < 0.0) return vec2(-1.0);
        float root = sqrt(discriminant);
        return vec2(-b - root, -b + root);
    }
    vec3 traceEnergy(vec3 origin, vec3 dir, vec2 limits) {
        float currentDepth = limits.x;
        float marchStep = 0.02;
        vec3 finalEnergy = vec3(0.0);
        float fieldVal = 0.0;
        for (int i = 0; i < 64; i++) {
            currentDepth += marchStep * exp(-2.0 * fieldVal);
            if (currentDepth > limits.y) break;
            vec3 samplePoint = origin + currentDepth * dir;
            fieldVal = evaluateStructure(samplePoint);
            float vSq = fieldVal * fieldVal;
            float gradientBlend = smoothstep(0.0, 0.4, fieldVal);
            vec3 currentGradient = mix(uSecondaryColor, uPrimaryColor, gradientBlend);
            vec3 emission = currentGradient * (fieldVal * 1.8 + vSq * 1.0);
            finalEnergy = 0.99 * finalEnergy + (0.08 * uDensity) * emission;
        }
        return finalEnergy;
    }
    void main() {
        vec3 rayOrig = uLocalCamPos;
        vec3 rayDir = normalize(vLocalPosition - uLocalCamPos);
        ${twistCode}
        vec2 limits = getVolumeBounds(rayOrig, rayDir, 2.0);
        if (limits.x < 0.0) discard;
        vec3 volumeColor = traceEnergy(rayOrig, rayDir, limits);
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float facingRatio = max(dot(normal, viewDir), 0.0);
        float edgeAA = smoothstep(0.0, 0.05, facingRatio);
        vec3 finalColor = 0.5 * log(1.0 + volumeColor);
        finalColor = clamp(finalColor, 0.0, 1.0);
        // Fresnel rim light: a thin brighter arc near the silhouette that gives
        // the orb a defined surface instead of dissolving into a soft blob.
        float rim = pow(1.0 - facingRatio, 3.0) * edgeAA;
        finalColor += uRimColor * rim * uRimStrength;
        finalColor *= edgeAA;
        finalColor = clamp(finalColor, 0.0, 1.0);
        float maxLuma = max(finalColor.r, max(finalColor.g, finalColor.b));
        float alpha = clamp(maxLuma * 1.5, 0.0, 1.0) * edgeAA;
        gl_FragColor = vec4(finalColor, alpha);
    }`;
}

const VERTEX = `
    varying vec3 vLocalPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
        vLocalPosition = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export function initOrb(userConfig) {
    // Defaults — a muted teal→indigo look. Pages override what they need.
    const cfg = Object.assign({
        mode: 'fractal',
        primary: '#48bda2',       // core colour (dense regions)
        secondary: '#524dac',     // wisp colour (thin regions)
        speed: 0.5,
        density: 1.5,
        // Soft outer bloom, not a tight bright ring — keeps the edge feeling
        // like a glowing sphere rather than a hard-outlined circle.
        atmosphereGlow: 0.22,
        atmosphereLevel: 0.7,
        atmosphereScale: 1.06,
        orbRotation: 0.3,
        internalAnim: 0.38,
        chromaticAberration: 0.014,
        rimColor: '#6cead0',
        rimStrength: 0.0,             // no hard Fresnel rim — soft edges preferred
        twist: true,
        // fractal-only tuning
        fractalIters: 4, fractalScale: 0.97, fractalDecay: -16.7,
        smoothness: 0.031, asymmetry: 0.55
    }, userConfig || {});

    const loaderEl = document.getElementById('loader');

    // Graceful degradation: no WebGL → show the static CSS orb.
    function webglSupported() {
        try {
            const c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }
    if (!webglSupported()) {
        document.body.classList.add('no-webgl');
        if (loaderEl) loaderEl.classList.add('hidden');
        return;
    }

    // Respect reduced-motion preference.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cfg.speed *= 0.3;
        cfg.orbRotation *= 0.25;
        cfg.internalAnim *= 0.3;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.85;
    const canvas = document.getElementById('orb-canvas');
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 11.5);

    // Raise the orb into the upper portion of the screen (fraction of height)
    // with a camera view-offset, so the orbit target stays on the orb.
    const ORB_SHIFT = 0.09;
    function applyViewOffset() {
        camera.setViewOffset(window.innerWidth, window.innerHeight, 0, window.innerHeight * ORB_SHIFT, window.innerWidth, window.innerHeight);
    }
    applyViewOffset();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.update();

    const fragmentShader = FRAG_HEAD + (STRUCT[cfg.mode] || STRUCT.fractal) + fragTail(cfg.twist);

    const uniforms = {
        uTime: { value: 0 },
        uLocalCamPos: { value: new THREE.Vector3() },
        uPrimaryColor: { value: new THREE.Color(cfg.primary) },
        uSecondaryColor: { value: new THREE.Color(cfg.secondary) },
        uDensity: { value: cfg.density },
        uFractalIters: { value: cfg.fractalIters },
        uFractalScale: { value: cfg.fractalScale },
        uFractalDecay: { value: cfg.fractalDecay },
        uInternalAnim: { value: cfg.internalAnim },
        uSmoothness: { value: cfg.smoothness },
        uAsymmetry: { value: cfg.asymmetry },
        uRimColor: { value: new THREE.Color(cfg.rimColor) },
        uRimStrength: { value: cfg.rimStrength }
    };

    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader, uniforms,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // Atmosphere halo — soft ring around the silhouette, tinted by the core colour.
    const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal; varying vec3 vViewPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }`,
        fragmentShader: `
            uniform vec3 uColor; uniform float uGlow; uniform float uLevel;
            varying vec3 vNormal; varying vec3 vViewPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float vdn = max(dot(normal, viewDir), 0.0);
                float edgeFade = smoothstep(0.0, 0.15, vdn);
                float innerFadePoint = clamp(1.0 - uLevel, 0.0, 0.99);
                float centerFade = smoothstep(1.0, innerFadePoint, vdn);
                gl_FragColor = vec4(uColor, edgeFade * centerFade * uGlow);
            }`,
        uniforms: {
            uColor: { value: new THREE.Color(cfg.primary) },
            uGlow: { value: cfg.atmosphereGlow },
            uLevel: { value: cfg.atmosphereLevel }
        },
        transparent: true, side: THREE.FrontSide, depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const geometry = new THREE.SphereGeometry(2.0, 128, 128);
    const orb = new THREE.Mesh(geometry, material);
    scene.add(orb);
    const atmosphereMesh = new THREE.Mesh(geometry, atmosphereMaterial);
    atmosphereMesh.scale.setScalar(cfg.atmosphereScale);
    orb.add(atmosphereMesh);

    // Chromatic-aberration finish.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(dpr);
    composer.addPass(new RenderPass(scene, camera));
    const caPass = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uAmount: { value: cfg.chromaticAberration } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
            void main() {
                vec4 baseColor = texture2D(tDiffuse, vUv);
                float luma = max(baseColor.r, max(baseColor.g, baseColor.b));
                float mask = smoothstep(0.01, 0.1, luma);
                vec2 offset = (vUv - 0.5) * uAmount;
                float r = texture2D(tDiffuse, vUv + offset).r;
                float g = texture2D(tDiffuse, vUv).g;
                float b = texture2D(tDiffuse, vUv - offset).b;
                gl_FragColor = vec4(mix(baseColor.rgb, vec3(r, g, b), mask), baseColor.a);
            }`
    });
    composer.addPass(caPass);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        applyViewOffset();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    // Lightweight 2D starfield.
    const starCanvas = document.getElementById('stars');
    const sctx = starCanvas.getContext('2d');
    let starList = [];
    function buildStars() {
        starCanvas.width = window.innerWidth;
        starCanvas.height = window.innerHeight;
        const count = Math.floor((window.innerWidth * window.innerHeight) / 5200);
        starList = Array.from({ length: count }, () => ({
            x: Math.random() * starCanvas.width, y: Math.random() * starCanvas.height,
            r: Math.random() * 1.1 + 0.2, a: Math.random() * 0.5 + 0.15,
            tw: Math.random() * 0.02 + 0.004
        }));
    }
    function drawStars(time) {
        sctx.clearRect(0, 0, starCanvas.width, starCanvas.height);
        for (const st of starList) {
            const flicker = st.a + Math.sin(time * st.tw + st.x) * 0.15;
            sctx.beginPath();
            sctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
            sctx.fillStyle = `rgba(200, 240, 235, ${Math.max(0, flicker)})`;
            sctx.fill();
        }
    }
    buildStars();
    window.addEventListener('resize', buildStars);

    const clock = new THREE.Clock();
    const localCam = new THREE.Vector3();
    let started = false;

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        uniforms.uTime.value += delta * cfg.speed;

        orb.rotation.y += delta * cfg.orbRotation;
        orb.rotation.x += delta * (cfg.orbRotation * 0.5);
        orb.updateMatrixWorld();

        localCam.copy(camera.position);
        orb.worldToLocal(localCam);
        uniforms.uLocalCamPos.value.copy(localCam);

        controls.update();
        drawStars(clock.elapsedTime * 1000);
        composer.render();

        if (!started) {
            started = true;
            if (loaderEl) loaderEl.classList.add('hidden');
        }
    }
    animate();
}
