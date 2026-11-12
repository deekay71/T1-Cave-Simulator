/**
 * Third-person follow camera for the cave.
 *
 *   const cam = createFollowCamera(cameraEntity);          // yaw 180, pitch 18, boom 5.5 m
 *   cam.attach(canvas);                                    // drag = orbit, wheel / pinch = zoom
 *   cam.snapBehind(180);                                   // spawn: look toward -Z, no easing
 *   // every frame, after the local avatar moved:
 *   cam.focus = nearLandmark && standingStill;             // optional "look at it" framing
 *   cam.update(dt, avatarFeetPosition);
 *   const { moveX, moveZ } = cam.toWorldAxes(d - a, w - s); // camera-relative WASD -> MoveInput
 *
 * - Yaw θ (deg) looks along (sin θ, 0, cos θ); it only changes when the user drags (no
 *   auto-rotate). Pitch in [-25, 60] deg, positive = looking down. Boom 2.5-8 m (smoothed zoom).
 *   Below -5 deg the boom stays where it is at -5 and only the view tilts up (look up at the big
 *   screen high on the wall without the camera diving to the floor behind the avatar).
 * - The pivot (target + 1.3 m) follows with a critically damped spring: no jitter from 20 Hz
 *   snapshots, a small steady lag (~0.4 m at 4 m/s).
 * - Over the shoulder: the pivot sits 0.45 m to the camera's right (less on a short boom, see
 *   cameraMath.shoulderShift), so the avatar stands left of the screen centre and does not hide
 *   what it walks up to; the 18 deg pitch keeps things 1-2 m beyond the head visible over it.
 *   `focus` eases that to 0.75 m and 6 deg more pitch over 0.35 s (and back when cleared).
 * - Containment: the boom is shortened toward the pivot so the camera stays inside the cave's
 *   walk rooms + 0.6 m (big cave, tunnels, side caves: CameraBounds.rooms), 0.6 m above the floor
 *   and under each room's ceiling (9 m / 2.6 m / 3.2 m); it snaps in at once and eases back out.
 *   setBoundsCenter() switches to a plain cylinder (the shrine island), useRooms() back. When the
 *   boom gets short (player backed against the wall) the pivot rises up to 0.45 m so the camera
 *   looks over the avatar's head; `boom` tells the caller how close it is (fade the avatar < ~1.8 m).
 *   Optional `bounds.blockers` (tall props): the camera point stays out of them. A prop coming
 *   between eases the boom in quickly (~0.1 s, no one-frame pop); it never eases back out through one.
 * - Pointer: one mouse button (left or right) or one finger drags to orbit after a 4 px threshold
 *   (clicks still work; the click that ends a drag is swallowed). Two fingers pinch-zoom. Drags and
 *   wheel events that start on UI (anything but `el` itself or a canvas) are ignored and never
 *   preventDefault-ed. A press on the scene captures the pointer, so a release over UI or outside
 *   the window still ends it; a mouse that moves with no button down (release missed) or a window
 *   blur forgets it, so hovering never orbits. attach() sets touch-action: none on `el`.
 */
import * as pc from "playcanvas";
import {
  CAVE_BOUNDS,
  DEG,
  ceilingAt,
  containBoom,
  lookDir,
  outsideBlockers,
  shoulderShift,
  springStep,
  stepBoom,
  stickToWorld,
  wrapDeg,
  type Axes,
  type CameraBounds,
} from "./cameraMath.js";

export interface FollowCamera {
  /** Smooth third-person follow of target (the avatar's feet). */
  update(dt: number, target: pc.Vec3): void;
  /** Camera-relative stick in [-1, 1] -> int8 world axes for MoveInput (full speed, exact). */
  toWorldAxes(right: number, forward: number): Axes;
  /** Look along a heading (deg) and jump there on the next update (spawn / teleport). */
  snapBehind(yawDeg: number): void;
  /** Contain the camera in a cylinder of `radius` around (x, z) instead of the rooms (the shrine island). */
  setBoundsCenter(x: number, z: number, radius: number): void;
  /** Back to the rooms of the bounds the camera was created with (the cave); no-op without rooms. */
  useRooms(): void;
  attach(el: HTMLElement): void;
  detach(): void;
  yaw: number;
  /** The user's pitch (deg, -5..60); `focus` adds up to 6 deg on top while it is set. */
  pitch: number;
  /** Wanted boom length (m), 2.5-8; the wheel / pinch change it. */
  distance: number;
  /** "Look at it" framing (wider shoulder shift, a little more pitch), eased over 0.35 s. */
  focus: boolean;
  /** Boom actually used after cave containment (m). */
  readonly boom: number;
}

