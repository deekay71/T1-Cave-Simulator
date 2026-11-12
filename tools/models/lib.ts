/**
 * Tê Liệt — programmatic low-poly GLB toolkit (Node only, @gltf-transform/core).
 *
 * Conventions (match docs/art-direction.md):
 * - Units metres, Y up, models face +Z. A character's LEFT side is +X, RIGHT side is -X.
 * - Props pivot at bottom centre (min y = 0, centred on x/z); characters pivot at feet centre.
 * - Asset names: tl_<category>_<name>_v01 (lower-case, digits, underscores).
 * - Colours are authored as sRGB hex ("#rrggbb"). They are converted to LINEAR when written
 *   to glTF (COLOR_0 vertex colours), as the glTF spec requires.
 * - Flat shading: every triangle has its own face normal, so surfaces look faceted.
 * - One shared matte material per GLB ("tl_matte", baseColor white, metallic 0, roughness 0.9)
 *   carries all per-face colours through COLOR_0. Cloth uses "tl_cloth" (double-sided).
 *   Emissive parts use "tl_glow" / "tl_glow_<strength>" (KHR_materials_unlit + COLOR_0, plus
 *   KHR_materials_emissive_strength when strength != 1; PlayCanvas maps that to
 *   emissiveIntensity, so strengths > 1 render brighter).
 * - Deterministic: all randomness comes from seeded Rng instances (seeded from asset/node names).
 *
 * Typical use (tools/models/groups/<group>.ts):
 *
 *   import { Model, PALETTE as P } from "../lib.js";
 *   export default function build(): Model[] {
 *     const m = new Model("tl_prop_crate_v01", { notes: "0.6 m wooden crate", budget: 300 });
 *     m.geo.box({ size: [0.6, 0.5, 0.6], align: "bottom", chamfer: 0.015, color: P.wood, vary: 0.05 });
 *     return [m];
 *   }
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Extension,
  NodeIO,
  type Material,
  type Node as GltfNode,
  type ReaderContext,
  type WriterContext,
} from "@gltf-transform/core";

/* =========================================================================================
 * Basic types
 * ========================================================================================= */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** sRGB colour "#rrggbb" (or "#rgb"). */
export type Color = string;

/* =========================================================================================
 * Seeded RNG
 * ========================================================================================= */

/** 32-bit string hash (cyrb53 folded). Deterministic across runs and platforms. */
export function hashString(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed => same sequence. */
export class Rng {
  /** The 32-bit seed this generator started from. */
  readonly seed: number;
  private state: number;
  constructor(seed: number | string = 1) {
    this.seed = typeof seed === "string" ? hashString(seed) : hashString("#" + seed);
    this.state = this.seed || 0x9e3779b9;
  }
  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** Uniform float in [-amount, amount]. */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("Rng.pick on empty array");
    return items[Math.floor(this.next() * items.length)];
  }
  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i];
      items[i] = items[j];
      items[j] = t;
    }
    return items;
  }
  /** Normal distribution (Box–Muller). */
  gauss(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Independent child stream derived from this seed + label (does not consume numbers). */
  fork(label: string | number): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}

/* =========================================================================================
 * Colour (author in sRGB hex; glTF stores linear)
 * ========================================================================================= */

/** Shared palette (sRGB). Core values come from docs/art-direction.md. */
export const PALETTE = {
  // Art-bible core
  earth: "#493325",
  ochre: "#72513A",
  shadow: "#211C19",
  crimson: "#AD2936",
  worn: "#CEC5B2",
  torch: "#FFB24C",
  // Stone, ground, water
  rock: "#6B4C37",
  rockLight: "#86634A",
  rockDark: "#4E3829",
  dirt: "#3D2B1F",
  mud: "#2E221A",
  pebble: "#8C7B69",
  water: "#2C3F4A",
  waterLight: "#4D6670",
  // Wood
  wood: "#7A5236",
  woodLight: "#9C6E47",
  woodDark: "#4F3524",
  woodGrey: "#6E6257",
  // Metal
  metal: "#7E8082",
  metalLight: "#A7A9A8",
  metalDark: "#45484B",
  rust: "#86492D",
  // Fan clothing / fabric (faded red, black, white)
  crimsonDark: "#7C1E28",
  crimsonFaded: "#A04A4C",
  black: "#2B2725",
  charcoal: "#3A3533",
  white: "#D9D2C3",
  wornDark: "#A69C88",
  denim: "#3E4654",
  tarp: "#8E3A35",
  // Skin & hair (keep casts diverse)
  skinLight: "#EBC3A0",
  skinMedium: "#D29A72",
  skinTan: "#B47A50",
  skinBrown: "#8A5838",
  skinDeep: "#5C3A26",
  hairBlack: "#1E1A18",
  hairBrown: "#4A3121",
  hairAuburn: "#6B3420",
  hairGrey: "#B5B0A8",
  // Misc props
  paper: "#D8CBA8",
  cardboard: "#A7865E",
  chalkboard: "#26302B",
  chalk: "#D9D6CC",
  screen: "#2A2F33",
  plastic: "#C9C2B4",
  oxygen: "#6F8F72",
  // Glow colours (use with mat: "glow")
  flameCore: "#FFE7A3",
  flame: "#FFB24C",
  flameOuter: "#FF7A26",
  ember: "#E0521B",
  screenGlow: "#C9D6DC",
  lanternGlass: "#FFD27A",
} as const;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** "#rrggbb" -> sRGB triple in 0..1. */
export function hexToRgb(hex: Color): Vec3 {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`bad colour "${hex}" (expected "#rrggbb")`);
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** sRGB triple (0..1) -> "#rrggbb". */
export function rgbToHex(rgb: Vec3): Color {
  return (
    "#" +
    rgb
      .map((c) =>
        Math.round(clamp01(c) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
/** "#rrggbb" (sRGB) -> linear RGB triple (what glTF COLOR_0 / baseColorFactor expect). */
export function hexToLinear(hex: Color): Vec3 {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
/** Linear RGB triple -> "#rrggbb" (sRGB). */
export function linearToHex(lin: Vec3): Color {
  return rgbToHex([linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])]);
}
/** Blend two colours in sRGB space (t = 0 -> a, 1 -> b). */
export function mix(a: Color, b: Color, t: number): Color {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
/** Scale brightness physically (multiplies linear RGB): 0.8 = 20 % darker, 1.2 = lighter. */
export function shade(c: Color, k: number): Color {
  const l = hexToLinear(c);
  return linearToHex([clamp01(l[0] * k), clamp01(l[1] * k), clamp01(l[2] * k)]);
}

/* =========================================================================================
 * Math helpers (column-major 4x4 like glTF)
 * ========================================================================================= */

export type Mat4 = number[];
const DEG = Math.PI / 180;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vlen = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = vlen(a);
  return l > 1e-15 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
function centroid(pts: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return scl(c, 1 / pts.length);
}
/** Newell normal (unnormalised) of a polygon; follows the right-hand rule (CCW = front). */
function newell(pts: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

function m4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function m4mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
function m4translate(x: number, y: number, z: number): Mat4 {
  const m = m4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function m4scale(x: number, y: number, z: number): Mat4 {
  const m = m4();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}
function m4rotX(deg: number): Mat4 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function m4rotY(deg: number): Mat4 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function m4rotZ(deg: number): Mat4 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
/** Euler degrees with PlayCanvas setLocalEulerAngles order: R = Rz * Ry * Rx (X applied first). */
function m4euler(r: Vec3): Mat4 {
  return m4mul(m4rotZ(r[2]), m4mul(m4rotY(r[1]), m4rotX(r[0])));
}
function toVec3(s: number | Vec3): Vec3 {
  return typeof s === "number" ? [s, s, s] : s;
}
function m4trs(t?: Vec3, r?: Vec3, s?: number | Vec3): Mat4 {
  let m = t ? m4translate(t[0], t[1], t[2]) : m4();
  if (r && (r[0] || r[1] || r[2])) m = m4mul(m, m4euler(r));
  if (s !== undefined) {
    const v = toVec3(s);
    m = m4mul(m, m4scale(v[0], v[1], v[2]));
  }
  return m;
}
function m4point(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
function m4det3(m: Mat4): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  );
}

/** Euler degrees (PlayCanvas order, see m4euler) -> glTF quaternion [x, y, z, w]. */
export function eulerToQuat(r: Vec3): [number, number, number, number] {
  const hx = (r[0] * DEG) / 2;
  const hy = (r[1] * DEG) / 2;
  const hz = (r[2] * DEG) / 2;
  const sx = Math.sin(hx),
    cx = Math.cos(hx),
    sy = Math.sin(hy),
    cy = Math.cos(hy),
    sz = Math.sin(hz),
    cz = Math.cos(hz);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
/** Rotate a point by euler degrees (same convention as primitives' `rot`). */
export function rotatePoint(p: Vec3, rot: Vec3): Vec3 {
  return m4point(m4euler(rot), p);
}

function rodrigues(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c)));
}
/** A stable unit vector perpendicular to d: world-up projected, or +Z for vertical d. */
function perpendicular(d: Vec3): Vec3 {
  const up: Vec3 = Math.abs(d[1]) < 0.999 ? [0, 1, 0] : [0, 0, 1];
  return norm(sub(up, scl(d, dot(up, d))));
}
/** Apply the minimal rotation taking unit vector `from` to `to` onto v. */
function rotateBetween(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = vlen(axis);
  const c = dot(from, to);
  if (s < 1e-9) {
    if (c > 0) return v;
    const k = perpendicular(from);
    return sub(scl(k, 2 * dot(k, v)), v);
  }
  return rodrigues(v, scl(axis, 1 / s), Math.atan2(s, c));
}

/* =========================================================================================
 * 2D shape helpers (for extrude / emblem / signs). Polygons are simple, any winding.
 * ========================================================================================= */

function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function cleanPolygon(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  while (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) break;
    out.pop();
  }
  return out;
}
const cross2 = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const e = -1e-12;
  return cross2(a, b, p) > e && cross2(b, c, p) > e && cross2(c, a, p) > e;
}
/** Ear-clipping triangulation of a simple CCW polygon; returns index triples. */
function earClip(poly: Vec2[]): number[] {
  const idx = poly.map((_, i) => i);
  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0],
        b = poly[i1],
        c = poly[i2];
      if (cross2(a, b, c) <= 1e-14) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Numerical trouble: drop the flattest vertex and continue.
      let best = 0;
      let bestArea = Infinity;
      for (let i = 0; i < idx.length; i++) {
        const ar = Math.abs(
          cross2(poly[idx[(i + idx.length - 1) % idx.length]], poly[idx[i]], poly[idx[(i + 1) % idx.length]]),
        );
        if (ar < bestArea) {
          bestArea = ar;
          best = i;
        }
      }
      idx.splice(best, 1);
    }
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

