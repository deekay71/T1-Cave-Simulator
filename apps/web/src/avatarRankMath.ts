/**
 * Pure helpers behind the rank looks of avatar.ts / avatarProgression.ts (no PlayCanvas import,
 * unit-tested in scripts/avatarRank.test.ts): a two-bone arm solver for the fan rig, the ground
 * path of a crutch tip, rolling maths for wheels, casters and the pulled trolley.
 *
 * Rig facts (tools/models/groups/characters.ts, manifest meta.rig): shoulders at (+-0.27, 0.30, 0)
 * in spine space (left = +X), upper arm 0.28 m and forearm + hand hang along -Y with a 4 deg
 * outward tilt baked into the meshes, the elbow only bends about the forearm's local X (X < 0 =
 * hand forward / up), there is no wrist.
 */

const RAD = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ arm IK */

export const ARM = {
  shoulderX: 0.27,
  shoulderY: 0.3,
  /** elbow in arm_upper space (left arm; the right arm mirrors x) */
  elbowX: 0.28 * Math.sin(4 * RAD),
  elbowY: -0.28 * Math.cos(4 * RAD),
  /** centre of the hand block in arm_lower space (left arm) */
  handX: 0.265 * Math.sin(4 * RAD),
  handY: -0.265 * Math.cos(4 * RAD),
  handZ: 0.004,
} as const;

/** Local rotations that put the hand (or another point of the forearm) on a target. */
export interface ArmPose {
  /** arm_upper local rotation (quaternion) */
  x: number;
  y: number;
  z: number;
  w: number;
  /** arm_lower local X rotation in degrees (<= 0: elbow bent, hand forward) */
  elbow: number;
  /** target distance / what the arm can cover (> 1: out of reach, the arm points at it) */
  reach: number;
}
export const armPose = (): ArmPose => ({ x: 0, y: 0, z: 0, w: 1, elbow: 0, reach: 0 });

/**
 * Two-bone solve. (tx, ty, tz) = target relative to the shoulder pivot, in the SPINE's space.
 * side: 1 left arm, -1 right arm. (gx, gy, gz) = the point of the forearm that goes on the target,
 * in arm_lower space of the LEFT arm (x is mirrored for the right arm), default the hand centre.
 * twistDeg turns the solved arm about the shoulder -> target line (elbow in / out).
 * The elbow angle comes from the law of cosines, the upper arm from the shortest arc that carries
 * the bent arm onto the target, so a hanging arm with a target in front keeps its elbow down.
 */
export function solveArm(
  side: 1 | -1,
  tx: number,
  ty: number,
  tz: number,
  out: ArmPose,
  twistDeg = 0,
  gx: number = ARM.handX,
  gy: number = ARM.handY,
  gz: number = ARM.handZ,
): ArmPose {
  const ex = side * ARM.elbowX,
    ey = ARM.elbowY;
  const fx = side * gx,
    fy = gy,
    fz = gz;
  const rho = Math.sqrt(fy * fy + fz * fz);
  const d2 = tx * tx + ty * ty + tz * tz;
  const d = Math.sqrt(d2);
  // |E + Rx(a) f|^2 = c0 + 2 (ex fx + ey rho cos(a + delta))
  const c0 = ex * ex + ey * ey + fx * fx + rho * rho;
  let delta = Math.atan2(fz, fy);
  if (delta < 0) delta += Math.PI * 2;
  const c = clamp(((d2 - c0) / 2 - ex * fx) / (ey * rho), -1, 1);
  const a = clamp(Math.acos(c) - delta, -2.7, 0.06);
  const ca = Math.cos(a),
    sa = Math.sin(a);
  // bent arm: shoulder -> grip point in arm_upper space
  const vx = ex + fx,
    vy = ey + fy * ca - fz * sa,
    vz = fy * sa + fz * ca;
  const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  out.elbow = a / RAD;
  out.reach = d / (Math.sqrt(ex * ex + ey * ey) + Math.sqrt(fx * fx + rho * rho));
  if (d < 1e-6) {
    out.x = out.y = out.z = 0;
    out.w = 1;
    return out;
  }
  const ax = vx / vl,
    ay = vy / vl,
    az = vz / vl;
  const bx = tx / d,
    by = ty / d,
    bz = tz / d;
  // shortest arc a -> b
  let qx = ay * bz - az * by,
    qy = az * bx - ax * bz,
    qz = ax * by - ay * bx,
    qw = 1 + ax * bx + ay * by + az * bz;
  if (qw < 1e-6) {
    // opposite directions: half a turn about any axis perpendicular to a
    qw = 0;
    if (Math.abs(ax) > Math.abs(az)) {
      qx = -ay;
      qy = ax;
      qz = 0;
    } else {
      qx = 0;
      qy = -az;
      qz = ay;
    }
  }
  let l = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  qx *= l;
  qy *= l;
  qz *= l;
  qw *= l;
  if (twistDeg !== 0) {
    const h = twistDeg * RAD * 0.5;
    const s = Math.sin(h),
      tw = Math.cos(h);
    const ux = bx * s,
      uy = by * s,
      uz = bz * s;
    // twist * swing
    const rx = tw * qx + ux * qw + uy * qz - uz * qy;
    const ry = tw * qy - ux * qz + uy * qw + uz * qx;
    const rz = tw * qz + ux * qy - uy * qx + uz * qw;
    const rw = tw * qw - ux * qx - uy * qy - uz * qz;
    l = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
    qx = rx * l;
    qy = ry * l;
    qz = rz * l;
    qw = rw * l;
  }
  out.x = qx;
  out.y = qy;
  out.z = qz;
  out.w = qw;
  return out;
}

