/**
 * Fan avatars: the character GLBs of tools/models/groups/characters.ts with procedural animation
 * driven by the manifest poses (no animation clips, no skinning: every joint is a node).
 *
 *   await preloadAvatars(app);                                   // manifest + GLBs; -> variants that failed
 *   const a = createAvatar(app, { variant: variantFor(sessionId) }); // added under app.root
 *   // every frame, position + yaw FIRST, then update (headTop follows the head):
 *   a.entity.setPosition(x, 0, z);
 *   a.entity.setEulerAngles(0, yawDeg, 0);                       // faces (sin yaw, 0, cos yaw)
 *   a.update(dt, horizontalSpeed);                               // m/s, 0..4
 *   label.at(a.headTop);                                         // world point for a name tag
 *   a.emote("wave");                                             // 1.5 s, layered over idle/walk
 *   a.destroy();
 *
 * Layers, blended per joint with quaternion slerp (unlisted joints stay at rest):
 * - idle: rest pose + breathing (spine/neck/arms ~1 deg at ~0.25 Hz, random phase) + an
 *   occasional weight shift (hips slide ~2 cm, legs counter-rotate so the feet stay put).
 * - walk: the manifest cycle walk_a -> rest -> walk_b -> rest. Arms, spine and hips follow the
 *   pose blend; the legs follow the same extremes but are timed on the ground contact
 *   (avatarMath.legAngles): heel strike -> flat -> toe-off at the body speed, then a swing with
 *   a knee lift. Cadence = speed / stride, so the planted foot does not skate; the hips height
 *   is solved every frame so the lower shoe rests on the floor (the bob comes from the legs).
 *   Slow speeds take shorter, slower steps. idle <-> walk crossfades over ~0.15 s.
 * - emotes (wave / laugh / cheer): ~1.5 s with ease in/out; arms are replaced, spine/neck/head
 *   are added on top, legs keep walking.
 * No per-frame allocations: all scratch quaternions are owned by the avatar.
 */
import * as pc from "playcanvas";
import { ProgressionVisuals } from "./avatarProgression.js";
import {
  LEG,
  WALK_DEFAULT,
  groundedHipsY,
  legAngles,
  pickIndex,
  rng32,
  strideAmplitude,
  strideFor,
  type FootPoint,
  type LegAngles,
  type Stride,
  type WalkExtremes,
} from "./avatarMath.js";
import { instantiateModel, loadModelContainer } from "./models.js";
import { SHRINE_GESTURE_MS, SHRINE_SEAT_HEIGHT } from "../../../packages/shared/src/shrine.js";

/** Character assets in manifest order. Changing this list changes every player's variant. */
export const AVATAR_VARIANTS: readonly string[] = Object.freeze([
  "tl_char_fan_cap_red_v01",
  "tl_char_fan_hoodie_white_v01",
  "tl_char_fan_hoodie_black_v01",
  "tl_char_fan_torn_jersey_v01",
  "tl_char_fan_headband_v01",
  "tl_char_fan_glasses_v01",
  "tl_char_fan_oxygen_v01",
]);

/**
 * Variant for a key (session id, user id...): FNV-1a hash -> index. Pure and stable, so every
 * client shows the same outfit for the same session id without sending it over the network.
 */
export function variantFor(key: string): string {
  return AVATAR_VARIANTS[pickIndex(key, AVATAR_VARIANTS.length)];
}

export type AvatarEmote = "wave" | "laugh" | "cheer";
export type ShrineGesture = "pray" | "bow";

