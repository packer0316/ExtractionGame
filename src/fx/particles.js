import * as THREE from 'three';
import { FLOOR_Y } from '../model/layout.js';

const GRAVITY = 15;

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Bright streaks thrown off by metal-on-glass and torn wiring. */
class Sparks {
  constructor(scene, max = 420) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }));
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  emit(origin, { count = 20, speed = 3, spread = 1, dir = null, color = [3, 1.6, 0.5], life = 0.5 }) {
    for (let i = 0; i < count; i++) {
      const s = this.p[this.next];
      this.next = (this.next + 1) % this.max;
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (dir) { dx = dir.x + dx * spread; dy = dir.y + dy * spread; dz = dir.z + dz * spread; }
      const v = speed * (0.35 + Math.random() * 0.9);
      s.x = origin.x; s.y = origin.y; s.z = origin.z;
      s.vx = dx * v; s.vy = dy * v; s.vz = dz * v;
      s.max = s.life = life * (0.5 + Math.random());
      s.r = color[0]; s.g = color[1]; s.b = color[2];
    }
  }

  update(dt) {
    const { pos, col } = this;
    for (let i = 0; i < this.max; i++) {
      const s = this.p[i];
      const o = i * 6;
      if (s.life <= 0) {
        col[o] = col[o + 1] = col[o + 2] = col[o + 3] = col[o + 4] = col[o + 5] = 0;
        continue;
      }
      s.life -= dt;
      s.vy -= GRAVITY * 0.55 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < FLOOR_Y + 0.005) { s.y = FLOOR_Y + 0.005; s.vy *= -0.35; s.vx *= 0.6; s.vz *= 0.6; }
      const k = Math.max(s.life / s.max, 0);
      const tail = 0.035;
      pos[o] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
      pos[o + 3] = s.x - s.vx * tail; pos[o + 4] = s.y - s.vy * tail; pos[o + 5] = s.z - s.vz * tail;
      col[o] = s.r * k; col[o + 1] = s.g * k; col[o + 2] = s.b * k;
      col[o + 3] = s.r * k * 0.15; col[o + 4] = s.g * k * 0.15; col[o + 5] = s.b * k * 0.15;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/** Instanced little solids: glass crumbs, gold coins. */
class Burst {
  constructor(scene, geometry, material, max, { bounce = 0.4, radius = 0.012 } = {}) {
    this.max = max; this.bounce = bounce; this.radius = radius;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.p = Array.from({ length: max }, () => ({
      life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(),
      spin: new THREE.Vector3(), scale: 1, rest: false,
    }));
    this.next = 0;
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._a = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }

  emit(origin, { count = 20, speed = 2.5, dir = null, spread = 1, scale = [0.6, 1.4], life = 3, up = 0 }) {
    for (let i = 0; i < count; i++) {
      const s = this.p[this.next];
      this.next = (this.next + 1) % this.max;
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (dir) { dx = dir.x + dx * spread; dy = dir.y + dy * spread; dz = dir.z + dz * spread; }
      const v = speed * (0.3 + Math.random());
      s.pos.copy(origin);
      s.vel.set(dx * v, dy * v + up, dz * v);
      s.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      s.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(26);
      s.scale = scale[0] + Math.random() * (scale[1] - scale[0]);
      s.max = s.life = life * (0.7 + Math.random() * 0.6);
      s.rest = false;
    }
  }

  update(dt) {
    const { _m, _s, _q, _a } = this;
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const s = this.p[i];
      if (s.life <= 0) continue;
      dirty = true;
      s.life -= dt;
      if (!s.rest) {
        s.vel.y -= GRAVITY * dt;
        s.pos.addScaledVector(s.vel, dt);
        const w = s.spin.length();
        if (w > 0.01) { _q.setFromAxisAngle(_a.copy(s.spin).multiplyScalar(1 / w), w * dt); s.q.premultiply(_q); }
        if (s.pos.y < FLOOR_Y + this.radius * s.scale) {
          s.pos.y = FLOOR_Y + this.radius * s.scale;
          if (s.vel.y < -0.8) { s.vel.y *= -this.bounce; s.vel.x *= 0.6; s.vel.z *= 0.6; s.spin.multiplyScalar(0.5); }
          else { s.rest = true; }
        }
      }
      const k = s.life <= 0 ? 0 : Math.min(s.life / 0.35, 1);
      _s.setScalar(s.scale * k);
      _m.compose(s.pos, s.q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const s of this.p) if (s.life > 0) s.life = Math.min(s.life, 0.3);
  }
}

/** Soft puffs: glass dust, a wisp of smoke from a dead eye, flashes. */
class Puffs {
  constructor(scene, max = 90) {
    this.max = max;
    const tex = softDot();
    this.items = [];
    for (let i = 0; i < max; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 19;
      scene.add(sp);
      this.items.push({ sp, life: 0, max: 1, vel: new THREE.Vector3(), s0: 0.1, s1: 0.4, a: 0.5 });
    }
    this.next = 0;
  }

  emit(origin, { count = 6, color = 0xcfd8e0, size = [0.08, 0.5], speed = 0.5, life = 0.9, alpha = 0.35, dir = null, additive = false, jitter = 0.05 }) {
    for (let i = 0; i < count; i++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.max;
      it.sp.position.set(
        origin.x + (Math.random() - 0.5) * jitter, origin.y + (Math.random() - 0.5) * jitter, origin.z + (Math.random() - 0.5) * jitter,
      );
      it.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(speed);
      if (dir) it.vel.addScaledVector(dir, speed);
      it.max = it.life = life * (0.6 + Math.random() * 0.8);
      it.s0 = size[0]; it.s1 = size[1] * (0.7 + Math.random() * 0.6);
      it.a = alpha;
      if (Array.isArray(color)) it.sp.material.color.setRGB(color[0], color[1], color[2]);
      else it.sp.material.color.set(color);
      it.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      it.sp.material.depthTest = !additive; // flashes glow over whatever is in front
      it.sp.material.rotation = Math.random() * 6.28;
      it.sp.visible = true;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.sp.visible = false; continue; }
      const k = 1 - it.life / it.max;
      it.sp.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(1 - 1.8 * dt);
      const s = it.s0 + (it.s1 - it.s0) * (1 - Math.pow(1 - k, 2));
      it.sp.scale.set(s, s, 1);
      it.sp.material.opacity = it.a * (1 - k) * Math.min(k * 12, 1);
    }
  }
}

export function createParticles(scene) {
  const crumbMat = new THREE.MeshStandardMaterial({
    color: 0xdff6ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.62, envMapIntensity: 2.4,
  });
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xf0bf55, roughness: 0.22, metalness: 1, envMapIntensity: 1.6 });
  const fx = {
    sparks: new Sparks(scene),
    crumbs: new Burst(scene, new THREE.TetrahedronGeometry(0.014, 0), crumbMat, 360, { radius: 0.01 }),
    coins: new Burst(scene, new THREE.CylinderGeometry(0.045, 0.045, 0.011, 18), coinMat, 320, { radius: 0.012, bounce: 0.45 }),
    puffs: new Puffs(scene),
    update(dt) {
      fx.sparks.update(dt); fx.crumbs.update(dt); fx.coins.update(dt); fx.puffs.update(dt);
    },
    clear() { fx.crumbs.clear(); fx.coins.clear(); },
  };
  fx.coins.mesh.castShadow = true;
  return fx;
}
