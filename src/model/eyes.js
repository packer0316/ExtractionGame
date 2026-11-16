import * as THREE from 'three';
import { revolve, ringProfile } from './geom.js';
import { LensDome } from '../fx/shatter.js';

// Shared geometry for both eyes (built once).
let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const blade = new THREE.Shape();
  blade.moveTo(0, 0);
  blade.quadraticCurveTo(0.05, 0.035, 0.115, 0.012);
  blade.quadraticCurveTo(0.07, -0.012, 0.02, -0.03);
  blade.closePath();
  GEO = {
    // fixed sleeve that sits in the socket
    housing: revolve([[0.166, -0.34], [0.178, -0.34], [0.178, -0.02], [0.174, 0.0], [0.166, 0.0], [0.166, -0.34]], 56),
    bezel: revolve([[0.164, -0.012], [0.18, -0.012], [0.186, 0.0], [0.186, 0.014], [0.178, 0.024], [0.164, 0.024], [0.164, -0.012]], 64),
    backCap: revolve([[0, -0.34], [0.178, -0.34]], 40),
    // moving lens barrel
    barrel: revolve(
      [[0.0, -0.3], [0.146, -0.3], [0.146, -0.07], [0.152, -0.064], [0.152, 0.0], [0.146, 0.012], [0.134, 0.014], [0.134, -0.02],
        [0.118, -0.03], [0.118, -0.05], [0.1, -0.06], [0.1, -0.085], [0.082, -0.095], [0.082, -0.13], [0.0, -0.13]],
      56,
    ),
    knurl: (() => {
      // grip ring with fine ridges
      const N = 72;
      const g = revolve(ringProfile(0.15, 0.158, -0.058, -0.012, 0.003), N);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        if (Math.hypot(x, y) > 0.156) {
          const k = 1 + 0.012 * Math.sign(Math.cos(Math.atan2(y, x) * (N / 2)));
          p.setXY(i, x * k, y * k);
        }
      }
      return g;
    })(),
    ringA: revolve(ringProfile(0.104, 0.116, -0.036, -0.026, 0.002), 56),
    ringB: revolve(ringProfile(0.085, 0.098, -0.07, -0.06, 0.002), 48),
    tick: new THREE.BoxGeometry(0.004, 0.012, 0.004),
    glow: new THREE.TorusGeometry(0.076, 0.0045, 8, 56),
    blade: new THREE.ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false, curveSegments: 8 }),
    element: new THREE.SphereGeometry(0.11, 40, 20, 0, Math.PI * 2, 0, 0.72),
    sensor: new THREE.CircleGeometry(0.014, 20),
    strut: new THREE.CylinderGeometry(0.012, 0.012, 1, 10),
  };
  return GEO;
}

const BLADES = 7;