export interface Avatar {
  /** Root at the feet, facing +Z. The caller sets world position and yaw. */
  readonly entity: pc.Entity;
  /** speed = horizontal m/s; drives idle <-> walk and the walk cadence. */
  update(dt: number, speed: number): void;
  /** ~1.5 s one-shot layered over idle / walk. */
  emote(name: AvatarEmote): void;
  /** Call before update. Root stays at floor level, facing the shrine centre. */
  setShrinePose(seated: boolean, gesture: ShrineGesture | null, elapsedSeconds: number): void;
  /** Local visual preview; ranks 1 rookie, 2 oxygen, 3 walker, 4 wheelchair, 5 bed. */
  setProgression(rank: number, cosmeticId?: string | null): void;
  /** World point for a name tag (manifest anchor name_tag: 0.22 m over the head), refreshed in update(). */
  readonly headTop: pc.Vec3;
  destroy(): void;
}

/* ------------------------------------------------------------------ manifest data */

type V3 = [number, number, number];
type PoseVal = V3 | { rot?: V3; at?: V3 };
type Pose = Record<string, PoseVal>;
interface CharacterAsset {
  name: string;
  file: string;
  anchors?: Record<string, V3>;
  poses?: Record<string, Pose>;
  meta?: { rig?: { jointWorldRest?: Record<string, V3> } };
}

const JOINTS = [
  "hips",
  "spine",
  "neck",
  "head",
  "arm_upper_l",
  "arm_lower_l",
  "arm_upper_r",
  "arm_lower_r",
  "leg_upper_l",
  "leg_lower_l",
  "leg_upper_r",
  "leg_lower_r",
] as const;
const N = JOINTS.length;
const HIPS = 0,
  SPINE = 1,
  NECK = 2,
  HEAD = 3,
  AUL = 4,
  ALL = 5,
  AUR = 6,
  ALR = 7,
  LUL = 8,
  LLL = 9,
  LUR = 10,
  LLR = 11;
/** Joints whose walk rotation comes from the pose blend (legs are solved separately). */
const UPPER = [HIPS, SPINE, NECK, HEAD, AUL, ALL, AUR, ALR] as const;
/** idle weight shift: hips slide (m) and the unloaded leg's soft knee (deg) at full shift */
const SHIFT_M = 0.022;
const SOFT_KNEE = 3;

interface VariantData {
  res: pc.ContainerResource;
  walkA: pc.Quat[];
  walkB: pc.Quat[];
  wave: pc.Quat[];
  waveB: pc.Quat[];
  extremes: WalkExtremes;
  /** pelvis yaw of walk_a (deg); the legs counter-rotate it so planted feet stay put */
  hipsYawA: number;
  /**
   * walk_a (left leg forward) should turn the pelvis so the left hip leads (yaw < 0) with the
   * shoulders counter-rotating. The v1 manifest has it the other way round (+4 / spine -5), so
   * hips and spine then use the mirrored pose: same lean, opposite twist.
   */
  twistMirror: boolean;
  hipsRestY: number;
  /** top of the head in the head joint's space, and the name tag gap above it */
  headTop: pc.Vec3;
  tagGap: number;
}

const variants = new Map<string, VariantData>();
let manifestAssets: CharacterAsset[] | null = null;
let preloading: Promise<string[]> | null = null;

function poseQuats(pose: Pose | undefined): pc.Quat[] {
  return JOINTS.map((j) => {
    const v = pose?.[j];
    const r = !v ? null : Array.isArray(v) ? v : (v.rot ?? null);
    return r ? new pc.Quat().setFromEulerAngles(r[0], r[1], r[2]) : new pc.Quat();
  });
}
const rotAxis = (v: PoseVal | undefined, axis: number, d: number) => {
  const r = !v ? null : Array.isArray(v) ? v : (v.rot ?? null);
  return r ? r[axis] : d;
};

