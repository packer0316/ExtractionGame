import * as THREE from 'three';
import { revolve, ringProfile } from '../model/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Closed, softly squared forging swept along a centreline, with a varying section. */
function forging(points, widths, depths, { segments = 64, radial = 32, cupSide = 0, gripRange } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)), false, 'centripetal');
  const pos = [], uv = [], idx = [];
  const p = V(0, 0, 0), tangent = V(0, 0, 0), normal = V(0, 0, 0);
  const sample = (values, u) => {
    const f = u * (values.length - 1), i = Math.min(values.length - 2, Math.floor(f));
    const k = f - i;
    return THREE.MathUtils.lerp(values[i], values[i + 1], k * k * (3 - 2 * k));
  };
  const rounded = x => Math.sign(x) * Math.pow(Math.abs(x), 0.56);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPoint(u, p); curve.getTangent(u, tangent);
    normal.set(0, -tangent.z, tangent.y).normalize();
    if (normal.z < 0) normal.negate();
    const width = sample(widths, u), depth = sample(depths, u);
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      const a = rounded(Math.cos(angle)), b = rounded(Math.sin(angle));
      let inset = b * depth;
      if (cupSide && b * cupSide < 0) {
        // A concave inner gripping face, with fine longitudinal flutes.
        const mask = THREE.MathUtils.smoothstep(u, 0.52, 0.8) * Math.pow(-b * cupSide, 5);
        inset += cupSide * mask * (0.004 * (1 - a * a) + 0.00065 * Math.cos(a * Math.PI * 5));
      }
      pos.push(p.x + a * width, p.y + normal.y * inset, p.z + normal.z * inset);
      uv.push(j / radial, u);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    // Both sweep directions occur: shanks point down, handles point up.
    if (points.at(-1)[1] > points[0][1]) idx.push(a, b, a + 1, b, b + 1, a + 1);
    else idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  for (const end of [0, segments]) {
    const center = pos.length / 3;
    curve.getPoint(end / segments, p);
    pos.push(p.x, p.y, p.z); uv.push(0.5, end / segments);
    const offset = end * (radial + 1);
    const up = points.at(-1)[1] > points[0][1];
    for (let j = 0; j < radial; j++) {
      if ((end === 0) === up) idx.push(center, offset + j, offset + j + 1);
      else idx.push(center, offset + j + 1, offset + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  if (gripRange) {
    let start = 0, previous = -1;
    for (let i = 0; i < segments; i++) {
      const y = curve.getPoint((i + 0.5) / segments).y;
      const material = y >= gripRange[0] && y <= gripRange[1] ? 1 : 0;
      if (material !== previous) {
        if (i > start) geo.addGroup(start * radial * 6, (i - start) * radial * 6, previous);
        start = i; previous = material;
      }
    }
    geo.addGroup(start * radial * 6, (segments - start) * radial * 6, previous);
    if (previous === 0) geo.groups.at(-1).count += radial * 6;
    else geo.addGroup(segments * radial * 6, radial * 6, 0);
  }
  geo.computeVertexNormals();
  // Weld normals across the UV seam without merging the UVs.
  const normals = geo.attributes.normal;
  for (let i = 0; i <= segments; i++) {
    const a = i * (radial + 1), b = a + radial;
    normal.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z); normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  return geo;
}

function gripTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c6c6c6'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#808080'; ctx.lineWidth = 3;
  for (let i = -256; i <= 512; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - 256, 256); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 7);
  texture.anisotropy = 4;
  return texture;
}