export interface FollowCameraOptions {
  yaw: number;
  pitch: number;
  distance: number;
  /** pivot height above the target (m) */
  height: number;
  /** sideways pivot shift toward the camera's right (m), 0 = avatar centred */
  shoulder: number;
  bounds: CameraBounds;
}

const DEFAULTS: FollowCameraOptions = {
  yaw: 180,
  pitch: 18,
  distance: 5.5,
  height: 1.3,
  shoulder: 0.45,
  bounds: CAVE_BOUNDS,
};
const MIN_PITCH = -25;
/** The boom never swings lower than this; a lower pitch only aims the view up. */
const BOOM_MIN_PITCH = -5;
const MAX_PITCH = 60;
const MIN_DIST = 2.5;
const MAX_DIST = 8;
/** spring stiffness of the pivot follow (rad/s); lag at speed v is 2v / FOLLOW */
const FOLLOW = 18;
const ZOOM_RATE = 10;
const DRAG_PX = 4;
const YAW_PER_PX = 0.3;
const PITCH_PER_PX = 0.22;
/** pivot lift when the boom is squeezed by the wall (m), between these boom lengths */
const LIFT = 0.45;
const LIFT_FROM = 2.2;
const LIFT_FULL = 0.9;
/** focus framing: shoulder shift (m), extra pitch (deg), ease time (s) */
const FOCUS_SHOULDER = 0.75;
const FOCUS_PITCH = 6;
const FOCUS_TIME = 0.35;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  dragging: boolean;
}

class OrbitFollowCamera implements FollowCamera {
  private readonly cam: pc.Entity;
  private readonly height: number;
  private readonly shoulder: number;
  private readonly bounds: CameraBounds;
  /** the bounds without blockers (cave rooms or cylinder + height band only) */
  private readonly walls: CameraBounds;
  private _yaw: number;
  private _pitch: number;
  private _distance: number;
  private zoom: number;
  private _boom: number;
  private snap = true;
  private _focus = false;
  /** focus blend progress 0..1 (eased with smoothstep) */
  private focusT = 0;
  private readonly pivot = { x: 0, y: 0, z: 0 };
  private readonly vel = { x: 0, y: 0, z: 0 };
  private readonly dir = { x: 0, y: 0, z: 1 };
  private readonly spring = { x: 0, v: 0 };
  /** the pivot shifted over the shoulder */
  private readonly shifted = { x: 0, y: 0, z: 0 };
  private readonly lifted = { x: 0, y: 0, z: 0 };
  private el: HTMLElement | null = null;
  private prevTouchAction = "";
  private readonly ptrs = new Map<number, Ptr>();
  private pinch = 0;
  private swallowClickUntil = 0;

  constructor(camera: pc.Entity, o: FollowCameraOptions) {
    this.cam = camera;
    this.height = o.height;
    this.shoulder = Math.max(0, o.shoulder);
    this.bounds = o.bounds;
    this.walls = {
      maxRadius: o.bounds.maxRadius,
      minY: o.bounds.minY,
      maxY: o.bounds.maxY,
      rooms: o.bounds.rooms,
      roomMargin: o.bounds.roomMargin,
    };
    this._yaw = wrapDeg(o.yaw);
    this._pitch = clamp(o.pitch, MIN_PITCH, MAX_PITCH);
    this._distance = clamp(o.distance, MIN_DIST, MAX_DIST);
    this.zoom = this._distance;
    this._boom = this._distance;
  }

  get yaw() {
    return this._yaw;
  }
  set yaw(v: number) {
    if (Number.isFinite(v)) this._yaw = wrapDeg(v);
  }
  get pitch() {
    return this._pitch;
  }
  set pitch(v: number) {
    if (Number.isFinite(v)) this._pitch = clamp(v, MIN_PITCH, MAX_PITCH);
  }
  get distance() {
    return this._distance;
  }
  set distance(v: number) {
    if (Number.isFinite(v)) this._distance = clamp(v, MIN_DIST, MAX_DIST);
  }
  get focus() {
    return this._focus;
  }
  set focus(v: boolean) {
    this._focus = !!v;
  }
  get boom() {
    return this._boom;
  }

