// Shared layout of the head: where teeth, eyes and joints sit.
// Pure data + maths (no three.js) so both the bake script (Node) and the
// runtime import the same numbers. Units: 1 = ~10 cm. +Y up, +Z out of the face.

export const SHELL_T = 0.05; // glass wall thickness of the cranium
export const HINGE = { x: 0.585, y: -0.27, z: -0.1 }; // jaw joint (mirrored in x)
export const HEAD_PIVOT = [0, -0.42, -0.22]; // neck top joint
export const FLOOR_Y = -2.2;

// Eye ids are named from the viewer's side: L is on screen left (-x).
export const EYES = [
  { id: 'eyeL', side: -1, pos: [-0.3, 0.07, 0.6] },
  { id: 'eyeR', side: 1, pos: [0.3, 0.07, 0.6] },
];
export const ORBIT = { x: 0.3, y: 0.07, ru: 0.215, rv: 0.19, roll: 0.14, power: 2.7 };

// ---------------------------------------------------------------- dental arches
export const ARCHES = {
  U: { a: 0.37, b: 0.58, z0: 0.2, yCerv: -0.6, dir: -1 },
  L: { a: 0.342, b: 0.532, z0: 0.2, yCerv: -0.87, dir: 1 },
};

const TABLE_N = 720;
const TH_MAX = Math.PI * 0.56;
for (const key of Object.keys(ARCHES)) {
  const A = ARCHES[key];
  const s = new Float64Array(TABLE_N + 1);
  let px = 0, pz = A.z0 + A.b;
  for (let i = 1; i <= TABLE_N; i++) {
    const th = (i / TABLE_N) * TH_MAX;
    const x = A.a * Math.sin(th), z = A.z0 + A.b * Math.cos(th);
    s[i] = s[i - 1] + Math.hypot(x - px, z - pz);
    px = x; pz = z;
  }
  A.table = s;
}

/** Angle on the arch ellipse at signed arc length s from the midline. */
export function archTheta(key, s) {
  const tab = ARCHES[key].table;
  const a = Math.abs(s);
  let lo = 0, hi = TABLE_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid] < a) lo = mid; else hi = mid;
  }
  const f = (a - tab[lo]) / Math.max(tab[hi] - tab[lo], 1e-9);
  return Math.sign(s) * ((lo + f) / TABLE_N) * TH_MAX;
}

/** Point, tangent and outward normal (all in the XZ plane) at arc length s. */
export function archAt(key, s) {
  const A = ARCHES[key];
  const th = archTheta(key, s);
  const sn = Math.sin(th), cs = Math.cos(th);
  const tl = Math.hypot(A.a * cs, A.b * sn);
  const nl = Math.hypot(A.b * sn, A.a * cs);
  return {
    x: A.a * sn, z: A.z0 + A.b * cs,
    tx: (A.a * cs) / tl, tz: (-A.b * sn) / tl,
    nx: (A.b * sn) / nl, nz: (A.a * cs) / nl,
    theta: th,
  };
}

// ---------------------------------------------------------------- tooth shapes
// Reference dimensions of each baked tooth mesh (local space: origin at the gum
// line, +Y towards the biting edge, +Z towards the lips, roots along -Y).
export const TOOTH_TYPES = {
  incisor: { w0: 0.1, ch0: 0.14, roots: [{ x0: 0, x1: 0.004, z1: -0.012, bendX: 0.021, bendZ: -0.012, r0: 0.031, r1: 0.006, k: 1 }] },
  canine: { w0: 0.095, ch0: 0.155, roots: [{ x0: 0, x1: 0.006, z1: -0.016, bendX: 0.034, bendZ: -0.016, r0: 0.036, r1: 0.006, k: 1 }] },
  premolar: { w0: 0.09, ch0: 0.12, roots: [{ x0: 0, x1: 0.002, z1: 0, bendX: 0.026, bendZ: -0.014, r0: 0.032, r1: 0.0065, k: 1 }] },
  molar: {
    w0: 0.125, ch0: 0.115,
    roots: [
      { x0: -0.03, x1: -0.047, z1: 0, bendX: 0.018, bendZ: -0.018, r0: 0.028, r1: 0.0065, k: 1 },
      { x0: 0.03, x1: 0.049, z1: 0.004, bendX: 0.022, bendZ: -0.012, r0: 0.028, r1: 0.007, k: 0.93 },
    ],
  },
};

