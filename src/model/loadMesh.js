import * as THREE from 'three';

const cache = new Map();

/** Loads a baked .bin mesh (see tools/bake.mjs) as a BufferGeometry. */
export function loadMesh(name) {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`models/${name}.bin`)
        .then((r) => {
          if (!r.ok) throw new Error(`models/${name}.bin: ${r.status} (run "npm run bake")`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const head = new DataView(buf);
          const vc = head.getUint32(4, true);
          const ic = head.getUint32(8, true);
          const nrmBytes = Math.ceil((vc * 6) / 4) * 4;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 12, vc * 3), 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buf, 12 + vc * 12, vc * 3), 3, true));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, 12 + vc * 12 + nrmBytes, ic), 1));
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
          return geo;
        }),
    );
  }
  return cache.get(name);
}

export async function loadManifest() {
  const r = await fetch('models/manifest.json');
  return r.json();
}
