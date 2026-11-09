/**
 * Pure helpers behind camera.ts (no PlayCanvas import, unit-tested in scripts/camera.test.ts).
 *
 * Yaw convention: camera yaw θ (degrees) looks along (sin θ, 0, cos θ). Screen right is then
 * (-cos θ, 0, sin θ). Positive pitch looks down. θ = 180 looks toward -Z (the exit tunnel).
 */
import { AXIS_MAX } from "@te-liet/shared";

export const DEG = Math.PI / 180;

export interface Axes {
  moveX: number;
  moveZ: number;
}

/**
 * Camera-relative stick (right, forward in [-1, 1]) -> world int8 axes for MoveInput.
 * The direction is kept and scaled so the larger component is exactly ±axisMax (so the length is
 * >= axisMax and applyInput moves at full speed); the other component is rounded. Zero (or
 * cancelled opposite keys, or NaN) gives (0, 0). Apply any stick dead zone before calling.
 */
export function stickToWorld(
  yawDeg: number,
  right: number,
  forward: number,
  axisMax: number = AXIS_MAX,
): Axes {
  const a = yawDeg * DEG;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const x = -c * right + s * forward;
  const z = s * right + c * forward;
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (!(m > 1e-9)) return { moveX: 0, moveZ: 0 };
  const q = (v: number) => {
    const r = Math.round((v / m) * axisMax);
    return (r > axisMax ? axisMax : r < -axisMax ? -axisMax : r) || 0; // || 0 drops -0
  };
  return { moveX: q(x), moveZ: q(z) };
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Unit look direction for yaw / pitch in degrees (positive pitch looks down). */
export function lookDir(yawDeg: number, pitchDeg: number, out: V3): V3 {
  const a = yawDeg * DEG;
  const p = pitchDeg * DEG;
  out.x = Math.sin(a) * Math.cos(p);
  out.y = -Math.sin(p);
  out.z = Math.cos(a) * Math.cos(p);
  return out;
}

/** A tall prop the camera must not enter: a vertical cylinder from the floor up to `top` (m). */
export interface Blocker {
  x: number;
  z: number;
  r: number;
  top: number;
}

/** Where the camera may be: a vertical cylinder around the cave centre, between two heights. */
export interface CameraBounds {
  maxRadius: number;
  minY: number;
  maxY: number;
  /**
   * Optional tall props (torches, boards, rocks) the camera point must stay out of. Only the
   * camera point counts: a prop between the camera and the pivot may occlude, it does not pull
   * the boom in. A camera point inside one moves in to where the boom enters it (its near side).
   */
  blockers?: readonly Blocker[];
}
export const CAVE_BOUNDS: CameraBounds = { maxRadius: 16.8, minY: 0.6, maxY: 9 };

/**
 * Longest boom b in [0, want] that keeps pivot - dir * b inside the bounds. The region is convex
 * and contains the pivot, so shortening the boom toward the pivot never crosses a wall. A pivot
 * already outside the cylinder (e.g. a player squeezed past maxRadius) gets 0.3 m of slack
 * instead of collapsing the boom to zero.
 */
export function containBoom(pivot: V3, dir: V3, want: number, bounds: CameraBounds = CAVE_BOUNDS): number {
  let b = want;
  if (dir.y < -1e-9) b = Math.min(b, (bounds.maxY - pivot.y) / -dir.y);
  else if (dir.y > 1e-9) b = Math.min(b, (pivot.y - bounds.minY) / dir.y);
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 1e-12) {
    const r = Math.max(bounds.maxRadius, Math.sqrt(pivot.x * pivot.x + pivot.z * pivot.z) + 0.3);
    const pd = pivot.x * dir.x + pivot.z * dir.z;
    const c = pivot.x * pivot.x + pivot.z * pivot.z - r * r; // <= 0
    b = Math.min(b, (pd + Math.sqrt(Math.max(0, pd * pd - a * c))) / a);
  }
  if (bounds.blockers?.length && b > 0) b = outsideBlockers(pivot, dir, b, bounds.blockers);
  return b > 0 ? b : 0;
}

/**
 * Longest boom <= b whose camera point (pivot - dir * b) is outside every blocker: a camera point
 * inside one moves in to where the boom enters that blocker (repeated while it lands in another).
 * A blocker whose footprint holds the pivot itself is ignored.
 */