export const shape2d = {
  /** Axis-aligned rectangle centred at (cx, cy). */
  rect(w: number, h: number, cx = 0, cy = 0): Vec2[] {
    return [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ];
  },
  /** Regular n-gon (circle) of radius r. phase in degrees. */
  circle(r: number, n = 12, cx = 0, cy = 0, phase = 0): Vec2[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (phase + (i * 360) / n) * DEG;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Vec2;
    });
  },
  /** Thick arc band (annular sector) from startDeg to endDeg (CCW, 0 deg = +X). */
  arcBand(rOuter: number, rInner: number, startDeg: number, endDeg: number, n = 12, cx = 0, cy = 0): Vec2[] {
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (startDeg + ((endDeg - startDeg) * i) / n) * DEG;
      pts.push([cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter]);
    }
    for (let i = n; i >= 0; i--) {
      const a = (startDeg + ((endDeg - startDeg) * i) / n) * DEG;
      pts.push([cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner]);
    }
    return pts;
  },
  /** Outline of a thick polyline (mitred joins) as one simple polygon. */
  stroke(points: Vec2[], width: number): Vec2[] {
    const hw = width / 2;
    const n = points.length;
    if (n < 2) throw new Error("shape2d.stroke needs >= 2 points");
    const dirs: Vec2[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = points[i + 1][0] - points[i][0];
      const dy = points[i + 1][1] - points[i][1];
      const l = Math.hypot(dx, dy) || 1;
      dirs.push([dx / l, dy / l]);
    }
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const p = points[i];
      let nx: number, ny: number, k: number;
      if (i === 0 || i === n - 1) {
        const d = dirs[i === 0 ? 0 : n - 2];
        nx = -d[1];
        ny = d[0];
        k = hw;
      } else {
        const a = dirs[i - 1];
        const b = dirs[i];
        const lx = -a[1] - b[1];
        const ly = a[0] + b[0];
        const l = Math.hypot(lx, ly) || 1;
        nx = lx / l;
        ny = ly / l;
        const cosHalf = Math.max(nx * -b[1] + ny * b[0], 0.34);
        k = hw / cosHalf;
      }
      left.push([p[0] + nx * k, p[1] + ny * k]);
      right.push([p[0] - nx * k, p[1] - ny * k]);
    }
    return [...left, ...right.reverse()];
  },
};

/** Points along a circular arc (for tube paths). Angles in degrees, 0 = first axis of `plane`. */
export function arcPoints(
  radius: number,
  startDeg: number,
  endDeg: number,
  segments: number,
  plane: "xy" | "xz" | "yz" = "xy",
  center: Vec3 = [0, 0, 0],
): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (startDeg + ((endDeg - startDeg) * i) / segments) * DEG;
    const u = Math.cos(a) * radius;
    const v = Math.sin(a) * radius;
    const p: Vec3 = plane === "xy" ? [u, v, 0] : plane === "xz" ? [u, 0, v] : [0, u, v];
    pts.push(add(center, p));
  }
  return pts;
}

/**
 * The only allowed emblem: a simplified, original geometric rendition of the LEFT half of
 * design/references/user-symbol-reference.png (wing strokes + seated figure + wheel arc).
 * Returned as polygons in the XY plane, unit height (y in [-0.5, 0.5]), centred on its bounding
 * box. Never add text such as "T1" to it.
 */
export function emblemShapes(): Vec2[][] {
  const head = shape2d.circle(0.105, 10, 0.8, 0.885, 9);
  const backAt = (y: number) => 0.45 + (0.25 * (y - 0.42)) / 0.28;
  const wing = (y0: number, y1: number, x0: number, slant: number): Vec2[] => [
    [x0 + slant, y0],
    [backAt(y0) + 0.05, y0],
    [backAt(y1) + 0.05, y1],
    [x0, y1],
  ];
  // Four wing strokes, shorter toward the bottom, left ends on one slanted line.
  const wings = [0, 1, 2, 3].map((i) => {
    const y1 = 0.75 - i * 0.092;
    return wing(y1 - 0.058, y1, 0.02 + i * 0.1, 0.045);
  });
  const shapes: Vec2[][] = [
    head,
    ...wings,
    shape2d.stroke(
      [
        [0.72, 0.72],
        [0.47, 0.42],
        [0.83, 0.42],
        [0.88, 0.07],
      ],
      0.115,
    ),
    shape2d.arcBand(0.335, 0.245, 100, 352, 14, 0.42, 0.335),
  ];
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const s of shapes)
    for (const [x, y] of s) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  const k = 1 / (y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return shapes.map((s) => s.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as Vec2));
}
/** Width / height of emblemShapes(). */
export const EMBLEM_ASPECT = (() => {
  let x0 = Infinity,
    x1 = -Infinity;
  for (const s of emblemShapes())
    for (const [x] of s) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
  return x1 - x0;
})();

/* =========================================================================================
 * 5x7 pixel font (upper-case A–Z, 0–9, common punctuation; Vietnamese accents are stripped)
 * ========================================================================================= */

const FONT_SRC: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
  "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": "..##. .#... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ...#. .##..",
  " ": "..... ..... ..... ..... ..... ..... .....",
  ".": "..... ..... ..... ..... ..... .##.. .##..",
  ",": "..... ..... ..... ..... .##.. ..#.. .#...",
  "!": "..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
  "-": "..... ..... ..... ##### ..... ..... .....",
  "+": "..... ..#.. ..#.. ##### ..#.. ..#.. .....",
  "=": "..... ..... ##### ..... ##### ..... .....",
  ":": "..... .##.. .##.. ..... .##.. .##.. .....",
  "/": "..... ....# ...#. ..#.. .#... #.... .....",
  "'": "..#.. ..#.. .#... ..... ..... ..... .....",
  '"': ".#.#. .#.#. ..... ..... ..... ..... .....",
  "(": "...#. ..#.. .#... .#... .#... ..#.. ...#.",
  ")": ".#... ..#.. ...#. ...#. ...#. ..#.. .#...",
  "#": ".#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.",
  "%": "##... ##..# ...#. ..#.. .#... #..## ...##",
  "<": "...#. ..#.. .#... #.... .#... ..#.. ...#.",
  ">": ".#... ..#.. ...#. ....# ...#. ..#.. .#...",
  _: "..... ..... ..... ..... ..... ..... #####",
  "*": "..... ..#.. #.#.# .###. #.#.# ..#.. .....",
};
/** Characters the pixel font can draw (after accent stripping + upper-casing). */
export const FONT_CHARS = Object.keys(FONT_SRC).join("");

const glyphCache = new Map<string, [number, number, number, number][]>();
/** Greedy rectangles covering a glyph: [x, y, w, h] in font pixels, y down from the top row. */
function glyphRects(ch: string): [number, number, number, number][] {
  const key = FONT_SRC[ch] !== undefined ? ch : "?";
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const rows = FONT_SRC[key].split(" ").map((r) => [...r].map((c) => c === "#"));
  const used = rows.map((r) => r.map(() => false));
  const rects: [number, number, number, number][] = [];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 5; x++) {
      if (!rows[y][x] || used[y][x]) continue;
      let w = 1;
      while (x + w < 5 && rows[y][x + w] && !used[y][x + w]) w++;
      let h = 1;
      grow: while (y + h < 7) {
        for (let k = 0; k < w; k++) if (!rows[y + h][x + k] || used[y + h][x + k]) break grow;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy][xx] = true;
      rects.push([x, y, w, h]);
    }
  glyphCache.set(key, rects);
  return rects;
}
/** Upper-cases and strips Vietnamese accents ("Hang trú thua" -> "HANG TRU THUA"). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase();
}
export interface TextMetrics {
  width: number;
  height: number;
  /** Size in font pixels. */
  cols: number;
  rows: number;
}
/** Size of pixel text in metres (same layout rules as MeshBuilder.text). */
export function measureText(str: string, opts: { pixel: number; spacing?: number; lineGap?: number }): TextMetrics {
  const sp = opts.spacing ?? 1;
  const lg = opts.lineGap ?? 2;
  const lines = normalizeText(str).split("\n");
  const cols = Math.max(...lines.map((l) => (l.length ? l.length * 5 + (l.length - 1) * sp : 0)));
  const rows = lines.length * 7 + (lines.length - 1) * lg;
  return { width: cols * opts.pixel, height: rows * opts.pixel, cols, rows };
}

/* =========================================================================================
 * Convex hull (incremental, O(n^2); fine for rocks with < 200 points)
 * ========================================================================================= */

function convexHull(pts: Vec3[]): [number, number, number][] {
  const n = pts.length;
  if (n < 4) throw new Error("hull needs at least 4 points");
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])];
    hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])];
  }
  const eps = Math.max(vlen(sub(hi, lo)), 1e-9) * 1e-9;
  const far = (from: (p: Vec3) => number) => {
    let best = 0;
    let bv = -Infinity;
    pts.forEach((p, i) => {
      const v = from(p);
      if (v > bv) {
        bv = v;
        best = i;
      }
    });
    return { i: best, v: bv };
  };
  const a0 = far((p) => vlen(sub(p, pts[0]))).i;
  const a1 = far((p) => vlen(sub(p, pts[a0]))).i;
  const ab = sub(pts[a1], pts[a0]);
  const a2r = far((p) => vlen(cross(sub(p, pts[a0]), ab)));
  const a2 = a2r.i;
  const pn = norm(cross(ab, sub(pts[a2], pts[a0])));
  const a3r = far((p) => Math.abs(dot(sub(p, pts[a0]), pn)));
  const a3 = a3r.i;
  if (a2r.v < eps || a3r.v < eps) throw new Error("hull: points are collinear or coplanar");
  const inside = centroid([pts[a0], pts[a1], pts[a2], pts[a3]]);
  type HFace = { v: [number, number, number]; n: Vec3; d: number; dead: boolean };
  const mk = (a: number, b: number, c: number): HFace => {
    let nn = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    let v: [number, number, number] = [a, b, c];
    if (dot(nn, sub(inside, pts[a])) > 0) {
      v = [a, c, b];
      nn = scl(nn, -1);
    }
    nn = norm(nn);
    return { v, n: nn, d: dot(nn, pts[a]), dead: false };
  };
  let faces: HFace[] = [mk(a0, a1, a2), mk(a0, a1, a3), mk(a0, a2, a3), mk(a1, a2, a3)];
  const simplex = new Set([a0, a1, a2, a3]);
  for (let i = 0; i < n; i++) {
    if (simplex.has(i)) continue;
    const p = pts[i];
    const visible = faces.filter((f) => dot(f.n, p) - f.d > eps);
    if (!visible.length) continue;
    const edges = new Set<string>();
    for (const f of visible) {
      f.dead = true;
      for (let k = 0; k < 3; k++) edges.add(`${f.v[k]},${f.v[(k + 1) % 3]}`);
    }
    const horizon: [number, number][] = [];
    for (const f of visible)
      for (let k = 0; k < 3; k++) {
        const a = f.v[k];
        const b = f.v[(k + 1) % 3];
        if (!edges.has(`${b},${a}`)) horizon.push([a, b]);
      }
    faces = faces.filter((f) => !f.dead);
    for (const [a, b] of horizon) faces.push(mk(a, b, i));
  }
  return faces.map((f) => f.v);
}

