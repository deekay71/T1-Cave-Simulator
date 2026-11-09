/**
 * Group "fire" — fire and light sources for concept v3 "Hang trú thua".
 *
 *   tl_fx_campfire_v01      stone ring (2.2 m), crossed charred logs, ember bed, layered flames
 *   tl_fx_torch_pole_v01    2.3 m wooden pole in a stone base, wrapped head + cup, flames
 *   tl_fx_torch_tripod_v01  three lashed 2.1 m sticks holding an iron fire bowl (rim 2.04 m), flames
 *   tl_fx_lantern_v01       0.35 m metal camp lantern with an emissive glass core
 *   tl_fx_embers_ring_v01   glowing specks scattered around a fire base (optional overlay)
 *
 * Every fire source has a child node "flames" (emissive, pivot at the flame base, so scaling
 * it in Y flickers from the base) and an empty node "light_anchor" where the runtime should
 * put its omni light. Flames are faceted unlit tongues: per-face colour steps (vary) and a
 * shared bottom-to-tip gradient (pale core -> amber -> orange tips, sampled from the concept)
 * make the facets read even though glow is unlit. Glow colours are pre-compensated for the
 * ACES tonemap the game/gallery uses (see glowHex).
 */
import {
  MeshBuilder,
  Model,
  PALETTE as P,
  Rng,
  linearToSrgb,
  mix,
  rgbToHex,
  shade,
  srgbToLinear,
  type Color,
  type PrimOpts,
  type Vec2,
  type Vec3,
} from "../lib.js";

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ palette */

/** Emissive strengths: headroom so compensated colours can reach the concept's near-full red. */
const GLOW_FLAME = 1.5;
const GLOW_EMBER = 1.3;

/**
 * Glow parts are unlit, so what you see is ACES(linear(colour) * strength). ACES (the game /
 * gallery tonemap) pushes bright oranges toward yellow, so glow colours here are written as
 * the DISPLAYED colour we want and converted to the authored value by inverting PlayCanvas'
 * TONEMAP_ACES curve (Narkowicz fit) + sRGB. E.g. orange #EC8A2A on screen = #FF6A2E authored.
 */
function aces(x: number): number {
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}
function glowHex(display: Color, strength: number): Color {
  const h = display.replace("#", "");
  const out = [0, 2, 4].map((i) => {
    const target = srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255);
    let lo = 0;
    let hi = 64;
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2;
      if (aces(m) < target) lo = m;
      else hi = m;
    }
    return linearToSrgb(Math.min(1, lo / strength));
  });
  return rgbToHex(out as Vec3);
}
/** Colour by height above the flame base (m). */
type HeightPaint = (y: number) => Color;
/** Piecewise-linear height gradient; stops are DISPLAYED colours, converted with glowHex. */
function vramp(stops: [number, Color][], strength: number, scaleY = 1): HeightPaint {
  const pts = stops.map(([y, c]) => [y * scaleY, glowHex(c, strength)] as [number, Color]);
  return (y) => {
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++)
      if (y <= pts[i][0]) return mix(pts[i - 1][1], pts[i][1], (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
    return pts[pts.length - 1][1];
  };
}
/**
 * Flame layers as displayed under ACES, sampled from the v3 concept flames (board 01 measures
 * ~#C97A2D on average): a pale core only at the very bottom, an orange body and red-orange tips.
 * Heights are for a reference flame FLAME_REF_H tall; flameLayers(k) scales them (the campfire
 * uses ~0.7, torches ~0.55). All layers share one vertical gradient (pale -> orange -> red-orange,
 * as in the concept) and differ in hue so the layering still reads.
 */
const FLAME_REF_H = 1.35;
const FLAME_STOPS: Record<"outer" | "mid" | "core", [number, Color][]> = {
  outer: [
    [0.1, "#F59A1C"],
    [0.4, "#F08A16"],
    [0.75, "#E8721A"],
    [1.05, "#DC5E14"],
    [1.35, "#C84A10"],
  ],
  mid: [
    [0, "#FCC23A"],
    [0.4, "#F8AA22"],
    [0.75, "#F49A1C"],
    [0.95, "#F28A18"],
  ],
  core: [
    [0, "#FCEFB4"],
    [0.2, "#FCDF7C"],
    [0.35, "#FAC448"],
  ],
};
function flameLayers(scaleY = 1): Record<"outer" | "mid" | "core", HeightPaint> {
  return {
    outer: vramp(FLAME_STOPS.outer, GLOW_FLAME, scaleY),
    mid: vramp(FLAME_STOPS.mid, GLOW_FLAME, scaleY),
    core: vramp(FLAME_STOPS.core, GLOW_FLAME, scaleY),
  };
}
/** Campfire flame height (m above its ember bed): board 01's fire tops out at a seated fan's chest. */
const CAMPFIRE_FLAME_H = 0.98;
const FLAME = flameLayers(CAMPFIRE_FLAME_H / FLAME_REF_H);
const SPARK = glowHex("#F0781A", GLOW_FLAME);
/** Coal / ember glows (concept coals ~#F0640C). */
const EMBER = {
  hot: glowHex("#F0660E", GLOW_EMBER),
  base: glowHex("#E25210", GLOW_EMBER),
  deep: glowHex("#BC3C10", GLOW_EMBER),
};
/** Lantern glass (amber) and the flame seen through it (concept ~#F8B62A / #F8E799). */
const LANTERN = { glass: glowHex("#F4A42A", GLOW_FLAME), flame: glowHex("#FAEAA0", GLOW_FLAME) };
/** Pale warm-grey campfire / base stones (board 01: the ring stones catch the fire light). */
const STONE = { top: "#8E8276", side: "#6A5F56", dark: "#4E453F", warmTop: "#968371", warmSide: "#6E5E52" };
const ASH = { top: "#403935", side: "#342D29" };
const CHAR = { bark: "#33271F", end: "#6A5442", coal: P.shadow };
const ROPE = { light: "#A2825A", dark: "#7E6244" };
/** Hewn / branch wood (darker than PALETTE.wood: the warm cave light lifts it a lot). */
const WOOD = { pole: "#634230", poleEnd: "#4A3224", stick: "#5C3E2B", stickLight: "#6E4B33", cup: "#4A3124" };
/** Dark bronze-iron for the lantern and fire bowl. */
const IRON = { base: "#4A3F38", light: "#5F524A", dark: "#2F2925" };

/* ------------------------------------------------------------------ small helpers */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scl(sub(b, a), t));
const polar = (r: number, deg: number, y = 0): Vec3 => [Math.cos(deg * DEG) * r, y, Math.sin(deg * DEG) * r];

