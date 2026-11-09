/**
 * characters — fan avatars for "Tê Liệt", concept v3 "Hang trú thua"
 * (targets: design/concepts/v3/03-tenure.png avatar turnarounds, 04-props.png fan strip,
 * 01/02 fans around the fire).
 *
 * ONE parametric rig, several outfit variants exported as separate GLBs
 * (tl_char_fan_<variant>_v01). Every variant has the SAME skeleton: identical joint names,
 * hierarchy and pivots, so one set of animations / poses drives all of them.
 *
 *   root (feet centre) > hips > spine > neck > head
 *                               spine > arm_upper_l > arm_lower_l (hand included)
 *                               spine > arm_upper_r > arm_lower_r
 *                        hips > leg_upper_l > leg_lower_l (shoe included)
 *                        hips > leg_upper_r > leg_lower_r
 *
 * Every joint node sits AT its pivot with zero rest rotation; limbs hang along -Y in their
 * node's space, so a pose is just absolute local euler angles (PlayCanvas order). The slight
 * "arms away from the body" rest stance is baked into the arm meshes (RIG.armTilt), not into
 * node rotations. Left = +X, right = -X, facing +Z, feet at y = 0, about 1.75 m tall.
 *
 * Rigid low-poly parts (no skinning): elbows/knees/shoulders have overlap blocks so bends do
 * not open gaps. One material (tl_matte) per avatar, per-face colours, flat shading.
 * The poses in POSES were solved numerically (elbows on knees / palms on the face / soles on
 * the floor) and checked in gallery renders (?pose=all).
 *
 * Debug: TL_CHAR_DEBUG=stool adds a 0.45 m stool proxy to every avatar's ROOT mesh (not moved
 * by poses) to check the sitting poses in the gallery. Never ship with it set.
 */
import {
  Model,
  MeshBuilder,
  ModelNode,
  PALETTE as P,
  mix,
  shade,
  shape2d,
  rotatePoint,
  type Color,
  type PrimOpts,
  type Vec2,
  type Vec3,
} from "../lib.js";

type Side = 1 | -1;

/* =========================================================================================
 * Small vector helpers
 * ========================================================================================= */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const vlen = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/* =========================================================================================
 * Rig definition (shared by every variant)
 * ========================================================================================= */

/** Joint offsets (parent-local, metres). World rest pivots are written to manifest meta.rig. */
export const RIG = {
  hips: [0, 0.94, 0] as Vec3, // root -> hips (pelvis / belt line)          world y 0.94
  spine: [0, 0.07, 0] as Vec3, // hips -> spine (waist)                      world y 1.01
  neck: [0, 0.335, -0.005] as Vec3, // spine -> neck (base of the neck)     world y 1.345
  head: [0, 0.04, 0] as Vec3, // neck -> head (skull base)                   world y 1.385
  shoulder: [0.27, 0.3, 0] as Vec3, // spine -> arm_upper_l (x mirrored for _r), world y 1.31
  upperArm: 0.28, // shoulder -> elbow
  forearm: 0.21, // elbow -> wrist; the hand reaches 0.32 below the elbow
  hip: [0.1, -0.1, 0] as Vec3, // hips -> leg_upper_l (x mirrored for _r)   world y 0.84
  thigh: 0.32, // hip -> knee                                                world y 0.52
  shin: 0.52, // knee -> sole (knee height suits a 0.45 m seat)
  /** Degrees: arms hang slightly away from the body. Baked into the arm meshes. */
  armTilt: 4,
};

/** Head block in head-local space (pivot at the skull base). Face plane at z = H.zf. */
const H = { hx: 0.15, y0: -0.005, top: 0.305, zf: 0.155, zb: -0.13, cz: 0.0125, eyeY: 0.14 };
/** Hand block centre in arm_lower space (before the baked tilt). */
const HAND_Y = -0.265;

interface Rig {
  m: Model;
  hips: ModelNode;
  spine: ModelNode;
  neck: ModelNode;
  head: ModelNode;
  armU: { l: ModelNode; r: ModelNode };
  armL: { l: ModelNode; r: ModelNode };
  legU: { l: ModelNode; r: ModelNode };
  legL: { l: ModelNode; r: ModelNode };
}
const LR = (s: Side): "l" | "r" => (s === 1 ? "l" : "r");
/** Elbow position in arm_upper space (follows the baked tilt). */
const elbowAt = (s: Side): Vec3 => rotatePoint([0, -RIG.upperArm, 0], [0, 0, s * RIG.armTilt]);

function makeRig(m: Model): Rig {
  const hips = m.node("hips", { at: RIG.hips });
  const spine = hips.child("spine", { at: RIG.spine });
  const neck = spine.child("neck", { at: RIG.neck });
  const head = neck.child("head", { at: RIG.head });
  const sh = (s: Side): Vec3 => [s * RIG.shoulder[0], RIG.shoulder[1], RIG.shoulder[2]];
  const armUl = spine.child("arm_upper_l", { at: sh(1) });
  const armLl = armUl.child("arm_lower_l", { at: elbowAt(1) });
  const armUr = spine.child("arm_upper_r", { at: sh(-1) });
  const armLr = armUr.child("arm_lower_r", { at: elbowAt(-1) });
  const hp = (s: Side): Vec3 => [s * RIG.hip[0], RIG.hip[1], RIG.hip[2]];
  const legUl = hips.child("leg_upper_l", { at: hp(1) });
  const legLl = legUl.child("leg_lower_l", { at: [0, -RIG.thigh, 0] });
  const legUr = hips.child("leg_upper_r", { at: hp(-1) });
  const legLr = legUr.child("leg_lower_r", { at: [0, -RIG.thigh, 0] });
  return {
    m,
    hips,
    spine,
    neck,
    head,
    armU: { l: armUl, r: armUr },
    armL: { l: armLl, r: armLr },
    legU: { l: legUl, r: legUr },
    legL: { l: legLl, r: legLr },
  };
}

/* =========================================================================================
 * Geometry helpers
 * ========================================================================================= */

/** Horizontal cross-section: w (x) by d (z) rectangle at height y with bevelled corners. */
interface Ring {
  y: number;
  w: number;
  d: number;
  /** Corner bevel (m). Default 16 % of the smaller side. 0 = sharp rectangle. */
  bev?: number;
  /** Optional separate bevel for the two front (+z) corners. */
  bevF?: number;
  x?: number;
  z?: number;
}
function ringPts(r: Ring): Vec3[] {
  const hw = r.w / 2;
  const hd = r.d / 2;
  const b = Math.min(r.bev ?? Math.min(r.w, r.d) * 0.16, hw * 0.45, hd * 0.45);
  const bf = Math.min(r.bevF ?? b, hw * 0.45, hd * 0.45);
  const cx = r.x ?? 0;
  const cz = r.z ?? 0;
  const y = r.y;
  if (b <= 1e-6 && bf <= 1e-6)
    return [
      [cx + hw, y, cz + hd],
      [cx + hw, y, cz - hd],
      [cx - hw, y, cz - hd],
      [cx - hw, y, cz + hd],
    ];
  return [
    [cx + hw - bf, y, cz + hd],
    [cx + hw, y, cz + hd - bf],
    [cx + hw, y, cz - hd + b],
    [cx + hw - b, y, cz - hd],
    [cx - hw + b, y, cz - hd],
    [cx - hw, y, cz - hd + b],
    [cx - hw, y, cz + hd - bf],
    [cx - hw + bf, y, cz + hd],
  ];
}
/** Chunky convex block lofted through rings (hull). Large flat faces, bevelled corners. */
function block(b: MeshBuilder, rings: Ring[], o: PrimOpts): void {
  b.hull(rings.flatMap(ringPts), o);
}

/** A straight bar of rectangular section from a to c (w across, th along the normal). */
function beam(
  b: MeshBuilder,
  a: Vec3,
  c: Vec3,
  w: number,
  th: number,
  o: PrimOpts,
  up: Vec3 = [0, 1, 0],
  taper = 1,
) {
  const d = norm(sub(c, a));
  let t = cross(d, up);
  if (vlen(t) < 1e-4) t = cross(d, [1, 0, 0]);
  t = norm(t);
  const n = norm(cross(t, d));
  const pts: Vec3[] = [];
  for (const [p, k] of [
    [a, 1],
    [c, taper],
  ] as [Vec3, number][])
    for (const sw of [-1, 1])
      for (const sn of [-1, 1]) pts.push(add(p, add(scl(t, (sw * w * k) / 2), scl(n, (sn * th * k) / 2))));
  b.hull(pts, o);
}

/**
 * Hair clump: a flat-ish blade rooted at `base` (sunk into the hair shell) pointing along
 * `dir`. Width across, thickness along the blade normal, tip narrowed to `tip` x width.
 */