/* =========================================================================================
 * MeshBuilder — flat-shaded triangle soup with per-face colour and a transform stack
 * ========================================================================================= */

/** Material slot of a primitive: matte opaque, double-sided cloth, or unlit emissive glow. */
export type MatKind = "solid" | "cloth" | "glow";

/** Passed to colour callbacks; normal/center are in the primitive's local space. */
export interface FaceInfo {
  /** e.g. top, bottom, front, back, +x, -x, side, edge, corner, slope, end, cap, outer, inner, cloth, patch */
  part: string;
  normal: Vec3;
  center: Vec3;
  /** Face index within this primitive call. */
  index: number;
}
/** A colour, or a function choosing a colour per face. */
export type Paint = Color | ((face: FaceInfo) => Color);

/** Placement applied to a primitive before the builder's transform stack. */
export interface Place {
  /** Translation (applied last). */
  at?: Vec3;
  /** Euler degrees, R = Rz*Ry*Rx (same as PlayCanvas setLocalEulerAngles). */
  rot?: Vec3;
  scale?: number | Vec3;
  /** Shift the primitive so its local min y ("bottom") or max y ("top") sits at y=0 before rot/at. */
  align?: "center" | "bottom" | "top";
}
export interface Style {
  /** Default: builder.color. */
  color?: Paint;
  /**
   * Per-part colours. Exact part names win; "side" also matches front/back/+x/-x/end/outer/inner;
   * "bevel" matches edge/corner; "top" also matches slope.
   */
  parts?: Record<string, Color>;
  /** Per-face random brightness variation, e.g. 0.06 = ±6 % (deterministic). */
  vary?: number;
  /** Default "solid" ("cloth" for cloth()). */
  mat?: MatKind;
  /** Emissive strength for mat "glow" (default 1). Each distinct value becomes its own material. */
  glow?: number;
}
export type PrimOpts = Place & Style;

interface Face {
  pts: Vec3[];
  /** Triangle indices into pts (default: fan; only for convex polygons). */
  tris?: number[];
  part: string;
  /** Faces sharing a group id share one resolved colour. */
  group?: number;
  /** Colour override for this face (still subject to `vary`). */
  color?: Color;
}
export interface Bucket {
  mat: MatKind;
  glow: number;
  pos: number[];
  nrm: number[];
  col: number[];
}

const PART_ALIASES: Record<string, string> = {
  front: "side",
  back: "side",
  "+x": "side",
  "-x": "side",
  end: "side",
  outer: "side",
  inner: "side",
  edge: "bevel",
  corner: "bevel",
  slope: "top",
};

function orientOut(f: Face, center: Vec3): void {
  const n = newell(f.pts);
  if (dot(n, sub(centroid(f.pts), center)) < 0) flipFace(f);
}
function orientTo(f: Face, dir: Vec3): Face {
  if (dot(newell(f.pts), dir) < 0) flipFace(f);
  return f;
}
/** Reverse a face: its point order (so the Newell normal flips) and every triangle's winding. */
function flipFace(f: Face): void {
  const n = f.pts.length;
  f.pts.reverse();
  if (f.tris) {
    const t = f.tris.map((i) => n - 1 - i); // same points, same winding after the reverse...
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i + 1]; // ...then swap to flip the winding
      t[i + 1] = t[i + 2];
      t[i + 2] = x;
    }
    f.tris = t;
  }
}
function fan(n: number): number[] {
  const t: number[] = [];
  for (let i = 1; i < n - 1; i++) t.push(0, i, i + 1);
  return t;
}

export function materialName(mat: MatKind, glow = 1): string {
  if (mat === "cloth") return "tl_cloth";
  if (mat === "glow") return glow === 1 ? "tl_glow" : `tl_glow_${+glow.toFixed(3)}`;
  return "tl_matte";
}
/** Roughness of every matte material. */
export const ROUGHNESS = 0.9;

export class MeshBuilder {
  /** Seeded RNG used by `vary`, rock, plank, cloth… (also free for your own use). */
  readonly rng: Rng;
  /** Default colour for primitives without `color`. */
  color: Color = "#8A8580";
  /** Triangles dropped because they had (near) zero area. */
  degenerate = 0;
  private stack: Mat4[] = [m4()];
  private buckets = new Map<string, Bucket>();

  constructor(seed: number | string = 1) {
    this.rng = new Rng(seed);
  }

  /* ---------------- transform stack (each call post-multiplies: last call applies first) */

  private get top(): Mat4 {
    return this.stack[this.stack.length - 1];
  }
  private apply(m: Mat4): this {
    this.stack[this.stack.length - 1] = m4mul(this.top, m);
    return this;
  }
  push(): this {
    this.stack.push(this.top.slice());
    return this;
  }
  pop(): this {
    if (this.stack.length < 2) throw new Error("MeshBuilder.pop() without push()");
    this.stack.pop();
    return this;
  }
  translate(x: number, y: number, z: number): this {
    return this.apply(m4translate(x, y, z));
  }
  /** Euler degrees, R = Rz*Ry*Rx. */
  rotate(x: number, y: number, z: number): this {
    return this.apply(m4euler([x, y, z]));
  }
  rotateX(deg: number): this {
    return this.apply(m4rotX(deg));
  }
  rotateY(deg: number): this {
    return this.apply(m4rotY(deg));
  }
  rotateZ(deg: number): this {
    return this.apply(m4rotZ(deg));
  }
  scale(x: number, y = x, z = x): this {
    return this.apply(m4scale(x, y, z));
  }
  /** push(); translate/rotate/scale by `place`; fn(this); pop(). */
  group(place: { at?: Vec3; rot?: Vec3; scale?: number | Vec3 }, fn: (b: this) => void): this {
    this.push();
    this.apply(m4trs(place.at, place.rot, place.scale));
    try {
      fn(this);
    } finally {
      this.pop();
    }
    return this;
  }
  /** Runs fn twice: as is (side = +1) and mirrored across x = 0 (side = -1). Winding is fixed. */
  mirrorX(fn: (b: this, side: 1 | -1) => void): this {
    fn(this, 1);
    this.push();
    this.apply(m4scale(-1, 1, 1));
    try {
      fn(this, -1);
    } finally {
      this.pop();
    }
    return this;
  }

  /* ---------------- core emission */

  private bucket(mat: MatKind, glow: number): Bucket {
    const key = materialName(mat, glow);
    let b = this.buckets.get(key);
    if (!b) {
      b = { mat, glow, pos: [], nrm: [], col: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  private resolveColor(info: FaceInfo, o: Style, override?: Color): Vec3 {
    let hex: Color | undefined = override;
    if (hex === undefined && o.parts) {
      hex = o.parts[info.part];
      const alias = PART_ALIASES[info.part];
      if (hex === undefined && alias) hex = o.parts[alias];
    }
    if (hex === undefined) {
      const c = o.color ?? this.color;
      hex = typeof c === "function" ? c(info) : c;
    }
    const lin = hexToLinear(hex);
    const v = o.vary ?? 0;
    if (v > 0) {
      const k = 1 + this.rng.jitter(v);
      return [clamp01(lin[0] * k), clamp01(lin[1] * k), clamp01(lin[2] * k)];
    }
    return lin;
  }

  private pushTri(b: Bucket, p0: Vec3, p1: Vec3, p2: Vec3, col: Vec3): void {
    for (const p of [p0, p1, p2])
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2]))
        throw new Error(`MeshBuilder: non-finite vertex [${p.join(", ")}]`);
    const n = cross(sub(p1, p0), sub(p2, p0));
    const l = vlen(n);
    if (!(l > 1e-12)) {
      this.degenerate++;
      return;
    }
    const nx = n[0] / l,
      ny = n[1] / l,
      nz = n[2] / l;
    b.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    b.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    b.col.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  }

  private emit(faces: Face[], o: PrimOpts, center?: Vec3): this {
    if (!faces.length) return this;
    if (center) for (const f of faces) orientOut(f, center);
    let dy = 0;
    if (o.align === "bottom" || o.align === "top") {
      let lo = Infinity,
        hi = -Infinity;
      for (const f of faces)
        for (const p of f.pts) {
          lo = Math.min(lo, p[1]);
          hi = Math.max(hi, p[1]);
        }
      dy = o.align === "bottom" ? -lo : -hi;
    }
    const M = m4mul(this.top, m4trs(o.at, o.rot, o.scale));
    const flip = m4det3(M) < 0;
    const mat = o.mat ?? "solid";
    const bucket = this.bucket(mat, mat === "glow" ? (o.glow ?? 1) : 0);
    const groupColors = new Map<number, Vec3>();
    faces.forEach((f, index) => {
      const pts = dy ? f.pts.map((p) => [p[0], p[1] + dy, p[2]] as Vec3) : f.pts;
      let lin = f.group !== undefined ? groupColors.get(f.group) : undefined;
      if (!lin) {
        lin = this.resolveColor(
          { part: f.part, normal: norm(newell(pts)), center: centroid(pts), index },
          o,
          f.color,
        );
        if (f.group !== undefined) groupColors.set(f.group, lin);
      }
      const wp = pts.map((p) => m4point(M, p));
      const tris = f.tris ?? fan(pts.length);
      for (let t = 0; t < tris.length; t += 3) {
        const a = wp[tris[t]];
        const b = wp[tris[t + 1]];
        const c = wp[tris[t + 2]];
        if (flip) this.pushTri(bucket, a, c, b, lin);
        else this.pushTri(bucket, a, b, c, lin);
      }
    });
    return this;
  }