/** One camera-lens eye. Local space: origin at the socket opening, +Z looks out. */
export function buildEye(mats, info) {
  const G = geometry();
  const group = new THREE.Group();
  group.position.set(...info.pos);
  group.rotation.y = info.side * 0.07; // slight outward toe

  const fixed = new THREE.Group();
  const housing = new THREE.Mesh(G.housing, mats.gunmetal);
  const bezel = new THREE.Mesh(G.bezel, mats.gold);
  const backCap = new THREE.Mesh(G.backCap, mats.gunmetal);
  fixed.add(housing, bezel, backCap);
  group.add(fixed);

  // ball: the part that aims
  const ball = new THREE.Group();
  ball.position.z = -0.16; // pivot behind the lens
  const optics = new THREE.Group();
  optics.position.z = 0.16;
  ball.add(optics);
  group.add(ball);

  const barrel = new THREE.Mesh(G.barrel, mats.black);
  const knurl = new THREE.Mesh(G.knurl, mats.chrome);
  const ringA = new THREE.Mesh(G.ringA, mats.gold);
  const ringB = new THREE.Mesh(G.ringB, mats.steel);
  for (let i = 0; i < 12; i++) {
    const tick = new THREE.Mesh(G.tick, mats.glowWhite);
    const a = (i / 12) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.025);
    tick.rotation.z = a + Math.PI / 2;
    tick.scale.setScalar(i % 3 === 0 ? 1 : 0.55);
    ringA.add(tick);
  }
  optics.add(barrel, knurl, ringA, ringB);

  const glowMat = mats.glowCyan.clone();
  const glowBase = glowMat.color.clone();
  const glow = new THREE.Mesh(G.glow, glowMat);
  glow.position.z = -0.094;
  optics.add(glow);

  // iris blades
  const blades = [];
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 1, roughness: 0.32, side: THREE.DoubleSide });
  for (let i = 0; i < BLADES; i++) {
    const hingeA = (i / BLADES) * Math.PI * 2;
    const piv = new THREE.Group();
    piv.position.set(Math.cos(hingeA) * 0.082, Math.sin(hingeA) * 0.082, -0.108 - i * 0.0008);
    const b = new THREE.Mesh(G.blade, bladeMat);
    piv.add(b);
    optics.add(piv);
    blades.push({ piv, base: hingeA + Math.PI * 0.62 });
  }

  // coated rear element + sensor glint
  const elementMat = new THREE.MeshPhysicalMaterial({
    color: 0x04060a, roughness: 0.06, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [220, 520],
  });
  const element = new THREE.Mesh(G.element, elementMat);
  element.rotation.x = Math.PI / 2;
  element.position.z = -0.226;
  const sensorMat = mats.glowCyan.clone();
  const sensor = new THREE.Mesh(G.sensor, sensorMat);
  sensor.position.z = -0.1145;
  optics.add(element, sensor);

  // the breakable front glass
  const dome = new LensDome({ a: 0.134, h: 0.052, thickness: 0.011, material: mats.lens });
  dome.group.position.z = 0.012;
  optics.add(dome.group);

  // struts back into the skull frame
  for (const [dx, dy] of [[0.1, 0.12], [-0.1, 0.12], [0, -0.15]]) {
    const s = new THREE.Mesh(G.strut, mats.steel);
    const from = new THREE.Vector3(dx, dy, -0.34), to = new THREE.Vector3(dx * 0.3 - info.side * 0.12, dy * 0.6 + 0.12, -0.72);
    s.position.copy(from).add(to).multiplyScalar(0.5);
    s.scale.y = from.distanceTo(to);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    group.add(s);
  }

  for (const m of [housing, bezel, barrel, knurl]) m.castShadow = true;

  // invisible, generous click target
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.targetId = info.id;
  hit.position.z = -0.02;
  group.add(hit);

  const local = new THREE.Vector3();
  const aim = { yaw: 0, pitch: 0, sy: 0, sp: 0, next: 0.5 };
  const eye = {
    group, ball, optics, dome, hit, glowMat, sensorMat,
    power: 1, // 0 = dead, 1 = fully lit
    aperture: 0.55, apertureTarget: 0.55,
    focusSpin: 0,
    droop: 0,
    flicker: 0,
    dead: false,
    hover: false,

    setAperture(v) { eye.apertureTarget = v; },

    update(dt, clock, head) {
      // aim at the gaze point with little saccades
      if (!eye.dead) {
        group.worldToLocal(local.copy(head.gaze));
        const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.3, 0.3);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, local.z), -0.22, 0.22);
        aim.next -= dt;
        if (aim.next <= 0) {
          aim.next = 0.5 + Math.random() * 2.4;
          aim.sy = (Math.random() - 0.5) * 0.07;
          aim.sp = (Math.random() - 0.5) * 0.05;
          eye.focusSpin += (Math.random() - 0.5) * 1.6;
          eye.apertureTarget = 0.35 + Math.random() * 0.4;
        }
        const k = 1 - Math.exp(-dt * 16);
        aim.yaw += (yaw + aim.sy - aim.yaw) * k;
        aim.pitch += (pitch + aim.sp - aim.pitch) * k;
      }
      ball.rotation.set(aim.pitch + eye.droop * 0.3, aim.yaw + eye.droop * info.side * 0.12, 0);

      const kf = 1 - Math.exp(-dt * 5);
      ringA.rotation.z += (eye.focusSpin - ringA.rotation.z) * kf;
      ringB.rotation.z = -ringA.rotation.z * 1.6;
      eye.aperture += (eye.apertureTarget - eye.aperture) * (1 - Math.exp(-dt * 7));
      const open = eye.aperture;
      for (const b of blades) b.piv.rotation.z = b.base + (1 - open) * 0.62;

      // glow: steady pulse, with electrical flicker when damaged
      let p = eye.power * (0.86 + 0.14 * Math.sin(clock * 2.2 + info.side)) * (eye.hover ? 1.9 : 1);
      if (eye.flicker > 0) {
        eye.flicker = Math.max(0, eye.flicker - dt);
        p *= Math.random() < 0.45 ? 0.08 : 1.5;
      }
      glowMat.color.copy(glowBase).multiplyScalar(p);
      sensorMat.color.copy(glowBase).multiplyScalar(p * 1.3);
    },

    /** Restore a destroyed eye. */
    reset() {
      eye.dead = false; eye.power = 1; eye.droop = 0; eye.flicker = 0;
      dome.reset();
    },
  };
  return eye;
}