function clump(b: MeshBuilder, base: Vec3, dir: Vec3, length: number, w: number, th: number, o: PrimOpts, tip = 0.25) {
  const d = norm(dir);
  let t = cross(d, [0, 1, 0]);
  if (vlen(t) < 1e-3) t = [1, 0, 0];
  t = norm(t);
  const n = norm(cross(t, d));
  const root = sub(base, scl(d, length * 0.25));
  const end = add(base, scl(d, length));
  const pts: Vec3[] = [];
  for (const sw of [-1, 1]) for (const sn of [-1, 1]) pts.push(add(root, add(scl(t, (sw * w) / 2), scl(n, (sn * th) / 2))));
  for (const sw of [-1, 1]) pts.push(add(end, scl(t, (sw * w * tip) / 2)));
  // a mid ridge point keeps the clump from looking like a needle
  pts.push(add(lerp3(root, end, 0.55), scl(n, th * 0.55)));
  b.hull(pts, o);
}

/** Ragged hem: little triangular flaps hanging below a ring's outline (torn clothes). */
function raggedHem(
  b: MeshBuilder,
  ring: Ring,
  o: { color: Color; len: [number, number]; spacing?: number; skip?: number; vary?: number },
) {
  const pts = ringPts(ring);
  const c: Vec3 = [ring.x ?? 0, ring.y, ring.z ?? 0];
  const rng = b.rng;
  const spacing = o.spacing ?? 0.045;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const e = pts[(i + 1) % pts.length];
    const L = vlen(sub(e, a));
    const n = Math.max(1, Math.round(L / spacing));
    for (let k = 0; k < n; k++) {
      if (rng.chance(o.skip ?? 0.25)) continue;
      const t0 = k / n + rng.range(0, 0.12) / n;
      const t1 = (k + 1) / n - rng.range(0, 0.12) / n;
      const p0 = lerp3(a, e, t0);
      const p1 = lerp3(a, e, t1);
      const mid = lerp3(a, e, (t0 + t1) / 2 + rng.jitter(0.25) / n);
      const tip: Vec3 = [mid[0], mid[1] - rng.range(o.len[0], o.len[1]), mid[2]];
      const inward = (p: Vec3) => add(p, scl(norm(sub([c[0], p[1], c[2]], p)), 0.006));
      b.hull([p0, p1, tip, inward(p0), inward(p1), inward(tip)], { color: o.color, vary: o.vary ?? 0.05 });
    }
  }
}

/** Irregular star-ish polygon (torn hole / rip) of radius r. */
function ripShape(rngNext: () => number, r: number, n = 9, squash = 0.8): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rngNext() * 0.25;
    const k = i % 2 ? 0.45 + rngNext() * 0.2 : 0.8 + rngNext() * 0.2;
    return [Math.cos(a) * r * k, Math.sin(a) * r * k * squash] as Vec2;
  });
}

/* =========================================================================================
 * Variant spec
 * ========================================================================================= */

type HairStyle = "messy" | "spiky" | "neat" | "short" | "buzz" | "puff" | "fringe";
interface Spec {
  key: string;
  notes: string;
  skin: Color;
  hair: Color;
  hairStyle: HairStyle;
  eyes?: "closed" | "open";
  top: {
    kind: "tee" | "hoodie";
    body: Color;
    sleeve: Color;
    /** crimson band near the sleeve end (tee) */
    sleeveBand?: Color;
    /** colour of the shoulder-top faces of the torso */
    shoulder?: Color;
    /** colour of the torso's side faces (jersey side panels) */
    sidePanel?: Color;
    collar?: Color;
    cuff?: Color;
    hem?: Color;
    hood?: "down" | "up";
    hoodColor?: Color;
    hoodLining?: Color;
    pocket?: boolean;
    strings?: Color;
    torn?: boolean;
    stripes?: Color;
    patch?: Color;
    emblemBack?: Color;
    /** horizontal band around the belly (jersey) */
    band?: Color;
    rips?: { at: Vec2; r: number; back?: boolean }[];
  };
  bottom: { kind: "pants" | "shorts"; color: Color; cuff?: Color; torn?: boolean; kneeRip?: Side };
  feet: { kind: "sneaker" | "sandal"; upper: Color; sole: Color; accent?: Color; sock?: Color };
  cap?: { crown: Color; front: Color; brim: Color };
  headband?: Color;
  glasses?: Color;
  scarf?: Color;
  /** thin nasal oxygen cannula looped over the ears (rank 03) */
  cannula?: Color;
}

const DARK: Color = "#241B16"; // eyes, mouth lines

/* =========================================================================================
 * Body parts
 * ========================================================================================= */

const TORSO = {
  // spine-local rings (y relative to the waist pivot). Front/back faces are vertical planes
  // between the first two rings (decals, emblem). k = extra bulk for hoodies.
  rings: (k: number): Ring[] => [
    { y: -0.125, w: 0.404 + 2 * k, d: 0.244 + 2 * k, z: 0.002, bev: 0.038 },
    { y: 0.262, w: 0.42 + 2 * k, d: 0.244 + 2 * k, z: 0.002, bev: 0.038 },
    { y: 0.325, w: 0.432 + 2 * k, d: 0.214 + 2 * k, z: 0, bev: 0.042 },
    { y: 0.372, w: 0.27 + k, d: 0.165 + k, z: -0.006, bev: 0.036 },
  ],
  front: (k: number) => 0.002 + 0.122 + k,
  back: (k: number) => 0.002 - 0.122 - k,
};
const HOODIE_BULK = 0.012;

function buildPelvis(r: Rig, s: Spec) {
  const b = r.hips.geo;
  block(
    b,
    [
      { y: 0.085, w: 0.384, d: 0.226, bev: 0.036 },
      { y: -0.07, w: 0.384, d: 0.23, bev: 0.036 },
      { y: -0.15, w: 0.34, d: 0.2, z: -0.006, bev: 0.042 },
      // buttocks: reach the seat when sitting (hips y 0.645 - 0.19 = 0.455)
      { y: -0.19, w: 0.3, d: 0.11, z: -0.055, bev: 0.035 },
    ],
    { color: s.bottom.color, vary: 0.04 },
  );
  if (s.bottom.torn) {
    const rr = b.rng;
    b.extrude(ripShape(() => rr.next(), 0.032), { depth: 0, at: [0.115, -0.1, 0.115 + 0.003], color: shade(s.skin, 0.9) });
  }
}

