/**
 * Caves group — the multi-cave shell of "Hang trú thua": ONE large communal cave, FOUR small side
 * caves and the short walk-through tunnels that join them. Same look as the first shell in
 * groups/environment.ts (big ochre fold planes, dark crevices, flat-topped ledges, faceted ceiling
 * with hanging rock cones); the helpers below are copies of the ones in that file on purpose
 * (environment.ts is owned by another change).
 *
 * CAVE SPACE (main shell: tl_cave_main_floor / _wall_00..05 / _ceiling)
 * - Origin = campfire centre on the floor, Y up, metres, players spawn near (0, 10..12) looking at
 *   -Z. Instantiate every main piece at (0, 0, 0) with no rotation.
 * - Angle convention: theta is measured around +Y from +X toward -Z: dir(theta) =
 *   (cos theta, 0, -sin theta). Wall module k covers theta in [60k, 60k + 60).
 * - Five openings in the wall, each with its mouth in the plane 23.4 m from the origin:
 *   the exit toward -Z (theta 90, 3.5 x 3.6 m, dead-end passage, like the old shell) and four
 *   side openings (5.0 m wide, shoulders 2.9 m or more, apex 3.8-3.95 m, each skewed a little
 *   differently so they read as natural mouths) on the directions of the side caves.
 *
 * LOCAL FRAMES
 * - Side cave (tl_cave_side_a / _b): centre at the local origin, ONE opening facing local +Z with
 *   its mouth plane at z = +8.6. Place at a side centre with rotY so local +Z points at the
 *   world origin.
 * - Tunnel passage (tl_cave_tunnel_a / _b): runs along local Z, centred, local +Z toward the main
 *   cave. Place at the midpoint between the two mouth planes with the same rotY as the side cave.
 *   rotY = atan2(-ux, -uz) in degrees, where (ux, uz) is the unit direction origin -> side centre
 *   (= theta - 90).
 *
 * SEAMS: every side opening (main wall and side cave) carries a "collar": a short rock sleeve that
 * starts on the mouth ring (shared vertices with the wall) and flares outward, away from its own
 * cave. The tunnel tube starts 0.3 m behind each mouth plane with a ring that is LARGER than the
 * collar there, and narrows; the collar ends LARGER than the tube. The two surfaces therefore
 * cross once, and what a player sees from inside is the inner envelope, which is closed. Nothing
 * needs shared vertices between assets, and +-0.2 m of placement error is harmless.
 *
 * CLEARANCES (checked here at build time and again in scripts/caves-models.test.ts)
 * - Solid: nothing between y = 0.06 and y = 1.8 m inside the walkable union grown by 0.3 m.
 * - Camera: nothing between y = 0.6 m and the room's camera top (CAM_TOP: main 9 m, tunnel 2.6 m,
 *   side 3.2 m) + 0.15 m inside the walkable union grown by 0.75 m (the camera may sit 0.6 m
 *   outside the union).
 * - No T-junctions on open edges and no slivers along floor edges: the shells are rendered
 *   single-sided, and a one-pixel crack would show the clear colour.
 */
import {
  Model,
  MeshBuilder,
  PALETTE as P,
  Rng,
  mix,
  rotatePoint,
  shade,
  type Color,
  type Vec2,
  type Vec3,
} from "../lib.js";

/* =========================================================================================
 * Small maths helpers (copies of the private ones in environment.ts)
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
/** Angle (deg, 0..360) of a point around +Y in the convention above. */
const thetaOf = (x: number, z: number) => {
  const a = Math.atan2(-z, x) / DEG;
  return a < -1e-9 ? a + 360 : a;
};
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** Y rotation (deg) that turns a model's +Z toward the centre when it stands at angle theta. */
const faceCentreRotY = (thetaDeg: number) => thetaDeg - 90;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
const r4v = (v: Vec3): Vec3 => [r4(v[0]), r4(v[1]), r4(v[2])];

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
 * 2D geometry for the clearance rules
 * ========================================================================================= */

interface Disc {
  x: number;
  z: number;
  r: number;
}
function distPointSeg2(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-18 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}
/** Distance from a point to a convex polygon (0 inside). Degenerate polygons act as segments. */
function distPointPoly2(px: number, pz: number, poly: Vec2[]): number {
  let inside = poly.length >= 3;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(c) > 1e-12) {
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) inside = false;
    }
    best = Math.min(best, distPointSeg2(px, pz, a, b));
  }
  return inside && sign !== 0 ? 0 : best;
}
/** Convex hull of 2D points (monotone chain). */
function hull2(pts: Vec2[]): Vec2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** The part of a triangle with y0 <= y <= y1 (convex polygon, possibly empty). */
function clipSlab(tri: Vec3[], y0: number, y1: number): Vec3[] {
  const cut = (poly: Vec3[], keep: (p: Vec3) => number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = keep(a);
      const db = keep(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
      }
    }
    return out;
  };
  let poly = cut(tri, (p) => p[1] - y0);
  if (poly.length) poly = cut(poly, (p) => y1 - p[1]);
  return poly;
}

/* =========================================================================================
 * World layout (echoes packages/shared/src/rooms.ts usage; see meta.walk on the main floor)
 * ========================================================================================= */

/** Walkable union: main disc, four side discs, four tunnels (chains of r = 1.7 discs). */
export const CAVE_WALK = {
  main: { x: 0, z: 0, r: 20 },
  sides: [
    { id: "ne_back", x: 32, z: -18.5, r: 7 },
    { id: "nw_back", x: -32, z: -18.5, r: 7 },
    { id: "nw_front", x: -32, z: 18.5, r: 7 },
    { id: "ne_front", x: 32, z: 18.5, r: 7 },
  ],
  /** Tunnel discs run along origin -> side centre between these distances from the origin. */
  tunnel: { r: 1.7, from: 19.6, to: 30.4 },
} as const;
/** Highest camera position per room that the shells are guaranteed to clear (m). */
export const CAM_TOP = { main: 9, tunnel: 2.6, side: 3.2 } as const;
const SOLID_MARGIN = 0.3;
const SOLID_Y: [number, number] = [0.06, 1.8];
/** Camera may sit 0.6 m outside the union; 0.15 m more keeps the near plane out of the rock. */
const CAM_MARGIN = 0.75;
const CAM_Y0 = 0.6;
const CAM_PAD_Y = 0.15;

const MAIN_R0 = 23.4;
const SIDE_R0 = 8.6;
const SIDE_DIST = Math.hypot(CAVE_WALK.sides[0].x, CAVE_WALK.sides[0].z);
/** The tunnel tube starts this far behind each mouth plane. */
const TUBE_GAP = 0.3;
const TUBE_MID = (MAIN_R0 + SIDE_DIST - SIDE_R0) / 2;
const TUBE_HALF = (SIDE_DIST - SIDE_R0 - MAIN_R0) / 2 - TUBE_GAP;
/** Side mouths: at least 5.0 m wide up to 2.9 m, apex 3.8 m; each one is skewed a little differently. */
const MOUTH = { halfW: 2.5, shoulder: 2.9, apex: 3.8 };
function sideMouth(key: string): Pick<Opening, "halfW" | "shoulders" | "apex" | "apexS"> {
  const rng = new Rng(`${key}/mouth`);
  const high = rng.sign();
  const lift = rng.range(0.3, 0.5);
  return {
    halfW: MOUTH.halfW,
    shoulders: high > 0 ? [MOUTH.shoulder + lift, MOUTH.shoulder] : [MOUTH.shoulder, MOUTH.shoulder + lift],
    apex: MOUTH.apex + rng.range(0, 0.15),
    apexS: high * rng.range(0.45, 0.8),
  };
}
const EXIT = { halfW: 1.75, shoulder: 2.9, apex: 3.6, depth: 6.4, floorY: 0.04 };

export interface CavePlacement {
  id: string;
  /** Direction of the side cave seen from the origin (deg, cave-space theta). */
  theta: number;
  /** setEulerAngles(0, rotY, 0) for both the tunnel and the side cave. */
  rotY: number;
  side: { asset: string; at: Vec3 };
  tunnel: { asset: string; at: Vec3 };
}
/** Where the tunnel and side-cave assets go (verified by the test and the caves-lab page). */
export function cavePlacements(): CavePlacement[] {
  return CAVE_WALK.sides.map((s, i) => {
    const d = Math.hypot(s.x, s.z);
    const ux = s.x / d;
    const uz = s.z / d;
    const v = i % 2 === 0 ? "a" : "b";
    return {
      id: s.id,
      theta: r4(thetaOf(s.x, s.z)),
      rotY: r4(Math.atan2(-ux, -uz) / DEG),
      side: { asset: `tl_cave_side_${v}_v01`, at: [s.x, 0, s.z] },
      tunnel: { asset: `tl_cave_tunnel_${v}_v01`, at: [r4(ux * TUBE_MID), 0, r4(uz * TUBE_MID)] },
    };
  });
}

interface Room extends Disc {
  top: number;
}
/** Walk discs with camera tops, in cave space (tunnels as dense disc chains). */
function worldRooms(): Room[] {
  const rooms: Room[] = [{ ...CAVE_WALK.main, top: CAM_TOP.main }];
  for (const s of CAVE_WALK.sides) {
    rooms.push({ x: s.x, z: s.z, r: s.r, top: CAM_TOP.side });
    const d = Math.hypot(s.x, s.z);
    const { from, to, r } = CAVE_WALK.tunnel;
    const n = Math.ceil((to - from) / 0.25);
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      rooms.push({ x: (s.x / d) * t, z: (s.z / d) * t, r, top: CAM_TOP.tunnel });
    }
  }
  return rooms;
}
const WORLD_ROOMS = worldRooms();
/** Rooms expressed in the local frame of an asset placed at `at` with `rotY`. */
function roomsInFrame(at: Vec3, rotY: number): Room[] {
  const c = Math.cos(rotY * DEG);
  const s = Math.sin(rotY * DEG);
  return WORLD_ROOMS.map((o) => {
    const dx = o.x - at[0];
    const dz = o.z - at[2];
    // inverse of world = R_y(rotY) * local + at
    return { ...o, x: dx * c - dz * s, z: dx * s + dz * c };
  });
}

