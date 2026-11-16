import * as THREE from 'three';
import { loadMesh, loadManifest } from './loadMesh.js';
import { createMaterials, createToothMaterial, paintTooth } from './materials.js';
import { TEETH, EYES, HINGE, HEAD_PIVOT, TOOTH_MESHES, TOOTH_TYPES } from './layout.js';
import { buildEye } from './eyes.js';
import { buildMechanics } from './mechanics.js';
import { Spring } from '../util/anim.js';
import { fitJawPivot } from './jawMotion.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * The whole head. Scene graph (all child coordinates are "skull space"):
 *   root
 *     neck            static column, pistons, cables, collar
 *     pivot           neck joint, sways the head
 *       skull         cranium, upper teeth, eyes, inner mechanics
 *         jawPivot    hinge, opens the jaw
 *           jaw       mandible, lower rail, lower teeth
 */
export async function createHead() {
  const mats = createMaterials();
  const [manifest, cranium, mandible, upperRail, lowerRail, ...toothGeos] = await Promise.all([
    loadManifest(),
    loadMesh('cranium'), loadMesh('mandible'), loadMesh('upperRail'), loadMesh('lowerRail'),
    ...Object.keys(TOOTH_MESHES).map((k) => loadMesh(`tooth_${k}`)),
  ]);
  const toothGeo = {};
  Object.keys(TOOTH_MESHES).forEach((k, i) => {
    paintTooth(toothGeos[i], TOOTH_TYPES[TOOTH_MESHES[k].type].ch0, k);
    toothGeo[k] = toothGeos[i];
  });

  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(...HEAD_PIVOT);
  const skull = new THREE.Group();
  skull.position.set(-HEAD_PIVOT[0], -HEAD_PIVOT[1], -HEAD_PIVOT[2]);
  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, HINGE.y, HINGE.z);
  const jaw = new THREE.Group();
  jaw.position.set(0, -HINGE.y, -HINGE.z);
  root.add(pivot);
  pivot.add(skull);
  skull.add(jawPivot);
  jawPivot.add(jaw);

  const shellMesh = new THREE.Mesh(cranium, mats.shell);
  shellMesh.renderOrder = 2;
  skull.add(shellMesh);
  const jawMesh = new THREE.Mesh(mandible, mats.jaw);
  jawMesh.renderOrder = 3;
  jaw.add(jawMesh);

  const railU = new THREE.Mesh(upperRail, mats.gold);
  const railL = new THREE.Mesh(lowerRail, mats.gold);
  railU.castShadow = railL.castShadow = true;
  skull.add(railU);
  jaw.add(railL);

  // ---- teeth: a holder at the gum line carries position + orientation,
  // so pulling is simply a slide along the holder's local +Y.
  const targets = new Map();
  const collarGeo = new THREE.TorusGeometry(1, 0.2, 8, 28);
  for (const t of TEETH) {
    const holder = new THREE.Group();
    holder.position.set(...t.pos);
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(t.xAxis), V(t.yAxis), V(t.zAxis)));
    const mesh = new THREE.Mesh(toothGeo[t.mesh], createToothMaterial(
      mats.enamel, TOOTH_TYPES[t.zone].ch0, t.n + (t.side + 1) * 4 + (t.arch === 'L' ? 17 : 0),
    ));
    mesh.scale.set(...t.scale);
    mesh.castShadow = true;
    mesh.userData.targetId = t.id;
    holder.add(mesh);

    // brass seat ring around the tooth neck (stays behind after extraction)
    const collar = new THREE.Mesh(collarGeo, mats.brass);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(t.width * 0.47, t.width * 0.47 * (0.55 + 0.45 * t.scale[2] / Math.abs(t.scale[0])) * (t.zone === 'incisor' ? 0.78 : 0.95), 0.04);
    collar.position.y = 0.004;
    const seat = new THREE.Group();
    seat.position.copy(holder.position);
    seat.quaternion.copy(holder.quaternion);
    seat.add(collar);

    (t.arch === 'U' ? skull : jaw).add(holder, seat);
    targets.set(t.id, {
      id: t.id, kind: 'tooth', zone: t.zone, info: t, holder, mesh, seat,
      parent: t.arch === 'U' ? skull : jaw, alive: true,
      home: { pos: holder.position.clone(), quat: holder.quaternion.clone() },
    });
  }

  // ---- eyes
  for (const e of EYES) {
    const eye = buildEye(mats, e);
    skull.add(eye.group);
    targets.set(e.id, { id: e.id, kind: 'eye', zone: 'eye', info: e, eye, alive: true });
  }

  // ---- everything mechanical: neck, core, gears, hinges, bolts
  const mech = buildMechanics({ mats, manifest, root, pivot, skull, jaw, jawPivot });

  root.traverse((o) => {
    if (o.isMesh && o.material && o.material.transmission > 0) o.castShadow = false;
  });

  // ---- pose: springs give every motion a little mechanical overshoot
  const pose = {
    yaw: new Spring(0, 60, 9), pitch: new Spring(0, 60, 9), roll: new Spring(0, 70, 10),
    jaw: new Spring(0.035, 140, 13),
    recoilZ: new Spring(0, 220, 14), recoilY: new Spring(0, 220, 14),
  };
  let clock = 0;
  const lookAt = new THREE.Vector3(0, 0, 8);

  const head = {
    root, pivot, skull, jaw, jawPivot, mats, targets, mech, pose, shellMesh, jawMesh,
    idle: true,
    gaze: lookAt,

    setJaw(angle) { pose.jaw.target = angle; },
    /** Knock the head: impulses in rad/s (yaw, pitch, roll) and units/s (z, y). */
    kick({ yaw = 0, pitch = 0, roll = 0, z = 0, y = 0 }) {
      pose.yaw.kick(yaw); pose.pitch.kick(pitch); pose.roll.kick(roll);
      pose.recoilZ.kick(z); pose.recoilY.kick(y);
    },

    update(dt) {
      clock += dt;
      if (head.idle) {
        pose.yaw.target = Math.sin(clock * 0.31) * 0.07 + Math.sin(clock * 0.13 + 1.3) * 0.05;
        pose.pitch.target = Math.sin(clock * 0.23 + 0.6) * 0.03;
        pose.roll.target = Math.sin(clock * 0.17 + 2.1) * 0.015;
      }
      pivot.rotation.set(pose.pitch.update(dt), pose.yaw.update(dt), pose.roll.update(dt), 'YXZ');
      pivot.position.set(HEAD_PIVOT[0], HEAD_PIVOT[1] + pose.recoilY.update(dt), HEAD_PIVOT[2] + pose.recoilZ.update(dt));
      fitJawPivot(jawPivot, pose.jaw.update(dt), pivot.rotation.x, pose.recoilY.x, pose.recoilZ.x);
      for (const t of targets.values()) if (t.kind === 'eye') t.eye.update(dt, clock, head);
      mech.update(dt, clock, head);
    },

    /** World-space centre of a target (for cameras, tools and labels). */
    worldPos(id, out = new THREE.Vector3()) {
      const t = targets.get(id);
      if (t.kind === 'eye') return t.eye.group.getWorldPosition(out);
      return t.seat.getWorldPosition(out);
    },
  };
  return head;
}