function buildTorso(r: Rig, s: Spec) {
  const b = r.spine.geo;
  const t = s.top;
  const k = t.kind === "hoodie" ? HOODIE_BULK : 0;
  const zf = TORSO.front(k);
  const zb = TORSO.back(k);
  const paint = (f: { normal: Vec3 }): Color => {
    if (t.shoulder && f.normal[1] > 0.3) return t.shoulder;
    if (t.sidePanel && Math.abs(f.normal[0]) > 0.8) return t.sidePanel;
    return t.body;
  };
  block(b, TORSO.rings(k), { color: paint, vary: 0.035 });
  if (t.band) {
    // jersey belly band, a hair proud of the torso
    const R = TORSO.rings(k);
    const at = (y: number): Ring => {
      const u = (y - R[0].y) / (R[1].y - R[0].y);
      return { y, w: R[0].w + (R[1].w - R[0].w) * u + 0.008, d: R[0].d + 0.008, z: R[0].z, bev: 0.04 };
    };
    block(b, [at(0.015), at(0.115)], { color: t.band, vary: 0.03 });
  }

  // neckline
  if (t.hood !== "up") {
    if (t.collar)
      b.extrude(
        shape2d.stroke(
          [
            [-0.072, 0.262],
            [0, 0.19],
            [0.072, 0.262],
          ],
          0.026,
        ),
        { depth: 0, at: [0, 0, zf + 0.002], color: t.collar },
      );
    block(
      b,
      [
        { y: 0.36, w: 0.18, d: 0.145, z: -0.004, bev: 0.032 },
        { y: 0.385, w: 0.17, d: 0.135, z: -0.004, bev: 0.032 },
      ],
      { color: t.collar ?? shade(t.body, 0.78) },
    );
  }

  if (t.kind === "hoodie") {
    const R0 = TORSO.rings(k)[0];
    // ribbed hem band
    block(
      b,
      [
        { y: R0.y - 0.025, w: R0.w + 0.012, d: R0.d + 0.012, z: R0.z, bev: 0.04 },
        { y: R0.y + 0.035, w: R0.w + 0.016, d: R0.d + 0.012, z: R0.z, bev: 0.04 },
      ],
      { color: t.hem ?? shade(t.body, 0.85), vary: 0.03 },
    );
    if (t.pocket) b.box({ size: [0.24, 0.11, 0.016], at: [0, 0.035, zf + 0.006], chamfer: 0.004, color: shade(t.body, 0.86) });
    if (t.strings)
      for (const x of [-0.048, 0.048])
        beam(b, [x, 0.335, zf + 0.004], [x * 1.15, 0.205, zf + 0.012], 0.015, 0.01, { color: t.strings });
  }

  if (t.hood === "down") {
    // hood folded down behind the neck + its edges hugging the neck
    const hc = t.hoodColor ?? t.body;
    block(
      b,
      [
        { y: 0.265, w: 0.28, d: 0.09, z: -0.165, bev: 0.03 },
        { y: 0.345, w: 0.35, d: 0.145, z: -0.152, bev: 0.048 },
        { y: 0.42, w: 0.31, d: 0.115, z: -0.152, bev: 0.048 },
      ],
      { color: hc, vary: 0.04 },
    );
    for (const sd of [1, -1] as Side[])
      beam(b, [sd * 0.13, 0.4, -0.075], [sd * 0.095, 0.34, 0.08], 0.058, 0.038, { color: shade(hc, 0.92), vary: 0.04 });
  }
  if (t.hood === "up") {
    // lower part of the raised hood around the neck (the rest is on the head)
    const hc = t.hoodColor ?? t.body;
    block(
      b,
      [
        { y: 0.325, w: 0.35, d: 0.23, z: -0.025, bev: 0.065 },
        { y: 0.42, w: 0.31, d: 0.21, z: -0.03, bev: 0.065 },
      ],
      { color: hc, vary: 0.04 },
    );
    if (t.hoodLining)
      block(
        b,
        [
          { y: 0.385, w: 0.2, d: 0.03, z: 0.08, bev: 0.01 },
          { y: 0.42, w: 0.19, d: 0.03, z: 0.075, bev: 0.01 },
        ],
        { color: t.hoodLining },
      );
  }

  if (t.stripes) {
    // worn-white chevrons on the chest (no text, no logo); kept inside the front plane
    for (const sd of [1, -1] as Side[])
      b.extrude(
        shape2d.stroke(
          [
            [sd * 0.155, 0.248],
            [sd * 0.11, 0.2],
            [sd * 0.065, 0.248],
          ],
          0.026,
        ),
        { depth: 0, at: [0, 0, zf + 0.002], color: t.stripes },
      );
  }
  if (t.rips) {
    const rr = b.rng;
    for (const rip of t.rips) {
      const shape = ripShape(() => rr.next(), rip.r);
      if (rip.back)
        b.extrude(shape, { depth: 0, at: [rip.at[0], rip.at[1], zb - 0.002], rot: [0, 180, 0], color: shade(s.skin, 0.9) });
      else b.extrude(shape, { depth: 0, at: [rip.at[0], rip.at[1], zf + 0.002], color: shade(s.skin, 0.9) });
    }
  }
  if (t.patch) {
    b.box({ size: [0.095, 0.085, 0.006], at: [0.07, 0.05, zb - 0.002], rot: [0, 0, 8], color: t.patch });
    for (const x of [-0.032, 0, 0.032])
      b.box({ size: [0.004, 0.022, 0.004], at: [0.07 + x, 0.092, zb - 0.005], rot: [0, 0, 8], color: DARK });
  }
  if (t.torn) {
    const R0 = TORSO.rings(k)[0];
    raggedHem(b, { ...R0, y: R0.y + 0.001 }, { color: t.body, len: [0.025, 0.06], spacing: 0.06, skip: 0.3 });
  }
  if (t.emblemBack) {
    // the only allowed emblem: simplified symbol, small, centred on the upper back
    b.emblem({ height: 0.18, at: [0, 0.155, zb - 0.003], rot: [0, 180, 0], color: t.emblemBack });
  }
  if (s.scarf) {
    // worn towel-scarf: wrap around the neck + two ends hanging down the chest
    block(
      b,
      [
        { y: 0.335, w: 0.3, d: 0.23, z: -0.004, bev: 0.07 },
        { y: 0.418, w: 0.25, d: 0.2, z: -0.006, bev: 0.07 },
      ],
      { color: s.scarf, vary: 0.05 },
    );
    beam(b, [0.078, 0.36, zf - 0.008], [0.095, 0.115, zf + 0.012], 0.078, 0.02, { color: s.scarf, vary: 0.05 }, [0, 0, 1]);
    beam(b, [-0.07, 0.36, zf - 0.008], [-0.078, 0.16, zf + 0.012], 0.075, 0.02, { color: shade(s.scarf, 0.92), vary: 0.05 }, [0, 0, 1]);
    for (const [x, y] of [
      [0.095, 0.115],
      [-0.078, 0.16],
    ])
      b.box({ size: [0.08, 0.012, 0.022], at: [x, y + 0.004, zf + 0.012], color: shade(s.scarf, 0.8) });
  }
}

function buildNeckHead(r: Rig, s: Spec) {
  r.neck.geo.box({ size: [0.12, 0.09, 0.11], at: [0, 0.02, 0], chamfer: 0.012, color: shade(s.skin, 0.86) });
  const b = r.head.geo;
  // head block (big, slightly bevelled, face on +Z)
  b.box({
    size: [H.hx * 2, H.top - H.y0, H.zf - H.zb],
    at: [0, (H.top + H.y0) / 2, H.cz],
    chamfer: 0.028,
    color: s.skin,
    vary: 0.03,
  });
  const zf = H.zf;
  const ey = H.eyeY;
  if (s.top.hood !== "up")
    for (const sd of [1, -1] as Side[])
      b.box({ size: [0.034, 0.072, 0.06], at: [sd * (H.hx + 0.004), ey - 0.01, 0.0], chamfer: 0.007, color: shade(s.skin, 0.9) });
  const open = s.eyes === "open";
  for (const sd of [1, -1] as Side[]) {
    if (open) b.box({ size: [0.03, 0.028, 0.012], at: [sd * 0.064, ey, zf + 0.002], color: DARK });
    else b.box({ size: [0.058, 0.015, 0.012], at: [sd * 0.064, ey - 0.003, zf + 0.002], rot: [0, 0, -sd * 4], color: DARK });
    // sad brows: inner ends raised
    b.box({
      size: [0.066, 0.016, 0.012],
      at: [sd * 0.068, ey + 0.046, zf + 0.002],
      rot: [0, 0, -sd * 10],
      color: mix(s.hair, DARK, 0.3),
    });
  }
  b.box({ size: [0.044, 0.06, 0.036], at: [0, ey - 0.038, zf + 0.01], chamfer: 0.008, color: shade(s.skin, 0.94) });
  b.box({ size: [0.058, 0.011, 0.01], at: [0, ey - 0.088, zf + 0.001], color: mix(s.skin, DARK, 0.55) });

  buildHair(b, s);
  if (s.cap) buildCap(b, s.cap);
  if (s.headband) buildHeadband(b, s.headband);
  if (s.glasses) buildGlasses(b, s.glasses);
  if (s.top.hood === "up") buildHoodUp(b, s);
  if (s.cannula) buildCannula(b, s.cannula);
}

/** Nasal cannula: thin tube under the nose, along the cheeks, over the ears, joined under the chin. */
function buildCannula(b: MeshBuilder, color: Color) {
  const zf = H.zf;
  const ny = H.eyeY - 0.07; // just under the nose block
  const pts: Vec3[] = [
    [-H.hx - 0.007, 0.105, 0.02],
    [-0.1, ny + 0.008, zf + 0.006],
    [-0.028, ny, zf + 0.03],
    [0.028, ny, zf + 0.03],
    [0.1, ny + 0.008, zf + 0.006],
    [H.hx + 0.007, 0.105, 0.02],
    [H.hx + 0.006, 0.005, 0.035],
    [0.05, -0.03, 0.09],
    [-0.05, -0.03, 0.09],
    [-H.hx - 0.006, 0.005, 0.035],
  ];
  b.tube(pts, { radius: 0.0065, sides: 4, closed: true, color, vary: 0.03 });
}

/** Hair volume hugging the top/back of the head block. */
function hairShell(b: MeshBuilder, color: Color, o: { top?: number; bulk?: number; side?: number; back?: number; front?: number }) {
  const k = o.bulk ?? 0.016;
  const top = o.top ?? H.top + 0.03;
  const w = H.hx * 2 + 2 * k;
  const d = H.zf - H.zb + 2 * k;
  const pts: Vec3[] = [
    ...ringPts({ y: top, w: w - 0.065, d: d - 0.075, z: H.cz - 0.005, bev: 0.048 }),
    ...ringPts({ y: H.top - 0.013, w, d, z: H.cz + (o.front ?? 0), bev: 0.048 }),
    ...ringPts({ y: o.side ?? 0.195, w, d: 0.17 + k, z: -0.055 - k / 2, bev: 0.038 }),
    ...ringPts({ y: o.back ?? 0.07, w: w - 0.04, d: 0.065, z: H.zb + 0.012 - k / 2, bev: 0.022 }),
  ];
  b.hull(pts, { color, vary: 0.05 });
}

