import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FLOOR_Y } from '../model/layout.js';
import { ease } from '../util/anim.js';

const HORIZON = new THREE.Color(0x222932);

/** Studio lighting captured into an environment map: softboxes on black. */
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.014, 0.018), side: THREE.BackSide }),
  );
  env.add(room);
  const panel = (w, h, pos, color, power) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(9, 6, [0, 9, 1.5], 0xf4f8ff, 5.5); // overhead softbox
  panel(5, 5, [7, 4, 7], 0xfff1dc, 3.2); // warm key
  panel(1.1, 9, [-9, 1, 2.5], 0xbfe9ff, 9); // cool strip, left
  panel(1.1, 8, [9, 0.5, -3.5], 0xffd9a8, 7); // warm strip, right
  panel(7, 1.4, [0, 4.5, -9], 0xd8ecff, 6); // back rim
  panel(3, 3, [-5, 3, 8], 0xdfe8ff, 1.6); // soft fill
  panel(14, 14, [0, -9, 0], 0x1c2028, 1); // floor bounce
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(11) }),
    );
    dot.position.set(Math.cos(a) * 10, 5.5 + Math.sin(i * 2.1) * 2, Math.sin(a) * 10);
    env.add(dot);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.012).texture;
  pmrem.dispose();
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 512, 512);
  // soft contact shadow where the collar meets the floor
  const grad = g.createRadialGradient(256, 256, 4, 256, 256, 120);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Optical eyes are seen through glass: preserve the iris at render resolution.
  renderer.transmissionResolutionScale = 1;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 1.0;
  scene.fog = new THREE.Fog(HORIZON, 13, 30);

  // Backdrop: horizon colour at eye level fading to near black overhead.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { horizon: { value: HORIZON }, top: { value: new THREE.Color(0x020304) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 horizon; uniform vec3 top; varying vec3 vDir;' +
        'void main(){ float t = smoothstep(-0.05, 0.55, vDir.y); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.16, map: floorTexture() }),
  );
  floor.material.map.repeat.set(10, 10);
  floor.material.map.offset.set(-4.5, -4.5);
  floor.material.map.wrapS = floor.material.map.wrapT = THREE.ClampToEdgeWrapping;
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  // Direct lights for crisp speculars and a grounded shadow.
  const key = new THREE.SpotLight(0xfff4e6, 58, 30, 0.42, 0.7, 2);
  key.position.set(2.8, 5.2, 5.4);
  key.target.position.set(0, -0.6, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 16;
  scene.add(key, key.target);

  const rimL = new THREE.DirectionalLight(0x9fdcff, 1.7);
  rimL.position.set(-5, 2.2, -4);
  const rimR = new THREE.DirectionalLight(0xffc98a, 1.2);
  rimR.position.set(5, 1.0, -3.5);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  fill.position.set(-3, 1, 6);
  scene.add(rimL, rimR, fill);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 120);
  const HOME = { pos: new THREE.Vector3(1.3, 0.0, 8.5), target: new THREE.Vector3(0, -0.54, 0) };
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.minDistance = 3.4;
  controls.maxDistance = 11.5;
  controls.minPolarAngle = 0.85;
  controls.maxPolarAngle = 1.82;
  controls.update();

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const BLOOM_BASE = 0.2;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_BASE, 0.55, 1.5);
  composer.addPass(bloom);
  // "Punch": screen-space impact effects for the big moments. A zoom blur and
  // colour fringing around a focus point, a ripple that travels outwards, and
  // a dimming of everything away from the focus. Skipped entirely when idle.
  const punch = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 },
      uZoom: { value: 0 }, uChroma: { value: 0 }, uDim: { value: 0 }, uWave: { value: 0 }, uWaveAmp: { value: 0 },
      uFlash: { value: new THREE.Vector3() },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uAspect;
      uniform float uZoom, uChroma, uDim, uWave, uWaveAmp; uniform vec3 uFlash;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - uCenter;
        float dist = length(dir * vec2(uAspect, 1.0));
        // ripple: pixels on the travelling ring are pushed outwards
        float band = dist - uWave;
        float ripple = exp(-band * band * 520.0) * uWaveAmp;
        vec2 uv = vUv - normalize(dir + 1e-5) * ripple * 0.03;
        vec2 d2 = uv - uCenter;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          vec2 o = d2 * (uZoom * 0.14 * t);
          vec2 f = d2 * (uChroma * 0.022) * (0.4 + t);
          col.r += texture2D(tDiffuse, uv - o - f).r;
          col.g += texture2D(tDiffuse, uv - o).g;
          col.b += texture2D(tDiffuse, uv - o + f).b;
        }
        col /= 8.0;
        col *= 1.0 - uDim * smoothstep(0.16, 0.85, dist);
        col += vec3(1.0, 0.86, 0.6) * ripple * 0.22;
        col += uFlash;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  punch.enabled = false;
  composer.addPass(punch);
  composer.addPass(new OutputPass());
  const fxState = { zoom: 0, chroma: 0, dim: 0, dimTarget: 0, wave: 2, waveAmp: 0, flash: 0, flashColor: new THREE.Vector3(1, 1, 1), bloom: BLOOM_BASE, bloomTarget: BLOOM_BASE };
  const ndc = new THREE.Vector3();
  const focus = (worldPos) => {
    ndc.copy(worldPos).project(camera);
    punch.uniforms.uCenter.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the whole head in frame on tall screens
    camera.fov = w / h < 1 ? 28 + (1 - w / h) * 22 : 28;
    camera.updateProjectionMatrix();
    punch.uniforms.uAspect.value = w / h;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- camera shake + scripted moves
  const shakeOffset = new THREE.Vector3();
  let shakeAmp = 0;
  let fly = null;

  const stage = {
    renderer, scene, camera, controls, composer, bloom, key, floor, HOME,
    busyCamera: false,

    shake(amount) { shakeAmp = Math.max(shakeAmp, amount); },

    /** Glide the camera to a new position/target; resolves when it arrives. */
    flyTo(pos, tgt, dur = 0.9, easing = ease.inOutCubic) {
      return new Promise((resolve) => {
        fly = {
          t: 0, dur, easing, resolve,
          p0: camera.position.clone(), t0: controls.target.clone(),
          p1: pos.clone(), t1: tgt.clone(),
        };
        controls.enabled = false;
      });
    },
    releaseCamera() { controls.enabled = true; },

    /** A jolt of zoom blur and colour fringing centred on a world position. */
    impact(worldPos, { zoom = 0.6, chroma = 0.8 } = {}) {
      focus(worldPos);
      fxState.zoom = Math.max(fxState.zoom, zoom);
      fxState.chroma = Math.max(fxState.chroma, chroma);
    },
    /** A ripple spreading across the screen from a world position. */
    shockwave(worldPos, amp = 1) {
      focus(worldPos);
      fxState.wave = 0;
      fxState.waveAmp = amp;
    },
    /** Darken everything away from a world position (0 turns it off). */
    spotlight(worldPos, amount) {
      if (worldPos) focus(worldPos);
      fxState.dimTarget = amount;
    },
    /** Brief full-screen wash of light. */
    flash(amount = 0.5, color = [1, 0.92, 0.75]) {
      fxState.flash = Math.max(fxState.flash, amount);
      fxState.flashColor.set(color[0], color[1], color[2]);
    },
    /** Extra bloom while something glorious is on screen (0 = normal). */
    glow(extra) { fxState.bloomTarget = BLOOM_BASE + extra; },
    /** Drop every screen effect at once. */
    calm() {
      fxState.dimTarget = 0; fxState.bloomTarget = BLOOM_BASE; fxState.zoom = 0; fxState.chroma = 0; fxState.waveAmp = 0; fxState.flash = 0;
    },

    update(dt) {
      if (fly) {
        fly.t += dt;
        const k = fly.easing(Math.min(fly.t / fly.dur, 1));
        camera.position.lerpVectors(fly.p0, fly.p1, k);
        controls.target.lerpVectors(fly.t0, fly.t1, k);
        camera.lookAt(controls.target);
        if (fly.t >= fly.dur) { const r = fly.resolve; fly = null; r(); }
      } else if (controls.enabled) {
        controls.update();
      }
      shakeAmp *= Math.exp(-dt * 9);
      if (shakeAmp < 0.0004) shakeAmp = 0;

      // screen effects decay on their own
      const s = fxState, u = punch.uniforms;
      s.zoom *= Math.exp(-dt * 7);
      s.chroma *= Math.exp(-dt * 5);
      s.flash *= Math.exp(-dt * 6);
      s.dim += (s.dimTarget - s.dim) * (1 - Math.exp(-dt * 6));
      s.wave += dt * 1.5;
      s.waveAmp *= Math.exp(-dt * 2.2);
      s.bloom += (s.bloomTarget - s.bloom) * (1 - Math.exp(-dt * 5));
      bloom.strength = s.bloom;
      const active = s.zoom > 0.004 || s.chroma > 0.004 || s.dim > 0.004 || s.flash > 0.004 || (s.waveAmp > 0.01 && s.wave < 1.8);
      punch.enabled = active;
      if (active) {
        u.uZoom.value = s.zoom; u.uChroma.value = s.chroma; u.uDim.value = s.dim;
        u.uWave.value = s.wave; u.uWaveAmp.value = s.wave < 1.8 ? s.waveAmp : 0;
        u.uFlash.value.copy(s.flashColor).multiplyScalar(s.flash);
      }
    },

    render() {
      if (shakeAmp > 0) {
        shakeOffset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shakeAmp * 2);
        camera.position.add(shakeOffset);
      }
      composer.render();
      if (shakeAmp > 0) camera.position.sub(shakeOffset);
    },
  };
  return stage;
}
