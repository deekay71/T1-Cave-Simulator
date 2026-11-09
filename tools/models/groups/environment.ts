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
import { Model, MeshBuilder, PALETTE as P, Rng, mix, shade, type Color, type Vec2, type Vec3 } from "../lib.js";

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
  ];
}

// Pure height functions (cave space) for the integrator / tests.
export { ceilingY, wallProfileR };
