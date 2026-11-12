/**
 * Environment group — the cave of "Hang trú thua" (concept v3: 01-environment main panel,
 * 02 top panel; style: design/references/user-cave-style-reference.png).
 *
 * CAVE SPACE (floor, wall modules, ceiling)
 * - These shell pieces are authored in cave space: origin = campfire centre on the floor,
 *   X right, Y up, Z toward the viewer of the concept main panel. Instantiate every shell piece
 *   at (0, 0, 0) with no rotation and they form one closed cave (floor + 6 walls + ceiling).
 *   Their bounds are therefore not centred on their own pivot (build prints a pivot warning for
 *   the walls and the ceiling; that is expected).
 * - Angle convention: theta is measured around +Y starting at +X toward -Z, i.e. the direction
 *   of theta is (cos theta, 0, -sin theta) — the same as rotating +X by setEulerAngles(0, theta, 0).
 *   Wall module k (tl_env_cave_wall_0k_v01, k = 0..5) covers theta in [60k, 60k + 60) degrees:
 *   00 = [0, 60) starts at +X, 01 = [60, 120) centred on -Z (contains the cave exit tunnel),
 *   02 = [120, 180) and 03 = [180, 240) meet at -X, 04 = [240, 300) centred on +Z,
 *   05 = [300, 360) closes back to +X. Neighbouring modules share their boundary vertices exactly.
 * - The exit tunnel mouth is a 3.5 m wide x 3.6 m high opening in the plane z = -19.3, centred on
 *   x = 0, running ~6.4 m further toward -Z (darker interior, closed dark end).
 *
 * PROPS (stalactites, stalagmites, rock clusters, small stones, puddle, tunnel frame) pivot at
 * bottom centre and face +Z. Stalactites are modelled hanging (tip at y = 0, ceiling attachment at
 * the top, anchor "attach").
 */
import { Model, MeshBuilder, PALETTE as P, Rng, mix, shade, type Color, type PrimOpts, type Vec2, type Vec3 } from "../lib.js";

/* =========================================================================================
 * Small maths helpers (local; lib.ts keeps its own private)
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
const centroid3 = (pts: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  return c;
};
/** Direction of angle theta (degrees) around +Y, starting at +X toward -Z. */
const dirOf = (thetaDeg: number): Vec3 => [Math.cos(thetaDeg * DEG), 0, -Math.sin(thetaDeg * DEG)];
const polar = (thetaDeg: number, r: number, y: number): Vec3 => {
  const d = dirOf(thetaDeg);
  return [d[0] * r, y, d[2] * r];
};
/** Y rotation (deg) that turns a model's +Z toward the cave centre when it stands at angle theta. */
const faceCentreRotY = (thetaDeg: number) => thetaDeg - 90;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0;

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

/** Bowyer–Watson Delaunay triangulation of 2D points. Returns index triples (any winding). */
function delaunay(pts: Vec2[]): [number, number, number][] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const dm = Math.max(maxX - minX, maxY - minY) * 20;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const all: Vec2[] = [...pts, [mx - dm, my - dm], [mx, my + dm], [mx + dm, my - dm]];
  const n = pts.length;
  interface T {
    a: number;
    b: number;
    c: number;
    cx: number;
    cy: number;
    r2: number;
  }
  const circ = (a: number, b: number, c: number): T => {
    const [ax, ay] = all[a];
    const [bx, by] = all[b];
    const [cx, cy] = all[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return { a, b, c, cx: 0, cy: 0, r2: Infinity };
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { a, b, c, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: T[] = [circ(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i];
    const keep: T[] = [];
    const edges = new Map<string, [number, number]>();
    for (const t of tris) {
      if ((px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2 - 1e-9) {
        for (const [u, v] of [
          [t.a, t.b],
          [t.b, t.c],
          [t.c, t.a],
        ]) {
          const key = u < v ? `${u},${v}` : `${v},${u}`;
          if (edges.has(key)) edges.delete(key);
          else edges.set(key, [u, v]);
        }
      } else keep.push(t);
    }
    tris = keep;
    for (const [u, v] of edges.values()) tris.push(circ(u, v, i));
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

/** Poisson-ish dart throwing inside a disc; minDist(x, z) may vary with position. */
function scatter(
  rng: Rng,
  radius: number,
  minDist: (x: number, z: number) => number,
  seeds: Vec2[],
  attempts: number,
): Vec2[] {
  const pts: Vec2[] = seeds.slice();
  for (let i = 0; i < attempts; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * radius;
    const p: Vec2 = [Math.cos(a) * r, Math.sin(a) * r];
    const d = minDist(p[0], p[1]);
    let ok = true;
    for (const q of pts)
      if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < d * d) {
        ok = false;
        break;
      }
    if (ok) pts.push(p);
  }
  return pts;
}

/** Emit one triangle wound so its normal points along `want`, with an explicit colour. */
function triToward(b: MeshBuilder, p0: Vec3, p1: Vec3, p2: Vec3, want: Vec3, color: Color): void {
  const n = cross(sub(p1, p0), sub(p2, p0));
  if (dot(n, want) < 0) b.tri(p0, p2, p1, { color });
  else b.tri(p0, p1, p2, { color });
}
const triNormal = (p0: Vec3, p1: Vec3, p2: Vec3): Vec3 => norm(cross(sub(p1, p0), sub(p2, p0)));

/** Weighted pick. */
function pickW<T>(rng: Rng, items: readonly [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [it, w] of items) {
    x -= w;
    if (x <= 0) return it;
  }
  return items[items.length - 1][0];
}

/* =========================================================================================
 * Cave dimensions (cave space)
 * ========================================================================================= */

const SEGMENTS = 6;
const SEG_DEG = 360 / SEGMENTS;
const TUNNEL_SEG = 1; // [60, 120) centred on -Z
const FLOOR_R = 21;
const FLAT_R = 14; // walkable centre: |y| < 0.05
const WALL_R0 = 19.4; // mean inner radius of the walls at floor level
const WALL_TOP = 13.6; // mean height of the top row of wall vertices
const WALL_LEAN = 3.0; // the wall leans this much inward at the top
const ROWS = [0, 2.8, 6.4, 10.0, WALL_TOP];
const ROW_JIT = [0, 0.75, 1.0, 1.0, 0.4];
const ROW_FOLD = [0.7, 1.0, 1.0, 0.8, 0.35];
const CEIL_APEX = 14.0;
const CEIL_R = 20.5;
const CEIL_DROP = 3.0;
const TUN = { halfW: 1.75, shoulder: 2.9, apex: 3.6, mouthZ: -19.3, depth: 6.4, floorY: 0.04 };
const TUN_DELTA = Math.atan(TUN.halfW / -TUN.mouthZ) / DEG;

const wallProfileR = (y: number) => WALL_R0 - WALL_LEAN * Math.pow(clamp(y / WALL_TOP, 0, 1.2), 1.5);
const ceilingBaseY = (r: number) => CEIL_APEX - CEIL_DROP * Math.pow(clamp(r / CEIL_R, 0, 1.2), 2.5);

/* Rock tones (sRGB). Walls are ochre/brown planes; free-standing boulders are greyer. */
const WALL_TONES: [Color, number][] = [
  [P.ochre, 0.34],
  [P.rock, 0.3],
  [P.rockLight, 0.12],
  [mix(P.ochre, P.earth, 0.5), 0.16],
  [mix(P.rock, P.rockDark, 0.5), 0.08],
];
const BOULDER_TONES: Color[] = [
  mix(P.pebble, P.metal, 0.4),
  mix(P.pebble, P.woodGrey, 0.55),
  mix(P.pebble, P.rock, 0.2),
];

/* =========================================================================================
 * Floor
 * ========================================================================================= */

/** Floor height at (x, z): |y| < 0.05 inside r = 14, rising gently toward the walls (not into the tunnel). */
export function floorY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const n = vnoise(x / 3.4, z / 3.4, 11) * 0.6 + vnoise(x / 1.4, z / 1.4, 12) * 0.4;
  let y = 0.0175 + 0.0165 * n;
  const rim = smoothstep(14.5, FLOOR_R, r);
  const tunnelMask = z < 0 ? smoothstep(2.7, 7.5, Math.abs(x)) : 1;
  y += (0.5 * rim * rim + 0.06 * rim * vnoise(x / 2.1, z / 2.1, 13)) * tunnelMask;
  return Math.max(0, y);
}

function buildFloor(): Model {
  const m = new Model("tl_env_cave_floor_v01", {
    budget: 3000,
    notes:
      "Cave floor disc r=21 m, cave space (origin = campfire, place at 0,0,0). Walkable centre r<14 is " +
      "nearly flat (0<=y<0.035); rises to ~0.5 m under the walls (buries the wall bases), stays flat at " +
      "the tunnel mouth (-Z). Large dark-earth facets.",
  });
  const rng = new Rng("tl_env_cave_floor/points");
  const seeds: Vec2[] = [];
  const nb = 56;
  for (let k = 0; k < nb; k++) {
    const a = ((k + 0.5) / nb) * 360 + rng.jitter(1.2);
    const p = polar(a, FLOOR_R, 0);
    seeds.push([p[0], p[2]]);
  }
  // Keep the tunnel mouth strip clean (the tunnel floor sits 4 cm above these).
  for (const z of [-19.55, -20.45]) for (const x of [-3.0, -2.4, -1.75, 0, 1.75, 2.4, 3.0]) seeds.push([x, z]);
  for (const x of [-1.75, 1.75]) seeds.push([x, -20.9]);
  seeds.push([0, 0]);
  const pts = scatter(
    rng,
    FLOOR_R - 0.9,
    (x, z) => {
      const r = Math.hypot(x, z);
      if (z < -18.8 && Math.abs(x) < 3) return 1.0;
      return 1.85 + 0.9 * smoothstep(9, FLOOR_R, r);
    },
    seeds,
    5000,
  );
  const verts: Vec3[] = pts.map(([x, z]) => [x, floorY(x, z), z]);
  const paint = new Rng("tl_env_cave_floor/paint");
  for (const [a, b, c] of delaunay(pts)) {
    const p0 = verts[a],
      p1 = verts[b],
      p2 = verts[c];
    const ctr = centroid3([p0, p1, p2]);
    const r = Math.hypot(ctr[0], ctr[2]);
    const patch = vnoise(ctr[0] / 6.5, ctr[2] / 6.5, 21) * 0.7 + vnoise(ctr[0] / 2.6, ctr[2] / 2.6, 22) * 0.3;
    let col = mix(P.dirt, P.earth, clamp(0.55 + 0.6 * patch, 0, 1));
    // larger lighter, dustier patches (smooth noise, so neighbouring facets agree)
    col = mix(col, P.ochre, 0.22 * smoothstep(0.15, 0.75, patch));
    const k = (1 + paint.jitter(0.045)) * (1 - 0.28 * smoothstep(16.5, 20.5, r));
    triToward(m.geo, p0, p1, p2, [0, 1, 0], shade(col, k));
  }
  m.collider = { type: "cylinder", center: [0, -0.25, 0], radius: FLOOR_R, height: 0.5 };
  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    radius: FLOOR_R,
    flatRadius: FLAT_R,
    heightNote: "y in [0, 0.035] for r < 14; rises toward the walls (~0.25 m at r = 19, ~0.5 m at r = 21)",
  };
  return m;
}

/* =========================================================================================
 * Walls: one global ring of fold columns, split into 6 modules (shared boundary vertices)
 * ========================================================================================= */

interface WallCol {
  theta: number;
  tag: "" | "boundary" | "tunnel_px" | "tunnel_c" | "tunnel_nx";
  fold: number;
  /** Angular lean of the fold over the full wall height (deg): folds run slightly diagonal. */
  drift: number;
  tone: Color;
}
interface WallField {
  cols: WallCol[];
  /** V[col][row] */
  V: Vec3[][];
}

function buildWallField(): WallField {
  const rng = new Rng("tl_env_cave/wall_field");
  const required = new Map<number, WallCol["tag"]>();
  for (let k = 0; k < SEGMENTS; k++) required.set(k * SEG_DEG, "boundary");
  required.set(90 - TUN_DELTA, "tunnel_px");
  required.set(90, "tunnel_c");
  required.set(90 + TUN_DELTA, "tunnel_nx");
  const req = [...required.keys()].sort((a, b) => a - b);
  const cols: WallCol[] = [];
  const col = (theta: number, tag: WallCol["tag"]): WallCol => ({ theta, tag, fold: 0, drift: 0, tone: P.ochre });
  for (let i = 0; i < req.length; i++) {
    const a = req[i];
    const b = i + 1 < req.length ? req[i + 1] : 360;
    cols.push(col(a, required.get(a)!));
    const n = Math.max(1, Math.round((b - a) / rng.range(5.6, 7.4)));
    const step = (b - a) / n;
    for (let t = 1; t < n; t++) cols.push(col(a + t * step + rng.jitter(step * 0.22), ""));
  }
  // Fold pattern: mostly alternating ridge / crevice, with wide flat faces and deep narrow crevices.
  let prevCrevice = rng.chance(0.5);
  for (const c of cols) {
    const crevice = prevCrevice ? rng.chance(0.16) : rng.chance(0.72);
    c.fold = crevice ? rng.range(0.8, 1.8) : -rng.range(0.15, 1.1);
    c.drift = c.tag ? 0 : rng.jitter(1.4);
    c.tone = pickW(rng, WALL_TONES);
    prevCrevice = crevice;
  }
  // The rock around the exit protrudes like a portal buttress.
  for (const c of cols) {
    const d = Math.abs(c.theta - 90);
    if (c.tag.startsWith("tunnel")) c.fold = -0.35;
    else if (d < 13) c.fold = -rng.range(0.55, 0.95);
  }
  const V: Vec3[][] = cols.map((c) => {
    const k = 1 + rng.jitter(0.08);
    return ROWS.map((y0, i) => {
      const y = i === 0 ? 0 : y0 + rng.jitter(ROW_JIT[i]);
      const fixed = c.tag !== "";
      const th = c.theta + (fixed ? 0 : c.drift * (y / WALL_TOP) + rng.jitter(i === 0 ? 0.35 : 0.5));
      let r = wallProfileR(y) + c.fold * ROW_FOLD[i] * k * (1 + rng.jitter(0.08)) + rng.jitter(0.12);
      if (i === 0) r = Math.min(r, FLOOR_R - 0.35);
      return polar(th, r, y);
    });
  });
  // Keep every row strictly ordered in angle (no folded-over faces).
  const angle = (p: Vec3) => {
    const a = Math.atan2(-p[2], p[0]) / DEG;
    return a < -1e-9 ? a + 360 : a;
  };
  for (let i = 0; i < ROWS.length; i++)
    for (let j = 1; j < cols.length; j++) {
      if (cols[j].tag) continue;
      const prev = angle(V[j - 1][i]);
      const next = j + 1 < cols.length ? angle(V[j + 1][i]) : 360;
      const a = angle(V[j][i]);
      const fixedA = clamp(a, prev + 1.4, next - 1.4);
      if (fixedA !== a) {
        const r = Math.hypot(V[j][i][0], V[j][i][2]);
        V[j][i] = polar(fixedA, r, V[j][i][1]);
      }
    }
  const jPx = cols.findIndex((c) => c.tag === "tunnel_px");
  const jC = cols.findIndex((c) => c.tag === "tunnel_c");
  const jNx = cols.findIndex((c) => c.tag === "tunnel_nx");
  V[jPx][0] = [TUN.halfW, 0, TUN.mouthZ];
  V[jPx][1] = [TUN.halfW, TUN.shoulder, TUN.mouthZ];
  V[jNx][0] = [-TUN.halfW, 0, TUN.mouthZ];
  V[jNx][1] = [-TUN.halfW, TUN.shoulder, TUN.mouthZ];
  V[jC][0] = [0, 0, TUN.mouthZ];
  V[jC][1] = [0, TUN.apex, TUN.mouthZ];
  return { cols, V };
}

/** Column indices of module s, including the shared closing boundary column. */
function segmentColumns(field: WallField, s: number): number[] {
  const a = s * SEG_DEG;
  const b = (s + 1) * SEG_DEG;
  const idx: number[] = [];
  field.cols.forEach((c, j) => {
    if (c.theta >= a - 1e-9 && c.theta < b - 1e-9) idx.push(j);
  });
  const end = s + 1 < SEGMENTS ? field.cols.findIndex((c) => Math.abs(c.theta - b) < 1e-9) : 0;
  return [...idx, end];
}

/** Inner wall radius at floor level for angle theta (interpolated between columns). */
function wallRadiusAt(field: WallField, theta: number, row = 0): number {
  const t = ((theta % 360) + 360) % 360;
  const cols = field.cols;
  for (let j = 0; j < cols.length; j++) {
    const a = cols[j].theta;
    const b = j + 1 < cols.length ? cols[j + 1].theta : 360;
    if (t >= a && t < b) {
      const ra = Math.hypot(field.V[j][row][0], field.V[j][row][2]);
      const jn = (j + 1) % cols.length;
      const rb = Math.hypot(field.V[jn][row][0], field.V[jn][row][2]);
      return lerp(ra, rb, (t - a) / (b - a));
    }
  }
  return WALL_R0;
}

/** Colour of a wall facet: column tone, darker in crevices, toward the ceiling and when facing away. */
function wallColor(rng: Rng, tone: Color, ctr: Vec3, n: Vec3): Color {
  const r = Math.hypot(ctr[0], ctr[2]);
  const recess = r - wallProfileR(ctr[1]);
  const tRec = smoothstep(-0.2, 1.4, recess);
  const tH = smoothstep(3.0, WALL_TOP, ctr[1]);
  const kRec = 1 - 0.5 * tRec;
  const kH = 1 - 0.35 * tH;
  const inward = norm([-ctr[0], 0, -ctr[2]]);
  const kF = 0.7 + 0.3 * clamp(dot(n, inward), 0, 1);
  // crevices and the upper wall also lose saturation (concept: cool grey-brown shadows)
  const base = mix(tone, P.shadow, 0.18 * tRec + 0.2 * tH);
  return shade(base, kRec * kH * kF * (1 + rng.jitter(0.045)));
}

/** Convex "slab" hull: flat-topped shelf rock (concept: ledge behind the campfire). */
function slabPoints(rng: Rng, w: number, h: number, d: number): Vec3[] {
  const pts: Vec3[] = [];
  const nb = 6;
  const off = rng.next() * 360;
  for (let k = 0; k < nb; k++) {
    const a = (off + (k * 360) / nb + rng.jitter(18)) * DEG;
    pts.push([(Math.cos(a) * w) / 2, 0, (Math.sin(a) * d) / 2]);
  }
  for (let k = 0; k < nb; k++) {
    const a = (off + 25 + (k * 360) / nb + rng.jitter(18)) * DEG;
    const inset = rng.range(0.7, 0.86);
    pts.push([((Math.cos(a) * w) / 2) * inset, h + rng.jitter(0.035), ((Math.sin(a) * d) / 2) * inset]);
  }
  for (let k = 0; k < 3; k++) {
    const a = (off + 60 + k * 120 + rng.jitter(25)) * DEG;
    pts.push([((Math.cos(a) * w) / 2) * 1.04, h * rng.range(0.35, 0.65), ((Math.sin(a) * d) / 2) * 1.04]);
  }
  return pts;
}

/**
 * Chunky angular block (hull of a jittered, bevelled box): big flat faces like the concept's
 * ledge rocks and portal stones. Bottom at y = 0, centred on x/z.
 */
function blockPoints(
  rng: Rng,
  w: number,
  h: number,
  d: number,
  o: { taper?: number; bevel?: number; jit?: number; flatBottom?: boolean; slope?: number } = {},
): Vec3[] {
  const slope = o.slope ?? 0;
  const taper = o.taper ?? 0.82;
  const bevel = o.bevel ?? 0.22;
  const j = o.jit ?? 0.06;
  const pts: Vec3[] = [];
  for (const sy of [0, 1])
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const k = sy ? taper * rng.range(0.9, 1.08) : 1;
        const cx = ((sx * w) / 2) * k;
        const cz = ((sz * d) / 2) * k;
        const y = sy ? h * (1 - slope * sz) * (1 + rng.jitter(j)) : o.flatBottom === false ? rng.range(0, 0.08) * h : 0;
        pts.push([cx * (1 - bevel * rng.range(0.4, 1)) + rng.jitter(j * w), y, cz + rng.jitter(j * d)]);
        pts.push([cx + rng.jitter(j * w), y, cz * (1 - bevel * rng.range(0.4, 1)) + rng.jitter(j * d)]);
      }
  for (let k = 0; k < 4; k++) {
    const a = (k * 90 + 45 + rng.jitter(28)) * DEG;
    pts.push([Math.cos(a) * (w / 2) * 1.02, h * rng.range(0.3, 0.7), Math.sin(a) * (d / 2) * 1.02]);
  }
  return pts;
}

/** Paint function for boulders / ledges: lighter tops, darker undersides. */
function rockPaint(rng: Rng, tone: Color, topLift = 0.18, sideK = 1) {
  return (f: { normal: Vec3 }) => {
    const ny = f.normal[1];
    const base = ny > 0.55 ? mix(tone, P.worn, topLift) : ny < -0.3 ? shade(tone, 0.55) : shade(tone, sideK);
    return shade(base, 1 + rng.jitter(0.07));
  };
}

function buildWall(field: WallField, s: number): Model {
  const name = `tl_env_cave_wall_${String(s).padStart(2, "0")}_v01`;
  const a0 = s * SEG_DEG;
  const a1 = (s + 1) * SEG_DEG;
  const m = new Model(name, {
    budget: 3000,
    notes:
      `Cave wall module ${s} of ${SEGMENTS}: theta in [${a0}, ${a1}) deg, theta measured around +Y from +X ` +
      `toward -Z (dir = cos t, 0, -sin t). Cave space: place at 0,0,0 with no rotation; the 6 modules ` +
      `close the ring (inner face r~19.4 m at the floor, leaning to ~16.4 m at 13.6 m).` +
      (s === TUNNEL_SEG ? " Contains the exit tunnel (3.5 x 3.6 m mouth at z=-19.3, ~6.4 m deep)." : ""),
  });
  const b = m.geo;
  const rng = new Rng(`${name}/paint`);
  const js = segmentColumns(field, s);
  const isTunnelCol = (j: number) => field.cols[j].tag.startsWith("tunnel");
  let minR = Infinity;
  for (let q = 0; q < js.length - 1; q++) {
    const j0 = js[q];
    const j1 = js[q + 1];
    for (let i = 0; i < ROWS.length - 1; i++) {
      if (s === TUNNEL_SEG && i === 0 && isTunnelCol(j0) && isTunnelCol(j1)) continue; // the exit opening
      const pa = field.V[j0][i];
      const pb = field.V[j1][i];
      const pc = field.V[j1][i + 1];
      const pd = field.V[j0][i + 1];
      const tris: Vec3[][] = rng.chance(0.5)
        ? [
            [pa, pb, pc],
            [pa, pc, pd],
          ]
        : [
            [pa, pb, pd],
            [pb, pc, pd],
          ];
      for (const [p0, p1, p2] of tris) {
        const ctr = centroid3([p0, p1, p2]);
        const want: Vec3 = [-ctr[0], 0, -ctr[2]];
        let n = triNormal(p0, p1, p2);
        if (dot(n, want) < 0) n = scl(n, -1);
        triToward(b, p0, p1, p2, want, wallColor(rng, field.cols[j0].tone, ctr, n));
      }
      if (i === 0) minR = Math.min(minR, Math.hypot(pa[0], pa[2]), Math.hypot(pb[0], pb[2]));
    }
  }

  // Base ledges / boulders grown out of the wall: one long flat-topped shelf + 1-2 boulders.
  const ledgeRng = new Rng(`${name}/ledges`);
  const slots = s === TUNNEL_SEG ? [2, 0, 1] : ledgeRng.shuffle([0, 1, 2]);
  const nLedge = ledgeRng.int(2, 3);
  for (let k = 0; k < nLedge; k++) {
    const th = a0 + ((slots[k] + 0.5) / 3) * SEG_DEG + ledgeRng.jitter(4);
    if (s === TUNNEL_SEG && Math.abs(th - 90) < 18) continue;
    const shelf = k === 0;
    const w = shelf ? ledgeRng.range(4.2, 6.5) : ledgeRng.range(2.2, 3.6);
    const h = shelf ? ledgeRng.range(1.0, 1.7) : ledgeRng.range(1.5, 2.9);
    const d = shelf ? ledgeRng.range(2.2, 2.9) : ledgeRng.range(1.8, 2.6);
    const rW = wallRadiusAt(field, th);
    const r = rW - d * 0.28;
    const at = polar(th, r, 0);
    const rot: Vec3 = [0, faceCentreRotY(th) + ledgeRng.jitter(9), 0];
    const tone = pickW(ledgeRng, WALL_TONES);
    const pts = shelf
      ? blockPoints(ledgeRng, w, h, d, { taper: 0.78, bevel: 0.4, jit: 0.09, slope: 0.22 })
      : blockPoints(ledgeRng, w, h, d, { taper: 0.58, bevel: 0.42, jit: 0.12, slope: 0.15 });
    b.hull(pts, { at, rot, color: rockPaint(ledgeRng, tone, shelf ? 0.16 : 0.1) });
    // a loose rock leaning on the bigger ones
    if (ledgeRng.chance(0.6)) {
      const th2 = th + ((ledgeRng.sign() * (w / 2 / r)) / DEG) * ledgeRng.range(0.7, 1.0);
      const r2 = wallRadiusAt(field, th2) - d * 0.75;
      b.rock({
        size: [ledgeRng.range(0.8, 1.4), ledgeRng.range(0.55, 1.0), ledgeRng.range(0.7, 1.2)],
        points: 12,
        jitter: 0.24,
        flat: 0.2,
        align: "bottom",
        at: polar(th2, r2, 0),
        rot: [0, ledgeRng.range(0, 180), 0],
        color: rockPaint(ledgeRng, pickW(ledgeRng, WALL_TONES), 0.14),
      });
      minR = Math.min(minR, r2 - 0.7);
    }
    minR = Math.min(minR, r - d * 0.5);
  }

  // Rubble along the wall base hides the wall/floor seam (concept: small rocks at the foot of the walls).
  const rubRng = new Rng(`${name}/rubble`);
  for (let k = 0; k < 6; k++) {
    const th = a0 + ((k + rubRng.range(0.15, 0.85)) / 6) * SEG_DEG;
    if (s === TUNNEL_SEG && Math.abs(th - 90) < 9) continue;
    const r = wallRadiusAt(field, th) - rubRng.range(0.25, 1.1);
    const sz = rubRng.range(0.35, 0.95);
    b.rock({
      size: [sz, sz * rubRng.range(0.45, 0.75), sz * rubRng.range(0.7, 1)],
      points: 9,
      jitter: 0.28,
      flat: 0.25,
      align: "bottom",
      at: polar(th, r, 0.04),
      rot: [0, rubRng.range(0, 180), 0],
      color: rockPaint(rubRng, rubRng.chance(0.5) ? pickW(rubRng, WALL_TONES) : rubRng.pick(BOULDER_TONES), 0.16),
    });
    minR = Math.min(minR, r - sz / 2);
  }

  if (s === TUNNEL_SEG) buildTunnel(m, b);

  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    segment: s,
    segments: SEGMENTS,
    thetaStart: a0,
    thetaEnd: a1,
    angleConvention: "theta around +Y from +X toward -Z; dir = (cos t, 0, -sin t)",
    walkRadius: r4(minR),
    ...(s === TUNNEL_SEG
      ? {
          tunnel: {
            mouthZ: TUN.mouthZ,
            width: TUN.halfW * 2,
            shoulder: TUN.shoulder,
            apex: TUN.apex,
            depth: TUN.depth,
          },
        }
      : {}),
  };
  return m;
}