  /* ---------------- low-level faces (points in builder space, CCW seen from the front) */

  tri(a: Vec3, b: Vec3, c: Vec3, o: PrimOpts = {}): this {
    return this.emit([{ pts: [a, b, c], part: "tri" }], o);
  }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, o: PrimOpts = {}): this {
    return this.emit([{ pts: [a, b, c, d], part: "quad" }], o);
  }
  /** Convex planar polygon (fan triangulated), CCW seen from the front. */
  poly(pts: Vec3[], o: PrimOpts = {}): this {
    return this.emit([{ pts: pts.slice(), part: "poly" }], o);
  }

  /* ---------------- primitives (all centred on their local origin unless noted) */

  /**
   * Box centred at origin. chamfer (m) bevels all edges (44 tris instead of 12).
   * Parts: top, bottom, front(+z), back(-z), +x, -x, edge, corner.
   */
  box(o: PrimOpts & { size: Vec3 | number; chamfer?: number }): this {
    const s = toVec3(o.size);
    const h: Vec3 = [s[0] / 2, s[1] / 2, s[2] / 2];
    const c = Math.min(Math.max(o.chamfer ?? 0, 0), Math.min(h[0], h[1], h[2]) * 0.98);
    const partOf = (axis: number, sign: number) =>
      [["+x", "-x"], ["top", "bottom"], ["front", "back"]][axis][sign > 0 ? 0 : 1];
    const P = (axis: number, sg: number[]): Vec3 => {
      const p: Vec3 = [sg[0] * (h[0] - c), sg[1] * (h[1] - c), sg[2] * (h[2] - c)];
      p[axis] = sg[axis] * h[axis];
      return p;
    };
    const faces: Face[] = [];
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [1, -1]) {
        const u = (axis + 1) % 3;
        const v = (axis + 2) % 3;
        const pts: Vec3[] = [];
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const sg = [0, 0, 0];
          sg[axis] = sign;
          sg[u] = a;
          sg[v] = b;
          pts.push(P(axis, sg));
        }
        faces.push({ pts, part: partOf(axis, sign) });
      }
    if (c > 0) {
      for (const [a, b] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        const k = 3 - a - b;
        for (const sa of [1, -1])
          for (const sb of [1, -1]) {
            const sg = (sk: number) => {
              const g = [0, 0, 0];
              g[a] = sa;
              g[b] = sb;
              g[k] = sk;
              return g;
            };
            faces.push({ pts: [P(a, sg(-1)), P(a, sg(1)), P(b, sg(1)), P(b, sg(-1))], part: "edge" });
          }
      }
      for (const sx of [1, -1])
        for (const sy of [1, -1])
          for (const sz of [1, -1]) {
            const g = [sx, sy, sz];
            faces.push({ pts: [P(0, g), P(1, g), P(2, g)], part: "corner" });
          }
    }
    return this.emit(faces, o, [0, 0, 0]);
  }

  /**
   * Wedge / ramp with the box footprint `size`: full height at the back (-z), sloping down to
   * the front (+z). Parts: bottom, back, slope, +x, -x.
   */
  wedge(o: PrimOpts & { size: Vec3 | number }): this {
    const s = toVec3(o.size);
    const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const b0: Vec3 = [-hx, -hy, -hz],
      b1: Vec3 = [hx, -hy, -hz],
      b2: Vec3 = [hx, -hy, hz],
      b3: Vec3 = [-hx, -hy, hz],
      t0: Vec3 = [-hx, hy, -hz],
      t1: Vec3 = [hx, hy, -hz];
    return this.emit(
      [
        { pts: [b0, b1, b2, b3], part: "bottom" },
        { pts: [b0, b1, t1, t0], part: "back" },
        { pts: [t0, t1, b2, b3], part: "slope" },
        { pts: [b1, b2, t1], part: "+x" },
        { pts: [b0, b3, t0], part: "-x" },
      ],
      o,
      [0, -hy / 3, -hz / 3],
    );
  }

  /**
   * Cylinder / prism / frustum along Y, centred (y from -height/2 to +height/2).
   * radiusTop 0 makes a cone. phase rotates the polygon (deg). lean offsets the top centre [dx, dz].
   * caps: true (default) | false | "top" | "bottom". Parts: side, top, bottom.
   */
  cylinder(
    o: PrimOpts & {
      height: number;
      radius?: number;
      radiusTop?: number;
      radiusBottom?: number;
      sides?: number;
      caps?: boolean | "top" | "bottom";
      phase?: number;
      lean?: Vec2;
    },
  ): this {
    const n = Math.max(3, Math.round(o.sides ?? 8));
    const rb = o.radiusBottom ?? o.radius ?? 0.5;
    const rt = o.radiusTop ?? o.radius ?? 0.5;
    const hh = o.height / 2;
    const [lx, lz] = o.lean ?? [0, 0];
    const ph = (o.phase ?? 0) * DEG;
    const ring = (r: number, y: number, ox: number, oz: number) =>
      Array.from({ length: n }, (_, i) => {
        const a = ph + (i * 2 * Math.PI) / n;
        return [ox + Math.cos(a) * r, y, oz + Math.sin(a) * r] as Vec3;
      });
    const B = ring(rb, -hh, 0, 0);
    const T = ring(rt, hh, lx, lz);
    const faces: Face[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (rt <= 1e-9) faces.push({ pts: [B[i], B[j], T[i]], part: "side" });
      else if (rb <= 1e-9) faces.push({ pts: [B[i], T[j], T[i]], part: "side" });
      else faces.push({ pts: [B[i], B[j], T[j], T[i]], part: "side" });
    }
    const caps = o.caps ?? true;
    if ((caps === true || caps === "bottom") && rb > 1e-9) faces.push({ pts: B.slice(), part: "bottom" });
    if ((caps === true || caps === "top") && rt > 1e-9) faces.push({ pts: T.slice(), part: "top" });
    return this.emit(faces, o, [lx / 2, 0, lz / 2]);
  }
  /** Same as cylinder() with 6 sides by default. */
  prism(o: Parameters<MeshBuilder["cylinder"]>[0]): this {
    return this.cylinder({ sides: 6, ...o });
  }
  /** Cone along Y, centred (base at -height/2). Parts: side, bottom. */
  cone(
    o: PrimOpts & { radius: number; height: number; sides?: number; phase?: number; lean?: Vec2; cap?: boolean },
  ): this {
    return this.cylinder({
      ...o,
      radiusBottom: o.radius,
      radiusTop: 0,
      caps: o.cap === false ? false : "bottom",
    });
  }

  /**
   * Low-poly sphere (icosahedron, detail 0 = 20 tris, 1 = 80, 2 = 320) with optional radial
   * jitter. size gives an ellipsoid (diameters). Part: side.
   */
  icosphere(o: PrimOpts & { radius?: number; size?: Vec3 | number; detail?: number; jitter?: number }): this {
    const t = (1 + Math.sqrt(5)) / 2;
    const verts: Vec3[] = (
      [
        [-1, t, 0],
        [1, t, 0],
        [-1, -t, 0],
        [1, -t, 0],
        [0, -1, t],
        [0, 1, t],
        [0, -1, -t],
        [0, 1, -t],
        [t, 0, -1],
        [t, 0, 1],
        [-t, 0, -1],
        [-t, 0, 1],
      ] as Vec3[]
    ).map(norm);
    let tris: number[][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const detail = Math.min(3, Math.max(0, Math.round(o.detail ?? 0)));
    for (let d = 0; d < detail; d++) {
      const cache = new Map<string, number>();
      const mid = (a: number, b: number) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        let i = cache.get(key);
        if (i === undefined) {
          i = verts.length;
          verts.push(norm(scl(add(verts[a], verts[b]), 0.5)));
          cache.set(key, i);
        }
        return i;
      };
      const next: number[][] = [];
      for (const [a, b, c] of tris) {
        const ab = mid(a, b),
          bc = mid(b, c),
          ca = mid(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      tris = next;
    }
    const size = o.size !== undefined ? toVec3(o.size) : toVec3((o.radius ?? 0.5) * 2);
    const jit = o.jitter ?? 0;
    const pts = verts.map((v) => {
      const k = 1 + (jit ? this.rng.jitter(jit) : 0);
      return [(v[0] * k * size[0]) / 2, (v[1] * k * size[1]) / 2, (v[2] * k * size[2]) / 2] as Vec3;
    });
    return this.emit(
      tris.map(([a, b, c]) => ({ pts: [pts[a], pts[b], pts[c]], part: "side" })),
      o,
      [0, 0, 0],
    );
  }

  /**
   * Convex hull of points (any order). Coplanar triangles share one colour.
   * Parts: top (normal.y > 0.6), bottom (< -0.9), side.
   */
  hull(points: Vec3[], o: PrimOpts = {}): this {
    const tris = convexHull(points);
    const planes: { n: Vec3; d: number }[] = [];
    let lo = Infinity,
      hi = -Infinity;
    for (const p of points) {
      lo = Math.min(lo, p[0], p[1], p[2]);
      hi = Math.max(hi, p[0], p[1], p[2]);
    }
    const eps = Math.max(hi - lo, 1e-6) * 1e-5;
    const faces: Face[] = tris.map(([a, b, c]) => {
      const pa = points[a],
        pb = points[b],
        pc = points[c];
      const n = norm(cross(sub(pb, pa), sub(pc, pa)));
      const d = dot(n, pa);
      let group = planes.findIndex((p) => dot(p.n, n) > 1 - 1e-6 && Math.abs(p.d - d) < eps);
      if (group < 0) {
        group = planes.length;
        planes.push({ n, d });
      }
      return { pts: [pa, pb, pc], part: n[1] > 0.6 ? "top" : n[1] < -0.9 ? "bottom" : "side", group };
    });
    const used = new Set(tris.flat());
    return this.emit(faces, o, centroid([...used].map((i) => points[i])));
  }

  /**
   * Faceted rock: convex hull of `points` jittered points on an ellipsoid, rescaled so its
   * bounding box is exactly `size`. flat (0..0.9) cuts that fraction of the height off the
   * bottom (flat base). jitter (0..0.6) = irregularity. Parts: top, side, bottom.
   */
  rock(o: PrimOpts & { size: Vec3 | number; points?: number; jitter?: number; flat?: number }): this {
    const size = toVec3(o.size);
    const n = Math.max(6, Math.round(o.points ?? 12));
    const jit = Math.min(0.6, Math.max(0, o.jitter ?? 0.25));
    const flat = Math.min(0.9, Math.max(0, o.flat ?? 0));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const off = this.rng.next() * Math.PI * 2;
    const dj = 0.6 / Math.sqrt(n);
    let pts: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = off + i * golden;
      const d = norm([
        Math.cos(a) * r + this.rng.jitter(dj),
        y + this.rng.jitter(dj),
        Math.sin(a) * r + this.rng.jitter(dj),
      ]);
      pts.push(scl(d, 1 - jit * this.rng.next()));
    }
    if (flat > 0) {
      let lo = Infinity,
        hi = -Infinity;
      for (const p of pts) {
        lo = Math.min(lo, p[1]);
        hi = Math.max(hi, p[1]);
      }
      const cut = lo + flat * (hi - lo);
      pts = pts.map((p) => (p[1] < cut ? ([p[0], cut, p[2]] as Vec3) : p));
    }
    let mn: Vec3 = [Infinity, Infinity, Infinity];
    let mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts)
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], p[k]);
        mx[k] = Math.max(mx[k], p[k]);
      }
    pts = pts.map(
      (p) =>
        [0, 1, 2].map((k) => ((p[k] - (mn[k] + mx[k]) / 2) / Math.max(mx[k] - mn[k], 1e-9)) * size[k]) as Vec3,
    );
    return this.hull(pts, o);
  }

  /**
   * Slightly irregular plank: size = [length (x), thickness (y), width (z)], centred. Ends are cut
   * at small random angles and the width tapers a little (jitter, default 0.15). Faces stay planar.
   * Parts: top, bottom, side (long edges), end.
   */
  plank(o: PrimOpts & { size: Vec3; jitter?: number }): this {
    const [L, T, W] = o.size;
    const j = o.jitter ?? 0.15;
    const ends = [0, 1].map(() => ({ skew: this.rng.jitter(j) * W * 0.5, taper: 1 + this.rng.jitter(j * 0.5) }));
    const P = (e: number, sy: number, sz: number): Vec3 => {
      const end = ends[e < 0 ? 0 : 1];
      return [(e * L) / 2 + end.skew * sz, (sy * T) / 2, ((sz * W) / 2) * end.taper];
    };
    const faces: Face[] = [
      { pts: [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], part: "top" },
      { pts: [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], part: "bottom" },
      { pts: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], part: "side" },
      { pts: [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], part: "side" },
      { pts: [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], part: "end" },
      { pts: [P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1)], part: "end" },
    ];
    const all = faces.flatMap((f) => f.pts);
    return this.emit(faces, o, centroid(all));
  }

  /**
   * Tube / bar along a polyline (metal frames, rails, hoses, wheel rims). Mitred joints.
   * radius: number or one per point. sides default 6 (use sides 4 + phase 45 for a square bar
   * aligned to the axes). closed: loop back to the first point. caps default true for open
   * tubes. Ring vertex 0 points "up" (world +Y projected; +Z for vertical segments) before
   * phase. Parts: side, cap.
   */
  tube(
    points: Vec3[],
    o: PrimOpts & { radius: number | number[]; sides?: number; closed?: boolean; caps?: boolean; phase?: number },
  ): this {
    const P: Vec3[] = [];
    const R: number[] = [];
    points.forEach((p, i) => {
      const r = Array.isArray(o.radius) ? (o.radius[i] ?? o.radius[o.radius.length - 1]) : o.radius;
      if (P.length && vlen(sub(p, P[P.length - 1])) < 1e-9) return;
      P.push(p);
      R.push(r);
    });
    const closed = !!o.closed && P.length > 2;
    if (closed && vlen(sub(P[0], P[P.length - 1])) < 1e-9) {
      P.pop();
      R.pop();
    }
    const n = P.length;
    if (n < 2) throw new Error("tube needs at least 2 distinct points");
    const sides = Math.max(3, Math.round(o.sides ?? 6));
    const segs = closed ? n : n - 1;
    const dirs: Vec3[] = [];
    for (let i = 0; i < segs; i++) dirs.push(norm(sub(P[(i + 1) % n], P[i])));
    const N: Vec3[] = [perpendicular(dirs[0])];
    for (let i = 1; i < segs; i++) N.push(norm(rotateBetween(N[i - 1], dirs[i - 1], dirs[i])));
    let twist = 0;
    if (closed) {
      const nEnd = norm(rotateBetween(N[segs - 1], dirs[segs - 1], dirs[0]));
      twist = Math.atan2(dot(cross(N[0], nEnd), dirs[0]), dot(N[0], nEnd));
    }
    const ph = (o.phase ?? 0) * DEG;
    const offsets = (seg: number, r: number): Vec3[] => {
      const d = dirs[seg];
      const n0 = N[seg];
      const b = cross(d, n0);
      const corr = closed ? (-twist * seg) / segs : 0;
      return Array.from({ length: sides }, (_, k) => {
        const a = ph + corr + (k * 2 * Math.PI) / sides;
        return scl(add(scl(n0, Math.cos(a)), scl(b, Math.sin(a))), r);
      });
    };
    const rings: Vec3[][] = [];
    for (let j = 0; j < n; j++) {
      const r = R[j];
      if (!closed && j === 0) {
        rings.push(offsets(0, r).map((o2) => add(P[0], o2)));
        continue;
      }
      if (!closed && j === n - 1) {
        rings.push(offsets(segs - 1, r).map((o2) => add(P[j], o2)));
        continue;
      }
      const inSeg = (j - 1 + segs) % segs;
      const dIn = dirs[inSeg];
      const dOut = dirs[j % segs];
      let m = add(dIn, dOut);
      m = vlen(m) < 1e-6 ? dIn : norm(m);
      const denom = dot(dIn, m);
      rings.push(
        offsets(inSeg, r).map((o2) => {
          const t = Math.max(-3 * r, Math.min(3 * r, -dot(o2, m) / denom));
          return add(add(P[j], o2), scl(dIn, t));
        }),
      );
    }
    const faces: Face[] = [];
    for (let i = 0; i < segs; i++) {
      const A = rings[i];
      const B = rings[(i + 1) % n];
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const f: Face = { pts: [A[k], A[k1], B[k1], B[k]], part: "side" };
        const c = centroid(f.pts);
        const axisPt = add(P[i], scl(dirs[i], dot(sub(c, P[i]), dirs[i])));
        faces.push(orientTo(f, sub(c, axisPt)));
      }
    }
    if (!closed && (o.caps ?? true)) {
      faces.push(orientTo({ pts: rings[0].slice(), part: "cap" }, scl(dirs[0], -1)));
      faces.push(orientTo({ pts: rings[n - 1].slice(), part: "cap" }, dirs[segs - 1]));
    }
    return this.emit(faces, o);
  }

  /**
   * Ring / annulus sector in the XY plane (axis = Z), centred, thickness `depth` along Z.
   * inner 0 = solid disc. start/end in degrees (0 = +X, CCW). For a wheel standing in the
   * YZ plane use rot: [0, 90, 0]. Parts: front(+z), back(-z), outer, inner, cap.
   */
  ring(
    o: PrimOpts & { radius: number; inner?: number; depth: number; start?: number; end?: number; segments?: number },
  ): this {
    const R = o.radius;
    const r = Math.max(0, o.inner ?? 0);
    const hd = o.depth / 2;
    const a0 = o.start ?? 0;
    const a1 = o.end ?? 360;
    const full = Math.abs(a1 - a0) >= 359.999;
    const seg = Math.max(3, Math.round(o.segments ?? 16));
    const ang = Array.from({ length: seg + 1 }, (_, i) => (a0 + ((a1 - a0) * i) / seg) * DEG);
    const at = (rad: number, a: number, z: number): Vec3 => [Math.cos(a) * rad, Math.sin(a) * rad, z];
    const faces: Face[] = [];
    for (let i = 0; i < seg; i++) {
      const a = ang[i],
        b = ang[i + 1],
        m = (a + b) / 2;
      const hasInner = r > 1e-9;
      const front: Vec3[] = hasInner
        ? [at(R, a, hd), at(R, b, hd), at(r, b, hd), at(r, a, hd)]
        : [at(R, a, hd), at(R, b, hd), [0, 0, hd]];
      faces.push(orientTo({ pts: front, part: "front" }, [0, 0, 1]));
      if (hd > 0) {
        const back: Vec3[] = hasInner
          ? [at(R, a, -hd), at(R, b, -hd), at(r, b, -hd), at(r, a, -hd)]
          : [at(R, a, -hd), at(R, b, -hd), [0, 0, -hd]];
        faces.push(orientTo({ pts: back, part: "back" }, [0, 0, -1]));
        faces.push(
          orientTo(
            { pts: [at(R, a, -hd), at(R, b, -hd), at(R, b, hd), at(R, a, hd)], part: "outer" },
            [Math.cos(m), Math.sin(m), 0],
          ),
        );
        if (hasInner)
          faces.push(
            orientTo(
              { pts: [at(r, a, -hd), at(r, b, -hd), at(r, b, hd), at(r, a, hd)], part: "inner" },
              [-Math.cos(m), -Math.sin(m), 0],
            ),
          );
      }
    }
    if (!full && hd > 0) {
      const dirSign = a1 > a0 ? 1 : -1;
      for (const [a, s] of [
        [ang[0], -dirSign],
        [ang[seg], dirSign],
      ] as const) {
        faces.push(
          orientTo({ pts: [at(R, a, -hd), at(R, a, hd), at(r, a, hd), at(r, a, -hd)], part: "cap" }, [
            -Math.sin(a) * s,
            Math.cos(a) * s,
            0,
          ]),
        );
      }
    }
    return this.emit(faces, o);
  }

  private extrudeFaces(shape: Vec2[], depth: number, back: boolean, sides: boolean): Face[] {
    const poly = cleanPolygon(shape);
    if (poly.length < 3) throw new Error("extrude: polygon needs at least 3 distinct points");
    if (signedArea(poly) < 0) poly.reverse();
    const tris = earClip(poly);
    const faces: Face[] = [{ pts: poly.map(([x, y]) => [x, y, depth] as Vec3), tris, part: "front" }];
    if (depth > 0) {
      if (back) {
        const bf: Face = { pts: poly.map(([x, y]) => [x, y, 0] as Vec3), tris: tris.slice(), part: "back" };
        flipFace(bf);
        faces.push(bf);
      }
      if (sides)
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          faces.push({
            pts: [
              [a[0], a[1], 0],
              [b[0], b[1], 0],
              [b[0], b[1], depth],
              [a[0], a[1], depth],
            ],
            part: "side",
          });
        }
    }
    return faces;
  }

  /**
   * Extrude a simple 2D polygon (XY plane, any winding, concave OK, no holes) along +Z:
   * back face at z = 0, front face at z = depth (faces +Z). depth 0 = single flat front face
   * (a decal). back: false skips the back face (wall-mounted). Parts: front, back, side.
   */
  extrude(shape: Vec2[], o: PrimOpts & { depth?: number; back?: boolean; sides?: boolean }): this {
    return this.emit(this.extrudeFaces(shape, Math.max(0, o.depth ?? 0.02), o.back ?? true, o.sides ?? true), o);
  }

  /**
   * The approved emblem (see emblemShapes), `height` metres tall, centred at the origin in the
   * XY plane, extruded `depth` (default 0 = flat decal) toward +Z. Use a small at-offset
   * (~0.002 m) in front of the surface it sits on. Parts: front, back, side.
   */
  emblem(o: PrimOpts & { height: number; depth?: number; back?: boolean }): this {
    const k = o.height;
    const d = Math.max(0, o.depth ?? 0);
    const faces = emblemShapes().flatMap((s) =>
      this.extrudeFaces(
        s.map(([x, y]) => [x * k, y * k] as Vec2),
        d,
        o.back ?? false,
        true,
      ),
    );
    return this.emit(faces, o);
  }

  /**
   * Thin cloth sheet in the XZ plane (front faces +Y), centred, default material "cloth"
   * (double-sided). Grid cells are flat faces.
   * - size [width x, length z]; seg [nx, nz] (default ~0.3 m cells)
   * - sag (m) with pin: "corners" (tied at 4 corners, default) | "x" (supported along the two
   *   x-edges, sags between) | "z" | "none"; noise (m) random vertex jitter
   * - holes: number of random interior holes; tear (0..1) ragged edges on tearEdges
   *   (any of "+x -x +z -z", default all)
   * - patches: count of sewn-on rectangular patches coloured patchColor (default PALETTE.worn)
   * - displace(x, z, u, v) => extra y offset (u, v in 0..1) for custom drapes
   * Parts: cloth, patch.
   */
  cloth(
    o: PrimOpts & {
      size: Vec2;
      seg?: [number, number];
      sag?: number;
      pin?: "corners" | "x" | "z" | "none";
      noise?: number;
      holes?: number;
      tear?: number;
      tearEdges?: string;
      patches?: number;
      patchColor?: Color | Color[];
      displace?: (x: number, z: number, u: number, v: number) => number;
    },
  ): this {
    const [W, D] = o.size;
    const nx = Math.max(1, Math.round(o.seg?.[0] ?? Math.max(2, W / 0.3)));
    const nz = Math.max(1, Math.round(o.seg?.[1] ?? Math.max(2, D / 0.3)));
    const sag = o.sag ?? 0;
    const pin = o.pin ?? "corners";
    const noise = o.noise ?? 0;
    const rng = this.rng;
    const s = (t: number) => 1 - (2 * t - 1) ** 2;
    const V: Vec3[][] = [];
    for (let i = 0; i <= nx; i++) {
      V.push([]);
      for (let j = 0; j <= nz; j++) {
        const u = i / nx,
          v = j / nz;
        let x = -W / 2 + W * u;
        let z = -D / 2 + D * v;
        let y = 0;
        if (sag) y -= sag * (pin === "corners" ? (s(u) + s(v)) / 2 : pin === "x" ? s(u) : pin === "z" ? s(v) : 0);
        const corner = (i === 0 || i === nx) && (j === 0 || j === nz);
        if (noise && !(pin === "corners" && corner)) {
          y += rng.jitter(noise);
          x += rng.jitter(noise * 0.5);
          z += rng.jitter(noise * 0.5);
        }
        if (o.displace) y += o.displace(x, z, u, v);
        V[i].push([x, y, z]);
      }
    }
    const id = (i: number, j: number) => i * nz + j;
    const removed = new Set<number>();
    const half = new Map<number, 0 | 1>();
    for (let h = 0; h < (o.holes ?? 0) && nx >= 3 && nz >= 3; h++) {
      const i = rng.int(1, nx - 2);
      const j = rng.int(1, nz - 2);
      removed.add(id(i, j));
      if (rng.chance(0.5)) {
        const i2 = Math.min(nx - 2, Math.max(1, i + rng.int(-1, 1)));
        const j2 = Math.min(nz - 2, Math.max(1, j + rng.int(-1, 1)));
        half.set(id(i2, j2), rng.int(0, 1) as 0 | 1);
      }
    }
    const tear = o.tear ?? 0;
    if (tear > 0) {
      const edges = o.tearEdges ?? "+x -x +z -z";
      const onEdge = (i: number, j: number, ring: number) =>
        (edges.includes("-x") && i === ring) ||
        (edges.includes("+x") && i === nx - 1 - ring) ||
        (edges.includes("-z") && j === ring) ||
        (edges.includes("+z") && j === nz - 1 - ring);
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          if (onEdge(i, j, 0)) {
            if (rng.chance(tear * 0.5)) removed.add(id(i, j));
            else if (rng.chance(tear * 0.6)) half.set(id(i, j), rng.int(0, 1) as 0 | 1);
          } else if (onEdge(i, j, 1) && rng.chance(tear * 0.2)) half.set(id(i, j), rng.int(0, 1) as 0 | 1);
        }
    }
    const patchCells = new Map<number, Color>();
    const pc = o.patchColor ?? PALETTE.worn;
    const patchColors = Array.isArray(pc) ? pc : [pc];
    for (let p = 0; p < (o.patches ?? 0); p++) {
      const w = Math.min(nx, rng.int(1, 2));
      const h = Math.min(nz, rng.int(1, 2));
      const i0 = rng.int(0, nx - w);
      const j0 = rng.int(0, nz - h);
      for (let i = i0; i < i0 + w; i++)
        for (let j = j0; j < j0 + h; j++) patchCells.set(id(i, j), patchColors[p % patchColors.length]);
    }
    const faces: Face[] = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const cid = id(i, j);
        if (removed.has(cid)) continue;
        const a = V[i][j],
          b = V[i + 1][j],
          c = V[i + 1][j + 1],
          d = V[i][j + 1];
        const t: Vec3[][] = (i + j) % 2 ? [[a, d, b], [b, d, c]] : [[a, d, c], [a, c, b]];
        const keep = half.get(cid);
        const tris = keep === undefined ? t : [t[keep]];
        const patch = patchCells.get(cid);
        for (const tri of tris) faces.push({ pts: tri, part: patch ? "patch" : "cloth", group: cid, color: patch });
      }
    return this.emit(faces, { mat: "cloth", ...o });
  }

  /**
   * Blocky pixel text (5x7 font, see FONT_CHARS), in the XY plane facing +Z.
   * pixel = size of one font pixel (m). depth 0 = flat quads at z=0 (2 tris per block);
   * depth > 0 = blocks from z=0 to z=depth (back faces only if back: true).
   * align (x): left | center (default) | right; valign (y): top | middle (default) | bottom.
   * spacing/lineGap in font pixels (default 1 / 2). italic = shear factor (e.g. 0.2).
   * Text is upper-cased and Vietnamese accents are stripped. Parts: front, side, back.
   */
  text(
    str: string,
    o: Omit<PrimOpts, "align"> & {
      pixel: number;
      depth?: number;
      align?: "left" | "center" | "right";
      valign?: "top" | "middle" | "bottom";
      spacing?: number;
      lineGap?: number;
      italic?: number;
      back?: boolean;
    },
  ): this {
    const px = o.pixel;
    const sp = o.spacing ?? 1;
    const lg = o.lineGap ?? 2;
    const depth = Math.max(0, o.depth ?? 0);
    const italic = o.italic ?? 0;
    const lines = normalizeText(str).split("\n");
    const m = measureText(str, { pixel: px, spacing: sp, lineGap: lg });
    const align = o.align ?? "center";
    const valign = o.valign ?? "middle";
    const blockLeft = align === "left" ? 0 : align === "right" ? -m.width : -m.width / 2;
    const blockTop = valign === "top" ? 0 : valign === "bottom" ? m.height : m.height / 2;
    const faces: Face[] = [];
    lines.forEach((line, li) => {
      const lw = line.length ? (line.length * 5 + (line.length - 1) * sp) * px : 0;
      const lineLeft =
        blockLeft + (align === "left" ? 0 : align === "right" ? m.width - lw : (m.width - lw) / 2);
      const lineTop = blockTop - li * (7 + lg) * px;
      const base = lineTop - 7 * px;
      [...line].forEach((ch, ci) => {
        for (const [gx, gy, gw, gh] of glyphRects(ch)) {
          const x0 = lineLeft + (ci * (5 + sp) + gx) * px;
          const x1 = x0 + gw * px;
          const y1 = lineTop - gy * px;
          const y0 = y1 - gh * px;
          const P = (x: number, y: number, z: number): Vec3 => [x + italic * (y - base), y, z];
          faces.push({ pts: [P(x0, y0, depth), P(x1, y0, depth), P(x1, y1, depth), P(x0, y1, depth)], part: "front" });
          if (depth > 0) {
            const sidesQ: [Vec3[], Vec3][] = [
              [[P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, depth), P(x0, y0, depth)], [0, -1, 0]],
              [[P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, depth), P(x0, y1, depth)], [0, 1, 0]],
              [[P(x0, y0, 0), P(x0, y1, 0), P(x0, y1, depth), P(x0, y0, depth)], [-1, 0, 0]],
              [[P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, depth), P(x1, y0, depth)], [1, 0, 0]],
            ];
            for (const [pts, dir] of sidesQ) faces.push(orientTo({ pts, part: "side" }, dir));
            if (o.back)
              faces.push({ pts: [P(x0, y0, 0), P(x0, y1, 0), P(x1, y1, 0), P(x1, y0, 0)], part: "back" });
          }
        }
      });
    });
    return this.emit(faces, { ...o, align: undefined });
  }

  /** Append another builder's triangles (optionally placed). Colours/materials are kept. */
  add(other: MeshBuilder, o: { at?: Vec3; rot?: Vec3; scale?: number | Vec3 } = {}): this {
    const M = m4mul(this.top, m4trs(o.at, o.rot, o.scale));
    const flip = m4det3(M) < 0;
    for (const b of other.buckets.values()) {
      const dst = this.bucket(b.mat, b.glow);
      for (let t = 0; t < b.pos.length; t += 9) {
        const p0 = m4point(M, [b.pos[t], b.pos[t + 1], b.pos[t + 2]]);
        const p1 = m4point(M, [b.pos[t + 3], b.pos[t + 4], b.pos[t + 5]]);
        const p2 = m4point(M, [b.pos[t + 6], b.pos[t + 7], b.pos[t + 8]]);
        const col: Vec3 = [b.col[t], b.col[t + 1], b.col[t + 2]];
        if (flip) this.pushTri(dst, p0, p2, p1, col);
        else this.pushTri(dst, p0, p1, p2, col);
      }
    }
    return this;
  }

  /* ---------------- queries */

  get triangleCount(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 9;
    return n;
  }
  /** Triangle count per material name (tl_matte, tl_cloth, tl_glow…). */
  trianglesByMaterial(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, b] of this.buckets) if (b.pos.length) out[k] = b.pos.length / 9;
    return out;
  }
  /** Bounds in builder space, or null when empty. */
  bounds(): { min: Vec3; max: Vec3 } | null {
    const mn: Vec3 = [Infinity, Infinity, Infinity];
    const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const b of this.buckets.values())
      for (let i = 0; i < b.pos.length; i += 3) {
        any = true;
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], b.pos[i + k]);
          mx[k] = Math.max(mx[k], b.pos[i + k]);
        }
      }
    return any ? { min: mn, max: mx } : null;
  }
  /** @internal Raw triangle buckets (used by the GLB writer). */
  _buckets(): Bucket[] {
    return [...this.buckets.values()].filter((b) => b.pos.length > 0);
  }
}