  snapBehind(yawDeg: number): void {
    this.yaw = yawDeg;
    this.snap = true;
  }

  setBoundsCenter(x: number, z: number, radius: number): void {
    const w = this.walls;
    if (!w.rooms && (w.centerX ?? 0) === x && (w.centerZ ?? 0) === z && w.maxRadius === radius) return;
    w.rooms = undefined;
    w.centerX = x;
    w.centerZ = z;
    w.maxRadius = radius;
    this.snap = true;
  }

  useRooms(): void {
    const w = this.walls;
    if (w.rooms === this.bounds.rooms) return;
    w.rooms = this.bounds.rooms;
    w.centerX = this.bounds.centerX;
    w.centerZ = this.bounds.centerZ;
    w.maxRadius = this.bounds.maxRadius;
    this.snap = true;
  }

  toWorldAxes(right: number, forward: number): Axes {
    return stickToWorld(this._yaw, right, forward);
  }

  update(dt: number, target: pc.Vec3): void {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const gx = target.x,
      gy = target.y + this.height,
      gz = target.z;
    const p = this.pivot,
      v = this.vel,
      s = this.spring;
    const snapped = this.snap;
    if (snapped) {
      this.snap = false;
      p.x = gx;
      p.y = gy;
      p.z = gz;
      v.x = v.y = v.z = 0;
      this.zoom = this._distance;
      this.focusT = this._focus ? 1 : 0;
    } else {
      springStep(p.x, v.x, gx, FOLLOW, dt, s);
      p.x = s.x;
      v.x = s.v;
      springStep(p.y, v.y, gy, FOLLOW, dt, s);
      p.y = s.x;
      v.y = s.v;
      springStep(p.z, v.z, gz, FOLLOW, dt, s);
      p.z = s.x;
      v.z = s.v;
      this.zoom += (this._distance - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
      const goal = this._focus ? 1 : 0;
      const step = dt / FOCUS_TIME;
      this.focusT =
        goal > this.focusT ? Math.min(goal, this.focusT + step) : Math.max(goal, this.focusT - step);
    }
    const f = smooth(this.focusT);
    const pitch = clamp(this._pitch + FOCUS_PITCH * f, MIN_PITCH, MAX_PITCH);
    const d = lookDir(this._yaw, Math.max(pitch, BOOM_MIN_PITCH), this.dir);

    // over the shoulder: shift the pivot toward the camera's right (scaled down on a short boom)
    const free = containBoom(p, d, this.zoom, this.walls);
    const side = shoulderShift(this.shoulder + (FOCUS_SHOULDER - this.shoulder) * f, free);
    const yawRad = this._yaw * DEG;
    const q = this.shifted;
    q.x = p.x - Math.cos(yawRad) * side;
    q.y = p.y;
    q.z = p.z + Math.sin(yawRad) * side;

    // the cave wall snaps the boom in, props ease it in quickly; lengthening eases back out
    const wall = containBoom(q, d, this.zoom, this.walls);
    const blockers = this.bounds.blockers;
    const want = blockers?.length ? outsideBlockers(q, d, wall, blockers) : wall;
    this._boom = stepBoom(snapped ? Infinity : this._boom, wall, want, dt, q, d, blockers);
    const b = this._boom;
    // squeezed against the wall: raise the pivot so the camera looks over the avatar's head
    const t = clamp((LIFT_FROM - b) / (LIFT_FROM - LIFT_FULL), 0, 1);
    const l = this.lifted;
    l.x = q.x;
    l.z = q.z;
    // ... but never above the ceiling of the room the camera point is in (a tunnel is 2.6 m high),
    // nor up into something hanging over it (a stall's sign board, an awning)
    const cx = q.x - d.x * b,
      cz = q.z - d.z * b,
      cy = q.y - d.y * b;
    let top = ceilingAt(cx, cz, this.walls);
    if (t > 0 && blockers)
      for (const k of blockers)
        if (
          k.bottom !== undefined &&
          k.bottom < top &&
          k.bottom >= cy - 1e-3 &&
          (cx - k.x) * (cx - k.x) + (cz - k.z) * (cz - k.z) < k.r * k.r
        )
          top = k.bottom;
    l.y = Math.max(q.y, Math.min(q.y + LIFT * smooth(t), top - b * Math.max(0, -d.y)));
    this.cam.setPosition(l.x - d.x * b, l.y - d.y * b, l.z - d.z * b);
    this.cam.setEulerAngles(-pitch, this._yaw + 180, 0);
  }

  /* ---------------------------------------------------------------- input */

  attach(el: HTMLElement): void {
    if (this.el === el) return;
    this.detach();
    this.el = el;
    this.prevTouchAction = el.style.touchAction;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("lostpointercapture", this.onLost);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    el.addEventListener("click", this.onClick, true);
    window.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    this.forgetPointers();
    el.style.touchAction = this.prevTouchAction;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("lostpointercapture", this.onLost);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    el.removeEventListener("click", this.onClick, true);
    window.removeEventListener("blur", this.onBlur);
    this.el = null;
  }

  /** Release and forget every pointer (detach, window blur). */
  private forgetPointers() {
    const el = this.el;
    for (const id of this.ptrs.keys())
      if (el?.hasPointerCapture?.(id))
        try {
          el.releasePointerCapture(id);
        } catch {
          /* already released */
        }
    this.ptrs.clear();
    this.pinch = 0;
  }

  /** Only the element itself or a canvas count as "the scene"; anything else is UI. */
  private fromUi(t: EventTarget | null): boolean {
    return t !== this.el && !(t instanceof HTMLCanvasElement);
  }

  private pinchDistance(): number {
    const it = this.ptrs.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return 0;
    const dx = a.x - b.x,
      dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (this.fromUi(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dragging: false });
    // capture now (not only once dragging): the release then reaches us even over UI or outside
    try {
      this.el?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    if (this.ptrs.size === 2) {
      // second finger: switch to pinch zoom (both pointers count as a drag from now on)
      this.pinch = this.pinchDistance();
      for (const p of this.ptrs.values()) p.dragging = true;
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      // the release was missed (e.g. it happened while the window lost focus): plain hover never orbits
      this.ptrs.delete(e.pointerId);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.ptrs.size >= 2) {
      const d = this.pinchDistance();
      if (this.pinch > 0 && d > 0) this.distance = this._distance * (this.pinch / d);
      this.pinch = d;
      return;
    }
    if (!p.dragging) {
      const mx = e.clientX - p.sx,
        my = e.clientY - p.sy;
      if (mx * mx + my * my < DRAG_PX * DRAG_PX) return;
      p.dragging = true;
    }
    // drag right = look right, drag down = look further down
    this.yaw = this._yaw - dx * YAW_PER_PX;
    this.pitch = this._pitch + dy * PITCH_PER_PX;
  };

  private readonly onUp = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (p.dragging) this.swallowClickUntil = performance.now() + 80;
    if (this.ptrs.size < 2) this.pinch = 0;
  };

  private readonly onLost = (e: PointerEvent) => {
    // capture lost without a pointerup (e.g. element removed): forget the pointer
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = 0;
  };

  private readonly onBlur = () => this.forgetPointers();

  private readonly onWheel = (e: WheelEvent) => {
    if (this.fromUi(e.target)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // trackpad pinch arrives as ctrl+wheel with small deltas
    const k = e.ctrlKey ? 0.01 : 0.0012;
    this.distance = this._distance * Math.exp(clamp(e.deltaY * unit, -400, 400) * k);
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    if (!this.fromUi(e.target)) e.preventDefault();
  };

  private readonly onClick = (e: MouseEvent) => {
    if (performance.now() < this.swallowClickUntil && !this.fromUi(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
}

/** Follow camera driving `camera` (an entity with a camera component). */
export function createFollowCamera(
  camera: pc.Entity,
  opts?: Partial<{
    yaw: number;
    pitch: number;
    distance: number;
    height: number;
    shoulder: number;
    bounds: CameraBounds;
  }>,
): FollowCamera {
  const pick = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v : d);
  return new OrbitFollowCamera(camera, {
    yaw: pick(opts?.yaw, DEFAULTS.yaw),
    pitch: pick(opts?.pitch, DEFAULTS.pitch),
    distance: pick(opts?.distance, DEFAULTS.distance),
    height: pick(opts?.height, DEFAULTS.height),
    shoulder: pick(opts?.shoulder, DEFAULTS.shoulder),
    bounds: opts?.bounds ?? DEFAULTS.bounds,
  });
}