/** Worst penetration (m, > 0 = violation) of triangles into the solid and camera keep-out volumes. */
function penetration(tris: Vec3[][], rooms: Room[]): { solid: number; cam: number } {
  let solid = -Infinity;
  let cam = -Infinity;
  for (const tri of tris) {
    const lo = Math.min(tri[0][1], tri[1][1], tri[2][1]);
    const hi = Math.max(tri[0][1], tri[1][1], tri[2][1]);
    if (hi < SOLID_Y[0]) continue;
    const ps = lo <= SOLID_Y[1] ? clipSlab(tri, SOLID_Y[0], SOLID_Y[1]).map((p): Vec2 => [p[0], p[2]]) : [];
    let pc: Vec2[] | null = null;
    let pcTop = -1;
    for (const o of rooms) {
      if (ps.length) solid = Math.max(solid, o.r + SOLID_MARGIN - distPointPoly2(o.x, o.z, ps));
      const top = o.top + CAM_PAD_Y;
      if (lo > top || hi < CAM_Y0) continue;
      if (pcTop !== top) {
        pc = clipSlab(tri, CAM_Y0, top).map((p): Vec2 => [p[0], p[2]]);
        pcTop = top;
      }
      if (pc && pc.length) cam = Math.max(cam, o.r + CAM_MARGIN - distPointPoly2(o.x, o.z, pc));
    }
  }
  return { solid, cam };
}
function trisOf(b: MeshBuilder): Vec3[][] {
  const out: Vec3[][] = [];
  for (const k of b._buckets())
    for (let i = 0; i < k.pos.length; i += 9)
      out.push([
        [k.pos[i], k.pos[i + 1], k.pos[i + 2]],
        [k.pos[i + 3], k.pos[i + 4], k.pos[i + 5]],
        [k.pos[i + 6], k.pos[i + 7], k.pos[i + 8]],
      ]);
  return out;
}
function modelTris(m: Model): Vec3[][] {
  const out: Vec3[][] = [];
  m.root.walk((n) => out.push(...trisOf(n.geo)));
  return out;
}
/** Build-time guard: throws when a model intrudes into the walkable or camera volumes. */
function assertClear(m: Model, rooms: Room[]): void {
  const p = penetration(modelTris(m), rooms);
  if (p.solid > 1e-6 || p.cam > 1e-6)
    throw new Error(
      `${m.name}: intrudes into the keep-out volume (solid ${p.solid.toFixed(3)} m, camera ${p.cam.toFixed(3)} m)`,
    );
}

/* =========================================================================================
 * Rock tones and rock shapes (same as environment.ts)
 * ========================================================================================= */

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

interface SpikeOpts {
  base: Vec3;
  dir: 1 | -1;
  length: number;
  radius: number;
  sides?: number;
  rings?: number[];
  lean?: number;
  tone: Color;
  tipTone?: Color;
}
/** Faceted cave spike (stalactite / hanging rock cone). Returns the tip point. */
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
  for (const t of ringsT) layers.push({ t, pts: ring(t, radiusAt(t)) });
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
  return tip;
}

/* =========================================================================================
 * Shell description (shared by the main cave and the side caves)
 * ========================================================================================= */

interface Opening {
  id: string;
  kind: "exit" | "side";
  /** Direction of the mouth centre seen from the shell centre (deg). */
  theta: number;
  /** Distance of the mouth plane from the shell centre (m). */
  dist: number;
  halfW: number;
  /** Height of the jamb tops on the +theta side and on the -theta side. */
  shoulders: [number, number];
  apex: number;
  /** Sideways offset of the apex along +theta (natural mouths are not symmetric). */
  apexS: number;
}
/** The five points of a mouth ring grown by (dw, ds, da), `out` metres behind the mouth plane. */
function mouthRing(o: Opening, out = 0, dw = 0, ds = 0, da = 0, y0 = 0): Vec3[] {
  const hw = o.halfW + dw;
  return [
    mouthPoint(o, hw, y0, out),
    mouthPoint(o, hw, o.shoulders[0] + ds, out),
    mouthPoint(o, o.apexS, o.apex + da, out),
    mouthPoint(o, -hw, o.shoulders[1] + ds, out),
    mouthPoint(o, -hw, y0, out),
  ];
}
/**
 * Point in the frame of an opening: `s` metres along +theta in the mouth plane, height `y`,
 * `out` metres beyond the mouth plane (away from the shell centre).
 */
function mouthPoint(o: Opening, s: number, y: number, out = 0): Vec3 {
  const c = Math.cos(o.theta * DEG);
  const sn = Math.sin(o.theta * DEG);
  const d = o.dist + out;
  return [c * d - sn * s, y, -sn * d - c * s];
}
/** Distance of (x, z) from an opening's axis, and how far along it (m from the shell centre). */
function axisCoords(o: Opening, x: number, z: number): { lat: number; along: number } {
  const u = dirOf(o.theta);
  const along = x * u[0] + z * u[2];
  return { lat: Math.abs(-x * u[2] + z * u[0]), along };
}

interface ShellSpec {
  /** Seed prefix (asset family). */
  key: string;
  segments: number;
  R0: number;
  /** Extra radius >= 0 by direction (side variant B is not round). */
  bulge: (theta: number) => number;
  /** How far the wall leans inward at height y. */
  lean: (y: number) => number;
  wallTop: number;
  rows: number[];
  rowJit: number[];
  rowFold: number[];
  /** Angular spacing of the fold columns (deg). */
  colStep: [number, number];
  ridge: [number, number];
  crevice: [number, number];
  /** Jitters: column angle (deg), diagonal drift over the wall height (deg), radius (m). */
  thJit: number;
  drift: number;
  rJit: number;
  /** Minimum angular gap kept between neighbouring columns of a row (deg). */
  minSep: number;
  /** Fold of the opening columns and of the columns flanking an opening (portal buttress). */
  openFold: number;
  buttress: [number, number];
  buttressLat: number;
  /** A flat-backed alcove in the wall. */
  niche?: { theta: number; half: number; depth: number; rowFold: number[] };
  /**
   * A flat rock face cut into the wall (the main cave's screen wall): every vertex of the columns
   * whose angle lies in [from, to], in the lowest `rows` rows, is moved onto one plane. The plane
   * faces the shell's axis at `theta`, stands `r0` m from the axis at the floor and leans inward
   * `slope` m per metre of height; the first and last column are also slid sideways to `half` m
   * either side of its centre line, so the face is a clean rectangle 2 * half wide. `top` lifts the
   * highest of those rows to at least that height, so the face is flat that high. Applied after the
   * field is built and without drawing random numbers: the rest of the wall is unchanged.
   */
  panel?: { theta: number; from: number; to: number; half: number; r0: number; slope: number; rows: number; top?: number };
  floorR: number;
  /** The floor is flat (0.006..0.035) wherever a triangle reaches inside this radius. */
  flatR: number;
  riseFrom: number;
  riseH: number;
  floorStep: (r: number) => number;
  ceil: {
    apex: number;
    R: number;
    drop: number;
    pow: number;
    noise: number;
    fadeFrom: number;
    step: (r: number) => number;
    /** Extra height of the rim behind the openings (m); only needed where the ceiling is low. */
    mouthLift?: number;
  };
  /** Wall facets darken from this height to the wall top. */
  darkFrom: number;
  openings: Opening[];
  /** Keep-out discs (margins included) for ledges, boulders and rubble. */
  keep: Disc[];
  /** Scale of the ledge / boulder / rubble sizes relative to the main cave. */
  rockScale: number;
  ledgeSlots: number;
  rubble: number;
  noise: number;
}

/* =========================================================================================
 * Walls: one ring of fold columns per shell (split into modules that share boundary vertices)
 * ========================================================================================= */

interface WallCol {
  theta: number;
  tag: "" | "boundary" | "open" | "niche";
  open?: { o: Opening; role: -1 | 0 | 1 };
  fold: number;
  rowFold?: number[];
  drift: number;
  tone: Color;
}
interface WallField {
  cols: WallCol[];
  /** V[col][row] */
  V: Vec3[][];
}

function ceilingY(S: ShellSpec, x: number, z: number): number {
  const c = S.ceil;
  const r = Math.hypot(x, z);
  const n = vnoise(x / 4.2, z / 4.2, S.noise + 31) * 0.7 + vnoise(x / 1.8, z / 1.8, S.noise + 32) * 0.3;
  let y = c.apex - c.drop * Math.pow(clamp(r / c.R, 0, 1.2), c.pow) + n * c.noise * (1 - smoothstep(c.fadeFrom, c.R, r));
  // A low ceiling would dip into the passage behind a mouth: lift its (hidden) rim clear of the collar.
  if (c.mouthLift)
    for (const o of S.openings) {
      const a = axisCoords(o, x, z);
      y += c.mouthLift * smoothstep(o.dist - 1, o.dist + 1.2, a.along) * (1 - smoothstep(o.halfW + 2, o.halfW + 4.5, a.lat));
    }
  return y;
}