/* =========================================================================================
 * Model / node hierarchy
 * ========================================================================================= */

export interface NodeOpts {
  /** Local translation (the joint / pivot position relative to the parent). */
  at?: Vec3;
  /** Local rest rotation, euler degrees (PlayCanvas order). */
  rot?: Vec3;
  scale?: number | Vec3;
}
/** Point light hint stored in the manifest (gallery shows it; runtime may create it). */
export interface LightDef {
  name?: string;
  /** Model-space position. */
  at: Vec3;
  color: Color;
  /** PlayCanvas omni intensity (default 1.5). */
  intensity?: number;
  /** Range in metres (default 5). */
  range?: number;
}
/** node name -> local euler degrees, or {rot, at}. Absolute (replaces the rest values). */
export type PoseDef = Record<string, Vec3 | { rot?: Vec3; at?: Vec3 }>;
export type ColliderDef =
  | { type: "box"; center: Vec3; size: Vec3 }
  | { type: "cylinder"; center: Vec3; radius: number; height: number }
  | { type: "capsule"; center: Vec3; radius: number; height: number };

export class ModelNode {
  readonly name: string;
  at: Vec3;
  rot: Vec3;
  scale: Vec3;
  readonly children: ModelNode[] = [];
  /** Geometry in THIS node's local space (origin = the node's pivot/joint). */
  readonly geo: MeshBuilder;
  readonly parent?: ModelNode;
  private readonly model: Model;