function variantData(a: CharacterAsset, res: pc.ContainerResource): VariantData {
  const poses = a.poses ?? {};
  const wa = poses.walk_a;
  const hipsRest = a.meta?.rig?.jointWorldRest?.hips ?? [0, LEG.hipsY, 0];
  const headRest = a.meta?.rig?.jointWorldRest?.head ?? [0, 1.385, -0.005];
  const top = a.anchors?.head_top ?? [0, 1.77, 0];
  const tag = a.anchors?.name_tag ?? [0, top[1] + 0.22, 0];
  return {
    res,
    walkA: poseQuats(wa),
    walkB: poseQuats(poses.walk_b),
    wave: poseQuats(poses.wave),
    waveB: poseQuats(poses.wave_b),
    extremes: {
      frontThigh: rotAxis(wa?.leg_upper_l, 0, WALK_DEFAULT.frontThigh),
      frontKnee: rotAxis(wa?.leg_lower_l, 0, WALK_DEFAULT.frontKnee),
      backThigh: rotAxis(wa?.leg_upper_r, 0, WALK_DEFAULT.backThigh),
      backKnee: rotAxis(wa?.leg_lower_r, 0, WALK_DEFAULT.backKnee),
    },
    hipsYawA: rotAxis(wa?.hips, 1, 0),
    twistMirror: rotAxis(wa?.hips, 1, 0) > 0,
    hipsRestY: hipsRest[1],
    headTop: new pc.Vec3(top[0] - headRest[0], top[1] - headRest[1], top[2] - headRest[2]),
    tagGap: tag[1] - top[1],
  };
}

const MODELS_URL = `${import.meta.env.BASE_URL}models/`;

/**
 * Load the character manifest and the avatar GLBs. Resolves with the variants that could not be
 * loaded (empty = all loaded; createAvatar falls back to a loaded variant for the others) and
 * rejects only when none loaded. Safe to call repeatedly: after a failure a new call retries just
 * what is missing; once everything is loaded it resolves at once.
 */
export function preloadAvatars(app: pc.AppBase): Promise<string[]> {
  if (!preloading) {
    const attempt = (async () => {
      if (!manifestAssets) {
        const r = await fetch(`${MODELS_URL}manifest.characters.json`);
        if (!r.ok) throw new Error(`avatars: manifest.characters.json HTTP ${r.status}`);
        manifestAssets = ((await r.json()) as { assets: CharacterAsset[] }).assets;
      }
      const assets = manifestAssets;
      const todo = AVATAR_VARIANTS.filter((name) => !variants.has(name));
      const results = await Promise.allSettled(
        todo.map(async (name) => {
          const a = assets.find((x) => x.name === name);
          if (!a) throw new Error(`avatars: ${name} missing from manifest.characters.json`);
          const res = await loadModelContainer(app, MODELS_URL + a.file);
          variants.set(name, variantData(a, res));
        }),
      );
      const failed: string[] = [];
      let firstError: unknown = null;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") return;
        failed.push(todo[i]);
        firstError ??= r.reason;
      });
      if (!variants.size) throw firstError ?? new Error("avatars: no variant loaded");
      return failed;
    })();
    preloading = attempt;
    attempt.then(
      (failed) => {
        if (failed.length && preloading === attempt) preloading = null; // retry the rest later
      },
      () => {
        if (preloading === attempt) preloading = null; // allow a retry
      },
    );
  }
  return preloading;
}

/** First loaded variant in AVATAR_VARIANTS order (stand-in for one that failed to load). */
function anyVariant(): VariantData | undefined {
  for (const name of AVATAR_VARIANTS) {
    const d = variants.get(name);
    if (d) return d;
  }
  return undefined;
}

/* ------------------------------------------------------------------ math helpers */

const IDENTITY = new pc.Quat();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest-arc slerp that also extrapolates (t > 1) and never allocates. out may alias a. */
function slerp(out: pc.Quat, a: pc.Quat, b: pc.Quat, t: number): pc.Quat {
  let bx = b.x,
    by = b.y,
    bz = b.z,
    bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let wa = 1 - t,
    wb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    wa = Math.sin((1 - t) * th) / s;
    wb = Math.sin(t * th) / s;
  }
  const x = wa * a.x + wb * bx,
    y = wa * a.y + wb * by,
    z = wa * a.z + wb * bz,
    w = wa * a.w + wb * bw;
  const l = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1); // Math.hypot allocates in V8
  return out.set(x * l, y * l, z * l, w * l);
}

