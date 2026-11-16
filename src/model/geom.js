import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Surface of revolution around +Z.
 * profile: [[radius, z], ...] walked with the solid on the LEFT (counter-clockwise
 * in the radius/z plane) so normals point outwards. Hard edges by default.
 */
export function revolve(profile, segs = 48, { smooth = false, start = 0, arc = Math.PI * 2 } = {}) {
  const pos = [], nrm = [], idx = [];
  const n = profile.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0], dz = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dz) || 1;
    segN.push([dz / l, -dr / l]);
  }
  const pointN = profile.map((_, i) => {
    const a = segN[Math.max(i - 1, 0)], b = segN[Math.min(i, n - 2)];
    const x = a[0] + b[0], z = a[1] + b[1];
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  });
  for (let i = 0; i < n - 1; i++) {
    const base = pos.length / 3;
    for (let k = 0; k < 2; k++) {
      const p = profile[i + k];
      const pn = smooth ? pointN[i + k] : segN[i];
      for (let s = 0; s <= segs; s++) {
        const a = start + (s / segs) * arc;
        const c = Math.cos(a), sn = Math.sin(a);
        pos.push(p[0] * c, p[0] * sn, p[1]);
        nrm.push(pn[0] * c, pn[0] * sn, pn[1]);
      }
    }
    for (let s = 0; s < segs; s++) {
      const A = base + s, B = base + s + 1, D = base + segs + 1 + s, C = D + 1;
      idx.push(A, B, D, B, C, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Closed ring cross-section helper: rectangle profile between two radii. */
export function ringProfile(r0, r1, z0, z1, chamfer = 0) {
  const c = chamfer;
  if (c <= 0) return [[r0, z0], [r1, z0], [r1, z1], [r0, z1], [r0, z0]];
  return [
    [r0, z0], [r1 - c, z0], [r1, z0 + c], [r1, z1 - c], [r1 - c, z1], [r0, z1], [r0, z0],
  ];
}

/** Spur gear lying in the XY plane, centred on Z. */
export function gearGeometry({ teeth = 24, ro = 0.2, depth = 0.03, toothDepth = ro * 0.13, hub = ro * 0.22, spokes = 5 }) {
  const rr = ro - toothDepth;
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [rr, a], [rr, a + step * 0.18], [ro, a + step * 0.34], [ro, a + step * 0.66], [rr, a + step * 0.82],
    ];
    pts.forEach(([r, ang], k) => {
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const bore = new THREE.Path();
  bore.absarc(0, 0, hub * 0.45, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  if (spokes > 0) {
    const r0 = hub * 1.25, r1 = rr * 0.8;
    const gap = 0.16;
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * Math.PI * 2 + gap, a1 = ((i + 1) / spokes) * Math.PI * 2 - gap;
      const h = new THREE.Path();
      h.absarc(0, 0, r1, a0, a1, false);
      h.absarc(0, 0, r0, a1 - gap * 0.5, a0 + gap * 0.5, true);
      h.closePath();
      shape.holes.push(h);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: depth * 0.14, bevelSize: Math.min(0.004, toothDepth * 0.15),
    bevelSegments: 1, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Hex bolt on a washer, standing along +Z with its base at the origin. */
export function boltGeometry(r = 0.022) {
  const washer = new THREE.CylinderGeometry(r * 1.45, r * 1.5, r * 0.3, 20).rotateX(Math.PI / 2).translate(0, 0, r * 0.15);
  const head = new THREE.CylinderGeometry(r * 0.92, r, r * 0.75, 6).rotateX(Math.PI / 2).translate(0, 0, r * 0.3 + r * 0.375);
  const cap = new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.12, 12).rotateX(Math.PI / 2).translate(0, 0, r * 1.1);
  return mergeGeometries([washer.toNonIndexed(), head.toNonIndexed(), cap.toNonIndexed()]);
}

/**
 * A tube whose spine can be re-fitted every frame without allocating.
 * Control points are smoothed with a Catmull-Rom spline.
 */
export class FlexTube {
  constructor(material, { radius = 0.02, segments = 28, radial = 8 } = {}) {
    this.radius = radius; this.segments = segments; this.radial = radial;
    const vc = (segments + 1) * (radial + 1);
    this.positions = new Float32Array(vc * 3);
    this.normals = new Float32Array(vc * 3);
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)], false, 'centripetal');
    this._p = new THREE.Vector3(); this._t = new THREE.Vector3();
    this._n = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  /** points: array of Vector3 in the mesh's parent space. */
  fit(points) {
    this.curve.points = points;
    const { segments, radial, radius, positions, normals, _p: p, _t: t, _n: n, _b: b } = this;
    // parallel-transport frame keeps the tube from twisting
    this.curve.getTangent(0, t);
    n.set(0, 0, 1);
    if (Math.abs(t.z) > 0.9) n.set(1, 0, 0);
    n.sub(b.copy(t).multiplyScalar(n.dot(t))).normalize();
    let v = 0;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      this.curve.getPoint(u, p);
      this.curve.getTangent(u, t);
      n.sub(b.copy(t).multiplyScalar(n.dot(t))).normalize();
      b.crossVectors(t, n);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const nx = n.x * c + b.x * s, ny = n.y * c + b.y * s, nz = n.z * c + b.z * s;
        positions[v] = p.x + nx * radius; positions[v + 1] = p.y + ny * radius; positions[v + 2] = p.z + nz * radius;
        normals[v] = nx; normals[v + 1] = ny; normals[v + 2] = nz;
        v += 3;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }
}

/**
 * Hydraulic strut between two moving points: a fat sleeve fixed to one end
 * and a polished rod fixed to the other, sliding inside it.
 */
export class Piston {
  constructor(mats, { radius = 0.03, sleeve = 0.55, rodMat, sleeveMat } = {}) {
    this.group = new THREE.Group();
    this.sleeveLen = sleeve;
    const r = radius;
    const sleeveGeo = revolve(
      [[0, 0], [r * 1.25, 0], [r * 1.25, 0.03], [r, 0.04], [r, sleeve - 0.05], [r * 1.18, sleeve - 0.04], [r * 1.18, sleeve], [r * 0.6, sleeve]],
      20,
    );
    const rodGeo = revolve([[0, 0], [r * 0.5, 0], [r * 0.5, 1], [0, 1]], 14);
    const ball = new THREE.SphereGeometry(r * 1.1, 16, 12);
    this.a = new THREE.Group();
    this.b = new THREE.Group();
    this.sleeve = new THREE.Mesh(sleeveGeo, sleeveMat || mats.gunmetal);
    this.rod = new THREE.Mesh(rodGeo, rodMat || mats.chrome);
    this.a.add(this.sleeve, new THREE.Mesh(ball, mats.steel));
    this.b.add(this.rod, new THREE.Mesh(ball, mats.steel));
    this.group.add(this.a, this.b);
    for (const m of [this.sleeve, this.rod]) m.castShadow = true;
  }

  /** Both ends in the space of this.group's parent. */
  set(pa, pb) {
    this.a.position.copy(pa);
    this.b.position.copy(pb);
    this.a.lookAt(pb);
    this.b.lookAt(pa);
    this.rod.scale.z = Math.max(pa.distanceTo(pb) - this.sleeveLen * 0.35, 0.01);
  }
}