function buildWallField(S: ShellSpec): WallField {
  const rng = new Rng(`${S.key}/wall_field`);
  const required = new Map<number, Pick<WallCol, "tag" | "open">>();
  for (let k = 0; k < S.segments; k++) required.set((k * 360) / S.segments, { tag: "boundary" });
  for (const o of S.openings) {
    const delta = Math.atan(o.halfW / o.dist) / DEG;
    for (const role of [-1, 0, 1] as const)
      required.set((((o.theta + role * delta) % 360) + 360) % 360, { tag: "open", open: { o, role } });
  }
  if (S.niche) for (const sg of [-1, 1]) required.set(S.niche.theta + sg * S.niche.half, { tag: "niche" });
  const req = [...required.keys()].sort((a, b) => a - b);
  const cols: WallCol[] = [];
  const col = (theta: number, r: Pick<WallCol, "tag" | "open">): WallCol => ({
    theta,
    ...r,
    fold: 0,
    drift: 0,
    tone: P.ochre,
  });
  for (let i = 0; i < req.length; i++) {
    const a = req[i];
    const b = i + 1 < req.length ? req[i + 1] : 360;
    cols.push(col(a, required.get(a)!));
    const inNiche = S.niche !== undefined && required.get(a)!.tag === "niche" && a < S.niche.theta;
    const n = inNiche ? 1 : Math.max(1, Math.round((b - a) / rng.range(S.colStep[0], S.colStep[1])));
    const step = (b - a) / n;
    for (let t = 1; t < n; t++) cols.push(col(a + t * step + rng.jitter(step * 0.22), { tag: "" }));
  }
  // Fold pattern: mostly alternating ridge / crevice, with wide flat faces and deep narrow crevices.
  let prevCrevice = rng.chance(0.5);
  for (const c of cols) {
    const crevice = prevCrevice ? rng.chance(0.16) : rng.chance(0.72);
    c.fold = crevice ? rng.range(S.crevice[0], S.crevice[1]) : -rng.range(S.ridge[0], S.ridge[1]);
    c.drift = c.tag ? 0 : rng.jitter(S.drift);
    c.tone = pickW(rng, WALL_TONES);
    prevCrevice = crevice;
  }
  // The rock around every opening protrudes like a portal buttress; the niche is a deep recess.
  for (const c of cols) {
    if (c.tag === "open") c.fold = S.openFold;
    else if (c.tag === "niche") {
      c.fold = S.niche!.depth;
      c.rowFold = S.niche!.rowFold;
    } else {
      const flank = S.openings.some((o) => angDiff(c.theta, o.theta) * DEG * o.dist < S.buttressLat);
      const nearNiche = S.niche !== undefined && angDiff(c.theta, S.niche.theta) < S.niche.half + S.colStep[1] * 1.2;
      if (flank || nearNiche) c.fold = -rng.range(S.buttress[0], S.buttress[1]);
    }
  }
  const top = S.rows.length - 1;
  const V: Vec3[][] = cols.map((c) => {
    const k = 1 + rng.jitter(0.08);
    const rf = c.rowFold ?? S.rowFold;
    return S.rows.map((y0, i) => {
      let y = i === 0 ? 0 : y0 + rng.jitter(S.rowJit[i]);
      // the wall above a mouth must stay above its ring (no folded-over facet over the opening)
      if (c.open && i >= 2) y = Math.max(y, (c.open.role === 0 ? c.open.o.apex : Math.max(...c.open.o.shoulders)) + 0.8);
      const fixed = c.tag !== "";
      const th = c.theta + (fixed ? 0 : c.drift * (y / S.wallTop) + rng.jitter(i === 0 ? S.thJit * 0.7 : S.thJit));
      let r = S.R0 + S.bulge(c.theta) - S.lean(y) + c.fold * rf[i] * k * (1 + rng.jitter(0.08)) + rng.jitter(S.rJit);
      if (i === 0) r = Math.min(r, S.floorR - 0.35);
      return polar(th, r, y);
    });
  });
  // Keep every row strictly ordered in angle (no folded-over faces).
  for (let i = 0; i < S.rows.length; i++)
    for (let j = 1; j < cols.length; j++) {
      if (cols[j].tag) continue;
      const prev = thetaOf(V[j - 1][i][0], V[j - 1][i][2]);
      const next = j + 1 < cols.length ? thetaOf(V[j + 1][i][0], V[j + 1][i][2]) || 360 : 360;
      const a = thetaOf(V[j][i][0], V[j][i][2]);
      const fixedA = clamp(a, prev + S.minSep, next - S.minSep);
      if (fixedA !== a) {
        const r = Math.hypot(V[j][i][0], V[j][i][2]);
        V[j][i] = polar(fixedA, r, V[j][i][1]);
      }
    }
  // The flat rock face: project its columns onto the plane.
  if (S.panel) {
    const { theta, from, to, half, r0, slope, rows, top: faceTop } = S.panel;
    const n = dirOf(theta);
    const t: Vec3 = [-n[2], 0, n[0]];
    const inside = cols.flatMap((c, j) => (c.theta >= from - 1e-6 && c.theta <= to + 1e-6 ? [j] : []));
    if (inside.length < 2 || inside.some((j) => cols[j].open)) throw new Error(`${S.key}: panel needs two or more plain columns`);
    inside.forEach((j, q) => {
      const edge = q === 0 || q === inside.length - 1;
      for (let i = 0; i < rows; i++) {
        const v = V[j][i];
        if (i === rows - 1 && faceTop !== undefined && v[1] < faceTop) v[1] = faceTop;
        const rc = r0 - slope * v[1];
        // an edge column goes to the panel's side line; the others keep their own bearing
        const lat = edge ? Math.sign(dot(v, t)) * half : (dot(v, t) * rc) / dot(v, n);
        if (!edge && Math.abs(lat) > half) throw new Error(`${S.key}: panel column ${j} lies outside its edge columns`);
        V[j][i] = [n[0] * rc + t[0] * lat, v[1], n[2] * rc + t[2] * lat];
      }
    });
  }
  // Mouth rings: jambs up to the shoulders, the centre column carries the apex.
  cols.forEach((c, j) => {
    if (!c.open) return;
    const { o, role } = c.open;
    const ring = mouthRing(o);
    V[j][0] = role === 0 ? mouthPoint(o, 0, 0) : ring[role > 0 ? 0 : 4];
    V[j][1] = ring[2 - role];
  });
  // The ceiling must cut every column between its two top rows (closed wall / ceiling junction).
  cols.forEach((c, j) => {
    const a = V[j][top];
    const b = V[j][top - 1];
    if (ceilingY(S, a[0], a[2]) > a[1] - 0.2 || ceilingY(S, b[0], b[2]) < b[1] + 0.2)
      throw new Error(
        `${S.key}: ceiling misses the wall at theta ${c.theta.toFixed(1)}: top ${a[1].toFixed(2)} vs ceiling ` +
          `${ceilingY(S, a[0], a[2]).toFixed(2)} (r ${Math.hypot(a[0], a[2]).toFixed(2)}), below ${b[1].toFixed(2)} vs ` +
          `${ceilingY(S, b[0], b[2]).toFixed(2)} (r ${Math.hypot(b[0], b[2]).toFixed(2)})`,
      );
  });
  return { cols, V };
}

/** Column indices of module s, including the shared closing boundary column. */
function segmentColumns(S: ShellSpec, field: WallField, s: number): number[] {
  const seg = 360 / S.segments;
  const a = s * seg;
  const b = (s + 1) * seg;
  const idx: number[] = [];
  field.cols.forEach((c, j) => {
    if (c.theta >= a - 1e-9 && c.theta < b - 1e-9) idx.push(j);
  });
  const end = s + 1 < S.segments ? field.cols.findIndex((c) => Math.abs(c.theta - b) < 1e-9) : 0;
  return [...idx, end];
}

/** Inner wall radius at floor level for angle theta (interpolated between columns). */
function wallRadiusAt(S: ShellSpec, field: WallField, theta: number, row = 0): number {
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
  return S.R0;
}

/** Mean and smallest floor-level radius of the wall ring (the mouth centre columns have no foot). */
function wallRadiusStats(field: WallField): { mean: number; min: number } {
  const rs = field.cols.flatMap((c, j) => (c.open?.role === 0 ? [] : [Math.hypot(field.V[j][0][0], field.V[j][0][2])]));
  return { mean: r4(rs.reduce((a, b) => a + b, 0) / rs.length), min: r4(Math.min(...rs)) };
}

/** Colour of a wall facet: column tone, darker in crevices, toward the ceiling and when facing away. */
function wallColor(S: ShellSpec, rng: Rng, tone: Color, ctr: Vec3, n: Vec3): Color {
  const r = Math.hypot(ctr[0], ctr[2]);
  const recess = r - (S.R0 + S.bulge(thetaOf(ctr[0], ctr[2])) - S.lean(ctr[1]));
  const tRec = smoothstep(-0.2, 1.4, recess);
  const tH = smoothstep(S.darkFrom, S.wallTop, ctr[1]);
  const kRec = 1 - 0.5 * tRec;
  const kH = 1 - 0.35 * tH;
  const inward = norm([-ctr[0], 0, -ctr[2]]);
  const kF = 0.7 + 0.3 * clamp(dot(n, inward), 0, 1);
  // crevices and the upper wall also lose saturation (concept: cool grey-brown shadows)
  const base = mix(tone, P.shadow, 0.18 * tRec + 0.2 * tH);
  return shade(base, kRec * kH * kF * (1 + rng.jitter(0.045)));
}

/** Wall facets of module s (openings left out). Returns the smallest floor-level radius. */
function emitWall(b: MeshBuilder, S: ShellSpec, field: WallField, s: number, rng: Rng): number {
  const js = segmentColumns(S, field, s);
  let minR = Infinity;
  for (let q = 0; q < js.length - 1; q++) {
    const j0 = js[q];
    const j1 = js[q + 1];
    const c0 = field.cols[j0];
    const c1 = field.cols[j1];
    for (let i = 0; i < S.rows.length - 1; i++) {
      if (i === 0 && c0.open && c1.open && c0.open.o === c1.open.o) continue; // the opening itself
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
        triToward(b, p0, p1, p2, want, wallColor(S, rng, c0.tone, ctr, n));
      }
      if (i === 0) minR = Math.min(minR, Math.hypot(pa[0], pa[2]), Math.hypot(pb[0], pb[2]));
    }
  }
  return minR;
}

/**
 * Base ledges / boulders grown out of the wall and rubble along its foot (module s). Every rock
 * is pushed outward until it clears the keep-out discs; a rock that cannot is left out.
 */
function emitLedges(b: MeshBuilder, S: ShellSpec, field: WallField, s: number, seed: string): void {
  const seg = 360 / S.segments;
  const a0 = s * seg;
  const k = S.rockScale;
  const blocked = (poly: Vec2[]) => S.keep.some((d) => distPointPoly2(d.x, d.z, poly) < d.r);
  const latTo = (th: number) => Math.min(...S.openings.map((o) => angDiff(th, o.theta) * DEG * o.dist), Infinity);
  /** Push a footprint outward (up to 2.4 m); null when it never clears. */
  const settle = (th: number, r: number, footprint: (at: Vec3) => Vec2[]): Vec3 | null => {
    for (let step = 0; step <= 16; step++) {
      const at = polar(th, r + step * 0.15, 0);
      if (!blocked(footprint(at))) return at;
    }
    return null;
  };
  const circle = (rad: number) => (at: Vec3): Vec2[] =>
    Array.from({ length: 10 }, (_, i): Vec2 => [
      at[0] + (Math.cos(i * 36 * DEG) * rad) / Math.cos(18 * DEG),
      at[2] + (Math.sin(i * 36 * DEG) * rad) / Math.cos(18 * DEG),
    ]);

  const rng = new Rng(`${seed}/ledges`);
  const slots = rng.shuffle(Array.from({ length: S.ledgeSlots }, (_, i) => i));
  const nLedge = Math.min(S.ledgeSlots, rng.int(S.ledgeSlots - 1, S.ledgeSlots));
  for (let q = 0; q < nLedge; q++) {
    const th = a0 + ((slots[q] + 0.5) / S.ledgeSlots) * seg + rng.jitter(3);
    const shelf = q % 2 === 0;
    const w = (shelf ? rng.range(4.2, 6.5) : rng.range(2.2, 3.6)) * k;
    const h = (shelf ? rng.range(1.0, 1.7) : rng.range(1.5, 2.9)) * Math.pow(k, 0.8);
    const d = (shelf ? rng.range(2.2, 2.9) : rng.range(1.8, 2.6)) * k;
    const rW = wallRadiusAt(S, field, th);
    const rot: Vec3 = [0, faceCentreRotY(th) + rng.jitter(9), 0];
    const tone = pickW(rng, WALL_TONES);
    const pts = shelf
      ? blockPoints(rng, w, h, d, { taper: 0.78, bevel: 0.4, jit: 0.09, slope: 0.22 })
      : blockPoints(rng, w, h, d, { taper: 0.58, bevel: 0.42, jit: 0.12, slope: 0.15 });
    const paint = rockPaint(rng, tone, shelf ? 0.16 : 0.1);
    const loose = rng.chance(0.6);
    const looseSide = rng.sign();
    const looseK = rng.range(0.7, 1.0);
    const looseSize: Vec3 = [rng.range(0.8, 1.4) * k, rng.range(0.55, 1.0) * k, rng.range(0.7, 1.2) * k];
    const looseRot = rng.range(0, 180);
    const looseTone = pickW(rng, WALL_TONES);
    if (latTo(th) < 6.6 * Math.max(k, 0.75)) continue; // the portal rocks live here
    const local = pts.map((p) => rotatePoint(p, rot));
    const at = settle(th, rW - d * 0.28, (c) => hull2(local.map((p): Vec2 => [p[0] + c[0], p[2] + c[2]])));
    if (!at) continue;
    b.hull(pts, { at, rot, color: paint });
    // a loose rock leaning on the bigger ones
    if (loose) {
      const r = Math.hypot(at[0], at[2]);
      const th2 = th + ((looseSide * (w / 2 / r)) / DEG) * looseK;
      const rad = Math.hypot(looseSize[0], looseSize[2]) / 2;
      const at2 = settle(th2, wallRadiusAt(S, field, th2) - d * 0.75, circle(rad));
      if (at2)
        b.rock({
          size: looseSize,
          points: 12,
          jitter: 0.24,
          flat: 0.2,
          align: "bottom",
          at: at2,
          rot: [0, looseRot, 0],
          color: rockPaint(rng, looseTone, 0.14),
        });
    }
  }

  // Rubble along the wall base hides the wall/floor seam.
  const rub = new Rng(`${seed}/rubble`);
  for (let q = 0; q < S.rubble; q++) {
    const th = a0 + ((q + rub.range(0.15, 0.85)) / S.rubble) * seg;
    const back = rub.range(0.25, 1.1) * Math.max(k, 0.7);
    const sz = rub.range(0.35, 0.95) * Math.max(k, 0.7);
    const size: Vec3 = [sz, sz * rub.range(0.45, 0.75), sz * rub.range(0.7, 1)];
    const rot = rub.range(0, 180);
    const tone = rub.chance(0.5) ? pickW(rub, WALL_TONES) : rub.pick(BOULDER_TONES);
    if (latTo(th) < 3.1) continue;
    const at = settle(th, wallRadiusAt(S, field, th) - back, circle(Math.hypot(size[0], size[2]) / 2));
    if (!at) continue;
    b.rock({
      size,
      points: 9,
      jitter: 0.28,
      flat: 0.25,
      align: "bottom",
      at: [at[0], 0.04, at[2]],
      rot: [0, rot, 0],
      color: rockPaint(rub, tone, 0.16),
    });
  }
}