/** Exit tunnel (in wall module 1): arch rocks around the mouth + swept dark passage. */
function buildTunnel(m: Model, b: MeshBuilder): void {
  const rng = new Rng("tl_env_cave/tunnel");
  const Z = TUN.mouthZ;
  // Profile of the passage walls (open polyline from the +X floor corner over the top to -X).
  const prof: Vec2[] = [
    [TUN.halfW, 0],
    [TUN.halfW, TUN.shoulder * 0.5],
    [TUN.halfW, TUN.shoulder],
    [0, TUN.apex],
    [-TUN.halfW, TUN.shoulder],
    [-TUN.halfW, TUN.shoulder * 0.5],
    [-TUN.halfW, 0],
  ];
  const ds = [0, 1.5, 3.2, 4.9, TUN.depth];
  const bend = [0, 0.08, 0.35, 0.85, 1.45];
  const widen = [1, 1.08, 1.14, 1.06, 0.92];
  const raise = [1, 1.05, 1.1, 1.04, 0.94];
  const rings: Vec3[][] = ds.map((d, k) =>
    prof.map(([x, y]): Vec3 => {
      if (k === 0) return [x, y, Z];
      const floor = y === 0;
      const bulge = Math.abs(y - TUN.shoulder * 0.5) < 1e-6 ? 1.07 : 1;
      return [
        bend[k] + x * widen[k] * bulge + rng.jitter(0.14),
        floor ? 0 : y * raise[k] + rng.jitter(0.13),
        Z - d + rng.jitter(0.08),
      ];
    }),
  );
  const depthCol = (d: number, base: Color) => shade(mix(base, P.shadow, smoothstep(0, TUN.depth, d) * 0.75), 1);
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    const dMid = (ds[k] + ds[k + 1]) / 2;
    const axis: Vec3 = [(bend[k] + bend[k + 1]) / 2, 1.7, Z - dMid];
    for (let v = 0; v < prof.length - 1; v++) {
      const quad = [A[v], A[v + 1], B[v + 1], B[v]];
      for (const [p0, p1, p2] of [
        [quad[0], quad[1], quad[2]],
        [quad[0], quad[2], quad[3]],
      ]) {
        const ctr = centroid3([p0, p1, p2]);
        const want = sub(axis, ctr);
        const tone = depthCol(dMid, k === 0 ? P.rock : P.rockDark);
        triToward(b, p0, p1, p2, want, shade(tone, (k === 0 ? 0.8 : 0.7) * (1 + rng.jitter(0.08))));
      }
    }
    // Floor strip (4 cm above the cave floor so the floor disc never shows through).
    const fA0: Vec3 = [A[0][0], TUN.floorY, A[0][2]];
    const fA1: Vec3 = [A[prof.length - 1][0], TUN.floorY, A[prof.length - 1][2]];
    const fB0: Vec3 = [B[0][0], TUN.floorY, B[0][2]];
    const fB1: Vec3 = [B[prof.length - 1][0], TUN.floorY, B[prof.length - 1][2]];
    const fc = shade(mix(P.dirt, P.mud, 0.5 + 0.5 * smoothstep(0, TUN.depth, dMid)), 0.85 + rng.jitter(0.05));
    triToward(b, fA0, fA1, fB1, [0, 1, 0], fc);
    triToward(b, fA0, fB1, fB0, [0, 1, 0], shade(fc, 0.95));
  }
  // Dark end cap facing back toward the cave.
  const last = rings[rings.length - 1];
  const capPts: Vec3[] = [...last.map((p): Vec3 => (p[1] === 0 ? [p[0], TUN.floorY, p[2]] : p))];
  const capC = centroid3(capPts);
  for (let v = 0; v < capPts.length; v++) {
    const p0 = capPts[v];
    const p1 = capPts[(v + 1) % capPts.length];
    triToward(b, capC, p0, p1, [0, 0, 1], shade(P.shadow, 0.55 + rng.jitter(0.05)));
  }

  // Chunky portal around the mouth (concept 01/04): two jambs, a lintel stone, rounded corners
  // and a brow block above (the rock the entrance sign can hang on).
  const portal: { at: Vec3; size: Vec3; rot: Vec3; taper: number; bevel: number; slope?: number }[] = [
    { at: [2.66, 0, Z + 0.32], size: [1.6, 3.5, 1.6], rot: [0, 6, 0], taper: 0.72, bevel: 0.4 },
    { at: [-2.7, 0, Z + 0.28], size: [1.65, 3.3, 1.55], rot: [0, -7, 0], taper: 0.7, bevel: 0.4 },
    // three rough voussoir stones form the arch over the frame
    { at: [1.32, 3.02, Z + 0.4], size: [1.7, 1.25, 1.45], rot: [0, 4, 24], taper: 0.72, bevel: 0.42 },
    { at: [-1.3, 3.0, Z + 0.36], size: [1.75, 1.3, 1.45], rot: [0, -5, -22], taper: 0.72, bevel: 0.42 },
    { at: [0.02, 3.42, Z + 0.42], size: [1.9, 1.25, 1.5], rot: [0, 2, 3], taper: 0.75, bevel: 0.4 },
    { at: [0.3, 4.45, Z + 0.02], size: [6.2, 1.9, 1.6], rot: [0, -4, 2], taper: 0.7, bevel: 0.4, slope: 0.15 },
    { at: [4.1, 0, Z + 0.55], size: [2.0, 1.7, 1.8], rot: [0, 24, 0], taper: 0.6, bevel: 0.42, slope: 0.2 },
    { at: [-4.25, 0, Z + 0.5], size: [1.7, 2.4, 1.7], rot: [0, -20, 0], taper: 0.58, bevel: 0.42, slope: 0.15 },
  ];
  for (const r of portal)
    b.hull(
      blockPoints(rng, r.size[0], r.size[1], r.size[2], { taper: r.taper, bevel: r.bevel, jit: 0.08, slope: r.slope }),
      { at: r.at, rot: r.rot, color: rockPaint(rng, pickW(rng, WALL_TONES), 0.1, 0.95) },
    );
  // Corner stones round off the top corners of the opening.
  for (const side of [1, -1])
    b.rock({
      size: [0.95, 0.95, 1.25],
      points: 12,
      jitter: 0.15,
      at: [side * 1.98, 2.55, Z + 0.4],
      rot: [0, 0, side * 35],
      color: rockPaint(rng, pickW(rng, WALL_TONES), 0.1, 0.95),
    });

  const end = last[3];
  m.anchor("tunnel_mouth", [0, 0, Z]);
  m.anchor("tunnel_end", [r4(end[0]), 0, r4(Z - TUN.depth + 0.3)]);
  m.anchor("tunnel_frame", [0, 0, Z + 0.95]);
  m.anchor("sign_rock", [0.2, 5.2, Z + 0.85]);
  m.anchor("tunnel_torch", [r4(bend[3] * 0.7), 1.8, r4(Z - 4.2)]);
}

