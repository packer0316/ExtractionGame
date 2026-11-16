import * as THREE from 'three';
import { FLOOR_Y } from '../model/layout.js';

// Showpiece effects for a tooth that is fighting back, and for the win that
// follows: a glowing skin over the tooth, a sunburst behind the prize,
// twinkling stars, confetti, lightning and a ground shock ring.
// Everything here is additive and above 1.0 so the bloom pass picks it up.

// ---------------------------------------------------------------- aura
/**
 * A second skin drawn just outside a tooth, driven step by step while the
 * tooth is being pulled:
 *   heat   the root glows like hot metal
 *   award  bands of light sweep over the tooth, with a glowing rim
 *   prism  those bands turn from gold into a rainbow
 *   glint  pin-point sparkles scatter over the surface, like cut crystal
 *   pulse  a flash over the whole tooth (set to 1; it fades by itself)
 */
export function createAura(geometry) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uHeat: { value: 0 }, uAward: { value: 0 }, uPrism: { value: 0 },
      uGlint: { value: 0 }, uPulse: { value: 0 },
      uInflate: { value: 0.0035 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uInflate;
      varying vec3 vN; varying vec3 vView; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
        vN = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHeat, uAward, uPrism, uGlint, uPulse;
      varying vec3 vN; varying vec3 vView; varying vec3 vP;
      void main() {
        float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 2.0);
        // heat creeps up the root from its tip
        float rootMask = smoothstep(0.03, -0.04, vP.y);
        float flick = 0.72 + 0.28 * sin(uTime * 27.0 + vP.y * 80.0 + vP.x * 31.0);
        vec3 hot = mix(vec3(1.7, 0.3, 0.03), vec3(2.3, 1.6, 0.9), uHeat * uHeat);
        vec3 heat = hot * uHeat * rootMask * (0.3 + 1.1 * fres) * flick;
        // faint glow on the crown too, so the whole tooth feels charged
        heat += hot * uHeat * uHeat * (1.0 - rootMask) * fres * 0.35;
        // award: bands of light sweep up the tooth
        float band = pow(0.5 + 0.5 * sin(vP.y * 44.0 - uTime * 7.0 + vP.x * 16.0 + vP.z * 9.0), 10.0);
        vec3 gold = vec3(1.9, 1.25, 0.36);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vP.y * 3.2 + uTime * 0.7 + vec3(0.0, 0.33, 0.67)));
        vec3 tint = mix(gold, rainbow * 1.9, uPrism);
        // the whole tooth breathes faster the more it is charged
        float breathe = 0.82 + 0.18 * sin(uTime * (5.0 + 9.0 * uGlint));
        vec3 award = tint * uAward * (fres * 1.25 + band * 1.1) * breathe;
        // glints: tiny facets that catch the light for an instant
        float cell = fract(sin(dot(floor(vP * 110.0), vec3(12.9898, 78.233, 37.719)) + floor(uTime * 10.0) * 1.37) * 43758.5453);
        award += mix(vec3(2.4, 2.1, 1.5), rainbow * 2.6, uPrism) * step(0.988, cell) * uGlint;
        // level-up flash
        award += vec3(1.5, 1.3, 0.95) * uPulse * (0.3 + 0.9 * fres);
        gl_FragColor = vec4(heat + award, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.renderOrder = 15;
  mesh.frustumCulled = false;
  return { mesh, uniforms: mat.uniforms, dispose: () => { mesh.removeFromParent(); mat.dispose(); } };
}

// ---------------------------------------------------------------- beam
/**
 * A cone of light pouring out of the socket along the tooth. It stands on the
 * local origin and points up +Y; scale.y sets how far it reaches.
 */
