import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { revolve, ringProfile, gearGeometry, boltGeometry, FlexTube, Piston } from './geom.js';
import { FLOOR_Y, HEAD_PIVOT, HINGE, POLY } from './layout.js';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Lay a revolved (around +Z) geometry so its axis runs from a to b. */
function alongAxis(mesh, a, b) {
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(Z, b.clone().sub(a).normalize());
  return mesh;
}

function boltField(list, mat, parent, radius = 0.021) {
  const mesh = new THREE.InstancedMesh(boltGeometry(radius), mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), n = new THREE.Vector3();
  list.forEach((b, i) => {
    n.set(...b.n).normalize();
    p.set(...b.p).addScaledVector(n, -0.006);
    q.setFromUnitVectors(Z, n);
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildMechanics({ mats, manifest, root, skull, jaw, jawPivot }) {
  const neck = new THREE.Group();
  neck.name = 'neck-assembly';
  root.add(neck);
  const FY = FLOOR_Y;
  const upright = (mesh, x, y, z) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    return mesh;
  };

  // ------------------------------------------------------------ collar base
  const collar = new THREE.Mesh(
    revolve(
      [[0.5, 0], [0.82, 0], [0.85, 0.03], [0.85, 0.085], [0.75, 0.14], [0.65, 0.31], [0.61, 0.335], [0.565, 0.31],
        [0.565, 0.13], [0.5, 0.09], [0.5, 0]],
      72,
    ),
    mats.collar,
  );
  upright(collar, 0, FY + 0.002, -0.2);
  collar.scale.set(1, 0.92, 1);
  collar.renderOrder = 1;
  neck.add(collar);

  const plate = new THREE.Mesh(
    revolve([[0, 0.02], [0.5, 0.02], [0.5, 0.075], [0.46, 0.1], [0.14, 0.1], [0.14, 0.13], [0, 0.13]], 56),
    mats.gunmetal,
  );
  upright(plate, 0, FY, -0.2);
  plate.scale.set(1, 0.92, 1);
  plate.castShadow = true;
  const trim = new THREE.Mesh(revolve(ringProfile(0.565, 0.6, 0.31, 0.345, 0.006), 72), mats.gold);
  upright(trim, 0, FY, -0.2);
  trim.scale.set(1, 0.92, 1);
  neck.add(plate, trim);

  const collarBolts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    collarBolts.push({ p: [Math.cos(a) * 0.79, FY + 0.09, -0.2 + Math.sin(a) * 0.79 * 0.92], n: [0, 1, 0] });
  }
  boltField(collarBolts, mats.gold, neck, 0.026);

  // ------------------------------------------------------------ spine column
  const spineA = new THREE.Vector3(0, FY + 0.12, -0.2);
  const spineB = new THREE.Vector3(HEAD_PIVOT[0], HEAD_PIVOT[1] - 0.06, HEAD_PIVOT[2]);
  const spineLen = spineA.distanceTo(spineB);
  const spine = new THREE.Group();
  spine.name = 'neck-spine';
  alongAxis(spine, spineA, spineB);
  neck.add(spine);
  const rod = new THREE.Mesh(revolve([[0, 0], [0.05, 0], [0.05, spineLen], [0, spineLen]], 24), mats.chrome);
  spine.add(rod);
  const sleeveGeo = revolve(ringProfile(0.05, 0.092, 0, 0.12, 0.012), 32);
  const flangeGeo = revolve(ringProfile(0.05, 0.122, 0, 0.03, 0.006), 36);
  const discGeo = revolve(ringProfile(0.05, 0.075, 0, 0.022, 0.004), 28);
  const NV = 7;
  for (let i = 0; i < NV; i++) {
    const z0 = 0.04 + (i / NV) * (spineLen - 0.1);
    const sleeve = new THREE.Mesh(sleeveGeo, mats.black);
    sleeve.position.z = z0;
    const flange = new THREE.Mesh(flangeGeo, i % 2 ? mats.gold : mats.steel);
    flange.position.z = z0 + 0.125;
    const disc = new THREE.Mesh(discGeo, mats.chrome);
    disc.position.z = z0 + 0.165;
    for (const m of [sleeve, flange, disc]) { m.castShadow = true; spine.add(m); }
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 28, 20), mats.chrome);
  ball.position.set(...HEAD_PIVOT);
  ball.castShadow = true;
  neck.add(ball);

  // ------------------------------------------------------------ throat tube
  const throatA = new THREE.Vector3(0, FY + 0.1, 0.08), throatB = new THREE.Vector3(0, -1.44, 0.10);
  const throatLen = throatA.distanceTo(throatB);
  const throat = new THREE.Group();
  throat.name = 'telescopic-throat';
  alongAxis(throat, throatA, throatB);
  neck.add(throat);
  const tube = new THREE.Mesh(
    revolve([[0.075, 0.1], [0.095, 0.1], [0.095, throatLen - 0.04], [0.075, throatLen - 0.04], [0.075, 0.1]], 36),
    mats.lens,
  );
  const throatGlowMat = mats.glowAmber.clone();
  const throatGlow = new THREE.Mesh(revolve([[0, 0.05], [0.022, 0.05], [0.022, throatLen - 0.02], [0, throatLen - 0.02]], 14), throatGlowMat);
  throat.add(tube, throatGlow);
  const capGeo = revolve(ringProfile(0.0, 0.108, 0, 0.05, 0.01), 36);
  let throatTopCap;
  for (const z of [0.06, throatLen - 0.06]) {
    const cap = new THREE.Mesh(capGeo, mats.gold);
    cap.position.z = z;
    cap.castShadow = true;
    throat.add(cap);
    if (z > 0.06) throatTopCap = cap;
  }
  const throatBands = [];
  for (const z of [throatLen * 0.4, throatLen * 0.72]) {
    const band = new THREE.Mesh(revolve(ringProfile(0.094, 0.104, 0, 0.024, 0.004), 36), mats.gunmetal);
    band.position.z = z;
    throat.add(band);
    throatBands.push(band);
  }

  // ------------------------------------------------------------ glass neck shields
  const neckShroud = new THREE.Group();
  neckShroud.name = 'sliding-neck-shroud';
  neck.add(neckShroud);
  for (const s of [-1, 1]) {
    const shield = new THREE.Mesh(
      revolve(
        [[0.555, 0.3], [0.585, 0.3], [0.38, 0.85], [0.23, 1.08], [0.20, 1.08], [0.35, 0.85], [0.555, 0.3]],
        28, { start: s > 0 ? -0.62 : Math.PI - 0.62, arc: 1.24, smooth: true },
      ),
      mats.collar,
    );
    upright(shield, 0, FY, -0.42);
    shield.name = 'neck-side-shield';
    shield.scale.set(1, 0.92, 1);
    shield.renderOrder = 1;
    neckShroud.add(shield);
    const rail = new THREE.Mesh(
      revolve(ringProfile(0.195, 0.24, 1.07, 1.10, 0.004), 20, { start: s > 0 ? -0.66 : Math.PI - 0.66, arc: 1.32 }),
      mats.gold,
    );
    upright(rail, 0, FY, -0.42);
    rail.name = 'neck-shield-rim';
    rail.scale.set(1, 0.92, 1);
    neckShroud.add(rail);
  }

  // ------------------------------------------------------------ skull base plate
  const basePlate = new THREE.Mesh(
    revolve([[0.115, 0], [0.385, 0], [0.385, 0.03], [0.34, 0.045], [0.16, 0.045], [0.115, 0.08], [0.115, 0]], 56),
    mats.gunmetal,
  );
  upright(basePlate, HEAD_PIVOT[0], -0.4, HEAD_PIVOT[2]);
  const baseTrim = new THREE.Mesh(revolve(ringProfile(0.35, 0.392, -0.008, 0.012, 0.004), 56), mats.gold);
  upright(baseTrim, HEAD_PIVOT[0], -0.4, HEAD_PIVOT[2]);
  skull.add(basePlate, baseTrim);

  // ------------------------------------------------------------ core gimbal
  const coreC = new THREE.Vector3(0, 0.47, -0.18);
  const pylon = new THREE.Mesh(revolve([[0, 0], [0.026, 0], [0.026, 1], [0, 1]], 14), mats.chrome);
  const pylonA = new THREE.Vector3(0, -0.36, -0.2), pylonB = new THREE.Vector3(0, 0.13, -0.18);
  alongAxis(pylon, pylonA, pylonB);
  pylon.scale.z = pylonA.distanceTo(pylonB);
  skull.add(pylon);
  const cradle = new THREE.Mesh(revolve([[0.02, 0], [0.09, 0], [0.11, 0.03], [0.11, 0.05], [0.02, 0.05], [0.02, 0]], 32), mats.gold);
  upright(cradle, 0, 0.11, -0.18);
  skull.add(cradle);

  const gimbal = new THREE.Group();
  gimbal.position.copy(coreC);
  skull.add(gimbal);
  const rings = [];
  let parentRing = gimbal;
  [[0.3, mats.gold], [0.25, mats.steel], [0.2, mats.gold]].forEach(([r, mat], i) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 10, 72), mat);
    g.add(ring);
    // two little pivot studs where this ring hangs in the next one out
    for (const s of [-1, 1]) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mats.chrome);
      stud.position.set(i % 2 ? 0 : s * r, i % 2 ? s * r : 0, 0);
      g.add(stud);
    }
    parentRing.add(g);
    parentRing = g;
    rings.push(g);
  });
  const crystalMat = mats.glowAmber.clone();
  const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 0), crystalMat);
  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0xd9a84e, metalness: 1, roughness: 0.3, wireframe: true }),
  );
  parentRing.add(crystal, cage);
  const coreLight = new THREE.PointLight(0xffb060, 1.6, 2.2, 1.6);
  gimbal.add(coreLight);

  // ------------------------------------------------------------ inner frame
  const arc = (fn, a0, a1) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(fn(a0 + ((a1 - a0) * i) / 40));
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.015, 8), mats.gunmetal);
  };
  const cy = 0.42, cz = -0.16;
  skull.add(
    arc((a) => new THREE.Vector3(0, cy + 0.6 * Math.sin(a), cz + 0.8 * Math.cos(a)), 0.12, Math.PI + 0.42),
    arc((a) => new THREE.Vector3(0.6 * Math.cos(a), cy + 0.6 * Math.sin(a), cz), -0.5, Math.PI + 0.5),
  );
  for (const p of [[0, cy + 0.6, cz], [0.6, cy, cz], [-0.6, cy, cz], [0, cy, cz - 0.8]]) {
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), mats.gold);
    node.position.set(...p);
    skull.add(node);
  }

  // ------------------------------------------------------------ temple gears
  const gearMain = gearGeometry({ teeth: 24, ro: 0.19, depth: 0.028 });
  const tDepth = 0.19 * 0.13;
  const module_ = (2 * (0.19 - tDepth / 2)) / 24;
  const mkPinion = (teeth) => {
    const pr = (module_ * teeth) / 2;
    return { geo: gearGeometry({ teeth, ro: pr + tDepth / 2, depth: 0.03, toothDepth: tDepth, spokes: 0, hub: 0.05 }), pr, teeth };
  };
  const pinA = mkPinion(9), pinB = mkPinion(13);
  const backGeo = revolve([[0, -0.03], [0.215, -0.03], [0.215, -0.018], [0, -0.018]], 48);
  const hubGeo = revolve([[0, 0.014], [0.045, 0.014], [0.045, 0.03], [0.03, 0.04], [0, 0.04]], 24);
  const sensorBezel = new THREE.TorusGeometry(0.085, 0.014, 10, 48);
  const sensorDisc = new THREE.CircleGeometry(0.08, 40);
  const sensorDot = new THREE.CircleGeometry(0.018, 20);
  const temples = [];
  const templeGlow = mats.glowWhite.clone();
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.5, 0.06, -0.12);
    g.rotation.y = (s * Math.PI) / 2; // +Z points out of the temple
    skull.add(g);
    const main = new THREE.Mesh(gearMain, mats.brass);
    const back = new THREE.Mesh(backGeo, mats.gunmetal);
    const hub = new THREE.Mesh(hubGeo, mats.chrome);
    g.add(main, back, hub);
    const pinions = [];
    const prMain = 0.19 - tDepth / 2;
    for (const [pin, phi] of [[pinA, 0.9], [pinB, 3.6]]) {
      const m = new THREE.Mesh(pin.geo, mats.steel);
      const dist = prMain + pin.pr + 0.002;
      m.position.set(Math.cos(phi) * dist, Math.sin(phi) * dist, 0.002);
      const cap = new THREE.Mesh(hubGeo, mats.gold);
      cap.scale.setScalar(0.6);
      cap.position.copy(m.position);
      g.add(m, cap);
      pinions.push({ mesh: m, phi, ratio: 24 / pin.teeth, step: (Math.PI * 2) / pin.teeth });
    }
    // sensor pod on the outside of the shell
    const pod = new THREE.Group();
    pod.position.z = 0.158;
    const bez = new THREE.Mesh(sensorBezel, mats.chrome);
    const disc = new THREE.Mesh(sensorDisc, mats.black);
    disc.position.z = 0.004;
    const dot = new THREE.Mesh(sensorDot, templeGlow);
    dot.position.z = 0.006;
    pod.add(bez, disc, dot);
    g.add(pod);
    temples.push({ main, pinions, s });
  }

  // ------------------------------------------------------------ jaw hinge + actuators
  const hingeGeo = revolve([[0, -0.02], [0.088, -0.02], [0.088, 0.012], [0.07, 0.024], [0.03, 0.024], [0.03, 0.034], [0, 0.034]], 36);
  const jawPistons = [];
  const jawGuides = [];
  const carriageGeo = new RoundedBoxGeometry(0.05, 0.17, 0.075, 2, 0.012);
  for (const s of [-1, 1]) {
    // Twin telescoping guide rods carry the hinge forward; the axle rotates
    // inside the carriage while the carriage itself follows the skull frame.
    const carriage = new THREE.Group();
    carriage.name = `jaw-hinge-carriage-${s}`;
    skull.add(carriage);
    const block = new THREE.Mesh(carriageGeo, mats.gunmetal);
    block.position.x = s * 0.624;
    carriage.add(block);
    for (const dy of [-0.057, 0.057]) {
      const guide = new Piston(mats, { radius: 0.012, sleeve: 0.16, sleeveMat: mats.steel });
      guide.group.name = `jaw-hinge-guide-${s}-${dy}`;
      root.add(guide.group);
      jawGuides.push({ p: guide, a: new THREE.Vector3(s * 0.624, HINGE.y + dy, HINGE.z - 0.19), b: new THREE.Vector3(s * 0.624, dy, 0), carriage });
      const fastener = new THREE.Mesh(boltGeometry(0.009), mats.brass);
      fastener.rotation.y = s * Math.PI / 2;
      fastener.position.set(s * 0.654, dy, 0.01);
      carriage.add(fastener);
    }
    const hinge = new THREE.Mesh(hingeGeo, mats.brass);
    hinge.position.set(s * 0.645, HINGE.y, HINGE.z);
    hinge.rotation.y = (s * Math.PI) / 2;
    hinge.castShadow = true;
    jaw.add(hinge);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 6), mats.chrome);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(s * 0.67, HINGE.y, HINGE.z);
    jaw.add(pin);
    const p = new Piston(mats, { radius: 0.022, sleeve: 0.34 });
    p.group.name = `jaw-actuator-${s}`;
    root.add(p.group);
    jawPistons.push({ p, a: new THREE.Vector3(s * 0.5, -0.25, 0.34), b: new THREE.Vector3(s * 0.525, -0.93, 0.1) });
  }

  // ------------------------------------------------------------ neck pistons
  const neckPistons = [];
  for (const [x, z0, z1] of [[0.16, -0.27, -0.21], [-0.16, -0.27, -0.21], [0.22, -0.5, -0.46], [-0.22, -0.5, -0.46]]) {
    const p = new Piston(mats, { radius: 0.031, sleeve: 0.82, sleeveMat: mats.gunmetal });
    p.group.name = `neck-actuator-${neckPistons.length}`;
    root.add(p.group);
    neckPistons.push({ p, a: new THREE.Vector3(x, FY + 0.13, z0), b: new THREE.Vector3(x * 0.78, -0.4, z1) });
  }

  // ------------------------------------------------------------ cable bundles
  const cableMats = [mats.cableRed, mats.cableAmber, mats.cableIvory, mats.cableTeal];
  const bundles = [];
  for (const [bx, bz, lean] of [[-0.36, -0.42, -1], [0, -0.62, 0], [0.36, -0.42, 1]]) {
    const cables = [];
    for (let i = 0; i < 4; i++) {
      const tubeMesh = new FlexTube(cableMats[(i + (lean + 1)) % 4], { radius: 0.026, segments: 30, radial: 8 });
      tubeMesh.mesh.castShadow = true;
      root.add(tubeMesh.mesh);
      const a = (i / 4) * Math.PI * 2 + 0.6;
      cables.push({ tube: tubeMesh, ox: Math.cos(a) * 0.04, oz: Math.sin(a) * 0.04 });
    }
    const clampGeo = new THREE.TorusGeometry(0.074, 0.016, 8, 24);
    const clamps = [0.3, 0.66].map((u) => {
      const c = new THREE.Mesh(clampGeo, mats.rubber);
      root.add(c);
      return { mesh: c, u };
    });
    bundles.push({
      cables, clamps,
      // fixed in the world
      p0: new THREE.Vector3(bx, FY + 0.1, bz),
      p1: new THREE.Vector3(bx * 1.12, -1.55, bz - 0.2 + Math.abs(lean) * 0.06),
      // riding on the skull
      s2: new THREE.Vector3(bx * 0.86, -0.62, bz - 0.12),
      s3: new THREE.Vector3(bx * 0.6, -0.3, bz + 0.1),
      pts: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      centre: new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3()], false, 'centripetal'),
    });
  }

  // ------------------------------------------------------------ fasteners + palate
  boltField(manifest.bolts, mats.steel, skull);
  boltField(manifest.jawBolts, mats.gold, jaw, 0.024);

  const palateShape = new THREE.Shape();
  const inset = POLY.upperArch.map(([x, z]) => {
    const l = Math.hypot(x, z - 0.2) || 1;
    return [x - (x / l) * 0.075, z - ((z - 0.2) / l) * 0.075];
  });
  inset.forEach(([x, z], i) => (i ? palateShape.lineTo(x, z) : palateShape.moveTo(x, z)));
  for (let i = inset.length - 1; i >= 0; i--) palateShape.lineTo(-inset[i][0], inset[i][1]);
  palateShape.closePath();
  const vent = new THREE.Path();
  vent.absellipse(0, 0.42, 0.09, 0.14, 0, Math.PI * 2, true);
  palateShape.holes.push(vent);
  const palate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(palateShape, { depth: 0.022, bevelEnabled: false, curveSegments: 16 }).rotateX(Math.PI / 2),
    mats.gunmetal,
  );
  palate.position.y = -0.5;
  skull.add(palate);

  // ------------------------------------------------------------ per-frame
  const wa = new THREE.Vector3(), wb = new THREE.Vector3(), tan = new THREE.Vector3();
  let gearAngle = 0;
  const mech = {
    neck, neckPistons, jawPistons, jawGuides, gimbal, crystal, crystalMat, coreLight, templeGlow, throatGlowMat,
    spin: 0, // extra gear speed, decays on its own
    power: 1, // overall glow level of the core

    update(dt, clock, head) {
      const shroudRetraction = THREE.MathUtils.smoothstep(head.jawPivot.rotation.x
        + Math.max(0, head.pivot.rotation.x) * 1.5 + Math.abs(head.pivot.rotation.y) * 0.15, 0.08, 0.6);
      neckShroud.position.y = -0.28 * shroudRetraction;
      root.updateMatrixWorld(true);

      // Retract the illuminated throat cartridge below the chin's swept path.
      // End fittings keep their dimensions; only the telescoping tube changes length.
      jaw.localToWorld(wa.set(0, -1.22, 0.70));
      throatB.y = Math.min(-1.44, wa.y - 0.14);
      throatB.y = Math.max(FY + 0.31, throatB.y);
      const length = throatA.distanceTo(throatB);
      alongAxis(throat, throatA, throatB);
      tube.scale.z = (length - 0.14) / (throatLen - 0.14);
      tube.position.z = 0.1 * (1 - tube.scale.z);
      throatGlow.scale.z = (length - 0.07) / (throatLen - 0.07);
      throatGlow.position.z = 0.05 * (1 - throatGlow.scale.z);
      throatTopCap.position.z = length - 0.06;
      throatBands.forEach((band, i) => { band.position.z = length * (i ? 0.72 : 0.4); });

      // gears: idle tick plus whatever the head is doing
      const drive = 0.35 + mech.spin + Math.abs(head.pose.yaw.v) * 4 + Math.abs(head.pose.jaw.v) * 6;
      mech.spin *= Math.exp(-dt * 1.6);
      gearAngle += dt * drive;
      for (const t of temples) {
        const th = gearAngle * t.s;
        t.main.rotation.z = th;
        const stepM = (Math.PI * 2) / 24;
        for (const p of t.pinions) {
          p.mesh.rotation.z = p.phi + Math.PI - (th - (p.phi - 0.5 * stepM)) * p.ratio;
        }
      }
      rings[0].rotation.x = clock * 0.55;
      rings[1].rotation.y = clock * 0.8 + 1;
      rings[2].rotation.x = clock * 1.15 + 2;
      crystal.rotation.set(clock * 0.4, clock * 0.6, 0);
      const pulse = mech.power * (0.82 + 0.18 * Math.sin(clock * 1.7));
      crystalMat.color.setRGB(2.6 * pulse, 1.2 * pulse, 0.25 * pulse);
      coreLight.intensity = 1.6 * pulse;
      const tp = 0.7 + 0.3 * Math.sin(clock * 2.6);
      throatGlowMat.color.setRGB(2.4 * tp * mech.power, 1.05 * tp * mech.power, 0.2 * tp * mech.power);
      const blink = (Math.sin(clock * 3.1) > 0.2 ? 1 : 0.25) * mech.power;
      templeGlow.color.setRGB(2.2 * blink, 2.3 * blink, 2.5 * blink);

      for (const n of neckPistons) n.p.set(n.a, skull.localToWorld(wb.copy(n.b)));
      for (const j of jawPistons) j.p.set(skull.localToWorld(wa.copy(j.a)), jaw.localToWorld(wb.copy(j.b)));
      for (const guide of jawGuides) {
        guide.carriage.position.copy(jawPivot.position);
        guide.p.set(skull.localToWorld(wa.copy(guide.a)), skull.localToWorld(wb.copy(guide.b).add(jawPivot.position)));
      }

      for (const b of bundles) {
        skull.localToWorld(wa.copy(b.s2));
        skull.localToWorld(wb.copy(b.s3));
        for (const c of b.cables) {
          b.pts[0].set(b.p0.x + c.ox, b.p0.y, b.p0.z + c.oz);
          b.pts[1].set(b.p0.x + c.ox, b.p0.y + 0.22, b.p0.z + c.oz);
          b.pts[2].set(b.p1.x + c.ox, b.p1.y, b.p1.z + c.oz);
          b.pts[3].set(wa.x + c.ox, wa.y, wa.z + c.oz);
          b.pts[4].set(wb.x + c.ox * 0.6, wb.y, wb.z + c.oz * 0.6);
          c.tube.fit(b.pts);
        }
        b.pts[0].copy(b.p0); b.pts[1].set(b.p0.x, b.p0.y + 0.22, b.p0.z); b.pts[2].copy(b.p1);
        b.pts[3].copy(wa); b.pts[4].copy(wb);
        b.centre.points = b.pts;
        for (const cl of b.clamps) {
          b.centre.getPoint(cl.u, cl.mesh.position);
          b.centre.getTangent(cl.u, tan);
          cl.mesh.quaternion.setFromUnitVectors(Z, tan);
        }
      }
    },
  };
  void UP;
  return mech;
}