function buildHair(b: MeshBuilder, s: Spec) {
  const c = s.hair;
  const rng = b.rng;
  const o = (k = 1): PrimOpts => ({ color: k === 1 ? c : shade(c, k), vary: 0.07 });
  const ht = H.top - 0.013; // hairline ring height
  switch (s.hairStyle) {
    case "messy": {
      hairShell(b, c, { top: H.top + 0.032, bulk: 0.02 });
      // fringe hanging over the forehead
      for (let i = 0; i < 5; i++) {
        const x = -0.12 + i * 0.06 + rng.jitter(0.01);
        clump(b, [x, ht, H.zf - 0.03], [rng.jitter(0.35) + x * 1.5, -0.8, 0.55], rng.range(0.095, 0.125), 0.085, 0.038, o(rng.range(0.85, 1.1)));
      }
      // top volume: clumps sticking up / out
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.jitter(0.3);
        const x = Math.cos(a) * 0.085;
        const z = Math.sin(a) * 0.08 - 0.005;
        clump(b, [x, H.top + 0.018, z], [x * 6 + rng.jitter(0.3), 0.75, z * 6 + rng.jitter(0.3)], rng.range(0.07, 0.095), 0.09, 0.044, o(rng.range(0.85, 1.12)));
      }
      // sides over the ears, back of the head
      for (const sd of [1, -1] as Side[])
        for (const z of [-0.04, 0.065])
          clump(b, [sd * (H.hx + 0.01), 0.235, z], [sd * 0.75, -0.6, 0.15 + rng.jitter(0.2)], rng.range(0.07, 0.09), 0.08, 0.038, o(0.92));
      for (const x of [-0.085, 0, 0.085])
        clump(b, [x, 0.16, H.zb - 0.012], [x * 2 + rng.jitter(0.2), -0.85, -0.45], rng.range(0.07, 0.095), 0.09, 0.038, o(0.9));
      break;
    }
    case "spiky": {
      hairShell(b, c, { top: H.top + 0.036, bulk: 0.018 });
      // swept-up spikes above the headband (white hair)
      for (let i = 0; i < 9; i++) {
        const u = i / 8;
        const x = -0.13 + u * 0.26 + rng.jitter(0.012);
        const z = 0.07 - (i % 3) * 0.07 + rng.jitter(0.01);
        clump(b, [x, H.top + 0.008, z], [x * 2.2 + rng.jitter(0.25), 0.85, -0.45 + rng.jitter(0.25)], rng.range(0.09, 0.125), 0.085, 0.044, o(rng.range(0.9, 1.08)), 0.18);
      }
      for (const sd of [1, -1] as Side[])
        for (const z of [-0.06, 0.045])
          clump(b, [sd * (H.hx + 0.008), 0.275, z], [sd * 0.85, 0.35, -0.35], rng.range(0.07, 0.09), 0.08, 0.038, o(0.95), 0.2);
      for (const x of [-0.08, 0.02, 0.1])
        clump(b, [x, 0.19, H.zb - 0.012], [x + rng.jitter(0.2), -0.6, -0.75], rng.range(0.065, 0.085), 0.09, 0.038, o(0.9));
      break;
    }
    case "neat": {
      hairShell(b, c, { top: H.top + 0.03, bulk: 0.016, front: 0.004 });
      // side-swept fringe: a slab from the left temple down toward the right brow
      const zf = H.zf;
      b.hull(
        [
          [0.155, ht + 0.012, zf + 0.012],
          [0.155, ht - 0.042, zf + 0.014],
          [-0.02, ht - 0.072, zf + 0.016],
          [-0.14, ht - 0.062, zf + 0.014],
          [-0.155, ht - 0.01, zf + 0.012],
          [0.14, ht + 0.032, zf - 0.04],
          [-0.14, ht + 0.022, zf - 0.04],
          [0.0, ht + 0.038, zf - 0.02],
        ],
        o(0.95),
      );
      for (let i = 0; i < 4; i++) {
        const x = -0.09 + i * 0.062 + rng.jitter(0.01);
        clump(b, [x, H.top + 0.012, -0.02 + rng.jitter(0.03)], [x * 2 + rng.jitter(0.2), 0.7, -0.5], rng.range(0.06, 0.08), 0.09, 0.044, o(rng.range(0.88, 1.1)));
      }
      for (const sd of [1, -1] as Side[])
        clump(b, [sd * (H.hx + 0.01), 0.23, 0.02], [sd * 0.5, -0.85, 0.1], 0.058, 0.08, 0.034, o(0.9));
      break;
    }
    case "short": {
      // short crop (fits under a cap): shell + sideburns
      hairShell(b, c, { top: H.top + 0.022, bulk: 0.012, side: 0.15, back: 0.06 });
      for (const sd of [1, -1] as Side[])
        b.box({ size: [0.02, 0.07, 0.04], at: [sd * (H.hx + 0.004), 0.17, 0.075], color: shade(c, 0.95) });
      break;
    }
    case "buzz": {
      // close crop with a little volume on top
      hairShell(b, c, { top: H.top + 0.018, bulk: 0.01, side: 0.17, back: 0.06 });
      for (let i = 0; i < 4; i++) {
        const x = -0.075 + i * 0.05 + rng.jitter(0.008);
        clump(b, [x, H.top + 0.008, 0.03 + rng.jitter(0.03)], [x + rng.jitter(0.2), 0.8, 0.25], rng.range(0.035, 0.05), 0.08, 0.03, o(rng.range(0.9, 1.1)), 0.35);
      }
      break;
    }
    case "puff": {
      // rounded faceted volume (coily hair) on a short base
      hairShell(b, c, { top: H.top + 0.02, bulk: 0.016, side: 0.17, back: 0.06 });
      b.rock({
        size: [H.hx * 2 + 0.085, 0.18, H.zf - H.zb + 0.06],
        at: [0, H.top + 0.018, H.cz - 0.008],
        points: 22,
        jitter: 0.22,
        color: c,
        vary: 0.1,
      });
      // a few coils breaking the outline
      for (const [x, z] of [
        [0.12, 0.07],
        [-0.13, 0.02],
        [0.05, -0.12],
        [-0.06, 0.12],
      ] as Vec2[])
        b.rock({ size: [0.075, 0.07, 0.075], at: [x, H.top + 0.03 + rng.range(0, 0.025), z], points: 8, jitter: 0.2, color: shade(c, rng.range(0.85, 1.15)), vary: 0.08 });
      break;
    }
    case "fringe": {
      // only what shows under a raised hood: short clumps falling from under the rim
      for (let i = 0; i < 3; i++) {
        const x = -0.08 + i * 0.08 + rng.jitter(0.008);
        clump(b, [x, H.top - 0.01, H.zf - 0.012], [rng.jitter(0.25) + x * 1.2, -0.85, 0.45], rng.range(0.065, 0.08), 0.095, 0.032, o(rng.range(0.85, 1.1)));
      }
      break;
    }
  }
}

function buildCap(b: MeshBuilder, cap: NonNullable<Spec["cap"]>) {
  const paint = (f: { normal: Vec3 }) => (f.normal[2] > 0.55 && f.normal[1] < 0.8 ? cap.front : cap.crown);
  const w = H.hx * 2 + 0.03;
  const d = H.zf - H.zb + 0.03;
  block(
    b,
    [
      { y: H.top - 0.055, w, d, z: H.cz, bev: 0.07 },
      { y: H.top + 0.025, w: w - 0.02, d: d - 0.018, z: H.cz, bev: 0.07 },
      { y: H.top + 0.063, w: 0.19, d: 0.19, z: H.cz, bev: 0.055 },
    ],
    { color: paint, vary: 0.04 },
  );
  // brim (tilted down a little toward the front)
  b.box({ size: [0.27, 0.022, 0.15], at: [0, H.top - 0.049, H.zf + 0.072], rot: [9, 0, 0], chamfer: 0.006, color: cap.brim, vary: 0.04 });
  b.box({ size: [0.034, 0.015, 0.034], at: [0, H.top + 0.068, H.cz], color: cap.front });
}