/** Forward kinematics of solveArm's result: where the grip point ends up (shoulder-relative, spine space). */
export function armReach(
  side: 1 | -1,
  p: ArmPose,
  out: { x: number; y: number; z: number },
  gx: number = ARM.handX,
  gy: number = ARM.handY,
  gz: number = ARM.handZ,
): { x: number; y: number; z: number } {
  const a = p.elbow * RAD;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  const vx = side * (ARM.elbowX + gx),
    vy = ARM.elbowY + gy * ca - gz * sa,
    vz = gy * sa + gz * ca;
  // rotate v by the quaternion
  const { x, y, z, w } = p;
  const cx = y * vz - z * vy,
    cy = z * vx - x * vz,
    cz = x * vy - y * vx;
  out.x = vx + 2 * (w * cx + y * cz - z * cy);
  out.y = vy + 2 * (w * cy + z * cx - x * cz);
  out.z = vz + 2 * (w * cz + x * cy - y * cx);
  return out;
}

/* ------------------------------------------------------------------ crutches */

/** Share of the walk cycle a crutch tip stays planted (the rest it swings forward). */
export const CRUTCH_DUTY = 0.36;

export interface CrutchTip {
  /** forward offset from the middle of the plant (m), + = ahead */
  z: number;
  /** height above the floor (m) */
  lift: number;
  planted: boolean;
}

/**
 * Tip of one crutch at its own phase p in [0, 1): planted on [0, duty) while the body walks past
 * it (the body covers 2 * stride per cycle, so the tip slides back at exactly that rate and does
 * not skate), then lifted and swung forward to the next plant. Two-point gait: the caller offsets
 * the phase so each crutch lands with the opposite foot.
 */
export function crutchTip(p: number, stride: number, lift: number, out: CrutchTip, duty = CRUTCH_DUTY): CrutchTip {
  p -= Math.floor(p);
  const half = stride * duty; // half the planted travel
  if (p < duty) {
    out.z = half - 2 * stride * p;
    out.lift = 0;
    out.planted = true;
  } else {
    const u = (p - duty) / (1 - duty);
    const e = u * u * (3 - 2 * u);
    out.z = -half + 2 * half * e;
    const s = Math.sin(Math.PI * u);
    out.lift = lift * s * s;
    out.planted = false;
  }
  return out;
}

/* ------------------------------------------------------------------ rolling */

/** Shortest signed difference a - b of two angles in radians, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * One step of a heading that trails a target heading (rad): first-order lag with time constant
 * tau, never turning faster than maxRate (rad/s). Returns the new heading.
 */
export function trailAngle(current: number, target: number, dt: number, tau: number, maxRate: number): number {
  const d = angleDelta(target, current);
  let step = d * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
  const max = maxRate * dt;
  if (step > max) step = max;
  else if (step < -max) step = -max;
  return current + step;
}

/**
 * Spin (rad, about the wheel's local X; + = rolling toward +Z) of a wheel at lateral offset x
 * (m, + = the vehicle's left) for a move of `forward` metres and a yaw change dYaw (rad, + =
 * turning left): the inner wheel of a turn rolls less, in a spin on the spot the two counter-rotate.
 */
export const wheelSpin = (forward: number, dYaw: number, x: number, radius: number): number =>
  (forward - dYaw * x) / radius;

/**
 * Local velocity (m/s, vehicle frame) of a point at (x, z) on a vehicle moving at (vx, vz) and
 * turning at `yawRate` rad/s (+ = left): what a swivel caster under that point aligns with.
 */
export function pointVelocity(
  vx: number,
  vz: number,
  yawRate: number,
  x: number,
  z: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  out.x = vx + yawRate * z;
  out.z = vz - yawRate * x;
  return out;
}
