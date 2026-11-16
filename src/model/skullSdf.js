// Signed-distance definitions of every sculpted part of the head.
// These are evaluated offline by tools/bake.mjs and turned into meshes.
import {
  smin, smax, clamp, mix, smoothstep, bump,
  sdSphere, sdEllipsoid, sdCapsule, sdRoundCone, sdRoundBox, sdRoundRect,
} from './sdf.js';
import {
  SHELL_T, ORBIT, HINGE, TEETH, POLY, polyDist, toothRootCones,
  TOOTH_TYPES, TOOTH_MESHES,
} from './layout.js';

const half = (arch) => TEETH.filter((t) => t.arch === arch && t.side > 0);
const UPPER = half('U');
const LOWER = half('L');
const upperSockets = UPPER.flatMap((t) => toothRootCones(t, 0.006));
const lowerSockets = LOWER.flatMap((t) => toothRootCones(t, 0.006));

function cones(list, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const v = sdRoundCone(x, y, z, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    if (v < d) d = v;
  }
  return d;
}

// Holes the rails need: a seat for each tooth neck plus the root passage.
function railHoles(teeth) {
  const out = [];
  for (const t of teeth) {
    const rc = toothRootCones(t, 0.011);
    for (const c of rc) {
      // extend the passage out through the biting side of the rail
      out.push([
        c[0] + t.yAxis[0] * 0.03, c[1] + t.yAxis[1] * 0.03, c[2] + t.yAxis[2] * 0.03,
        c[3], c[4], c[5], c[6], c[7],
      ]);
    }
    if (rc.length > 1) {
      const a = rc[0], b = rc[1];
      out.push([a[0], a[1], a[2], b[0], b[1], b[2], a[6], b[6]]);
    }
  }
  return out;
}
const upperRailHoles = railHoles(UPPER);
const lowerRailHoles = railHoles(LOWER);

// ------------------------------------------------------------------ cranium
const OC = Math.cos(ORBIT.roll), OS = Math.sin(ORBIT.roll);
const OMIN = Math.min(ORBIT.ru, ORBIT.rv);

/** Eye socket outline in the XY plane (a squircle, outer corner dropped). */
export function orbit2D(ax, y) {
  const dx = ax - ORBIT.x, dy = y - ORBIT.y;
  const u = Math.abs(OC * dx - OS * dy) / ORBIT.ru;
  const v = Math.abs(OS * dx + OC * dy) / ORBIT.rv;
  const k = Math.pow(Math.pow(u, ORBIT.power) + Math.pow(v, ORBIT.power), 1 / ORBIT.power);
  return (k - 1) * OMIN;
}

function noseCut(ax, y, z) {
  const a = sdEllipsoid(ax, y, z, 0, -0.16, 0.82, 0.062, 0.17, 0.3);
  const b = sdEllipsoid(ax, y, z, 0.07, -0.3, 0.82, 0.086, 0.105, 0.3);
  return smin(a, b, 0.05);
}

