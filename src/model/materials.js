import * as THREE from 'three';
import { toothSdf } from './skullSdf.js';

/** All shared materials of the head and tools. */
export function createMaterials() {
  const glass = (opts) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.045,
      metalness: 0,
      transmission: 1,
      ior: 1.47,
      thickness: 0.12,
      specularIntensity: 1,
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
      ...opts,
    });

  const m = {
    // ice-teal shell of the cranium
    shell: glass({ color: 0xd4f0fa, transmission: 0.96, attenuationColor: new THREE.Color(0x3fb4d8), attenuationDistance: 0.13, thickness: 0.05 }),
    // smoked amber jaw (solid glass, so it reads deeper)
    jaw: glass({ attenuationColor: new THREE.Color(0xf09a2e), attenuationDistance: 0.2, thickness: 0.13, ior: 1.5 }),
    // clear optical glass for lenses and domes
    lens: glass({ attenuationColor: new THREE.Color(0xd8f4ff), attenuationDistance: 1.2, thickness: 0.08, ior: 1.52, roughness: 0.0 }),
    collar: glass({ attenuationColor: new THREE.Color(0x3fb4d8), attenuationDistance: 0.26, thickness: 0.16 }),

    gold: new THREE.MeshStandardMaterial({ color: 0xd9a84e, metalness: 1, roughness: 0.26 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb98a3c, metalness: 1, roughness: 0.36 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 1, roughness: 0.1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d949e, metalness: 1, roughness: 0.3 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x2b2f37, metalness: 1, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.2, roughness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0, roughness: 0.85 }),

    enamel: new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.23, metalness: 0, ior: 1.54,
      clearcoat: 0.45, clearcoatRoughness: 0.19, envMapIntensity: 0.7,
      specularIntensity: 0.85,
    }),

    cableRed: new THREE.MeshStandardMaterial({ color: 0xc1272d, roughness: 0.45, metalness: 0.05 }),
    cableAmber: new THREE.MeshStandardMaterial({ color: 0xe8931c, roughness: 0.45, metalness: 0.05 }),
    cableIvory: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.5, metalness: 0.05 }),
    cableTeal: new THREE.MeshStandardMaterial({ color: 0x1fa3a8, roughness: 0.45, metalness: 0.05 }),

    // emissives are unlit and above 1.0 so the bloom pass picks them up
    glowCyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.9, 2.6) }),
    glowAmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.2, 0.25) }),
    glowWhite: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.5) }),
  };
  etchSeams(m.shell);
  // tools get their own softer steel so they do not blow out near the camera
  m.toolSteel = new THREE.MeshStandardMaterial({ color: 0xa4acb8, metalness: 1, roughness: 0.22, envMapIntensity: 0.85 });
  return m;
}

/** Thin dark panel joints drawn in the shader, so they stay crisp at any distance. */
function etchSeams(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeamPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSeamPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeamPos;
        float seamLine(float d) {
          float w = max(0.0055, fwidth(d) * 1.3);
          return 1.0 - smoothstep(w * 0.45, w, abs(d));
        }
        float shellSeams(vec3 p) {
          float ax = abs(p.x);
          float s = 0.0;
          float top = smoothstep(0.44, 0.52, p.y);
          s = max(s, seamLine(ax - 0.37) * top);
          s = max(s, seamLine(p.z - 0.34) * smoothstep(0.56, 0.64, p.y));
          s = max(s, seamLine(p.z + 0.64) * smoothstep(0.12, 0.2, p.y));
          s = max(s, seamLine(p.y - 0.62) * step(p.z, 0.34) * step(-0.64, p.z) * step(0.37, ax));
          s = max(s, seamLine(p.y + 0.02) * step(p.z, 0.18) * step(0.2, ax));
          s = max(s, seamLine(ax - 0.21) * step(p.z, -0.64) * smoothstep(-0.2, -0.1, p.y));
          return s;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float seamMask = shellSeams(vSeamPos);
        diffuseColor.rgb *= 1.0 - 0.62 * seamMask;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = min(1.0, roughnessFactor + seamMask * 0.45);`);
  };
}

/** Separate enamel/root finish, shared program with per-tooth uniforms. */
export function createToothMaterial(base, crownHeight, seed) {
  const mat = base.clone();
  const variation = Math.sin(seed * 2.399);
  // Keep the tint independent of material.color, which win/rebuild animations reset.
  const tint = new THREE.Color().setRGB(1, 0.993 + variation * 0.005, 0.977 + variation * 0.009);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.toothCrownHeight = { value: crownHeight };
    shader.uniforms.toothTint = { value: tint };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vToothPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvToothPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vToothPosition;
        uniform float toothCrownHeight;
        uniform vec3 toothTint;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= toothTint;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float crown = smoothstep(-0.006, 0.018, vToothPosition.y);
        float edge = smoothstep(0.65, 1.0, vToothPosition.y / toothCrownHeight);
        // Very fine growth bands modulate the highlight, never the silhouette.
        float bands = sin(vToothPosition.y * 2200.0 + sin(vToothPosition.x * 130.0) * 1.8);
        float bandAA = 1.0 - smoothstep(0.6, 2.5, fwidth(vToothPosition.y * 2200.0));
        roughnessFactor = mix(0.43, roughnessFactor, crown) - edge * 0.035
          + bands * bandAA * crown * (1.0 - edge) * 0.012;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= crown;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'tooth-enamel-v1';
  return mat;
}

/** Paints a baked tooth geometry: ivory dentin, cool incisal enamel, warm root. */
export function paintTooth(geo, crownHeight, meshKey) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const sdf = toothSdf(meshKey);
  const col = new Float32Array(pos.count * 3);
  const enamel = new THREE.Color(0xf3eddf);
  const edge = new THREE.Color(0xd8e5ec);
  const root = new THREE.Color(0xd9bf91);
  const tip = new THREE.Color(0xb99a6d);
  const c = new THREE.Color();
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= 0) {
      const k = THREE.MathUtils.smoothstep(y, crownHeight * 0.55, crownHeight);
      c.copy(enamel).lerp(edge, k * 0.3);
      // Dentin warmth fades gradually out of the neck, without a stain stripe.
      const g = 1 - THREE.MathUtils.smoothstep(y, 0, crownHeight * 0.44);
      c.lerp(root, g * 0.22);
    } else {
      const k = THREE.MathUtils.smoothstep(y, -0.02, 0);
      const d = THREE.MathUtils.smoothstep(-y, 0, -minY);
      c.copy(root).lerp(tip, d * 0.6).lerp(enamel, k * 0.7);
    }
    // ambient occlusion straight from the distance field: darkens the
    // fissures, the gaps between cusps and the fork of the roots
    const px = pos.getX(i), pz = pos.getZ(i), nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    let occ = 0, wgt = 1;
    for (let k = 1; k <= 4; k++) {
      const h = k * 0.011;
      occ += wgt * Math.max(0, h - sdf(px + nx * h, y + ny * h, pz + nz * h));
      wgt *= 0.6;
    }
    const ao = Math.max(0.62, 1 - occ * 17);
    col[i * 3] = c.r * ao; col[i * 3 + 1] = c.g * ao * (0.97 + 0.03 * ao); col[i * 3 + 2] = c.b * ao * (0.92 + 0.08 * ao);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