/* =========================================================================================
 * Openings: collar (side openings), natural rock arch, exit passage
 * ========================================================================================= */

/** Collar rings: [metres behind the mouth plane, half width, shoulder, apex]. Ring 0 is the mouth. */
const COLLAR: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [0.8, 0.45, 0.25, 0.6],
  [1.7, 1.6, 1.1, 1.8],
];
/**
 * Rock sleeve behind a side opening: starts on the mouth ring (same vertices as the wall) and
 * flares outward so it ends outside the tunnel tube (see SEAMS in the header).
 */
function emitCollar(b: MeshBuilder, o: Opening, rng: Rng): void {
  const rings = COLLAR.map(([out, dw, ds, da]) => mouthRing(o, out, dw, ds, da, out === 0 ? 0 : -0.15));
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    const axis = mouthPoint(o, 0, 1.7, (COLLAR[k][0] + COLLAR[k + 1][0]) / 2);
    for (let v = 0; v < A.length - 1; v++) {
      const quad = [A[v], A[v + 1], B[v + 1], B[v]];
      for (const [p0, p1, p2] of [
        [quad[0], quad[1], quad[2]],
        [quad[0], quad[2], quad[3]],
      ]) {
        const ctr = centroid3([p0, p1, p2]);
        const tone = mix(pickW(rng, WALL_TONES), P.shadow, 0.3 + 0.2 * k);
        triToward(b, p0, p1, p2, sub(axis, ctr), shade(tone, (0.8 - 0.1 * k) * (1 + rng.jitter(0.07))));
      }
    }
  }
}

/**
 * Rough natural rock arch around a side opening (no timber): two jamb rocks, stones of different
 * sizes lying along the two sloping edges of the mouth, a keystone, a brow slab and two low flank
 * boulders. Authored in the mouth frame: origin = mouth centre on the floor, +Z toward the inside
 * of the cave, +X = -theta side. `k` scales how far the rocks reach into the cave (the side caves
 * are small).
 */
function emitArch(b: MeshBuilder, o: Opening, rng: Rng, k: number): void {
  const hw = o.halfW;
  const j = () => rng.range(0.88, 1.14);
  const flip = rng.sign();
  interface Block {
    at: Vec3;
    size: Vec3;
    rot: Vec3;
    taper: number;
    bevel: number;
    slope?: number;
    jit?: number;
  }
  const blocks: Block[] = [
    // jambs (inner faces stay outside the walk and camera margins)
    { at: [hw + 1.5, 0, 0.3 * k], size: [2.3, (o.shoulders[1] + 0.75) * j(), 1.7 * k], rot: [0, 7, 0], taper: 0.8, bevel: 0.32 },
    { at: [-(hw + 1.55), 0, 0.26 * k], size: [2.4, (o.shoulders[0] + 0.6) * j(), 1.6 * k], rot: [0, -8, 0], taper: 0.78, bevel: 0.34 },
  ];
  // Stones along the two top edges: edge 0 runs from the +theta shoulder (x = -hw) to the apex.
  for (const e of [0, 1]) {
    const sx = e === 0 ? -1 : 1; // side of the shoulder in mouth-frame x
    const x0 = sx * hw;
    const x1 = -o.apexS;
    const y0 = o.shoulders[e];
    const run = Math.abs(x1 - x0);
    const ang = Math.atan((o.apex - y0) / run) / DEG;
    for (const [t, wK, hK] of e === (flip > 0 ? 0 : 1) ? [[0.2, 0.5, 1.25], [0.72, 0.52, 0.95]] : [[0.3, 0.68, 1.0], [0.82, 0.36, 1.3]]) {
      const w = run * wK * j();
      blocks.push({
        at: [lerp(x0, x1, t), lerp(y0, o.apex, t) + 0.08, (0.36 + rng.range(0, 0.14)) * k],
        size: [w, 1.2 * hK * j(), (1.35 + rng.range(0, 0.3)) * k],
        rot: [0, rng.jitter(7), -sx * ang + rng.jitter(6)],
        taper: rng.range(0.66, 0.8),
        bevel: 0.4,
        jit: 0.1,
      });
    }
  }
  blocks.push(
    // keystone, brow slab (off-centre) and flank boulders
    { at: [-o.apexS + 0.1 * flip, o.apex + 0.12, 0.46 * k], size: [1.7 * j(), 1.25 * j(), 1.55 * k], rot: [0, 3 * flip, 5 * flip], taper: 0.74, bevel: 0.4 },
    { at: [0.9 * flip, o.apex + 0.95, 0.3 * k], size: [hw * 2 + 1.2, 1.7 * j(), 1.9 * k], rot: [0, -4 * flip, 4 * flip], taper: 0.66, bevel: 0.42, slope: 0.18, jit: 0.1 },
    { at: [flip * (hw + 3.3), 0, 0.5 * k], size: [2.2 * j(), 1.8 * j(), 1.8 * k], rot: [0, flip * 22, 0], taper: 0.6, bevel: 0.42, slope: 0.2 },
    { at: [-flip * (hw + 3.4), 0, 0.45 * k], size: [1.9 * j(), 2.5 * j(), 1.7 * k], rot: [0, -flip * 18, 0], taper: 0.58, bevel: 0.42, slope: 0.15 },
  );
  b.group({ at: mouthPoint(o, 0, 0), rot: [0, faceCentreRotY(o.theta), 0] }, () => {
    for (const r of blocks)
      b.hull(
        blockPoints(rng, r.size[0], r.size[1], r.size[2], { taper: r.taper, bevel: r.bevel, jit: r.jit ?? 0.08, slope: r.slope }),
        { at: r.at, rot: r.rot, color: rockPaint(rng, pickW(rng, WALL_TONES), 0.1, 0.95) },
      );
  });
}

/** Exit passage toward -Z (same as the first shell): arch rocks around the mouth + swept dark passage. */
function emitExit(m: Model, b: MeshBuilder, o: Opening): void {
  const rng = new Rng("tl_cave_main/exit");
  const Z = -o.dist;
  const prof: Vec2[] = [
    [o.halfW, 0],
    [o.halfW, o.shoulders[0] * 0.5],
    [o.halfW, o.shoulders[0]],
    [0, o.apex],
    [-o.halfW, o.shoulders[0]],
    [-o.halfW, o.shoulders[0] * 0.5],
    [-o.halfW, 0],
  ];
  const ds = [0, 1.5, 3.2, 4.9, EXIT.depth];
  const bend = [0, 0.08, 0.35, 0.85, 1.45];
  const widen = [1, 1.08, 1.14, 1.06, 0.92];
  const raise = [1, 1.05, 1.1, 1.04, 0.94];
  const rings: Vec3[][] = ds.map((d, k) =>
    prof.map(([x, y]): Vec3 => {
      if (k === 0) return [x, y, Z];
      const floor = y === 0;
      const bulge = Math.abs(y - o.shoulders[0] * 0.5) < 1e-6 ? 1.07 : 1;
      return [
        bend[k] + x * widen[k] * bulge + rng.jitter(0.14),
        floor ? 0 : y * raise[k] + rng.jitter(0.13),
        Z - d + rng.jitter(0.08),
      ];
    }),
  );
  const depthCol = (d: number, base: Color) => shade(mix(base, P.shadow, smoothstep(0, EXIT.depth, d) * 0.75), 1);
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    const dMid = (ds[k] + ds[k + 1]) / 2;
    const axis: Vec3 = [(bend[k] + bend[k + 1]) / 2, 1.7, Z - dMid];
    // The mouth ring (k = 0) lies on the wall's jamb edges, which have no vertex at half height:
    // fan the first span from the jamb feet so that point is never used (no T-junction, no cracks).
    const facets: Vec3[][] =
      k === 0
        ? [
            [A[0], A[2], B[2]],
            [A[0], B[2], B[1]],
            [A[0], B[1], B[0]],
            [A[2], A[3], B[3]],
            [A[2], B[3], B[2]],
            [A[3], A[4], B[4]],
            [A[3], B[4], B[3]],
            [A[6], A[4], B[4]],
            [A[6], B[4], B[5]],
            [A[6], B[5], B[6]],
          ]
        : Array.from({ length: prof.length - 1 }, (_, v) => [
            [A[v], A[v + 1], B[v + 1]],
            [A[v], B[v + 1], B[v]],
          ]).flat();
    {
      for (const [p0, p1, p2] of facets) {
        const ctr = centroid3([p0, p1, p2]);
        const want = sub(axis, ctr);
        const tone = depthCol(dMid, k === 0 ? P.rock : P.rockDark);
        triToward(b, p0, p1, p2, want, shade(tone, (k === 0 ? 0.8 : 0.7) * (1 + rng.jitter(0.08))));
      }
    }
    // Floor strip (4 cm above the cave floor so the floor disc never shows through). It is 0.2 m
    // wider than the walls on both sides and runs past the end cap: the walls and the cap cut
    // through it, so no sliver opens along their foot.
    const last = prof.length - 1;
    const past = k + 2 === rings.length ? 0.3 : 0;
    const fA0: Vec3 = [A[0][0] + 0.2, EXIT.floorY, A[0][2]];
    const fA1: Vec3 = [A[last][0] - 0.2, EXIT.floorY, A[last][2]];
    const fB0: Vec3 = [B[0][0] + 0.2, EXIT.floorY, B[0][2] - past];
    const fB1: Vec3 = [B[last][0] - 0.2, EXIT.floorY, B[last][2] - past];
    const fc = shade(mix(P.dirt, P.mud, 0.5 + 0.5 * smoothstep(0, EXIT.depth, dMid)), 0.85 + rng.jitter(0.05));
    triToward(b, fA0, fA1, fB1, [0, 1, 0], fc);
    triToward(b, fA0, fB1, fB0, [0, 1, 0], shade(fc, 0.95));
  }
  // Dark end cap facing back toward the cave.
  const lastRing = rings[rings.length - 1];
  // The cap uses the ring's own points (shared edges with the passage walls: no slivers).
  const capPts: Vec3[] = lastRing;
  const capC = centroid3(capPts);
  for (let v = 0; v < capPts.length; v++) {
    const p0 = capPts[v];
    const p1 = capPts[(v + 1) % capPts.length];
    triToward(b, capC, p0, p1, [0, 0, 1], shade(P.shadow, 0.55 + rng.jitter(0.05)));
  }

  // Chunky portal around the mouth: two jambs, three voussoirs, a brow block, two flank rocks.
  const portal: { at: Vec3; size: Vec3; rot: Vec3; taper: number; bevel: number; slope?: number }[] = [
    { at: [2.66, 0, Z + 0.32], size: [1.6, 3.5, 1.6], rot: [0, 6, 0], taper: 0.72, bevel: 0.4 },
    { at: [-2.7, 0, Z + 0.28], size: [1.65, 3.3, 1.55], rot: [0, -7, 0], taper: 0.7, bevel: 0.4 },
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

  const end = lastRing[3];
  m.anchor("tunnel_mouth", [0, 0, Z]);
  m.anchor("tunnel_end", [r4(end[0]), 0, r4(Z - EXIT.depth + 0.3)]);
  m.anchor("tunnel_frame", [0, 0, Z + 0.95]);
  m.anchor("sign_rock", [0.2, 5.2, Z + 0.85]);
  m.anchor("tunnel_torch", [r4(bend[3] * 0.7), 1.8, r4(Z - 4.2)]);
}