/* =========================================================================================
 * Ceiling
 * ========================================================================================= */

interface SpikeOpts {
  /** Attachment point (top for hanging, bottom for standing). */
  base: Vec3;
  /** -1 hangs down (stalactite), +1 stands up (stalagmite). */
  dir: 1 | -1;
  length: number;
  radius: number;
  sides?: number;
  /** Ring positions along the length (0..1, exclusive of 0 and 1). */
  rings?: number[];
  lean?: number;
  /** Stepped tiers: each ring gets a small lip (stalagmites of the style reference). */
  lips?: boolean;
  cap?: boolean;
  tone: Color;
  tipTone?: Color;
}
/** Faceted cave spike (stalactite / stalagmite). Returns the tip point. */
function spike(b: MeshBuilder, rng: Rng, o: SpikeOpts): Vec3 {
  const sides = o.sides ?? 6;
  const ringsT = o.rings ?? [0.35, 0.68];
  const phase = rng.next() * 360;
  const leanA = rng.next() * Math.PI * 2;
  const lean = o.lean ?? 0.12;
  const axisAt = (t: number): Vec3 => [
    o.base[0] + Math.cos(leanA) * lean * o.length * t * t,
    o.base[1] + o.dir * o.length * t,
    o.base[2] + Math.sin(leanA) * lean * o.length * t * t,
  ];
  const ring = (t: number, rk: number): Vec3[] => {
    const c = axisAt(t);
    return Array.from({ length: sides }, (_, i) => {
      const a = (phase + (i * 360) / sides + rng.jitter(9)) * DEG;
      const rr = rk * rng.range(0.85, 1.12);
      return [c[0] + Math.cos(a) * rr, c[1] + rng.jitter(0.03 * o.length), c[2] + Math.sin(a) * rr];
    });
  };
  const radiusAt = (t: number) => o.radius * Math.pow(1 - t, 1.25);
  const layers: { t: number; pts: Vec3[] }[] = [{ t: 0, pts: ring(0, o.radius) }];
  for (const t of ringsT) {
    if (o.lips) layers.push({ t: t - 0.03, pts: ring(t - 0.03, radiusAt(t - 0.03) * 1.18) });
    layers.push({ t, pts: ring(t, radiusAt(t)) });
  }
  const tip = axisAt(1);
  tip[0] += rng.jitter(0.02);
  tip[2] += rng.jitter(0.02);
  const nLayers = layers.length;
  for (let L = 0; L < nLayers; L++) {
    const A = layers[L].pts;
    const tMid = L + 1 < nLayers ? (layers[L].t + layers[L + 1].t) / 2 : (layers[L].t + 1) / 2;
    const ax = axisAt(tMid);
    const toneL = o.tipTone ? mix(o.tone, o.tipTone, tMid) : o.tone;
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      const col = shade(toneL, 1 + rng.jitter(0.08));
      if (L + 1 < nLayers) {
        const B = layers[L + 1].pts;
        const c1 = centroid3([A[i], A[i1], B[i1]]);
        triToward(b, A[i], A[i1], B[i1], sub(c1, ax), col);
        const c2 = centroid3([A[i], B[i1], B[i]]);
        triToward(b, A[i], B[i1], B[i], sub(c2, ax), shade(col, 0.94));
      } else {
        const c1 = centroid3([A[i], A[i1], tip]);
        triToward(b, A[i], A[i1], tip, sub(c1, ax), col);
      }
    }
  }
  if (o.cap) {
    const A = layers[0].pts;
    const c = centroid3(A);
    for (let i = 0; i < sides; i++) triToward(b, c, A[i], A[(i + 1) % sides], [0, -o.dir, 0], shade(o.tone, 0.8));
  }
  return tip;
}

/** Ceiling height (without hanging lobes) at (x, z). */
function ceilingY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const n = vnoise(x / 4.2, z / 4.2, 31) * 0.7 + vnoise(x / 1.8, z / 1.8, 32) * 0.3;
  return ceilingBaseY(r) + n * 0.5 * (1 - smoothstep(14, CEIL_R, r));
}

function buildCeiling(): Model {
  const m = new Model("tl_env_cave_ceiling_v01", {
    budget: 3000,
    notes:
      "Irregular cave ceiling, cave space (place at 0,0,0): ~14 m at the centre, meets the leaning walls at " +
      "~12 m, rim r=20.5 m at ~11 m hidden behind the walls. Faces point down (single-sided). Includes " +
      "8 massive hanging rock cones (2.4-4.4 m) and 20 merged stalactites (1.5-4.2 m).",
  });
  const rng = new Rng("tl_env_cave_ceiling/points");
  const seeds: Vec2[] = [];
  const nb = 40;
  for (let k = 0; k < nb; k++) {
    const p = polar(((k + 0.3) / nb) * 360 + rng.jitter(2), CEIL_R, 0);
    seeds.push([p[0], p[2]]);
  }
  const pts = scatter(rng, CEIL_R - 1.2, (x, z) => 2.7 + 0.6 * smoothstep(8, CEIL_R, Math.hypot(x, z)), seeds, 3000);
  const verts: Vec3[] = pts.map(([x, z]) => [x, ceilingY(x, z), z]);
  const paint = new Rng("tl_env_cave_ceiling/paint");
  for (const [a, bI, c] of delaunay(pts)) {
    const p0 = verts[a],
      p1 = verts[bI],
      p2 = verts[c];
    const ctr = centroid3([p0, p1, p2]);
    const n = vnoise(ctr[0] / 5, ctr[2] / 5, 33);
    const col = mix(mix(P.shadow, P.rockDark, clamp(0.7 + 0.3 * n, 0, 1)), P.earth, 0.25);
    triToward(m.geo, p0, p1, p2, [0, -1, 0], shade(col, 1 + paint.jitter(0.08)));
  }
  // Massive hanging rock cones (the big downward folds of the concept's upper cave).
  const lobeRng = new Rng("tl_env_cave_ceiling/lobes");
  const lobes = 8;
  for (let k = 0; k < lobes; k++) {
    const th = (k / lobes) * 360 + lobeRng.jitter(18);
    const r = k % 3 === 0 ? lobeRng.range(4, 8) : lobeRng.range(10, 14.5);
    const p = polar(th, r, 0);
    const length = lobeRng.range(2.4, 4.4);
    spike(m.geo, lobeRng, {
      base: [p[0], ceilingY(p[0], p[2]) + 0.6, p[2]],
      dir: -1,
      length,
      radius: lobeRng.range(1.3, 2.1),
      sides: 6,
      rings: [0.3, 0.62],
      lean: 0.12,
      tone: mix(mix(P.rockDark, P.shadow, 0.3), P.earth, 0.3),
      tipTone: P.rock,
    });
  }
  // Stalactites (concept 01: long thin dark spikes hanging in front of the upper walls).
  const stRng = new Rng("tl_env_cave_ceiling/stalactites");
  const nSt = 20;
  for (let k = 0; k < nSt; k++) {
    const th = (k / nSt) * 360 + stRng.jitter(9);
    const r = stRng.chance(0.65) ? stRng.range(12, 15.6) : stRng.range(5, 11.5);
    const p = polar(th, r, 0);
    const top = ceilingY(p[0], p[2]) + 0.35;
    const length = stRng.range(1.5, 4.2);
    spike(m.geo, stRng, {
      base: [p[0], top, p[2]],
      dir: -1,
      length,
      radius: stRng.range(0.3, 0.55) * Math.sqrt(length / 2.5),
      sides: 5,
      rings: [0.4],
      lean: 0.08,
      tone: mix(P.rockDark, P.shadow, 0.35),
      tipTone: P.rock,
    });
  }
  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    apexY: CEIL_APEX,
    rimRadius: CEIL_R,
    heightNote: "ceiling y ~= 14 - 3 * (r / 20.5)^2.5 (+-0.5 m noise inside r = 14)",
  };
  return m;
}

/* =========================================================================================
 * Stalactites / stalagmites (props)
 * ========================================================================================= */