function buildHeadband(b: MeshBuilder, color: Color) {
  const y = H.top - 0.07;
  b.box({ size: [H.hx * 2 + 0.014, 0.048, H.zf - H.zb + 0.014], at: [0, y, H.cz], chamfer: 0.012, color, vary: 0.04 });
  // knot at the back + two tails hanging back and down to the left
  const k: Vec3 = [0.048, y - 0.004, H.zb - 0.028];
  b.box({ size: [0.068, 0.056, 0.038], at: add(k, [-0.005, 0.002, 0.008]), chamfer: 0.009, color: shade(color, 0.85) });
  const tails: [Vec3, Vec3, number][] = [
    [[0.015, -0.085, -0.032], [0.03, -0.075, -0.012], 0.95],
    [[0.065, -0.07, -0.022], [0.05, -0.065, -0.002], 0.88],
  ];
  for (const [d1, d2, sh] of tails) {
    const p1 = add(k, d1);
    const p2 = add(p1, d2);
    beam(b, k, p1, 0.058, 0.014, { color: shade(color, sh), vary: 0.04 }, [0, 0, 1]);
    beam(b, p1, p2, 0.056, 0.014, { color: shade(color, sh * 0.94), vary: 0.04 }, [0, 0, 1], 0.7);
  }
}

function buildGlasses(b: MeshBuilder, color: Color) {
  const z = H.zf + 0.012;
  const y = H.eyeY;
  const W = 0.088;
  const Hh = 0.066;
  const t = 0.015;
  const dz = 0.012;
  const o: PrimOpts = { color };
  for (const sd of [1, -1] as Side[]) {
    const cx = sd * 0.066;
    b.box({ size: [W, t, dz], at: [cx, y + Hh / 2 - t / 2, z], ...o });
    b.box({ size: [W, t, dz], at: [cx, y - Hh / 2 + t / 2, z], ...o });
    b.box({ size: [t, Hh - 2 * t, dz], at: [cx - W / 2 + t / 2, y, z], ...o });
    b.box({ size: [t, Hh - 2 * t, dz], at: [cx + W / 2 - t / 2, y, z], ...o });
    b.box({ size: [0.013, 0.013, 0.17], at: [sd * (H.hx + 0.008), y + Hh / 2 - 0.013, z - 0.088], ...o });
  }
  b.box({ size: [0.034, 0.013, dz], at: [0, y + 0.015, z], ...o });
}

function buildHoodUp(b: MeshBuilder, s: Spec) {
  const hc = s.top.hoodColor ?? s.top.body;
  const rim = s.top.hoodLining ?? shade(hc, 0.8);
  // A rounded hull around the head whose front plane sits just behind the face plane: the face
  // block pokes out of the opening and the hood frames it at the sides and over the forehead.
  const zFront = H.zf - 0.02;
  const zBack = H.zb - 0.06;
  const w = H.hx * 2 + 0.08;
  const d = zFront - zBack;
  const zc = (zFront + zBack) / 2;
  b.hull(
    [
      ...ringPts({ y: H.top + 0.075, w: w - 0.13, d: d - 0.12, z: zc - 0.03, bev: 0.05, bevF: 0.02 }),
      ...ringPts({ y: H.top + 0.045, w: w - 0.03, d: d - 0.03, z: zc - 0.012, bev: 0.08, bevF: 0.02 }),
      ...ringPts({ y: H.top - 0.02, w, d, z: zc, bev: 0.085, bevF: 0.016 }),
      ...ringPts({ y: 0.08, w, d, z: zc, bev: 0.085, bevF: 0.016 }),
      ...ringPts({ y: -0.04, w: w - 0.05, d: d - 0.08, z: zc - 0.04, bev: 0.06, bevF: 0.02 }),
      [0, 0.21, zBack - 0.035], // soft point at the back of the hood
    ],
    { color: hc, vary: 0.04 },
  );
  // opening rim (trim): two side bands + a band over the forehead, half sunk into the hood's
  // front plane so they read as its rolled edge, kept inside its outline
  const zr = zFront - 0.0015;
  const o: PrimOpts = { color: rim, vary: 0.03 };
  for (const sd of [1, -1] as Side[])
    beam(b, [sd * (H.hx + 0.012), -0.03, zr - 0.006], [sd * (H.hx + 0.012), H.top - 0.004, zr], 0.026, 0.027, o, [0, 0, 1]);
  beam(b, [-(H.hx + 0.012), H.top + 0.009, zr], [H.hx + 0.012, H.top + 0.009, zr], 0.03, 0.027, o, [0, 0, 1]);
}

/* ---------------- arms */

function buildArm(r: Rig, s: Spec, sd: Side) {
  const up = r.armU[LR(sd)];
  const lo = r.armL[LR(sd)];
  const t = s.top;
  const tilt: Vec3 = [0, 0, sd * RIG.armTilt];
  const skin = s.skin;
  up.geo.group({ rot: tilt }, (b) => {
    if (t.kind === "tee") {
      // short sleeve with a rounded shoulder cap
      const end: Ring = { y: -0.13, w: 0.156, d: 0.164, bev: 0.03 };
      block(b, [{ y: 0.05, w: 0.126, d: 0.136, bev: 0.034 }, { y: 0.012, w: 0.16, d: 0.168, bev: 0.032 }, end], {
        color: t.sleeve,
        vary: 0.04,
      });
      if (t.sleeveBand)
        block(b, [{ ...end, y: -0.09, w: 0.162, d: 0.17 }, { ...end, y: -0.135, w: 0.161, d: 0.169 }], { color: t.sleeveBand, vary: 0.03 });
      if (t.stripes)
        for (const y of [-0.08, -0.108])
          block(b, [{ ...end, y, w: 0.161, d: 0.169 }, { ...end, y: y - 0.013, w: 0.161, d: 0.169 }], { color: t.stripes });
      if (t.torn) raggedHem(b, end, { color: t.sleeve, len: [0.015, 0.04], spacing: 0.05, skip: 0.35 });
      // bare upper arm
      block(b, [{ y: -0.105, w: 0.116, d: 0.124 }, { y: -0.292, w: 0.112, d: 0.12 }], { color: skin, vary: 0.03 });
    } else {
      // long sleeve
      block(
        b,
        [
          { y: 0.052, w: 0.132, d: 0.14, bev: 0.034 },
          { y: 0.012, w: 0.164, d: 0.172, bev: 0.034 },
          { y: -0.3, w: 0.146, d: 0.154, bev: 0.03 },
        ],
        { color: t.sleeve, vary: 0.04 },
      );
    }
  });
  lo.geo.group({ rot: tilt }, (b) => {
    if (t.kind === "tee") {
      block(b, [{ y: 0.045, w: 0.118, d: 0.126 }, { y: -0.05, w: 0.118, d: 0.126 }], { color: shade(skin, 0.97) });
      block(b, [{ y: -0.03, w: 0.114, d: 0.122 }, { y: -0.21, w: 0.102, d: 0.11 }], { color: skin, vary: 0.03 });
    } else {
      block(b, [{ y: 0.05, w: 0.15, d: 0.158 }, { y: -0.05, w: 0.148, d: 0.156 }], { color: shade(t.sleeve, 0.96) });
      block(b, [{ y: -0.03, w: 0.144, d: 0.152 }, { y: -0.17, w: 0.136, d: 0.144 }], { color: t.sleeve, vary: 0.04 });
      block(b, [{ y: -0.155, w: 0.142, d: 0.148, bev: 0.024 }, { y: -0.208, w: 0.138, d: 0.144, bev: 0.024 }], {
        color: t.cuff ?? shade(t.sleeve, 0.85),
        vary: 0.03,
      });
      block(b, [{ y: -0.19, w: 0.096, d: 0.102 }, { y: -0.22, w: 0.094, d: 0.1 }], { color: skin });
    }
    // hand (mitten block, palm toward the thigh) + thumb forward
    b.box({ size: [0.074, 0.115, 0.11], at: [0, HAND_Y, 0.004], chamfer: 0.018, color: skin, vary: 0.03 });
    b.box({ size: [0.038, 0.062, 0.04], at: [-sd * 0.016, HAND_Y + 0.03, 0.062], rot: [-12, 0, 0], chamfer: 0.008, color: shade(skin, 0.95) });
  });
}

/* ---------------- legs */