function newell(pts: Vec3[]): Vec3 {
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}
function centroid(pts: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  return c;
}
/** Emit a (near-)planar convex face, wound so its normal points away from `inside`. */
function face(b: MeshBuilder, pts: Vec3[], inside: Vec3, o: PrimOpts): void {
  const n = newell(pts);
  const d = sub(centroid(pts), inside);
  const p = n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0 ? pts.slice().reverse() : pts;
  if (p.length === 3) b.tri(p[0], p[1], p[2], o);
  else if (p.length === 4) b.quad(p[0], p[1], p[2], p[3], o);
  else b.poly(p, o);
}

/* ------------------------------------------------------------------ flame tongue */

interface TongueOpts {
  /** Base centre (builder space). */
  at: Vec3;
  height: number;
  /** Widest radius. */
  radius: number;
  sides?: number;
  /** Tip offset [dx, dz] (m); the axis bends quadratically toward it. */
  lean?: Vec2;
  /** Ring rotation from base to tip (deg). */
  twist?: number;
  /** Rings [heightFraction, radiusFraction] from the base up; the apex is added at 1. */
  profile?: Vec2[];
  /** Face colour from the face's height in builder space (flame base = 0). */
  paint: HeightPaint;
  glow?: number;
  vary?: number;
  /** Radial irregularity (fraction). */
  jitter?: number;
  /** Close the base ring (only needed when the base can be seen). */
  cap?: boolean;
}
const PROFILE_TONGUE: Vec2[] = [
  [0, 0.42],
  [0.2, 1],
  [0.47, 0.78],
  [0.74, 0.4],
];

/**
 * A faceted flame tongue: n-sided rings lofted along a curved axis to an apex (unlit glow).
 * Each face takes paint(height) plus a small random step (vary), so the facets read.
 * 7n triangles for the default 4 rings (no base cap).
 */
function tongue(b: MeshBuilder, rng: Rng, o: TongueOpts): void {
  const n = o.sides ?? 5;
  const prof = o.profile ?? PROFILE_TONGUE;
  const [lx, lz] = o.lean ?? [0, 0];
  const phase = rng.range(0, 360) * DEG;
  const twist = (o.twist ?? 30) * DEG;
  const jit = o.jitter ?? 0.18;
  const axis = (f: number): Vec3 => [o.at[0] + lx * f * f, o.at[1] + o.height * f, o.at[2] + lz * f * f];
  const rings: Vec3[][] = prof.map(([f, rf], i) => {
    const c = axis(f);
    return Array.from({ length: n }, (_, k) => {
      const a = phase + twist * f + (k * 2 * Math.PI) / n + rng.jitter(0.22);
      const r = o.radius * rf * (1 + rng.jitter(jit));
      const dy = i === 0 ? 0 : rng.jitter(o.height * 0.03);
      return [c[0] + Math.cos(a) * r, c[1] + dy, c[2] + Math.sin(a) * r] as Vec3;
    });
  });
  const tip = axis(1);
  const apex: Vec3 = [tip[0] + rng.jitter(o.radius * 0.12), tip[1], tip[2] + rng.jitter(o.radius * 0.12)];
  const style: PrimOpts = { mat: "glow", glow: o.glow ?? GLOW_FLAME, vary: o.vary ?? 0.05 };
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    const f = (prof[i][0] + prof[i + 1][0]) / 2;
    const inside = axis(f);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      face(b, [A[k], A[k1], B[k1], B[k]], inside, { ...style, color: o.paint(inside[1]) });
    }
  }
  const last = rings[rings.length - 1];
  const fl = prof[prof.length - 1][0];
  const inside = lerp3(axis(fl), apex, 0.25);
  for (let k = 0; k < n; k++)
    face(b, [last[k], last[(k + 1) % n], apex], inside, { ...style, color: o.paint(axis((fl + 1) / 2)[1]) });
  if (o.cap) face(b, rings[0], axis(prof[1]?.[0] ?? 0.2), { ...style, color: o.paint(o.at[1]) });
}

