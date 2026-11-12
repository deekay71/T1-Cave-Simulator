/**
 * Login group — the exterior set of the login screen (design/concepts/login-low-poly): a dusk
 * landscape of grey-purple faceted rock, a worn path with glowing red cracks that descends into a
 * big cave mouth, far spires in three haze layers, bare dead trees and a low red sun. Same faceted
 * language as the cave (hull blocks, flat facets, baked top/side shading) in a cold palette, so
 * the outside reads as a different place from the warm brown hall.
 *
 * SET SPACE (metres, Y up): the origin is the centre of the cave mouth's threshold on its floor;
 * the mouth opens toward +Z and the tunnel runs toward -Z, bending to +X. Fans come over a crest
 * at about (-7.7, 2.1, 16.6) and walk down the path into the mouth; behind the crest (+Z) the path
 * drops into a gully, so newcomers rise into view. The login camera stands near (-7, 4.1, 21)
 * looking toward -Z (apps/web/src/login/scene.ts).
 *
 * PLACEMENT: every GLB keeps the usual pivot (bottom centre). The set-space placements are in the
 * manifest: meta.placements = [{ at: [x, y, z], yaw, scale }] (PlayCanvas setLocalPosition /
 * setLocalEulerAngles(0, yaw, 0) / setLocalScale under the set root). Assets authored in set
 * space (ground, cave mouth, spires, sky) have exactly one placement: where their pivot ended up.
 * The ground's meta also carries the queue's path (meta.path: [x, y, z] every ~0.5 m, start ->
 * end; meta.pathMouth: arc length at the threshold; meta.pathCrest: arc length at the crest) and
 * the cave mouth's manifest lights are the red glow (set-space positions in meta.lights).
 *
 * Budget: the whole set as placed (instances included) stays under LOGIN_TRIANGLE_BUDGET.
 */
import { Model, MeshBuilder, Rng, mix, shade, type Color, type Vec2, type Vec3 } from "../lib.js";

/* =========================================================================================
 * Small maths helpers
 * ========================================================================================= */

const DEG = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const r3 = (x: number) => Math.round(x * 1e3) / 1e3 || 0;
const centroid3 = (pts: Vec3[]): Vec3 => scl(pts.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3), 1 / pts.length);

/** Deterministic integer hash -> [0, 1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth 2D value noise in [-1, 1]. */
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

/** Triangle whose normal points along `want` (flips the winding when needed). */
function triToward(b: MeshBuilder, p0: Vec3, p1: Vec3, p2: Vec3, want: Vec3, color: Color, o: { mat?: "glow"; glow?: number } = {}): void {
  const n = cross(sub(p1, p0), sub(p2, p0));
  if (dot(n, want) < 0) b.tri(p0, p2, p1, { color, ...o });
  else b.tri(p0, p1, p2, { color, ...o });
}
const UP: Vec3 = [0, 1, 0];

/* =========================================================================================
 * Palette (sRGB): desaturated grey-purple rock, near-black foreground, crimson glow
 * ========================================================================================= */

export const LOGIN_PALETTE = {
  rockLight: "#8A8490",
  rock: "#736E79",
  rockMid: "#5F5A66",
  rockDark: "#4A4552",
  rockDeep: "#38353F",
  /** foreground boulders and tree bark: near black, still a little purple */
  near: "#2A2730",
  bark: "#33292F",
  ground: "#55505B",
  groundDark: "#46424D",
  path: "#6C6772",
  pathLight: "#7E7985",
  /** painted symbol */
  crimson: "#C4262E",
  /** cracks and the cave's inner glow */
  glow: "#FF2018",
  glowHot: "#FF3A22",
  glowDeep: "#8E1217",
  /** rock inside the mouth (lit by the red lights at runtime) */
  throat: "#3E2227",
  throatDeep: "#1C0E11",
  tooth: "#5C3A42",
  toothLit: "#B03A34",
  /** sky from the horizon up, and the red around the sun */
  sky: ["#705D69", "#675967", "#5C5466", "#4F4B5E", "#434153", "#383848"] as const,
  skySun: "#9C444C",
  cloud: "#7C4A56",
  sun: "#F4483A",
  sunHalo: "#7E4450",
} as const;
const C = LOGIN_PALETTE;

/** Whole set as placed (instances included). */
export const LOGIN_TRIANGLE_BUDGET = 9000;

/* =========================================================================================
 * Layout: path, ground height
 * ========================================================================================= */

/** Height of the crest above the mouth's floor. */
const RISE = 2.1;
/** Where the tunnel's centre line is at depth z (< 0): it bends toward +X. */
const tunnelX = (z: number) => 0.037 * z * z;

/** Path control points [x, z], start (hidden in the gully behind the crest) -> end (inside the tunnel). */
const PATH_CTRL: Vec2[] = [
  [-6.3, 27.5],
  [-6.6, 23.5],
  [-6.8, 21],
  [-7.05, 19],
  [-7.32, 18],
  [-7.65, 16.6],
  [-7.1, 14.4],
  [-6.1, 12.4],
  [-4.8, 9.8],
  [-2.9, 6.0],
  [-1.2, 2.6],
  [0, 0],
  [tunnelX(-3) + 0.15, -3],
  [tunnelX(-6) + 0.1, -6],
  [tunnelX(-9), -9],
];
const CREST_INDEX = 5;
const MOUTH_INDEX = 11;