/* =========================================================================================
 * Floor and ceiling
 * ========================================================================================= */

function emitFloor(b: MeshBuilder, S: ShellSpec): void {
  const rng = new Rng(`${S.key}_floor/points`);
  const seeds: Vec2[] = [];
  const nb = Math.round((2 * Math.PI * S.floorR) / 2.36);
  for (let k = 0; k < nb; k++) {
    const p = polar(((k + 0.5) / nb) * 360 + rng.jitter(60 / nb), S.floorR, 0);
    seeds.push([p[0], p[2]]);
  }
  // Keep the strip of every opening clean (the passage floors sit a few cm above these).
  for (const o of S.openings) {
    const rows: [number, number[]][] =
      o.kind === "exit"
        ? [
            [0.25, [-3.0, -2.4, -1.75, 0, 1.75, 2.4, 3.0]],
            [1.15, [-3.0, -2.4, -1.75, 0, 1.75, 2.4, 3.0]],
            [1.6, [-1.75, 1.75]],
          ]
        : [
            [-1.45, [-3.5, 0, 3.5]],
            [-0.3, [-3.4, -1.7, 0, 1.7, 3.4]],
            [0.85, [-3.5, -1.2, 1.2, 3.5]],
          ];
    for (const [out, ss] of rows)
      for (const s of ss) {
        const p = mouthPoint(o, s, 0, out);
        if (Math.hypot(p[0], p[2]) < S.floorR - 0.7) seeds.push([p[0], p[2]]);
      }
  }
  seeds.push([0, 0]);
  const inStrip = (x: number, z: number) =>
    S.openings.some((o) => {
      const a = axisCoords(o, x, z);
      return a.lat < 3.6 && a.along > o.dist - 2;
    });
  const pts = scatter(
    rng,
    S.floorR - 0.9,
    (x, z) => (inStrip(x, z) ? 1.05 : S.floorStep(Math.hypot(x, z))),
    seeds,
    Math.round(12 * S.floorR * S.floorR),
  );
  const tris = delaunay(pts);
  // Flat wherever a triangle reaches the walkable area (strictly: no ramp ever leaks into it).
  const flatDiscs: Disc[] = [{ x: 0, z: 0, r: S.flatR }];
  for (const o of S.openings)
    for (let d = o.dist - 7; d < S.floorR + 1; d += 0.4) {
      const p = mouthPoint(o, 0, 0, d - o.dist);
      flatDiscs.push({ x: p[0], z: p[2], r: o.kind === "exit" ? 2.9 : 2.75 });
    }
  const flat = new Uint8Array(pts.length);
  for (const [a, bI, c] of tris) {
    const poly = [pts[a], pts[bI], pts[c]];
    if (flatDiscs.some((d) => distPointPoly2(d.x, d.z, poly) < d.r)) flat[a] = flat[bI] = flat[c] = 1;
  }
  const height = (i: number): number => {
    const [x, z] = pts[i];
    const r = Math.hypot(x, z);
    const n = vnoise(x / 3.4, z / 3.4, S.noise + 11) * 0.6 + vnoise(x / 1.4, z / 1.4, S.noise + 12) * 0.4;
    const y = 0.0205 + 0.0135 * n;
    if (flat[i]) return y;
    const rim = smoothstep(S.riseFrom, S.floorR, r);
    let mask = 1;
    for (const o of S.openings) {
      const a = axisCoords(o, x, z);
      if (a.along > 0) mask *= smoothstep(2.7, 7.5, a.lat);
    }
    return Math.max(y, y + (S.riseH * rim * rim + 0.06 * rim * vnoise(x / 2.1, z / 2.1, S.noise + 13)) * mask);
  };
  const verts: Vec3[] = pts.map(([x, z], i) => [x, height(i), z]);
  const paint = new Rng(`${S.key}_floor/paint`);
  for (const [a, bI, c] of tris) {
    const p0 = verts[a],
      p1 = verts[bI],
      p2 = verts[c];
    const ctr = centroid3([p0, p1, p2]);
    const r = Math.hypot(ctr[0], ctr[2]);
    const patch =
      vnoise(ctr[0] / 6.5, ctr[2] / 6.5, S.noise + 21) * 0.7 + vnoise(ctr[0] / 2.6, ctr[2] / 2.6, S.noise + 22) * 0.3;
    let col = mix(P.dirt, P.earth, clamp(0.55 + 0.6 * patch, 0, 1));
    // larger lighter, dustier patches (smooth noise, so neighbouring facets agree)
    col = mix(col, P.ochre, 0.22 * smoothstep(0.15, 0.75, patch));
    const k = (1 + paint.jitter(0.045)) * (1 - 0.28 * smoothstep(S.floorR * 0.8, S.floorR - 0.5, r));
    triToward(b, p0, p1, p2, [0, 1, 0], shade(col, k));
  }
}

interface CeilingDeco {
  lobes: { n: number; r: (rng: Rng, k: number) => number; length: [number, number]; radius: [number, number]; lift: number };
  stalactites: { n: number; r: (rng: Rng) => number; length: [number, number]; radius: [number, number] };
  /** No hanging rock reaches below this height. */
  minTip: number;
}
/** Faceted ceiling with merged hanging rock cones and stalactites. Returns the lowest tip height. */
function emitCeiling(b: MeshBuilder, S: ShellSpec, deco: CeilingDeco): number {
  const c = S.ceil;
  const rng = new Rng(`${S.key}_ceiling/points`);
  const seeds: Vec2[] = [];
  const nb = Math.round((2 * Math.PI * c.R) / 3.2);
  for (let k = 0; k < nb; k++) {
    const p = polar(((k + 0.3) / nb) * 360 + rng.jitter(80 / nb), c.R, 0);
    seeds.push([p[0], p[2]]);
  }
  if (c.mouthLift)
    for (const o of S.openings)
      for (const [out, ss] of [
        [-0.9, [-4.6, -1.6, 1.6, 4.6]],
        [0.75, [-3.4, 0, 3.4]],
      ] as [number, number[]][])
        for (const sv of ss) {
          const p = mouthPoint(o, sv, 0, out);
          seeds.push([p[0], p[2]]);
        }
  const pts = scatter(rng, c.R - 1.2, (x, z) => c.step(Math.hypot(x, z)), seeds, Math.round(7 * c.R * c.R));
  const verts: Vec3[] = pts.map(([x, z]) => [x, ceilingY(S, x, z), z]);
  const paint = new Rng(`${S.key}_ceiling/paint`);
  for (const [a, bI, cI] of delaunay(pts)) {
    const p0 = verts[a],
      p1 = verts[bI],
      p2 = verts[cI];
    const ctr = centroid3([p0, p1, p2]);
    const n = vnoise(ctr[0] / 5, ctr[2] / 5, S.noise + 33);
    const col = mix(mix(P.shadow, P.rockDark, clamp(0.7 + 0.3 * n, 0, 1)), P.earth, 0.25);
    triToward(b, p0, p1, p2, [0, -1, 0], shade(col, 1 + paint.jitter(0.08)));
  }
  let lowest = Infinity;
  // Massive hanging rock cones (the big downward folds of the concept's upper cave).
  const lobeRng = new Rng(`${S.key}_ceiling/lobes`);
  for (let k = 0; k < deco.lobes.n; k++) {
    const th = (k / deco.lobes.n) * 360 + lobeRng.jitter(140 / deco.lobes.n);
    const p = polar(th, deco.lobes.r(lobeRng, k), 0);
    const base = ceilingY(S, p[0], p[2]) + deco.lobes.lift;
    const length = Math.min(lobeRng.range(...deco.lobes.length) + deco.lobes.lift, base - deco.minTip);
    const tip = spike(b, lobeRng, {
      base: [p[0], base, p[2]],
      dir: -1,
      length,
      radius: lobeRng.range(...deco.lobes.radius),
      sides: 6,
      rings: [0.3, 0.62],
      lean: 0.12,
      tone: mix(mix(P.rockDark, P.shadow, 0.3), P.earth, 0.3),
      tipTone: P.rock,
    });
    lowest = Math.min(lowest, tip[1]);
  }
  // Stalactites: long thin dark spikes hanging in front of the upper walls.
  const stRng = new Rng(`${S.key}_ceiling/stalactites`);
  for (let k = 0; k < deco.stalactites.n; k++) {
    const th = (k / deco.stalactites.n) * 360 + stRng.jitter(180 / deco.stalactites.n);
    const p = polar(th, deco.stalactites.r(stRng), 0);
    const top = ceilingY(S, p[0], p[2]) + 0.35;
    const length = Math.min(stRng.range(...deco.stalactites.length), top - deco.minTip);
    const tip = spike(b, stRng, {
      base: [p[0], top, p[2]],
      dir: -1,
      length,
      radius: stRng.range(...deco.stalactites.radius) * Math.sqrt(length / 2.5),
      sides: 5,
      rings: [0.4],
      lean: 0.08,
      tone: mix(P.rockDark, P.shadow, 0.35),
      tipTone: P.rock,
    });
    lowest = Math.min(lowest, tip[1]);
  }
  return lowest;
}