function buildStalactite(id: "a" | "b"): Model {
  const name = `tl_env_stalactite_${id}_v01`;
  const m = new Model(name, {
    budget: id === "a" ? 150 : 300,
    notes:
      id === "a"
        ? "Single hanging stalactite, 3.0 m. Modelled hanging: tip at y=0, ceiling attachment at the top " +
          "(anchor 'attach'). Place at (x, ceilingY - 2.9, z)."
        : "Cluster of 3 hanging stalactites (2.2 / 1.4 / 0.9 m). Tip at y=0, attachment at the top (anchor 'attach').",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const tone = mix(P.rockDark, P.shadow, 0.25);
  if (id === "a") {
    spike(b, rng, {
      base: [0, 3.0, 0],
      dir: -1,
      length: 3.0,
      radius: 0.42,
      sides: 6,
      rings: [0.3, 0.62],
      lean: 0.1,
      cap: true,
      tone,
      tipTone: P.rock,
    });
  } else {
    spike(b, rng, {
      base: [0, 2.2, 0],
      dir: -1,
      length: 2.2,
      radius: 0.38,
      sides: 6,
      rings: [0.35, 0.68],
      lean: 0.1,
      cap: true,
      tone,
      tipTone: P.rock,
    });
    spike(b, rng, {
      base: [0.42, 2.2, 0.12],
      dir: -1,
      length: 1.4,
      radius: 0.26,
      sides: 5,
      rings: [0.45],
      lean: 0.14,
      cap: true,
      tone,
      tipTone: P.rock,
    });
    spike(b, rng, {
      base: [-0.3, 2.2, -0.25],
      dir: -1,
      length: 0.9,
      radius: 0.2,
      sides: 5,
      rings: [0.5],
      lean: 0.12,
      cap: true,
      tone,
      tipTone: P.rock,
    });
    // a small rock knob joining them at the ceiling
    b.rock({
      size: [1.25, 0.55, 1.0],
      points: 12,
      jitter: 0.25,
      at: [0.05, 2.32, -0.02],
      align: "top",
      color: rockPaint(rng, tone, 0.05),
    });
  }
  placeBottomCentre(m, b);
  const bb = m.geo.bounds()!;
  m.anchor("attach", [0, r4(bb.max[1]), 0]);
  m.anchor("tip", [0, 0, 0]);
  m.meta = { hanging: true, length: r4(bb.max[1]) };
  return m;
}

function buildStalagmite(id: "a" | "b"): Model {
  const name = `tl_env_stalagmite_${id}_v01`;
  const m = new Model(name, {
    budget: id === "a" ? 200 : 350,
    notes:
      id === "a"
        ? "Tiered stalagmite 1.7 m (style reference: stepped spikes near the water)."
        : "Stalagmite pair 2.4 m + 1.1 m with a rubble base.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const tone = mix(P.rockDark, P.rock, 0.4);
  if (id === "a") {
    spike(b, rng, {
      base: [0, 0, 0],
      dir: 1,
      length: 1.7,
      radius: 0.36,
      sides: 6,
      rings: [0.3, 0.55, 0.78],
      lips: true,
      lean: 0.05,
      tone,
      tipTone: P.rockLight,
    });
  } else {
    spike(b, rng, {
      base: [0, 0, 0],
      dir: 1,
      length: 2.4,
      radius: 0.45,
      sides: 6,
      rings: [0.25, 0.5, 0.75],
      lips: true,
      lean: 0.06,
      tone,
      tipTone: P.rockLight,
    });
    spike(b, rng, {
      base: [0.58, 0, 0.22],
      dir: 1,
      length: 1.1,
      radius: 0.27,
      sides: 5,
      rings: [0.4, 0.7],
      lips: true,
      lean: 0.1,
      tone,
      tipTone: P.rockLight,
    });
    b.rock({
      size: [1.3, 0.32, 1.0],
      points: 12,
      jitter: 0.25,
      flat: 0.3,
      at: [0.2, 0, 0.08],
      align: "bottom",
      color: rockPaint(rng, tone, 0.1),
    });
  }
  placeBottomCentre(m, b);
  m.collider = { type: "cylinder", center: [0, 0.6, 0], radius: id === "a" ? 0.35 : 0.6, height: 1.2 };
  return m;
}

/** Add builder b to the model root so its bounds sit at the bottom centre (y = 0, x/z centred). */
function placeBottomCentre(m: Model, b: MeshBuilder): void {
  const bb = b.bounds()!;
  m.geo.add(b, { at: [-(bb.min[0] + bb.max[0]) / 2, -bb.min[1], -(bb.min[2] + bb.max[2]) / 2] });
}

/* =========================================================================================
 * Boulders and stones
 * ========================================================================================= */

interface BoulderSpec {
  at: [number, number];
  size: Vec3;
  rotY: number;
  points?: number;
  jitter?: number;
  flat?: number;
  slab?: boolean;
  block?: boolean;
}
function buildRockCluster(id: "a" | "b" | "c"): Model {
  const name = `tl_env_rock_cluster_${id}_v01`;
  const specs: Record<typeof id, BoulderSpec[]> = {
    // a: one big 2.4 m boulder with followers (concept 01 foreground / wall-side boulders)
    a: [
      { at: [0, 0], size: [2.7, 1.95, 2.3], rotY: 20, block: true },
      { at: [1.6, 0.6], size: [1.35, 1.05, 1.2], rotY: -15, points: 12, jitter: 0.3, flat: 0.15 },
      { at: [-1.45, 0.8], size: [1.0, 0.7, 0.95], rotY: 40, points: 11, jitter: 0.3, flat: 0.2 },
      { at: [0.85, 1.4], size: [0.55, 0.38, 0.5], rotY: 10, points: 9, flat: 0.25 },
      { at: [-0.6, -1.3], size: [0.7, 0.5, 0.6], rotY: -30, points: 9, flat: 0.25 },
    ],
    // b: catalogue "ROCK CLUSTER": three boulders ~1.0-1.6 m
    b: [
      { at: [0, 0], size: [1.5, 1.55, 1.35], rotY: 10, points: 13, jitter: 0.3, flat: 0.12 },
      { at: [-1.05, 0.25], size: [1.1, 0.95, 1.0], rotY: -25, points: 11, jitter: 0.3, flat: 0.18 },
      { at: [0.95, 0.35], size: [0.95, 0.75, 0.9], rotY: 35, points: 11, jitter: 0.3, flat: 0.2 },
      { at: [0.3, 0.95], size: [0.42, 0.28, 0.4], rotY: 0, points: 9, flat: 0.25 },
    ],
    // c: low flat-topped slab rocks (seat / torch shelf height) + rubble
    c: [
      { at: [0, 0], size: [2.6, 1.05, 1.7], rotY: 5, slab: true },
      { at: [1.65, 0.45], size: [1.3, 0.62, 1.15], rotY: -20, slab: true },
      { at: [-1.5, 0.35], size: [0.9, 0.55, 0.85], rotY: 30, points: 12, flat: 0.25 },
      { at: [0.7, 1.15], size: [0.45, 0.3, 0.4], rotY: 0, points: 9, flat: 0.3 },
      { at: [-0.75, 1.05], size: [0.35, 0.22, 0.3], rotY: 0, points: 8, flat: 0.3 },
    ],
  };
  const m = new Model(name, {
    budget: 600,
    notes: {
      a: "Boulder group: 2.4 m boulder + four smaller rocks, ~4 x 3 m footprint.",
      b: "Three-boulder cluster 1.0-1.55 m (prop catalogue 'ROCK CLUSTER').",
      c: "Low flat-topped slab rocks ~1 m (shelf for a torch / seat) with rubble.",
    }[id],
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  let main: BoulderSpec | undefined;
  for (const sp of specs[id]) {
    const tone = rng.pick(BOULDER_TONES);
    const at: Vec3 = [sp.at[0], 0, sp.at[1]];
    if (sp.slab)
      b.hull(slabPoints(rng, sp.size[0], sp.size[1], sp.size[2]), {
        at,
        rot: [0, sp.rotY, 0],
        color: rockPaint(rng, tone, 0.2),
      });
    else if (sp.block)
      b.hull(
        blockPoints(rng, sp.size[0], sp.size[1], sp.size[2], { taper: 0.62, bevel: 0.45, jit: 0.12, slope: 0.12 }),
        {
          at,
          rot: [0, sp.rotY, 0],
          color: rockPaint(rng, tone, 0.2),
        },
      );
    else
      b.rock({
        size: sp.size,
        points: sp.points ?? 14,
        jitter: sp.jitter ?? 0.24,
        flat: sp.flat ?? 0.15,
        align: "bottom",
        at,
        rot: [0, sp.rotY, 0],
        color: rockPaint(rng, tone, 0.2),
      });
    if (!main) main = sp;
  }
  placeBottomCentre(m, b);
  const bb = m.geo.bounds()!;
  const sz = sub(bb.max, bb.min);
  m.collider = { type: "box", center: [0, r4(sz[1] / 2), 0], size: [r4(sz[0] * 0.8), r4(sz[1]), r4(sz[2] * 0.8)] };
  return m;
}

/** Floor stones: warm grey tops / sides (lighter than the cave rock so they read on the dark floor). */
const STONE_TOP: Color = "#9A8C80";
const STONE_SIDE: Color = "#74675C";

function buildStone(id: "a" | "b" | "c" | "d"): Model {
  const name = `tl_env_stone_small_${id}_v01`;
  const m = new Model(name, {
    budget: 60,
    notes: {
      a: "Flat floor stone 0.4 m (concept 01 foreground slabs). Cosmetic, no collider.",
      b: "Chunky pebble 0.24 m. Cosmetic, no collider.",
      c: "Tiny pebble 0.12 m. Cosmetic, no collider.",
      d: "Three small pebbles (0.1-0.2 m) as one scatter piece. Cosmetic, no collider.",
    }[id],
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  // Warm grey with pale tops that catch the torchlight (board 01's floor slabs, the style
  // reference's pebbles); darker sides keep the facets.
  const paint = (f: { normal: Vec3 }) => {
    const ny = f.normal[1];
    const base = ny > 0.55 ? STONE_TOP : ny < -0.3 ? shade(STONE_SIDE, 0.6) : STONE_SIDE;
    return shade(base, 1 + rng.jitter(0.08));
  };
  if (id === "a") b.hull(slabPoints(rng, 0.42, 0.12, 0.32), { color: paint });
  else if (id === "b")
    b.rock({ size: [0.24, 0.16, 0.21], points: 9, jitter: 0.2, flat: 0.25, align: "bottom", color: paint });
  else if (id === "c")
    b.rock({ size: [0.13, 0.08, 0.11], points: 7, jitter: 0.2, flat: 0.25, align: "bottom", color: paint });
  else {
    b.rock({
      size: [0.2, 0.12, 0.17],
      points: 8,
      jitter: 0.2,
      flat: 0.25,
      align: "bottom",
      at: [0, 0, 0],
      color: paint,
    });
    b.rock({
      size: [0.13, 0.08, 0.12],
      points: 7,
      jitter: 0.2,
      flat: 0.25,
      align: "bottom",
      at: [0.2, 0, 0.1],
      rot: [0, 40, 0],
      color: paint,
    });
    b.rock({
      size: [0.1, 0.06, 0.09],
      points: 7,
      jitter: 0.2,
      flat: 0.3,
      align: "bottom",
      at: [-0.12, 0, 0.16],
      rot: [0, 75, 0],
      color: paint,
    });
  }
  placeBottomCentre(m, b);
  return m;
}

/* =========================================================================================
 * Puddle
 * ========================================================================================= */

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function buildPuddle(): Model {
  const name = "tl_env_puddle_v01";
  const m = new Model(name, {
    budget: 400,
    notes:
      "Shallow irregular puddle ~6 x 4 m. Water surface is its own node 'water' (y=0.05, separate mesh) so the " +
      "runtime can give it a glossy material (keep diffuseVertexColor). Root: wet mud rim + wet rim stones. " +
      "Place where the floor is flat (cave r < 14).",
  });
  const rng = new Rng(name);
  // Built in two scratch builders, then centred on the pivot (bottom centre).
  const waterB = new MeshBuilder(`${name}/water`);
  const rimB = new MeshBuilder(`${name}/rim`);
  const WY = 0.05;
  const n = 18;
  const outline: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const wob = 1 + 0.2 * vnoise(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 41) + rng.jitter(0.05);
    // kidney-shaped: pinch on the +z side, two lobes
    const pinch = 1 - 0.2 * Math.max(0, Math.sin(a)) * Math.max(0, Math.cos(a * 2));
    const lobe = 0.2 * Math.exp(-((a - 3.7) ** 2) / 0.16) + 0.14 * Math.exp(-((a - 0.8) ** 2) / 0.1);
    outline.push([Math.cos(a) * 2.85 * wob * pinch * (1 + lobe), Math.sin(a) * 1.9 * wob * (1 + lobe)]);
  }
  // Water: Delaunay of outline + a few interior points, keep triangles inside the outline.
  const inner: Vec2[] = [
    [-1.2, -0.3],
    [0.4, 0.4],
    [1.5, -0.4],
    [-0.2, -0.9],
  ];
  const wp = [...outline, ...inner];
  for (const [a, b, c] of delaunay(wp)) {
    const ctr: Vec2 = [(wp[a][0] + wp[b][0] + wp[c][0]) / 3, (wp[a][1] + wp[b][1] + wp[c][1]) / 3];
    if (!pointInPoly(ctr, outline)) continue;
    const t = clamp(0.2 + 0.25 * vnoise(ctr[0] / 1.5, ctr[1] / 1.5, 42) + rng.jitter(0.08), 0, 1);
    triToward(
      waterB,
      [wp[a][0], WY, wp[a][1]],
      [wp[b][0], WY, wp[b][1]],
      [wp[c][0], WY, wp[c][1]],
      [0, 1, 0],
      mix(mix(P.water, "#2F4A66", 0.35), mix(P.waterLight, "#5A7A96", 0.35), t),
    );
  }
  // Wet mud rim: band from the water edge (y = WY) out to the dry floor (y ~ 0.01).
  const outer: Vec2[] = outline.map(([x, z]) => {
    const l = Math.hypot(x, z);
    const w = 0.3 + rng.range(0, 0.3);
    return [x + (x / l) * w, z + (z / l) * w];
  });
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const a: Vec3 = [outline[k][0], WY, outline[k][1]];
    const b: Vec3 = [outline[k1][0], WY, outline[k1][1]];
    const c: Vec3 = [outer[k1][0], 0.012, outer[k1][1]];
    const d: Vec3 = [outer[k][0], 0.012, outer[k][1]];
    const col = shade(mix(P.mud, P.dirt, 0.3), 0.9 + rng.jitter(0.08));
    triToward(rimB, a, b, c, [0, 1, 0], col);
    triToward(rimB, a, c, d, [0, 1, 0], shade(col, 0.95));
  }
  // Wet rim stones.
  const wet = mix(P.pebble, P.mud, 0.38);
  const stones = 11;
  for (let k = 0; k < stones; k++) {
    const idx = Math.floor(((k + rng.next() * 0.6) / stones) * n) % n;
    const [x, z] = outline[idx];
    const l = Math.hypot(x, z);
    const out = rng.range(-0.05, 0.25);
    const s = k % 3 === 0 ? rng.range(0.45, 0.7) : rng.range(0.2, 0.42);
    rimB.rock({
      size: [s, s * rng.range(0.45, 0.7), s * rng.range(0.7, 0.95)],
      points: 9,
      jitter: 0.22,
      flat: 0.3,
      align: "bottom",
      at: [x + (x / l) * out, 0, z + (z / l) * out],
      rot: [0, rng.range(0, 180), 0],
      color: rockPaint(rng, wet, 0.12),
    });
  }
  const wb = waterB.bounds()!;
  const rb = rimB.bounds()!;
  const off: Vec3 = [
    -(Math.min(wb.min[0], rb.min[0]) + Math.max(wb.max[0], rb.max[0])) / 2,
    0,
    -(Math.min(wb.min[2], rb.min[2]) + Math.max(wb.max[2], rb.max[2])) / 2,
  ];
  m.node("water").geo.add(waterB, { at: off });
  m.geo.add(rimB, { at: off });
  m.meta = {
    waterNode: "water",
    waterY: WY,
    waterSize: [r4(wb.max[0] - wb.min[0]), r4(wb.max[2] - wb.min[2])],
    note: "Swap the 'water' entity's material for a glossy one (e.g. gloss 0.85, metalness 0, keep diffuseVertexColor).",
  };
  return m;
}

/* =========================================================================================
 * Tunnel frame (wooden mine-style frame at the exit)
 * ========================================================================================= */

function buildTunnelFrame(): Model {
  const name = "tl_env_tunnel_frame_v01";
  const m = new Model(name, {
    budget: 500,
    notes:
      "Rough wooden mine frame for the exit tunnel: two posts + lintel + knee braces, sized to the 3.5 x 3.6 m " +
      "mouth (clear opening 2.84 x 2.78 m). Faces +Z (into the cave). Place at cave (0, 0, -18.35) rotY 0 " +
      "(wall module 01 anchor 'tunnel_frame'). The entrance sign mounts at anchor 'sign'.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const postH = 2.78;
  const postX = 1.55;
  const woodTones = [P.wood, mix(P.wood, P.woodGrey, 0.4), mix(P.woodDark, P.wood, 0.5)];
  const woodPaint = (tone: Color) => ({
    color: tone,
    parts: { top: mix(tone, P.woodLight, 0.25), end: shade(tone, 0.7), bottom: shade(tone, 0.6) },
    vary: 0.06,
  });
  for (const side of [1, -1]) {
    const tone = rng.pick(woodTones);
    b.plank({
      size: [postH, 0.26, 0.26],
      jitter: 0.08,
      at: [side * postX, postH / 2, 0],
      rot: [0, rng.jitter(6), 90 + side * 1.6],
      ...woodPaint(tone),
    });
    // knee brace
    b.plank({
      size: [0.95, 0.12, 0.14],
      jitter: 0.1,
      at: [side * (postX - 0.36), postH - 0.36, 0.02],
      rot: [0, 0, side * 45],
      ...woodPaint(rng.pick(woodTones)),
    });
    // foot block
    b.box({ size: [0.36, 0.1, 0.34], at: [side * postX, 0.05, 0.01], chamfer: 0.015, color: P.woodDark, vary: 0.05 });
  }
  const lintelY = postH + 0.14;
  b.plank({
    size: [3.55, 0.3, 0.32],
    jitter: 0.06,
    at: [0, lintelY, 0],
    rot: [0, 0, rng.jitter(1.2)],
    ...woodPaint(rng.pick(woodTones)),
  });
  // wedges between lintel and post tops
  for (const side of [1, -1])
    b.wedge({
      size: [0.22, 0.1, 0.18],
      at: [side * (postX + 0.17), postH - 0.03, 0.08],
      rot: [0, side * 90, 0],
      color: P.woodDark,
    });
  placeBottomCentre(m, b);
  const bb = m.geo.bounds()!;
  m.anchor("sign", [0, r4(bb.max[1]), 0.04]);
  m.anchor("sign_front", [0, r4(lintelY), 0.17]);
  m.meta = {
    place: { at: [0, 0, r4(TUN.mouthZ + 0.95)], rotY: 0 },
    clearWidth: r4(2 * (postX - 0.12)),
    clearHeight: r4(postH),
    postColliders: [
      { type: "box", center: [postX, postH / 2, 0], size: [0.26, postH, 0.26] },
      { type: "box", center: [-postX, postH / 2, 0], size: [0.26, postH, 0.26] },
    ],
  };
  return m;
}

/* =========================================================================================
 * Shrine grotto ("điện thờ"): a hidden chapel the fans built from what the cave had.
 *
 * All pieces are props (pivot bottom centre, facing +Z) placed by apps/web/src/world/shrine.ts
 * around SHRINE_CENTER (packages/shared/src/shrine.ts): floor disc, two stone seats (top at
 * exactly y = 0.48), the painted wooden idol on its rock plinth, a rough timber gate, banner
 * poles, the paper-strip rope strung between the rim posts, candle slabs and the plank door
 * that closes the old exit tunnel of the cave. No logos, no text, no sponsor marks.
 * ========================================================================================= */

const SH_ROPE: Color = mix(P.cardboard, P.worn, 0.25);
const SH_WOODS: Color[] = [P.wood, mix(P.wood, P.woodGrey, 0.4), mix(P.woodDark, P.wood, 0.5)];
const SH_CRIMSONS: Color[] = [
  P.crimson,
  mix(P.crimson, P.crimsonFaded, 0.5),
  mix(P.crimsonDark, P.crimson, 0.55),
  mix(P.tarp, P.crimson, 0.4),
];
const SH_PAPER: Color = mix(P.worn, P.paper, 0.4);
/** Seat / plinth stone: the cave's boulders, a little warmer. */
const SH_STONE: Color = mix(P.pebble, P.rock, 0.32);
/**
 * Height (m) at which the rim rope ties to its posts: a low cordon, so it stays under the view of
 * a follow camera standing just outside it.
 */
const SHRINE_TIE_Y = 1.12;
const shWood = (tone: Color, vary = 0.06): PrimOpts => ({
  color: tone,
  parts: { top: mix(tone, P.woodLight, 0.25), end: shade(tone, 0.7), bottom: shade(tone, 0.6) },
  vary,
});

/** Octagonal ring (a rectangle w x d with its corners cut by `bev` metres) at height y. */
function shRing(y: number, w: number, d: number, zc = 0, bev = 0.03, bevFront = bev): Vec3[] {
  const hx = w / 2;
  const hz = d / 2;
  const bx = Math.min(bev, hx * 0.9);
  const bz = Math.min(bev, hz * 0.9);
  const fx = Math.min(bevFront, hx * 0.9);
  const fz = Math.min(bevFront, hz * 0.9);
  return [
    [-hx + fx, y, zc + hz],
    [hx - fx, y, zc + hz],
    [hx, y, zc + hz - fz],
    [hx, y, zc - hz + bz],
    [hx - bx, y, zc - hz],
    [-hx + bx, y, zc - hz],
    [-hx, y, zc - hz + bz],
    [-hx, y, zc + hz - fz],
  ];
}

/** Box-like beam from p0 to p1 with cross-section w x d (d along `up` projected), tapered at p1. */
function shBeam(
  b: MeshBuilder,
  p0: Vec3,
  p1: Vec3,
  w: number,
  d: number,
  style: PrimOpts,
  up: Vec3 = [0, 0, 1],
  taper = 1,
): void {
  const ax = norm(sub(p1, p0));
  let sx = cross(up, ax);
  if (len(sx) < 1e-6) sx = cross([1, 0, 0], ax);
  sx = norm(sx);
  const sz = norm(cross(ax, sx));
  const pts: Vec3[] = [];
  for (const [p, k] of [
    [p0, 1],
    [p1, taper],
  ] as const)
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      pts.push(add(p, add(scl(sx, (u * w * k) / 2), scl(sz, (v * d * k) / 2))));
  b.hull(pts, style);
}

/** Two cloth triangles a-b-c-d whose lit side faces `out`. */
function shClothQuad(b: MeshBuilder, q: [Vec3, Vec3, Vec3, Vec3], out: Vec3, color: Color, half = false): void {
  const [a, bb, c, d] = q;
  const put = (p0: Vec3, p1: Vec3, p2: Vec3) => {
    const n = cross(sub(p1, p0), sub(p2, p0));
    if (dot(n, out) < 0) b.tri(p0, p2, p1, { mat: "cloth", color });
    else b.tri(p0, p1, p2, { mat: "cloth", color });
  };
  put(a, bb, c);
  if (!half) put(a, c, d);
}

/** Wax candle standing at `at` (its base); lit ones carry a small unlit flame. */
function shCandle(b: MeshBuilder, rng: Rng, at: Vec3, h: number, r = 0.024, lit = true): void {
  const wax = mix(P.worn, P.paper, rng.next() * 0.6);
  b.cylinder({
    height: h,
    radius: r * 1.08,
    radiusTop: r * 0.9,
    sides: 5,
    phase: rng.range(0, 72),
    at: [at[0], at[1] + h / 2, at[2]],
    color: wax,
    parts: { top: shade(wax, 0.8) },
    vary: 0.05,
  });
  b.cylinder({
    height: 0.012,
    radius: r * 2.2,
    radiusTop: r * 1.5,
    sides: 6,
    phase: rng.range(0, 60),
    caps: "top",
    at: [at[0] + rng.jitter(0.006), at[1] + 0.006, at[2] + rng.jitter(0.006)],
    color: shade(wax, 0.9),
    vary: 0.05,
  });
  if (!lit) return;
  const fy = at[1] + h + 0.008;
  const fh = 0.07 + rng.range(0, 0.025);
  const lean: Vec2 = [rng.jitter(0.008), rng.jitter(0.008)];
  b.cone({ radius: r * 0.78, height: fh, sides: 4, phase: 45, lean, cap: false, at: [at[0], fy + 0.016 + fh / 2, at[2]], color: mix(P.flame, P.flameCore, 0.55), mat: "glow", glow: 1.5 });
  b.cone({ radius: r * 0.78, height: 0.016, sides: 4, phase: 45, cap: false, at: [at[0], fy + 0.008, at[2]], rot: [180, 0, 0], color: P.flameOuter, mat: "glow", glow: 1.5 });
}

/** Zig-zag paper strip (shide) hanging from `top`, facing +Z. */
function shPaperStrip(b: MeshBuilder, rng: Rng, top: Vec3, w = 0.075, seg = 0.105, n = 3): void {
  const tone = shade(SH_PAPER, 1 + rng.jitter(0.06));
  let x = top[0];
  let y = top[1];
  const z = top[2] + 0.012;
  for (let k = 0; k < n; k++) {
    const dx = (k % 2 ? -1 : 1) * w * 0.55;
    const q: [Vec3, Vec3, Vec3, Vec3] = [
      [x - w / 2, y, z],
      [x - w / 2 + dx, y - seg, z + 0.012 * (k + 1)],
      [x + w / 2 + dx, y - seg, z + 0.012 * (k + 1)],
      [x + w / 2, y, z],
    ];
    shClothQuad(b, q, [0, 0, 1], shade(tone, k % 2 ? 0.9 : 1));
    x += dx;
    y -= seg;
  }
}

/** A knotted rag strip hanging from `top`, facing +Z. */
function shRag(b: MeshBuilder, rng: Rng, top: Vec3, length: number, w: number, color: Color): void {
  const sway = rng.jitter(0.04);
  const q: [Vec3, Vec3, Vec3, Vec3] = [
    [top[0] - w / 2, top[1] + 0.006, top[2] + 0.008],
    [top[0] - w / 2 + sway, top[1] - length, top[2] + 0.024],
    [top[0] + w / 2 + sway, top[1] - length * (0.82 + rng.next() * 0.2), top[2] + 0.024],
    [top[0] + w / 2, top[1] + 0.006, top[2] + 0.008],
  ];
  shClothQuad(b, q, [0, 0, 1], shade(color, 1 + rng.jitter(0.05)));
}

/** Sagging rope between (-half, endY) and (+half, endY) with paper strips and rags; returns rope y at x. */
function shGarland(b: MeshBuilder, rng: Rng, half: number, endY: number, sag: number, radius: number, z = 0, every = 0.85, gap = 0): (x: number) => number {
  const yAt = (x: number) => endY - sag * (1 - (x / half) ** 2);
  const n = 10;
  b.tube(
    Array.from({ length: n + 1 }, (_, i) => {
      const x = -half + (2 * half * i) / n;
      return [x, yAt(x), z] as Vec3;
    }),
    { radius, sides: 5, color: SH_ROPE, vary: 0.06 },
  );
  for (const s of [-1, 1])
    b.cylinder({ height: radius * 4.5, radius: radius * 1.9, sides: 5, at: [s * (half - radius * 2), yAt(half), z], rot: [0, 0, 90], color: shade(SH_ROPE, 0.9), vary: 0.05 });
  const strips = Math.max(3, Math.round((2 * half) / every));
  for (let k = 0; k < strips; k++) {
    const x = -half + ((k + 0.5) / strips) * 2 * half + rng.jitter(0.06);
    if (Math.abs(x) < gap) continue; // keep the view through the middle clear
    if (k % 3 === 1) shRag(b, rng, [x, yAt(x) - radius * 0.6, z], rng.range(0.26, 0.4), 0.085, rng.pick(SH_CRIMSONS));
    else shPaperStrip(b, rng, [x, yAt(x) - radius * 0.6, z]);
  }
  return yAt;
}

/* ---------------------------------------------------------------- floor */

const SHRINE_FLAT_R = 9.3;
const SHRINE_FLOOR_R = 15.6;

/** Shrine floor height: exactly 0 inside r = 9.3, rising toward the rock (not on the +Z approach). */
function shrineFloorY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rim = smoothstep(SHRINE_FLAT_R, SHRINE_FLOOR_R - 0.6, r);
  const approach = z > 0 ? smoothstep(1.9, 4.6, Math.abs(x)) : 1;
  return Math.max(0, (0.62 * rim * rim + 0.07 * rim * vnoise(x / 1.9, z / 1.9, 71)) * approach);
}

function buildShrineFloor(): Model {
  const name = "tl_env_shrine_floor_v01";
  const m = new Model(name, {
    budget: 1600,
    notes:
      "Shrine grotto floor, r = 15.6 m, shrine space (origin = idol, +Z = the way in). Packed earth, exactly flat " +
      "(y = 0) inside r = 9.3, rising under the rock walls; rough flagstones (1.4 cm proud) around the plinth, on the " +
      "approach from +Z and as stepping stones between the seats on the r = 3 and r = 5 circles; trodden paler bands " +
      "on those circles; darker toward the rim.",
  });
  const rng = new Rng(`${name}/points`);
  const seeds: Vec2[] = [];
  const nb = 48;
  for (let k = 0; k < nb; k++) {
    const a = ((k + 0.5) / nb) * Math.PI * 2 + rng.jitter(0.02);
    seeds.push([Math.cos(a) * SHRINE_FLOOR_R, Math.sin(a) * SHRINE_FLOOR_R]);
  }
  seeds.push([0, 0]);
  const pts = scatter(rng, SHRINE_FLOOR_R - 0.8, (x, z) => 1.45 + 0.95 * smoothstep(7, SHRINE_FLOOR_R, Math.hypot(x, z)), seeds, 5000);
  const verts: Vec3[] = pts.map(([x, z]) => [x, shrineFloorY(x, z), z]);
  const paint = new Rng(`${name}/paint`);
  const dust = mix(P.ochre, P.pebble, 0.3);
  for (const [a, b, c] of delaunay(pts)) {
    const p0 = verts[a],
      p1 = verts[b],
      p2 = verts[c];
    const ctr = centroid3([p0, p1, p2]);
    const r = Math.hypot(ctr[0], ctr[2]);
    const patch = vnoise(ctr[0] / 5.5, ctr[2] / 5.5, 81) * 0.7 + vnoise(ctr[0] / 2.2, ctr[2] / 2.2, 82) * 0.3;
    let col = mix(P.dirt, P.earth, clamp(0.6 + 0.55 * patch, 0, 1));
    col = mix(col, P.ochre, 0.2 * smoothstep(0.1, 0.7, patch));
    // trodden: the two seat circles, the apron of the plinth and the approach from the tunnel
    const band = (r0: number, w: number) => 1 - smoothstep(0, w, Math.abs(r - r0));
    const approach = ctr[2] > 5.2 ? 1 - smoothstep(0.9, 2.3, Math.abs(ctr[0])) : 0;
    const trodden = Math.max(band(3.9, 1.5) * 0.75, band(1.9, 0.9), approach, band(6.6, 1.3) * 0.6);
    col = mix(col, dust, 0.36 * trodden);
    const k =
      (1 + paint.jitter(0.045)) *
      (1 - 0.46 * smoothstep(8.3, 14.2, r)) *
      (1 - 0.3 * (1 - smoothstep(1.0, 1.9, r))) *
      (1 + 0.1 * (1 - smoothstep(2, 8, r)));
    triToward(m.geo, p0, p1, p2, [0, 1, 0], shade(col, k));
  }
  // Flagstones: irregular flat polygons, one colour each.
  const stones = new Rng(`${name}/stones`);
  const slabTone = mix(STONE_SIDE, P.ochre, 0.22);
  const flag = (cx: number, cz: number, rx: number, rz: number, k = 1) => {
    const n = stones.int(5, 7);
    const rot = stones.range(0, Math.PI * 2);
    const ring: Vec3[] = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + stones.jitter(0.22);
      const px = Math.cos(a) * rx * stones.range(0.78, 1.05);
      const pz = Math.sin(a) * rz * stones.range(0.78, 1.05);
      return [cx + px * Math.cos(rot) - pz * Math.sin(rot), 0.014, cz + px * Math.sin(rot) + pz * Math.cos(rot)];
    });
    const r = Math.hypot(cx, cz);
    const col = shade(mix(slabTone, STONE_TOP, stones.range(0, 0.45)), k * (1 + stones.jitter(0.09)) * (1 - 0.3 * smoothstep(8.5, 14, r)));
    const c = centroid3(ring);
    for (let i = 0; i < n; i++) triToward(m.geo, c, ring[i], ring[(i + 1) % n], [0, 1, 0], col);
  };
  // apron around the plinth
  for (let k = 0; k < 9; k++) {
    const a = ((k + 0.5) / 9) * Math.PI * 2 + stones.jitter(0.08);
    flag(Math.sin(a) * 1.78, Math.cos(a) * 1.78, 0.5, 0.38, 0.95);
  }
  // the approach: from the tunnel (+Z) through the gate to the entry point
  for (let z = 6.3; z < 13.9; z += 0.92)
    for (const s of [-1, 1]) flag(s * (0.52 + stones.jitter(0.08)), z + stones.jitter(0.12) + (s > 0 ? 0.4 : 0), 0.47, 0.4);
  // stepping stones on the seat circles, between the seats
  for (const [radius, count] of [
    [3, 8],
    [5, 12],
  ] as const)
    for (let i = 0; i < count; i++)
      for (const f of [0.36, 0.64]) {
        const a = ((i + f) / count) * Math.PI * 2 + stones.jitter(0.025);
        const rr = radius + stones.jitter(0.12);
        flag(Math.sin(a) * rr, Math.cos(a) * rr, 0.27, 0.21, 0.92);
      }
  m.collider = { type: "cylinder", center: [0, -0.25, 0], radius: SHRINE_FLOOR_R, height: 0.5 };
  m.meta = { space: "shrine", flatRadius: SHRINE_FLAT_R, radius: SHRINE_FLOOR_R };
  return m;
}

/* ---------------------------------------------------------------- seats */

const SHRINE_SEAT_TOP = 0.48;

function buildShrineSeat(id: "a" | "b"): Model {
  const name = `tl_env_shrine_seat_${id}_v01`;
  const m = new Model(name, {
    budget: 160,
    notes:
      (id === "a"
        ? "Rough stone block seat with a faded crimson cloth strip over it (inner ring). "
        : "Rough stone block seat, plain (outer ring). ") +
      "Flat top at exactly y = 0.48, no backrest. The seated avatar's root stands at anchor 'sit' (0.16 m in front " +
      "of the block centre) facing +Z, so its calves clear the block's front face. Carries its own dark contact patch.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const tone = id === "a" ? SH_STONE : mix(SH_STONE, P.rock, 0.2);
  const w = id === "a" ? 0.84 : 0.9;
  const d = id === "a" ? 0.64 : 0.62;
  const ring = (y: number, kw: number, kd: number, jit: number, n: number): Vec3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + 0.5) / n) * Math.PI * 2 + rng.jitter(0.16);
      // a rounded rectangle: push the ellipse toward its bounding box
      const cx = Math.cos(a),
        cz = Math.sin(a);
      const sq = 1 / Math.max(Math.abs(cx), Math.abs(cz));
      const k = lerp(1, sq, 0.55) * (1 + rng.jitter(jit));
      return [((cx * w) / 2) * kw * k, y, Math.min(((cz * d) / 2) * kd * k, d / 2 + 0.005)];
    });
  b.hull(
    [
      ...ring(0, 1.04, 1.02, 0.05, 8),
      ...ring(id === "a" ? 0.2 : 0.27, 1.08, 1.04, 0.06, 7),
      ...ring(SHRINE_SEAT_TOP, 0.9, 0.9, 0.04, 7),
    ],
    { color: rockPaint(rng, tone, 0.26, 0.92) },
  );
  // contact patch: the stone has sat here for years
  const patch: Vec3[] = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + rng.jitter(0.2);
    return [Math.cos(a) * (w / 2 + 0.16) * rng.range(0.9, 1.1), 0.006, Math.sin(a) * (d / 2 + 0.15) * rng.range(0.9, 1.1)];
  });
  const pc = centroid3(patch);
  for (let i = 0; i < 7; i++) triToward(b, pc, patch[i], patch[(i + 1) % 7], [0, 1, 0], shade(P.mud, 0.72));
  if (id === "a") {
    // cloth strip laid across the top, hanging down both sides
    const z0 = -0.2,
      z1 = 0.13;
    const y = SHRINE_SEAT_TOP + 0.003;
    const red = mix(mix(P.crimson, P.crimsonFaded, 0.45), P.crimsonDark, 0.3);
    const xs = w / 2 - 0.045;
    shClothQuad(b, [[-xs, y, z0], [-xs, y, z1], [xs, y, z1], [xs, y, z0]], [0, 1, 0], shade(red, 1.05));
    for (const s of [-1, 1]) {
      const drop = s > 0 ? 0.3 : 0.24;
      const out = s * (w / 2 + 0.045);
      shClothQuad(b, [[s * xs, y, z0], [s * xs, y, z1], [out, y - 0.11, z1 + 0.01], [out, y - 0.11, z0 - 0.01]], [s, 0.5, 0], shade(red, 0.92));
      shClothQuad(
        b,
        [[out, y - 0.11, z0 - 0.01], [out, y - 0.11, z1 + 0.01], [out + s * 0.02, y - drop - 0.05, z1 - 0.02], [out + s * 0.025, y - drop, z0 + 0.03]],
        [s, 0, 0],
        s > 0 ? mix(P.worn, P.wornDark, 0.35) : shade(red, 0.82),
      );
    }
  } else {
    // a pebble kicked against its foot
    b.rock({ size: [0.17, 0.1, 0.14], points: 7, jitter: 0.2, flat: 0.3, align: "bottom", at: [w / 2 + 0.07, 0, -0.12], rot: [0, 30, 0], color: rockPaint(rng, mix(tone, P.pebble, 0.3), 0.2) });
  }
  placeBottomCentre(m, b);
  const bb = b.bounds()!;
  // 'sit': where the avatar root goes, relative to the centred mesh (the block centre is 0.16 m behind it)
  const blockCz = -(bb.min[2] + bb.max[2]) / 2;
  m.anchor("sit", [r4(-(bb.min[0] + bb.max[0]) / 2), SHRINE_SEAT_TOP, r4(blockCz + 0.16)]);
  m.meta = { seatHeight: SHRINE_SEAT_TOP, topSize: [r4(w * 0.9), r4(d * 0.9)] };
  return m;
}

/* ---------------------------------------------------------------- the idol */

function buildShrineIdol(): Model {
  const name = "tl_env_shrine_idol_v01";
  const m = new Model(name, {
    budget: 2800,
    notes:
      "Shrine idol, 3.3 m with its rock plinth (fits the r = 1.2 obstacle): a fan-carved, painted wooden caricature " +
      "of the champion the cave prays to - heavy straight fringe / bowl hair, thin round wire glasses, slim oval " +
      "face, calm; white jersey with black raglan shoulders and side panels and red collar piping (worn paint, no " +
      "logos or text), in the 'silent' pose: right index finger raised to the lips, left arm at the side. The trophy floats above " +
      "the head as its own model (tl_env_shrine_trophy_v01, anchor 'trophy'). A real crimson cloth cloak (tl_cloth) hangs from the " +
      "shoulders. Offerings on the plinth and its front ledge: candles (glow), a noodle cup, mugs, flowers, notes.",
  });
  const rng = new Rng(name);
  const b = m.geo;
  const PL = 0.9; // plinth top
  const K = 1.3; // figure scale (a 1.75 m fan)

  /* plinth: a boulder with a flat top and a low ledge in front */
  const ringR = (y: number, r: number, n: number, jit: number): Vec3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + 0.5) / n) * Math.PI * 2 + rng.jitter(0.14);
      const rr = r * (1 + rng.jitter(jit));
      return [Math.sin(a) * rr, y, Math.cos(a) * rr];
    });
  b.hull([...ringR(0, 1.06, 8, 0.05), ...ringR(0.46, 1.0, 8, 0.06), ...ringR(PL, 0.76, 7, 0.05)], {
    color: rockPaint(rng, SH_STONE, 0.22),
  });
  const LEDGE = 0.36;
  const ledge: Vec3[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (-44 + k * 22 + rng.jitter(3)) * DEG;
    for (const [r, y] of [
      [1.15, 0],
      [1.12, LEDGE - 0.04],
      [1.06, LEDGE],
      [0.6, LEDGE],
      [0.6, 0],
    ] as const)
      ledge.push([Math.sin(a) * r, y, Math.cos(a) * r]);
  }
  b.hull(ledge, { color: rockPaint(rng, mix(SH_STONE, P.rockLight, 0.25), 0.25) });
  for (const [a, s] of [
    [118, 0.42],
    [-125, 0.5],
    [165, 0.36],
  ] as const)
    b.rock({
      size: [s, s * 0.62, s * 0.8],
      points: 9,
      jitter: 0.25,
      flat: 0.25,
      align: "bottom",
      at: [Math.sin(a * DEG) * 0.98, 0, Math.cos(a * DEG) * 0.98],
      rot: [0, a, 0],
      color: rockPaint(rng, mix(SH_STONE, P.rock, 0.2), 0.18),
    });

  /* the figure (fan proportions, scaled K) */
  const WOOD_UNDER = mix(P.wood, P.woodLight, 0.4);
  /** Painted wood: a few facets where the paint has worn through. */
  const painted = (c: Color, wear = 0.07, vary = 0.045) => () =>
    shade(rng.chance(wear) ? mix(c, WOOD_UNDER, 0.4) : c, 1 + rng.jitter(vary));
  const WHITE = mix(P.white, "#F2ECDD", 0.55);
  const BLACK = "#262220";
  const RED = P.crimson;
  const SKIN = mix(P.skinLight, "#F0CDAE", 0.5);
  const HAIR = "#1D1918";
  const WIRE = "#0F0D0C";
  b.group({ at: [0, PL, 0], scale: K }, (g) => {
    // shoes + slim dark trousers
    for (const s of [-1, 1]) {
      g.box({ size: [0.105, 0.075, 0.26], at: [s * 0.085, 0.0375, 0.035], chamfer: 0.014, color: painted("#2E2A28", 0.1), parts: { bottom: P.worn } });
      shBeam(g, [s * 0.083, 0.07, 0], [s * 0.088, 0.9, 0], 0.118, 0.14, { color: painted("#34302E", 0.08) }, [0, 0, 1], 1.16);
    }
    // jersey: white body, black raglan shoulders and side panels
    const rings: [number, number, number, number, number][] = [
      // y, w, d, zc, bevel
      [0.8, 0.33, 0.2, 0, 0.03],
      [0.93, 0.335, 0.205, 0, 0.03],
      [1.27, 0.37, 0.212, 0.002, 0.034],
      [1.342, 0.39, 0.19, 0, 0.04],
      [1.385, 0.19, 0.135, -0.004, 0.035],
    ];
    const white = painted(WHITE, 0.05, 0.035);
    const black = painted(BLACK, 0.035, 0.05);
    g.hull(
      rings.flatMap(([y, w, d, zc, bev]) => shRing(y, w, d, zc, bev)),
      {
        color: (f) => (f.normal[1] > 0.45 || Math.abs(f.normal[0]) > 0.4 ? black() : f.normal[1] < -0.5 ? shade(WHITE, 0.7) : white()),
      },
    );
    // raglan plates on the chest and the back (carved relief), from the collar to the armpit
    for (const s of [-1, 1])
      for (const f of [1, -1]) {
        const zs = (y: number) => f * (lerp(0.108, 0.097, clamp((y - 1.27) / 0.072, 0, 1)) + 0.004);
        const A: Vec3 = [s * 0.058, 1.372, f * 0.079];
        const B: Vec3 = [s * 0.186, 1.338, zs(1.338)];
        const C: Vec3 = [s * 0.176, 1.17, zs(1.17)];
        g.hull([A, B, C, [A[0], A[1], A[2] - f * 0.05], [B[0], B[1], B[2] - f * 0.05], [C[0], C[1], C[2] - f * 0.05]], { color: black });
      }
    // red collar piping: band round the neck + a V on the chest
    g.cylinder({ height: 0.03, radius: 0.088, radiusTop: 0.078, sides: 8, phase: 22.5, at: [0, 1.392, -0.004], scale: [1, 1, 0.82], color: painted(RED, 0.05), caps: "top" });
    for (const s of [-1, 1]) shBeam(g, [s * 0.07, 1.388, 0.064], [0, 1.318, 0.111], 0.024, 0.016, { color: painted(RED, 0.05) }, [0, 0, 1]);
    // jersey hem line
    g.hull([...shRing(0.8, 0.338, 0.208, 0, 0.03), ...shRing(0.818, 0.338, 0.208, 0, 0.03)], { color: painted(BLACK, 0.06) });
    // arms: black short sleeves, bare forearms. The "silent" pose: the right hand comes up in front of the
    // mouth with the index finger raised against the lips; the left arm hangs relaxed at the side.
    const arm = (sh: Vec3, el: Vec3, wr: Vec3, foreUp: Vec3) => {
      const mid: Vec3 = [lerp(sh[0], el[0], 0.6), lerp(sh[1], el[1], 0.6), lerp(sh[2], el[2], 0.6)];
      shBeam(g, add(sh, [0, 0.02, 0]), mid, 0.098, 0.108, { color: painted(BLACK, 0, 0.05) }, [0, 0, 1], 0.94);
      shBeam(g, add(mid, [0, 0.01, 0]), add(el, [0, -0.03, 0]), 0.074, 0.08, { color: painted(SKIN, 0.04, 0.03) }, [0, 0, 1], 0.95);
      shBeam(g, add(el, [0, -0.012, -0.012]), wr, 0.07, 0.07, { color: painted(SKIN, 0.04, 0.03) }, foreUp, 0.86);
    };
    const hand = painted(shade(SKIN, 0.97), 0.04, 0.03);
    // right arm (the figure's right is -X): elbow by the ribs, forearm up to the chin
    arm([-0.212, 1.318, 0], [-0.222, 1.09, 0.105], [-0.05, 1.392, 0.2], [0, 0, 1]);
    g.box({ size: [0.078, 0.088, 0.07], at: [-0.022, 1.438, 0.208], rot: [0, 0, 14], chamfer: 0.012, color: hand });
    // curled fingers on the fist, thumb tucked across them
    g.box({ size: [0.064, 0.04, 0.03], at: [-0.03, 1.43, 0.25], rot: [0, 0, 14], chamfer: 0.008, color: painted(shade(SKIN, 0.93), 0.04, 0.03) });
    g.box({ size: [0.03, 0.055, 0.026], at: [0.016, 1.428, 0.238], rot: [0, 0, -24], chamfer: 0.008, color: hand });
    // the raised index finger, on the lips (mouth at y 1.51, nose tip z 0.19)
    shBeam(g, [-0.004, 1.47, 0.214], [0.001, 1.6, 0.203], 0.024, 0.024, { color: painted(SKIN, 0.03, 0.03) }, [0, 0, 1], 0.86);
    // left arm at the side, hand open by the thigh
    arm([0.212, 1.318, 0], [0.24, 1.075, -0.008], [0.234, 0.862, 0.036], [0, 0, 1]);
    g.box({ size: [0.05, 0.11, 0.08], at: [0.234, 0.8, 0.046], rot: [8, 0, 0], chamfer: 0.012, color: hand });
    // neck
    g.cylinder({ height: 0.085, radius: 0.052, radiusTop: 0.048, sides: 6, at: [0, 1.43, -0.004], color: painted(shade(SKIN, 0.9), 0.03, 0.03), caps: false });

    /* head (a little oversized, as carved idols are) */
    g.group({ at: [0, 1.452, 0.004], scale: 1.16 }, (h) => {
      const skin = painted(SKIN, 0.025, 0.03);
      // slim oval skull: chin, jaw, cheek, temple, crown
      const skull: [number, number, number, number, number][] = [
        [0.0, 0.105, 0.1, 0.05, 0.03],
        [0.055, 0.184, 0.2, 0.018, 0.05],
        [0.13, 0.232, 0.252, 0.006, 0.06],
        [0.235, 0.238, 0.258, 0.002, 0.06],
        [0.3, 0.19, 0.2, 0, 0.06],
      ];
      h.hull(
        skull.flatMap(([y, w, d, zc, bev]) => shRing(y, w, d, zc, bev)),
        { color: (f) => (f.normal[1] < -0.4 ? shade(SKIN, 0.82) : skin()) },
      );
      const faceZ = (y: number) => {
        // front plane of the skull at height y
        for (let i = 0; i + 1 < skull.length; i++)
          if (y <= skull[i + 1][0]) {
            const t = clamp((y - skull[i][0]) / (skull[i + 1][0] - skull[i][0]), 0, 1);
            return lerp(skull[i][3] + skull[i][2] / 2, skull[i + 1][3] + skull[i + 1][2] / 2, t);
          }
        return 0.13;
      };
      // ears
      for (const s of [-1, 1]) h.box({ size: [0.024, 0.062, 0.04], at: [s * 0.121, 0.128, -0.004], chamfer: 0.008, color: painted(shade(SKIN, 0.93), 0.03, 0.03) });
      // nose + calm mouth
      h.hull(
        [
          [-0.011, 0.142, faceZ(0.142) - 0.004],
          [0.011, 0.142, faceZ(0.142) - 0.004],
          [-0.021, 0.088, faceZ(0.088) - 0.004],
          [0.021, 0.088, faceZ(0.088) - 0.004],
          [0, 0.094, faceZ(0.094) + 0.034],
          [0, 0.142, faceZ(0.142) + 0.01],
        ],
        { color: (f) => (f.normal[1] < -0.3 ? shade(SKIN, 0.78) : shade(SKIN, 0.96)) },
      );
      h.box({ size: [0.052, 0.008, 0.008], at: [0, 0.05, faceZ(0.05) + 0.001], color: "#96594E" });
      // thin ROUND wire glasses: dark rims, pale lenses, small calm eyes behind them
      const EY = 0.152;
      const gz = faceZ(EY) + 0.012;
      for (const s of [-1, 1]) {
        const cx = s * 0.0615;
        h.ring({ radius: 0.0525, inner: 0.0422, depth: 0.012, segments: 12, at: [cx, EY, gz], color: WIRE });
        h.ring({ radius: 0.0422, inner: 0, depth: 0.002, segments: 12, at: [cx, EY, gz - 0.004], color: mix(SKIN, "#FFFFFF", 0.2), parts: { back: SKIN } });
        h.box({ size: [0.021, 0.015, 0.004], at: [cx - s * 0.003, EY - 0.001, gz - 0.001], color: "#1A1514" });
        // temple arm back to the ear
        shBeam(h, [s * 0.112, EY + 0.008, gz - 0.002], [s * 0.126, EY + 0.004, 0.0], 0.009, 0.009, { color: WIRE }, [0, 1, 0]);
      }
      h.box({ size: [0.03, 0.01, 0.01], at: [0, EY + 0.012, gz], color: WIRE });
      // hair: a rounded bowl with a heavy straight fringe down to the brow line
      const BROW = 0.207;
      const hair = (f: { normal: Vec3 }) =>
        shade(HAIR, (f.normal[1] > 0.5 ? 1.22 : f.normal[1] < -0.5 ? 0.8 : f.normal[2] > 0.6 ? 1.1 : 1) * (1 + rng.jitter(0.07)));
      // rings: y, w, d, zc, bevel (back / sides), bevel of the front corners (small: a wide flat fringe)
      const bowl: [number, number, number, number, number, number][] = [
        [BROW, 0.298, 0.312, 0.004, 0.075, 0.034],
        [0.27, 0.31, 0.326, 0.002, 0.09, 0.05],
        [0.325, 0.282, 0.3, -0.002, 0.09, 0.07],
        [0.362, 0.17, 0.19, -0.01, 0.055, 0.055],
      ];
      h.hull(
        bowl.flatMap(([y, w, d, zc, bev, bf]) => shRing(y, w, d, zc, bev, bf)),
        { color: hair },
      );
      // the bowl's sides come down over the top of the ears, the back runs on down the nape
      h.hull(
        [
          ...shRing(BROW + 0.004, 0.298, 0.236, -0.034, 0.07, 0.03),
          ...shRing(0.142, 0.29, 0.214, -0.04, 0.06, 0.03),
          ...shRing(0.082, 0.21, 0.1, -0.092, 0.035),
        ],
        { color: hair },
      );
    });

    /* the cloak: real cloth from the shoulders down the back, ragged hem */
    const NU = 12,
      NV = 5;
    const grid: Vec3[][] = [];
    const red = mix(mix(P.crimson, P.crimsonFaded, 0.3), P.crimsonDark, 0.42);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const phi = (-104 + 208 * u) * DEG; // 0 = straight behind
      const fold = i % 2 ? 1 : -1;
      const edge = Math.pow(Math.abs(2 * u - 1), 3);
      const length = 1.14 + rng.jitter(0.13) - 0.34 * edge - 0.12 * u;
      const yTop = 1.352 + 0.04 * Math.max(0, Math.cos(phi));
      grid.push([]);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const rx = 0.292 + 0.115 * v + fold * 0.03 * v;
        const rz = 0.17 + 0.17 * v + fold * 0.036 * v;
        const y = yTop - length * v - (j === NV ? rng.range(0, 0.14) : 0);
        grid[i].push([Math.sin(phi) * rx, y, -Math.cos(phi) * rz - 0.012]);
      }
    }
    const patches = new Set([rng.int(1, NU - 2) * 10 + rng.int(1, 3), rng.int(1, NU - 2) * 10 + rng.int(2, 4), rng.int(2, NU - 3) * 10 + 2]);
    for (let i = 0; i < NU; i++)
      for (let j = 0; j < NV; j++) {
        const q: [Vec3, Vec3, Vec3, Vec3] = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
        const c = centroid3(q);
        const out = norm([c[0], 0.15, c[2] + 0.012]);
        const tone = patches.has(i * 10 + j)
          ? mix(P.worn, P.wornDark, rng.next() * 0.5)
          : shade(i % 2 ? red : mix(red, P.crimsonDark, 0.4), (1 - 0.16 * (j / NV)) * (1 + rng.jitter(0.06)));
        if (j === NV - 1 && rng.chance(0.22)) continue; // torn out of the hem
        shClothQuad(g, q, out, tone, j >= NV - 2 && rng.chance(0.35));
      }
    // mantle: from the cloak's top edge in over the shoulders to the collar
    for (let i = 0; i < NU; i++) {
      const neck = (k: number): Vec3 => {
        const phi = (-104 + (208 * k) / NU) * DEG;
        return [Math.sin(phi) * 0.1, 1.408, -Math.cos(phi) * 0.088 - 0.006];
      };
      shClothQuad(g, [grid[i][0], grid[i + 1][0], neck(i + 1), neck(i)], [0, 1, 0], shade(i % 2 ? red : mix(red, P.crimsonDark, 0.3), 1.04 + rng.jitter(0.04)));
    }
  });

  /* offerings */
  const top = PL;
  const led = LEDGE;
  // candles on the plinth by the feet and on the ledge
  const candles: [number, number, number, number][] = [
    // x, y, z, height
    [-0.42, top, 0.44, 0.2],
    [-0.31, top, 0.55, 0.12],
    [-0.5, top, 0.3, 0.08],
    [0.4, top, 0.46, 0.16],
    [0.5, top, 0.33, 0.24],
    [0.29, top, 0.58, 0.07],
    [-0.5, led, 0.88, 0.17],
    [-0.36, led, 0.97, 0.09],
    [-0.62, led, 0.78, 0.07],
    [0.56, led, 0.83, 0.13],
    [0.44, led, 0.95, 0.2],
    [0.06, led, 1.02, 0.06],
    [-0.98, 0, 0.62, 0.15],
    [-1.06, 0, 0.47, 0.08],
    [1.0, 0, 0.6, 0.11],
  ];
  for (const [x, y, z, hgt] of candles) shCandle(b, rng, [x, y, z], hgt, 0.026, true);
  // noodle cup with chopsticks (the fans' supper)
  {
    const at: Vec3 = [0.1, top, 0.56];
    b.cylinder({ height: 0.115, radiusBottom: 0.036, radiusTop: 0.052, sides: 8, at: [at[0], at[1] + 0.0575, at[2]], color: P.white, parts: { top: mix(P.cardboard, P.torch, 0.3) }, vary: 0.04 });
    b.cylinder({ height: 0.034, radiusBottom: 0.0425, radiusTop: 0.047, sides: 8, at: [at[0], at[1] + 0.066, at[2]], color: P.crimson, caps: false });
    for (const dx of [-0.012, 0.012])
      shBeam(b, [at[0] + dx, at[1] + 0.1, at[2]], [at[0] + dx * 2.2 + 0.05, at[1] + 0.25, at[2] - 0.05], 0.007, 0.007, { color: P.woodLight }, [0, 0, 1]);
  }
  // mugs on the ledge
  for (const [x, z, c, yaw] of [
    [-0.12, 0.93, P.white, 30],
    [0.22, 0.86, P.crimson, -50],
  ] as const) {
    b.cylinder({ height: 0.095, radius: 0.042, sides: 8, at: [x, led + 0.0475, z], color: c, parts: { top: shade(P.woodDark, 0.6) }, vary: 0.04 });
    b.box({ size: [0.016, 0.05, 0.03], at: [x + Math.cos(yaw * DEG) * 0.052, led + 0.05, z + Math.sin(yaw * DEG) * 0.052], rot: [0, -yaw, 0], color: shade(c, 0.92) });
  }
  // a tin of cave flowers
  {
    const at: Vec3 = [-0.24, top, 0.62];
    b.cylinder({ height: 0.12, radius: 0.046, sides: 7, at: [at[0], at[1] + 0.06, at[2]], color: mix(P.rust, P.metalDark, 0.35), parts: { top: P.mud }, vary: 0.06 });
    const blooms: Color[] = [P.white, "#E3C766", mix(P.crimsonFaded, P.worn, 0.3), P.white, "#E3C766"];
    blooms.forEach((c, i) => {
      const a = (i / blooms.length) * Math.PI * 2 + 0.4;
      const tip: Vec3 = [at[0] + Math.cos(a) * 0.075, at[1] + 0.26 + (i % 2) * 0.05, at[2] + Math.sin(a) * 0.075];
      shBeam(b, [at[0], at[1] + 0.11, at[2]], tip, 0.007, 0.007, { color: "#5D7350" }, [0, 0, 1]);
      b.rock({ size: [0.062, 0.045, 0.062], points: 7, jitter: 0.15, at: tip, color: c, vary: 0.06 });
    });
  }
  // folded notes weighed down on the ledge and at the foot
  for (const [x, y, z, yaw] of [
    [0.36, led, 1.0, 20],
    [-0.02, led, 0.82, -35],
    [0.75, led, 0.66, 60],
    [-0.8, 0, 0.92, 10],
    [0.7, 0, 0.98, -20],
  ] as const)
    b.box({ size: [0.13, 0.006, 0.095], at: [x, y + 0.004, z], rot: [0, yaw, 0], color: SH_PAPER, parts: { top: mix(SH_PAPER, P.worn, 0.3) }, vary: 0.05 });
  // a folded scarf left on the ledge
  b.box({ size: [0.22, 0.045, 0.13], at: [-0.33, led + 0.0225, 0.78], rot: [0, 24, 0], chamfer: 0.012, color: SH_CRIMSONS[0], parts: { top: mix(P.crimson, P.crimsonFaded, 0.5) }, vary: 0.05 });
  b.box({ size: [0.225, 0.012, 0.03], at: [-0.33, led + 0.047, 0.78], rot: [0, 24, 0], color: P.worn });

  m.anchor("head", [0, r4(PL + K * (1.452 + 0.16 * 1.16)), 0.05]);
  m.anchor("plinth_top", [0, PL, 0]);
  // where the floating trophy's base hovers (tl_env_shrine_trophy_v01): 0.42 m above the hair
  m.anchor("trophy", [0, SHRINE_TROPHY_Y, 0]);
  m.light({ name: "candles", at: [0, 0.82, 1.05], color: "#FFB65C", intensity: 1.3, range: 4.5 });
  m.collider = { type: "cylinder", center: [0, 1.6, 0], radius: 1.16, height: 3.2 };
  m.meta = { plinthHeight: PL, figureScale: K, obstacleRadius: 1.2 };
  return m;
}