  /** @internal use Model.node() / ModelNode.child() */
  constructor(model: Model, name: string, parent: ModelNode | undefined, opts: NodeOpts) {
    this.model = model;
    this.name = name;
    this.parent = parent;
    this.at = opts.at ?? [0, 0, 0];
    this.rot = opts.rot ?? [0, 0, 0];
    this.scale = opts.scale === undefined ? [1, 1, 1] : toVec3(opts.scale);
    this.geo = new MeshBuilder(`${model.rng.seed}/${name}`);
  }
  /** Create a child node (names must be unique within the model). */
  child(name: string, opts: NodeOpts = {}): ModelNode {
    this.model._registerNodeName(name);
    const c = new ModelNode(this.model, name, this, opts);
    this.children.push(c);
    return c;
  }
  find(name: string): ModelNode | undefined {
    if (this.name === name) return this;
    for (const c of this.children) {
      const f = c.find(name);
      if (f) return f;
    }
    return undefined;
  }
  /** Depth-first, parents before children. */
  walk(fn: (node: ModelNode, depth: number) => void, depth = 0): void {
    fn(this, depth);
    for (const c of this.children) c.walk(fn, depth + 1);
  }
  /** Local TRS matrix. */
  _local(): Mat4 {
    return m4trs(this.at, this.rot, this.scale);
  }
}

