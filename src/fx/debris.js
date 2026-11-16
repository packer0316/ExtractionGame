import * as THREE from 'three';
import { FLOOR_Y } from '../model/layout.js';

const GRAVITY = 17;
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Light rigid bodies for things knocked off the head: glass shards, teeth.
 * Each body is a mesh living directly in the scene (world space) that
 * tumbles, bounces on the floor and finally settles lying flat.
 */
export class Debris {
  constructor(scene) {
    this.scene = scene;
    this.bodies = [];
  }

  /**
   * @param mesh    object already attached to the scene in world space
   * @param opts.vel       initial velocity (Vector3)
   * @param opts.spin      angular velocity, rad/s (Vector3)
   * @param opts.radius    collision radius against the floor
   * @param opts.flatAxis  local axis that should end up vertical when at rest
   * @param opts.onHit     callback(speed) on every floor contact
   */
  add(mesh, { vel, spin, radius = 0.03, bounce = 0.36, friction = 0.62, flatAxis = null, rest = radius * 0.4, onHit = null }) {
    this.bodies.push({
      mesh, vel: vel.clone(), spin: spin.clone(), radius, bounce, friction, flatAxis, restHeight: rest, onHit,
      state: 'fly', settle: 0, from: new THREE.Quaternion(), to: new THREE.Quaternion(),
    });
  }

  update(dt) {
    for (const b of this.bodies) {
      if (b.state === 'rest') continue;
      const m = b.mesh;
      if (b.state === 'settle') {
        b.settle = Math.min(b.settle + dt / 0.22, 1);
        const k = 1 - Math.pow(1 - b.settle, 3);
        m.quaternion.slerpQuaternions(b.from, b.to, k);
        m.position.y += (FLOOR_Y + b.restHeight - m.position.y) * k;
        if (b.settle >= 1) b.state = 'rest';
        continue;
      }
      b.vel.y -= GRAVITY * dt;
      b.vel.multiplyScalar(1 - 0.12 * dt);
      m.position.addScaledVector(b.vel, dt);
      const w = b.spin.length();
      if (w > 1e-4) {
        _q.setFromAxisAngle(_axis.copy(b.spin).multiplyScalar(1 / w), w * dt);
        m.quaternion.premultiply(_q);
      }
      if (m.position.y - b.radius < FLOOR_Y) {
        m.position.y = FLOOR_Y + b.radius;
        const impact = -b.vel.y;
        if (impact > 0.9) {
          b.vel.y = impact * b.bounce;
          b.vel.x *= b.friction; b.vel.z *= b.friction;
          b.spin.multiplyScalar(0.55).add(_axis.set(b.vel.z, 0, -b.vel.x).multiplyScalar(1 / Math.max(b.radius, 0.02) * 0.25));
          if (b.onHit) b.onHit(impact, m.position);
        } else {
          b.vel.y = 0;
          b.vel.x *= 1 - Math.min(1, 9 * dt); b.vel.z *= 1 - Math.min(1, 9 * dt);
          b.spin.multiplyScalar(1 - Math.min(1, 10 * dt));
          if (b.vel.lengthSq() < 0.02) this._startSettle(b);
        }
      }
    }
  }

  _startSettle(b) {
    b.state = 'settle';
    b.settle = 0;
    b.from.copy(b.mesh.quaternion);
    b.to.copy(b.mesh.quaternion);
    if (b.flatAxis) {
      // rotate the shortest way so the flat axis points straight up or down
      _axis.copy(b.flatAxis).applyQuaternion(b.mesh.quaternion).normalize();
      _up.set(0, _axis.y >= 0 ? 1 : -1, 0);
      _q.setFromUnitVectors(_axis, _up);
      b.to.premultiply(_q);
    }
  }

  /** Remove everything (used when a fresh head is built). */
  clear() {
    for (const b of this.bodies) {
      b.mesh.removeFromParent();
      if (b.mesh.userData.disposeGeometry) b.mesh.geometry.dispose();
    }
    this.bodies.length = 0;
  }
}