/* ---------------------------------------------------------------- the floating trophy */

/** Height (m, idol space) at which the trophy's base hovers above the idol's head (hair top ~3.33 m). */
const SHRINE_TROPHY_Y = 3.75;

function buildShrineTrophy(): Model {
  const name = "tl_env_shrine_trophy_v01";
  const m = new Model(name, {
    budget: 700,
    notes:
      "The championship trophy that floats above the shrine idol: a generic low-poly cup, 0.96 m tall - stepped base, " +
      "slim stem with a knot, a wide flaring bowl and two tall looping handles (no logos, plates or text). Every face is " +
      "emissive (tl_glow, pale silver-blue with warm gold bands), shaded per facet so the form reads without light. The " +
      "runtime spins it about Y, bobs it and puts a pulsing omni at 'light_anchor'. Pivot: centre of the base.",
  });
  const b = m.geo;
  const SILVER: Color = "#D9E6F5";
  const BLUE: Color = "#9CC3F0";
  const GOLD: Color = "#F6D995";
  const GLOW = 1.5;
  /** Unlit facets: brighter on top and toward +Z / +X, so the cup keeps its shape while it turns. */
  const lit = (c: Color) => (f: { normal: Vec3 }) => shade(c, clamp(0.74 + 0.2 * f.normal[1] + 0.1 * f.normal[2] + 0.06 * f.normal[0], 0.5, 1.08));
  const cyl = (y0: number, y1: number, r0: number, r1: number, c: Color, sides = 10, caps: boolean | "top" | "bottom" = true) =>
    b.cylinder({ height: y1 - y0, radiusBottom: r0, radiusTop: r1, sides, at: [0, (y0 + y1) / 2, 0], color: lit(c), mat: "glow", glow: GLOW, caps });
  // base: two steps and a collar
  cyl(0, 0.07, 0.2, 0.185, SILVER);
  cyl(0.07, 0.12, 0.15, 0.135, GOLD);
  cyl(0.12, 0.2, 0.105, 0.06, SILVER);
  // stem with a knot
  cyl(0.2, 0.34, 0.04, 0.034, BLUE, 8, false);
  cyl(0.34, 0.37, 0.034, 0.075, GOLD, 8);
  cyl(0.37, 0.4, 0.075, 0.034, GOLD, 8);
  cyl(0.4, 0.48, 0.034, 0.05, BLUE, 8, false);
  // bowl: flares out to a wide rim, gold band under the lip
  cyl(0.48, 0.6, 0.05, 0.21, SILVER, 12, "bottom");
  cyl(0.6, 0.78, 0.21, 0.3, SILVER, 12, false);
  cyl(0.78, 0.83, 0.3, 0.325, GOLD, 12, false);
  cyl(0.83, 0.86, 0.325, 0.335, SILVER, 12, false);
  // the inside of the bowl (seen from above and through the open rim)
  cyl(0.845, 0.86, 0.06, 0.325, BLUE, 12, "top");
  // two looping handles: out from the rim, up over it and down to the stem's knot
  for (const s of [-1, 1]) {
    const pts: Vec3[] = [
      [s * 0.3, 0.8, 0],
      [s * 0.43, 0.9, 0],
      [s * 0.5, 0.82, 0],
      [s * 0.49, 0.66, 0],
      [s * 0.4, 0.52, 0],
      [s * 0.25, 0.44, 0],
      [s * 0.07, 0.385, 0],
    ];
    for (let i = 0; i + 1 < pts.length; i++)
      shBeam(b, pts[i], pts[i + 1], 0.05, 0.034, { color: lit(i % 2 ? BLUE : SILVER), mat: "glow", glow: GLOW }, [0, 0, 1], 0.94);
  }
  m.anchor("light_anchor", [0, 0.62, 0]);
  m.light({ name: "trophy", at: [0, 0.62, 0], color: "#CFE2FF", intensity: 1.6, range: 7 });
  m.meta = { height: 0.96, hoverAt: SHRINE_TROPHY_Y, spin: "about Y, runtime" };
  return m;
}