export function createBeam() {
  const geo = new THREE.CylinderGeometry(0.2, 0.03, 1, 28, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uPrism: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uPower, uPrism; varying vec2 vUv;
      void main() {
        float a = vUv.x * 6.2831;
        float streak = 0.5 + 0.5 * sin(a * 9.0 + uTime * 3.0) * sin(a * 4.0 - uTime * 5.2);
        float fall = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.08, vUv.y);
        vec3 gold = vec3(1.5, 1.0, 0.3);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vUv.x * 2.0 + uTime * 0.3 + vec3(0.0, 0.33, 0.67)));
        vec3 col = mix(gold, rainbow * 1.5, uPrism);
        gl_FragColor = vec4(col * (0.35 + 0.65 * streak) * fall * uPower, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 14;
  mesh.frustumCulled = false;
  return { mesh, uniforms: mat.uniforms, dispose: () => { mesh.removeFromParent(); geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------- sunburst
function sunburstMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uPrism: { value: 0 }, uColor: { value: new THREE.Color(1.15, 0.78, 0.26) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uPower, uPrism; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p), a = atan(p.y, p.x);
        float rays = (0.5 + 0.5 * sin(a * 14.0 + uTime * 1.4)) * (0.55 + 0.45 * sin(a * 9.0 - uTime * 1.0 + 1.7));
        rays = pow(max(rays, 0.0), 1.6);
        float thin = pow(0.5 + 0.5 * sin(a * 31.0 - uTime * 2.1), 14.0);
        float fall = smoothstep(1.0, 0.12, r);
        float core = exp(-r * r * 10.0);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (a / 6.2831 * 2.0 + uTime * 0.25 + vec3(0.0, 0.33, 0.67)));
        vec3 col = mix(uColor, rainbow * 0.95, uPrism * 0.75);
        float v = (rays * fall * 0.52 + thin * fall * fall * 0.3 + core * 0.26) * uPower;
        gl_FragColor = vec4(col * v, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- stars
function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.translate(48, 48);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-48, -48, 96, 96);
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -46); g.quadraticCurveTo(3, -4, 6, 0); g.lineTo(-6, 0); g.quadraticCurveTo(-3, -4, 0, -46);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

export function createAwardFx(scene, camera) {
  // ---- sunburst: two counter-rotating layers on one pivot
  const burst = new THREE.Group();
  const layers = [1, 0.62].map((s, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sunburstMaterial());
    m.scale.setScalar(s);
    m.renderOrder = 13 + i;
    burst.add(m);
    return m;
  });
  burst.visible = false;
  scene.add(burst);
  const burstState = { power: 0, target: 0, size: 3, prism: 0, anchor: null, back: 0.5 };

  // ---- stars
  const starTex = starTexture();
  const stars = Array.from({ length: 70 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: starTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    sp.visible = false;
    sp.renderOrder = 18;
    scene.add(sp);
    return { sp, life: 0, max: 1, size: 0.1, vel: new THREE.Vector3(), phase: 0 };
  });
  let starNext = 0;

  // ---- confetti
  const CONF = 260;
  const confGeo = new THREE.PlaneGeometry(0.07, 0.035);
  const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const confetti = new THREE.InstancedMesh(confGeo, confMat, CONF);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false;
  const confP = Array.from({ length: CONF }, () => ({
    life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), spin: new THREE.Vector3(), sway: 0,
  }));
  const palette = [[2.4, 1.6, 0.4], [0.4, 1.8, 2.4], [2.4, 0.5, 1.4], [2.2, 2.2, 2.2], [1.0, 2.2, 0.8]].map((c) => new THREE.Color(...c));
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONF; i++) { confetti.setMatrixAt(i, zero); confetti.setColorAt(i, palette[i % palette.length]); }
  scene.add(confetti);
  let confNext = 0;

  // ---- lightning: jagged bolts re-drawn many times a second
  const BOLTS = 7, SEG = 9;
  const arcPos = new Float32Array(BOLTS * SEG * 6);
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
  const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 2.6, 3.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.visible = false;
  arcs.renderOrder = 17;
  scene.add(arcs);
  const arcState = { power: 0, origin: new THREE.Vector3(), reach: 0.4, timer: 0, gold: false };

  // ---- ground shock ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 72),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = FLOOR_Y + 0.012;
  ring.visible = false;
  scene.add(ring);
  const ringState = { t: 1, dur: 0.9, size: 5 };

  const m4 = new THREE.Matrix4(), s3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), ax = new THREE.Vector3();
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  let clock = 0;

  const fx = {
    /** Sunburst behind `anchor` (an Object3D it keeps following). */
    burstOn(anchor, { size = 3, prism = 0, power = 1, back = 0.5, overlay = false } = {}) {
      Object.assign(burstState, { anchor, size, prism, back, target: power });
      // overlay: drawn over everything, for a glow on something still set in the jaw
      for (const m of layers) m.material.depthTest = !overlay;
      burst.visible = true;
    },
    burstOff() { burstState.target = 0; },

    sparkle(pos, { count = 12, radius = 0.5, size = [0.06, 0.2], life = 0.9, color = [2, 1.6, 0.8], drift = 0.2 } = {}) {
      for (let i = 0; i < count; i++) {
        const s = stars[starNext];
        starNext = (starNext + 1) % stars.length;
        s.sp.position.set(pos.x + (Math.random() - 0.5) * 2 * radius, pos.y + (Math.random() - 0.5) * 2 * radius, pos.z + (Math.random() - 0.5) * radius);
        s.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(drift);
        s.max = s.life = life * (0.5 + Math.random());
        s.size = size[0] + Math.random() * (size[1] - size[0]);
        s.phase = Math.random() * 6.28;
        s.sp.material.color.setRGB(color[0], color[1], color[2]);
        s.sp.material.rotation = Math.random() * 0.6;
        s.sp.visible = true;
      }
    },

    confetti(pos, count = 80, spread = 2.2) {
      for (let i = 0; i < count; i++) {
        const p = confP[confNext];
        confNext = (confNext + 1) % CONF;
        p.pos.copy(pos);
        p.vel.set((Math.random() - 0.5) * spread, 1.2 + Math.random() * 2.6, (Math.random() - 0.5) * spread);
        p.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
        p.sway = Math.random() * 6.28;
        p.life = 3.2 + Math.random() * 1.6;
      }
    },

    /** Lightning around a point; power 0 switches it off. */
    arcs(origin, power, { reach = 0.4, gold = false } = {}) {
      arcState.power = power;
      if (origin) arcState.origin.copy(origin);
      arcState.reach = reach; arcState.gold = gold;
      arcs.visible = power > 0;
    },

    shockRing(pos, size = 5) {
      ring.position.x = pos.x; ring.position.z = pos.z;
      ringState.t = 0; ringState.size = size;
      ring.visible = true;
    },

    update(dt) {
      clock += dt;
      // sunburst follows its anchor, sitting just behind it from the camera
      burstState.power += (burstState.target - burstState.power) * (1 - Math.exp(-dt * (burstState.target > burstState.power ? 9 : 5)));
      if (burstState.power < 0.004 && burstState.target === 0) burst.visible = false;
      if (burst.visible && burstState.anchor) {
        burstState.anchor.getWorldPosition(tmp);
        dir.subVectors(tmp, camera.position).normalize();
        burst.position.copy(tmp).addScaledVector(dir, burstState.back);
        burst.quaternion.copy(camera.quaternion);
        const s = burstState.size * (0.55 + 0.45 * Math.min(burstState.power * 1.4, 1));
        burst.scale.setScalar(s);
        layers.forEach((m, i) => {
          m.rotation.z = clock * (i ? -0.35 : 0.22);
          const u = m.material.uniforms;
          u.uTime.value = clock * (i ? 1.3 : 1);
          u.uPower.value = burstState.power * (i ? 0.8 : 1);
          u.uPrism.value = burstState.prism;
        });
      }

      for (const s of stars) {
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) { s.sp.visible = false; continue; }
        const k = s.life / s.max;
        s.sp.position.addScaledVector(s.vel, dt);
        const tw = 0.55 + 0.45 * Math.sin(clock * 16 + s.phase);
        const sc = s.size * Math.sin(Math.PI * Math.min(1, (1 - k) * 3 + 0.05) * 0.5) * (0.5 + 0.5 * k) * (0.7 + 0.6 * tw);
        s.sp.scale.set(sc, sc, 1);
        s.sp.material.opacity = Math.min(1, k * 2.5) * tw;
      }

      let dirty = false;
      for (let i = 0; i < CONF; i++) {
        const p = confP[i];
        if (p.life <= 0) continue;
        dirty = true;
        p.life -= dt;
        p.vel.y -= 4.2 * dt;
        p.vel.multiplyScalar(1 - 1.6 * dt);
        p.sway += dt * 5;
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x += Math.sin(p.sway) * 0.35 * dt;
        if (p.pos.y < FLOOR_Y + 0.01) { p.pos.y = FLOOR_Y + 0.01; p.vel.set(0, 0, 0); p.spin.multiplyScalar(0.8); }
        const w = p.spin.length();
        if (w > 0.01) { q4.setFromAxisAngle(ax.copy(p.spin).multiplyScalar(1 / w), w * dt); p.q.premultiply(q4); }
        s3.setScalar(p.life <= 0 ? 0 : Math.min(1, p.life / 0.5));
        confetti.setMatrixAt(i, m4.compose(p.pos, p.q, s3));
      }
      if (dirty) confetti.instanceMatrix.needsUpdate = true;

      if (arcs.visible) {
        arcState.timer -= dt;
        if (arcState.timer <= 0) {
          arcState.timer = 0.035;
          const n = Math.min(BOLTS, Math.ceil(arcState.power * BOLTS));
          let o = 0;
          for (let b = 0; b < BOLTS; b++) {
            const live = b < n && Math.random() < 0.8;
            // random direction, kept roughly in the plane facing the camera
            dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const len = arcState.reach * (0.4 + Math.random() * 0.9) * (0.5 + arcState.power);
            let px = arcState.origin.x, py = arcState.origin.y, pz = arcState.origin.z;
            for (let s = 0; s < SEG; s++) {
              const j = live ? len * 0.16 : 0;
              const nx = live ? arcState.origin.x + dir.x * len * ((s + 1) / SEG) + (Math.random() - 0.5) * j : px;
              const ny = live ? arcState.origin.y + dir.y * len * ((s + 1) / SEG) + (Math.random() - 0.5) * j : py;
              const nz = live ? arcState.origin.z + dir.z * len * ((s + 1) / SEG) + (Math.random() - 0.5) * j : pz;
              arcPos[o++] = px; arcPos[o++] = py; arcPos[o++] = pz;
              arcPos[o++] = nx; arcPos[o++] = ny; arcPos[o++] = nz;
              px = nx; py = ny; pz = nz;
            }
          }
          arcGeo.attributes.position.needsUpdate = true;
          const f = 0.6 + Math.random() * 0.8;
          if (arcState.gold) arcMat.color.setRGB(3.4 * f, 2.3 * f, 0.7 * f); else arcMat.color.setRGB(1.5 * f, 2.6 * f, 3.4 * f);
        }
      }

      if (ring.visible) {
        ringState.t += dt / ringState.dur;
        const k = Math.min(ringState.t, 1);
        const e = 1 - Math.pow(1 - k, 3);
        ring.scale.setScalar(0.2 + ringState.size * e);
        ring.material.opacity = (1 - k) * 0.9;
        if (k >= 1) ring.visible = false;
      }
    },

    /** Switch everything off at once (new head, or an aborted play). */
    clear() {
      burstState.target = 0; burstState.power = 0; burst.visible = false;
      arcState.power = 0; arcs.visible = false;
      for (const p of confP) p.life = Math.min(p.life, 0.3);
    },
  };
  return fx;
}
