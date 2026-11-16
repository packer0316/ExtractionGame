import * as THREE from 'three';
import { revolve, ringProfile } from '../model/geom.js';

/** Tube along a polyline with a radius per control point (smoothed). */
function taperTube(points, radii, { segments = 28, radial = 12 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos = [], nrm = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3(1, 0, 0), b = new THREE.Vector3();
  const rad = (u) => {
    const f = u * (radii.length - 1);
    const i = Math.min(Math.floor(f), radii.length - 2);
    const k = f - i;
    return radii[i] + (radii[i + 1] - radii[i]) * (k * k * (3 - 2 * k));
  };
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPoint(u, p);
    curve.getTangent(u, t);
    n.sub(b.copy(t).multiplyScalar(n.dot(t))).normalize();
    b.crossVectors(t, n);
    const r = rad(u);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = n.x * c + b.x * s, ny = n.y * c + b.y * s, nz = n.z * c + b.z * s;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, c = a + radial + 1;
      idx.push(a, a + 1, c, c, a + 1, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Hammer. Local space: the hand grips at the origin, the handle runs up +Y,
 * the head sits at y = reach with its striking face towards +Z.
 */
export function createHammer(mats) {
  const group = new THREE.Group();
  const reach = 1.32;
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.9, roughness: 0.5 });
  // brushed rather than mirror steel, so it does not blow out next to the camera
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8f97a3, metalness: 1, roughness: 0.3, envMapIntensity: 0.8 });

  const head = new THREE.Mesh(
    revolve(
      [[0, -0.27], [0.105, -0.27], [0.128, -0.25], [0.128, -0.16], [0.104, -0.135], [0.104, 0.135], [0.128, 0.16], [0.128, 0.25],
        [0.105, 0.27], [0, 0.27]],
      40,
    ),
    headMat,
  );
  head.position.y = reach;
  group.add(head);
  for (const z of [-0.128, 0.105]) {
    const band = new THREE.Mesh(revolve(ringProfile(0.1, 0.112, 0, 0.023, 0.004), 40), mats.gold);
    band.position.set(0, reach, z);
    group.add(band);
  }
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.24, 20), mats.gold);
  eye.position.y = reach;
  group.add(eye);

  // handle: turned shaft with a ribbed rubber grip
  const shaft = new THREE.Mesh(
    revolve([[0, 0.02], [0.03, 0.02], [0.033, 0.5], [0.028, reach - 0.1], [0.04, reach - 0.04], [0, reach - 0.04]], 20, { smooth: true }),
    steelDark,
  );
  shaft.rotation.x = -Math.PI / 2;
  group.add(shaft);
  const gripProfile = [[0, 0], [0.036, 0], [0.044, 0.02]];
  for (let i = 0; i < 9; i++) {
    const z = 0.04 + i * 0.048;
    gripProfile.push([0.046, z], [0.046, z + 0.03], [0.04, z + 0.036], [0.04, z + 0.042]);
  }
  gripProfile.push([0.044, 0.49], [0.034, 0.52], [0, 0.52]);
  const grip = new THREE.Mesh(revolve(gripProfile, 22), mats.rubber);
  grip.rotation.x = -Math.PI / 2;
  group.add(grip);
  const pommel = new THREE.Mesh(revolve(ringProfile(0, 0.05, -0.03, 0.006, 0.01), 22), mats.gold);
  pommel.rotation.x = -Math.PI / 2;
  const ferrule = new THREE.Mesh(revolve(ringProfile(0.03, 0.046, 0.52, 0.56, 0.006), 22), mats.gold);
  ferrule.rotation.x = -Math.PI / 2;
  group.add(pommel, ferrule);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.visible = false;
  return { group, reach, faceOffset: 0.27 };
}

/**
 * Extraction forceps. Local space: the tooth crown is gripped at the origin,
 * the tool runs away from it along +Y and the two beaks close along Z.
 */
export function createForceps(mats) {
  const group = new THREE.Group();
  const jointY = 0.36;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  const arm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.y = jointY;
    // beak on +side, handle crossing over to -side
    const beak = new THREE.Mesh(
      taperTube(
        [V(0, 0, 0), V(0, -0.12, 0.062 * side), V(0, -0.27, 0.07 * side), V(0, -0.36, 0.045 * side), V(0, -0.395, 0.03 * side)],
        [0.034, 0.03, 0.024, 0.017, 0.011],
        { segments: 22, radial: 12 },
      ),
      mats.toolSteel,
    );
    const handle = new THREE.Mesh(
      taperTube(
        [V(0, 0, 0), V(0, 0.16, -0.045 * side), V(0, 0.5, -0.1 * side), V(0, 0.88, -0.12 * side), V(0, 0.96, -0.1 * side)],
        [0.034, 0.03, 0.031, 0.036, 0.026],
        { segments: 26, radial: 12 },
      ),
      mats.toolSteel,
    );
    // knurled grip sleeve
    const sleeve = new THREE.Mesh(
      taperTube([V(0, 0.52, -0.102 * side), V(0, 0.7, -0.113 * side), V(0, 0.86, -0.12 * side)], [0.038, 0.04, 0.038], { segments: 10, radial: 14 }),
      mats.rubber,
    );
    const ringGeo = new THREE.TorusGeometry(0.041, 0.006, 6, 18);
    for (const y of [0.5, 0.88]) {
      const r = new THREE.Mesh(ringGeo, mats.gold);
      r.position.set(0, y, (y < 0.6 ? -0.1 : -0.12) * side);
      r.rotation.x = Math.PI / 2;
      pivot.add(r);
    }
    pivot.add(beak, handle, sleeve);
    group.add(pivot);
    return pivot;
  };
  const a = arm(1), b = arm(-1);

  const joint = new THREE.Mesh(
    revolve([[0, -0.045], [0.05, -0.045], [0.056, -0.038], [0.056, 0.038], [0.05, 0.045], [0, 0.045]], 24),
    mats.steel,
  );
  joint.rotation.y = Math.PI / 2;
  joint.position.y = jointY;
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 6), mats.gold);
  pin.rotation.z = Math.PI / 2;
  pin.position.y = jointY;
  group.add(joint, pin);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.visible = false;

  const tool = {
    group,
    open: 0,
    /** 0 = beaks touching, 1 = wide open */
    setOpen(k) {
      tool.open = k;
      const phi = k * 0.3;
      a.rotation.x = -phi;
      b.rotation.x = phi;
    },
    /** Opening value that just pinches something `thickness` across. */
    gripFor(thickness) {
      return THREE.MathUtils.clamp((thickness * 0.5 - 0.02) / (0.395 * 0.3), 0, 1);
    },
  };
  tool.setOpen(1);
  return tool;
}