/* ---------------------------------------------------------------- gate, banner, rope */

const SHRINE_GATE_POST_X = 1.55;

function buildShrineGate(): Model {
  const name = "tl_env_shrine_gate_v01";
  const m = new Model(name, {
    budget: 700,
    notes:
      "Rough timber gate (two leaning posts, a long top beam, a tie beam) with a paper-strip rope and rags knotted " +
      "to the posts; clear opening 2.8 m wide, 2.7 m under the rope. Faces +Z. It marks the shrine's way back to " +
      "the cave, in front of the tunnel mouth on the +Z side. Lanterns hang at anchors 'lantern_l' / 'lantern_r'.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const postH = 3.55;
  const X = SHRINE_GATE_POST_X;
  for (const s of [1, -1]) {
    b.plank({ size: [postH, 0.24, 0.25], jitter: 0.08, at: [s * (X + 0.04), postH / 2, 0], rot: [0, rng.jitter(3), 90 + s * 2.2], ...shWood(rng.pick(SH_WOODS)) });
    b.rock({ size: [0.62, 0.36, 0.56], points: 10, jitter: 0.25, flat: 0.25, align: "bottom", at: [s * (X + 0.12), 0, 0.05], rot: [0, rng.range(0, 90), 0], color: rockPaint(rng, SH_STONE, 0.2) });
    b.rock({ size: [0.34, 0.22, 0.3], points: 8, jitter: 0.25, flat: 0.25, align: "bottom", at: [s * (X - 0.3), 0, -0.12], rot: [0, rng.range(0, 90), 0], color: rockPaint(rng, mix(SH_STONE, P.rock, 0.25), 0.2) });
    // wedge under the top beam
    b.wedge({ size: [0.24, 0.1, 0.2], at: [s * (X + 0.2), postH + 0.03, 0.02], rot: [0, s * 90, 0], color: P.woodDark });
  }
  const topY = postH + 0.19;
  b.plank({ size: [4.5, 0.27, 0.3], jitter: 0.07, at: [0, topY, 0], rot: [0, 0, rng.jitter(1.2)], ...shWood(SH_WOODS[1]) });
  const tieY = 3.06;
  b.plank({ size: [3.75, 0.16, 0.19], jitter: 0.08, at: [0, tieY, 0.01], rot: [0, 0, rng.jitter(1)], ...shWood(SH_WOODS[2]) });
  // short strut between the beams (the tablet post of a torii, left blank)
  b.plank({ size: [0.36, 0.13, 0.15], jitter: 0.05, at: [0, (topY + tieY) / 2 - 0.02, 0.01], rot: [0, 0, 90], ...shWood(SH_WOODS[0]) });
  // rope with paper strips under the tie beam
  shGarland(b, rng, X - 0.1, 2.97, 0.17, 0.026, 0.1, 0.4);
  // rags knotted round the posts
  for (const s of [1, -1]) {
    b.cylinder({ height: 0.1, radius: 0.15, sides: 6, at: [s * (X + 0.02), 1.75, 0], color: SH_ROPE, vary: 0.06 });
    shRag(b, rng, [s * (X - 0.02), 1.72, 0.13], 0.5, 0.11, rng.pick(SH_CRIMSONS));
    shRag(b, rng, [s * (X + 0.1), 1.72, 0.12], 0.36, 0.09, mix(P.worn, P.wornDark, 0.4));
  }
  // lantern cords from the beam ends
  const lx = 2.02;
  for (const s of [1, -1]) b.tube([[s * lx, topY - 0.12, 0.02], [s * lx, topY - 0.36, 0.02]], { radius: 0.008, sides: 4, color: SH_ROPE });
  placeBottomCentre(m, b);
  const bb = b.bounds()!;
  const dx = -(bb.min[0] + bb.max[0]) / 2;
  const dz = -(bb.min[2] + bb.max[2]) / 2;
  m.anchor("lantern_l", [r4(lx + dx), r4(topY - 0.36), r4(0.02 + dz)]);
  m.anchor("lantern_r", [r4(-lx + dx), r4(topY - 0.36), r4(0.02 + dz)]);
  m.anchor("post_l", [r4(X + dx), 0, r4(dz)]);
  m.anchor("post_r", [r4(-X + dx), 0, r4(dz)]);
  m.meta = {
    clearWidth: r4(2 * (X - 0.12)),
    clearHeight: 2.73,
    postColliders: [
      { type: "cylinder", center: [X, postH / 2, 0], radius: 0.16, height: postH },
      { type: "cylinder", center: [-X, postH / 2, 0], radius: 0.16, height: postH },
    ],
  };
  return m;
}

function buildShrineBanner(): Model {
  const name = "tl_env_shrine_banner_v01";
  const m = new Model(name, {
    budget: 320,
    notes:
      "Banner pole 4.3 m: a leaning timber pole with a cross arm and a long tattered crimson cloth (worn-white " +
      "patches, no emblem), base rocks. The cloth faces +Z. The rim rope ties on at anchor 'tie' (1.12 m).",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const H = 4.3;
  const px = -0.52;
  b.plank({ size: [H, 0.13, 0.14], jitter: 0.08, at: [px, H / 2, 0], rot: [0, 3, 90 - 1.5], ...shWood(SH_WOODS[1]) });
  const armY = H - 0.32;
  b.plank({ size: [1.3, 0.085, 0.095], jitter: 0.1, at: [px + 0.5, armY, 0.02], rot: [0, 0, -2], ...shWood(SH_WOODS[2]) });
  // lashing where the arm crosses the pole
  b.cylinder({ height: 0.13, radius: 0.105, sides: 6, at: [px, armY, 0.01], color: SH_ROPE, vary: 0.06 });
  // strut
  shBeam(b, [px + 0.02, armY - 0.42, 0.02], [px + 0.42, armY - 0.03, 0.03], 0.05, 0.05, shWood(SH_WOODS[0]), [0, 0, 1]);
  const cw = 0.92,
    cl = 2.55;
  const cx = px + 0.62;
  b.cloth({
    size: [cw, cl],
    seg: [3, 8],
    noise: 0.014,
    tear: 0.6,
    tearEdges: "+z",
    displace: (x, _z, _u, v) => 0.05 * Math.sin(v * 6.5 + 0.7) * (0.4 + v) + 0.03 * (x / cw),
    at: [cx, armY - 0.06 - cl / 2, 0.075],
    rot: [90, 0, 0],
    // one colour fading toward the hem, two off-centre repairs (a pale one low on the pole side, a
    // dark one high on the far side): no stripes, nothing that reads as an emblem
    color: (f) => {
      const u = f.center[0] / cw + 0.5,
        v = f.center[2] / cl + 0.5;
      if (u < 0.34 && v > 0.5 && v < 0.76) return mix(P.worn, P.wornDark, 0.4);
      if (u > 0.66 && v > 0.12 && v < 0.26) return mix(P.crimsonDark, P.black, 0.3);
      return mix(mix(P.crimson, P.crimsonDark, 0.3), P.crimsonFaded, clamp(0.15 + 0.5 * v, 0, 1));
    },
    vary: 0.07,
  });
  // ties: top corners to the arm, a cord from the pole to the cloth's edge
  for (const dx of [-cw / 2 + 0.04, cw / 2 - 0.04])
    b.tube([[cx + dx, armY + 0.05, 0.03], [cx + dx, armY - 0.07, 0.078]], { radius: 0.009, sides: 4, color: SH_ROPE });
  b.tube([[px + 0.03, armY - 1.5, 0.03], [cx - cw / 2 + 0.03, armY - 1.62, 0.08]], { radius: 0.007, sides: 4, color: SH_ROPE });
  // base rocks
  b.rock({ size: [0.6, 0.38, 0.52], points: 10, jitter: 0.25, flat: 0.25, align: "bottom", at: [px + 0.06, 0, 0.04], rot: [0, 25, 0], color: rockPaint(rng, SH_STONE, 0.2) });
  b.rock({ size: [0.36, 0.22, 0.3], points: 8, jitter: 0.25, flat: 0.25, align: "bottom", at: [px + 0.42, 0, -0.14], rot: [0, 70, 0], color: rockPaint(rng, mix(SH_STONE, P.rock, 0.3), 0.2) });
  // rope lashing at tie height
  b.cylinder({ height: 0.09, radius: 0.09, sides: 6, at: [px, SHRINE_TIE_Y, 0], color: SH_ROPE, vary: 0.06 });
  placeBottomCentre(m, b);
  const bb = b.bounds()!;
  const dx = -(bb.min[0] + bb.max[0]) / 2;
  const dz = -(bb.min[2] + bb.max[2]) / 2;
  m.anchor("tie", [r4(px + dx), SHRINE_TIE_Y, r4(dz)]);
  m.anchor("pole", [r4(px + dx), 0, r4(dz)]);
  m.meta = { poleCollider: { type: "cylinder", center: [r4(px + dx), H / 2, r4(dz)], radius: 0.1, height: H } };
  return m;
}

function buildShrinePost(): Model {
  const name = "tl_env_shrine_post_v01";
  const m = new Model(name, {
    budget: 160,
    notes:
      "Rope post of the shrine rim, 1.45 m: a rough timber post wedged between two rocks, rope lashing and rags " +
      "at 1.12 m (anchor 'tie'). Two of them leave the opening of the rope circle on the approach.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  const H = 1.45;
  b.plank({ size: [H, 0.15, 0.16], jitter: 0.1, at: [0, H / 2, 0], rot: [0, 4, 90 + 2.5], ...shWood(SH_WOODS[0]) });
  b.cylinder({ height: 0.1, radius: 0.105, sides: 6, at: [0.012, SHRINE_TIE_Y, 0], color: SH_ROPE, vary: 0.06 });
  shRag(b, rng, [-0.03, SHRINE_TIE_Y - 0.03, 0.09], 0.42, 0.1, SH_CRIMSONS[1]);
  shRag(b, rng, [0.07, SHRINE_TIE_Y - 0.03, 0.085], 0.28, 0.08, mix(P.worn, P.wornDark, 0.4));
  shPaperStrip(b, rng, [0.0, SHRINE_TIE_Y - 0.06, -0.1], 0.07, 0.1, 3);
  b.rock({ size: [0.5, 0.3, 0.44], points: 10, jitter: 0.25, flat: 0.25, align: "bottom", at: [0.08, 0, 0.05], rot: [0, 40, 0], color: rockPaint(rng, SH_STONE, 0.2) });
  b.rock({ size: [0.3, 0.19, 0.26], points: 8, jitter: 0.25, flat: 0.25, align: "bottom", at: [-0.2, 0, -0.1], rot: [0, 10, 0], color: rockPaint(rng, mix(SH_STONE, P.rock, 0.3), 0.2) });
  placeBottomCentre(m, b);
  const bb = b.bounds()!;
  const dx = -(bb.min[0] + bb.max[0]) / 2;
  const dz = -(bb.min[2] + bb.max[2]) / 2;
  m.anchor("tie", [r4(dx + 0.012), SHRINE_TIE_Y, r4(dz)]);
  m.anchor("pole", [r4(dx), 0, r4(dz)]);
  return m;
}

/** Chord between two rim posts 30 degrees apart on the r = 8.9 circle. */
const SHRINE_ROPE_SPAN = 2 * 8.9 * Math.sin(15 * DEG);

function buildShrineRope(): Model {
  const name = "tl_env_shrine_rope_v01";
  const m = new Model(name, {
    budget: 260,
    notes:
      "Rim rope of the shrine: 4.61 m span between two posts (ends at y = 1.12 m, anchors 'end_l' / 'end_r'), " +
      "sagging 0.3 m, with paper strips and faded rags: a low cordon that marks the edge of the walkable circle " +
      "and stays under a follow camera's view. Cosmetic, no collider.",
  });
  const rng = new Rng(name);
  const half = SHRINE_ROPE_SPAN / 2;
  const yAt = shGarland(m.geo, rng, half, SHRINE_TIE_Y, 0.3, 0.02);
  m.anchor("end_l", [r4(half), SHRINE_TIE_Y, 0]);
  m.anchor("end_r", [r4(-half), SHRINE_TIE_Y, 0]);
  m.meta = { span: r4(SHRINE_ROPE_SPAN), endHeight: SHRINE_TIE_Y, lowest: r4(yAt(0)) };
  return m;
}

/* ---------------------------------------------------------------- candles */

function buildShrineCandles(): Model {
  const name = "tl_env_shrine_candles_v01";
  const m = new Model(name, {
    budget: 260,
    notes: "A flat stone with five wax candles (unlit glow flames) and a note. Light anchor 'light'. Cosmetic.",
  });
  const rng = new Rng(name);
  const b = new MeshBuilder(name);
  b.hull(slabPoints(rng, 0.62, 0.13, 0.46), { color: rockPaint(rng, SH_STONE, 0.24) });
  const top = 0.125;
  for (const [x, z, hgt] of [
    [-0.14, 0.02, 0.21],
    [0.02, -0.07, 0.13],
    [0.13, 0.05, 0.17],
    [-0.03, 0.1, 0.07],
    [0.19, -0.08, 0.06],
  ] as const)
    shCandle(b, rng, [x, top, z], hgt, 0.025, true);
  b.box({ size: [0.12, 0.006, 0.085], at: [-0.2, top + 0.008, -0.1], rot: [0, 25, 4], color: SH_PAPER, vary: 0.05 });
  placeBottomCentre(m, b);
  m.anchor("light", [0, 0.42, 0]);
  m.light({ name: "candles", at: [0, 0.42, 0], color: "#FFB65C", intensity: 0.9, range: 3.2 });
  return m;
}

/* ---------------------------------------------------------------- the door in the cave */

function buildShrineDoor(): Model {
  const name = "tl_env_shrine_door_v01";
  const m = new Model(name, {
    budget: 900,
    notes:
      "Cave-side door of the shrine. Place at the tunnel frame, cave (0, 0, -18.35) rotY 0 (tl_env_tunnel_frame_v01 " +
      "stays as the porch): a rough plank double door recessed in the tunnel mouth 1 m behind the frame (z = -1.03; " +
      "the right leaf stands half open inward, a faded cloth is pinned to the closed leaf), a two-plank name board " +
      "hung by ropes from the frame's lintel (anchor 'sign' = the board's face, 2.5 x 0.8 m), two lantern brackets " +
      "on the posts (anchors 'lantern_l' / 'lantern_r'). Authored around the frame's pivot, so its bounds are not " +
      "centred (expected pivot warning).",
  });
  const rng = new Rng(name);
  const b = m.geo;
  const DZ = TUN.mouthZ - (TUN.mouthZ + 0.95) - 0.08; // door plane behind the frame: -1.03
  const FY = TUN.floorY + 0.015;
  const leafW = TUN.halfW + 0.02;
  const leafH = TUN.shoulder - 0.02;
  /** A plank leaf hinged at x = 0, reaching dir * x, its face toward +Z. */
  const leaf = (seed: string, dir: 1 | -1): MeshBuilder => {
    const lb = new MeshBuilder(`${name}/${seed}`);
    const lr = new Rng(`${name}/${seed}/shape`);
    const n = 6;
    const pw = leafW / n;
    for (let i = 0; i < n; i++) {
      const hgt = leafH - lr.range(0, 0.09);
      lb.plank({
        size: [hgt, 0.05, pw - 0.012],
        jitter: 0.05,
        at: [dir * (i + 0.5) * pw, hgt / 2, 0],
        rot: [90, 0, 90],
        ...shWood(shade(lr.pick(SH_WOODS), 0.92), 0.07),
      });
    }
    for (const y of [0.42, 1.5, 2.52])
      lb.plank({ size: [leafW - 0.1, 0.045, 0.15], jitter: 0.06, at: [(dir * leafW) / 2, y, 0.047], rot: [90, 0, lr.jitter(1)], ...shWood(shade(SH_WOODS[2], 0.85)) });
    shBeam(lb, [dir * 0.12, 0.5, 0.047], [dir * (leafW - 0.12), 1.42, 0.047], 0.13, 0.04, shWood(shade(SH_WOODS[2], 0.8)), [0, 0, 1]);
    // iron pull ring near the free edge
    lb.ring({ radius: 0.075, inner: 0.052, depth: 0.018, segments: 8, at: [dir * (leafW - 0.2), 1.18, 0.085], color: P.metalDark, vary: 0.05 });
    return lb;
  };
  // left leaf (x from -halfW to 0): closed, a little crooked
  b.add(leaf("left", 1), { at: [-leafW, FY, DZ], rot: [0, -3, 0] });
  // right leaf: hinged at +halfW, standing half open into the tunnel
  b.add(leaf("right", -1), { at: [leafW, FY, DZ - 0.05], rot: [0, -46, 0] });
  // transom boards closing the pentagon above the leaves
  b.hull(
    [
      [-TUN.halfW - 0.1, TUN.shoulder - 0.12, DZ - 0.07],
      [TUN.halfW + 0.1, TUN.shoulder - 0.12, DZ - 0.07],
      [0, TUN.apex + 0.12, DZ - 0.07],
      [-TUN.halfW - 0.1, TUN.shoulder - 0.12, DZ - 0.02],
      [TUN.halfW + 0.1, TUN.shoulder - 0.12, DZ - 0.02],
      [0, TUN.apex + 0.12, DZ - 0.02],
    ],
    { color: shade(SH_WOODS[2], 0.62), vary: 0.05 },
  );
  // a faded cloth pinned to the closed leaf, paper charms on both
  b.cloth({
    size: [0.82, 1.28],
    seg: [3, 5],
    noise: 0.01,
    tear: 0.5,
    tearEdges: "+z",
    patches: 1,
    patchColor: [mix(P.worn, P.wornDark, 0.45)],
    displace: (_x, _z, _u, v) => 0.02 * Math.sin(v * 5),
    at: [-0.86, FY + 1.86 - 0.64, DZ + 0.1],
    rot: [90, 0, 0],
    color: mix(P.crimson, P.crimsonDark, 0.3),
    vary: 0.07,
  });
  for (const [x, y] of [
    [-1.5, 1.72],
    [-0.28, 1.36],
    [-1.42, 1.02],
  ] as const)
    b.box({ size: [0.1, 0.28, 0.006], at: [x, y, DZ + 0.085], rot: [0, 0, rng.jitter(7)], color: SH_PAPER, vary: 0.06 });

  /* the name board, hung from the frame's lintel */
  const BW = 2.5,
    BH = 0.8,
    BY = 2.33,
    BZ = 0.23;
  for (const s of [-1, 1])
    b.plank({ size: [BW + (s > 0 ? 0.06 : -0.04), 0.05, BH / 2 - 0.008], jitter: 0.05, at: [rng.jitter(0.02), BY + (s * BH) / 4, BZ], rot: [90, 0, rng.jitter(0.4)], ...shWood(mix(SH_WOODS[1], P.woodLight, 0.25)) });
  for (const x of [-0.82, 0.86]) b.plank({ size: [BH - 0.08, 0.04, 0.1], jitter: 0.06, at: [x, BY, BZ - 0.045], rot: [90, 0, 90], ...shWood(SH_WOODS[2]) });
  const lintelTop = 3.085;
  for (const x of [-0.98, 1.0]) {
    b.tube(
      [
        [x, BY + BH / 2 - 0.06, BZ + 0.03],
        [x, lintelTop - 0.03, 0.2],
        [x, lintelTop + 0.012, 0.1],
        [x, lintelTop + 0.012, -0.1],
        [x, lintelTop - 0.06, -0.19],
      ],
      { radius: 0.014, sides: 4, color: SH_ROPE, vary: 0.05 },
    );
    b.cylinder({ height: 0.03, radius: 0.03, sides: 6, at: [x, BY + BH / 2 - 0.07, BZ + 0.036], rot: [90, 0, 0], color: P.metalDark });
  }

  /* lantern brackets on the outer face of the posts */
  const hook: Vec3 = [2.03, 2.24, 0.16];
  for (const s of [1, -1]) {
    shBeam(b, [s * 1.62, 2.48, 0.03], [s * (hook[0] + 0.05), 2.42, hook[2]], 0.065, 0.075, shWood(SH_WOODS[0]), [0, 1, 0]);
    shBeam(b, [s * 1.66, 2.08, 0.03], [s * (hook[0] - 0.1), 2.4, hook[2] - 0.03], 0.045, 0.045, shWood(SH_WOODS[2]), [0, 1, 0]);
    b.tube([[s * hook[0], 2.4, hook[2]], [s * hook[0], hook[1], hook[2]]], { radius: 0.007, sides: 4, color: SH_ROPE });
    // rags knotted to the bracket
    shRag(b, rng, [s * 1.82, 2.4, 0.11], 0.42, 0.09, rng.pick(SH_CRIMSONS));
  }
  m.anchor("sign", [0, BY, r4(BZ + 0.032)]);
  m.anchor("lantern_l", [hook[0], hook[1], hook[2]]);
  m.anchor("lantern_r", [-hook[0], hook[1], hook[2]]);
  m.anchor("door_gap", [0.45, 1.5, r4(DZ - 0.6)]);
  m.meta = { place: { at: [0, 0, r4(TUN.mouthZ + 0.95)], rotY: 0 }, signSize: [BW, BH], doorPlaneZ: r4(DZ) };
  return m;
}

/* =========================================================================================
 * Group entry
 * ========================================================================================= */

/**
 * Walkable radius per angle bin: the closest wall / ledge / rubble geometry below `maxY`, sampled on
 * the triangles of the wall modules (cave space). The tunnel bins report the passage instead.
 */
function walkBoundary(walls: Model[], binDeg = 5, maxY = 1.8): [number, number][] {
  const bins = Math.round(360 / binDeg);
  const minR = new Array<number>(bins).fill(Infinity);
  const visit = (p: Vec3) => {
    if (p[1] > maxY) return;
    const a = (((Math.atan2(-p[2], p[0]) / DEG) % 360) + 360) % 360;
    const k = Math.floor(a / binDeg) % bins;
    minR[k] = Math.min(minR[k], Math.hypot(p[0], p[2]));
  };
  for (const w of walls)
    for (const bk of w.geo._buckets())
      for (let t = 0; t < bk.pos.length; t += 9) {
        const A: Vec3 = [bk.pos[t], bk.pos[t + 1], bk.pos[t + 2]];
        const B: Vec3 = [bk.pos[t + 3], bk.pos[t + 4], bk.pos[t + 5]];
        const C: Vec3 = [bk.pos[t + 6], bk.pos[t + 7], bk.pos[t + 8]];
        if (Math.min(A[1], B[1], C[1]) > maxY) continue;
        const n = 6;
        for (let i = 0; i <= n; i++)
          for (let j = 0; i + j <= n; j++) {
            const u = i / n,
              v = j / n;
            visit(add(add(scl(A, 1 - u - v), scl(B, u)), scl(C, v)));
          }
      }
  return minR.map((r, k) => [(k + 0.5) * binDeg, r4(Number.isFinite(r) ? r : WALL_R0)]);
}

export default function build(): Model[] {
  const field = buildWallField();
  const walls = Array.from({ length: SEGMENTS }, (_, s) => buildWall(field, s));
  const floor = buildFloor();
  floor.meta.walkBoundary = {
    note:
      "[thetaDeg, r] closest wall/ledge geometry below 1.8 m per 5 deg bin (theta from +X toward -Z). " +
      "Keep players inside r - 0.4. Bins around theta = 90 (the exit) see the tunnel walls, not the mouth.",
    bins: walkBoundary(walls),
  };
  return [
    floor,
    ...walls,
    buildCeiling(),
    buildStalactite("a"),
    buildStalactite("b"),
    buildStalagmite("a"),
    buildStalagmite("b"),
    buildRockCluster("a"),
    buildRockCluster("b"),
    buildRockCluster("c"),
    buildStone("a"),
    buildStone("b"),
    buildStone("c"),
    buildStone("d"),
    buildPuddle(),
    buildTunnelFrame(),
    buildShrineFloor(),
    buildShrineSeat("a"),
    buildShrineSeat("b"),
    buildShrineIdol(),
    buildShrineTrophy(),
    buildShrineGate(),
    buildShrineBanner(),
    buildShrinePost(),
    buildShrineRope(),
    buildShrineCandles(),
    buildShrineDoor(),
  ];
}

// Pure height functions (cave space) for the integrator / tests.
export { ceilingY, wallProfileR };