/** Catmull-Rom through the control points, resampled at ~`step` metres. */
function samplePath(ctrl: Vec2[], step: number): { pts: Vec2[]; ctrlS: number[] } {
  const dense: Vec2[] = [];
  const ctrlAt: number[] = [];
  const P = (i: number) => ctrl[clamp(i, 0, ctrl.length - 1)];
  for (let i = 0; i < ctrl.length - 1; i++) {
    ctrlAt.push(dense.length);
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let k = 0; k < 16; k++) {
      const t = k / 16;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  ctrlAt.push(dense.length);
  dense.push(ctrl[ctrl.length - 1]);
  // arc length of the dense polyline
  const S = [0];
  for (let i = 1; i < dense.length; i++)
    S.push(S[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = S[S.length - 1];
  const n = Math.round(total / step);
  const pts: Vec2[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (j < S.length - 2 && S[j + 1] < s) j++;
    const t = (s - S[j]) / Math.max(1e-9, S[j + 1] - S[j]);
    pts.push([lerp(dense[j][0], dense[j + 1][0], t), lerp(dense[j][1], dense[j + 1][1], t)]);
  }
  return { pts, ctrlS: ctrlAt.map((k) => S[k]) };
}
const PATH = samplePath(PATH_CTRL, 0.5);

/** Distance from (x, z) to the path's centre line. */
function pathDist(x: number, z: number): number {
  let best = Infinity;
  const p = PATH.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0],
      az = p[i][1];
    const bx = p[i + 1][0] - ax,
      bz = p[i + 1][1] - az;
    const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
    const dx = x - ax - bx * t,
      dz = z - az - bz * t;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Ground height at (x, z): a bowl toward the mouth, a gully behind the crest, the tunnel floor. */
export function loginGroundY(x: number, z: number): number {
  const d = pathDist(x, z);
  const r = Math.hypot(x - 0.2, z + 1.0);
  let y = RISE * smoothstep(1.2, 19.5, r);
  // gully behind the crest (toward the camera's back): the path climbs a steep bank out of it, so
  // a newcomer rises over the lip close to the crest instead of looming under the camera
  const g = Math.max(0, z - 17.05);
  y -= (0.9 * g * g) / (g + 0.6);
  // rough ground away from the path, a low berm along it
  const rough = smoothstep(1.0, 2.8, d);
  y += rough * (vnoise(x / 3.1, z / 3.1, 11) * 0.3 + vnoise(x / 1.2, z / 1.2, 12) * 0.1);
  y += 0.3 * smoothstep(1.3, 2.6, d) * (1 - smoothstep(3.2, 6.5, d)) * (0.55 + 0.45 * vnoise(x / 2.3, z / 2.3, 13));
  // rolling hills far from the set
  const far = smoothstep(30, 110, Math.hypot(x + 7, z - 21));
  y += far * (2.2 + 3.2 * vnoise(x / 45, z / 45, 14));
  // inside the mouth the floor keeps descending along the tunnel
  if (z < 0.5) {
    const k = (1 - smoothstep(3.4, 5.4, Math.abs(x - tunnelX(z)))) * clamp((0.5 - z) / 2, 0, 1);
    y = lerp(y, -0.075 * Math.max(0, -z), k);
  }
  return y;
}
const onGround = (x: number, z: number, lift = 0): Vec3 => [x, loginGroundY(x, z) + lift, z];

export interface LoginPlacement {
  at: Vec3;
  yaw: number;
  scale: number;
}
const put = (x: number, z: number, yaw = 0, scale = 1, sink = 0.15): LoginPlacement => ({
  at: [r3(x), r3(loginGroundY(x, z) - sink * scale), r3(z)],
  yaw,
  scale,
});

/** Move a set-space build to the usual pivot (bottom centre) and record where it goes. */
function placeInSet(m: Model, g: MeshBuilder, extra: Record<string, unknown> = {}): Vec3 {
  const bb = g.bounds();
  if (!bb) throw new Error(`${m.name}: empty`);
  const at: Vec3 = [r3((bb.min[0] + bb.max[0]) / 2), r3(bb.min[1]), r3((bb.min[2] + bb.max[2]) / 2)];
  m.geo.add(g, { at: [-at[0], -at[1], -at[2]] });
  m.meta = { ...m.meta, placements: [{ at, yaw: 0, scale: 1 }], ...extra };
  return at;
}

/* =========================================================================================
 * Rock helpers
 * ========================================================================================= */

/** Baked facet shading: light tops, dark undersides, sides a little lighter toward the sky's left. */
function rockPaint(rng: Rng, tone: Color, o: { top?: number; side?: number } = {}) {
  const top = o.top ?? 1.24;
  const side = o.side ?? 0.86;
  return (f: { normal: Vec3 }) => {
    const [nx, ny, nz] = f.normal;
    const k = ny > 0.55 ? top : ny < -0.3 ? 0.58 : side + 0.1 * nz - 0.08 * nx;
    return shade(tone, k * (1 + rng.jitter(0.06)));
  };
}

/** Chunky convex block: a jittered box with a few extra facet points. */
function block(b: MeshBuilder, rng: Rng, c: Vec3, s: Vec3, o: { tone?: Color; rot?: Vec3; jitter?: number; paint?: { top?: number; side?: number } } = {}): void {
  const j = o.jitter ?? 0.16;
  const h: Vec3 = [s[0] / 2, s[1] / 2, s[2] / 2];
  const pts: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        pts.push([sx * h[0] * (1 - rng.range(0, j)), sy * h[1] * (1 - rng.range(0, j)), sz * h[2] * (1 - rng.range(0, j))]);
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      if (!rng.chance(0.7)) continue;
      const p: Vec3 = [rng.jitter(0.45) * h[0], rng.jitter(0.45) * h[1], rng.jitter(0.45) * h[2]];
      p[axis] = sign * h[axis] * rng.range(0.98, 1.1);
      pts.push(p);
    }
  b.hull(pts, { at: c, rot: o.rot, color: rockPaint(rng, o.tone ?? C.rock, o.paint) });
}

interface SpikeOpts {
  base: Vec3;
  /** +1 up, -1 down */
  dir: 1 | -1;
  length: number;
  radius: number;
  sides?: number;
  /** ring positions along the spike (0..1) */
  rings?: number[];
  lean?: Vec2;
  /** colour of a face from its outward normal and its position along the spike */
  paint: (n: Vec3, t: number) => Color;
  /** tip cut flat-ish (a small sloped top) instead of a point */
  blunt?: number;
}
/** Faceted spike: stalactite tooth, stalagmite or a rock spire. */
function spike(b: MeshBuilder, rng: Rng, o: SpikeOpts): void {
  const sides = o.sides ?? 5;
  const ts = o.rings ?? [0.45];
  const phase = rng.next() * 360;
  const lean = o.lean ?? [rng.jitter(0.1), rng.jitter(0.1)];
  const axisAt = (t: number): Vec3 => [
    o.base[0] + lean[0] * o.length * t * t,
    o.base[1] + o.dir * o.length * t,
    o.base[2] + lean[1] * o.length * t * t,
  ];
  const ring = (t: number, r: number): Vec3[] => {
    const c = axisAt(t);
    return Array.from({ length: sides }, (_, i) => {
      const a = (phase + (i * 360) / sides + rng.jitter(12)) * DEG;
      const rr = r * rng.range(0.82, 1.15);
      return [c[0] + Math.cos(a) * rr, c[1] + rng.jitter(0.035 * o.length), c[2] + Math.sin(a) * rr] as Vec3;
    });
  };
  const blunt = o.blunt ?? 0;
  const radiusAt = (t: number) => o.radius * (blunt + (1 - blunt) * Math.pow(1 - t, 1.2));
  const layers: { t: number; pts: Vec3[] }[] = [{ t: 0, pts: ring(0, o.radius) }];
  for (const t of ts) layers.push({ t, pts: ring(t, radiusAt(t)) });
  const tip = axisAt(1);
  if (blunt) {
    tip[0] += rng.jitter(o.radius * blunt);
    tip[2] += rng.jitter(o.radius * blunt);
  }
  for (let L = 0; L < layers.length; L++) {
    const A = layers[L].pts;
    const last = L + 1 >= layers.length;
    const tMid = last ? (layers[L].t + 1) / 2 : (layers[L].t + layers[L + 1].t) / 2;
    const ax = axisAt(tMid);
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      if (!last) {
        const B = layers[L + 1].pts;
        const out1 = sub(centroid3([A[i], A[i1], B[i1]]), ax);
        triToward(b, A[i], A[i1], B[i1], out1, o.paint(norm(out1), tMid));
        const out2 = sub(centroid3([A[i], B[i1], B[i]]), ax);
        triToward(b, A[i], B[i1], B[i], out2, o.paint(norm(out2), tMid));
      } else {
        const out = sub(centroid3([A[i], A[i1], tip]), ax);
        triToward(b, A[i], A[i1], tip, out, o.paint(norm(out), tMid));
      }
    }
  }
}

/* =========================================================================================
 * Ground: worn path, berms, far apron, glowing cracks
 * ========================================================================================= */

const GRID = { x0: -27.2, x1: 13.6, z0: -10.4, z1: 24.8, cell: 1.6 };

function buildGround(): Model {
  const m = new Model("tl_env_login_ground_v01", {
    notes: "Login exterior ground: worn path into the cave mouth, berms, far apron, glowing red cracks (set space)",
    budget: 2200,
  });
  const g = new MeshBuilder(m.name);
  const rng = g.rng.fork("ground");
  const nx = Math.round((GRID.x1 - GRID.x0) / GRID.cell);
  const nz = Math.round((GRID.z1 - GRID.z0) / GRID.cell);
  const V: Vec3[][] = [];
  for (let i = 0; i <= nx; i++) {
    V.push([]);
    for (let j = 0; j <= nz; j++) {
      const x = GRID.x0 + i * GRID.cell + rng.jitter(GRID.cell * 0.3);
      const z = GRID.z0 + j * GRID.cell + rng.jitter(GRID.cell * 0.3);
      V[i].push(onGround(x, z));
    }
  }
  const tone = (p: Vec3[]): Color => {
    const c = centroid3(p);
    const d = pathDist(c[0], c[2]);
    const n = 0.5 + 0.5 * vnoise(c[0] / 2.2, c[2] / 2.2, 21);
    const inPath = d < 0.95 + 0.5 * n;
    const base = inPath ? mix(C.path, C.pathLight, n) : mix(C.groundDark, C.ground, n);
    // inside the mouth the floor is dark, the red lights do the rest
    const inside = c[2] < 0 ? smoothstep(0, -6, c[2]) : 0;
    return shade(mix(base, C.throat, inside * 0.8), 1 + rng.jitter(0.07));
  };
  const emit = (a: Vec3, b: Vec3, c: Vec3) => triToward(g, a, b, c, UP, tone([a, b, c]));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const [a, b, c, d] = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]];
      if (hash2(i, j, 5) < 0.5) {
        emit(a, b, c);
        emit(a, c, d);
      } else {
        emit(a, b, d);
        emit(b, c, d);
      }
    }

  // Far apron: rings around the grid out to the haze, zipped to the grid's boundary (no cracks).
  const boundary: Vec3[] = [];
  for (let i = 0; i < nx; i++) boundary.push(V[i][0]);
  for (let j = 0; j < nz; j++) boundary.push(V[nx][j]);
  for (let i = nx; i > 0; i--) boundary.push(V[i][nz]);
  for (let j = nz; j > 0; j--) boundary.push(V[0][j]);
  const cx = (GRID.x0 + GRID.x1) / 2;
  const cz = (GRID.z0 + GRID.z1) / 2;
  const ang = (p: Vec3) => Math.atan2(p[2] - cz, p[0] - cx);
  const sortLoop = (loop: Vec3[]) => loop.slice().sort((p, q) => ang(p) - ang(q));
  const ringLoop = (radius: number, n: number): Vec3[] =>
    Array.from({ length: n }, (_, k) => {
      const a = -Math.PI + ((k + 0.5) / n) * Math.PI * 2 + rng.jitter(0.25 / n);
      const rr = radius * rng.range(0.92, 1.08);
      return onGround(cx + Math.cos(a) * rr * 1.15, cz + Math.sin(a) * rr);
    });
  const zip = (A: Vec3[], B: Vec3[]) => {
    let i = 0,
      j = 0;
    const na = A.length,
      nb = B.length;
    while (i < na || j < nb) {
      const a0 = A[i % na],
        b0 = B[j % nb];
      const nextA = i < na ? ang(A[(i + 1) % na]) + (i + 1 >= na ? Math.PI * 2 : 0) : Infinity;
      const nextB = j < nb ? ang(B[(j + 1) % nb]) + (j + 1 >= nb ? Math.PI * 2 : 0) : Infinity;
      if (nextA <= nextB) {
        emit(a0, A[(i + 1) % na], b0);
        i++;
      } else {
        emit(a0, B[(j + 1) % nb], b0);
        j++;
      }
    }
  };
  let inner = sortLoop(boundary);
  for (const [radius, n] of [
    [34, 30],
    [78, 22],
    [150, 18],
    [250, 18],
  ] as const) {
    const outer = sortLoop(ringLoop(radius, n));
    zip(inner, outer);
    inner = outer;
  }

  // Cracks: jagged red seams that follow the mesh edges beside the path, with a few wider pools.
  const lift = 0.02;
  const starts: [number, number][] = [];
  const candidates: [number, number][] = [];
  for (let i = 1; i < nx; i++)
    for (let j = 1; j < nz; j++) {
      const p = V[i][j];
      const d = pathDist(p[0], p[2]);
      if (d > 0.25 && d < 2.7 && p[2] > -7.5 && p[2] < 17.6) candidates.push([i, j]);
    }
  rng.shuffle(candidates);
  for (const c of candidates) {
    if (starts.length >= 20) break;
    const p = V[c[0]][c[1]];
    if (starts.every((s) => Math.hypot(V[s[0]][s[1]][0] - p[0], V[s[0]][s[1]][2] - p[2]) > 2.6)) starts.push(c);
  }
  const used = new Set<string>();
  const seam = (pts: Vec3[], wMax: number) => {
    const n = pts.length;
    const L: Vec3[] = [],
      R: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)],
        c = pts[Math.min(n - 1, k + 1)];
      const dx = c[0] - a[0],
        dz = c[2] - a[2];
      const l = Math.hypot(dx, dz) || 1;
      const w = (k === 0 || k === n - 1 ? 0.012 : wMax * rng.range(0.55, 1)) / 2;
      const px = (-dz / l) * w,
        pz = (dx / l) * w;
      L.push([pts[k][0] + px, pts[k][1] + lift, pts[k][2] + pz]);
      R.push([pts[k][0] - px, pts[k][1] + lift, pts[k][2] - pz]);
    }
    for (let k = 0; k < n - 1; k++) {
      const col = mix(C.glow, C.glowHot, rng.next() * 0.6);
      triToward(g, L[k], R[k], R[k + 1], UP, col, { mat: "glow", glow: 1.3 });
      triToward(g, L[k], R[k + 1], L[k + 1], UP, col, { mat: "glow", glow: 1.3 });
    }
  };
  for (const [si, sj] of starts) {
    let i = si,
      j = sj;
    let heading = rng.next() * Math.PI * 2;
    const walk: Vec3[] = [V[i][j]];
    used.add(`${i},${j}`);
    const steps = rng.int(2, 5);
    for (let s = 0; s < steps; s++) {
      let best: [number, number] | null = null,
        bestScore = -Infinity;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di,
          nj = j + dj;
        if (ni < 1 || nj < 1 || ni >= nx || nj >= nz || used.has(`${ni},${nj}`)) continue;
        const q = V[ni][nj];
        if (pathDist(q[0], q[2]) > 3.1) continue;
        const dir = Math.atan2(q[2] - V[i][j][2], q[0] - V[i][j][0]);
        const score = Math.cos(dir - heading) + rng.next() * 0.9;
        if (score > bestScore) {
          bestScore = score;
          best = [ni, nj];
        }
      }
      if (!best) break;
      heading = Math.atan2(V[best[0]][best[1]][2] - V[i][j][2], V[best[0]][best[1]][0] - V[i][j][0]);
      [i, j] = best;
      used.add(`${i},${j}`);
      walk.push(V[i][j]);
    }
    if (walk.length < 2) continue;
    // one extra bend inside each edge so the seam does not look like the grid
    const pts: Vec3[] = [walk[0]];
    for (let k = 1; k < walk.length; k++) {
      const a = walk[k - 1],
        c = walk[k];
      const mx = lerp(a[0], c[0], 0.5) + rng.jitter(0.22),
        mz = lerp(a[2], c[2], 0.5) + rng.jitter(0.22);
      pts.push([mx, Math.max(loginGroundY(mx, mz), lerp(a[1], c[1], 0.5)), mz], c);
    }
    seam(pts, rng.range(0.1, 0.24));
    if (rng.chance(0.55)) {
      // pool: a small glowing shard at one joint
      const p = pts[rng.int(1, pts.length - 2)];
      const n = rng.int(4, 5);
      const r = rng.range(0.16, 0.34);
      const poly: Vec3[] = Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2 + rng.jitter(0.4);
        const rr = r * rng.range(0.6, 1.2);
        return [p[0] + Math.cos(a) * rr, p[1] + lift * 1.2, p[2] + Math.sin(a) * rr * 0.7] as Vec3;
      });
      for (let k = 1; k < n - 1; k++) triToward(g, poly[0], poly[k], poly[k + 1], UP, C.glowHot, { mat: "glow", glow: 1.3 });
    }
  }

  // Loose stones beside the path (never on it).
  let stones = 0;
  for (let tries = 0; tries < 400 && stones < 16; tries++) {
    const k = rng.int(8, PATH.pts.length - 22);
    const side = rng.sign();
    const [px, pz] = PATH.pts[k];
    const [qx, qz] = PATH.pts[k + 1];
    const l = Math.hypot(qx - px, qz - pz) || 1;
    const off = rng.range(1.45, 3.4) * side;
    const x = px + (-(qz - pz) / l) * off + rng.jitter(0.4),
      z = pz + ((qx - px) / l) * off + rng.jitter(0.4);
    if (pathDist(x, z) < 1.35 || z > 17.2) continue;
    const size = rng.range(0.28, 0.75);
    g.rock({
      size: [size * rng.range(1, 1.5), size * rng.range(0.55, 0.85), size * rng.range(0.9, 1.3)],
      at: [x, loginGroundY(x, z) - size * 0.12, z],
      rot: [0, rng.range(0, 360), 0],
      points: 8,
      jitter: 0.3,
      flat: 0.2,
      align: "bottom",
      color: rockPaint(rng, rng.chance(0.5) ? C.rockMid : C.rockDark),
    });
    stones++;
  }

  // Queue path for the runtime (set space).
  const path = PATH.pts.map(([x, z]) => [r3(x), r3(loginGroundY(x, z)), r3(z)] as Vec3);
  placeInSet(m, g, {
    path,
    pathCrest: r3(PATH.ctrlS[CREST_INDEX]),
    pathMouth: r3(PATH.ctrlS[MOUTH_INDEX]),
  });
  return m;
}

