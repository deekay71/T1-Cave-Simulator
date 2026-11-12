/**
 * Pure helpers behind camera.ts (no PlayCanvas import, unit-tested in scripts/camera.test.ts).
 *
 * Yaw convention: camera yaw θ (degrees) looks along (sin θ, 0, cos θ). Screen right is then
 * (-cos θ, 0, sin θ). Positive pitch looks down. θ = 180 looks toward -Z (the exit tunnel).
 */
import {
  AXIS_MAX,
  boomInRooms,
  CAVE_CAMERA_MARGIN,
  CAVE_CAMERA_TOP,
  HUB_RADIUS,
  HUB_ROOMS,
  type Room,
} from "@te-liet/shared";

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
  /** Elevated architecture can leave clear space below (e.g. an arch lintel). */
  bottom?: number;
}

/**
 * Where the camera may be. Two shapes:
 * - `rooms` set (the cave): the union of the walk rooms (vertical discs: the big cave, the side
 *   caves, the tunnels as chains of small discs) grown by `roomMargin`, between `minY` and each
 *   room's own ceiling (`Room.top`, or `maxY` for a room without one). Not convex: the boom is
 *   followed room by room from the pivot (shared boomInRooms), so the camera never ends up behind
 *   the rock between a tunnel and a cave.
 * - no `rooms` (the shrine island): a vertical cylinder of `maxRadius` around (centerX, centerZ),
 *   between `minY` and `maxY`.
 */
export interface CameraBounds {
  maxRadius: number;
  centerX?: number;
  centerZ?: number;
  minY: number;
  maxY: number;
  /** Walk rooms of a multi-cave world; when set, maxRadius / centerX / centerZ are not used. */
  rooms?: readonly Room[];
  /** The camera may sit this far (m) outside the union of the rooms (default 0). */
  roomMargin?: number;
  /**
   * Optional tall props (torches, boards, rocks) the camera point must stay out of. Only the
   * camera point counts: a prop between the camera and the pivot may occlude, it does not pull
   * the boom in. A camera point inside one moves in to where the boom enters it (its near side).
   */
  blockers?: readonly Blocker[];
}
/**
 * The cave: the shared walk rooms + 0.6 m, 0.6 m above the floor up to 9 m in the big cave, 2.6 m
 * in the tunnels and 3.2 m in the side caves (below that the shell has no rock within 0.75 m of
 * the walk area). maxRadius is the big cave's own limit, for callers that want a plain number.
 */
export const CAVE_BOUNDS: CameraBounds = {
  maxRadius: HUB_RADIUS + CAVE_CAMERA_MARGIN,
  minY: 0.6,
  maxY: CAVE_CAMERA_TOP.main,
  rooms: HUB_ROOMS,
  roomMargin: CAVE_CAMERA_MARGIN,
};

/** Nearest point of the union of the rooms grown by `grow` (the point itself when inside). */
function intoRooms(x: number, z: number, rooms: readonly Room[], grow: number): { x: number; z: number } {
  let best: Room | null = null,
    bestDepth = Infinity;
  for (const o of rooms) {
    const d = Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z)) - o.r - grow;
    if (d <= 0) return { x, z };
    if (d < bestDepth) {
      best = o;
      bestDepth = d;
    }
  }
  if (!best) return { x, z };
  const ox = x - best.x,
    oz = z - best.z,
    d = Math.sqrt(ox * ox + oz * oz),
    k = (best.r + grow) / d;
  return { x: best.x + ox * k, z: best.z + oz * k };
}

/**
 * Camera ceiling (m) above (x, z): the highest `top` among the rooms (grown by the margin) that
 * hold the point; `maxY` for rooms without one, and when no room holds it.
 */
export function ceilingAt(x: number, z: number, bounds: CameraBounds): number {
  if (!bounds.rooms) return bounds.maxY;
  const grow = bounds.roomMargin ?? 0;
  let top = -Infinity;
  for (const o of bounds.rooms) {
    const dx = x - o.x,
      dz = z - o.z,
      r = o.r + grow + 1e-6; // a camera point stopped exactly on a room's edge still counts as in it
    if (dx * dx + dz * dz <= r * r) top = Math.max(top, o.top ?? bounds.maxY);
  }
  return top === -Infinity ? bounds.maxY : top;
}

/**
 * True when the straight floor-plan segment from (ax, az) to (bx, bz) stays inside the union of
 * the rooms grown by `margin`: nothing of the cave's rock lies between the two points (used to
 * hide name tags of players behind a wall, in another cave or round a tunnel's corner).
 */