/* ------------------------------------------------------------------ emotes */

const EMOTE_TIME = 1.5;
const EMOTE_IN = 0.22;
const EMOTE_OUT = 0.35;
interface EmoteSlot {
  name: AvatarEmote | null;
  t: number;
  /** extra fade (1 -> 0) when a newer emote interrupts this one */
  fade: number;
}
const envelope = (t: number) =>
  smoothstep(0, EMOTE_IN, t) * (1 - smoothstep(EMOTE_TIME - EMOTE_OUT, EMOTE_TIME, t));

/* ------------------------------------------------------------------ avatar */

let created = 0;

class FanAvatar implements Avatar {
  readonly entity: pc.Entity;
  readonly headTop = new pc.Vec3();
  private readonly data: VariantData;
  private readonly nodes: pc.GraphNode[];
  private readonly head: pc.GraphNode;
  /** idle layer, walk layer, result */
  private readonly qi: pc.Quat[];
  private readonly qw: pc.Quat[];
  private readonly q: pc.Quat[];
  private readonly tq = new pc.Quat();
  private readonly tq2 = new pc.Quat();
  private readonly stride: Stride = {
    k: 1,
    backKnee: 22,
    heel: 0.28,
    toe: 0.42,
    length: 0.7,
    heelShare: 0.4,
  };
  private readonly legL: LegAngles = { thigh: 0, knee: 0, stance: true };
  private readonly legR: LegAngles = { thigh: 0, knee: 0, stance: true };
  private readonly foot: FootPoint = { y: 0, z: 0, corner: 0 };
  private readonly rand: () => number;
  private time = 0;
  private speed = 0;
  private walk = 0;
  private phase: number;
  private readonly breathHz: number;
  private readonly breathPhase: number;
  /** weight shift: current, start and goal (-1 right .. 1 left), blend progress, next change */
  private shift = 0;
  private shiftFrom = 0;
  private shiftTo = 0;
  private shiftT = 1;
  private shiftNext: number;
  private readonly emotes: [EmoteSlot, EmoteSlot] = [
    { name: null, t: 0, fade: 1 },
    { name: null, t: 0, fade: 1 },
  ];
  private dead = false;
  private seated = false;
  private rank = 1;
  private readonly progression: ProgressionVisuals;
  private shrineGesture: ShrineGesture | null = null;
  private shrineElapsed = 0;

  constructor(app: pc.AppBase, data: VariantData, seed: number) {
    this.data = data;
    this.rand = rng32(seed);
    this.entity = new pc.Entity("avatar");
    const model = instantiateModel(data.res);
    this.entity.addChild(model);
    app.root.addChild(this.entity);
    this.nodes = JOINTS.map((n) => {
      const node = model.findByName(n);
      if (!node) throw new Error(`avatar: joint ${n} not found`);
      return node;
    });
    this.head = this.nodes[HEAD];
    this.progression = new ProgressionVisuals(this.entity, model);
    this.qi = JOINTS.map(() => new pc.Quat());
    this.qw = JOINTS.map(() => new pc.Quat());
    this.q = JOINTS.map(() => new pc.Quat());
    this.phase = this.rand();
    this.breathHz = 0.22 + 0.06 * this.rand();
    this.breathPhase = this.rand() * Math.PI * 2;
    this.shiftNext = 1.5 + 5 * this.rand();
    this.update(0, 0);
  }

  emote(name: AvatarEmote): void {
    if (this.dead || this.seated || (name !== "wave" && name !== "laugh" && name !== "cheer")) return;
    const [cur, prev] = this.emotes;
    if (cur.name && envelope(cur.t) > 0.02) {
      // let the interrupted emote fade out under the new one
      prev.name = cur.name;
      prev.t = cur.t;
      prev.fade = 1;
    }
    cur.name = name;
    cur.t = 0;
    cur.fade = 1;
  }

