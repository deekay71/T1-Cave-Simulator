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
 * - rank looks (setProgression; gear GLBs in avatarProgression.ts, maths in avatarRankMath.ts):
 *   2 "Tê Thở"  walks a little stooped, the left hand on the oxygen trolley's handle (arm IK); the
 *               trolley trails behind, tilts while pulled, parks upright at rest; a hose runs
 *               from the cylinder over the shoulder to the nasal cannula.
 *   3 "Tê Nạng" two underarm crutches in a two-point gait: each tip lands with the opposite
 *               foot, stays planted while the body passes (no skating) and swings forward; the
 *               hands hold the grips by IK.
 *   4 "Tê Lăn"  seated in the wheelchair (manifest pose sit_wheelchair), hands pushing the wheels
 *               in rhythm while moving and resting on the armrests when still; wheels and casters
 *               roll with the distance and the turn.
 *   5 "Tê Liệt" lying in the metal bed on casters (pose lie_bed) under the cover, phone in the
 *               right hand, breathing; the bed turns with some lag and its casters swivel.
 *   Vehicles (4, 5) turn a little slower than the root (the rig lags inside the entity). Emotes
 *   work in every rank (in bed: a raised hand / shaking shoulders / both arms up). Until the gear
 *   GLBs are loaded the avatar keeps the plain look.
 * No per-frame allocations: all scratch quaternions are owned by the avatar.
 */
import * as pc from "playcanvas";
import { ProgressionVisuals, gearDims, preloadGear } from "./avatarProgression.js";
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
import { CRUTCH_DUTY, angleDelta, armPose, crutchTip, solveArm, trailAngle, type CrutchTip } from "./avatarRankMath.js";
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

export type AvatarEmote = "wave" | "laugh" | "cheer" | "jump";
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
  /** Local visual preview; ranks 1 rookie, 2 oxygen trolley, 3 crutches, 4 wheelchair, 5 bed. Unknown look ids show nothing. */
  setProgression(rank: number, cosmeticId?: string | null): void;
  /** World point for a name tag (manifest anchor name_tag: 0.22 m over the head), refreshed in update(). */
  readonly headTop: pc.Vec3;
  destroy(): void;
}

/** The "jump" emote: lift-off (s) after the emote starts, air time (s) and height (m) of the first hop. */
const JUMP_START = 0.08;
const JUMP_TIME = 0.52;
const JUMP_HEIGHT = 0.5;

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
  /** rank poses: seated in the wheelchair, lying in the bed (hips position in model space) */
  sitChair: pc.Quat[];
  sitChairAt: pc.Vec3;
  lieBed: pc.Quat[];
  lieBedAt: pc.Vec3;
  /** the outfit already has a nasal cannula modelled on the head */
  cannula: boolean;
  /** manifest pose slump: bowed head, rounded back, hanging arms (the optional trudge mood) */
  slump: pc.Quat[];
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
    sitChair: poseQuats(poses.sit_wheelchair ?? SIT_WHEELCHAIR),
    sitChairAt: hipsAt(poses.sit_wheelchair ?? SIT_WHEELCHAIR, [0, 0.735, -0.03]),
    lieBed: poseQuats(poses.lie_bed ?? LIE_BED),
    lieBedAt: hipsAt(poses.lie_bed ?? LIE_BED, [0, 0.5, -0.1]),
    cannula: a.name.includes("oxygen"),
    slump: poseQuats(poses.slump ?? SLUMP),
  };
}