/** A tiny glowing speck (irregular octahedron, 8 tris). */
function speck(b: MeshBuilder, at: Vec3, size: number, color: Color, glow = GLOW_FLAME): void {
  b.rock({ size: [size, size * 1.3, size], points: 6, jitter: 0.2, at, color, mat: "glow", glow, vary: 0.05 });
}

/* ------------------------------------------------------------------ stones, logs, coals */

/**
 * Chunky campfire stone: flat-ish base, full-width shoulder ring, smaller sloped top.
 * Local +z points away from the fire (yaw it so). size = [tangential w, height, radial d].
 */
function stone(
  b: MeshBuilder,
  rng: Rng,
  o: { at: Vec3; yaw: number; size: Vec3; colors?: { top: Color; side: Color } },
): void {
  const [w, h, d] = o.size;
  const j = (a: number) => rng.jitter(a);
  const pts: Vec3[] = [];
  const bw = w * 0.98,
    bd = d * 0.96;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    pts.push([(sx * bw) / 2 + j(w * 0.04), 0, (sz * bd) / 2 + j(d * 0.04)]);
  const sh = h * rng.range(0.66, 0.8);
  const sk = rng.range(0.86, 0.94); // shoulder inset: sides slope in (trapezoid block)
  for (const [sx, sz] of [
    [-1, -0.4],
    [-0.55, -1],
    [0.5, -1],
    [1, -0.35],
    [1, 0.45],
    [0.45, 1],
    [-0.5, 1],
    [-1, 0.4],
  ])
    pts.push([(sx * w * sk) / 2 + j(w * 0.04), sh + j(h * 0.08), (sz * d * sk) / 2 + j(d * 0.04)]);
  const tw = w * rng.range(0.68, 0.8),
    td = d * rng.range(0.6, 0.74);
  const slope = j(h * 0.1); // tilt of the top plane toward/away from the fire
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    pts.push([(sx * tw) / 2 + j(w * 0.05), h - j(h * 0.06) - (sz > 0 ? slope : 0), (sz * td) / 2 + j(d * 0.05)]);
  // Per-stone tint: some cooler, some warmer / lighter, like hand-picked field stones.
  const tint = rng.range(0.88, 1.12);
  const warm = rng.range(0, 0.45);
  const c = o.colors ?? {
    top: shade(mix(STONE.top, STONE.warmTop, warm), tint),
    side: shade(mix(STONE.side, STONE.warmSide, warm), tint),
  };
  b.hull(pts, { at: o.at, rot: [0, o.yaw, 0], parts: { top: c.top, side: c.side, bottom: STONE.dark }, vary: 0.06 });
}

/** Charred log: bark tube plus a glowing burnt end toward `to` (fraction `burn` of its length). */
function log(b: MeshBuilder, from: Vec3, to: Vec3, radius: number, burn: number, sides = 6): void {
  const mid = lerp3(from, to, 1 - burn);
  b.tube([from, mid], {
    radius: [radius, radius * 0.95],
    sides,
    parts: { side: CHAR.bark, cap: CHAR.end },
    vary: 0.1,
  });
  b.tube([mid, to], {
    radius: [radius * 0.95, radius * 0.75],
    sides,
    color: (f) => (f.part === "cap" ? EMBER.hot : EMBER.deep),
    mat: "glow",
    glow: GLOW_EMBER,
    vary: 0.12,
  });
}

/** Glowing coal chunk (sunk a little into whatever it sits on). */
function coal(b: MeshBuilder, rng: Rng, at: Vec3, size: number, glow = true): void {
  const s: Vec3 = [size * rng.range(0.8, 1.2), size * rng.range(0.5, 0.75), size * rng.range(0.8, 1.2)];
  const color = glow ? rng.pick([EMBER.hot, EMBER.hot, EMBER.base, EMBER.base, EMBER.deep]) : CHAR.coal;
  b.rock({
    size: s,
    points: 7,
    jitter: 0.3,
    flat: 0.3,
    align: "bottom",
    at,
    rot: [0, rng.range(0, 360), 0],
    color,
    vary: 0.1,
    ...(glow ? { mat: "glow" as const, glow: GLOW_EMBER } : {}),
  });
}