/** The smooth outside of the skull, before ribs, holes or hollowing. */
export function craniumPlain(ax, y, z) {
  // braincase
  let d = sdEllipsoid(ax, y, z, 0, 0.42, -0.16, 0.7, 0.7, 0.9);
  d = smin(d, sdEllipsoid(ax, y, z, 0, 0.52, -0.4, 0.72, 0.6, 0.64), 0.2);
  d = smin(d, sdEllipsoid(ax, y, z, 0.36, -0.04, -0.22, 0.28, 0.3, 0.4), 0.16);
  // face block
  d = smin(d, sdRoundBox(ax, y, z, 0, 0.0, 0.38, 0.4, 0.3, 0.34, 0.2), 0.14);
  // temporal hollow behind the eye
  d = smax(d, -sdEllipsoid(ax, y, z, 0.76, 0.03, 0.3, 0.17, 0.27, 0.27), 0.12);
  // brow ridge and outer orbital rim
  d = smin(d, sdCapsule(ax, y, z, 0, 0.25, 0.75, 0.4, 0.29, 0.62, 0.085), 0.1);
  d = smin(d, sdCapsule(ax, y, z, 0.5, 0.27, 0.56, 0.53, -0.1, 0.5, 0.06), 0.08);
  // cheekbone and its arch back to the ear
  d = smin(d, sdEllipsoid(ax, y, z, 0.47, -0.17, 0.5, 0.15, 0.115, 0.16), 0.1);
  d = smin(d, sdCapsule(ax, y, z, 0.55, -0.17, 0.42, 0.66, -0.13, 0.0, 0.045), 0.06);
  d = smin(d, sdCapsule(ax, y, z, 0.66, -0.13, 0.0, 0.6, -0.09, -0.18, 0.05), 0.08);
  // nasal bridge
  d = smin(d, sdCapsule(ax, y, z, 0, 0.17, 0.74, 0, 0.0, 0.84, 0.06), 0.08);
  // upper jaw
  d = smin(d, sdRoundBox(ax, y, z, 0, -0.4, 0.44, 0.27, 0.21, 0.29, 0.13), 0.12);
  if (y < -0.15 && z > 0) {
    const da = polyDist(POLY.upperArch, ax, z);
    d = smin(d, sdRoundRect(da, y + 0.45, 0.088, 0.17, 0.035), 0.06);
  }
  // hollow beside the nose, under the cheekbone
  d = smax(d, -sdEllipsoid(ax, y, z, 0.29, -0.3, 0.8, 0.1, 0.1, 0.1), 0.09);
  return d;
}

/** Raised ribs and rims on the outer surface. */
function shellRelief(ax, y, z, o2, dn) {
  let h = 0;
  const crest = Math.max(smoothstep(0.36, 0.46, y), smoothstep(-0.25, -0.45, z) * smoothstep(-0.25, -0.05, y));
  h += 0.013 * bump(ax, 0.06) * crest;
  h += 0.012 * bump(z + 0.12, 0.055) * smoothstep(0.02, 0.14, y);
  h += 0.01 * bump(y - 0.37, 0.05) * smoothstep(0.46, 0.3, z);
  if (z > 0.3) h += 0.022 * (1 - smoothstep(0.03, 0.085, o2));
  if (z > 0.5) h += 0.012 * (1 - smoothstep(0.02, 0.06, dn));
  return h;
}

export function craniumOuter(x, y, z) {
  const ax = Math.abs(x);
  const plain = craniumPlain(ax, y, z);
  if (plain > 0.2 || plain < -0.2) return plain;
  return plain - shellRelief(ax, y, z, orbit2D(ax, y), noseCut(ax, y, z));
}

/** Hollow glass cranium with eye, nose and neck openings and tooth sockets. */
export function craniumSdf(x, y, z) {
  const ax = Math.abs(x);
  const plain = craniumPlain(ax, y, z);
  if (plain > 0.2) return plain;
  const o2 = orbit2D(ax, y);
  const dn = noseCut(ax, y, z);
  const outer = plain - shellRelief(ax, y, z, o2, dn);

  let d = Math.max(outer, -(plain + SHELL_T));

  // a sleeve of glass lining each eye socket so the rim has real depth
  if (z > 0.3) {
    const sleeve = Math.max(Math.max(o2 - 0.05, -o2 - 0.02), 0.42 - z, outer);
    d = smin(d, sleeve, 0.03);
  }

  const orbCut = Math.max(o2, 0.25 - z);
  const neckCut = Math.max(Math.hypot(ax, z + 0.22) - 0.4, y + 0.05);
  d = smax(d, -Math.min(orbCut, dn, neckCut), 0.014);

  // solid glass around the upper tooth roots
  if (y < -0.18 && z > 0.02) {
    const da = polyDist(POLY.upperArch, ax, z);
    let alv = Math.max(sdRoundRect(da, y + 0.4, 0.086, 0.14, 0.03), outer);
    alv = smax(alv, -dn, 0.012);
    d = Math.min(d, alv);
    d = Math.max(d, -cones(upperSockets, ax, y, z));
  }
  return smax(d, -(y + 0.515), 0.01);
}