/** Fallbacks for outfits whose manifest entry lacks the rank poses (same values as the fans'). */
const SIT_WHEELCHAIR: Pose = {
  hips: { at: [0, 0.735, -0.03], rot: [0, 0, 0] },
  spine: [-4, 0, 0],
  neck: [6, 0, 0],
  head: [8, 0, 0],
  arm_upper_l: [10, 0, -26],
  arm_lower_l: [-83, 0, 7],
  arm_upper_r: [10, 0, 26],
  arm_lower_r: [-83, 0, -7],
  leg_upper_l: [-100, 0, 0],
  leg_lower_l: [100, 0, 0],
  leg_upper_r: [-100, 0, 0],
  leg_lower_r: [100, 0, 0],
};
const SLUMP: Pose = {
  spine: [14, 0, 0],
  neck: [6, 0, 0],
  head: [20, 0, 0],
  arm_upper_l: [10, 0, 3],
  arm_lower_l: [-8, 0, 0],
  arm_upper_r: [10, 0, -3],
  arm_lower_r: [-8, 0, 0],
};
const LIE_BED: Pose = {
  hips: { at: [0, 0.5, -0.1], rot: [-90, 0, 0] },
  spine: [11, 0, 0],
  neck: [19, 0, 0],
  head: [4, 0, 0],
  arm_upper_l: [2, 0, 6],
  arm_lower_l: [0, 0, 0],
  arm_upper_r: [-53, 28, 40],
  arm_lower_r: [-52, -6, 32],
  leg_upper_l: [1, 0, 2],
  leg_lower_l: [-1, 0, 0],
  leg_upper_r: [1, 0, -2],
  leg_lower_r: [-1, 0, 0],
};
function hipsAt(pose: Pose, d: V3): pc.Vec3 {
  const v = pose.hips;
  const at = v && !Array.isArray(v) ? (v.at ?? d) : d;
  return new pc.Vec3(at[0], at[1], at[2]);
}

const MODELS_URL = `${import.meta.env.BASE_URL}models/`;

/**
 * Load the character manifest and the avatar GLBs. Resolves with the variants that could not be
 * loaded (empty = all loaded; createAvatar falls back to a loaded variant for the others) and
 * rejects only when none loaded. Safe to call repeatedly: after a failure a new call retries just
 * what is missing; once everything is loaded it resolves at once.
 */
