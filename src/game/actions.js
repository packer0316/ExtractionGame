import * as THREE from 'three';
import { ease, rand, lerp } from '../util/anim.js';
import { FLOOR_Y } from '../model/layout.js';
import { FlexTube } from '../model/geom.js';
import { ZONES } from './paytable.js';
import { createAura, createBeam } from '../fx/award.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WORLD_UP = V(0, 1, 0);
const WORLD_FRONT = V(0, 0, 1);
const GRIP_THICKNESS = { incisor: 0.05, canine: 0.07, premolar: 0.095, molar: 0.11 };
const TIER_GLOW = { small: 0x8a6a2a, win: 0xffc04a, big: 0xffd76a, mega: 0xfff0a8 };
// how hard the moment a tooth lets go should land, by size of the win
const TIER_POWER = { dud: 0.45, small: 0.75, win: 1, big: 1.45, mega: 2 };
const GOLD = new THREE.Color(0xffc95e);

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How "charged" a prize looks, 0..1: x1 is a faint glow, x5 clearly gold, x20 and up prismatic. */
const chargeOf = (mult) => Math.min(1, Math.log(mult + 1) / Math.log(51));

/** The prizes a tooth passes on its way up to `mult`: one per round it survives. */
function stepsFor(zone, mult) {
  const steps = ZONES[zone].table.map(([m]) => m).filter((m) => m > 0 && m <= mult);
  if (mult > 0 && steps[steps.length - 1] !== mult) steps.push(mult);
  return steps;
}

function basisQuat(x, y, z) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * The two destruction sequences (hammer on eye, forceps on tooth) plus the
 * rebuild. `anim` runs on world time (it slows down in slow motion), `real`
 * on wall-clock time; `time.warp` scales world time.
 */