  setProgression(rank: number, cosmeticId: string | null = null): void {
    if (this.dead) return;
    this.rank = Number.isFinite(rank) ? Math.max(1, Math.min(5, Math.floor(rank))) : 1;
    this.progression.set(this.rank, cosmeticId);
  }

  setShrinePose(seated: boolean, gesture: ShrineGesture | null, elapsedSeconds: number): void {
    if (this.dead) return;
    if (seated !== this.seated) {
      this.speed = this.walk = this.shift = 0;
      for (const slot of this.emotes) slot.name = null;
    }
    this.seated = seated;
    this.shrineGesture = seated && (gesture === "pray" || gesture === "bow") ? gesture : null;
    this.shrineElapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  }

  update(dt: number, speed: number): void {
    if (this.dead) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const sp = clamp(Number.isFinite(speed) ? speed : 0, 0, 8);
    this.time += dt;
    this.progression.equipment.enabled = !this.seated;
    this.progression.setShrineSeated(this.seated);
    if (this.seated || this.rank === 4) {
      this.shrineLayer();
      return;
    }
    if (this.rank === 5) {
      for (let j = 0; j < N; j++) this.nodes[j].setLocalEulerAngles(0, 0, 0);
      this.nodes[HIPS].setLocalPosition(0, 0.79, -0.2);
      this.nodes[HIPS].setLocalEulerAngles(88, 0, 0);
      this.nodes[HEAD].setLocalEulerAngles(-12, 0, 0);
      this.nodes[ALL].setLocalEulerAngles(-35, 0, 0);
      this.nodes[ALR].setLocalEulerAngles(-35, 0, 0);
      this.head.getWorldTransform().transformPoint(this.data.headTop, this.headTop);
      this.headTop.y += this.data.tagGap;
      return;
    }
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt / 0.06));
    const goal = smoothstep(0.08, 0.45, this.speed);
    const ramp = dt / 0.15;
    this.walk += clamp(goal - this.walk, -ramp, ramp);

    // idle <-> walk crossfade (a layer at weight 0 is not evaluated)
    const w = this.walk;
    if (w < 1) this.idleLayer(dt);
    if (w > 0) this.walkLayer(dt);
    const { qi, qw, q } = this;
    for (let j = 0; j < N; j++) {
      if (w <= 0) q[j].copy(qi[j]);
      else if (w >= 1) q[j].copy(qw[j]);
      else slerp(q[j], qi[j], qw[j], w);
    }

    this.emoteLayer(dt);
    if (this.rank === 3) {
      q[AUL].setFromEulerAngles(-25, 0, -8);
      q[AUR].setFromEulerAngles(-25, 0, 8);
      q[ALL].setFromEulerAngles(-42, 0, 0);
      q[ALR].setFromEulerAngles(-42, 0, 0);
    }

    // hips height: the lower shoe on the floor, from the blended leg swing (X) angles
    const l = this.legL,
      r = this.legR;
    const sh = this.shift;
    const softL = sh < 0 ? -sh * SOFT_KNEE : 0,
      softR = sh > 0 ? sh * SOFT_KNEE : 0;
    const iw = 1 - w;
    const hipsY =
      this.data.hipsRestY -
      LEG.hipsY +
      groundedHipsY(
        -softL * iw + l.thigh * w,
        softL * iw + l.knee * w,
        -softR * iw + r.thigh * w,
        softR * iw + r.knee * w,
        this.foot,
      );

    const nodes = this.nodes;
    nodes[HIPS].setLocalPosition(SHIFT_M * sh * iw, hipsY, 0);
    for (let j = 0; j < N; j++) nodes[j].setLocalRotation(q[j]);

    this.head.getWorldTransform().transformPoint(this.data.headTop, this.headTop);
    this.headTop.y += this.data.tagGap;
  }

  /** Rigid rig: thigh underside on a 0.48 m stone, vertical shins and grounded soles. */
  private shrineLayer() {
    const q = this.q;
    const breath = Math.sin(this.time * this.breathHz * Math.PI * 2 + this.breathPhase);
    // The mesh's thigh underside is 0.0948 m below the hip pivot. Solve instead of
    // translating the standing avatar, so the shoes remain at y=0 on all variants.
    const hipY = SHRINE_SEAT_HEIGHT + 0.0948;
    const thigh = -Math.acos((hipY - LEG.shin) / LEG.thigh) * 180 / Math.PI;
    q[HIPS].setFromEulerAngles(0, 0, 0);
    q[SPINE].setFromEulerAngles(5 + breath * 0.65, 0, 0);
    q[NECK].setFromEulerAngles(-2, 0, 0);
    q[HEAD].setFromEulerAngles(-2 + breath * 0.35, 0, 0);
    q[LUL].setFromEulerAngles(thigh, 0, 0);
    q[LUR].setFromEulerAngles(thigh, 0, 0);
    q[LLL].setFromEulerAngles(-thigh, 0, 0);
    q[LLR].setFromEulerAngles(-thigh, 0, 0);
    q[AUL].setFromEulerAngles(2, 0, -28);
    q[AUR].setFromEulerAngles(2, 0, 28);
    q[ALL].setFromEulerAngles(-75, 0, -3);
    q[ALR].setFromEulerAngles(-75, 0, 3);

    // A complete three-second loop starts/ends at seated rest. The authoritative
    // gesture clock is supplied by the caller, so remote players share the motion.
    const duration = SHRINE_GESTURE_MS / 1000;
    const t = (this.shrineElapsed % duration) * 3 / duration;
    const w = smoothstep(0, 0.55, t) * (1 - smoothstep(2.35, 3, t));
    const over = (j: number, x: number, y: number, z: number) =>
      slerp(q[j], q[j], this.tq.setFromEulerAngles(x, y, z), w);
    if (this.shrineGesture === "pray") {
      const lift = 142 + 3 * Math.sin(t * Math.PI * 2 / 3);
      over(AUL, -20, -12, lift);
      over(AUR, -20, 12, -lift);
      over(ALL, -24, -12, 0);
      over(ALR, -24, 12, 0);
      over(SPINE, -4, 0, 0);
      over(HEAD, -16, 0, 0);
    } else if (this.shrineGesture === "bow") {
      const bow = Math.sin(Math.PI * clamp((t - 0.2) / 2.6, 0, 1));
      over(SPINE, 5 + 49 * bow, 0, 0);
      over(NECK, 8 + 6 * bow, 0, 0);
      over(HEAD, 13 + 9 * bow, 0, 0);
      // Palms together in front of the chest; the whole torso bows over the knees.
      over(AUL, -32, -8, -24);
      over(AUR, -32, 8, 24);
      over(ALL, -104, -44, -10);
      over(ALR, -104, 44, 10);
    }
    this.nodes[HIPS].setLocalPosition(0, hipY + LEG.hipDrop, -0.05);
    for (let j = 0; j < N; j++) this.nodes[j].setLocalRotation(q[j]);
    this.head.getWorldTransform().transformPoint(this.data.headTop, this.headTop);
    this.headTop.y += this.data.tagGap;
  }

  private idleLayer(dt: number) {
    const t = this.time;
    // occasional weight shift: hold 3.5-9 s, move over ~1.1 s
    if (t >= this.shiftNext) {
      this.shiftFrom = this.shift;
      const r = this.rand();
      this.shiftTo = r < 0.4 ? 1 : r < 0.8 ? -1 : 0;
      if (this.shiftTo === this.shiftFrom) this.shiftTo = 0;
      this.shiftT = 0;
      this.shiftNext = t + 3.5 + 5.5 * this.rand();
    }
    if (this.shiftT < 1) {
      this.shiftT = Math.min(1, this.shiftT + dt / 1.1);
      const e = smoothstep(0, 1, this.shiftT);
      this.shift = this.shiftFrom + (this.shiftTo - this.shiftFrom) * e;
    }
    const s = this.shift;
    const b = Math.sin(t * this.breathHz * Math.PI * 2 + this.breathPhase);
    const qi = this.qi;
    // both legs lean against the hips' slide so the soles stay where they are
    const legZ = (-Math.asin((SHIFT_M * s) / (LEG.thigh + LEG.shin)) * 180) / Math.PI;
    qi[HIPS].setFromEulerAngles(0, 2 * s, 0);
    qi[SPINE].setFromEulerAngles(-1.1 * b + 1, -1.5 * s, 1.2 * s);
    qi[NECK].setFromEulerAngles(0.6 * b, 0, 0);
    qi[HEAD].setFromEulerAngles(0.4 * b + 1, 1.5 * s, -0.8 * s);
    qi[AUL].setFromEulerAngles(0, 0, 0.9 * (b + 1));
    qi[AUR].setFromEulerAngles(0, 0, -0.9 * (b + 1));
    qi[ALL].setFromEulerAngles(-6 - 1.5 * b, 0, 0);
    qi[ALR].setFromEulerAngles(-6 - 1.5 * b, 0, 0);
    // unloaded leg: soft knee with the shin kept vertical so the foot stays put
    const softL = s < 0 ? -s * SOFT_KNEE : 0,
      softR = s > 0 ? s * SOFT_KNEE : 0;
    qi[LUL].setFromEulerAngles(-softL, 0, legZ);
    qi[LLL].setFromEulerAngles(softL, 0, 0);
    qi[LUR].setFromEulerAngles(-softR, 0, legZ);
    qi[LLR].setFromEulerAngles(softR, 0, 0);
  }

  private walkLayer(dt: number) {
    const d = this.data;
    const v = this.speed;
    const k = strideAmplitude(v);
    const st = strideFor(k, d.extremes, this.stride);
    if (v > 1e-4) this.phase = (this.phase + (dt * v) / (2 * st.length)) % 1;
    const p = this.phase;
    legAngles(p, st, d.extremes, this.legL);
    legAngles(p + 0.5, st, d.extremes, this.legR);
    const qw = this.qw;
    // upper body: walk_a <-> rest <-> walk_b, in time with the legs (left heel strike = walk_a)
    const b = Math.cos(p * Math.PI * 2);
    const amp = k * Math.abs(b);
    // pelvis twist (walk_a or the mirrored pose, see VariantData.twistMirror); the thighs turn
    // back by it so each leg keeps swinging straight along the walk and planted feet stay put
    const hipsA = b >= 0 !== d.twistMirror;
    const yaw = (hipsA ? d.hipsYawA : -d.hipsYawA) * amp;
    qw[LUL].setFromEulerAngles(this.legL.thigh, -yaw, 0);
    qw[LLL].setFromEulerAngles(this.legL.knee, 0, 0);
    qw[LUR].setFromEulerAngles(this.legR.thigh, -yaw, 0);
    qw[LLR].setFromEulerAngles(this.legR.knee, 0, 0);
    for (let i = 0; i < UPPER.length; i++) {
      const j = UPPER[i];
      const a = j === HIPS || j === SPINE ? hipsA : b >= 0;
      slerp(qw[j], IDENTITY, a ? d.walkA[j] : d.walkB[j], amp);
    }
    // elbows never lock straight while walking
    const bend = this.tq.setFromEulerAngles(-10 * Math.min(1, k), 0, 0);
    qw[ALL].mul(bend);
    qw[ALR].mul(bend);
  }

  private emoteLayer(dt: number) {
    // the interrupted emote (slot 1) first, fading out under the current one (slot 0)
    for (let i = 1; i >= 0; i--) {
      const slot = this.emotes[i];
      if (!slot.name) continue;
      slot.t += dt;
      if (i === 1) slot.fade = Math.max(0, slot.fade - dt / 0.2);
      if (slot.t >= EMOTE_TIME || slot.fade <= 0) {
        slot.name = null;
        continue;
      }
      const w = envelope(slot.t) * slot.fade;
      if (w > 0) this.applyEmote(slot.name, slot.t, w);
    }
  }

  /** Arms are replaced (slerp toward the emote), spine / neck / head get the emote added. */
  private applyEmote(name: AvatarEmote, t: number, w: number) {
    const q = this.q;
    const d = this.data;
    const tq = this.tq;
    const over = (j: number, target: pc.Quat) => slerp(q[j], q[j], target, w);
    const add = (j: number, ex: number, ey: number, ez: number) => {
      tq.setFromEulerAngles(ex, ey, ez);
      q[j].mul(slerp(tq, IDENTITY, tq, w));
    };
    const TAU = Math.PI * 2;
    if (name === "wave") {
      // right arm up, forearm swinging between the wave and wave_b poses at ~3 Hz
      const u = 0.5 - 0.5 * Math.cos(t * 3 * TAU);
      over(AUR, d.wave[AUR]);
      over(ALR, slerp(this.tq2, d.wave[ALR], d.waveB[ALR], u));
      q[SPINE].mul(slerp(tq, IDENTITY, d.wave[SPINE], w));
      q[HEAD].mul(slerp(tq, IDENTITY, d.wave[HEAD], w));
    } else if (name === "laugh") {
      // belly laugh: hands on the belly, leaning back, head thrown back, torso and shoulders
      // shaking ~4 Hz (hand poses checked by FK: palms ~4 cm in front of the torso)
      const bob = Math.sin(t * 4.2 * TAU);
      add(SPINE, -9 + 5 * bob, 0, 0);
      add(NECK, -7, 0, 0);
      add(HEAD, -18 + 5 * Math.sin(t * 4.2 * TAU + 0.8), 0, 0);
      over(AUL, this.tq2.setFromEulerAngles(-12 - 3 * bob, 0, 6 + 3 * bob));
      over(AUR, this.tq2.setFromEulerAngles(-12 - 3 * bob, 0, -6 - 3 * bob));
      over(ALL, this.tq2.setFromEulerAngles(-72, -70, 0));
      over(ALR, this.tq2.setFromEulerAngles(-72, 70, 0));
    } else {
      // cheer: both arms up, fists pumping ~2.6 Hz
      const pump = Math.sin(t * 2.6 * TAU);
      const lift = 152 + 14 * pump;
      const elbow = -18 - 40 * (0.5 - 0.5 * pump);
      over(AUL, this.tq2.setFromEulerAngles(-8, 0, lift));
      over(AUR, this.tq2.setFromEulerAngles(-8, 0, -lift));
      over(ALL, this.tq2.setFromEulerAngles(elbow, 0, 0));
      over(ALR, this.tq2.setFromEulerAngles(elbow, 0, 0));
      add(SPINE, -5 - 2 * pump, 0, 0);
      add(HEAD, -10, 0, 0);
    }
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.progression.destroy();
    this.entity.destroy();
  }
}

/**
 * Create an avatar (call after preloadAvatars resolved). An unknown variant, or one that failed to
 * load, falls back to the first loaded variant.
 */
export function createAvatar(app: pc.AppBase, opts: { variant: string; seed?: number }): Avatar {
  const data = variants.get(opts.variant) ?? anyVariant();
  if (!data) throw new Error("createAvatar: await preloadAvatars(app) first");
  const seed = opts.seed ?? (Math.imul(++created, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  return new FanAvatar(app, data, seed);
}
