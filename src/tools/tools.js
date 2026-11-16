import * as THREE from 'three';
import { revolve, ringProfile } from '../model/geom.js';

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

export { createForceps } from './forceps.js';