// ------------------------------------------------------------------ mandible
// ramus runs from the jaw angle up to the joint, leaning slightly back
const RAM = (() => {
  const gy = -1.04, gz = 0.0, hy = HINGE.y, hz = HINGE.z;
  const l = Math.hypot(hy - gy, hz - gz);
  return { cy: (gy + hy) / 2, cz: (gz + hz) / 2, uy: (hy - gy) / l, uz: (hz - gz) / l, half: l / 2 };
})();

export function mandiblePlain(ax, y, z) {
  const db = polyDist(POLY.jawBody, ax, z);
  // body: deep at the chin, shallower towards the angle
  const back = smoothstep(0.75, 0.0, z);
  const bottom = mix(-1.2, -1.14, back), top = -0.925;
  let d = sdRoundRect(db, y - (top + bottom) / 2, 0.072, (top - bottom) / 2, 0.045);
  d = smin(d, sdEllipsoid(ax, y, z, 0, -1.13, 0.745, 0.15, 0.075, 0.07), 0.07);
  d = smin(d, sdEllipsoid(ax, y, z, 0.13, -1.16, 0.69, 0.06, 0.045, 0.05), 0.05);
  // ramus plate with a lightening slot
  const ry = y - RAM.cy, rz = z - RAM.cz;
  const v = ry * RAM.uy + rz * RAM.uz, w = -ry * RAM.uz + rz * RAM.uy;
  let ram = sdRoundBox(ax, v, w, 0.57, 0, 0, 0.033, RAM.half + 0.02, 0.125, 0.03);
  const slot = Math.max(sdRoundRect(v + 0.02, w, 0.19, 0.045, 0.045), Math.abs(ax - 0.57) - 0.1);
  ram = smax(ram, -slot, 0.014);
  d = smin(d, ram, 0.07);
  d = smin(d, sdSphere(ax, y, z, HINGE.x, HINGE.y, HINGE.z, 0.068), 0.05);
  d = smin(d, sdRoundCone(ax, y, z, 0.56, -0.6, 0.06, 0.565, -0.32, 0.08, 0.055, 0.028), 0.05);
  d = smax(d, -sdSphere(ax, y, z, 0.57, -0.21, -0.005, 0.085), 0.03);
  return d;
}

export function mandibleSdf(x, y, z) {
  const ax = Math.abs(x);
  if (y > -0.05) return y + 0.15;
  let d = mandiblePlain(ax, y, z);
  if (d > 0.15) return d;
  // a chamfered belt along the lower border for a machined look
  const db = polyDist(POLY.jawBody, ax, z);
  d -= 0.008 * bump(y + 1.1, 0.045) * (1 - smoothstep(0.1, 0.16, db)) * smoothstep(-0.05, 0.1, z);
  if (y > -1.22 && z > 0.05) d = Math.max(d, -cones(lowerSockets, ax, y, z));
  return d;
}

// ------------------------------------------------------------------ gum rails
export function upperRailSdf(x, y, z) {
  const ax = Math.abs(x);
  const da = polyDist(POLY.upperArch, ax, z);
  let d = sdRoundRect(da, y + 0.556, 0.068, 0.056, 0.016);
  if (d > 0.1) return d;
  // shallow groove running along the outer face
  d = Math.max(d, -(sdRoundRect(da - 0.074, y + 0.556, 0.01, 0.012, 0.006)));
  return Math.max(d, -cones(upperRailHoles, ax, y, z));
}

export function lowerRailSdf(x, y, z) {
  const ax = Math.abs(x);
  const da = polyDist(POLY.lowerArch, ax, z);
  let d = sdRoundRect(da, y + 0.9115, 0.066, 0.0535, 0.016);
  if (d > 0.1) return d;
  d = Math.max(d, -(sdRoundRect(da - 0.072, y + 0.9115, 0.01, 0.012, 0.006)));
  return Math.max(d, -cones(lowerRailHoles, ax, y, z));
}

