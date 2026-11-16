// Bakes the sculpted parts of the head (SDF -> mesh) into public/models.
//   node tools/bake.mjs            bake everything
//   node tools/bake.mjs cranium    bake only the named parts
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meshSdf, snapToSurface } from './mesher.mjs';
import {
  craniumSdf, craniumOuter, mandibleSdf, upperRailSdf, lowerRailSdf, toothSdf, toothBounds,
} from '../src/model/skullSdf.js';
import { BOLT_SEEDS, JAW_BOLT_SEEDS, TOOTH_MESHES } from '../src/model/layout.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

function write(name, mesh) {
  const vc = mesh.positions.length / 3;
  const ic = mesh.indices.length;
  const nrm = new Int16Array(vc * 3);
  for (let i = 0; i < vc * 3; i++) nrm[i] = Math.round(mesh.normals[i] * 32767);
  const nrmBytes = Math.ceil((vc * 6) / 4) * 4;
  const buf = Buffer.alloc(12 + vc * 12 + nrmBytes + ic * 4);
  buf.write('SKM1', 0, 'ascii');
  buf.writeUInt32LE(vc, 4);
  buf.writeUInt32LE(ic, 8);
  Buffer.from(mesh.positions.buffer).copy(buf, 12);
  Buffer.from(nrm.buffer).copy(buf, 12 + vc * 12);
  Buffer.from(mesh.indices.buffer).copy(buf, 12 + vc * 12 + nrmBytes);
  writeFileSync(join(outDir, `${name}.bin`), buf);
  return (buf.length / 1024).toFixed(0) + ' KB';
}

const PARTS = {
  cranium: () => meshSdf(craniumSdf, { min: [-0.84, -0.56, -1.14], max: [0.84, 1.2, 0.98], h: 0.0125, label: 'cranium' }),
  mandible: () => meshSdf(mandibleSdf, { min: [-0.72, -1.26, -0.26], max: [0.72, -0.14, 0.92], h: 0.0105, label: 'mandible' }),
  upperRail: () => meshSdf(upperRailSdf, { min: [-0.47, -0.64, 0.1], max: [0.47, -0.47, 0.9], h: 0.006, label: 'upperRail' }),
  lowerRail: () => meshSdf(lowerRailSdf, { min: [-0.46, -0.99, 0.1], max: [0.46, -0.83, 0.88], h: 0.006, label: 'lowerRail' }),
};
for (const key of Object.keys(TOOTH_MESHES)) {
  PARTS[`tooth_${key}`] = () => meshSdf(toothSdf(key), { ...toothBounds(key), h: 0.0028, label: `tooth_${key}` });
}

console.log('Baking head meshes...');
for (const [name, build] of Object.entries(PARTS)) {
  if (!want(name)) continue;
  const mesh = build();
  console.log(`  -> ${name}.bin ${write(name, mesh)}`);
}

// Fasteners: snap the seed points onto the finished surfaces.
const manifestPath = join(outDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const snapAll = (sdf, seeds) => {
  const out = [];
  for (const s of seeds) {
    const r = snapToSurface(sdf, s);
    const round = (v) => v.map((x) => +x.toFixed(4));
    out.push({ p: round(r.p), n: round(r.n) });
    if (Math.abs(s[0]) > 0.02) {
      out.push({ p: round([-r.p[0], r.p[1], r.p[2]]), n: round([-r.n[0], r.n[1], r.n[2]]) });
    }
  }
  return out;
};
manifest.bolts = snapAll(craniumOuter, BOLT_SEEDS);
manifest.jawBolts = snapAll(mandibleSdf, JAW_BOLT_SEEDS);
manifest.parts = Object.keys(PARTS);
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`  -> manifest.json (${manifest.bolts.length} shell bolts, ${manifest.jawBolts.length} jaw bolts)`);