/* ------------------------------------------------------------------ campfire */

function campfire(): Model {
  const m = new Model("tl_fx_campfire_v01", {
    budget: 1500,
    notes:
      "Central campfire, 2.2 m stone ring, ~1 m broken-up flames. Child 'flames' (flame_outer/flame_mid/flame_core, emissive) " +
      "pivots at the ember bed: scale Y 0.9-1.1 out of phase to flicker. 'sparks' can drift/rotate. " +
      "'light_anchor' (1.2 m) = omni light position. Collider = stone ring.",
  });
  const rng = m.rng.fork("layout");
  const g = m.geo;

  // Ash bed (low faceted mound inside the ring).
  g.cylinder({
    height: 0.05,
    radiusBottom: 0.8,
    radiusTop: 0.62,
    sides: 11,
    caps: "top",
    at: [0, 0.025, 0],
    phase: 8,
    parts: { top: ASH.top, side: ASH.side },
    vary: 0.06,
  });

  // Ring of 10 chunky grey stones.
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 360 + 9 + rng.jitter(5);
    const R = 0.9 + rng.jitter(0.035);
    const size: Vec3 = [0.48 + rng.jitter(0.05), 0.27 + rng.jitter(0.04), 0.38 + rng.jitter(0.04)];
    stone(g, rng, { at: polar(R, a), yaw: 90 - a + rng.jitter(9), size });
  }

  // Four crossed charred logs (two lying in an X, two leaning in), burnt ends glowing.
  const r = 0.078;
  const y0 = 0.05 + r * 0.8;
  log(g, [-0.7, y0, -0.24], [0.2, y0 + 0.03, 0.08], r, 0.42);
  log(g, [0.66, y0, -0.3], [-0.16, y0 + 0.05, 0.12], r * 0.95, 0.42);
  log(g, polar(0.7, 60, y0), polar(0.03, 240, y0 + 0.24), r * 0.92, 0.45);
  log(g, polar(0.68, 250, y0), polar(0.03, 70, y0 + 0.2), r * 0.85, 0.45);

  // Ember bed: glowing coals plus a few dead charcoal bits.
  const coalRng = rng.fork("coals");
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * 360 + coalRng.jitter(12);
    const rr = i % 2 ? coalRng.range(0.2, 0.34) : coalRng.range(0.36, 0.54);
    coal(g, coalRng, polar(rr, a, 0.04), i % 2 ? coalRng.range(0.15, 0.22) : coalRng.range(0.1, 0.15), true);
  }
  for (let i = 0; i < 4; i++) {
    const a = coalRng.range(0, 360);
    coal(g, coalRng, polar(coalRng.range(0.42, 0.6), a, 0.045), coalRng.range(0.07, 0.11), false);
  }

  // Flames (board 01): a low, broken-up fire about 1 m tall, not one solid blob. Three layered
  // nodes under "flames" so the runtime can flicker them out of phase: a ring of narrow orange
  // tongues of uneven height leaning outward (dark gaps between them), amber tongues low in the
  // gaps, and a small pale core only at the base of the ember bed.
  const flames = m.node("flames", { at: [0, 0.06, 0] });
  const outer = flames.child("flame_outer");
  const mid = flames.child("flame_mid");
  const core = flames.child("flame_core");
  const fr = rng.fork("flames");
  const layers = FLAME;
  const H = CAMPFIRE_FLAME_H;
  const PROFILE_OUTER: Vec2[] = [
    [0, 0.36],
    [0.26, 1],
    [0.5, 0.86],
    [0.78, 0.42],
  ];
  // Centre: two tall tongues leaning slightly apart (the fire's tips).
  for (const [a, h, r, lean] of [
    [30, 1, 0.19, 0.07],
    [215, 0.86, 0.17, 0.09],
  ]) {
    const l = polar(lean, a);
    tongue(outer.geo, fr, {
      at: polar(0.07, a, 0.1),
      height: H * h,
      radius: r,
      paint: layers.outer,
      lean: [l[0], l[2]],
      profile: PROFILE_OUTER,
    });
  }
  // Ring: seven narrow tongues of uneven height, leaning out over the logs.
  const ring = [
    { a: 0, h: 0.66, r: 0.15 },
    { a: 52, h: 0.48, r: 0.13 },
    { a: 100, h: 0.74, r: 0.16 },
    { a: 150, h: 0.54, r: 0.14 },
    { a: 196, h: 0.62, r: 0.15 },
    { a: 250, h: 0.44, r: 0.13 },
    { a: 305, h: 0.7, r: 0.15 },
  ];
  for (const t of ring) {
    const a = t.a + fr.jitter(9);
    const lean = polar(0.12 + fr.jitter(0.04), a + fr.jitter(12));
    tongue(outer.geo, fr, {
      at: polar(0.27 + fr.jitter(0.03), a, 0.11),
      height: H * t.h,
      radius: t.r,
      sides: 4,
      paint: layers.outer,
      lean: [lean[0], lean[2]],
      twist: 45,
      profile: PROFILE_OUTER,
    });
  }
  // Mid (amber): four low tongues in the gaps.
  for (const [a, h] of [
    [75, 0.44],
    [170, 0.4],
    [275, 0.46],
    [345, 0.36],
  ]) {
    const lean = polar(0.07, a + fr.jitter(15));
    tongue(mid.geo, fr, {
      at: polar(0.17, a + fr.jitter(8), 0.04),
      height: H * h,
      radius: 0.17,
      paint: layers.mid,
      lean: [lean[0], lean[2]],
      profile: [
        [0, 0.62],
        [0.22, 1],
        [0.5, 0.78],
        [0.76, 0.38],
      ],
    });
  }
  // Core (pale): low and wide on the ember bed, never above ~0.35 m.
  const PROFILE_CORE: Vec2[] = [
    [0, 0.9],
    [0.3, 1],
    [0.6, 0.62],
    [0.82, 0.28],
  ];
  tongue(core.geo, fr, {
    at: [0.02, 0, 0.02],
    height: 0.34,
    radius: 0.3,
    paint: layers.core,
    profile: PROFILE_CORE,
    sides: 6,
  });
  tongue(core.geo, fr, {
    at: [-0.16, 0, -0.1],
    height: 0.24,
    radius: 0.18,
    paint: layers.core,
    profile: PROFILE_CORE,
    lean: [-0.04, -0.03],
  });

  // Sparks drifting above (separate node: drift up + fade/respawn, or slow Y rotation).
  const sparks = m.node("sparks");
  const sr = rng.fork("sparks");
  // Two detached flame chips just above the tips (as in the concept) + small sparks.
  for (const [rad, a, y, s] of [
    [0.12, 40, 1.14, 0.075],
    [0.3, 200, 0.98, 0.06],
    [0.22, 270, 1.42, 0.04],
    [0.05, 330, 1.6, 0.03],
    [0.28, 110, 1.3, 0.035],
  ])
    speck(sparks.geo, polar(rad + sr.jitter(0.03), a, y), s, s > 0.05 ? FLAME.outer(0.95) : SPARK);

  const lightAt: Vec3 = [0, 1.2, 0];
  m.node("light_anchor", { at: lightAt });
  m.anchor("light", lightAt);
  m.anchor("flame_base", [0, 0.06, 0]);
  m.light({ name: "campfire", at: lightAt, color: "#FF9A4C", intensity: 2.2, range: 9 });
  m.collider = { type: "cylinder", center: [0, 0.25, 0], radius: 1.1, height: 0.5 };
  m.meta = {
    flicker: {
      nodes: ["flame_outer", "flame_mid", "flame_core"],
      scaleY: [0.9, 1.1],
      scaleXZ: [0.95, 1.05],
      hz: [5, 9],
      emissiveIntensity: [1.3, 1.7],
    },
    embers: { emissiveIntensity: [1.1, 1.45], hz: [1, 3] },
    light: { color: "#FF9A4C", intensity: [1.9, 2.5], range: 9 },
    sparks: { node: "sparks", riseSpeed: 0.35, loopHeight: 0.8 },
  };
  return m;
}