// ------------------------------------------------------------------ teeth
function incisorCrown(x, y, z) {
  const t = clamp(y / 0.14, 0, 1);
  const hx = 0.041 + 0.009 * smoothstep(0, 0.7, t);
  const hz = mix(0.035, 0.0085, Math.pow(t, 0.85));
  const zc = 0.012 * t - 0.004;
  const dxz = sdRoundRect(x, z - zc, hx, hz, Math.min(hx, hz) * 0.9);
  const dy = Math.abs(y - 0.058) - 0.082;
  let d = smax(dxz, dy, 0.014);
  d = smax(d, -sdEllipsoid(x, y, z, 0, 0.075, -0.058, 0.034, 0.055, 0.03), 0.012);
  return d;
}

function canineCrown(x, y, z) {
  const zz = z * 1.12;
  let d = sdRoundCone(x, y, zz, 0, 0, 0, 0, 0.105, 0.004, 0.043, 0.03);
  d = smin(d, sdRoundCone(x, y, zz, 0, 0.1, 0.004, 0, 0.15, 0, 0.028, 0.007), 0.02);
  return d / 1.12;
}

function premolarCrown(x, y, z) {
  let d = sdEllipsoid(x, y, z, 0, 0.05, 0, 0.046, 0.068, 0.052);
  d = smax(d, y - 0.098, 0.02);
  d = smin(d, sdSphere(x, y, z, 0, 0.092, 0.024, 0.027), 0.018);
  d = smin(d, sdSphere(x, y, z, 0, 0.086, -0.025, 0.023), 0.018);
  d = smax(d, -sdCapsule(x, y, z, -0.03, 0.119, 0, 0.03, 0.119, 0, 0.009), 0.008);
  return d;
}

function molarCrown(x, y, z) {
  let d = sdRoundBox(x, y, z, 0, 0.045, 0, 0.0625, 0.058, 0.056, 0.032);
  const sx = Math.abs(x), sz = Math.abs(z);
  d = smin(d, sdSphere(sx, y, sz, 0.031, 0.092, 0.028, 0.027), 0.018);
  d = smax(d, -sdEllipsoid(x, y, z, 0, 0.128, 0, 0.034, 0.02, 0.03), 0.012);
  d = smax(d, -sdCapsule(x, y, z, -0.05, 0.116, 0, 0.05, 0.116, 0, 0.006), 0.008);
  d = smax(d, -sdCapsule(x, y, z, 0, 0.116, -0.045, 0, 0.116, 0.045, 0.006), 0.008);
  // groove down the cheek side between the cusps
  d = smax(d, -sdCapsule(x, y, z, 0, 0.11, 0.06, 0, 0.04, 0.064, 0.007), 0.008);
  return d;
}

const CROWNS = { incisor: incisorCrown, canine: canineCrown, premolar: premolarCrown, molar: molarCrown };

/** SDF of one baked tooth mesh in its own local space. */
export function toothSdf(meshKey) {
  const spec = TOOTH_MESHES[meshKey];
  const type = TOOTH_TYPES[spec.type];
  const crown = CROWNS[spec.type];
  return (x, y, z) => {
    let roots = 1e9;
    for (const r of type.roots) {
      const len = spec.rootLen * r.k;
      const v = sdRoundCone(x, y, z, r.x0, 0.005, 0, r.x1, -len, r.z1, r.r0, r.r1);
      roots = roots > 1e8 ? v : smin(roots, v, 0.014);
    }
    return smin(crown(x, y, z), roots, 0.016);
  };
}

export function toothBounds(meshKey) {
  const len = TOOTH_MESHES[meshKey].rootLen;
  return { min: [-0.09, -len - 0.03, -0.085], max: [0.09, 0.185, 0.085] };
}