export interface ModelOpts {
  /** Default: the asset name (so every asset has its own deterministic stream). */
  seed?: number | string;
  notes?: string;
  /** Triangle budget (default from category, see DEFAULT_BUDGETS). */
  budget?: number;
}
export interface ModelStats {
  triangles: number;
  trianglesByMaterial: Record<string, number>;
  bounds: { min: Vec3; max: Vec3 };
  nodes: string[];
  emissive: { node: string; material: string; strength: number; triangles: number }[];
  materials: string[];
  degenerate: number;
}

/** Default triangle budgets by name category (tl_<category>_...). Override with ModelOpts.budget. */
export const DEFAULT_BUDGETS: Record<string, number> = {
  char: 2500,
  prop: 500,
  fx: 500,
  furn: 500,
  sign: 500,
  veh: 2000,
  env: 3000,
  rock: 3000,
  cave: 20000,
};
export const NAME_PATTERN = /^tl_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*_v\d{2}$/;

export class Model {
  readonly name: string;
  readonly root: ModelNode;
  readonly rng: Rng;
  notes: string;
  budget: number;
  /** Named model-space points for the runtime (seat height, screen centre, hand grip…). */
  anchors: Record<string, Vec3> = {};
  lights: LightDef[] = [];
  poses: Record<string, PoseDef> = {};
  collider?: ColliderDef;
  /** Free-form JSON metadata copied to the manifest. */
  meta: Record<string, unknown> = {};
  private nodeNames = new Set<string>();

  constructor(name: string, opts: ModelOpts = {}) {
    if (!NAME_PATTERN.test(name))
      throw new Error(`asset name "${name}" must match tl_<category>_<name>_v01 (lower-case a-z, 0-9, _)`);
    this.name = name;
    this.rng = new Rng(opts.seed ?? name);
    this.notes = opts.notes ?? "";
    const category = name.split("_")[1];
    this.budget = opts.budget ?? DEFAULT_BUDGETS[category] ?? 3000;
    this.nodeNames.add(name);
    this.root = new ModelNode(this, name, undefined, {});
  }
  /** Root geometry (most props only need this). */
  get geo(): MeshBuilder {
    return this.root.geo;
  }
  /** Child of the root node. */
  node(name: string, opts: NodeOpts = {}): ModelNode {
    return this.root.child(name, opts);
  }
  find(name: string): ModelNode | undefined {
    return this.root.find(name);
  }
  anchor(name: string, at: Vec3): this {
    this.anchors[name] = at;
    return this;
  }
  light(def: LightDef): this {
    this.lights.push(def);
    return this;
  }
  pose(name: string, def: PoseDef): this {
    for (const n of Object.keys(def))
      if (!this.nodeNames.has(n)) throw new Error(`${this.name}: pose "${name}" references unknown node "${n}"`);
    this.poses[name] = def;
    return this;
  }
  /** @internal */
  _registerNodeName(name: string): void {
    if (!name || this.nodeNames.has(name)) throw new Error(`${this.name}: duplicate or empty node name "${name}"`);
    this.nodeNames.add(name);
  }
  /** Model-space position (rest pose) of a point given in `nodeName`'s local space. */
  worldPoint(nodeName: string, local: Vec3 = [0, 0, 0]): Vec3 {
    const n = this.find(nodeName);
    if (!n) throw new Error(`${this.name}: unknown node "${nodeName}"`);
    const W = this.worldMatrices().get(n);
    return W ? m4point(W, local) : local;
  }
  /** World (model-space) rest matrices of every node. */
  private worldMatrices(): Map<ModelNode, Mat4> {
    const out = new Map<ModelNode, Mat4>();
    const visit = (n: ModelNode, parent: Mat4) => {
      const w = m4mul(parent, n._local());
      out.set(n, w);
      for (const c of n.children) visit(c, w);
    };
    visit(this.root, m4());
    return out;
  }
  stats(): ModelStats {
    const mats = this.worldMatrices();
    const mn: Vec3 = [Infinity, Infinity, Infinity];
    const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    const byMat: Record<string, number> = {};
    const emissive: ModelStats["emissive"] = [];
    const nodes: string[] = [];
    let triangles = 0;
    let degenerate = 0;
    this.root.walk((n) => {
      nodes.push(n.name);
      degenerate += n.geo.degenerate;
      const W = mats.get(n)!;
      for (const b of n.geo._buckets()) {
        const name = materialName(b.mat, b.glow);
        const t = b.pos.length / 9;
        triangles += t;
        byMat[name] = (byMat[name] ?? 0) + t;
        if (b.mat === "glow") emissive.push({ node: n.name, material: name, strength: b.glow, triangles: t });
        for (let i = 0; i < b.pos.length; i += 3) {
          const p = m4point(W, [b.pos[i], b.pos[i + 1], b.pos[i + 2]]);
          for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], p[k]);
            mx[k] = Math.max(mx[k], p[k]);
          }
        }
      }
    });
    return {
      triangles,
      trianglesByMaterial: byMat,
      bounds: triangles ? { min: mn, max: mx } : { min: [0, 0, 0], max: [0, 0, 0] },
      nodes,
      emissive,
      materials: Object.keys(byMat).sort(),
      degenerate,
    };
  }
}

/* =========================================================================================
 * GLB export
 * ========================================================================================= */

