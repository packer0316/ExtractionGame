// CPU geometry regression: move the actual model through combined jaw/head poses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHead } from '../src/model/head.js';
import { mandiblePlain } from '../src/model/skullSdf.js';
import { POLY, polyDist } from '../src/model/layout.js';
import { sdRoundRect } from '../src/model/sdf.js';

globalThis.fetch = async path => new Response(readFileSync(new URL(`../public/${path}`, import.meta.url)));
const head = await createHead();
head.idle = false;
const neckParts = [];
for (const part of [head.mech.neck, ...head.mech.neckPistons.map(n => n.p.group)]) {
  part.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const a = o.geometry.attributes.position, points = [];
    for (let i = 0; i < a.count; i += 2) points.push(new THREE.Vector3().fromBufferAttribute(a, i));
    const indices = o.geometry.index;
    if (indices) for (let i = 0; i < indices.count; i += 9) {
      const p = new THREE.Vector3();
      for (let j = 0; j < 3; j++) p.add(new THREE.Vector3().fromBufferAttribute(a, indices.getX(i + j)));
      points.push(p.multiplyScalar(1 / 3));
    }
    neckParts.push({ mesh: o, points, label: o.name || o.parent.name || part.name });
  });
}
const v = new THREE.Vector3(), world = new THREE.Vector3(), matrix = new THREE.Matrix4(), invJaw = new THREE.Matrix4();
const axis = new THREE.Vector3(), offset = new THREE.Vector3();
function pointSegmentDistance(point, a, b) {
  axis.subVectors(b, a); offset.subVectors(point, a);
  const t = THREE.MathUtils.clamp(offset.dot(axis) / axis.lengthSq(), 0, 1);
  return offset.addScaledVector(axis, -t).length();
}
let worst = { clearance: Infinity }, collisions = 0, poses = 0, samples = 0;
let movingLinkClearance = Infinity;
const byPart = {}, byPitch = {};
for (const pitch of [-0.3, 0, 0.15, 0.3, 0.45]) for (const yaw of [-0.6, 0, 0.6]) {
  for (const roll of [-0.12, 0, 0.12]) for (const angle of [0.035, 0.25, 0.42, 0.55, 0.68]) {
    for (const [recoilY, recoilZ] of [[0, 0], [-0.05, -0.035], [0.05, 0.025]]) {
      for (const [key, value] of Object.entries({ pitch, yaw, roll, jaw: angle, recoilY, recoilZ })) {
        head.pose[key].x = head.pose[key].target = value; head.pose[key].v = 0;
      }
      head.update(0); head.root.updateMatrixWorld(true);
      invJaw.copy(head.jaw.matrixWorld).invert();
      const links = [...head.mech.jawPistons, ...head.mech.jawGuides].map(({ p }) => ({
        a: p.a.getWorldPosition(new THREE.Vector3()), b: p.b.getWorldPosition(new THREE.Vector3()),
        radius: p.group.name.startsWith('jaw-hinge') ? 0.015 : 0.0275,
      }));
      poses++;
      for (const { mesh, points, label } of neckParts) {
        matrix.multiplyMatrices(invJaw, mesh.matrixWorld);
        for (const p of points) {
          world.copy(p).applyMatrix4(mesh.matrixWorld);
          for (const link of links) movingLinkClearance = Math.min(movingLinkClearance, pointSegmentDistance(world, link.a, link.b) - link.radius);
          v.copy(p).applyMatrix4(matrix);
          // Solid envelopes are conservative: the jaw's slots/socket holes only add space.
          // Include the 0.008-unit machined belt added by mandibleSdf, even away
          // from the belt. This overestimates the jaw rather than missing its trim.
          const body = mandiblePlain(Math.abs(v.x), v.y, v.z) - 0.008;
          const rail = sdRoundRect(polyDist(POLY.lowerArch, Math.abs(v.x), v.z), v.y + 0.9115, 0.066, 0.0535, 0.016);
          const clearance = Math.min(body, rail); samples++;
          if (clearance < worst.clearance) {
            worst = { clearance, label, pitch, yaw, roll, angle, recoilY, recoilZ,
              point: v.toArray(), world: world.toArray(), material: mesh.material.type,
              color: mesh.material.color?.getHexString(), origin: mesh.getWorldPosition(new THREE.Vector3()).toArray() };
          }
          if (clearance < -0.002) { collisions++; byPart[label] = (byPart[label] || 0) + 1; byPitch[pitch] = (byPitch[pitch] || 0) + 1; }
        }
      }
    }
  }
}
console.log(JSON.stringify({ poses, samples, collisions, movingLinkClearance, byPart, byPitch, worst }, null, 2));
if (!process.argv.includes('--report')) {
  assert.equal(collisions, 0, 'Neck intersects the moving jaw envelope');
  assert(worst.clearance > 0, 'Jaw has no positive clearance from the neck');
  assert(movingLinkClearance > 0, 'Jaw actuator/guide intersects the neck');
}