/* =========================================================================================
 * Main cave
 * ========================================================================================= */

const MAIN_WALL_TOP = 14.8;
const MAIN_OPENINGS: Opening[] = [
  {
    id: "exit",
    kind: "exit",
    theta: 90,
    dist: MAIN_R0,
    halfW: EXIT.halfW,
    shoulders: [EXIT.shoulder, EXIT.shoulder],
    apex: EXIT.apex,
    apexS: 0,
  },
  ...CAVE_WALK.sides.map(
    (s): Opening => ({ id: s.id, kind: "side", theta: thetaOf(s.x, s.z), dist: MAIN_R0, ...sideMouth(`tl_cave_main/${s.id}`) }),
  ),
];
/**
 * The screen wall: a flat face between the exit and the mouth to Hang ký ức (theta 98.7..138.1,
 * i.e. bearings 188.7..228.1 in the layout's convention), 15.6 m wide, from the floor to 12.2 m
 * (the third row of its columns is lifted to `top`). It spans the wall columns 98.69, 105.48,
 * 109.55, 114.74, 120 (module boundary), 125.53, 132.08 and 138.1: every plain column between the
 * exit's jamb and the mouth's jamb. The big wall screen (furniture group, tl_furn_wall_screen_v01)
 * lies on it: packages/shared/src/layout.ts HUB_SCREEN derives its pose from these numbers
 * (manifest tl_cave_main_floor meta.screenWall). At the camera ceiling (9.15 m) the face is still
 * 21.35 m from the axis, 0.6 m outside the camera volume.
 */
const SCREEN_WALL = { theta: (98.69 + 138.1) / 2, from: 98.6, to: 138.2, half: 7.8, r0: 23.0, slope: 0.18, rows: 4, top: 12.2 };
/** Torch spots along the main wall that are not beside a mouth (deg). */
const MAIN_WALL_TORCHES = [0, 180, 251, 289];
const mouthTorch = (o: Opening, side: 1 | -1, back: number): Vec3 => mouthPoint(o, side * (o.halfW + 1.5), 0, -back);

const MAIN: ShellSpec = {
  key: "tl_cave_main",
  segments: 6,
  R0: MAIN_R0,
  bulge: () => 0,
  lean: (y) => 3.4 * Math.pow(clamp(y / MAIN_WALL_TOP, 0, 1.2), 1.6),
  wallTop: MAIN_WALL_TOP,
  rows: [0, 2.8, 6.4, 10.2, MAIN_WALL_TOP],
  rowJit: [0, 0.75, 1.0, 0.9, 0.35],
  rowFold: [0.7, 1.0, 1.0, 0.8, 0.35],
  colStep: [4.7, 6.1],
  ridge: [0.15, 0.95],
  crevice: [0.8, 1.6],
  thJit: 0.42,
  drift: 1.15,
  rJit: 0.12,
  minSep: 1.15,
  openFold: -0.35,
  buttress: [0.55, 0.9],
  buttressLat: 5.6,
  floorR: 25.2,
  flatR: 21,
  riseFrom: 21.2,
  riseH: 0.5,
  floorStep: (r) => 1.85 + 0.9 * smoothstep(11, 25.2, r),
  ceil: { apex: 16.5, R: 25.6, drop: 5.4, pow: 2.5, noise: 0.5, fadeFrom: 16, step: (r) => 2.7 + 0.6 * smoothstep(10, 25.6, r) },
  darkFrom: 3.0,
  panel: SCREEN_WALL,
  openings: MAIN_OPENINGS,
  keep: [],
  rockScale: 1,
  ledgeSlots: 4,
  rubble: 7,
  noise: 0,
};
MAIN.keep = [
  { x: 0, z: 0, r: CAVE_WALK.main.r + CAM_MARGIN + 0.65 }, // 21.4: spec floor is 21.3
  ...MAIN_OPENINGS.filter((o) => o.kind === "side").flatMap((o) => {
    const out: Disc[] = [];
    for (let d = 17; d <= o.dist + 0.6; d += 0.4) {
      const p = mouthPoint(o, 0, 0, d - o.dist);
      out.push({ x: p[0], z: p[2], r: CAVE_WALK.tunnel.r + CAM_MARGIN + 0.15 });
    }
    for (const side of [1, -1] as const) {
      const t = mouthTorch(o, side, 2.0);
      out.push({ x: t[0], z: t[2], r: 0.95 });
    }
    return out;
  }),
  // The foot of the screen wall stays bare: ledges and rubble there are pushed back into the rock
  // or left out (the screen's bottom edge hangs 4.2 m above the floor).
  ...[-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6].map((lat): Disc => {
    const n = dirOf(SCREEN_WALL.theta);
    const r = SCREEN_WALL.r0 - 1.0;
    return { x: n[0] * r - n[2] * lat, z: n[2] * r + n[0] * lat, r: 1.3 };
  }),
];

interface TorchSpot {
  id: string;
  /** Cave-space floor position and the rotY that faces the torch toward its room's centre. */
  at: Vec3;
  rotY: number;
  room: string;
}
function buildMainFloor(field: WallField, lowestRock: number, torches: TorchSpot[]): Model {
  const S = MAIN;
  const m = new Model("tl_cave_main_floor_v01", {
    budget: 1100,
    notes:
      "Main cave floor disc r=25.2 m, cave space (origin = campfire, place at 0,0,0). Flat (0.006..0.035) " +
      "for r < 21 and inside the strips of the five openings; rises to ~0.5 m under the wall foot. " +
      "meta.walk / meta.layout / meta.ceilingAt describe the whole multi-cave world for the integrator.",
  });
  emitFloor(m.geo, S);
  m.collider = { type: "cylinder", center: [0, -0.25, 0], radius: S.floorR, height: 0.5 };
  const place = cavePlacements();
  m.anchor("campfire", [0, 0, 0]);
  m.anchor("spawn", [0, 0, 11]);
  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    radius: S.floorR,
    flatRadius: S.flatR,
    wallRadius: wallRadiusStats(field),
    screenWall: {
      theta: r4(SCREEN_WALL.theta),
      bearing: r4(SCREEN_WALL.theta + 90),
      halfWidth: SCREEN_WALL.half,
      r0: SCREEN_WALL.r0,
      slope: SCREEN_WALL.slope,
      tilt: r4(Math.atan(SCREEN_WALL.slope) / DEG),
      flatTo: r4(Math.min(...field.cols.flatMap((c, j) => (c.theta >= SCREEN_WALL.from && c.theta <= SCREEN_WALL.to ? [field.V[j][SCREEN_WALL.rows - 1][1]] : [])))),
      note:
        "flat rock face for the big wall screen: a plane facing the origin at `theta` (bearing = theta + 90 in the layout's " +
        "convention: 0 = +Z, 90 = +X), r0 m from the axis at the floor, leaning inward `slope` m per metre (tilt deg), " +
        "2 * halfWidth m wide, flat from the floor to flatTo m",
    },
    heightNote: "y in [0.006, 0.035] for r < 21 and in the opening strips; ~0.25 m at r = 24, ~0.5 m at r = 25.2",
    angleConvention: "theta around +Y from +X toward -Z; dir = (cos t, 0, -sin t)",
    walk: {
      main: CAVE_WALK.main,
      sides: CAVE_WALK.sides,
      tunnels: CAVE_WALK.sides.map((s) => {
        const d = Math.hypot(s.x, s.z);
        const { from, to, r } = CAVE_WALK.tunnel;
        return {
          id: s.id,
          from: { x: r4((s.x / d) * from), z: r4((s.z / d) * from) },
          to: { x: r4((s.x / d) * to), z: r4((s.z / d) * to) },
          r,
        };
      }),
      bodyRadius: 0.35,
      solidMargin: SOLID_MARGIN,
      cameraMargin: CAM_MARGIN - 0.15,
    },
    openings: MAIN_OPENINGS.map((o) => ({
      id: o.id,
      kind: o.kind,
      theta: r4(o.theta),
      dir: r4v(dirOf(o.theta)),
      mouth: r4v(mouthPoint(o, 0, 0)),
      width: o.halfW * 2,
      shoulders: o.shoulders.map(r4),
      apex: r4(o.apex),
      apexOffset: r4(o.apexS),
      wallModule: Math.floor(o.theta / 60),
    })),
    layout: {
      recipe:
        "u = unit(side centre); rotY = atan2(-u.x, -u.z) deg (= theta - 90); side cave at the side centre; " +
        "tunnel at u * (23.4 + |centre| - 8.6) / 2; both use setEulerAngles(0, rotY, 0) so local +Z points at the origin",
      tunnelLength: r4(TUBE_HALF * 2),
      mainMouthDist: MAIN_R0,
      sideMouthDist: r4(SIDE_DIST - SIDE_R0),
      placements: place,
    },
    torches,
    ceilingAt: {
      note:
        "cameraTop = highest camera position the shells are checked against (camera up to 0.6 m outside the " +
        "walk discs, 0.15 m padding). rock = lowest rock over the room's walk discs + 0.6 m (main: hanging cones; " +
        "tunnel: arch stones at the two mouths, the tube roof itself is >= 3.15 m; side: stalactite tips inside " +
        "r < 7, the wall leans in above 3.35 m). apex / wallJunction describe the visible ceiling.",
      main: { cameraTop: CAM_TOP.main, rock: r4(lowestRock), apex: S.ceil.apex, wallJunction: 13.5 },
      tunnel: { cameraTop: CAM_TOP.tunnel, rock: 2.95, apex: 3.85 },
      side: { cameraTop: CAM_TOP.side, rock: 4.25, apex: 7.2, wallJunction: 5.75 },
    },
  };
  return m;
}