function buildLeg(r: Rig, s: Spec, sd: Side) {
  const up = r.legU[LR(sd)].geo;
  const lo = r.legL[LR(sd)].geo;
  const pc = s.bottom.color;
  const skin = s.skin;
  const sole = -RIG.shin;
  if (s.bottom.kind === "pants") {
    // baggy trousers; the thigh is thinner front-to-back at the knee so seated thighs stay on
    // top of a 0.45 m seat
    block(up, [{ y: 0.08, w: 0.2, d: 0.19 }, { y: -RIG.thigh + 0.005, w: 0.18, d: 0.16 }], { color: pc, vary: 0.04 });
    // knee (slightly proud of the thigh so bends never open a gap)
    block(lo, [{ y: 0.05, w: 0.186, d: 0.168 }, { y: -0.06, w: 0.184, d: 0.166 }], { color: shade(pc, 0.96), vary: 0.03 });
    block(lo, [{ y: -0.03, w: 0.176, d: 0.162 }, { y: sole + 0.15, w: 0.166, d: 0.156 }], { color: pc, vary: 0.04 });
    block(lo, [{ y: sole + 0.19, w: 0.174, d: 0.166, bev: 0.026 }, { y: sole + 0.075, w: 0.176, d: 0.168, bev: 0.026 }], {
      color: s.bottom.cuff ?? shade(pc, 0.85),
      vary: 0.03,
    });
    if (s.bottom.kneeRip === sd) {
      const rr = lo.rng;
      lo.extrude(ripShape(() => rr.next(), 0.038, 9, 0.75), { depth: 0, at: [0, -0.005, 0.084 + 0.003], color: shade(skin, 0.9) });
    }
  } else {
    // shorts leg with a ragged hem, bare thigh below
    block(up, [{ y: 0.08, w: 0.214, d: 0.208 }, { y: -0.17, w: 0.212, d: 0.206 }], { color: pc, vary: 0.04 });
    if (s.bottom.torn) {
      raggedHem(up, { y: -0.17, w: 0.212, d: 0.206 }, { color: pc, len: [0.02, 0.045], spacing: 0.05, skip: 0.3 });
      const rr = up.rng;
      up.extrude(ripShape(() => rr.next(), 0.03), { depth: 0, at: [sd * 0.014, -0.1, 0.103 + 0.003], color: shade(skin, 0.9) });
    }
    block(up, [{ y: -0.13, w: 0.152, d: 0.156 }, { y: -RIG.thigh + 0.005, w: 0.146, d: 0.15 }], { color: skin, vary: 0.03 });
    block(lo, [{ y: 0.05, w: 0.152, d: 0.156 }, { y: -0.06, w: 0.15, d: 0.154 }], { color: shade(skin, 0.97) });
    block(lo, [{ y: -0.03, w: 0.146, d: 0.15 }, { y: sole + 0.21, w: 0.132, d: 0.138 }], { color: skin, vary: 0.03 });
  }
  // feet (sole at y = -RIG.shin)
  const f = s.feet;
  if (f.kind === "sneaker") {
    lo.box({ size: [0.152, 0.09, 0.29], at: [0, sole + 0.045, 0.037], chamfer: 0.019, color: f.upper, vary: 0.04 });
    lo.box({ size: [0.158, 0.026, 0.298], at: [0, sole + 0.013, 0.037], chamfer: 0.006, color: f.sole });
    lo.box({ size: [0.082, 0.024, 0.09], at: [0, sole + 0.09, 0.09], rot: [-14, 0, 0], color: f.accent ?? shade(f.upper, 1.15) });
    if (f.accent) lo.box({ size: [0.16, 0.032, 0.04], at: [0, sole + 0.05, -0.098], color: f.accent }); // heel tab
  } else {
    // white socks + sandals
    const sock = f.sock ?? P.white;
    block(lo, [{ y: sole + 0.25, w: 0.14, d: 0.146 }, { y: sole + 0.04, w: 0.142, d: 0.148 }], { color: sock, vary: 0.03 });
    lo.box({ size: [0.13, 0.052, 0.25], at: [0, sole + 0.036, 0.047], chamfer: 0.016, color: sock, vary: 0.03 });
    lo.box({ size: [0.152, 0.03, 0.295], at: [0, sole + 0.015, 0.042], chamfer: 0.006, color: f.sole });
    lo.box({ size: [0.146, 0.026, 0.062], at: [0, sole + 0.052, 0.09], chamfer: 0.005, color: f.upper });
    lo.box({ size: [0.146, 0.022, 0.034], at: [0, sole + 0.035, -0.048], chamfer: 0.004, color: f.upper });
  }
}

/* =========================================================================================
 * Poses (absolute local euler degrees; every pose lists every joint)
 * ========================================================================================= */

const ZERO: Vec3 = [0, 0, 0];
type PoseVal = Vec3 | { rot?: Vec3; at?: Vec3 };
function fullPose(over: Record<string, PoseVal>): Record<string, PoseVal> {
  const base: Record<string, PoseVal> = {
    hips: { at: RIG.hips, rot: ZERO },
    spine: ZERO,
    neck: ZERO,
    head: ZERO,
    arm_upper_l: ZERO,
    arm_lower_l: ZERO,
    arm_upper_r: ZERO,
    arm_lower_r: ZERO,
    leg_upper_l: ZERO,
    leg_lower_l: ZERO,
    leg_upper_r: ZERO,
    leg_lower_r: ZERO,
  };
  return { ...base, ...over };
}

/** Sitting on a 0.45 m seat: root on the floor under the seat centre. */
export const SIT = { hipsY: 0.645, hipsZ: -0.05, thigh: -86, shin: 86 };
/**
 * Seated legs for any seat height (feet flat on the floor, shins vertical): the thigh underside
 * rests on the seat (0.0948 below the hip joint) and the knee sits RIG.shin above the floor.
 * Valid for seatY ~0.38..0.56 m.
 */
export function seatLegs(seatY: number) {
  const hip = seatY + 0.0948;
  const c = Math.max(-0.5, Math.min(0.5, (hip - RIG.shin) / RIG.thigh));
  const thigh = Math.round((Math.acos(c) * 180) / Math.PI);
  return { hipsY: r4(hip - RIG.hip[1]), thigh: -thigh, shin: thigh };
}
const STOOL = seatLegs(0.42); // tl_furn_stool_v01 seat
const CHAIR = seatLegs(0.471); // tl_prop_wooden_chair_v01 seat
/** Hips height in the walk contact poses (front heel and back toe on the floor). */
const WALK_HIPS_Y = 0.936;