/* ------------------------------------------------------------------ torch flame (shared) */

/** Flames for torches/bowls, built in a node whose origin is the flame base. */
function torchFlames(b: MeshBuilder, rng: Rng, k: number): void {
  const layers = flameLayers((0.64 * k) / FLAME_REF_H);
  // k scales the whole flame (torch pole 1.15, fire bowl 1.25); at k 1 it is ~0.45 m wide, ~0.64 m tall.
  const outer: Vec2[] = [
    [0, 0.4],
    [0.22, 1],
    [0.5, 0.78],
    [0.76, 0.4],
  ];
  tongue(b, rng, {
    at: [0, 0.02, 0],
    height: 0.62 * k,
    radius: 0.15 * k,
    paint: layers.outer,
    lean: [0.03 * k, -0.02 * k],
    profile: outer,
  });
  for (const [a, h, r, l] of [
    [20, 0.42, 0.11, 0.1],
    [140, 0.48, 0.115, 0.09],
    [255, 0.36, 0.1, 0.11],
  ]) {
    const base = polar(0.06 * k, a, 0.03);
    const lean = polar(l * k, a + rng.jitter(15));
    tongue(b, rng, {
      at: base,
      height: h * k,
      radius: r * k,
      sides: 4,
      paint: layers.outer,
      lean: [lean[0], lean[2]],
      profile: outer,
    });
  }
  for (const [a, h] of [
    [80, 0.4],
    [200, 0.34],
    [320, 0.3],
  ]) {
    const base = polar(0.035 * k, a, 0.01);
    const lean = polar(0.05 * k, a);
    tongue(b, rng, {
      at: base,
      height: h * k,
      radius: 0.1 * k,
      sides: 4,
      paint: layers.mid,
      lean: [lean[0], lean[2]],
      profile: [
        [0, 0.65],
        [0.22, 1],
        [0.5, 0.72],
        [0.76, 0.34],
      ],
    });
  }
  tongue(b, rng, {
    at: [0, -0.01, 0],
    height: 0.26 * k,
    radius: 0.11 * k,
    paint: layers.core,
    sides: 5,
    profile: [
      [0, 0.85],
      [0.25, 1],
      [0.55, 0.6],
      [0.8, 0.26],
    ],
  });
  speck(b, [0.05 * k, 0.8 * k, -0.02], 0.035 * k, SPARK);
}

