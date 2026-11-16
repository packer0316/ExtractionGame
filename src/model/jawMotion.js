import { HINGE } from './layout.js';

// A sliding hinge gives the mandible a forward path before it sweeps down.
// All jaw-mounted parts inherit this carriage transform, including teeth/picking.
export const JAW_MOTION = {
  maxAngle: 0.68, restAngle: 0.035, engagement: 0.38,
  travel: 0.55, flexionTravel: 0.65, flexionLift: 0.18, drop: 0.025,
  recoilTravelZ: 1.2, recoilTravelY: 1.4, recoilLift: 1.3,
};

export function fitJawPivot(pivot, angle, pitch = 0, recoilY = 0, recoilZ = 0) {
  const a = Math.max(0, Math.min(JAW_MOTION.maxAngle, angle));
  const opening = Math.max(0, a - JAW_MOTION.restAngle);
  const flex = Math.max(0, Math.min(1, opening / JAW_MOTION.engagement));
  const engaged = flex * flex * (3 - 2 * flex);
  // The cam rises during flexion/recoil so advancing a tilted jaw does not
  // drive the chin down into the base collar. Compensation fades out on closing.
  const advance = JAW_MOTION.travel * Math.sin(opening)
    + (JAW_MOTION.flexionTravel * Math.max(0, pitch)
      + Math.max(0, -recoilZ) * JAW_MOTION.recoilTravelZ
      + Math.max(0, -recoilY) * JAW_MOTION.recoilTravelY) * engaged;
  const drop = JAW_MOTION.drop * (1 - Math.cos(opening * 2));
  const lift = (Math.max(0, pitch) * JAW_MOTION.flexionLift + Math.max(0, -recoilY) * JAW_MOTION.recoilLift) * engaged;
  pivot.position.set(0, HINGE.y - drop + lift, HINGE.z + advance);
  pivot.rotation.x = a;
}