export const POSES: Record<string, Record<string, PoseVal>> = {
  // walk cycle extremes (contact poses): legs +-, opposite arm swing, hips bob down 8 mm
  walk_a: fullPose({
    hips: { at: [0, WALK_HIPS_Y, 0], rot: [0, 4, 0] },
    spine: [3, -5, 0],
    leg_upper_l: [-22, 0, 0],
    leg_lower_l: [5, 0, 0],
    leg_upper_r: [14, 0, 0],
    leg_lower_r: [22, 0, 0],
    arm_upper_l: [18, 0, 0],
    arm_lower_l: [-10, 0, 0],
    arm_upper_r: [-20, 0, 0],
    arm_lower_r: [-22, 0, 0],
  }),
  walk_b: fullPose({
    hips: { at: [0, WALK_HIPS_Y, 0], rot: [0, -4, 0] },
    spine: [3, 5, 0],
    leg_upper_r: [-22, 0, 0],
    leg_lower_r: [5, 0, 0],
    leg_upper_l: [14, 0, 0],
    leg_lower_l: [22, 0, 0],
    arm_upper_r: [18, 0, 0],
    arm_lower_r: [-10, 0, 0],
    arm_upper_l: [-20, 0, 0],
    arm_lower_l: [-22, 0, 0],
  }),
  // sitting on a 0.45 m seat, hands resting on the thighs near the knees
  sit: fullPose({
    hips: { at: [0, SIT.hipsY, SIT.hipsZ], rot: ZERO },
    spine: [8, 0, 0],
    neck: [4, 0, 0],
    head: [10, 0, 0],
    leg_upper_l: [SIT.thigh, 0, 0],
    leg_lower_l: [SIT.shin, 0, 0],
    leg_upper_r: [SIT.thigh, 0, 0],
    leg_lower_r: [SIT.shin, 0, 0],
    arm_upper_l: [2, 0, -28],
    arm_lower_l: [-75, 0, -3],
    arm_upper_r: [2, 0, 28],
    arm_lower_r: [-75, 0, 3],
  }),
  // seated, hunched over: elbows on the knees, palms over the eyes
  head_in_hands: fullPose({
    hips: { at: [0, SIT.hipsY, SIT.hipsZ], rot: ZERO },
    spine: [56, 0, 0],
    neck: [6, 0, 0],
    head: [15, 0, 0],
    leg_upper_l: [SIT.thigh, 0, 0],
    leg_lower_l: [SIT.shin, 0, 0],
    leg_upper_r: [SIT.thigh, 0, 0],
    leg_lower_r: [SIT.shin, 0, 0],
    arm_upper_l: [-48, -20, -44],
    arm_lower_l: [-87, -39, -19],
    arm_upper_r: [-48, 20, 44],
    arm_lower_r: [-87, 39, 19],
  }),
  // round stool tl_furn_stool_v01 (seat 0.42): same as sit with the legs from seatLegs(0.42)
  sit_stool: fullPose({
    hips: { at: [0, STOOL.hipsY, SIT.hipsZ], rot: ZERO },
    spine: [8, 0, 0],
    neck: [4, 0, 0],
    head: [10, 0, 0],
    leg_upper_l: [STOOL.thigh, 0, 0],
    leg_lower_l: [STOOL.shin, 0, 0],
    leg_upper_r: [STOOL.thigh, 0, 0],
    leg_lower_r: [STOOL.shin, 0, 0],
    arm_upper_l: [6, 0, -30],
    arm_lower_l: [-82, 0, -1],
    arm_upper_r: [6, 0, 30],
    arm_lower_r: [-82, 0, 1],
  }),
  // rank 03: leaning back in tl_prop_wooden_chair_v01 (root = chair origin), forearms on the
  // armrests (0.69 m); the cannula's right cheek lands on the oxygen hose end (-0.08, 1.17, -0.01)
  sit_chair: fullPose({
    hips: { at: [0, CHAIR.hipsY, -0.1], rot: ZERO },
    spine: [-15, 0, 0],
    neck: [12, 0, 0],
    head: [3, 0, 0],
    leg_upper_l: [CHAIR.thigh, 0, 0],
    leg_lower_l: [CHAIR.shin, 0, 0],
    leg_upper_r: [CHAIR.thigh, 0, 0],
    leg_lower_r: [CHAIR.shin, 0, 0],
    arm_upper_l: [20, -26, -17],
    arm_lower_l: [-96, 22, -12],
    arm_upper_r: [20, 26, 17],
    arm_lower_r: [-96, -22, 12],
  }),
  // rank 02: in tl_veh_wheelchair_v01 (root = wheelchair origin): seat 0.54, soles on the
  // footrest (0.17), back on the backrest, hands on the thighs
  sit_wheelchair: fullPose({
    hips: { at: [0, 0.735, -0.03], rot: ZERO },
    spine: [-4, 0, 0],
    neck: [6, 0, 0],
    head: [8, 0, 0],
    leg_upper_l: [-100, 0, 0],
    leg_lower_l: [100, 0, 0],
    leg_upper_r: [-100, 0, 0],
    leg_lower_r: [100, 0, 0],
    arm_upper_l: [10, 0, -26],
    arm_lower_l: [-83, 0, 7],
    arm_upper_r: [10, 0, 26],
    arm_lower_r: [-83, 0, -7],
  }),
  // rank 04: lying on the back in tl_veh_metal_bed_v01 (root = bed origin, head toward -Z,
  // mattress top 0.41, pillow top ~0.53), right hand holding a phone ~0.36 m above the face
  lie_bed: fullPose({
    hips: { at: [0, 0.5, -0.1], rot: [-90, 0, 0] },
    spine: [11, 0, 0],
    neck: [19, 0, 0],
    head: [4, 0, 0],
    leg_upper_l: [1, 0, 2],
    leg_lower_l: [-1, 0, 0],
    leg_upper_r: [1, 0, -2],
    leg_lower_r: [-1, 0, 0],
    arm_upper_l: [2, 0, 6],
    arm_lower_l: ZERO,
    arm_upper_r: [-53, 28, 40],
    arm_lower_r: [-52, -6, 32],
  }),
  // standing slump / sigh (idle variant): shoulders and head drop, knees soft
  slump: fullPose({
    hips: { at: [0, 0.939, -0.028], rot: ZERO },
    spine: [14, 0, 0],
    neck: [6, 0, 0],
    head: [20, 0, 0],
    arm_upper_l: [10, 0, 3],
    arm_lower_l: [-8, 0, 0],
    arm_upper_r: [10, 0, -3],
    arm_lower_r: [-8, 0, 0],
    leg_upper_l: [-5, 0, 0],
    leg_lower_l: [5, 0, 0],
    leg_upper_r: [-5, 0, 0],
    leg_lower_r: [5, 0, 0],
  }),
  // standing wave with the right arm (two keyframes: the forearm swings between them)
  wave: fullPose({
    spine: [0, 0, 2],
    head: [-4, -8, -4],
    arm_upper_r: [-10, 0, -140],
    arm_lower_r: [0, 0, -25],
  }),
  wave_b: fullPose({
    spine: [0, 0, 2],
    head: [-4, -8, -4],
    arm_upper_r: [-10, 0, -140],
    arm_lower_r: [0, 0, -60],
  }),
};

/* =========================================================================================
 * Variants
 * ========================================================================================= */

const SPECS: Spec[] = [
  {
    key: "cap_red",
    notes: "Red cap, black tee with crimson shoulders + sleeve bands, worn-white towel scarf, dark grey pants, white sneakers.",
    skin: P.skinBrown,
    hair: P.hairBlack,
    hairStyle: "short",
    top: { kind: "tee", body: P.black, sleeve: P.black, sleeveBand: P.crimson, shoulder: P.crimson },
    bottom: { kind: "pants", color: "#4E4843" },
    feet: { kind: "sneaker", upper: P.white, sole: "#8F877A", accent: P.crimson },
    cap: { crown: P.crimson, front: P.worn, brim: P.crimsonDark },
    scarf: P.worn,
  },
  {
    key: "hoodie_white",
    notes: "Worn-white hoodie with crimson hood (down) and sleeves, kangaroo pocket, dark denim, dark sneakers.",
    skin: P.skinDeep,
    hair: P.hairBlack,
    hairStyle: "puff",
    top: {
      kind: "hoodie",
      body: P.worn,
      sleeve: P.crimson,
      cuff: P.worn,
      hem: P.wornDark,
      hood: "down",
      hoodColor: P.crimson,
      pocket: true,
      strings: P.white,
    },
    bottom: { kind: "pants", color: P.denim },
    feet: { kind: "sneaker", upper: P.charcoal, sole: P.white },
  },
  {
    key: "hoodie_black",
    notes: "Black hoodie with the hood up, crimson trim (hood rim, cuffs, hem) and the small red symbol on the back; warm grey pants.",
    skin: mix(P.skinLight, P.skinMedium, 0.5),
    hair: P.hairBlack,
    hairStyle: "fringe",
    top: {
      kind: "hoodie",
      body: P.black,
      sleeve: P.black,
      cuff: P.crimson,
      hem: P.crimson,
      hood: "up",
      hoodColor: P.black,
      hoodLining: P.crimsonDark,
      emblemBack: P.crimson,
    },
    bottom: { kind: "pants", color: "#4D4742" },
    feet: { kind: "sneaker", upper: "#33302E", sole: P.white },
  },
  {
    key: "torn_jersey",
    notes: "Tenure 01 'Rach ruoi': faded crimson jersey with ragged hem/sleeves, rips and a sewn patch, worn-white chevrons; torn shorts, white socks, sandals.",
    skin: P.skinLight,
    hair: "#2E211A",
    hairStyle: "messy",
    top: {
      kind: "tee",
      body: mix(P.crimson, P.crimsonFaded, 0.35),
      sleeve: mix(P.crimson, P.crimsonFaded, 0.35),
      stripes: P.worn,
      torn: true,
      patch: P.wornDark,
      rips: [
        { at: [-0.1, 0.01], r: 0.038 },
        { at: [0.12, 0.14], r: 0.028 },
        { at: [-0.08, 0.19], r: 0.034, back: true },
      ],
    },
    bottom: { kind: "shorts", color: "#2F2723", torn: true },
    feet: { kind: "sandal", upper: P.black, sole: "#26211E", sock: P.white },
  },
  {
    key: "headband",
    notes: "Tenure 02 style: white spiky hair, crimson headband with trailing tails, torn black hoodie (hood down), dark brown pants.",
    skin: P.skinMedium,
    hair: "#CFCAC2",
    hairStyle: "spiky",
    top: {
      kind: "hoodie",
      body: P.black,
      sleeve: P.black,
      hood: "down",
      hoodColor: shade(P.charcoal, 0.9),
      strings: P.crimson,
      rips: [{ at: [0.13, 0.18], r: 0.034 }],
    },
    bottom: { kind: "pants", color: "#433B36", kneeRip: -1 },
    feet: { kind: "sneaker", upper: "#2A2624", sole: "#7A7268" },
    headband: P.crimson,
  },
  {
    key: "glasses",
    notes: "Tenure 04 style: black hair, black square glasses, crimson/black jersey (black sleeves + side panels, worn-white V collar), dark denim.",
    skin: P.skinTan,
    hair: P.hairBlack,
    hairStyle: "neat",
    eyes: "open",
    top: {
      kind: "tee",
      body: P.crimson,
      sleeve: P.black,
      sleeveBand: P.crimson,
      sidePanel: P.black,
      collar: P.worn,
    },
    bottom: { kind: "pants", color: "#353A44" },
    feet: { kind: "sneaker", upper: "#3A3634", sole: P.worn },
    glasses: "#161312",
  },
  {
    key: "oxygen",
    notes:
      "Tenure 03 'Tho oxy': buzz cut, crimson jersey with a worn-white belly band, black sleeves and V collar, nasal cannula looped over the ears; dark pants with a torn knee. Pairs with tl_prop_wooden_chair_v01 + oxygen cylinder/hose (pose sit_chair).",
    skin: mix(P.skinTan, P.skinBrown, 0.45),
    hair: P.hairBlack,
    hairStyle: "buzz",
    top: { kind: "tee", body: P.crimson, sleeve: P.black, sleeveBand: P.crimsonDark, collar: P.black, band: P.worn },
    bottom: { kind: "pants", color: "#3B3431", kneeRip: 1 },
    feet: { kind: "sneaker", upper: "#2E2A28", sole: P.worn },
    cannula: "#D3D8D5",
  },
];