/* =========================================================================================
 * Cave mouth: stacked blocks around the opening, emblem slab, teeth, dark throat, glow
 * ========================================================================================= */

/** Set-space lights of the mouth (red glow), also written to the manifest's `lights` in model space. */
const MOUTH_LIGHTS = [
  { name: "throat_glow", at: [2.2, 2.4, -7.0] as Vec3, color: "#FF3A24", intensity: 3.4, range: 16 },
  { name: "threshold_glow", at: [-0.1, 1.2, 0.6] as Vec3, color: "#FF4630", intensity: 1.5, range: 7.5 },
];

function buildCaveMouth(): Model {
  const m = new Model("tl_env_login_cave_mouth_v01", {
    notes: "Login cave mouth: block cliff, stalactite teeth, emblem slab above the opening, dark throat with a red glow (set space)",
    budget: 2600,
  });
  const g = new MeshBuilder(m.name);
  const rng = g.rng.fork("cliff");

  // Cliff blocks [centre, size, tone]; the opening is ~7.2 m wide to 4.7 m, ~5 m wide to 6.1 m.
  const B = (c: Vec3, s: Vec3, tone: Color = C.rock, jitter = 0.16) => block(g, rng, c, s, { tone, jitter });
  // left of the opening: the cliff ends here and steps down into the valley
  B([-5.9, 2.5, -1.4], [4.6, 5.8, 5.6], C.rock, 0.1);
  B([-5.2, 7.0, -2.0], [5.2, 4.6, 5.6], C.rockMid, 0.1);
  B([-9.3, 1.9, 0.2], [3.4, 3.6, 4.0], C.rockMid);
  B([-11.6, 1.7, 1.6], [2.4, 2.2, 2.8], C.rock);
  B([-8.2, 5.2, -4.2], [4.6, 4.6, 5.0], C.rockDark);
  B([-6.2, 10.6, -5.2], [7.0, 5.6, 6.0], C.rockMid);
  // right of the opening, the cliff runs on out of frame and toward the viewer
  B([6.5, 2.7, -1.2], [5.8, 6.2, 5.6], C.rockMid, 0.1);
  B([5.9, 7.4, -1.9], [6.4, 4.8, 5.8], C.rock, 0.1);
  B([11.8, 3.6, 0.2], [6.2, 7.6, 6.4], C.rock);
  B([12.6, 9.6, -1.6], [7.2, 6.4, 6.4], C.rockMid);
  B([17.6, 4.6, 2.4], [6.4, 9.6, 7.2], C.rockDark);
  B([18.8, 12.2, -0.6], [7.6, 7.2, 7.0], C.rock);
  B([23.5, 5.5, 6.5], [7.0, 11.5, 8.0], C.rockDark);
  B([25.0, 14.0, 2.0], [8.0, 8.0, 8.0], C.rockMid);
  // above the opening
  B([0.6, 8.7, -1.8], [11.6, 5.2, 5.8], C.rockMid, 0.08);
  B([-1.6, 13.3, -4.0], [9.6, 5.8, 6.4], C.rock);
  B([6.8, 13.6, -4.4], [10.2, 6.4, 6.6], C.rockDark);
  B([2.6, 17.8, -7.6], [12.5, 6.0, 7.0], C.rockMid);
  B([14.2, 16.6, -5.0], [9.5, 7.0, 7.0], C.rock);
  B([21.5, 19.0, -4.0], [10.0, 7.0, 8.0], C.rockDark);
  // the massif behind (clear of the throat: above it or beyond its end)
  B([3.0, 14.5, -11.5], [19.0, 9.0, 8.5], C.rockDark);
  B([6.0, 10.0, -20.0], [27.0, 20.0, 9.5], C.rockDeep);
  B([20.0, 12.0, -13.0], [13.0, 22.0, 11.0], C.rockDeep);
  B([8.0, 23.0, -15.0], [20.0, 9.0, 10.0], C.rockDark);

  // Emblem slab: one big flat face above the mouth's left shoulder, turned toward the path.
  g.group({ at: [-2.9, 6.85, 1.3], rot: [-12, -11, 2.5] }, (s) => {
    const front: Vec2[] = [
      [-2.3, -1.6],
      [1.65, -1.9],
      [2.4, 0.2],
      [1.3, 1.95],
      [-1.6, 1.85],
      [-2.5, 0.3],
    ];
    const pts: Vec3[] = [];
    for (const [x, y] of front) {
      pts.push([x, y, 0.55]);
      pts.push([x * 1.16 + rng.jitter(0.15), y * 1.14 + rng.jitter(0.15), -0.75]);
    }
    s.hull(pts, {
      color: (f) => (f.normal[2] > 0.9 ? C.rockLight : rockPaint(rng, C.rock)(f)),
    });
    s.emblem({ height: 2.55, at: [-0.05, 0.0, 0.565], color: C.crimson, mat: "glow" });
  });

  // Teeth: stalactites along the opening's upper lip, lit red from inside.
  const toothPaint = (n: Vec3, t: number) => {
    const inside = clamp(-n[2] * 0.9 + 0.25 - n[1] * 0.2, 0, 1);
    return shade(mix(mix(C.tooth, C.rockDeep, 0.35 * (1 - t)), C.toothLit, inside * (0.55 + 0.45 * t)), 1 + rng.jitter(0.07));
  };
  const lipY = (x: number) => (Math.abs(x) < 2.45 ? 6.2 : 4.8);
  const teeth: [x: number, z: number, length: number][] = [
    [-3.3, 0.35, 1.0],
    [-2.75, 0.1, 1.7],
    [-2.0, 0.3, 2.3],
    [-1.25, -0.05, 1.3],
    [-0.55, 0.3, 1.9],
    [0.2, 0.05, 1.1],
    [0.9, 0.35, 2.5],
    [1.65, 0.0, 1.5],
    [2.2, 0.3, 1.2],
    [2.85, 0.1, 1.9],
    [3.35, 0.3, 1.1],
    // second row, deeper in
    [-2.3, -1.5, 1.3],
    [-0.9, -1.8, 1.6],
    [0.6, -1.6, 1.0],
    [2.0, -1.7, 1.5],
    [3.0, -1.4, 0.9],
  ];
  for (const [x, z, L] of teeth) {
    const length = L * rng.range(0.9, 1.12);
    spike(g, rng, {
      base: [x + rng.jitter(0.12), lipY(x) + 0.5, z + rng.jitter(0.1)],
      dir: -1,
      length: length + 0.5,
      radius: 0.3 + 0.13 * length,
      sides: 5,
      rings: [0.42],
      lean: [rng.jitter(0.07), -0.04 + rng.jitter(0.05)],
      paint: toothPaint,
    });
  }
  // a few low fangs and stones at the foot of the opening
  for (const [x, z, L] of [
    [-3.75, 0.9, 1.3],
    [-3.3, -0.6, 0.8],
    [3.8, 0.8, 1.5],
    [3.4, -0.7, 0.9],
    [-4.3, 1.9, 0.7],
    [4.5, 1.8, 0.8],
  ] as const)
    spike(g, rng, {
      base: [x, loginGroundY(x, z) - 0.25, z],
      dir: 1,
      length: L + 0.25,
      radius: 0.34 + 0.16 * L,
      sides: 5,
      rings: [0.5],
      paint: (n, t) => toothPaint([n[0], -n[1], n[2]], t * 0.6),
    });

  // Throat: an arch tube seen from inside, wider than the opening at the lip so its start is
  // buried in the blocks; it narrows and bends toward +X. The floor is the ground mesh.
  const ARC = 9;
  const ringAt = (z: number, halfW: number, height: number): Vec3[] => {
    const cx = tunnelX(z);
    const floor = -0.075 * Math.max(0, -z) - 1.0;
    return Array.from({ length: ARC }, (_, k) => {
      const a = (k / (ARC - 1)) * Math.PI;
      const jit = k === 0 || k === ARC - 1 ? 0 : 0.28;
      const x = cx - Math.cos(a) * halfW * (1 + rng.jitter(0.05));
      const y = k === 0 || k === ARC - 1 ? floor : Math.max(1.2, Math.sin(a) * height * (1 + rng.jitter(0.06)));
      return [x + rng.jitter(jit), y, z + rng.jitter(jit)] as Vec3;
    });
  };
  const rings = [
    ringAt(-0.4, 5.4, 7.5),
    ringAt(-2.8, 4.6, 6.7),
    ringAt(-5.6, 3.9, 5.6),
    ringAt(-8.6, 3.3, 4.6),
    ringAt(-11.4, 2.9, 3.9),
    ringAt(-13.4, 2.7, 3.5),
  ];
  const zs = [-0.4, -2.8, -5.6, -8.6, -11.4, -13.4];
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r],
      Bn = rings[r + 1];
    const zm = (zs[r] + zs[r + 1]) / 2;
    const axis: Vec3 = [tunnelX(zm), 2.2, zm];
    const depth = (r + 0.5) / (rings.length - 1);
    for (let k = 0; k < ARC - 1; k++) {
      const col = () => shade(mix(C.throat, C.throatDeep, depth), 1 + rng.jitter(0.12));
      const q = [A[k], A[k + 1], Bn[k + 1], Bn[k]];
      triToward(g, q[0], q[1], q[2], sub(axis, centroid3([q[0], q[1], q[2]])), col());
      triToward(g, q[0], q[2], q[3], sub(axis, centroid3([q[0], q[2], q[3]])), col());
    }
  }
  // Glow at the end of the throat: a hot core low down, deep red around it.
  const end = rings[rings.length - 1];
  const zEnd = zs[zs.length - 1];
  const core: Vec3 = [tunnelX(zEnd) + 0.2, 1.0, zEnd];
  const mid = end.map((p) => [lerp(core[0], p[0], 0.52), lerp(core[1], Math.max(p[1], -0.9), 0.5), zEnd + 0.05] as Vec3);
  const toViewer: Vec3 = [0, 0, 1];
  for (let k = 0; k < ARC - 1; k++) {
    triToward(g, core, mid[k], mid[k + 1], toViewer, mix(C.glow, C.glowDeep, rng.next() * 0.35), { mat: "glow", glow: 1.2 });
    const deep = mix(C.glowDeep, C.throatDeep, 0.25 + rng.next() * 0.3);
    triToward(g, mid[k], end[k], end[k + 1], toViewer, deep, { mat: "glow", glow: 1.2 });
    triToward(g, mid[k], end[k + 1], mid[k + 1], toViewer, deep, { mat: "glow", glow: 1.2 });
  }
  triToward(g, core, mid[ARC - 1], mid[0], toViewer, mix(C.glow, C.glowDeep, 0.2), { mat: "glow", glow: 1.2 });
  triToward(g, mid[ARC - 1], end[ARC - 1], end[0], toViewer, C.glowDeep, { mat: "glow", glow: 1.2 });
  triToward(g, mid[ARC - 1], end[0], mid[0], toViewer, C.glowDeep, { mat: "glow", glow: 1.2 });

  const at = placeInSet(m, g, { lights: MOUTH_LIGHTS.map((l) => ({ ...l })) });
  for (const l of MOUTH_LIGHTS) m.light({ ...l, at: sub(l.at, at) });
  m.anchor("mouth", sub([0, 0, 0], at));
  m.anchor("emblem", sub([-2.9, 6.85, 1.85], at));
  m.anchor("throat_end", sub(core, at));
  return m;
}