/* ------------------------------------------------------------------ torch on a pole */

function torchPole(): Model {
  const m = new Model("tl_fx_torch_pole_v01", {
    budget: 500,
    notes:
      "Standing torch: 2.3 m hewn pole wedged in a stone base, rope-wrapped head and wooden cup. " +
      "Child 'flames' (emissive) pivots at the cup rim; 'light_anchor' at the flame centre.",
  });
  const rng = m.rng.fork("layout");
  const g = m.geo;

  // Stone base: a low flat slab with three chunky stones packed around the pole.
  const slabH = 0.13;
  stone(g, rng, { at: [0, 0, 0], yaw: 18, size: [0.64, slabH, 0.54] });
  for (const [a, w, h, d] of [
    [35, 0.22, 0.2, 0.17],
    [155, 0.2, 0.17, 0.19],
    [265, 0.18, 0.15, 0.16],
  ])
    stone(g, rng, { at: polar(0.135, a, slabH - 0.02), yaw: 90 - a + rng.jitter(10), size: [w, h, d] });

  // Pole (square, hewn), slight lean.
  const top: Vec3 = [0.025, 2.1, -0.02];
  g.tube([[0, 0.05, 0], top], {
    radius: [0.068, 0.056],
    sides: 4,
    phase: 45 + 12,
    parts: { side: WOOD.pole, cap: WOOD.poleEnd },
    vary: 0.08,
  });

  // Rope / cloth wrap just under the cup.
  const at = (y: number): Vec3 => lerp3([0, 0.05, 0], top, (y - 0.05) / (top[1] - 0.05));
  g.cylinder({ height: 0.06, radius: 0.072, sides: 6, at: at(1.88), rot: [4, 20, -3], color: ROPE.dark, vary: 0.08 });
  g.cylinder({ height: 0.08, radius: 0.077, sides: 6, at: at(1.97), rot: [-3, 50, 4], color: ROPE.light, vary: 0.08 });
  g.cylinder({ height: 0.05, radius: 0.072, sides: 6, at: at(2.05), rot: [2, 5, -2], color: ROPE.dark, vary: 0.08 });

  // Flared wooden cup with a glowing coal top.
  const cupBase = add(top, [0, -0.01, 0]);
  const cupH = 0.2;
  g.cylinder({
    height: cupH,
    radiusBottom: 0.07,
    radiusTop: 0.125,
    sides: 6,
    caps: "bottom",
    at: add(cupBase, [0, cupH / 2, 0]),
    phase: 15,
    color: WOOD.cup,
    vary: 0.1,
  });
  const rim = add(cupBase, [0, cupH, 0]);
  // Iron hoop around the cup lip.
  g.cylinder({
    height: 0.03,
    radiusBottom: 0.124,
    radiusTop: 0.131,
    sides: 6,
    caps: false,
    at: add(rim, [0, -0.022, 0]),
    phase: 15,
    color: IRON.light,
    vary: 0.06,
  });
  g.cylinder({
    height: 0.03,
    radiusBottom: 0.114,
    radiusTop: 0.1,
    sides: 6,
    caps: "top",
    at: add(rim, [0, -0.012, 0]),
    phase: 15,
    color: EMBER.base,
    mat: "glow",
    glow: GLOW_EMBER,
    vary: 0.1,
  });

  const flames = m.node("flames", { at: rim });
  torchFlames(flames.geo, rng.fork("flames"), 1.15);

  const lightAt = add(rim, [0, 0.28, 0]);
  m.node("light_anchor", { at: lightAt });
  m.anchor("light", lightAt);
  m.anchor("flame_base", rim);
  m.light({ name: "torch", at: lightAt, color: "#FFA552", intensity: 1.4, range: 6 });
  m.collider = { type: "cylinder", center: [0, 1.15, 0], radius: 0.3, height: 2.3 };
  m.meta = {
    flicker: {
      nodes: ["flames"],
      scaleY: [0.88, 1.12],
      scaleXZ: [0.94, 1.06],
      hz: [6, 10],
      emissiveIntensity: [1.3, 1.7],
    },
    light: { color: "#FFA552", intensity: [1.2, 1.6], range: 6 },
  };
  return m;
}

/* ------------------------------------------------------------------ tripod torch / fire bowl */