/** Origin = tooth grip, +Y = handles, beaks close along Z around an X-axis hinge. */
export function createForceps(mats) {
  const group = new THREE.Group();
  group.name = 'extraction-forceps';
  const jointY = 0.36, maxAngle = 0.3;
  const contactZ = 0.011;
  const steel = mats.toolSteel.clone();
  steel.color.set(0xa5adb6); steel.roughness = 0.25; steel.envMapIntensity = 0.6;
  const satin = steel.clone(); satin.roughness = 0.33;
  const gripMat = satin.clone();
  gripMat.bumpMap = gripTexture(); gripMat.bumpScale = 0.0025;
  gripMat.map = gripMat.bumpMap;
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b4249, metalness: 1, roughness: 0.4 });

  function arm(side) {
    const pivot = new THREE.Group();
    pivot.name = side > 0 ? 'forceps-arm-a' : 'forceps-arm-b';
    pivot.position.y = jointY;
    // The joint is layered across X. Each forged shank then returns to the grip plane.
    const beak = new THREE.Mesh(forging([
      [side * 0.021, 0.025, -side * 0.012], [side * 0.015, -0.065, side * 0.038],
      [side * 0.004, -0.17, side * 0.074], [0, -0.275, side * 0.064],
      [0, -0.36, side * 0.021], [0, -0.402, side * 0.014],
    ], [0.027, 0.031, 0.025, 0.020, 0.017, 0.012], [0.03, 0.03, 0.023, 0.018, 0.014, 0.008], { cupSide: side }), steel);
    beak.name = 'cupped-beak';
    const handlePoints = [
      [side * 0.021, -0.015, side * 0.012], [side * 0.012, 0.13, -side * 0.048],
      [0, 0.34, -side * 0.085], [0, 0.58, -side * 0.115],
      [0, 0.83, -side * 0.139], [0, 1.025, -side * 0.12], [0, 1.055, -side * 0.107],
    ];
    const handle = new THREE.Mesh(forging(handlePoints,
      [0.027, 0.031, 0.034, 0.042, 0.045, 0.039, 0.006],
      [0.03, 0.022, 0.022, 0.026, 0.028, 0.026, 0.004], { gripRange: [0.47, 0.95] }), [steel, gripMat]);
    handle.name = 'forged-handle';
    // Thin machined ferrules separate the satin grip from the polished forging.
    for (const [y, z, width, depth] of [[0.472, 0.101, 0.0415, 0.026], [0.95, 0.133, 0.043, 0.0275]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 40), satin);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y, -side * z);
      ring.scale.set(width, depth, 0.035);
      pivot.add(ring);
    }
    // The two cheeks overlap as a real pivot, instead of meeting as two wires.
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.061, 0.034, 48), satin);
    cheek.rotation.z = Math.PI / 2;
    cheek.position.x = side * 0.021;
    pivot.add(beak, handle, cheek);
    group.add(pivot);
    return pivot;
  }
  const a = arm(1), b = arm(-1);

  // Recessed axle, retaining rings and slotted screw caps on both faces.
  for (const side of [-1, 1]) {
    const bearing = new THREE.Group();
    bearing.position.set(side * 0.04, jointY, 0);
    bearing.rotation.y = side * Math.PI / 2;
    const washer = new THREE.Mesh(revolve(ringProfile(0.025, 0.047, 0, 0.006, 0.002), 48), dark);
    const rim = new THREE.Mesh(revolve(ringProfile(0.028, 0.043, 0.005, 0.008, 0.0015), 48), steel);
    const screw = new THREE.Mesh(revolve([[0, 0.006], [0.026, 0.006], [0.026, 0.011], [0.023, 0.014], [0, 0.014]], 40), satin);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.033, 0.004, 0.001), dark);
    slot.position.z = 0.0142; slot.rotation.z = 0.55;
    bearing.add(washer, rim, screw, slot); group.add(bearing);
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  group.visible = false;

  const tool = {
    group, open: 0,
    setOpen(k) {
      tool.open = THREE.MathUtils.clamp(k, 0, 1);
      a.rotation.x = -tool.open * maxAngle;
      b.rotation.x = tool.open * maxAngle;
    },
    gripFor(thickness) {
      // Solve the rotated inner contact point, rather than a linear approximation.
      const radius = Math.hypot(jointY, contactZ);
      const angle = Math.asin(THREE.MathUtils.clamp(thickness * 0.5 / radius, 0, 1)) - Math.atan2(contactZ, jointY);
      return THREE.MathUtils.clamp(angle / maxAngle, 0, 1);
    },
  };
  tool.setOpen(1);
  return tool;
}