// Baked mesh variants (upper incisors get shorter roots so they clear the nose).
export const TOOTH_MESHES = {
  UI: { type: 'incisor', rootLen: 0.175 },
  UI2: { type: 'incisor', rootLen: 0.175, lateral: true },
  LI: { type: 'incisor', rootLen: 0.23 },
  C: { type: 'canine', rootLen: 0.3 },
  P: { type: 'premolar', rootLen: 0.235 },
  M: { type: 'molar', rootLen: 0.21 },
};

// One quadrant, from the midline backwards: [mesh, zone, width, crownHeight, tilt°]
const QUADRANT = {
  U: [
    ['UI', 'incisor', 0.112, 0.15, 9],
    ['UI2', 'incisor', 0.092, 0.137, 8],
    ['C', 'canine', 0.098, 0.155, 8],
    ['P', 'premolar', 0.088, 0.12, 3],
    ['P', 'premolar', 0.088, 0.118, 2],
    ['M', 'molar', 0.128, 0.115, 0],
    ['M', 'molar', 0.128, 0.112, 0],
  ],
  L: [
    ['LI', 'incisor', 0.072, 0.124, 10],
    ['LI', 'incisor', 0.078, 0.126, 9],
    ['C', 'canine', 0.09, 0.137, 6],
    ['P', 'premolar', 0.088, 0.116, 2],
    ['P', 'premolar', 0.088, 0.116, 0],
    ['M', 'molar', 0.132, 0.12, -2],
    ['M', 'molar', 0.132, 0.118, -2],
  ],
};
const GAP = 0.0028;

// The same curved centreline drives the visible roots and their socket cutters.
// Most of the bend is in the apical third; the neck remains aligned with the crown.
export const rootBend = (t) => t * t * (0.25 + 0.75 * t);
export function rootAt(r, len, t) {
  const bend = rootBend(t);
  return {
    x: r.x0 + (r.x1 - r.x0) * t + r.bendX * bend,
    y: 0.005 - (len + 0.005) * t,
    z: r.z1 * t + r.bendZ * bend,
    radius: r.r0 + (r.r1 - r.r0) * Math.pow(t, 1.18),
  };
}

function buildTeeth() {
  const teeth = [];
  for (const archKey of ['U', 'L']) {
    const A = ARCHES[archKey];
    for (const side of [-1, 1]) {
      let s = GAP * 0.5;
      QUADRANT[archKey].forEach(([mesh, zone, width, ch, tiltDeg], i) => {
        const sc = s + width * 0.5;
        s += width + GAP;
        const p = archAt(archKey, side * sc);
        // Small, repeatable differences soften the mechanically perfect row.
        // Shared with the baker so the sockets still match the roots exactly.
        const variation = Math.sin((i + 1) * 2.17 + (archKey === 'U' ? 0 : 1.4));
        const tilt = ((tiltDeg + variation * 0.65) * Math.PI) / 180;
        const c = Math.cos(tilt), sn = Math.sin(tilt);
        const y0 = [0, A.dir, 0], z0 = [p.nx, 0, p.nz];
        const yAxis = [c * y0[0] + sn * z0[0], c * y0[1] + sn * z0[1], c * y0[2] + sn * z0[2]];
        const zAxis = [c * z0[0] - sn * y0[0], c * z0[1] - sn * y0[1], c * z0[2] - sn * y0[2]];
        const xAxis = [
          yAxis[1] * zAxis[2] - yAxis[2] * zAxis[1],
          yAxis[2] * zAxis[0] - yAxis[0] * zAxis[2],
          yAxis[0] * zAxis[1] - yAxis[1] * zAxis[0],
        ];
        const type = TOOTH_TYPES[TOOTH_MESHES[mesh].type];
        const sx = width / type.w0;
        const sy = ch / type.ch0;
        const sz = 0.5 + 0.5 * sx;
        const mirror = side * A.dir;
        const apex = rootAt(type.roots[0], TOOTH_MESHES[mesh].rootLen * type.roots[0].k, 1);
        teeth.push({
          id: `${archKey}${side < 0 ? 'L' : 'R'}${i + 1}`,
          arch: archKey, side, n: i + 1, mesh, zone, width, crown: ch,
          pos: [p.x, A.yCerv + variation * 0.0012, p.z],
          xAxis, yAxis, zAxis,
          scale: [sx * mirror, sy, sz],
          rootTip: [apex.x * sx * mirror, apex.y * sy, apex.z * sz],
          rootLen: TOOTH_MESHES[mesh].rootLen * sy,
        });
      });
    }
  }
  return teeth;
}
export const TEETH = buildTeeth();

