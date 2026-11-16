import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOTH_MESHES, TEETH } from '../src/model/layout.js';
import { craniumSdf, mandibleSdf, upperRailSdf, lowerRailSdf } from '../src/model/skullSdf.js';

for (const key of Object.keys(TOOTH_MESHES)) {
  const b = readFileSync(new URL(`../public/models/tooth_${key}.bin`, import.meta.url));
  const vc = b.readUInt32LE(4), ic = b.readUInt32LE(8);
  const p = new Float32Array(b.buffer, b.byteOffset + 12, vc * 3);
  const n = new Int16Array(b.buffer, b.byteOffset + 12 + vc * 12, vc * 3);
  const idx = new Uint32Array(b.buffer, b.byteOffset + 12 + vc * 12 + Math.ceil(vc * 6 / 4) * 4, ic);
  const edges = new Map(), links = Array.from({ length: vc }, () => []);
  for (let i = 0; i < p.length; i++) assert(Number.isFinite(p[i]), `${key}: finite vertex`);
  for (let i = 0; i < vc; i++) assert(Math.abs(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) / 32767 - 1) < 0.001, `${key}: unit normal`);
  for (let i = 0; i < ic; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    assert(new Set(tri).size === 3 && tri.every(v => v < vc), `${key}: triangle indices`);
    for (let j = 0; j < 3; j++) {
      const a = tri[j], c = tri[(j + 1) % 3];
      const e = `${Math.min(a, c)},${Math.max(a, c)}`;
      edges.set(e, (edges.get(e) || 0) + 1);
      links[a].push(c); links[c].push(a);
    }
  }
  assert([...edges.values()].every(count => count === 2), `${key}: closed manifold`);
  const seen = new Set([0]), stack = [0];
  while (stack.length) for (const v of links[stack.pop()]) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  assert.equal(seen.size, vc, `${key}: connected crown and root`);
  console.log(`${key}: ${vc} vertices, closed manifold, connected crown/root, finite positions and unit normals`);
}
assert.equal(TEETH.length, 28);
for (const right of TEETH.filter(t => t.side > 0)) {
  const left = TEETH.find(t => t.arch === right.arch && t.n === right.n && t.side < 0);
  assert.equal(left.pos[0], -right.pos[0]);
  assert.equal(left.pos[1], right.pos[1]);
  assert.equal(left.pos[2], right.pos[2]);
}
console.log('28 teeth; mirrored socket positions match the baked shell.');
let samples = 0, worst = Infinity;
for (const tooth of TEETH) {
  const b = readFileSync(new URL(`../public/models/tooth_${tooth.mesh}.bin`, import.meta.url));
  const p = new Float32Array(b.buffer, b.byteOffset + 12, b.readUInt32LE(4) * 3);
  const shell = tooth.arch === 'U' ? craniumSdf : mandibleSdf;
  const rail = tooth.arch === 'U' ? upperRailSdf : lowerRailSdf;
  for (let i = 0; i < p.length; i += 15) {
    if (p[i + 1] > -0.025) continue;
    const world = [0, 1, 2].map(j => tooth.pos[j] + tooth.xAxis[j] * p[i] * tooth.scale[0]
      + tooth.yAxis[j] * p[i + 1] * tooth.scale[1] + tooth.zAxis[j] * p[i + 2] * tooth.scale[2]);
    const clearance = Math.min(shell(...world), rail(...world));
    worst = Math.min(worst, clearance); samples++;
    assert(clearance > -0.001, `${tooth.id}: root intersects shell/rail (${clearance})`);
  }
}
console.log(`${samples} root samples clear shell/rails; minimum clearance ${worst.toFixed(5)}.`);