/** Writes arbitrary per-material extension JSON (gltf-transform core has no KHR_* classes). */
abstract class RawMaterialExtension extends Extension {
  readonly data = new Map<Material, Record<string, unknown>>();
  read(_context: ReaderContext): this {
    return this;
  }
  write(context: WriterContext): this {
    const json = context.jsonDoc.json;
    for (const [mat, def] of this.data) {
      const i = context.materialIndexMap.get(mat);
      if (i === undefined || !json.materials?.[i]) continue;
      const m = json.materials[i];
      m.extensions = { ...(m.extensions ?? {}), [this.extensionName]: def };
    }
    return this;
  }
}
class KhrMaterialsUnlit extends RawMaterialExtension {
  static EXTENSION_NAME = "KHR_materials_unlit";
  readonly extensionName = "KHR_materials_unlit";
}
class KhrMaterialsEmissiveStrength extends RawMaterialExtension {
  static EXTENSION_NAME = "KHR_materials_emissive_strength";
  readonly extensionName = "KHR_materials_emissive_strength";
}

/** Merge identical (position, normal, colour) vertices; returns indexed arrays. */
function weld(b: Bucket) {
  const map = new Map<string, number>();
  const P: number[] = [],
    N: number[] = [],
    C: number[] = [],
    I: number[] = [];
  const q = (x: number, s: number) => Math.round(x * s);
  for (let v = 0; v < b.pos.length / 3; v++) {
    const o = v * 3;
    const key =
      `${q(b.pos[o], 1e5)},${q(b.pos[o + 1], 1e5)},${q(b.pos[o + 2], 1e5)},` +
      `${q(b.nrm[o], 1e4)},${q(b.nrm[o + 1], 1e4)},${q(b.nrm[o + 2], 1e4)},` +
      `${q(b.col[o], 1e4)},${q(b.col[o + 1], 1e4)},${q(b.col[o + 2], 1e4)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = P.length / 3;
      map.set(key, idx);
      P.push(b.pos[o], b.pos[o + 1], b.pos[o + 2]);
      N.push(b.nrm[o], b.nrm[o + 1], b.nrm[o + 2]);
      C.push(b.col[o], b.col[o + 1], b.col[o + 2]);
    }
    I.push(idx);
  }
  return { P, N, C, I };
}

/** Builds the GLB bytes for a model (does not write files). */
export async function exportGlb(model: Model): Promise<{ glb: Uint8Array; stats: ModelStats }> {
  const stats = model.stats();
  if (!stats.triangles) throw new Error(`${model.name}: model has no geometry`);
  const doc = new Document();
  doc.getRoot().getAsset().generator = "te-liet tools/models";
  const buffer = doc.createBuffer();
  const materials = new Map<string, Material>();
  let unlit: KhrMaterialsUnlit | undefined;
  let strength: KhrMaterialsEmissiveStrength | undefined;
  const material = (mat: MatKind, glow: number): Material => {
    const name = materialName(mat, glow);
    let m = materials.get(name);
    if (m) return m;
    m = doc
      .createMaterial(name)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(mat === "glow" ? 1 : ROUGHNESS)
      .setDoubleSided(mat === "cloth");
    if (mat === "glow") {
      unlit ??= doc.createExtension(KhrMaterialsUnlit);
      unlit.data.set(m, {});
      if (glow !== 1) {
        strength ??= doc.createExtension(KhrMaterialsEmissiveStrength);
        strength.data.set(m, { emissiveStrength: glow });
      }
    }
    materials.set(name, m);
    return m;
  };
  const toGltf = (n: ModelNode): GltfNode => {
    const g = doc.createNode(n.name);
    if (n.at.some((v) => v !== 0)) g.setTranslation([...n.at]);
    if (n.rot.some((v) => v !== 0)) g.setRotation(eulerToQuat(n.rot));
    if (n.scale.some((v) => v !== 1)) g.setScale([...n.scale]);
    const buckets = n.geo._buckets();
    if (buckets.length) {
      const mesh = doc.createMesh(n.name);
      for (const b of buckets) {
        const { P, N, C, I } = weld(b);
        const prim = doc
          .createPrimitive()
          .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(P)).setBuffer(buffer))
          .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(N)).setBuffer(buffer))
          .setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(new Float32Array(C)).setBuffer(buffer))
          .setIndices(
            doc
              .createAccessor()
              .setType("SCALAR")
              .setArray(P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I))
              .setBuffer(buffer),
          )
          .setMaterial(material(b.mat, b.glow));
        mesh.addPrimitive(prim);
      }
      g.setMesh(mesh);
    }
    for (const c of n.children) g.addChild(toGltf(c));
    return g;
  };
  const scene = doc.createScene(model.name).addChild(toGltf(model.root));
  doc.getRoot().setDefaultScene(scene);
  const io = new NodeIO().registerExtensions([KhrMaterialsUnlit, KhrMaterialsEmissiveStrength]);
  const glb = await io.writeBinary(doc);
  return { glb, stats };
}

/* =========================================================================================
 * Output: GLBs + per-group manifest
 * ========================================================================================= */

export const GROUPS = ["environment", "fire", "furniture", "props", "characters", "caves", "login"] as const;
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MODELS_DIR = path.join(REPO_ROOT, "apps/web/public/models");

export interface ManifestAsset {
  name: string;
  /** Relative to /models/, e.g. "props/tl_prop_crate_v01.glb". */
  file: string;
  /** URL served by Vite / the production build. */
  url: string;
  triangles: number;
  trianglesByMaterial: Record<string, number>;
  budget: number;
  overBudget: boolean;
  bounds: { min: Vec3; max: Vec3 };
  size: Vec3;
  nodes: string[];
  emissive: ModelStats["emissive"];
  materials: string[];
  notes: string;
  anchors: Record<string, Vec3>;
  lights: LightDef[];
  poses: Record<string, PoseDef>;
  collider?: ColliderDef;
  meta: Record<string, unknown>;
  bytes: number;
}
export interface Manifest {
  group: string;
  version: 1;
  generator: string;
  assets: ManifestAsset[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
const r4v = (v: Vec3): Vec3 => [r4(v[0]), r4(v[1]), r4(v[2])];

function atomicWrite(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/**
 * Exports every model to apps/web/public/models/<group>/<name>.glb, removes stale GLBs of that
 * group, and writes apps/web/public/models/manifest.<group>.json. Prints warnings for budgets
 * and pivots. Only touches this group's folder + manifest (safe for parallel agents).
 */
export async function writeAssets(
  group: string,
  assets: Model[],
  opts: { outDir?: string; quiet?: boolean } = {},
): Promise<Manifest> {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(group)) throw new Error(`bad group name "${group}"`);
  const root = opts.outDir ?? MODELS_DIR;
  const dir = path.join(root, group);
  mkdirSync(dir, { recursive: true });
  const seen = new Set<string>();
  const log = (s: string) => {
    if (!opts.quiet) console.log(s);
  };
  const entries: ManifestAsset[] = [];
  for (const m of assets) {
    if (!(m instanceof Model)) throw new Error(`${group}: writeAssets expects Model instances`);
    if (seen.has(m.name)) throw new Error(`${group}: duplicate asset name ${m.name}`);
    seen.add(m.name);
    const { glb, stats } = await exportGlb(m);
    atomicWrite(path.join(dir, `${m.name}.glb`), glb);
    const size = r4v([
      stats.bounds.max[0] - stats.bounds.min[0],
      stats.bounds.max[1] - stats.bounds.min[1],
      stats.bounds.max[2] - stats.bounds.min[2],
    ]);
    const entry: ManifestAsset = {
      name: m.name,
      file: `${group}/${m.name}.glb`,
      url: `/models/${group}/${m.name}.glb`,
      triangles: stats.triangles,
      trianglesByMaterial: stats.trianglesByMaterial,
      budget: m.budget,
      overBudget: stats.triangles > m.budget,
      bounds: { min: r4v(stats.bounds.min), max: r4v(stats.bounds.max) },
      size,
      nodes: stats.nodes,
      emissive: stats.emissive,
      materials: stats.materials,
      notes: m.notes,
      anchors: Object.fromEntries(Object.entries(m.anchors).map(([k, v]) => [k, r4v(v)])),
      lights: m.lights.map((l) => ({ ...l, at: r4v(l.at) })),
      poses: m.poses,
      ...(m.collider ? { collider: m.collider } : {}),
      meta: m.meta,
      bytes: glb.byteLength,
    };
    entries.push(entry);
    const warn: string[] = [];
    if (entry.overBudget) warn.push(`OVER BUDGET ${stats.triangles}/${m.budget} tris`);
    if (Math.abs(stats.bounds.min[1]) > 0.02) warn.push(`min y = ${r4(stats.bounds.min[1])} (pivot should be at the bottom)`);
    const cx = (stats.bounds.min[0] + stats.bounds.max[0]) / 2;
    const cz = (stats.bounds.min[2] + stats.bounds.max[2]) / 2;
    if (Math.abs(cx) > Math.max(0.05, size[0] * 0.15) || Math.abs(cz) > Math.max(0.05, size[2] * 0.15))
      warn.push(`bounds centre x/z = ${r4(cx)}, ${r4(cz)} (pivot should be centred)`);
    if (stats.degenerate) warn.push(`${stats.degenerate} degenerate triangles dropped`);
    log(
      `  ${m.name.padEnd(36)} ${String(stats.triangles).padStart(6)} tris  ` +
        `${size.map((v) => v.toFixed(2)).join(" x ")} m  ${(glb.byteLength / 1024).toFixed(0)} KB` +
        (warn.length ? `  !! ${warn.join("; ")}` : ""),
    );
  }
  for (const f of readdirSync(dir))
    if (f.endsWith(".glb") && !seen.has(f.slice(0, -4))) {
      rmSync(path.join(dir, f));
      log(`  removed stale ${group}/${f}`);
    }
  const manifest: Manifest = { group, version: 1, generator: "tools/models/build.ts", assets: entries };
  atomicWrite(path.join(root, `manifest.${group}.json`), JSON.stringify(manifest, null, 2) + "\n");
  log(`[models] ${group}: ${entries.length} assets -> ${path.relative(REPO_ROOT, dir)}/, manifest.${group}.json`);
  return manifest;
}

/** Writes apps/web/public/models/index.json listing the five groups. */
export function writeIndex(outDir: string = MODELS_DIR): void {
  mkdirSync(outDir, { recursive: true });
  atomicWrite(
    path.join(outDir, "index.json"),
    JSON.stringify({ groups: GROUPS, manifests: GROUPS.map((g) => `manifest.${g}.json`) }, null, 2) + "\n",
  );
}