/* =========================================================================================
 * Boulders
 * ========================================================================================= */

function buildBoulder(id: "a" | "b" | "c" | "dark", placements: LoginPlacement[]): Model {
  const notes = {
    a: "Login mid-ground boulder: one chunky block with a chip",
    b: "Login mid-ground boulder cluster: one big, two small",
    c: "Login low slab pile beside the path",
    dark: "Login foreground boulder: near-black, frames the bottom corners",
  }[id];
  const m = new Model(`tl_env_login_boulder_${id}_v01`, { notes, budget: 160 });
  const g = m.geo;
  const rng = g.rng.fork("boulder");
  const rock = (size: Vec3, at: Vec3, tone: Color, rot: Vec3 = [0, rng.range(0, 360), 0], paint?: { top?: number; side?: number }) =>
    g.rock({ size, at, rot, points: 11, jitter: 0.34, flat: 0.22, align: "bottom", color: rockPaint(rng, tone, paint) });
  if (id === "a") {
    rock([2.6, 2.1, 2.3], [0, 0, 0], C.rock);
    rock([1.1, 0.8, 1.0], [1.25, 0, 0.75], C.rockMid);
  } else if (id === "b") {
    rock([3.0, 2.5, 2.7], [-0.4, 0, -0.2], C.rockMid);
    rock([1.7, 1.3, 1.5], [1.7, 0, 0.7], C.rock);
    rock([1.2, 0.8, 1.1], [0.5, 0, 1.75], C.rockDark);
  } else if (id === "c") {
    rock([2.9, 0.95, 2.2], [0, 0, 0], C.rockMid);
    rock([1.7, 0.7, 1.4], [0.5, 0.55, -0.2], C.rock);
    rock([0.9, 0.5, 0.8], [-1.6, 0, 0.9], C.rockDark);
  } else {
    const paint = { top: 1.5, side: 0.95 };
    rock([3.4, 2.4, 3.0], [0, 0, 0], C.near, undefined, paint);
    rock([1.8, 1.2, 1.6], [2.0, 0, 0.6], C.near, undefined, paint);
    rock([1.3, 0.8, 1.2], [-1.9, 0, 1.0], shade(C.near, 1.25), undefined, paint);
  }
  m.meta = { placements };
  return m;
}