function buildMainWall(field: WallField, s: number): Model {
  const S = MAIN;
  const name = `tl_cave_main_wall_${String(s).padStart(2, "0")}_v01`;
  const a0 = s * 60;
  const a1 = a0 + 60;
  const mine = MAIN_OPENINGS.filter((o) => o.theta >= a0 && o.theta < a1);
  const m = new Model(name, {
    budget: 1200,
    notes:
      `Main cave wall module ${s} of 6: theta in [${a0}, ${a1}) deg (theta around +Y from +X toward -Z). ` +
      `Cave space: place at 0,0,0 with no rotation; the 6 modules close the ring (inner face ~23.4 m at the ` +
      `floor, leaning to ~20 m at 14.8 m).` +
      mine.map((o) =>
        o.kind === "exit"
          ? " Contains the exit passage (3.5 x 3.6 m mouth at z=-23.4, 6.4 m deep, dead end)."
          : ` Contains the mouth of the tunnel to side cave "${o.id}" (5.0 m wide, 3.8 m apex) with its rock arch and collar.`,
      ).join(""),
  });
  const b = m.geo;
  const rng = new Rng(`${name}/paint`);
  const minR = emitWall(b, S, field, s, rng);
  emitLedges(b, S, field, s, name);
  for (const o of mine) {
    if (o.kind === "exit") emitExit(m, b, o);
    else {
      const ar = new Rng(`${name}/arch`);
      emitCollar(b, o, ar);
      emitArch(b, o, ar, 1);
      m.anchor(`mouth_${o.id}`, mouthPoint(o, 0, 0));
      m.anchor(`torch_${o.id}_a`, mouthTorch(o, 1, 2.0));
      m.anchor(`torch_${o.id}_b`, mouthTorch(o, -1, 2.0));
    }
  }
  const torches: number[] = [];
  for (const th of MAIN_WALL_TORCHES)
    if (th >= a0 && th < a1) {
      const r = Math.max(21.9, wallRadiusAt(S, field, th) - 1.1);
      m.anchor(`torch_wall_${String(th).padStart(3, "0")}`, polar(th, r, 0));
      torches.push(th);
    }
  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    segment: s,
    segments: 6,
    thetaStart: a0,
    thetaEnd: a1,
    angleConvention: "theta around +Y from +X toward -Z; dir = (cos t, 0, -sin t)",
    wallRadiusMin: r4(minR),
    openings: mine.map((o) => o.id),
    torchRotY: Object.fromEntries(
      Object.entries(m.anchors)
        .filter(([k]) => k.startsWith("torch_") && k !== "tunnel_torch")
        .map(([k, v]) => [k, r4(faceCentreRotY(thetaOf(v[0], v[2])))]),
    ),
    ...(mine.some((o) => o.kind === "exit")
      ? { tunnel: { mouthZ: -MAIN_R0, width: EXIT.halfW * 2, shoulder: EXIT.shoulder, apex: EXIT.apex, depth: EXIT.depth } }
      : {}),
  };
  return m;
}

function buildMainCeiling(): { model: Model; lowest: number } {
  const S = MAIN;
  const m = new Model("tl_cave_main_ceiling_v01", {
    budget: 1600,
    notes:
      "Irregular main cave ceiling, cave space (place at 0,0,0): 16.5 m at the centre, meets the leaning walls " +
      "at ~13.5 m, rim r=25.6 m hidden behind the walls. Faces point down (single-sided). Includes 12 massive " +
      "hanging rock cones and 30 merged stalactites; nothing hangs below 9.5 m.",
  });
  const lowest = emitCeiling(m.geo, S, {
    lobes: {
      n: 12,
      r: (rng, k) => (k % 3 === 0 ? rng.range(4, 9) : rng.range(11.5, 17.5)),
      length: [2.6, 4.8],
      radius: [1.4, 2.3],
      lift: 1.0,
    },
    stalactites: {
      n: 30,
      r: (rng) => (rng.chance(0.65) ? rng.range(14, 18.6) : rng.range(5, 13)),
      length: [1.5, 4.4],
      radius: [0.3, 0.55],
    },
    minTip: 9.5,
  });
  m.meta = {
    space: "cave",
    place: { at: [0, 0, 0], rotY: 0 },
    apexY: S.ceil.apex,
    rimRadius: S.ceil.R,
    lowestRock: r4(lowest),
    heightNote: "ceiling y ~= 16.5 - 5.4 * (r / 25.6)^2.5 (+-0.5 m noise inside r = 16)",
  };
  return { model: m, lowest };
}

/* =========================================================================================
 * Side caves (local frame: centre at the origin, opening toward +Z)
 * ========================================================================================= */

const SIDE_WALL_TOP = 7.0;
const sideOpening = (id: "a" | "b"): Opening => ({
  id: "mouth",
  kind: "side",
  theta: 270,
  dist: SIDE_R0,
  ...sideMouth(`tl_cave_side_${id}`),
});
const SIDE_PLACE = cavePlacements()[0];
/** Walk / camera rooms seen from a side cave's local frame (the four placements are congruent). */
const SIDE_ROOMS = roomsInFrame(SIDE_PLACE.side.at, SIDE_PLACE.rotY);
const TUBE_ROOMS = roomsInFrame(SIDE_PLACE.tunnel.at, SIDE_PLACE.rotY);

function sideSpec(id: "a" | "b"): ShellSpec {
  const leanPts: Vec2[] = [
    [0, 0],
    [1.9, 0.05],
    [3.6, 0.2],
    [SIDE_WALL_TOP, 2.6],
    [9, 3.0],
  ];
  const lean = (y: number) => {
    for (let i = 1; i < leanPts.length; i++)
      if (y <= leanPts[i][0]) {
        const [y0, l0] = leanPts[i - 1];
        const [y1, l1] = leanPts[i];
        return lerp(l0, l1, clamp((y - y0) / (y1 - y0), 0, 1));
      }
    return leanPts[leanPts.length - 1][1];
  };
  const nicheTheta = id === "a" ? 90 : 128;
  const mouth = sideOpening(id);
  const S: ShellSpec = {
    key: `tl_cave_side_${id}`,
    segments: 1,
    R0: SIDE_R0,
    // variant B is egg-shaped: it swells toward the back-left
    bulge: id === "a" ? () => 0 : (th) => 0.7 * Math.pow(Math.max(0, Math.cos((th - 140) * DEG)), 2),
    lean,
    wallTop: SIDE_WALL_TOP,
    rows: [0, 1.9, 3.6, SIDE_WALL_TOP],
    rowJit: [0, 0.3, 0.3, 0.2],
    rowFold: [0.7, 1.0, 1.0, 0.35],
    colStep: [11.5, 15],
    ridge: [0.05, 0.35],
    crevice: [0.35, 0.9],
    thJit: 1.0,
    drift: 2.6,
    rJit: 0.08,
    minSep: 3,
    openFold: -0.15,
    buttress: [0.2, 0.35],
    buttressLat: 5.2,
    niche: { theta: nicheTheta, half: 9, depth: 1.75, rowFold: [1, 1, 0.3, 0.1] },
    floorR: 11.2,
    flatR: 7.6,
    riseFrom: 7.8,
    riseH: 0.3,
    floorStep: (r) => 1.55 + 0.55 * smoothstep(3, 11.2, r),
    ceil: { apex: 7.2, R: 10.8, drop: 3.8, pow: 2.2, noise: 0.2, fadeFrom: 5, mouthLift: 3.4, step: (r) => 2.2 + 0.5 * smoothstep(3, 10.8, r) },
    darkFrom: 1.6,
    openings: [mouth],
    keep: [],
    rockScale: 0.5,
    ledgeSlots: id === "a" ? 5 : 6,
    rubble: 10,
    noise: id === "a" ? 100 : 200,
  };
  const back = nicheTheta;
  S.keep = [
    { x: 0, z: 0, r: CAVE_WALK.sides[0].r + CAM_MARGIN + 0.05 },
    ...[1, -1].map((side): Disc => {
      const t = mouthTorch(mouth, side as 1 | -1, 2.6);
      return { x: t[0], z: t[2], r: 0.9 };
    }),
    ...[30, -30].map((d): Disc => {
      const t = polar(back + d, 7.78, 0);
      return { x: t[0], z: t[2], r: 0.9 };
    }),
    // keep the niche and the floor in front of it free (focal spot)
    ...[0.4, 1.4, 2.4].map((d): Disc => {
      const p = polar(back, SIDE_R0 + d - 0.6, 0);
      return { x: p[0], z: p[2], r: 1.5 };
    }),
  ];
  for (let d = SIDE_R0 - 3; d <= SIDE_R0 + 0.6; d += 0.4) {
    const p = mouthPoint(mouth, 0, 0, d - SIDE_R0);
    S.keep.push({ x: p[0], z: p[2], r: CAVE_WALK.tunnel.r + CAM_MARGIN + 0.15 });
  }
  return S;
}

function buildSide(id: "a" | "b"): Model {
  const S = sideSpec(id);
  const name = `tl_cave_side_${id}_v01`;
  const m = new Model(name, {
    budget: 1800,
    notes:
      `Side cave ${id.toUpperCase()} (floor + wall + arch in the root, ceiling in the child node ${name.slice(0, -4)}_ceiling). ` +
      "Local frame: centre at the origin, the one opening faces +Z with its mouth plane at z = +8.6 (5.0 m " +
      "wide, 3.8 m apex). Wall inner face ~8.6 m at the floor, never closer than 7.75 m below 3.3 m; ceiling " +
      "apex 7.2 m. Place at a side centre with rotY so local +Z points at the world origin (meta.place).",
  });
  const b = m.geo;
  const field = buildWallField(S);
  emitFloor(b, S);
  const minR = emitWall(b, S, field, 0, new Rng(`${name}/paint`));
  emitLedges(b, S, field, 0, name);
  const ar = new Rng(`${name}/arch`);
  const mouth = S.openings[0];
  emitCollar(b, mouth, ar);
  emitArch(b, mouth, ar, 0.82);

  // Niche: a flat-topped shelf rock at the back of the alcove (focal spot).
  const n = S.niche!;
  const nr = new Rng(`${name}/niche`);
  const shelfAt = polar(n.theta, S.R0 + n.depth - 0.95, 0);
  const shelfH = 0.85;
  b.hull(blockPoints(nr, 2.3, shelfH, 1.25, { taper: 0.86, bevel: 0.3, jit: 0.05 }), {
    at: shelfAt,
    rot: [0, faceCentreRotY(n.theta) + nr.jitter(4), 0],
    color: rockPaint(nr, P.rockLight, 0.22),
  });
  for (const sg of [1, -1]) {
    const p = polar(n.theta + sg * (n.half + 4), S.R0 + 0.15, 0);
    b.hull(blockPoints(nr, 1.3, nr.range(1.5, 2.2), 1.2, { taper: 0.55, bevel: 0.42, jit: 0.11, slope: 0.15 }), {
      at: p,
      rot: [0, faceCentreRotY(n.theta) + sg * 24 + nr.jitter(8), 0],
      color: rockPaint(nr, pickW(nr, WALL_TONES), 0.12),
    });
  }

  const ceiling = m.node(`${name.slice(0, -4)}_ceiling`);
  const lowest = emitCeiling(ceiling.geo, S, {
    lobes: {
      n: 2,
      r: (rng) => rng.range(2.5, 5),
      length: [1.2, 1.8],
      radius: [0.7, 1.0],
      lift: 0.6,
    },
    stalactites: { n: 6, r: (rng) => rng.range(2, 6.2), length: [0.7, 1.7], radius: [0.22, 0.34] },
    minTip: 4.25,
  });

  m.anchor("center", [0, 0, 0]);
  m.anchor("mouth", mouthPoint(mouth, 0, 0));
  m.anchor("torch_mouth_a", mouthTorch(mouth, 1, 2.6));
  m.anchor("torch_mouth_b", mouthTorch(mouth, -1, 2.6));
  m.anchor("niche", [shelfAt[0], shelfH, shelfAt[2]]);
  m.anchor("focal", polar(n.theta, S.R0 - 1.4, 0));
  m.anchor("torch_niche_a", polar(n.theta + 30, 7.78, 0));
  m.anchor("torch_niche_b", polar(n.theta - 30, 7.78, 0));
  m.collider = { type: "cylinder", center: [0, -0.25, 0], radius: S.floorR, height: 0.5 };
  m.meta = {
    space: "local",
    variant: id,
    place: {
      recipe: "at = side centre; rotY = atan2(-u.x, -u.z) deg with u = unit(side centre): local +Z points at the origin",
      instances: cavePlacements().map((p) => ({ id: p.id, at: p.side.at, rotY: p.rotY, suggested: p.side.asset === name })),
    },
    opening: {
      mouth: r4v(mouthPoint(mouth, 0, 0)),
      dir: [0, 0, 1],
      width: mouth.halfW * 2,
      shoulders: mouth.shoulders.map(r4),
      apex: r4(mouth.apex),
      apexOffset: r4(mouth.apexS),
    },
    wallRadius: wallRadiusStats(field),
    wallRadiusMin: r4(minR),
    floorRadius: S.floorR,
    flatRadius: S.flatR,
    nicheTheta: n.theta,
    nicheRotY: r4(faceCentreRotY(n.theta)),
    ceilingAt: { cameraTop: CAM_TOP.side, rock: r4(lowest), apex: S.ceil.apex, wallJunction: 5.75 },
    ceilingNode: `${name.slice(0, -4)}_ceiling`,
  };
  assertClear(m, SIDE_ROOMS);
  return m;
}