/* =========================================================================================
 * Assembly
 * ========================================================================================= */

const DEBUG = new Set((process.env.TL_CHAR_DEBUG ?? "").split(",").map((s) => s.trim()));

function debugStool(m: Model) {
  // 0.45 m stool proxy centred under the root (only with TL_CHAR_DEBUG=stool)
  const b = m.geo;
  b.box({ size: [0.4, 0.05, 0.4], at: [0, 0.425, 0], color: P.woodLight });
  for (const x of [-0.16, 0.16]) for (const z of [-0.16, 0.16]) b.box({ size: [0.05, 0.4, 0.05], at: [x, 0.2, z], color: P.woodDark });
}
/** Debug proxies of other groups' seats, built from their manifest anchors (TL_CHAR_DEBUG=chair|wheelchair|bed). */
function debugSeat(m: Model, kind: string) {
  const b = m.geo;
  const mark = (at: Vec3) => b.box({ size: 0.03, at, color: "#3CC060" });
  if (kind === "chair") {
    // tl_prop_wooden_chair_v01: seat 0.471 @ z 0.02, back through (0, 0.75, -0.24) leaning back 9 deg, arms 0.69
    b.box({ size: [0.46, 0.04, 0.44], at: [0, 0.451, 0.0], color: P.woodLight });
    b.box({ size: [0.46, 0.5, 0.04], at: [0, 0.75, -0.24], rot: [-9, 0, 0], color: P.wood });
    for (const x of [-0.235, 0.235]) b.box({ size: [0.06, 0.04, 0.42], at: [x, 0.67, 0.0], color: P.wood });
    mark([-0.08, 1.17, -0.01]); // oxygen hose face_end (cylinder placed at chair - (0.5, 0, 0.05))
  } else if (kind === "wheelchair") {
    // tl_veh_wheelchair_v01: seat 0.54 @ z 0.02, backrest (0, 0.72, -0.16), footrest (0, 0.17, 0.42)
    b.box({ size: [0.44, 0.04, 0.42], at: [0, 0.52, 0.02], color: P.crimsonDark });
    b.box({ size: [0.44, 0.42, 0.04], at: [0, 0.76, -0.18], color: P.crimsonDark });
    b.box({ size: [0.38, 0.025, 0.14], at: [0, 0.1575, 0.42], color: P.metalDark });
    for (const x of [-0.31, 0.31]) b.ring({ radius: 0.3, inner: 0.26, depth: 0.03, at: [x, 0.3, -0.02], rot: [0, 90, 0], color: P.metal });
  } else if (kind === "bed") {
    // tl_veh_metal_bed_v01: mattress top 0.41, pillow at -Z (lie_head 0.53 @ z -0.72)
    b.box({ size: [0.86, 0.14, 1.9], at: [0, 0.34, 0], color: P.worn });
    b.box({ size: [0.56, 0.12, 0.32], at: [0, 0.47, -0.78], color: P.white });
    mark([0, 0.53, -0.72]);
    mark([0, 0.44, -0.05]);
  }
}

function buildFan(s: Spec): Model {
  const name = `tl_char_fan_${s.key}_v01`;
  const m = new Model(name, { budget: 2500 });
  const r = makeRig(m);
  buildPelvis(r, s);
  buildTorso(r, s);
  buildNeckHead(r, s);
  for (const sd of [1, -1] as Side[]) {
    buildArm(r, s, sd);
    buildLeg(r, s, sd);
  }
  if (DEBUG.has("stool")) debugStool(m);
  for (const k of ["chair", "wheelchair", "bed"]) if (DEBUG.has(k)) debugSeat(m, k);

  for (const [k, v] of Object.entries(POSES)) m.pose(k, v);
  m.collider = { type: "capsule", center: [0, 0.875, 0], radius: 0.3, height: 1.75 };
  const hand = (sd: Side) => m.worldPoint(`arm_lower_${LR(sd)}`, rotatePoint([0, HAND_Y, 0.004], [0, 0, sd * RIG.armTilt]));
  m.anchor("hand_l", hand(1));
  m.anchor("hand_r", hand(-1));
  m.anchor("eyes", m.worldPoint("head", [0, H.eyeY, H.zf]));
  const top = r4(m.stats().bounds.max[1]);
  m.anchor("head_top", [0, top, 0]);
  m.anchor("name_tag", [0, r4(top + 0.22), 0]);
  m.anchor("seat_contact", [0, 0.45, SIT.hipsZ]);
  if (s.top.emblemBack) m.anchor("back_emblem", m.worldPoint("spine", [0, 0.155, TORSO.back(HOODIE_BULK) - 0.003]));

  const joints: Record<string, Vec3> = {};
  m.root.walk((n) => {
    if (n !== m.root) joints[n.name] = m.worldPoint(n.name).map(r4) as Vec3;
  });
  const j = (n: string) => joints[n];
  m.meta = {
    kind: "avatar",
    variant: s.key,
    rig: {
      version: 1,
      facing: "+Z",
      left: "+X",
      units: "m",
      nominalHeight: 1.75,
      skullTop: r4(m.worldPoint("head", [0, H.top, 0])[1]),
      boundsHeight: top,
      restRotations: "all zero (rest pose = standing, arms down; the 4 deg arm splay is baked into the mesh)",
      eulerOrder: "PlayCanvas setLocalEulerAngles (R = Rz*Ry*Rx)",
      jointWorldRest: joints,
      lengths: { upperArm: RIG.upperArm, forearm: RIG.forearm, hand: 0.115, thigh: RIG.thigh, shinToSole: RIG.shin },
      armTiltBakedDeg: RIG.armTilt,
      conventions:
        "limbs hang along -Y; X<0 swings an arm/thigh forward, X>0 back; leg_lower X>0 bends the knee (foot back); " +
        "arm_lower X<0 bends the elbow (hand forward/up); arm_upper_r Z<0 / arm_upper_l Z>0 raise the arm sideways; spine/head X>0 lean/nod forward",
    },
    sit: {
      seatHeight: 0.45,
      rootAt: "floor under the seat centre, facing away from the backrest",
      hipsAt: [0, SIT.hipsY, SIT.hipsZ],
      otherSeatHeights: "raise/lower the root by (seatY - 0.45); for seats lower than ~0.4 bend the knees more",
    },
  };
  m.notes =
    `Fan avatar (${s.key}). ${s.notes} ` +
    `Rig (world rest pivots): hips ${j("hips")[1]}; spine ${j("spine")[1]}; neck ${j("neck")[1]}; head ${j("head")[1]}; ` +
    `arm_upper_l (${j("arm_upper_l")[0]}, ${j("arm_upper_l")[1]}) > arm_lower_l elbow (${j("arm_lower_l")[0]}, ${j("arm_lower_l")[1]}), hand incl.; arm_*_r mirrored (-X); ` +
    `leg_upper_l (${j("leg_upper_l")[0]}, ${j("leg_upper_l")[1]}) > leg_lower_l knee y ${j("leg_lower_l")[1]}, shoe incl.; leg_*_r mirrored. ` +
    "All rest rotations 0; limbs hang along -Y. " +
    `Verified poses: sit on a 0.45 m seat = root on the floor under the seat centre, hips at [0, ${SIT.hipsY}, ${SIT.hipsZ}], leg_upper X ${SIT.thigh}, leg_lower X ${SIT.shin} (soles on the floor), spine 8; ` +
    "head_in_hands = sit legs + spine 56, neck 6, head 15, arm_upper_l [-48,-20,-44], arm_lower_l [-87,-39,-19] (r mirrored: Y,Z negated); " +
    "slump = spine 14, head 20, knees soft (hips at [0,0.939,-0.028]); wave = arm_upper_r [-10,0,-140], arm_lower_r Z swinging -25..-60; walk_a/b = thighs -22/+14, knees 5/22, arms +-18..20, hips y 0.936. " +
    "Poses list every joint (absolute local euler; hips also has `at`).";
  return m;
}

export default function build(): Model[] {
  return SPECS.map(buildFan);
}