/* =========================================================================================
 * Far spires: three haze layers
 * ========================================================================================= */

interface SpireSpec {
  x: number;
  z: number;
  h: number;
  r: number;
}
function buildSpires(layer: "near" | "mid" | "far"): Model {
  const cfg = {
    near: { tone: C.rockDark, notes: "Login spires, near layer (40-75 m): tall faceted pinnacles left of the cliff" },
    mid: { tone: C.rockMid, notes: "Login spires, middle layer (85-135 m): pinnacles and a broken ridge" },
    far: { tone: C.rock, notes: "Login spires, far layer (160-215 m): low ridge under the sun, a few pinnacles" },
  }[layer];
  const m = new Model(`tl_env_login_spires_${layer}_v01`, { notes: cfg.notes, budget: 520 });
  const g = new MeshBuilder(m.name);
  const rng = g.rng.fork("spires");
  // light from the sun's side (-X) and from above
  const paint = (tone: Color) => (n: Vec3, t: number) =>
    shade(tone, (0.8 + 0.3 * Math.max(0, -n[0] * 0.8 + n[2] * 0.4) + 0.12 * t) * (1 + rng.jitter(0.05)));
  const pinnacle = (s: SpireSpec, tone: Color) => {
    const y = loginGroundY(s.x, s.z) - 1.5;
    spike(g, rng, {
      base: [s.x, y, s.z],
      dir: 1,
      length: s.h + 1.5,
      radius: s.r,
      sides: 5,
      rings: [0.3 + rng.jitter(0.06), 0.66 + rng.jitter(0.06)],
      lean: [rng.jitter(0.06), rng.jitter(0.04)],
      blunt: 0.12 + rng.next() * 0.1,
      paint: paint(tone),
    });
    // a shoulder beside most pinnacles
    if (rng.chance(0.7)) {
      const side = rng.sign();
      spike(g, rng, {
        base: [s.x + side * s.r * rng.range(0.9, 1.3), y, s.z + rng.jitter(s.r * 0.5)],
        dir: 1,
        length: s.h * rng.range(0.35, 0.6) + 1.5,
        radius: s.r * rng.range(0.6, 0.85),
        sides: 5,
        rings: [0.45],
        blunt: 0.2,
        paint: paint(shade(tone, 0.92)),
      });
    }
  };
  /** A ridge: a zigzag wall of facets along a polyline, facing the camera (+Z side). */
  const ridge = (pts: [x: number, z: number, h: number][], tone: Color, thick: number) => {
    const top: Vec3[] = [],
      foot: Vec3[] = [],
      back: Vec3[] = [];
    for (const [x, z, h] of pts) {
      const y0 = loginGroundY(x, z);
      top.push([x + rng.jitter(1.5), y0 + h * rng.range(0.85, 1.1), z]);
      foot.push([x + rng.jitter(2), y0 - 2, z + thick]);
      back.push([x, y0 - 2, z - thick]);
    }
    const toCam: Vec3 = [0, 0.35, 1];
    for (let k = 0; k < pts.length - 1; k++) {
      const p = paint(tone);
      const nrm = (a: Vec3, b: Vec3, c: Vec3) => {
        const n = norm(cross(sub(b, a), sub(c, a)));
        return dot(n, toCam) < 0 ? scl(n, -1) : n;
      };
      triToward(g, foot[k], foot[k + 1], top[k + 1], toCam, p(nrm(foot[k], foot[k + 1], top[k + 1]), 0.3));
      triToward(g, foot[k], top[k + 1], top[k], toCam, p(nrm(foot[k], top[k + 1], top[k]), 0.7));
      // far side (seen only from other framings): keep the silhouette closed
      triToward(g, back[k], top[k], top[k + 1], [0, 0.35, -1], shade(tone, 0.7));
      triToward(g, back[k], top[k + 1], back[k + 1], [0, 0.35, -1], shade(tone, 0.7));
    }
  };
  if (layer === "near") {
    // the gap around x = -22 .. -30 (seen from the camera) is the sun's
    for (const s of [
      { x: -11.4, z: -34, h: 13, r: 2.6 },
      { x: -16.7, z: -54, h: 17, r: 3.2 },
      { x: -35, z: -39, h: 10, r: 3.0 },
      { x: -37.8, z: -64, h: 15, r: 3.6 },
      { x: -35, z: -27, h: 6.5, r: 2.4 },
      { x: -9.5, z: -22, h: 6, r: 2.2 },
    ])
      pinnacle(s, cfg.tone);
  } else if (layer === "mid") {
    for (const s of [
      { x: -22, z: -78, h: 16, r: 5.0 },
      { x: -12, z: -96, h: 22, r: 5.5 },
      { x: -50, z: -88, h: 13, r: 5.0 },
      { x: -58, z: -70, h: 14, r: 5.0 },
      { x: -78, z: -84, h: 12, r: 5.5 },
      { x: -96, z: -60, h: 17, r: 5.5 },
    ])
      pinnacle(s, cfg.tone);
    ridge(
      [
        [-124, -66, 6],
        [-108, -72, 11],
        [-92, -78, 7],
        [-76, -84, 10],
        [-62, -90, 5],
        [-48, -96, 3],
        [-36, -100, 2.5],
        [-26, -104, 5],
        [-14, -108, 9],
        [0, -110, 6],
      ],
      shade(cfg.tone, 0.95),
      7,
    );
  } else {
    for (const s of [
      { x: -22, z: -186, h: 30, r: 9 },
      { x: -104, z: -150, h: 24, r: 9 },
      { x: -134, z: -122, h: 20, r: 9 },
      { x: -2, z: -192, h: 22, r: 8 },
    ])
      pinnacle(s, cfg.tone);
    ridge(
      [
        [-190, -84, 10],
        [-172, -106, 20],
        [-154, -126, 13],
        [-136, -144, 22],
        [-118, -160, 14],
        [-100, -172, 18],
        [-86, -182, 12],
        [-72, -188, 12],
        [-58, -194, 8.5],
        [-44, -198, 13],
        [-28, -200, 20],
        [-10, -200, 15],
        [10, -198, 22],
        [30, -194, 16],
      ],
      cfg.tone,
      10,
    );
  }
  placeInSet(m, g);
  return m;
}