export function createActions({ stage, head, anim, real, time, debris, fx, award, sfx, hammer, forceps }) {
  const scene = stage.scene;
  scene.add(hammer.group, forceps.group);
  const auras = new Set(); // glowing skins currently alive (their clocks need ticking)

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

  async function smashEye(t, outcome, ui) {
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
    await reveal(outcome, socket, N, ui.onReveal, null, eye.group);
    await real.wait(outcome.tier === 'dud' ? 0.55 : 0.9);
    settleDown();
    freeHead();
    await restoreCam();
  }

  /** Put every escalating effect back to rest. */
  function settleDown() {
    stage.calm();
    award.burstOff();
    award.arcs(null, 0);
    time.warp = 1;
    const p0 = head.mech.power;
    real.tween(0.6, (k) => { head.mech.power = lerp(p0, 1, k); });
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

  async function extractTooth(t, outcome, ui) {
    const info = t.info, upper = info.arch === 'U';
    // The result is already decided; the struggle is how it gets told. A tooth
    // that is worth more holds on through more hauls, and the prize on screen
    // climbs one step each time it does.
    const steps = stepsFor(info.zone, outcome.mult);
    const span = Math.max(1, ZONES[info.zone].table.filter(([m]) => m > 0).length - 1);
    const power = TIER_POWER[outcome.tier] || 1;
    const grand = outcome.tier === 'big' || outcome.tier === 'mega';
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
    const camPos = grip.clone().addScaledVector(viewDir, 3.2), camTarget = grip.clone().addScaledVector(tY, 0.12);
    stage.flyTo(camPos, camTarget, 0.7);

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
    ui.onLadder(info.zone, outcome.bet);

    // a glowing skin over the tooth: heat while it resists, light once it has won
    const mat = t.mesh.material;
    if (!t.matOrig) t.matOrig = { color: mat.color.clone(), metalness: mat.metalness, roughness: mat.roughness };
    if (t.aura) { auras.delete(t.aura); t.aura.dispose(); }
    const aura = createAura(t.mesh.geometry);
    t.mesh.add(aura.mesh);
    t.aura = aura;
    auras.add(aura);
    // light pours out of the socket as the prize grows
    const beam = createBeam();
    t.seat.add(beam.mesh);
    t.beam = beam;
    auras.add(beam);

    // How the tooth itself looks, from plain enamel to full treasure. It is
    // raised a notch every time the prize steps up, so the tooth turns to
    // gold, starts to shimmer and finally breaks into rainbow light while it
    // is still being fought for, not only once it is out.
    const look = { gold: 0, shimmer: 0, prism: 0, glint: 0, beam: 0 };
    const applyLook = () => {
      mat.color.copy(t.matOrig.color).lerp(GOLD, look.gold);
      mat.metalness = lerp(t.matOrig.metalness, 1, look.gold);
      mat.roughness = lerp(t.matOrig.roughness, 0.2, look.gold);
      aura.uniforms.uAward.value = look.shimmer;
      aura.uniforms.uPrism.value = look.prism;
      aura.uniforms.uGlint.value = look.glint;
      beam.uniforms.uPower.value = look.beam;
      beam.uniforms.uPrism.value = look.prism;
      beam.mesh.scale.set(1 + look.beam * 0.6, 0.45 + look.beam * 1.1, 1 + look.beam * 0.6);
    };
    applyLook();
    const raiseLook = (mult) => {
      const c = chargeOf(mult);
      const from = { ...look };
      const to = {
        gold: smooth(0.1, 0.6, c) * 0.95,
        shimmer: 0.12 + smooth(0.05, 0.55, c) * 0.8,
        prism: smooth(0.7, 0.86, c),
        glint: smooth(0.38, 0.9, c),
        beam: smooth(0.25, 0.9, c) * 0.9,
      };
      real.tween(0.28, (k) => { for (const key in look) look[key] = lerp(from[key], to[key], k); applyLook(); }, ease.outCubic);
      aura.uniforms.uPulse.value = 1;
      return c;
    };

    const socket = t.seat.getWorldPosition(V());
    const drag = upper ? 1 : -1; // which way the head gets hauled
    let tilt = 0, lift = 0, heat = 0;

    /** Rock the tooth sideways once. */
    const rock = async (amp, dur, force) => {
      const a0 = tilt, l0 = lift, l1 = lift + 0.004;
      sfx.creak(force);
      await anim.tween(dur, (k) => poseTooth(t, lerp(a0, amp, k), lerp(l0, l1, k), Math.sin(k * Math.PI) * 0.05 * Math.sign(amp)), ease.inOutQuad);
      tilt = amp; lift = l1;
      head.kick({ roll: Math.sign(amp) * 0.35 * force * info.side, pitch: drag * 0.25 * force, y: -drag * 0.25 * force });
      head.mech.spin += 0.8;
      t.seat.getWorldPosition(socket);
      fx.sparks.emit(socket, { count: 3 + Math.round(force * 4), speed: 1.2, dir: tY, spread: 1, color: [3, 1.9, 0.6], life: 0.3 });
    };

    /** One haul on the forceps. Unless it is the last, the tooth holds and snaps back. */
    const heave = async (level, last) => {
      const dur = 0.44 + level * 0.3;
      const stretch = 0.03 + level * 0.032;
      const a0 = tilt, l0 = lift;
      const pull = drag * (0.035 + 0.05 * level);
      sfx.tension(dur, level);
      head.pose.pitch.target += pull;
      stage.flyTo(camPos.clone().lerp(grip, Math.min(0.05 + 0.26 * level, 0.3)), camTarget, dur, ease.outQuad);
      await anim.tween(dur, (k) => {
        const kk = k * k;
        const tremble = Math.sin(k * (46 + level * 70)) * (0.004 + 0.013 * level) * kk;
        poseTooth(t, lerp(a0, 0, Math.min(k * 2.5, 1)) + tremble, l0 + stretch * ease.outCubic(k), Math.sin(k * 38) * 0.03 * level * kk);
        // the arms spring open a hair under the load
        forceps.setOpen(pinch + 0.04 * level * kk * (0.5 + 0.5 * Math.sin(k * 95)));
        aura.uniforms.uHeat.value = Math.min(1, heat + (0.12 + 0.2 * level) * kk);
        // its light strains towards the next notch, and sparkles gather round it
        aura.uniforms.uAward.value = look.shimmer + 0.22 * kk * (0.5 + 0.5 * Math.sin(k * 60));
        if (look.glint > 0.05 && Math.random() < 0.06 + 0.22 * look.glint) {
          award.sparkle(t.mesh.getWorldPosition(_o), {
            count: 1, radius: 0.12 + 0.12 * look.glint, size: [0.04, 0.1 + 0.1 * look.glint], life: 0.45,
            color: look.prism > 0.5 ? [1.6, 1.9, 2.3] : [2, 1.6, 0.8],
          });
        }
        if (level > 0.25) {
          stage.shake((0.004 + 0.014 * level) * kk);
          t.seat.getWorldPosition(socket);
          award.arcs(socket, (level - 0.25) * 1.3 * kk, { reach: 0.3 + 0.2 * level });
        }
      }, ease.linear);
      tilt = 0;
      head.pose.pitch.target -= pull;
      forceps.setOpen(pinch);
      aura.uniforms.uAward.value = look.shimmer;
      if (last) { lift = l0 + stretch; return; }
      lift = l0 + 0.007 + 0.006 * level;
      await anim.tween(0.07, (k) => poseTooth(t, 0, lerp(l0 + stretch, lift, k)), ease.inQuad);
    };

    /** The tooth held: the prize climbs a step and everything hits a little harder. */
    const stepUp = async (i, level) => {
      heat = (i + 1) / (span + 1);
      aura.uniforms.uHeat.value = heat;
      t.seat.getWorldPosition(socket);
      ui.onStep(i, steps[i], socket);
      // the tooth itself levels up with the prize
      const c = raiseLook(steps[i]);
      if (c > 0.42) award.burstOn(t.mesh, { size: 0.6 + 1.1 * c, prism: smooth(0.7, 0.86, c), power: 0.22 + 0.4 * c, back: 0, overlay: true });
      stage.spotlight(socket, smooth(0.35, 0.9, c) * 0.5);
      sfx.step(i);
      sfx.click();
      stage.shake(0.014 + 0.03 * level);
      stage.impact(socket, { zoom: 0.25 + 0.6 * level, chroma: 0.3 + 0.9 * level });
      if (level > 0.45) stage.shockwave(socket, 0.4 + 0.8 * level);
      stage.glow(0.06 * level);
      head.kick({ pitch: -drag * (0.5 + 1.2 * level), y: drag * (0.3 + 0.6 * level), roll: rand(-0.5, 0.5) * (1 + level) });
      head.pose.jaw.kick((upper ? 1 : -1) * (0.8 + 1.6 * level));
      head.mech.spin += 1.5 + 4 * level;
      head.mech.power = 1 + 1.4 * level;
      fx.sparks.emit(socket, {
        count: 8 + Math.round(26 * level), speed: 1.6 + 2.2 * level, dir: tY, spread: 0.9,
        color: level > 0.6 ? [3.4, 2.6, 1.2] : [3, 1.9, 0.6], life: 0.4,
      });
      fx.puffs.emit(socket, { count: 1, color: [1.9, 1.25, 0.45], size: [0.06, 0.22 + 0.3 * level], life: 0.16, alpha: 0.7, additive: true, speed: 0, jitter: 0 });
      award.sparkle(socket, { count: 3 + Math.round(8 * level), radius: 0.16 + 0.2 * level, size: [0.05, 0.12 + 0.12 * level], life: 0.6 });
      await hitStop(0.03 + 0.04 * level);
    };

    /** The forceps loses its grip, flies off, and has to bite again. */
    const slip = async () => {
      sfx.slip();
      ui.onSlip();
      stage.shake(0.03);
      award.arcs(null, 0);
      head.kick({ pitch: -drag * 1.3, roll: rand(-0.8, 0.8), y: drag * 0.6 });
      fx.sparks.emit(socket, { count: 18, speed: 2.6, dir: tY, spread: 1, color: [3.2, 2.4, 1.0], life: 0.35 });
      const axis = V(0, 1, 0).applyQuaternion(tool.quaternion); // tool axis in the holder's space
      const p0 = tool.position.clone(), p1 = p0.clone().addScaledVector(axis, 0.24);
      const l0 = lift;
      lift = Math.max(0, lift - 0.01);
      await anim.tween(0.16, (k) => {
        tool.position.lerpVectors(p0, p1, k);
        forceps.setOpen(lerp(pinch, 0.8, Math.min(k * 2, 1)));
        poseTooth(t, 0, lerp(l0, lift, k));
      }, ease.outBack);
      await anim.wait(0.24);
      await anim.tween(0.2, (k) => tool.position.lerpVectors(p1, p0, k), ease.inOutQuad);
      await anim.tween(0.08, (k) => forceps.setOpen(lerp(0.8, pinch, k)), ease.inQuad);
      sfx.click();
      stage.shake(0.008);
    };

    // ---- feel it out: the same few rocks for every tooth, so nothing is given away
    await rock(0.07, 0.19, 0.5);
    await rock(-0.09, 0.18, 0.6);
    await rock(0.11, 0.17, 0.7);

    // ---- the struggle: every haul it survives, the prize climbs a step
    for (let i = 0; i < steps.length; i++) {
      const level = Math.min(1, i / span);
      ui.onTease(i);
      await heave(level, false);
      await stepUp(i, level);
      await rock((i % 2 ? 1 : -1) * (0.1 + 0.08 * level), 0.14, 0.6 + 0.6 * level);
      await rock((i % 2 ? -1 : 1) * (0.11 + 0.08 * level), 0.13, 0.7 + 0.6 * level);
      if (i === 2 && steps.length >= 5) await slip();
    }

    // ---- the haul that finally does it
    ui.onTease(steps.length);
    if (grand) {
      // the room goes dark and slow around the tooth
      stage.spotlight(socket, outcome.tier === 'mega' ? 0.62 : 0.48);
      sfx.heartbeat();
      await real.wait(0.42);
      sfx.heartbeat();
      time.warp = 0.5;
    }
    await heave(Math.min(1, steps.length / span), true);
    time.warp = 1;

    // ---- out it comes
    head.root.updateMatrixWorld(true);
    t.seat.getWorldPosition(socket);
    const rootDir = tY.clone();
    scene.attach(t.holder);
    t.alive = false;
    award.arcs(null, 0);
    award.burstOff();
    {
      // the socket's light dies away once the tooth has left it
      const b0 = look.beam;
      real.tween(0.5, (k) => { beam.uniforms.uPower.value = b0 * (1 - k); }).then(() => { auras.delete(beam); beam.dispose(); t.beam = null; });
    }
    ui.onLock(outcome.mult);
    sfx.pop();
    if (grand) sfx.boom(outcome.tier === 'mega' ? 1 : 0.7);
    stage.shake(0.04 * power);
    stage.impact(socket, { zoom: 0.45 * power, chroma: 0.55 * power });
    if (power >= 1) stage.shockwave(socket, 0.55 * power);
    if (grand) { stage.flash(0.07 * power); award.shockRing(socket, 3 + 2 * power); }
    head.kick({ pitch: -drag * 1.5 * Math.min(power, 1.5), y: drag * 0.9, z: -0.5, roll: rand(-0.6, 0.6) });
    head.pose.jaw.kick(upper ? 1.5 : -2.4);
    head.mech.spin += 4 * power;
    const won = steps.length > 0;
    fx.sparks.emit(socket, { count: Math.round(30 * power), speed: 3 * (0.7 + 0.3 * power), dir: rootDir, spread: 0.8, color: [3.2, 1.9, 0.55], life: 0.5 });
    fx.crumbs.emit(socket, { count: Math.round(10 * power), speed: 1.6, dir: rootDir, spread: 0.7, up: 0.3, scale: [0.4, 0.9] });
    fx.puffs.emit(socket, { count: 4, color: won ? 0xdccfb6 : 0x6c6f75, size: [0.05, 0.36], life: 0.8, alpha: 0.3, dir: rootDir, speed: 0.5 });
    if (won) fx.puffs.emit(socket, { count: 1, color: [3, 1.8, 0.6], size: [0.08, 0.3 + 0.3 * power], life: 0.2, alpha: 0.8, additive: true, speed: 0, jitter: 0 });

    addStump(t);
    const p0 = t.holder.position.clone(), q0 = t.holder.quaternion.clone();
    const pOut = p0.clone().addScaledVector(Yf, 0.78).addScaledVector(WORLD_UP, 0.06);
    const qOut = q0.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(Xf, -0.3));
    const apexLocal = V(...info.rootTip);
    const wireA = V(), wireB = V(), wireMid = V();
    let snapped = false;
    nerve.mesh.visible = true;
    hitStop(0.035 * Math.min(power, 1.6));
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
    // The camera crept in during the struggle: ease it back out (further for a
    // big win) so the tooth is shown in clear air in front of the head.
    const camShow = camPos.clone().addScaledVector(viewDir, grand ? 0.55 : 0);
    stage.flyTo(camShow, camTarget, 0.5);
    const cFwd = camTarget.clone().sub(camShow).normalize();
    const cRight = V().crossVectors(cFwd, WORLD_UP).normalize();
    const cUp = V().crossVectors(cRight, cFwd).normalize();
    const Yw = cRight.clone().multiplyScalar(0.5).addScaledVector(cUp, -0.82).addScaledVector(cFwd, -0.12).normalize();
    const Zw = cRight.clone().addScaledVector(Yw, -Yw.dot(cRight)).normalize();
    const Xw = V().crossVectors(Yw, Zw).normalize();
    const qShow = basisQuat(Xw, Yw, Zw).multiply(tool.quaternion.clone().invert());
    const gShow = camShow.clone().addScaledVector(cFwd, grand ? 2.0 : 2.25).addScaledVector(cRight, -0.12).addScaledVector(cUp, grand ? -0.04 : 0.1);
    const pShow = gShow.clone().sub(tool.position.clone().applyQuaternion(qShow));
    const p1 = t.holder.position.clone(), q1 = t.holder.quaternion.clone();
    await anim.tween(0.5, (k) => {
      t.holder.position.lerpVectors(p1, pShow, k);
      t.holder.quaternion.slerpQuaternions(q1, qShow, k);
    }, ease.inOutCubic);

    const toothPos = t.mesh.getWorldPosition(V());
    const showing = reveal(outcome, toothPos, cUp, ui.onReveal, t, t.mesh);
    // turn it in the light; a big winner is paraded for as long as the show runs
    const showTime = grand ? showLength(outcome) : outcome.tier === 'dud' ? 0.75 : 1.15;
    const swings = grand ? Math.round(showTime / 1.3) : 0.5;
    const turn = new THREE.Quaternion();
    await real.tween(showTime, (k) => {
      turn.setFromAxisAngle(cUp, Math.sin(k * Math.PI * 2 * swings) * (grand ? 0.75 : 0.5));
      t.holder.quaternion.copy(qShow).premultiply(turn);
      t.holder.position.copy(gShow).sub(_p.copy(tool.position).applyQuaternion(t.holder.quaternion));
    }, grand ? ease.linear : ease.inOutQuad);
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

    ui.onDone();
    settleDown();
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
  /** How long the full celebration runs for a big win, in seconds. */
  const showLength = (outcome) => (outcome.mult >= 50 ? 4.6 : outcome.tier === 'mega' ? 3.8 : 2.6);

  /**
   * Show what the target was worth. Resolves once the flourish has played.
   * `tooth` is the pulled tooth (if any); `anchor` an object the show follows.
   */
  async function reveal(outcome, pos, dir, onReveal, tooth = null, anchor = null) {
    onReveal(pos);
    const { tier } = outcome;
    const u = tooth && tooth.aura ? tooth.aura.uniforms : null;
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
    if (tier === 'big' || tier === 'mega') { await celebrate(outcome, pos, dir, tooth, anchor); return; }

    sfx.win(tier);
    const coins = { small: 3, win: 10 }[tier];
    fx.coins.emit(pos, { count: coins, speed: 2.6, dir: dir.clone().multiplyScalar(0.5).add(V(0, 0.9, 0.2)), spread: 0.7, up: 2.2, scale: [0.8, 1.2], life: 5 });
    sfx.coin(coins);
    fx.puffs.emit(pos, { count: 1, color: [2.4, 1.7, 0.6], size: [0.1, 0.7], life: 0.3, alpha: 0.5, additive: true, speed: 0, jitter: 0 });
    fx.sparks.emit(pos, { count: 12 + coins, speed: 3, color: [3.2, 2.2, 0.7], life: 0.6 });
    award.sparkle(pos, { count: tier === 'win' ? 10 : 4, radius: 0.45, life: 0.8 });
    if (tooth) {
      const mat = tooth.mesh.material;
      mat.emissive.set(TIER_GLOW[tier]);
      real.tween(1.4, (k) => { mat.emissiveIntensity = Math.sin(k * Math.PI) * (tier === 'small' ? 0.1 : 0.24); });
      // the heat fades; a modest winner keeps a soft shimmer
      if (u) {
        const h0 = u.uHeat.value, a0 = u.uAward.value;
        u.uPulse.value = 1;
        real.tween(0.9, (k) => { u.uHeat.value = h0 * (1 - k); u.uAward.value = a0 * (1 + 0.5 * Math.sin(k * Math.PI)); });
      }
    }
  }

  /** The full show for a big win: gold, sunburst, a fountain of coins, fireworks. */
  async function celebrate(outcome, pos, dir, tooth, anchor) {
    const mega = outcome.tier === 'mega', jackpot = outcome.mult >= 50;
    const dur = showLength(outcome);
    sfx.fanfare(jackpot ? 'jackpot' : outcome.tier);
    sfx.boom(mega ? 0.8 : 0.5);
    stage.flash(mega ? 0.2 : 0.12);
    stage.impact(pos, { zoom: mega ? 1 : 0.7, chroma: 1 });
    stage.shockwave(pos, mega ? 1.5 : 1);
    stage.spotlight(pos, mega ? 0.72 : 0.55);
    stage.glow(mega ? 0.12 : 0.07);
    stage.shake(mega ? 0.05 : 0.03);
    head.mech.power = mega ? 2.6 : 2;
    head.mech.spin += 10;
    award.shockRing(pos, mega ? 8 : 5.5);
    if (anchor) award.burstOn(anchor, { size: mega ? 3.3 : 2.5, prism: mega ? 1 : 0, back: tooth ? 0.5 : -0.35, power: tooth ? 1 : 0.7 });
    if (tooth) {
      // the tooth turns to gold, then light starts running over it
      const mat = tooth.mesh.material, c0 = mat.color.clone(), m0 = mat.metalness, r0 = mat.roughness;
      const u = tooth.aura ? tooth.aura.uniforms : null;
      const h0 = u ? u.uHeat.value : 0, a0 = u ? u.uAward.value : 0, p0 = u ? u.uPrism.value : 0, g0 = u ? u.uGlint.value : 0;
      if (u) u.uPulse.value = 1;
      real.tween(0.45, (k) => {
        mat.color.copy(c0).lerp(GOLD, k);
        mat.metalness = lerp(m0, 1, k);
        mat.roughness = lerp(r0, 0.2, k);
        if (u) {
          u.uHeat.value = h0 * (1 - k);
          u.uAward.value = lerp(a0, 1, k);
          u.uPrism.value = lerp(p0, mega ? 1 : 0, k);
          u.uGlint.value = lerp(g0, mega ? 1 : 0.6, k);
        }
      }, ease.outCubic);
    }
    if (mega) award.confetti(pos.clone().add(V(0, 0.4, 0)), jackpot ? 220 : 140, 3);

    const up = dir.clone().multiplyScalar(0.4).add(V(0, 1, 0.15));
    const hues = [[3.2, 1.2, 2.2], [1.2, 2.6, 3.4], [3.4, 2.6, 0.8], [1.6, 3.2, 1.4]];
    let ticks = 0, bursts = 0;
    await real.tween(dur, (k) => {
      // a steady fountain of coins and stars for as long as the show runs
      const due = Math.floor((k * dur) / 0.085);
      while (ticks < due) {
        ticks++;
        fx.coins.emit(pos, { count: Math.round((mega ? 4 : 2) * (1 - k * 0.6)) + 1, speed: mega ? 3.6 : 2.9, dir: up, spread: 0.75, up: 2.4, scale: [0.8, 1.25], life: 4.5 });
        award.sparkle(pos, {
          count: mega ? 3 : 2, radius: mega ? 1.0 : 0.7, size: [0.06, mega ? 0.3 : 0.22], life: 0.9,
          color: mega && ticks % 2 ? [1.5, 1.8, 2.2] : [2, 1.6, 0.8],
        });
        if (ticks % 5 === 0) sfx.coin(5);
      }
      // fireworks for the very big ones
      if (mega && bursts < 6 && k * dur > 0.5 + bursts * 0.55) {
        const hue = hues[bursts % 4];
        const at = pos.clone().add(V(rand(-1.5, 1.5), rand(0.1, 1.1), rand(-0.6, 0.3)));
        bursts++;
        fx.sparks.emit(at, { count: 44, speed: 3.2, color: hue, life: 0.9 });
        fx.puffs.emit(at, { count: 1, color: hue.map((c) => c * 0.5), size: [0.1, 0.7], life: 0.22, alpha: 0.6, additive: true, speed: 0, jitter: 0 });
        award.sparkle(at, { count: 8, radius: 0.5, size: [0.08, 0.26], life: 0.8, color: hue });
        sfx.shimmer(6, 0.5);
        if (bursts === 2) stage.shockwave(pos, 1.1);
      }
    }, ease.linear);

    award.burstOff();
    stage.spotlight(null, 0);
    stage.glow(0);
    if (tooth && tooth.aura) {
      const u = tooth.aura.uniforms;
      real.tween(0.6, (k) => { u.uAward.value = lerp(1, 0.35, k); u.uGlint.value *= 1 - 0.5 * k; });
    }
  }

  // ====================================================================== REBUILD
  /** Refit every missing tooth and broken lens. `all` replays the full intro. */
  async function rebuild({ all = false } = {}) {
    debris.clear();
    fx.clear();
    award.clear();
    settleDown();
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
      if (t.matOrig) { mat.color.copy(t.matOrig.color); mat.metalness = t.matOrig.metalness; mat.roughness = t.matOrig.roughness; }
      if (t.aura) { auras.delete(t.aura); t.aura.dispose(); t.aura = null; }
      if (t.beam) { auras.delete(t.beam); t.beam.dispose(); t.beam = null; }
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
    for (const a of auras) {
      a.uniforms.uTime.value += dt;
      if (a.uniforms.uPulse) a.uniforms.uPulse.value *= Math.exp(-dt * 5);
    }
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