export function outsideBlockers(pivot: V3, dir: V3, b: number, blockers: readonly Blocker[]): number {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const k of blockers) {
      const e = blockerEntry(pivot, dir, b, k);
      if (e < b) {
        b = e;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return b;
}

/** Boom at which the camera ray enters blocker k, when the camera point at boom b is inside it; else b. */
function blockerEntry(pivot: V3, dir: V3, b: number, k: Blocker): number {
  const cx = pivot.x - dir.x * b - k.x,
    cz = pivot.z - dir.z * b - k.z;
  if (cx * cx + cz * cz >= k.r * k.r || pivot.y - dir.y * b >= k.top) return b;
  const px = pivot.x - k.x,
    pz = pivot.z - k.z;
  const c = px * px + pz * pz - k.r * k.r;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (c <= 0 || a < 1e-12) return b;
  // |p - d t|^2 = r^2: the smaller root is where the boom enters the footprint
  const pd = px * dir.x + pz * dir.z;
  let t = (pd - Math.sqrt(Math.max(0, pd * pd - a * c))) / a;
  // looking up, the camera sinks as the boom grows: it may enter through the top instead
  if (dir.y > 1e-9 && pivot.y > k.top) t = Math.max(t, (pivot.y - k.top) / dir.y);
  return Math.max(0, Math.min(b, t - 1e-6));
}

/** Prop shortening eases in at this rate (1/s): a 0.5 m step takes ~0.1 s instead of one frame. */
export const BOOM_IN_RATE = 25;
/** Lengthening back out (after a wall or prop) eases at this rate (1/s). */
export const BOOM_OUT_RATE = 5;

/**
 * One frame of boom easing (the boom actually used, m).
 * - `wall`: longest boom the cave cylinder / height band allow. Hard limit: snaps in at once.
 * - `want`: the boom also clear of the blockers (<= wall). A prop coming between eases the boom in
 *   quickly (BOOM_IN_RATE) instead of popping it in one frame; the camera point may sit inside the
 *   prop's cylinder (around a thin pole) for those few frames.
 * - Lengthening eases out (BOOM_OUT_RATE) and stops at the near side of a blocker it would enter
 *   (the camera never eases out through a prop; it waits until the line is clear).
 * A non-finite `boom` (spawn / teleport) jumps straight to `want`.
 */
export function stepBoom(
  boom: number,
  wall: number,
  want: number,
  dt: number,
  pivot: V3,
  dir: V3,
  blockers?: readonly Blocker[],
): number {
  if (!Number.isFinite(boom)) return want;
  if (boom > wall) boom = wall;
  if (want < boom) return boom + (want - boom) * (1 - Math.exp(-BOOM_IN_RATE * dt));
  if (want > boom) {
    const out = boom + (want - boom) * (1 - Math.exp(-BOOM_OUT_RATE * dt));
    return blockers?.length ? Math.max(boom, outsideBlockers(pivot, dir, out, blockers)) : out;
  }
  return boom;
}

/** The over-the-shoulder shift never exceeds this fraction of the boom (avatar kept near the centre). */
export const SHOULDER_MAX_TAN = 0.15;

/**
 * Sideways shift (m) of the camera pivot toward the camera's right for an over-the-shoulder view:
 * the avatar sits left of the screen centre, so what it walks up to stays visible. `shoulder` at a
 * normal boom; capped at SHOULDER_MAX_TAN x boom so a short boom (backed against a wall) keeps the
 * avatar near the middle of the screen instead of pushing it off the left edge.
 */
export function shoulderShift(shoulder: number, boom: number): number {
  return Math.max(0, Math.min(shoulder, SHOULDER_MAX_TAN * boom));
}

/**
 * Vertical FOV (deg) for a screen of this aspect (width / height): `vfov` on landscape screens,
 * wider on narrow (portrait) ones so the horizontal view keeps at least `minHfov` degrees, capped
 * at `maxVfov` (beyond that the perspective stretches too much).
 */
export function fitFov(vfov: number, aspect: number, minHfov = 60, maxVfov = 75): number {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return vfov;
  const need = (2 * Math.atan(Math.tan((minHfov * DEG) / 2) / aspect)) / DEG;
  return Math.max(vfov, Math.min(need, maxVfov));
}

/** Critically damped spring, exact for a target held constant over dt (frame-rate independent). */
export function springStep(
  x: number,
  v: number,
  target: number,
  omega: number,
  dt: number,
  out: { x: number; v: number },
) {
  const e = x - target;
  const t = (v + omega * e) * dt;
  const k = Math.exp(-omega * dt);
  out.v = (v - omega * t) * k;
  out.x = target + (e + t) * k;
  return out;
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(a: number): number {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