/* =========================================================================================
 * Dead trees
 * ========================================================================================= */

/** Where a tree's trunk stands: [x, z, yaw, scale]. */
type TreeSpot = readonly [x: number, z: number, yaw: number, scale: number];

function buildTree(id: "a" | "b", spots: readonly TreeSpot[]): Model {
  const m = new Model(`tl_env_login_tree_${id}_v01`, {
    notes:
      id === "a"
        ? "Login dead tree A: tall leaning trunk, long bare limbs reaching to +X"
        : "Login dead tree B: short forked snag",
    budget: 520,
  });
  const g = new MeshBuilder(m.name);
  const rng = g.rng.fork("tree");
  const bark = () => shade(C.bark, 1 + rng.jitter(0.12));
  /** One limb: a bent tapering tube; returns its points and radii for the children. */
  const limb = (start: Vec3, dir: Vec3, length: number, r0: number, segs: number, sides: number, up: number): { pts: Vec3[]; rad: number[] } => {
    const pts: Vec3[] = [start];
    const rad: number[] = [r0];
    let d = norm(dir);
    let p = start;
    for (let k = 1; k <= segs; k++) {
      d = norm([d[0] + rng.jitter(0.32), d[1] + up + rng.jitter(0.22), d[2] + rng.jitter(0.32)]);
      p = add(p, scl(d, (length / segs) * rng.range(0.85, 1.15)));
      pts.push(p);
      rad.push(Math.max(0.012, r0 * (1 - (0.82 * k) / segs)));
    }
    g.tube(pts, { radius: rad, sides, caps: true, color: bark });
    return { pts, rad };
  };
  const grow = (parent: { pts: Vec3[]; rad: number[] }, depth: number, count: number, spread: Vec3) => {
    for (let c = 0; c < count; c++) {
      const k = rng.int(1, parent.pts.length - 2 > 0 ? parent.pts.length - 2 : 1);
      const base = parent.pts[k];
      const along = norm(sub(parent.pts[k + 1] ?? parent.pts[k], parent.pts[k - 1]));
      const side = norm([spread[0] + rng.jitter(0.8), spread[1] + rng.jitter(0.35), spread[2] + rng.jitter(0.8)]);
      const dir = norm(add(scl(along, 0.55), scl(side, 0.85)));
      const length = (depth === 1 ? 4.0 : 1.9) * rng.range(0.75, 1.2) * (id === "a" ? 1 : 0.62);
      const child = limb(base, dir, length, parent.rad[k] * (depth === 1 ? 0.7 : 0.62), depth === 1 ? 3 : 2, depth === 1 ? 4 : 3, 0.1);
      if (depth === 1) grow(child, 2, id === "a" ? 2 : 1, [side[0], 0.4, side[2]]);
    }
  };
  if (id === "a") {
    const trunk = limb([0, 0, 0], [0.16, 1, 0.02], 8.6, 0.27, 5, 6, 0.55);
    grow(trunk, 1, 3, [1, 0.3, 0.1]);
    grow(trunk, 1, 1, [-0.8, 0.5, -0.3]);
    // roots flare
    for (const a of [20, 140, 255])
      g.tube(
        [
          [0, 0.45, 0],
          [Math.cos(a * DEG) * 0.6, 0.06, Math.sin(a * DEG) * 0.6],
        ],
        { radius: [0.22, 0.09], sides: 4, color: bark },
      );
  } else {
    const trunk = limb([0, 0, 0], [-0.08, 1, 0.05], 3.4, 0.24, 3, 5, 0.6);
    const tip = trunk.pts[trunk.pts.length - 2];
    const r = trunk.rad[trunk.rad.length - 2];
    const forkA = limb(tip, [0.7, 0.8, 0.1], 2.4, r * 0.75, 3, 4, 0.2);
    const forkB = limb(tip, [-0.75, 0.7, -0.2], 2.0, r * 0.7, 3, 4, 0.2);
    grow(forkA, 2, 2, [0.9, 0.3, 0.2]);
    grow(forkB, 2, 2, [-0.9, 0.3, -0.2]);
    grow(trunk, 1, 1, [0.6, 0.3, -0.6]);
  }
  // Usual pivot (bottom centre of the bounds); the trunk's foot is then off-centre, so each
  // placement is shifted to put the foot (not the pivot) on its spot, sunk a little into the ground.
  const bb = g.bounds();
  if (!bb) throw new Error(`${m.name}: empty`);
  const foot: Vec3 = [-(bb.min[0] + bb.max[0]) / 2, -bb.min[1], -(bb.min[2] + bb.max[2]) / 2];
  m.geo.add(g, { at: foot });
  m.anchor("trunk", foot);
  m.meta = {
    placements: spots.map(([x, z, yaw, scale]): LoginPlacement => {
      const c = Math.cos(yaw * DEG),
        sn = Math.sin(yaw * DEG);
      const fx = (foot[0] * c + foot[2] * sn) * scale,
        fz = (-foot[0] * sn + foot[2] * c) * scale;
      return { at: [r3(x - fx), r3(loginGroundY(x, z) - (foot[1] + 0.2) * scale), r3(z - fz)], yaw, scale };
    }),
  };
  return m;
}

