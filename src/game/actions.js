import * as THREE from 'three';
import { ease, rand, lerp } from '../util/anim.js';
import { FLOOR_Y } from '../model/layout.js';
import { FlexTube } from '../model/geom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WORLD_UP = V(0, 1, 0);
const WORLD_FRONT = V(0, 0, 1);
const GRIP_THICKNESS = { incisor: 0.05, canine: 0.07, premolar: 0.095, molar: 0.11 };
const TIER_GLOW = { small: 0x8a6a2a, win: 0xffc04a, big: 0xffd76a, mega: 0xfff0a8 };

function basisQuat(x, y, z) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * The two destruction sequences (hammer on eye, forceps on tooth) plus the
 * rebuild. `anim` runs on world time (it slows down in slow motion), `real`
 * on wall-clock time; `time.warp` scales world time.
 */
export function createActions({ stage, head, anim, real, time, debris, fx, sfx, hammer, forceps }) {
  const scene = stage.scene;
  scene.add(hammer.group, forceps.group);

  const nerve = new FlexTube(new THREE.MeshStandardMaterial({ color: 0xb3161b, roughness: 0.4, emissive: 0x3a0406 }), {
    radius: 0.007, segments: 14, radial: 6,
  });
  nerve.mesh.visible = false;
  scene.add(nerve.mesh);

  // loose shards switch to a cheaper, brighter glass that glints as it tumbles
  const shardMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf8ff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
    envMapIntensity: 3.2, specularIntensity: 1, depthWrite: false,
  });

  const savedCam = { pos: V(), target: V() };
  const saveCam = () => { savedCam.pos.copy(stage.camera.position); savedCam.target.copy(stage.controls.target); };
  const restoreCam = (dur = 0.9) => stage.flyTo(savedCam.pos, savedCam.target, dur).then(() => stage.releaseCamera());

  function takeHead({ yaw = 0, pitch = 0, roll = 0 }) {
    head.idle = false;
    head.pose.yaw.target = yaw; head.pose.pitch.target = pitch; head.pose.roll.target = roll;
  }
  function freeHead() {
    head.idle = true;
    head.setJaw(0.035);
  }

  /** Brief freeze on a heavy contact so the hit reads. */
  async function hitStop(seconds) {
    time.warp = 0.03;
    await real.wait(seconds);
    time.warp = 1;
  }

  // ====================================================================== EYE
  function launchShards(shards, dome, N, speed) {
    const q = dome.group.getWorldQuaternion(new THREE.Quaternion());
    for (const s of shards) {
      scene.attach(s.mesh);
      s.mesh.material = shardMat;
      s.mesh.renderOrder = 12;
      s.mesh.userData.disposeGeometry = true;
      const n = s.normal.clone().applyQuaternion(q);
      const vel = n.multiplyScalar(speed * rand(0.45, 1.3))
        .addScaledVector(N, speed * rand(0.15, 0.8))
        .add(V(rand(-0.7, 0.7), rand(0.2, 1.7), rand(-0.5, 0.7)));
      const spin = V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(5, 16));
      debris.add(s.mesh, {
        vel, spin, radius: Math.max(s.size * 0.55, 0.012), rest: 0.006, flatAxis: s.normal,
        bounce: 0.3, onHit: (impact) => sfx.tinkle(impact),
      });
    }
  }

  async function smashEye(t, outcome, onReveal) {
    const eye = t.eye, side = t.info.side, dome = eye.dome;
    saveCam();
    takeHead({ yaw: -side * 0.13, pitch: -0.03 });
    head.gaze.set(-side * 1.2, 0.2, 9);
    eye.setAperture(0.9);
    sfx.servo(0.35);

    // camera settles on the eye, from the side opposite the hammer
    const E0 = eye.group.getWorldPosition(V());
    stage.flyTo(E0.clone().add(V(-side * 1.25, 0.3, 3.5)), E0.clone().add(V(side * 0.1, -0.1, 0)), 0.75);
    await anim.wait(0.55);

    head.root.updateMatrixWorld(true);
    const N = V(0, 0, 1).applyQuaternion(dome.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const hitPoint = dome.toWorld(dome.impact);
    const R = V().crossVectors(WORLD_UP, N).normalize();
    const U = V().crossVectors(N, R).normalize();
    const Yl = R.clone().multiplyScalar(-side * 0.8).addScaledVector(U, 0.6).normalize();
    const Zl = N.clone().negate();
    const Xl = V().crossVectors(Yl, Zl).normalize();
    const qImpact = basisQuat(Xl, Yl, Zl);
    const headAtImpact = hitPoint.clone().addScaledVector(N, hammer.faceOffset + 0.003);
    const P = headAtImpact.clone().addScaledVector(Yl, -hammer.reach);
    const qx = new THREE.Quaternion(), axisX = V(1, 0, 0);
    const swing = (a) => hammer.group.quaternion.copy(qImpact).multiply(qx.setFromAxisAngle(axisX, a));

    // hammer arrives
    const REST = -0.8;
    const from = P.clone().addScaledVector(R, side * 1.7).addScaledVector(U, -1.3).addScaledVector(N, 1.1);
    hammer.group.visible = true;
    hammer.group.scale.setScalar(1);
    sfx.whoosh(0.5);
    await anim.tween(0.42, (k) => {
      hammer.group.position.lerpVectors(from, P, k);
      swing(lerp(-1.5, REST, k));
    }, ease.outCubic);
    // a little tap to take aim
    await anim.tween(0.16, (k) => swing(lerp(REST, -0.16, k)), ease.inOutQuad);
    await anim.tween(0.16, (k) => swing(lerp(-0.16, REST, k)), ease.inOutQuad);

    const POWER = [0.55, 0.8, 1];
    for (let i = 0; i < 3; i++) {
      const p = POWER[i];
      const back = -1.15 - 0.2 * i;
      await anim.tween(0.26 + 0.05 * i, (k) => swing(lerp(REST, back, k)), ease.outCubic);
      await anim.wait(0.03 + 0.05 * i);
      sfx.whoosh(p);
      await anim.tween(0.085, (k) => swing(lerp(back, 0, k)), ease.inQuad);

      // ---- contact
      sfx.hammerHit(p);
      stage.shake(0.022 + 0.03 * p);
      head.kick({ pitch: -1.5 * p, z: -1.3 * p, yaw: side * 0.9 * p, roll: -side * 0.5 * p });
      head.pose.jaw.kick(1.6 * p);
      head.mech.spin += 3 * p;
      eye.flicker = 0.25 + 0.35 * p;
      fx.sparks.emit(hitPoint, { count: 8 + 10 * i, speed: 2.4 + i, dir: N, spread: 0.9, color: [1.6, 2.2, 3.0], life: 0.35 });
      fx.puffs.emit(hitPoint, { count: 1, color: [1.6, 1.9, 2.2], size: [0.1, 0.5 + 0.2 * i], life: 0.14, alpha: 0.75, additive: true, speed: 0, jitter: 0 });

      if (i === 0) {
        sfx.glassCrack(0.6);
        real.tween(0.14, (k) => dome.crack(0.5 * k), ease.outCubic);
        fx.crumbs.emit(hitPoint, { count: 9, speed: 1.5, dir: N, spread: 0.8, up: 0.6 });
        await hitStop(0.05);
      } else if (i === 1) {
        sfx.glassCrack(1);
        launchShards(dome.open(), dome, N, 1.7);
        fx.crumbs.emit(hitPoint, { count: 26, speed: 2.1, dir: N, spread: 0.9, up: 0.8 });
        fx.puffs.emit(hitPoint, { count: 3, color: 0xdfeaf2, size: [0.06, 0.35], life: 0.6, alpha: 0.22, dir: N, speed: 0.5 });
        eye.power = 0.65;
        eye.setAperture(0.3);
        await hitStop(0.065);
      } else {
        sfx.glassShatter();
        stage.shake(0.085);
        launchShards(dome.burst(), dome, N, 3.3);
        fx.crumbs.emit(hitPoint, { count: 110, speed: 3.4, dir: N, spread: 1.0, up: 1.1, scale: [0.5, 1.7] });
        fx.sparks.emit(hitPoint, { count: 46, speed: 4.2, dir: N, spread: 1.1, color: [1.4, 2.4, 3.2], life: 0.55 });
        fx.sparks.emit(hitPoint, { count: 22, speed: 3, dir: N, spread: 1.2, color: [3.2, 1.7, 0.5], life: 0.7 });
        fx.puffs.emit(hitPoint, { count: 7, color: 0xe6eef4, size: [0.1, 0.75], life: 1.1, alpha: 0.26, dir: N, speed: 0.7 });
        fx.puffs.emit(hitPoint, { count: 1, color: [2.4, 2.8, 3.2], size: [0.2, 1.5], life: 0.22, alpha: 0.9, additive: true, speed: 0, jitter: 0 });
        eye.dead = true;
        eye.flicker = 1.1;
        sfx.powerDown();
        real.tween(1.0, (k) => { eye.power = 0.65 * (1 - k); eye.droop = k; }, ease.outCubic);
        // slow motion while the glass hangs in the air
        time.warp = 0.1;
        real.tween(1.15, (k) => { time.warp = lerp(0.1, 1, k); }, ease.inCubic);
        stage.flyTo(
          stage.camera.position.clone().lerp(hitPoint, 0.16),
          stage.controls.target.clone().lerp(hitPoint, 0.5), 1.1, ease.outCubic,
        );
      }
      if (i < 2) {
        await anim.tween(0.26, (k) => swing(lerp(0, REST, k)), ease.outBack);
      } else {
        // follow through into the socket, then pull away
        await anim.tween(0.2, (k) => swing(lerp(0, 0.12, k)), ease.outCubic);
        const away = P.clone().addScaledVector(R, side * 1.9).addScaledVector(U, -1.2).addScaledVector(N, 1.4);
        anim.tween(0.55, (k) => {
          hammer.group.position.lerpVectors(P, away, k);
          swing(lerp(0.12, -1.3, k));
        }, ease.inCubic).then(() => { hammer.group.visible = false; });
      }
    }

    await real.wait(0.95);
    // ---- the payoff comes out of the broken socket
    const socket = eye.group.getWorldPosition(V());
    await reveal(outcome, socket, N, onReveal);
    await real.wait(outcome.tier === 'dud' ? 0.55 : 0.9);
    freeHead();
    await restoreCam();
  }

  // ====================================================================== TOOTH
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V(), _o = V();
  /** Rock the tooth in its socket: tilt about the root, lifted out by `lift`. */
  function poseTooth(t, tilt, lift, twist = 0) {
    _q.setFromEuler(_e.set(tilt, twist, 0));
    _p.set(0, -t.info.rootLen * 0.55, 0);
    _o.set(0, lift, 0).sub(_p).applyQuaternion(_q).add(_p);
    t.holder.quaternion.copy(t.home.quat).multiply(_q);
    t.holder.position.copy(_o).applyQuaternion(t.home.quat).add(t.home.pos);
  }

  async function extractTooth(t, outcome, onReveal) {
    const info = t.info, upper = info.arch === 'U';
    saveCam();
    takeHead({
      yaw: -Math.atan2(info.zAxis[0], info.zAxis[2]) * 0.42,
      pitch: upper ? -0.17 : 0.07,
    });
    head.setJaw(upper ? 0.36 : 0.42);
    head.gaze.set(0, 0, 9);
    sfx.servo(0.45);
    await anim.wait(0.5);

    head.root.updateMatrixWorld(true);
    const hq = t.holder.getWorldQuaternion(new THREE.Quaternion());
    const tY = V(0, 1, 0).applyQuaternion(hq), tZ = V(0, 0, 1).applyQuaternion(hq);
    const base = t.holder.getWorldPosition(V());
    const grip = base.clone().addScaledVector(tY, info.crown * 0.55);

    const tX = V(1, 0, 0).applyQuaternion(hq);
    const lateral = tX.x * info.side >= 0 ? 1 : -1;
    const viewDir = tZ.clone().multiplyScalar(0.7).addScaledVector(WORLD_FRONT, 0.6)
      .addScaledVector(tX, lateral * info.side * 0.5).addScaledVector(WORLD_UP, upper ? -0.2 : 0.3).normalize();
    stage.flyTo(grip.clone().addScaledVector(viewDir, 3.2), grip.clone().addScaledVector(tY, 0.12), 0.7);

    // forceps frame: along the tooth, leaning out of the mouth
    const outDir = tZ.clone().multiplyScalar(0.55).addScaledVector(WORLD_FRONT, 0.62).normalize();
    const Yf = tY.clone().multiplyScalar(0.84).addScaledVector(outDir, 0.55).normalize();
    const Zf = tZ.clone().addScaledVector(Yf, -Yf.dot(tZ)).normalize();
    const Xf = V().crossVectors(Yf, Zf).normalize();
    const tool = forceps.group;
    tool.quaternion.copy(basisQuat(Xf, Yf, Zf));
    tool.visible = true;
    forceps.setOpen(1);
    const far = grip.clone().addScaledVector(Yf, 2.7).addScaledVector(WORLD_UP, upper ? -0.5 : 0.5);
    const hover = grip.clone().addScaledVector(Yf, 0.2);
    sfx.whoosh(0.35);
    await anim.tween(0.5, (k) => tool.position.lerpVectors(far, hover, k), ease.outCubic);
    await anim.tween(0.2, (k) => tool.position.lerpVectors(hover, grip, k), ease.inOutQuad);
    const pinch = forceps.gripFor(GRIP_THICKNESS[info.zone] * info.scale[2]);
    await anim.tween(0.1, (k) => forceps.setOpen(lerp(1, pinch, k)), ease.inQuad);
    sfx.click();
    stage.shake(0.006);
    t.holder.attach(tool); // the tool now rides on the tooth

    // ---- work it loose
    const socket = t.seat.getWorldPosition(V());
    const AMPS = [0.07, -0.09, 0.11, -0.13, 0.15, -0.1];
    let tilt = 0, lift = 0;
    for (let i = 0; i < AMPS.length; i++) {
      const a0 = tilt, a1 = AMPS[i], l0 = lift, l1 = lift + 0.005 + i * 0.0012;
      const power = 0.5 + i * 0.1;
      sfx.creak(power);
      await anim.tween(0.2 - i * 0.012, (k) => poseTooth(t, lerp(a0, a1, k), lerp(l0, l1, k), Math.sin(k * Math.PI) * 0.05 * (i % 2 ? -1 : 1)), ease.inOutQuad);
      tilt = a1; lift = l1;
      head.kick({ roll: (i % 2 ? 1 : -1) * 0.35 * power * info.side, pitch: (upper ? 1 : -1) * 0.25 * power, y: (upper ? -1 : 1) * 0.25 * power });
      head.mech.spin += 0.8;
      t.seat.getWorldPosition(socket);
      fx.sparks.emit(socket, { count: 3 + i, speed: 1.2, dir: tY, spread: 1, color: [3, 1.9, 0.6], life: 0.3 });
      if (i === 3) fx.puffs.emit(socket, { count: 2, color: 0xd8cdb8, size: [0.04, 0.2], life: 0.5, alpha: 0.25, dir: tY, speed: 0.3 });
    }

    // ---- the strain before it lets go
    sfx.strain();
    const pull = upper ? 0.07 : -0.07;
    head.pose.pitch.target += pull;
    await anim.tween(0.36, (k) => {
      const tremble = Math.sin(k * 60) * 0.006 * k;
      poseTooth(t, lerp(tilt, 0, k) + tremble, lerp(lift, lift + 0.035, k));
    }, ease.inQuad);
    lift += 0.035;

    // ---- out it comes
    head.root.updateMatrixWorld(true);
    t.seat.getWorldPosition(socket);
    const rootDir = tY.clone();
    scene.attach(t.holder);
    t.alive = false;
    sfx.pop();
    stage.shake(0.04);
    head.pose.pitch.target -= pull;
    head.kick({ pitch: (upper ? -1 : 1) * 1.5, y: (upper ? 1 : -1) * 0.9, z: -0.5, roll: rand(-0.6, 0.6) });
    head.pose.jaw.kick(upper ? 1.5 : -2.4);
    head.mech.spin += 4;
    fx.sparks.emit(socket, { count: 30, speed: 3, dir: rootDir, spread: 0.8, color: [3.2, 1.9, 0.55], life: 0.5 });
    fx.crumbs.emit(socket, { count: 10, speed: 1.6, dir: rootDir, spread: 0.7, up: 0.3, scale: [0.4, 0.9] });
    fx.puffs.emit(socket, { count: 4, color: 0xdccfb6, size: [0.05, 0.36], life: 0.8, alpha: 0.3, dir: rootDir, speed: 0.5 });
    fx.puffs.emit(socket, { count: 1, color: [3, 1.8, 0.6], size: [0.08, 0.5], life: 0.2, alpha: 0.8, additive: true, speed: 0, jitter: 0 });

    addStump(t);
    const p0 = t.holder.position.clone(), q0 = t.holder.quaternion.clone();
    const pOut = p0.clone().addScaledVector(Yf, 0.78).addScaledVector(WORLD_UP, 0.06);
    const qOut = q0.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(Xf, -0.3));
    const apexLocal = V(0, -info.rootLen, 0);
    const wireA = V(), wireB = V(), wireMid = V();
    let snapped = false;
    nerve.mesh.visible = true;
    hitStop(0.035);
    await anim.tween(0.3, (k) => {
      t.holder.position.lerpVectors(p0, pOut, k);
      t.holder.quaternion.slerpQuaternions(q0, qOut, Math.min(k * 1.4, 1));
      if (snapped) return;
      t.holder.updateMatrixWorld(true);
      t.seat.getWorldPosition(wireA).addScaledVector(rootDir, -info.rootLen * 0.5);
      t.holder.localToWorld(wireB.copy(apexLocal));
      const len = wireA.distanceTo(wireB);
      if (len > 0.4) {
        snapped = true;
        nerve.mesh.visible = false;
        wireMid.lerpVectors(wireA, wireB, 0.5);
        sfx.snap();
        fx.sparks.emit(wireMid, { count: 14, speed: 2.2, color: [1.4, 2.2, 3.2], life: 0.3 });
      } else {
        wireMid.lerpVectors(wireA, wireB, 0.5).addScaledVector(Zf, 0.03 * (1 - len / 0.4));
        nerve.fit([wireA, wireMid, wireB]);
      }
    }, ease.outBack);
    nerve.mesh.visible = false;
    head.setJaw(0.2);

    // ---- hold it up to the camera
    const cam = stage.camera;
    const cq = cam.quaternion;
    const cRight = V(1, 0, 0).applyQuaternion(cq), cUp = V(0, 1, 0).applyQuaternion(cq), cFwd = V(0, 0, -1).applyQuaternion(cq);
    const Yw = cRight.clone().multiplyScalar(0.5).addScaledVector(cUp, -0.82).addScaledVector(cFwd, -0.12).normalize();
    const Zw = cRight.clone().addScaledVector(Yw, -Yw.dot(cRight)).normalize();
    const Xw = V().crossVectors(Yw, Zw).normalize();
    const qShow = basisQuat(Xw, Yw, Zw).multiply(tool.quaternion.clone().invert());
    const gShow = cam.position.clone().addScaledVector(cFwd, 2.25).addScaledVector(cRight, -0.12).addScaledVector(cUp, 0.1);
    const pShow = gShow.clone().sub(tool.position.clone().applyQuaternion(qShow));
    const p1 = t.holder.position.clone(), q1 = t.holder.quaternion.clone();
    await anim.tween(0.5, (k) => {
      t.holder.position.lerpVectors(p1, pShow, k);
      t.holder.quaternion.slerpQuaternions(q1, qShow, k);
    }, ease.inOutCubic);

    const toothPos = t.mesh.getWorldPosition(V());
    const showing = reveal(outcome, toothPos, cUp, onReveal, t);
    // slow turn so the root catches the light
    const turn = new THREE.Quaternion();
    await anim.tween(outcome.tier === 'dud' ? 0.75 : 1.15, (k) => {
      turn.setFromAxisAngle(cUp, Math.sin(k * Math.PI) * 0.5);
      t.holder.quaternion.copy(qShow).premultiply(turn);
      t.holder.position.copy(gShow).sub(_p.copy(tool.position).applyQuaternion(t.holder.quaternion));
    }, ease.inOutQuad);
    await showing;

    // ---- let go: the tooth is tossed onto the floor by the base
    await anim.tween(0.12, (k) => forceps.setOpen(lerp(pinch, 1, k)), ease.outQuad);
    scene.attach(t.mesh);
    const land = V(rand(-1.5, 1.5), FLOOR_Y, rand(0.7, 1.7));
    const T = 0.72;
    const start = t.mesh.position;
    const vel = V((land.x - start.x) / T, (land.y - start.y) / T + 0.5 * 17 * T, (land.z - start.z) / T);
    debris.add(t.mesh, {
      vel, spin: V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(6, 12)),
      radius: 0.05, rest: 0.035, flatAxis: V(0, 0, 1), bounce: 0.42, friction: 0.55,
      onHit: (impact) => sfx.toothDrop(impact),
    });
    scene.attach(tool);
    t.holder.removeFromParent();
    const tp = tool.position.clone();
    const exit = tp.clone().addScaledVector(Yw, 2.4);
    anim.tween(0.45, (k) => tool.position.lerpVectors(tp, exit, k), ease.inCubic).then(() => { tool.visible = false; });

    freeHead();
    await restoreCam(0.85);
  }

  /** Frayed wires and a dying ember left behind in an empty socket. */
  const stumpGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 1, 6).translate(0, 0.5, 0);
  const emberGeo = new THREE.SphereGeometry(0.009, 8, 6);
  function addStump(t) {
    const g = new THREE.Group();
    const wires = [head.mats.cableRed, head.mats.cableAmber, head.mats.cableTeal];
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(stumpGeo, wires[i]);
      w.position.set(rand(-0.012, 0.012), -0.07, rand(-0.012, 0.012));
      w.rotation.set(rand(-0.45, 0.45), 0, rand(-0.45, 0.45));
      w.scale.y = rand(0.06, 0.1);
      g.add(w);
    }
    const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3) });
    const ember = new THREE.Mesh(emberGeo, emberMat);
    ember.position.y = -0.005;
    g.add(ember);
    t.seat.add(g);
    t.stump = g;
    // the ember sputters, then settles to a faint glow
    real.tween(3.2, (k) => {
      const f = (Math.random() < 0.3 ? 0.2 : 1) * (1 - k) + 0.12;
      emberMat.color.setRGB(3 * f, 1.2 * f, 0.3 * f);
    }, ease.linear);
  }

  // ====================================================================== PAYOFF
  /** Show what the target was worth. Resolves once the flourish has played. */
  async function reveal(outcome, pos, dir, onReveal, tooth = null) {
    onReveal(pos);
    const { tier } = outcome;
    if (tier === 'dud') {
      sfx.lose();
      sfx.zap(0.08);
      fx.sparks.emit(pos, { count: 10, speed: 1.4, color: [1.2, 1.6, 2.4], life: 0.35 });
      fx.puffs.emit(pos, { count: 4, color: 0x2a2d33, size: [0.08, 0.5], life: 1.2, alpha: 0.4, dir: WORLD_UP, speed: 0.35 });
      if (tooth) {
        // a rotten one: it dulls and darkens
        const mat = tooth.mesh.material;
        const c0 = mat.color.clone(), c1 = new THREE.Color(0x8d7b60);
        real.tween(0.5, (k) => mat.color.copy(c0).lerp(c1, k));
      }
      return;
    }
    sfx.win(tier);
    const coins = { small: 3, win: 10, big: 26, mega: 60 }[tier];
    fx.coins.emit(pos, { count: coins, speed: tier === 'mega' ? 3.6 : 2.6, dir: dir.clone().multiplyScalar(0.5).add(V(0, 0.9, 0.2)), spread: 0.7, up: 2.2, scale: [0.8, 1.2], life: 5 });
    sfx.coin(Math.min(coins, 14));
    fx.puffs.emit(pos, { count: 1, color: [2.4, 1.7, 0.6], size: [0.1, tier === 'mega' ? 1.5 : 0.7], life: 0.3, alpha: 0.5, additive: true, speed: 0, jitter: 0 });
    fx.sparks.emit(pos, { count: 12 + coins, speed: 3, color: [3.2, 2.2, 0.7], life: 0.6 });
    if (tier === 'big' || tier === 'mega') stage.shake(0.03);
    if (tooth) {
      const mat = tooth.mesh.material;
      mat.emissive.set(TIER_GLOW[tier]);
      real.tween(1.4, (k) => { mat.emissiveIntensity = Math.sin(k * Math.PI) * (tier === 'small' ? 0.1 : 0.24); });
    }
  }

  // ====================================================================== REBUILD
  /** Refit every missing tooth and broken lens. `all` replays the full intro. */
  async function rebuild({ all = false } = {}) {
    debris.clear();
    fx.clear();
    sfx.rebuild();
    takeHead({ yaw: 0, pitch: 0 });
    head.setJaw(0.3);
    head.mech.spin += 5;
    const jobs = [];
    const teeth = [...head.targets.values()].filter((t) => t.kind === 'tooth' && (all || !t.alive));
    // cascade from the front teeth to the back, upper row first
    teeth.sort((a, b) => (a.info.arch === b.info.arch ? a.info.n - b.info.n : a.info.arch === 'U' ? -1 : 1));
    teeth.forEach((t, i) => {
      const mat = t.mesh.material;
      mat.color.set(0xffffff);
      mat.emissiveIntensity = 0;
      t.holder.add(t.mesh);
      t.mesh.position.set(0, 0, 0);
      t.mesh.quaternion.identity();
      t.mesh.scale.set(...t.info.scale);
      if (t.stump) { t.stump.removeFromParent(); t.stump = null; }
      t.parent.add(t.holder);
      t.holder.quaternion.copy(t.home.quat);
      t.holder.visible = false;
      const outDir = V(0, 1, 0).applyQuaternion(t.home.quat);
      jobs.push(
        anim.wait(0.25 + i * 0.045).then(() => {
          t.holder.visible = true;
          sfx.click();
          return anim.tween(0.3, (k) => {
            t.holder.position.copy(t.home.pos).addScaledVector(outDir, (1 - k) * 0.5);
            t.holder.scale.setScalar(0.55 + 0.45 * Math.min(k * 1.6, 1));
          }, ease.outBack);
        }).then(() => { t.alive = true; }),
      );
    });
    for (const t of head.targets.values()) {
      if (t.kind !== 'eye' || (!all && t.alive)) continue;
      t.eye.reset();
      t.eye.power = 0;
      t.eye.flicker = 0.9;
      t.eye.setAperture(0.05);
      jobs.push(
        anim.wait(0.5).then(() => {
          sfx.servo(0.5);
          t.eye.setAperture(0.9);
          return real.tween(0.9, (k) => { t.eye.power = k; }, ease.outCubic);
        }).then(() => { t.alive = true; t.eye.setAperture(0.55); }),
      );
    }
    await Promise.all(jobs);
    await anim.wait(0.15);
    freeHead();
  }

  // dead eyes keep spitting the odd spark
  const _w = V();
  function update(dt) {
    for (const t of head.targets.values()) {
      if (t.kind !== 'eye' || !t.eye.dead) continue;
      if (Math.random() < dt * 0.55) {
        t.eye.group.getWorldPosition(_w);
        fx.sparks.emit(_w, { count: 4 + Math.floor(Math.random() * 5), speed: 1.6, dir: WORLD_FRONT, spread: 1, color: [1.3, 2.0, 3.0], life: 0.3 });
        sfx.zap(0.035);
        fx.puffs.emit(_w, { count: 1, color: 0x30343b, size: [0.06, 0.45], life: 1.6, alpha: 0.28, dir: WORLD_UP, speed: 0.4 });
      }
    }
  }

  return { smashEye, extractTooth, rebuild, update };
}