/** Curved root passages, approximated by short overlapping tapered segments. */
export function toothRootCones(t, clearance = 0, neckOnly = false) {
  const type = TOOTH_TYPES[TOOTH_MESHES[t.mesh].type];
  const [sx, sy, sz] = t.scale;
  const rs = Math.max(Math.abs(sx), sz);
  const world = (p) => [0, 1, 2].map(i => t.pos[i] + t.xAxis[i] * p.x * sx + t.yAxis[i] * p.y * sy + t.zAxis[i] * p.z * sz);
  return type.roots.flatMap((r) => {
    const len = TOOTH_MESHES[t.mesh].rootLen * r.k;
    const result = [];
    for (let i = 0; i < (neckOnly ? 1 : 8); i++) {
      const a = rootAt(r, len, i / 8), b = rootAt(r, len, (i + 1) / 8);
      if (i === 0) a.y = 0.015;
      result.push([...world(a), ...world(b), a.radius * rs + clearance, b.radius * rs + clearance]);
    }
    return result;
  });
}

// ---------------------------------------------------------------- polylines
function ellipseArc(a, b, z0, thMax, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * thMax;
    pts.push([a * Math.sin(th), z0 + b * Math.cos(th)]);
  }
  return pts;
}

/** Half polylines (x >= 0) used for swept parts; mirror with |x|. */
export const POLY = {
  upperArch: ellipseArc(ARCHES.U.a, ARCHES.U.b, ARCHES.U.z0, 1.63, 22),
  lowerArch: ellipseArc(ARCHES.L.a, ARCHES.L.b, ARCHES.L.z0, 1.63, 22),
  jawBody: [...ellipseArc(0.348, 0.542, 0.2, Math.PI / 2, 18), [0.44, 0.08], [0.525, -0.06]],
};

export function polyDist(pts, x, z) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0] - ax, bz = pts[i + 1][1] - az;
    const px = x - ax, pz = z - az;
    let h = (px * bx + pz * bz) / (bx * bx + bz * bz);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = px - bx * h, dz = pz - bz * h;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------- bolts
// Approximate spots for shell fasteners; the bake snaps them onto the surface.
export const BOLT_SEEDS = [
  [0.0, 1.2, -0.12], [0.0, 0.95, 0.5], [0.0, 0.7, -0.95], [0.0, 0.3, -1.1],
  [0.36, 1.05, -0.12], [0.36, 0.86, 0.42], [0.36, 0.8, -0.72],
  [0.7, 0.42, -0.12], [0.62, 0.42, 0.32], [0.62, 0.42, -0.62],
  [0.14, 0.33, 0.8], [0.46, 0.36, 0.62], [0.56, 0.06, 0.5], [0.5, -0.24, 0.62],
  [0.22, -0.2, 0.74], [0.18, -0.46, 0.8], [0.33, -0.44, 0.62], [0.66, -0.13, 0.12],
  [0.0, 0.42, 0.78],
];
export const JAW_BOLT_SEEDS = [
  [0.0, -1.2, 0.8], [0.2, -1.06, 0.74], [0.4, -1.04, 0.42], [0.62, -0.95, -0.06],
  [0.62, -0.5, -0.06], [0.62, -0.72, 0.02],
];