/* =========================================================================================
 * Sky and sun
 * ========================================================================================= */

/** Where the camera roughly stands: centre of the sky dome. */
const SKY_CENTRE: Vec3 = [-7, 0, 21];
const SKY_RADIUS = 262;
/** Sun direction from the dome's centre: azimuth from -Z toward -X (deg), elevation (deg). */
const SUN = { azimuth: -11.2, elevation: 3.8, distance: 238, radius: 6.4 };
const skyDir = (azDeg: number, elDeg: number): Vec3 => [
  Math.sin(azDeg * DEG) * Math.cos(elDeg * DEG),
  Math.sin(elDeg * DEG),
  -Math.cos(azDeg * DEG) * Math.cos(elDeg * DEG),
];

function buildSky(): Model {
  const m = new Model("tl_env_login_sky_v01", {
    notes: "Login sky: faceted dusk dome section (unlit), redder around the sun, a few cloud streaks",
    budget: 520,
  });
  const g = new MeshBuilder(m.name);
  const rng = g.rng.fork("sky");
  const AZ0 = -96,
    AZ1 = 84,
    NAZ = 15;
  const EL = [-5, 1.6, 4.6, 8.8, 14.5, 22.5, 34, 49, 67, 88];
  const stops: [number, Color][] = [
    [0, C.sky[0]],
    [5, C.sky[1]],
    [11, C.sky[2]],
    [22, C.sky[3]],
    [42, C.sky[4]],
    [70, C.sky[5]],
  ];
  const skyAt = (el: number): Color => {
    if (el <= stops[0][0]) return stops[0][1];
    for (let k = 1; k < stops.length; k++)
      if (el <= stops[k][0]) return mix(stops[k - 1][1], stops[k][1], (el - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
    return stops[stops.length - 1][1];
  };
  const sunDir = skyDir(SUN.azimuth, SUN.elevation);
  const V: Vec3[][] = [];
  const dirs: Vec3[][] = [];
  for (let i = 0; i <= NAZ; i++) {
    V.push([]);
    dirs.push([]);
    for (let j = 0; j < EL.length; j++) {
      const edge = i === 0 || i === NAZ;
      const az = lerp(AZ0, AZ1, i / NAZ) + (edge ? 0 : rng.jitter(3.2));
      const el = EL[j] + (j === 0 || j === EL.length - 1 ? 0 : rng.jitter((EL[j + 1] - EL[j]) * 0.22));
      const d = skyDir(az, el);
      dirs[i].push(d);
      V[i].push(add(SKY_CENTRE, scl(d, SKY_RADIUS)));
    }
  }
  const face = (a: Vec3, b: Vec3, c: Vec3) => {
    const ctr = norm(sub(centroid3([a, b, c]), SKY_CENTRE));
    const el = Math.asin(clamp(ctr[1], -1, 1)) / DEG;
    const angSun = Math.acos(clamp(dot(ctr, sunDir), -1, 1)) / DEG;
    const red = 0.5 * Math.exp(-((angSun / 11) ** 2)) + 0.16 * Math.exp(-((angSun / 40) ** 2)) * (1 - smoothstep(3, 22, el));
    const col = shade(mix(skyAt(el), C.skySun, red), 1 + rng.jitter(0.035));
    triToward(g, a, b, c, scl(ctr, -1), col, { mat: "glow" });
  };
  for (let i = 0; i < NAZ; i++)
    for (let j = 0; j < EL.length - 1; j++) {
      const [a, b, c, d] = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]];
      if (hash2(i, j, 9) < 0.5) {
        face(a, b, c);
        face(a, c, d);
      } else {
        face(a, b, d);
        face(b, c, d);
      }
    }
  // Cloud streaks: long flat shards in front of the dome, near the sun.
  const streak = (az: number, el: number, wAz: number, hEl: number, tone: Color) => {
    const R = SKY_RADIUS - 6;
    const P = (da: number, de: number) => add(SKY_CENTRE, scl(skyDir(az + da, el + de), R));
    const pts = [
      P(-wAz, rng.jitter(hEl * 0.3)),
      P(-wAz * 0.35, -hEl * rng.range(0.7, 1)),
      P(wAz * 0.5, -hEl * rng.range(0.4, 0.9)),
      P(wAz, rng.jitter(hEl * 0.3)),
      P(wAz * 0.3, hEl * rng.range(0.6, 1)),
      P(-wAz * 0.45, hEl * rng.range(0.5, 0.9)),
    ];
    const inward = scl(skyDir(az, el), -1);
    for (let k = 1; k < pts.length - 1; k++)
      triToward(g, pts[0], pts[k], pts[k + 1], inward, shade(tone, 1 + rng.jitter(0.06)), { mat: "glow" });
  };
  streak(SUN.azimuth - 9, SUN.elevation + 5.4, 11, 0.8, C.cloud);
  streak(SUN.azimuth + 8, SUN.elevation + 3.4, 8, 0.6, mix(C.cloud, C.skySun, 0.5));
  streak(SUN.azimuth + 2, SUN.elevation + 8.6, 14, 0.9, mix(C.cloud, C.sky[2], 0.45));
  streak(SUN.azimuth - 24, SUN.elevation + 2.6, 9, 0.55, mix(C.cloud, C.sky[1], 0.4));
  streak(SUN.azimuth + 27, SUN.elevation + 6.2, 10, 0.7, mix(C.cloud, C.sky[2], 0.6));
  placeInSet(m, g);
  return m;
}