export function preloadAvatars(app: pc.AppBase): Promise<string[]> {
  void preloadGear(app); // rank gear + shop looks: in the background, never blocks or fails the avatars
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
/** shoulder pivot in spine space (left; x mirrored) */
const ARM_SHOULDER = [0.27, 0.3] as const;
/** where the hose meets the cannula: left side of the jaw, head-joint space */
const HOSE_INLET = [0.16, 0.012, 0.034] as const;
const PHONE_LOOK = new pc.Mat4();

/** Vehicles turn slower than the root: [time constant s, max rad/s] for the wheelchair and the bed. */
const CHAIR_TURN = [0.07, 10] as const;
const BED_TURN = [0.16, 5] as const;
/** A jump longer than this in one frame is a teleport: no rolling, no trailing. */
const TELEPORT_M = 1.5;
/** Crutches (model space, per side): planted spots at rest / lateral offset and centre of the walk plant. */
const CRUTCH_IDLE = [0.335, 0.2] as const;
const CRUTCH_WALK = [0.325, 0.1] as const;
/** underarm point the crutch leans on, in spine space (left; x mirrored) */
const ARMPIT = [0.243, 0.222, 0.0] as const;
/** wheelchair push: hand path on the wheel (deg from the top, + = forward) and its radius */
const PUSH_FROM = -42;
const PUSH_TO = 26;
const PUSH_SHARE = 0.46;

class FanAvatar implements Avatar {
  readonly entity: pc.Entity;
  readonly headTop = new pc.Vec3();
  private readonly data: VariantData;
  /** between the entity and the model: vehicles (wheelchair, bed) turn it with some lag */
  private readonly rig: pc.Entity;
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
  private readonly gear: ProgressionVisuals;
  private shrineGesture: ShrineGesture | null = null;
  private shrineElapsed = 0;
  /** 0..1 trudge mood (createAvatar opts.trudge); 0 = the normal look */
  private readonly trudge: number;

  /* rank looks: motion of the root since the last frame, in the root's frame */
  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private hasLast = false;
  private lastRank = 1;
  /** unit travel direction in the root's frame (x = left, z = forward) and this frame's yaw change */
  private dirX = 0;
  private dirZ = 1;
  private dYaw = 0;
  private yaw = 0;
  /** vehicle heading (world rad) trailing the root's yaw */
  private vehYaw = 0;
  private pushPhase: number;
  /** joint offsets (parent space) for the model-space FK of the rank layers */
  private readonly offSpine: pc.Vec3;
  private readonly offNeck: pc.Vec3;
  private readonly offHead: pc.Vec3;
  private readonly hipsPos = new pc.Vec3();
  private readonly spinePos = new pc.Vec3();
  private readonly spineRot = new pc.Quat();
  private readonly spineInv = new pc.Quat();
  private readonly arm = armPose();
  private readonly tip: CrutchTip = { z: 0, lift: 0, planted: true };
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private readonly v3 = new pc.Vec3();

  constructor(app: pc.AppBase, data: VariantData, seed: number, trudge = 0) {
    this.data = data;
    this.trudge = clamp(Number.isFinite(trudge) ? trudge : 0, 0, 1);
    this.rand = rng32(seed);
    this.entity = new pc.Entity("avatar");
    this.rig = new pc.Entity("avatar-rig");
    const model = instantiateModel(data.res);
    this.rig.addChild(model);
    this.entity.addChild(this.rig);
    app.root.addChild(this.entity);
    this.nodes = JOINTS.map((n) => {
      const node = model.findByName(n);
      if (!node) throw new Error(`avatar: joint ${n} not found`);
      return node;
    });
    this.head = this.nodes[HEAD];
    this.offSpine = this.nodes[SPINE].getLocalPosition().clone();
    this.offNeck = this.nodes[NECK].getLocalPosition().clone();
    this.offHead = this.nodes[HEAD].getLocalPosition().clone();
    this.gear = new ProgressionVisuals(app, this.rig, model, { cannula: data.cannula });
    this.qi = JOINTS.map(() => new pc.Quat());
    this.qw = JOINTS.map(() => new pc.Quat());
    this.q = JOINTS.map(() => new pc.Quat());
    this.phase = this.rand();
    this.breathHz = 0.22 + 0.06 * this.rand();
    this.breathPhase = this.rand() * Math.PI * 2;
    this.shiftNext = 1.5 + 5 * this.rand();
    this.pushPhase = this.rand();
    this.update(0, 0);
  }

  emote(name: AvatarEmote): void {
    if (this.dead || this.seated || (name !== "wave" && name !== "laugh" && name !== "cheer" && name !== "jump")) return;
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
    const r = Number.isFinite(rank) ? Math.max(1, Math.min(5, Math.floor(rank))) : 1;
    // builds now, or when the gear GLBs arrive; update() poses for gear.rank (what is really there)
    this.gear.set(r, typeof cosmeticId === "string" ? cosmeticId : null);
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
    const gear = this.gear;
    gear.setSeated(this.seated);
    gear.sync();
    const rank = this.seated ? 1 : gear.rank;
    this.trackRoot(rank);
    if (this.seated) {
      this.shrineLayer();
      return;
    }
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt / 0.06));
    const goal = smoothstep(0.08, 0.45, this.speed);
    const ramp = dt / 0.15;
    this.walk += clamp(goal - this.walk, -ramp, ramp);
    if (rank === 4) {
      this.chairLayer(dt);
      return;
    }
    if (rank === 5) {
      this.bedLayer(dt);
      return;
    }

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
    this.hipsPos.set(SHIFT_M * sh * iw, hipsY, 0);

    // rank looks that walk: stoop + arms on the gear (emotes may then take the arms over)
    if (rank === 2) this.oxygenLayer(dt);
    else if (rank === 3) this.crutchLayer();

    if (this.trudge > 0) this.trudgeLayer();
    this.emoteLayer(dt);

    const nodes = this.nodes;
    nodes[HIPS].setLocalPosition(this.hipsPos);
    for (let j = 0; j < N; j++) nodes[j].setLocalRotation(q[j]);

    if (rank === 2) this.oxygenHose();

    this.head.getWorldTransform().transformPoint(this.data.headTop, this.headTop);
    this.headTop.y += this.data.tagGap;
  }

  /* ---------------------------------------------------------------- rank looks */

  /**
   * Root motion since the last frame: yaw, yaw change and the travel direction in the root's
   * frame (forward when it walks on the spot). Vehicles get a heading that trails the yaw; the
   * rig is turned back by the difference. Anything else keeps the rig square with the root.
   */
  private trackRoot(rank: number) {
    const rot = this.entity.getLocalRotation();
    const yaw = 2 * Math.atan2(rot.y, rot.w);
    const p = this.entity.getLocalPosition();
    let dx = p.x - this.lastX,
      dz = p.z - this.lastZ;
    const moved = Math.sqrt(dx * dx + dz * dz);
    const jump = !this.hasLast || moved > TELEPORT_M || rank !== this.lastRank;
    if (jump) {
      dx = dz = 0;
      this.dYaw = 0;
      this.vehYaw = yaw;
    } else this.dYaw = angleDelta(yaw, this.lastYaw);
    this.dirX = 0;
    this.dirZ = 1;
    if (!jump && moved > 1e-5) {
      const s = Math.sin(yaw),
        c = Math.cos(yaw);
      this.dirX = (dx * c - dz * s) / moved;
      this.dirZ = (dx * s + dz * c) / moved;
    }
    this.lastX = p.x;
    this.lastZ = p.z;
    this.lastYaw = yaw;
    this.hasLast = true;
    this.yaw = yaw;
    if (rank !== this.lastRank) {
      this.lastRank = rank;
      if (rank !== 4 && rank !== 5) this.rig.setLocalEulerAngles(0, 0, 0);
      this.rig.setLocalPosition(0, 0, 0);
      this.nodes[HIPS].setLocalPosition(0, this.data.hipsRestY, 0);
    }
  }

  /** Vehicle heading: trail the root's yaw, turn the rig; returns the yaw change of the vehicle. */
  private steer(dt: number, turn: readonly [number, number]): number {
    const before = this.vehYaw;
    this.vehYaw = trailAngle(before, this.yaw, dt, turn[0], turn[1]);
    const rel = angleDelta(this.vehYaw, this.yaw);
    this.vehYaw = this.yaw + rel;
    this.rig.setLocalEulerAngles(0, (rel * 180) / Math.PI, 0);
    // travel direction in the vehicle's frame
    const s = Math.sin(rel),
      c = Math.cos(rel);
    const x = this.dirX * c - this.dirZ * s,
      z = this.dirX * s + this.dirZ * c;
    this.dirX = x;
    this.dirZ = z;
    return angleDelta(this.vehYaw, before);
  }

  /** Model-space spine frame (position + rotation) from hipsPos and the pose in q. */
  private spineFrame() {
    const q = this.q;
    q[HIPS].transformVector(this.offSpine, this.spinePos).add(this.hipsPos);
    this.spineRot.mul2(q[HIPS], q[SPINE]);
    this.spineInv.copy(this.spineRot).conjugate();
  }
  /** Model-space point of a spine-space offset. */
  private fromSpine(x: number, y: number, z: number, out: pc.Vec3): pc.Vec3 {
    return this.spineRot.transformVector(out.set(x, y, z), out).add(this.spinePos);
  }
  /**
   * Arm IK: put the hand (or the forearm point g, left-arm coordinates) of one arm on a
   * model-space target, blended in by weight. Needs spineFrame().
   */
  private armTo(side: 1 | -1, target: pc.Vec3, weight: number, twist = 0, gy?: number, gz?: number) {
    const sh = this.fromSpine(side * ARM_SHOULDER[0], ARM_SHOULDER[1], 0, this.v3);
    const t = this.spineInv.transformVector(this.v3.sub2(target, sh), this.v3);
    const a = solveArm(side, t.x, t.y, t.z, this.arm, twist, undefined, gy, gz);
    const q = this.q;
    const up = side === 1 ? AUL : AUR,
      lo = side === 1 ? ALL : ALR;
    const tq = this.tq.set(a.x, a.y, a.z, a.w);
    if (weight >= 1) q[up].copy(tq);
    else slerp(q[up], q[up], tq, weight);
    tq.setFromEulerAngles(a.elbow, 0, 0);
    if (weight >= 1) q[lo].copy(tq);
    else slerp(q[lo], q[lo], tq, weight);
  }

  /** Rank 2: tired stoop, the trolley follows, the left hand stays on its handle. */
  private oxygenLayer(dt: number) {
    const q = this.q;
    const w = this.walk;
    const tq = this.tq;
    q[SPINE].mul(tq.setFromEulerAngles(6 + 3 * w, 0, 0));
    q[NECK].mul(tq.setFromEulerAngles(4, 0, 0));
    q[HEAD].mul(tq.setFromEulerAngles(3 + 2 * w, 0, 0));
    this.gear.trolley(dt, w, this.speed * dt * this.dirZ, this.yaw);
    this.spineFrame();
    this.armTo(1, this.gear.grip, 1, -8);
  }
  /** Rank 2, after the pose is final: hose from the cylinder over the left shoulder to the cannula. */
  private oxygenHose() {
    const q = this.q;
    this.spineFrame();
    const over = this.fromSpine(0.345, 0.43, -0.085, this.v1);
    // head frame: spine -> neck -> head
    const neckRot = this.tq.mul2(this.spineRot, q[NECK]);
    const neckPos = this.fromSpine(this.offNeck.x, this.offNeck.y, this.offNeck.z, this.v2);
    const headPos = neckRot.transformVector(this.v3.copy(this.offHead), this.v3).add(neckPos);
    const headRot = this.tq2.mul2(neckRot, q[HEAD]);
    const inlet = headRot.transformVector(this.v2.set(HOSE_INLET[0], HOSE_INLET[1], HOSE_INLET[2]), this.v2).add(headPos);
    this.gear.hose(over, inlet);
  }

  /**
   * Rank 3: two-point crutch gait. Each crutch is a rigid stick from its tip on the floor to the
   * armpit; the tip is planted while the body walks past it and swings forward with the opposite
   * leg. The hands hold the grips (arm IK), the torso leans into the crutches.
   */
  private crutchLayer() {
    const q = this.q;
    const w = this.walk;
    const tq = this.tq;
    q[SPINE].mul(tq.setFromEulerAngles(8 + 3 * w, 0, 0));
    q[NECK].mul(tq.setFromEulerAngles(2, 0, 0));
    q[HEAD].mul(tq.setFromEulerAngles(-2 + 4 * w, 0, 0));
    this.spineFrame();
    const dims = gearDims().crutch;
    const st = this.stride;
    const lift = 0.06 + 0.05 * Math.min(1, st.k);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const crutch = this.gear.crutches[i];
      if (!crutch) continue;
      // the left crutch lands with the right foot (leg phase p + 0.5), centred on its stance
      const tip = crutchTip(this.phase + (i === 0 ? 0.5 : 0) - 0.25 + CRUTCH_DUTY / 2, st.length, lift, this.tip);
      const tx = side * (CRUTCH_IDLE[0] + (CRUTCH_WALK[0] - CRUTCH_IDLE[0]) * w),
        ty = tip.lift * w,
        tz = CRUTCH_IDLE[1] + (CRUTCH_WALK[1] + tip.z - CRUTCH_IDLE[1]) * w;
      const pit = this.fromSpine(side * ARMPIT[0], ARMPIT[1], ARMPIT[2], this.v1);
      let dx = pit.x - tx,
        dy = pit.y - ty,
        dz = pit.z - tz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      // the pad stays under the arm: when the tip is far the crutch is lifted along its axis
      const pull = Math.max(0, len - dims.length);
      crutch.setLocalPosition(tx + dx * pull, ty + dy * pull, tz + dz * pull);
      // shortest arc +Y -> axis keeps the struts in the walking plane
      const qw = 1 + dy;
      const l = 1 / Math.sqrt(dz * dz + dx * dx + qw * qw);
      crutch.setLocalRotation(dz * l, 0, -dx * l, qw * l);
      const g = dims.grip + pull;
      this.armTo(side, this.v2.set(tx + dx * g, ty + dy * g, tz + dz * g + 0.012), 1, side * 6);
    }
  }

  /**
   * Rank 4: seated in the wheelchair. Moving = hands push the wheels in rhythm (stroke along the
   * rim, recovery through the air) with the torso leaning into each push; still = hands on the
   * armrests. The chair's heading trails the root, wheels roll with distance and turn.
   */
  private chairLayer(dt: number) {
    const d = this.data;
    const q = this.q;
    const w = this.walk;
    const tq = this.tq;
    for (let j = 0; j < N; j++) q[j].copy(d.sitChair[j]);
    const b = Math.sin(this.time * this.breathHz * Math.PI * 2 + this.breathPhase);
    // push rhythm: quicker at speed, both hands together
    if (w > 0) this.pushPhase = (this.pushPhase + dt * (1.05 + 0.3 * this.speed)) % 1;
    const ph = this.pushPhase;
    const pushing = ph < PUSH_SHARE;
    const u = pushing ? ph / PUSH_SHARE : (ph - PUSH_SHARE) / (1 - PUSH_SHARE);
    const e = u * u * (3 - 2 * u);
    const stroke = pushing ? e : 1 - e; // 0 = hands back, 1 = hands forward
    q[SPINE].mul(tq.setFromEulerAngles(0.7 * b + w * (9 + 9 * stroke), 0, 0));
    q[NECK].mul(tq.setFromEulerAngles(-w * (3 + 5 * stroke), 0, 0));
    q[HEAD].mul(tq.setFromEulerAngles(0.4 * b - w * 6, 0, 0));
    this.hipsPos.copy(d.sitChairAt);
    if (w > 0) {
      this.spineFrame();
      const c = gearDims().chair;
      const ang = ((PUSH_FROM + (PUSH_TO - PUSH_FROM) * stroke) * Math.PI) / 180;
      const lift = pushing ? 0 : 0.075 * Math.sin(Math.PI * u);
      const r = c.wheelR - 0.012 + lift;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        const t = this.v1.set(side * (c.wheelX + 0.02 + lift * 0.5), c.wheelR + r * Math.cos(ang), -0.1 + r * Math.sin(ang));
        // palms on the tyre: the lower edge of the hand is what touches
        this.armTo(side, t, w, side * -14, -0.3, 0.01);
      }
    }
    this.emoteLayer(dt);
    const nodes = this.nodes;
    nodes[HIPS].setLocalPosition(this.hipsPos);
    for (let j = 0; j < N; j++) nodes[j].setLocalRotation(q[j]);
    const turned = this.steer(dt, CHAIR_TURN);
    this.gear.rollChair(this.speed * dt * this.dirZ, turned);
    this.head.getWorldTransform().transformPoint(d.headTop, this.headTop);
    this.headTop.y += d.tagGap;
  }

  /**
   * Rank 5: lying in the bed under the cover, phone held over the chest, breathing. The bed
   * trails the root's turn and its casters swivel toward the travel; the name tag floats over
   * the pillow end.
   */
  private bedLayer(dt: number) {
    const d = this.data;
    const q = this.q;
    const w = this.walk;
    const tq = this.tq;
    for (let j = 0; j < N; j++) q[j].copy(d.lieBed[j]);
    const t = this.time;
    const b = Math.sin(t * this.breathHz * Math.PI * 2 + this.breathPhase);
    q[SPINE].mul(tq.setFromEulerAngles(-1.3 * b, 0, 0));
    q[NECK].mul(tq.setFromEulerAngles(0.5 * b + 5 * w, 0, 0));
    q[HEAD].mul(tq.setFromEulerAngles(0.5 * b + 4 * w, 2.5 * Math.sin(t * 0.31 + this.breathPhase), 0));
    // the phone hand drifts a little; it steadies the phone when the bed rolls
    q[AUR].mul(tq.setFromEulerAngles(1.2 * b + 1.5 * Math.sin(t * 0.47), 0, 1.2 * Math.sin(t * 0.39) - 3 * w));
    this.hipsPos.copy(d.lieBedAt);
    this.hipsPos.y += gearDims().casters.lift;
    this.bedEmotes(dt);
    const nodes = this.nodes;
    nodes[HIPS].setLocalPosition(this.hipsPos);
    for (let j = 0; j < N; j++) nodes[j].setLocalRotation(q[j]);
    const gear = this.gear;
    gear.breathe(b);
    const turned = this.steer(dt, BED_TURN);
    gear.rollBed(dt, this.dirX * this.speed, this.dirZ * this.speed, dt > 0 ? turned / dt : 0);
    if (gear.phone && !gear.phoneAimed) this.aimPhone(gear.phone);
    // name tag: over the head, clear of the headboard and the raised phone
    const hw = this.head.getWorldTransform();
    hw.transformPoint(this.v1.set(0, 0.14, 0.05), this.headTop);
    this.headTop.y += 0.3 + d.tagGap;
  }

  /** Screen (+Y of the phone) toward the eyes, top edge along the head's up; kept as a local rotation. */
  private aimPhone(phone: pc.Entity) {
    const pos = phone.getPosition();
    const hw = this.head.getWorldTransform();
    const eyes = hw.transformPoint(this.v1.set(0, 0.14, 0.155), this.v1);
    const up = hw.transformVector(this.v2.set(0, -1, 0), this.v2);
    const look = PHONE_LOOK.setLookAt(pos, eyes, up);
    phone.setRotation(this.tq.setFromMat4(look).mul(this.tq2.setFromEulerAngles(-90, 0, 0)));
    this.gear.phoneAimed = true;
  }

  /** Emotes from the bed (the body's forward is up): a raised left hand, a shaking laugh, both arms up. */
  private bedEmotes(dt: number) {
    const q = this.q;
    const tq = this.tq;
    const TAU = Math.PI * 2;
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
      if (w <= 0) continue;
      const t = slot.t;
      const over = (j: number, x: number, y: number, z: number) => slerp(q[j], q[j], tq.setFromEulerAngles(x, y, z), w);
      const add = (j: number, x: number, y: number, z: number) => {
        tq.setFromEulerAngles(x, y, z);
        q[j].mul(slerp(tq, IDENTITY, tq, w));
      };
      if (slot.name === "wave") {
        const u = Math.sin(t * 3 * TAU);
        over(AUL, -84, 0, 10);
        over(ALL, -14, 0, 24 * u);
        add(HEAD, 6, 14, 0);
      } else if (slot.name === "laugh") {
        const bob = Math.sin(t * 4.2 * TAU);
        add(SPINE, 3 * bob, 0, 0);
        add(NECK, 4, 0, 0);
        add(HEAD, 8 + 4 * Math.sin(t * 4.2 * TAU + 0.8), 0, 0);
        add(AUR, 3 * bob, 0, 0);
        over(AUL, -40 - 4 * bob, 0, -6);
        over(ALL, -95, -50, 0);
      } else {
        const pump = Math.sin(t * 2.6 * TAU);
        const elbow = -16 - 34 * (0.5 - 0.5 * pump);
        over(AUL, -82 - 8 * pump, 0, 14);
        over(AUR, -82 - 8 * pump, 0, -14);
        over(ALL, elbow, 0, 0);
        over(ALR, elbow, 0, 0);
        add(HEAD, 8, 0, 0);
      }
    }
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

  /**
   * Optional mood (login queue): the manifest slump pose over idle / walk. Head, neck and back
   * bow by the pose's angles, the arms hang forward with most of their swing gone, and the head
   * dips a little with every step. Legs and hips are untouched, so the feet stay planted.
   */
  private trudgeLayer() {
    const w = this.trudge;
    const { q, tq } = this;
    const s = this.data.slump;
    q[SPINE].mul(slerp(tq, IDENTITY, s[SPINE], w));
    q[NECK].mul(slerp(tq, IDENTITY, s[NECK], w));
    q[HEAD].mul(slerp(tq, IDENTITY, s[HEAD], w));
    const arms = 0.7 * w;
    slerp(q[AUL], q[AUL], s[AUL], arms);
    slerp(q[ALL], q[ALL], s[ALL], arms);
    slerp(q[AUR], q[AUR], s[AUR], arms);
    slerp(q[ALR], q[ALR], s[ALR], arms);
    q[HEAD].mul(tq.setFromEulerAngles(2.5 * w * this.walk * Math.sin(this.phase * Math.PI * 4), 0, 0));
  }

  private emoteLayer(dt: number) {
    let hop = 0;
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
      if (slot.name === "jump") {
        // two hops (0.5 m, then 0.3 m) with the arms half-way into the cheer
        const u = (slot.t - JUMP_START) / JUMP_TIME;
        if (u > 0 && u < 1) hop = Math.max(hop, JUMP_HEIGHT * 4 * u * (1 - u) * slot.fade);
        const v = (slot.t - JUMP_START - JUMP_TIME) / (JUMP_TIME * 0.8);
        if (v > 0 && v < 1) hop = Math.max(hop, JUMP_HEIGHT * 0.6 * 4 * v * (1 - v) * slot.fade);
        if (w > 0) this.applyEmote("cheer", slot.t, w * 0.55);
      } else if (w > 0) this.applyEmote(slot.name, slot.t, w);
    }
    // The caller places the root on the floor every frame before update(): lift it for the hop.
    if (hop > 0) {
      const p = this.entity.getLocalPosition();
      this.entity.setLocalPosition(p.x, p.y + hop, p.z);
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
    this.gear.destroy();
    this.entity.destroy();
  }
}

/**
 * Create an avatar (call after preloadAvatars resolved). An unknown variant, or one that failed to
 * load, falls back to the first loaded variant.
 */
export function createAvatar(
  app: pc.AppBase,
  /** trudge (0..1, default 0): bowed, slumped mood over idle / walk (the login queue). */
  opts: { variant: string; seed?: number; trudge?: number },
): Avatar {
  const data = variants.get(opts.variant) ?? anyVariant();
  if (!data) throw new Error("createAvatar: await preloadAvatars(app) first");
  const seed = opts.seed ?? (Math.imul(++created, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  return new FanAvatar(app, data, seed, opts.trudge);
}