function torchTripod(): Model {
  const m = new Model("tl_fx_torch_tripod_v01", {
    budget: 500,
    notes:
      "Tripod brazier: three rope-lashed 2.1 m sticks cross at ~1.75 m and cradle an iron fire bowl (rim 2.04 m). " +
      "Child 'flames' (emissive) pivots at the bowl rim; 'light_anchor' at the flame centre.",
  });
  const rng = m.rng.fork("layout");
  const g = m.geo;

  // Sticks: from the floor (r 0.5) through the lashing (~1.75 m), splaying a little above it
  // into the bowl cradle (their ends hide inside the bowl).
  const lashY = 1.75;
  const bowlBottom = 1.9;
  const bowlH = 0.14;
  const rimY = bowlBottom + bowlH;
  for (let i = 0; i < 3; i++) {
    const a = 90 + i * 120 + rng.jitter(6);
    // Foot centre 1.1 cm up: the tilted end cap then just touches y = 0.
    const foot = polar(0.5 + rng.jitter(0.02), a, 0.011);
    const end = add(polar(0.075, a + 180, rimY - 0.04), polar(0.025, a + 90));
    const kink = add(lerp3(foot, end, 0.45), [rng.jitter(0.02), 0, rng.jitter(0.02)]);
    g.tube([foot, kink, end], {
      radius: [0.036, 0.032, 0.028],
      sides: 5,
      phase: rng.range(0, 72),
      parts: { side: i === 1 ? WOOD.stickLight : WOOD.stick, cap: WOOD.poleEnd },
      vary: 0.08,
    });
  }
  // Rope lashing around the crossing.
  g.cylinder({
    height: 0.07,
    radius: 0.07,
    sides: 6,
    at: [0, lashY + 0.02, 0],
    rot: [5, 0, -4],
    color: ROPE.light,
    vary: 0.08,
  });
  g.cylinder({
    height: 0.05,
    radius: 0.066,
    sides: 6,
    at: [0, lashY - 0.05, 0],
    rot: [-4, 30, 3],
    color: ROPE.dark,
    vary: 0.08,
  });

  // Iron fire bowl.
  g.cylinder({
    height: bowlH,
    radiusBottom: 0.08,
    radiusTop: 0.17,
    sides: 8,
    caps: "bottom",
    at: [0, bowlBottom + bowlH / 2, 0],
    phase: 10,
    parts: { side: IRON.base, bottom: IRON.dark },
    vary: 0.08,
  });
  g.cylinder({
    height: 0.03,
    radiusBottom: 0.175,
    radiusTop: 0.18,
    sides: 8,
    caps: false,
    at: [0, bowlBottom + bowlH - 0.012, 0],
    phase: 10,
    color: IRON.light,
    vary: 0.06,
  });
  g.cylinder({
    height: 0.03,
    radiusBottom: 0.162,
    radiusTop: 0.145,
    sides: 8,
    caps: "top",
    at: [0, rimY - 0.008, 0],
    phase: 10,
    color: EMBER.deep,
    mat: "glow",
    glow: GLOW_EMBER,
    vary: 0.1,
  });
  const cr = rng.fork("coals");
  for (let i = 0; i < 3; i++)
    coal(g, cr, polar(cr.range(0.06, 0.11), i * 120 + cr.jitter(20), rimY - 0.01), 0.07, i !== 2);

  const flames = m.node("flames", { at: [0, rimY + 0.005, 0] });
  torchFlames(flames.geo, rng.fork("flames"), 1.25);

  const lightAt: Vec3 = [0, rimY + 0.32, 0];
  m.node("light_anchor", { at: lightAt });
  m.anchor("light", lightAt);
  m.anchor("flame_base", [0, rimY, 0]);
  m.light({ name: "brazier", at: lightAt, color: "#FFA552", intensity: 1.5, range: 6.5 });
  m.collider = { type: "cylinder", center: [0, 1, 0], radius: 0.42, height: 2 };
  m.meta = {
    flicker: {
      nodes: ["flames"],
      scaleY: [0.88, 1.12],
      scaleXZ: [0.94, 1.06],
      hz: [6, 10],
      emissiveIntensity: [1.3, 1.7],
    },
    light: { color: "#FFA552", intensity: [1.3, 1.7], range: 6.5 },
  };
  return m;
}

/* ------------------------------------------------------------------ camp lantern */