function buildSun(): Model {
  const m = new Model("tl_fx_login_sun_v01", {
    notes: "Login sun: low red disc with a darker halo ring (unlit), faces +Z",
    budget: 80,
  });
  const g = m.geo;
  const N = 14;
  const R = SUN.radius;
  const ring = (r: number, z: number): Vec3[] =>
    Array.from({ length: N }, (_, k) => {
      const a = ((k + 0.5) / N) * Math.PI * 2;
      return [Math.cos(a) * r, R * 1.5 + Math.sin(a) * r, z] as Vec3;
    });
  const disc = ring(R, 0.2);
  const halo = ring(R * 1.5, -0.2);
  const c: Vec3 = [0, R * 1.5, 0.2];
  const front: Vec3 = [0, 0, 1];
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    triToward(g, c, disc[k], disc[k1], front, C.sun, { mat: "glow", glow: 1.25 });
    triToward(g, disc[k], halo[k], halo[k1], front, C.sunHalo, { mat: "glow" });
    triToward(g, disc[k], halo[k1], disc[k1], front, C.sunHalo, { mat: "glow" });
  }
  const d = skyDir(SUN.azimuth, SUN.elevation);
  const centre = add(SKY_CENTRE, scl(d, SUN.distance));
  centre[1] += 4.1; // the camera's eye height
  m.meta = {
    placements: [{ at: [r3(centre[0]), r3(centre[1] - R * 1.5), r3(centre[2])], yaw: r3(Math.atan2(-d[0], -d[2]) / DEG), scale: 1 }],
  };
  return m;
}

/* =========================================================================================
 * Placements of the instanced pieces (set space)
 * ========================================================================================= */

/** Boulders: mid-ground on both sides of the path, near-black ones in the frame's bottom corners. */
const BOULDERS: Record<"a" | "b" | "c" | "dark", LoginPlacement[]> = {
  a: [put(-12.6, 9.5, 20, 1.0), put(-18.5, 4.5, 250, 1.25), put(-22, 14, 80, 0.9), put(-0.4, 5.6, 300, 0.6), put(-15, -8, 130, 1.4)],
  b: [put(-14.8, 14.2, 200, 0.8), put(3.9, 6.2, 30, 0.8), put(-24, -3, 110, 1.5), put(-30, 9, 10, 1.2)],
  c: [put(-10.7, 14.4, 60, 0.75), put(-2.6, 12.6, 170, 0.8), put(-9.6, 6.4, 320, 0.9), put(-4.6, 3.2, 90, 0.7), put(-16.5, 9.2, 215, 1.0)],
  dark: [put(-12.6, 17.0, 35, 0.8, 0.3), put(-2.9, 15.8, 210, 0.62, 0.3), put(-16.2, 16.2, 120, 0.7, 0.2), put(0.4, 10.4, 300, 0.7, 0.3)],
};
/** Trees: one big one at the frame's left edge, snags scattered into the haze. */
const TREES: Record<"a" | "b", TreeSpot[]> = {
  a: [
    [-12.3, 10.6, 8, 1.2],
    [-44, -28, 200, 1.5],
  ],
  b: [
    [-13.4, 4.6, 40, 1.0],
    [-21.5, -6, 150, 1.3],
    [-30.5, -16, 280, 1.6],
    [-10.4, -14, 95, 1.2],
    [-58, -40, 20, 2.2],
  ],
};

/* =========================================================================================
 * Entry
 * ========================================================================================= */

/** Triangles of the whole set as placed (every instance counted). */
export function loginSetTriangles(models: Model[]): number {
  let n = 0;
  for (const m of models) n += m.stats().triangles * ((m.meta.placements as unknown[] | undefined)?.length ?? 1);
  return n;
}

export default function build(): Model[] {
  const models = [
    buildGround(),
    buildCaveMouth(),
    buildBoulder("a", BOULDERS.a),
    buildBoulder("b", BOULDERS.b),
    buildBoulder("c", BOULDERS.c),
    buildBoulder("dark", BOULDERS.dark),
    buildSpires("near"),
    buildSpires("mid"),
    buildSpires("far"),
    buildTree("a", TREES.a),
    buildTree("b", TREES.b),
    buildSky(),
    buildSun(),
  ];
  const total = loginSetTriangles(models);
  if (total > LOGIN_TRIANGLE_BUDGET) throw new Error(`login set: ${total} triangles as placed, budget ${LOGIN_TRIANGLE_BUDGET}`);
  return models;
}