/* =========================================================================================
 * Tunnel passage (local frame: along Z, centred, +Z toward the main cave)
 * ========================================================================================= */

function buildTunnel(id: "a" | "b"): Model {
  const name = `tl_cave_tunnel_${id}_v01`;
  const m = new Model(name, {
    budget: 500,
    notes:
      `Tunnel passage ${id.toUpperCase()}: natural rock tube along local Z (+Z toward the main cave), ` +
      `${(TUBE_HALF * 2).toFixed(2)} m long, clear half width >= 2.5 m up to 2.75 m, apex ~3.9-4.2 m, earth floor ` +
      "at y = 0.05. Both ends flare (hidden inside the collars of the two shells). Place at the midpoint " +
      "between the mouth planes with the side cave's rotY (meta.place). Roof facets are in the child node " +
      `${name.slice(0, -4)}_roof.`,
  });
  const rng = new Rng(`${name}/tube`);
  const H = TUBE_HALF;
  const zs = id === "a" ? [H, 1.32, 0.45, -0.5, -1.3, -H] : [H, 1.28, 0.38, -0.42, -1.34, -H];
  const last = zs.length - 1;
  /** Bay: variant B swells on one side in the middle (a small recess with a boulder). */
  const bay = (k: number, side: 1 | -1) => (id === "b" && side === 1 && (k === 2 || k === 3) ? 0.62 : 0);
  interface Ring {
    z: number;
    wr: number;
    wl: number;
    pts: Vec3[];
  }
  const rings: Ring[] = zs.map((z, k) => {
    const end = k === 0 || k === last;
    const wr = end ? 3.5 : rng.range(2.64, 3.0) + bay(k, 1);
    const wl = end ? 3.5 : rng.range(2.64, 3.0) + bay(k, -1);
    const ap = end ? 4.9 : rng.range(3.85, 4.2);
    const j = (a: number) => (end ? 0 : rng.jitter(a));
    const zz = (a: number) => z + j(a);
    const pts: Vec3[] = [
      [wr, -0.12, z],
      [wr * 1.04 + j(0.07), 1.35 + j(0.15), zz(0.1)],
      [wr * 0.985 + j(0.06), 2.97 + j(0.07), zz(0.1)],
      [wr * 0.56 + j(0.1), ap - 0.38 + j(0.08), zz(0.12)],
      [j(0.25), ap, zz(0.12)],
      [-wl * 0.56 + j(0.1), ap - 0.38 + j(0.08), zz(0.12)],
      [-wl * 0.985 + j(0.06), 2.97 + j(0.07), zz(0.1)],
      [-wl * 1.04 + j(0.07), 1.35 + j(0.15), zz(0.1)],
      [-wl, -0.12, z],
    ];
    return { z, wr, wl, pts };
  });
  const roof = m.node(`${name.slice(0, -4)}_roof`);
  const paint = new Rng(`${name}/paint`);
  for (let k = 0; k < last; k++) {
    const A = rings[k].pts;
    const B = rings[k + 1].pts;
    const axis: Vec3 = [0, 1.6, (rings[k].z + rings[k + 1].z) / 2];
    for (let v = 0; v < A.length - 1; v++) {
      const tone = pickW(paint, WALL_TONES);
      const quad = [A[v], A[v + 1], B[v + 1], B[v]];
      const split: Vec3[][] = paint.chance(0.5)
        ? [
            [quad[0], quad[1], quad[2]],
            [quad[0], quad[2], quad[3]],
          ]
        : [
            [quad[0], quad[1], quad[3]],
            [quad[1], quad[2], quad[3]],
          ];
      for (const [p0, p1, p2] of split) {
        const ctr = centroid3([p0, p1, p2]);
        const tH = smoothstep(1.2, 4.0, ctr[1]);
        const col = shade(mix(tone, P.shadow, 0.16 + 0.3 * tH), (0.86 - 0.22 * tH) * (1 + paint.jitter(0.06)));
        triToward(ctr[1] > 2.9 ? roof.geo : m.geo, p0, p1, p2, sub([axis[0], Math.min(ctr[1], 1.6), axis[2]], ctr), col);
      }
    }
  }
  // Earth floor, wider than the walls so no sliver opens along their foot. Every ring owns one
  // centre point shared by the two spans it joins (no T-junctions, so no pixel cracks).
  const FY = 0.05;
  const b = m.geo;
  const floorRow = rings.map((r): [Vec3, Vec3, Vec3] => [
    [-(r.wl + 0.25), FY, r.z],
    [paint.jitter(0.5), FY, r.z],
    [r.wr + 0.25, FY, r.z],
  ]);
  for (let k = 0; k < last; k++) {
    const [aL, aC, aR] = floorRow[k];
    const [cL, cC, cR] = floorRow[k + 1];
    const fc = () => shade(mix(mix(P.dirt, P.earth, 0.45), P.mud, 0.25), 0.92 + paint.jitter(0.06));
    triToward(b, aL, aC, cC, [0, 1, 0], fc());
    triToward(b, aL, cC, cL, [0, 1, 0], fc());
    triToward(b, aC, aR, cR, [0, 1, 0], fc());
    triToward(b, aC, cR, cC, [0, 1, 0], fc());
  }
  // Risers close the 3 cm step between this floor and the shells' floors.
  for (const k of [0, last]) {
    const sgn = k === 0 ? 1 : -1;
    const [tl, tc, tr] = floorRow[k];
    const bl: Vec3 = [tl[0], -0.2, tl[2]];
    const br: Vec3 = [tr[0], -0.2, tr[2]];
    const col = shade(P.mud, 0.8);
    triToward(b, tl, tc, bl, [0, 0, sgn], col);
    triToward(b, tc, br, bl, [0, 0, sgn], col);
    triToward(b, tc, tr, br, [0, 0, sgn], col);
  }
  if (id === "b") {
    // A boulder and a few stones in the bay.
    const zc = (zs[2] + zs[3]) / 2;
    b.rock({
      size: [0.95, 0.8, 1.25],
      points: 12,
      jitter: 0.22,
      flat: 0.25,
      align: "bottom",
      at: [3.12, FY - 0.02, zc + 0.1],
      rot: [0, 20, 0],
      color: rockPaint(paint, pickW(paint, WALL_TONES), 0.14),
    });
    b.rock({
      size: [0.5, 0.36, 0.45],
      points: 9,
      jitter: 0.25,
      flat: 0.25,
      align: "bottom",
      at: [3.0, FY - 0.02, zc - 0.78],
      rot: [0, 70, 0],
      color: rockPaint(paint, paint.pick(BOULDER_TONES), 0.16),
    });
  }
  m.anchor("end_main", [0, 0, H]);
  m.anchor("end_side", [0, 0, -H]);
  m.anchor("center", [0, 0, 0]);
  m.meta = {
    space: "local",
    variant: id,
    place: {
      recipe:
        "at = u * (23.4 + |side centre| - 8.6) / 2 (midpoint of the two mouth planes), rotY = atan2(-u.x, -u.z) deg " +
        "with u = unit(side centre): local +Z points at the origin",
      instances: cavePlacements().map((p) => ({ id: p.id, at: p.tunnel.at, rotY: p.rotY, suggested: p.tunnel.asset === name })),
    },
    length: r4(H * 2),
    clearHalfWidth: 2.5,
    floorY: FY,
    ceilingAt: { cameraTop: CAM_TOP.tunnel, rock: 2.85, apex: 3.85 },
    roofNode: `${name.slice(0, -4)}_roof`,
  };
  assertClear(m, TUBE_ROOMS);
  return m;
}

/* =========================================================================================
 * Group
 * ========================================================================================= */

export default function build(): Model[] {
  const field = buildWallField(MAIN);
  const ceiling = buildMainCeiling();
  const walls = Array.from({ length: MAIN.segments }, (_, s) => buildMainWall(field, s));
  const sides = { a: buildSide("a"), b: buildSide("b") };
  // Every torch spot of the assembled world in cave space (the per-asset anchors stay local).
  const torches: TorchSpot[] = [];
  for (const w of walls) {
    const rot = w.meta.torchRotY as Record<string, number>;
    for (const [name, at] of Object.entries(w.anchors))
      if (name in rot) torches.push({ id: name, at: r4v(at), rotY: rot[name], room: "main" });
  }
  for (const p of cavePlacements()) {
    const side = p.side.asset.includes("_a_") ? sides.a : sides.b;
    const c = Math.cos(p.rotY * DEG);
    const sn = Math.sin(p.rotY * DEG);
    for (const [name, q] of Object.entries(side.anchors))
      if (name.startsWith("torch_")) {
        const at: Vec3 = [p.side.at[0] + q[0] * c + q[2] * sn, 0, p.side.at[2] - q[0] * sn + q[2] * c];
        // face the side cave's centre
        const rotY = Math.atan2(p.side.at[0] - at[0], p.side.at[2] - at[2]) / DEG;
        torches.push({ id: `${p.id}_${name}`, at: r4v(at), rotY: r4(rotY), room: p.id });
      }
  }
  const main = [buildMainFloor(field, ceiling.lowest, torches), ...walls, ceiling.model];
  for (const m of main) assertClear(m, WORLD_ROOMS);
  return [...main, buildTunnel("a"), buildTunnel("b"), sides.a, sides.b];
}