export function clearLine(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  rooms: readonly Room[],
  margin = 0,
): boolean {
  const dx = ax - bx,
    dz = az - bz,
    len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return true;
  // boomInRooms walks pivot - dir * t: from b toward a
  const reach = boomInRooms({ x: bx, y: 0, z: bz }, { x: -dx / len, y: 0, z: -dz / len }, len, rooms, { margin });
  return reach >= len - 1e-3;
}

/** Room-shaped containment (see CameraBounds.rooms). */
function boomInBounds(pivot: V3, dir: V3, want: number, rooms: readonly Room[], bounds: CameraBounds): number {
  const margin = bounds.roomMargin ?? 0;
  const opts = { margin, top: bounds.maxY, minY: bounds.minY };
  // A pivot outside the grown union (the over-the-shoulder shift of a player backed against a
  // wall, or one a few cm past the limit) is measured from the nearest point inside, 1 cm in, so
  // the boom does not collapse to zero; the camera then sits that little further out.
  const inside = intoRooms(pivot.x, pivot.z, rooms, margin - 0.01);
  const from = inside.x === pivot.x && inside.z === pivot.z ? pivot : { x: inside.x, y: pivot.y, z: inside.z };
  return boomInRooms(from, dir, want, rooms, opts);
}

/**
 * Longest boom b in [0, want] that keeps pivot - dir * b inside the bounds.
 * - Rooms: the boom is walked from the pivot through the chain of rooms it crosses (under each
 *   room's ceiling), and stops where it would leave their union.
 * - Cylinder: the region is convex and contains the pivot, so shortening the boom toward the pivot
 *   never crosses a wall. A pivot already outside the cylinder (e.g. a player squeezed past
 *   maxRadius) gets 0.3 m of slack instead of collapsing the boom to zero.
 */
export function containBoom(pivot: V3, dir: V3, want: number, bounds: CameraBounds = CAVE_BOUNDS): number {
  let b = want;
  if (bounds.rooms) b = boomInBounds(pivot, dir, want, bounds.rooms, bounds);
  else {
    if (dir.y < -1e-9) b = Math.min(b, (bounds.maxY - pivot.y) / -dir.y);
    else if (dir.y > 1e-9) b = Math.min(b, (pivot.y - bounds.minY) / dir.y);
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a > 1e-12) {
      const px = pivot.x - (bounds.centerX ?? 0), pz = pivot.z - (bounds.centerZ ?? 0);
      const r = Math.max(bounds.maxRadius, Math.sqrt(px * px + pz * pz) + 0.3);
      const pd = px * dir.x + pz * dir.z;
      const c = px * px + pz * pz - r * r; // <= 0
      b = Math.min(b, (pd + Math.sqrt(Math.max(0, pd * pd - a * c))) / a);
    }
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
  if (cx * cx + cz * cz >= k.r * k.r || pivot.y - dir.y * b >= k.top || pivot.y - dir.y * b <= (k.bottom ?? -Infinity)) return b;
  const px = pivot.x - k.x,
    pz = pivot.z - k.z;
  const c = px * px + pz * pz - k.r * k.r;
  const a = dir.x * dir.x + dir.z * dir.z;
  if ((c <= 0 && k.bottom === undefined) || a < 1e-12) return b;
  // |p - d t|^2 = r^2: the smaller root is where the boom enters the footprint
  const pd = px * dir.x + pz * dir.z;
  let t = c <= 0 ? 0 : (pd - Math.sqrt(Math.max(0, pd * pd - a * c))) / a;
  // looking up, the camera sinks as the boom grows: it may enter through the top instead
  if (dir.y > 1e-9 && pivot.y > k.top) t = Math.max(t, (pivot.y - k.top) / dir.y);
  if (dir.y < -1e-9 && k.bottom !== undefined && pivot.y < k.bottom) t = Math.max(t, (pivot.y - k.bottom) / dir.y);
  return Math.max(0, Math.min(b, t - 1e-6));
}

/** Prop shortening eases in at this rate (1/s): a 0.5 m step takes ~0.1 s instead of one frame. */
export const BOOM_IN_RATE = 25;
/** Lengthening back out (after a wall or prop) eases at this rate (1/s). */
export const BOOM_OUT_RATE = 5;

/**
 * One frame of boom easing (the boom actually used, m).
 * - `wall`: longest boom the cave rooms (or the cylinder) and the height band allow. Hard limit:
 *   snaps in at once.
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