function lantern(): Model {
  const m = new Model("tl_fx_lantern_v01", {
    budget: 500,
    notes:
      "Small square camp lantern (0.35 m with handle) for the rest corner: crate top or hung from " +
      "the tarp ('hang' anchor). Child 'glow' = emissive glass + flame; 'light_anchor' at its centre.",
  });
  const g = m.geo;
  const metal = { side: IRON.base, top: IRON.light, bottom: IRON.dark, bevel: IRON.light };
  const W = 0.17; // footprint
  const baseH = 0.026;
  const glassH = 0.15;
  const gy0 = baseH;
  const gy1 = baseH + glassH;

  // Base plate and the two frame bands around the glass.
  g.box({ size: [W, baseH, W], at: [0, baseH / 2, 0], chamfer: 0.004, parts: metal, vary: 0.06 });
  g.box({ size: [W - 0.012, 0.016, W - 0.012], at: [0, gy0 + 0.008, 0], parts: metal, vary: 0.06 });
  g.box({ size: [W - 0.012, 0.016, W - 0.012], at: [0, gy1 - 0.008, 0], parts: metal, vary: 0.06 });
  // Corner posts.
  g.mirrorX((b) => {
    for (const z of [-1, 1])
      b.box({
        size: [0.018, glassH, 0.018],
        at: [W / 2 - 0.012, gy0 + glassH / 2, z * (W / 2 - 0.012)],
        parts: metal,
        vary: 0.06,
      });
  });
  // Roof: low square pyramid frustum + chimney cap.
  const roofH = 0.05;
  g.cylinder({
    height: roofH,
    radiusBottom: (W / 2 + 0.008) * Math.SQRT2,
    radiusTop: 0.034,
    sides: 4,
    phase: 45,
    at: [0, gy1 + roofH / 2, 0],
    parts: metal,
    vary: 0.06,
  });
  g.cylinder({ height: 0.028, radius: 0.026, sides: 6, at: [0, gy1 + roofH + 0.014, 0], parts: metal, vary: 0.06 });
  // Handle: squarish wire arch over the roof (X-Y plane), ends sunk into the roof slope.
  const hy = gy1 + 0.012;
  g.tube(
    [
      [-0.072, hy, 0],
      [-0.072, hy + 0.105, 0],
      [-0.048, hy + 0.15, 0],
      [0.048, hy + 0.15, 0],
      [0.072, hy + 0.105, 0],
      [0.072, hy, 0],
    ],
    { radius: 0.0065, sides: 4, color: IRON.dark, vary: 0.05 },
  );

  // Emissive glass core + flame silhouettes on each side.
  const glow = m.node("glow");
  glow.geo.box({
    size: [W - 0.02, glassH - 0.004, W - 0.02],
    at: [0, gy0 + glassH / 2, 0],
    color: LANTERN.glass,
    mat: "glow",
    glow: GLOW_FLAME,
    vary: 0.04,
  });
  const fl: Vec2[] = [
    [0, -0.045],
    [0.022, -0.02],
    [0.016, 0.018],
    [0, 0.05],
    [-0.017, 0.016],
    [-0.021, -0.022],
  ];
  for (const yaw of [0, 90, 180, 270])
    glow.geo.group({ rot: [0, yaw, 0] }, (b) =>
      b.extrude(fl, {
        depth: 0,
        at: [0, gy0 + glassH * 0.46, (W - 0.02) / 2 + 0.002],
        color: LANTERN.flame,
        mat: "glow",
        glow: GLOW_FLAME,
      }),
    );

  const lightAt: Vec3 = [0, gy0 + glassH / 2, 0];
  m.node("light_anchor", { at: lightAt });
  m.anchor("light", lightAt);
  m.anchor("hang", [0, hy + 0.15 + 0.0065, 0]);
  m.light({ name: "lantern", at: lightAt, color: "#FFB65C", intensity: 1.1, range: 3.5 });
  m.collider = { type: "box", center: [0, 0.13, 0], size: [W, 0.26, W] };
  m.meta = {
    flicker: { nodes: ["glow"], emissiveIntensity: [1.35, 1.6], hz: [3, 6] },
    light: { color: "#FFB65C", intensity: [0.9, 1.2], range: 3.5 },
  };
  return m;
}

/* ------------------------------------------------------------------ embers ring (overlay) */

function embersRing(): Model {
  const m = new Model("tl_fx_embers_ring_v01", {
    budget: 300,
    notes:
      "Optional overlay at the campfire origin: glowing specks just inside and outside the stone ring " +
      "(0.55-1.5 m). Pure emissive, no collider.",
  });
  const rng = m.rng.fork("specks");
  const g = m.geo;
  for (let i = 0; i < 26; i++) {
    const inner = i % 3 === 0;
    const a = rng.range(0, 360);
    const r = inner ? rng.range(0.6, 0.72) : rng.range(1.12, 1.5);
    const s = rng.range(0.03, 0.06);
    g.rock({
      size: [s, s * 0.45, s * rng.range(0.7, 1.1)],
      points: 6,
      jitter: 0.25,
      flat: 0.3,
      align: "bottom",
      at: polar(r, a, 0),
      rot: [0, rng.range(0, 360), 0],
      color: rng.pick([EMBER.hot, EMBER.hot, EMBER.base, EMBER.deep]),
      mat: "glow",
      glow: GLOW_EMBER,
      vary: 0.08,
    });
  }
  m.anchor("center", [0, 0, 0]);
  m.meta = { placeAt: "campfire origin", flicker: { emissiveIntensity: [0.9, 1.45], hz: [1, 3] } };
  return m;
}

export default function build(): Model[] {
  return [campfire(), torchPole(), torchTripod(), lantern(), embersRing()];
}
