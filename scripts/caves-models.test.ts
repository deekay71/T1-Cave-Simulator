/**
 * Multi-cave shell (tools/models/groups/caves.ts): budgets, walkability, camera clearance, floor
 * flatness and the hole test. The checks here are written independently of the generator's own
 * build-time guards: they use the real walk rooms from packages/shared/src/rooms.ts and place the
 * tunnel and side-cave assets with the recipe published in the manifest meta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportGlb, NAME_PATTERN, type Model, type Vec3 } from "../tools/models/lib.js";
import build, { CAM_TOP, CAVE_WALK, cavePlacements } from "../tools/models/groups/caves.js";
import { inRooms, tunnelRooms, type Room } from "../packages/shared/src/rooms.js";

type Tri = [Vec3, Vec3, Vec3];
const DEG = Math.PI / 180;
const models = build();
const byName = new Map(models.map((m) => [m.name, m]));
const get = (name: string): Model => {
  const m = byName.get(name);
  assert.ok(m, `missing asset ${name}`);
  return m;
};

function localTris(m: Model): Tri[] {
  const out: Tri[] = [];
  m.root.walk((n) => {
    assert.deepEqual([n.at, n.rot, n.scale], [[0, 0, 0], [0, 0, 0], [1, 1, 1]], `${n.name}: nodes must not be transformed`);
    for (const k of n.geo._buckets())
      for (let i = 0; i < k.pos.length; i += 9)
        out.push([
          [k.pos[i], k.pos[i + 1], k.pos[i + 2]],
          [k.pos[i + 3], k.pos[i + 4], k.pos[i + 5]],
          [k.pos[i + 6], k.pos[i + 7], k.pos[i + 8]],
        ]);
  });
  return out;
}
/** PlayCanvas setEulerAngles(0, rotY, 0) + setPosition(at). */
function placed(tris: Tri[], at: Vec3, rotY: number): Tri[] {
  const c = Math.cos(rotY * DEG),
    s = Math.sin(rotY * DEG);
  const f = (p: Vec3): Vec3 => [at[0] + p[0] * c + p[2] * s, at[1] + p[1], at[2] - p[0] * s + p[2] * c];
  return tris.map((t) => [f(t[0]), f(t[1]), f(t[2])]);
}

const MAIN_NAMES = [
  "tl_cave_main_floor_v01",
  ...[0, 1, 2, 3, 4, 5].map((s) => `tl_cave_main_wall_0${s}_v01`),
  "tl_cave_main_ceiling_v01",
];
const placements = cavePlacements();
interface Part {
  label: string;
  tris: Tri[];
}
const parts: Part[] = [
  ...MAIN_NAMES.map((n) => ({ label: n, tris: localTris(get(n)) })),
  ...placements.flatMap((p) => [
    { label: `${p.tunnel.asset}@${p.id}`, tris: placed(localTris(get(p.tunnel.asset)), p.tunnel.at, p.rotY) },
    { label: `${p.side.asset}@${p.id}`, tris: placed(localTris(get(p.side.asset)), p.side.at, p.rotY) },
  ]),
];
// The other variant in every slot must pass the geometric rules too (the integrator may swap them).
const swapped: Part[] = placements.flatMap((p) => {
  const other = (a: string) => (a.includes("_a_") ? a.replace("_a_", "_b_") : a.replace("_b_", "_a_"));
  return [
    { label: `${other(p.tunnel.asset)}@${p.id}`, tris: placed(localTris(get(other(p.tunnel.asset))), p.tunnel.at, p.rotY) },
    { label: `${other(p.side.asset)}@${p.id}`, tris: placed(localTris(get(other(p.side.asset))), p.side.at, p.rotY) },
  ];
});

/** The real walk rooms, with the camera tops the shells promise. */
const rooms: Room[] = [
  { ...CAVE_WALK.main, top: CAM_TOP.main, id: "main" },
  ...CAVE_WALK.sides.map((s) => ({ x: s.x, z: s.z, r: s.r, top: CAM_TOP.side, id: s.id })),
  ...CAVE_WALK.sides.flatMap((s) => {
    const d = Math.hypot(s.x, s.z);
    const { from, to, r } = CAVE_WALK.tunnel;
    return tunnelRooms(
      { x: (s.x / d) * from, z: (s.z / d) * from },
      { x: (s.x / d) * to, z: (s.z / d) * to },
      r,
      { top: CAM_TOP.tunnel, id: `tunnel_${s.id}` },
    );
  }),
];

/* ------------------------------------------------------------------ 2D helpers */

type P2 = [number, number];
function clipY(poly: Vec3[], y: number, keepAbove: boolean): Vec3[] {
  const out: Vec3[] = [];
  const side = (p: Vec3) => (keepAbove ? p[1] - y : y - p[1]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const da = side(a),
      db = side(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
function segDist(px: number, pz: number, a: P2, b: P2): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}
/** Distance from a point to a convex polygon in the XZ plane (0 inside). */
function polyDist(px: number, pz: number, poly: P2[]): number {
  let pos = 0,
    neg = 0,
    best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (c > 1e-12) pos++;
    else if (c < -1e-12) neg++;
    best = Math.min(best, segDist(px, pz, a, b));
  }
  return poly.length >= 3 && (pos === 0) !== (neg === 0) ? 0 : best;
}
/** Deepest intrusion (m) of geometry between y0 and y1(room) into the rooms grown by `margin`. */
function intrusion(tris: Tri[], margin: number, y0: number, y1: (o: Room) => number): { depth: number; at?: Vec3 } {
  let depth = -Infinity;
  let at: Vec3 | undefined;
  for (const t of tris) {
    const lo = Math.min(t[0][1], t[1][1], t[2][1]),
      hi = Math.max(t[0][1], t[1][1], t[2][1]);
    if (hi < y0) continue;
    const cache = new Map<number, P2[]>();
    for (const o of rooms) {
      const top = y1(o);
      if (lo > top) continue;
      let poly = cache.get(top);
      if (!poly) {
        poly = clipY(clipY(t, y0, true), top, false).map((p): P2 => [p[0], p[2]]);
        cache.set(top, poly);
      }
      if (!poly.length) continue;
      const d = o.r + margin - polyDist(o.x, o.z, poly);
      if (d > depth) {
        depth = d;
        at = t[0];
      }
    }
  }
  return { depth, at };
}

/* ------------------------------------------------------------------ ray casting (BVH) */

class Bvh {
  private readonly t: Float64Array; // 9 per triangle
  private readonly nodes: number[] = []; // minx,miny,minz,maxx,maxy,maxz,left|start,right|count,leaf
  constructor(tris: Tri[]) {
    this.t = new Float64Array(tris.length * 9);
    const order = tris.map((_, i) => i);
    const cen = tris.map((q) => [0, 1, 2].map((k) => (q[0][k] + q[1][k] + q[2][k]) / 3));
    const sorted: number[] = [];
    const buildNode = (ids: number[]): number => {
      const mn = [Infinity, Infinity, Infinity],
        mx = [-Infinity, -Infinity, -Infinity];
      for (const i of ids)
        for (const p of tris[i])
          for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], p[k]);
            mx[k] = Math.max(mx[k], p[k]);
          }
      const at = this.nodes.length;
      this.nodes.push(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2], 0, 0, 0);
      if (ids.length <= 6) {
        this.nodes[at + 6] = sorted.length;
        this.nodes[at + 7] = ids.length;
        this.nodes[at + 8] = 1;
        sorted.push(...ids);
        return at;
      }
      const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
      ids.sort((a, b) => cen[a][ax] - cen[b][ax]);
      const mid = ids.length >> 1;
      const l = buildNode(ids.slice(0, mid));
      const r = buildNode(ids.slice(mid));
      this.nodes[at + 6] = l;
      this.nodes[at + 7] = r;
      return at;
    };
    buildNode(order);
    sorted.forEach((src, dst) => {
      const q = tris[src];
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) this.t[dst * 9 + v * 3 + k] = q[v][k];
    });
  }
  /** Nearest hit along the ray: distance to the nearest front face and to the nearest face of any side. */
  cast(o: Vec3, d: Vec3): { front: number; any: number } {
    const N = this.nodes,
      T = this.t;
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    let front = Infinity,
      any = Infinity;
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      let t0 = 0,
        t1 = front;
      for (let k = 0; k < 3; k++) {
        let a = (N[n + k] - o[k]) * inv[k],
          b = (N[n + 3 + k] - o[k]) * inv[k];
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
      }
      if (t0 > t1) continue;
      if (!N[n + 8]) {
        stack.push(N[n + 6], N[n + 7]);
        continue;
      }
      for (let i = N[n + 6], e = i + N[n + 7]; i < e; i++) {
        const b = i * 9;
        const e1x = T[b + 3] - T[b],
          e1y = T[b + 4] - T[b + 1],
          e1z = T[b + 5] - T[b + 2];
        const e2x = T[b + 6] - T[b],
          e2y = T[b + 7] - T[b + 1],
          e2z = T[b + 8] - T[b + 2];
        const px = d[1] * e2z - d[2] * e2y,
          py = d[2] * e2x - d[0] * e2z,
          pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const sx = o[0] - T[b],
          sy = o[1] - T[b + 1],
          sz = o[2] - T[b + 2];
        const u = (sx * px + sy * py + sz * pz) / det;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const qx = sy * e1z - sz * e1y,
          qy = sz * e1x - sx * e1z,
          qz = sx * e1y - sy * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (t < 1e-4) continue;
        if (t < any) any = t;
        if (det > 0 && t < front) front = t;
      }
    }
    return { front, any };
  }
}

/* ------------------------------------------------------------------ tests */

test("caves: tên, ngân sách tam giác và số liệu đặt", () => {
  const count = (m: Model) => m.stats().triangles;
  for (const m of models) {
    assert.match(m.name, NAME_PATTERN);
    assert.ok(count(m) <= m.budget, `${m.name}: ${count(m)} > budget ${m.budget}`);
    assert.equal(m.stats().degenerate, 0, `${m.name}: degenerate triangles`);
  }
  assert.equal(models.length, 12);
  const main = MAIN_NAMES.reduce((s, n) => s + count(get(n)), 0);
  assert.ok(main <= 7000, `main shell ${main} tris`);
  for (const v of ["a", "b"]) {
    assert.ok(count(get(`tl_cave_side_${v}_v01`)) <= 1800);
    assert.ok(count(get(`tl_cave_tunnel_${v}_v01`)) <= 500);
  }
  // Placement recipe: side cave at the side centre, tunnel at the midpoint of the two mouth planes.
  for (const [i, p] of placements.entries()) {
    const s = CAVE_WALK.sides[i];
    const d = Math.hypot(s.x, s.z);
    assert.deepEqual(p.side.at, [s.x, 0, s.z]);
    const mid = (23.4 + d - 8.6) / 2;
    assert.ok(Math.hypot(p.tunnel.at[0] - (s.x / d) * mid, p.tunnel.at[2] - (s.z / d) * mid) < 1e-3);
    // local +Z points at the origin
    const fwd = [Math.sin(p.rotY * DEG), Math.cos(p.rotY * DEG)];
    assert.ok(Math.hypot(fwd[0] + s.x / d, fwd[1] + s.z / d) < 1e-4, `${p.id}: rotY ${p.rotY}`);
  }
  const meta = get("tl_cave_main_floor_v01").meta as { walk: { main: unknown; sides: unknown[]; tunnels: unknown[] } };
  assert.deepEqual(meta.walk.main, CAVE_WALK.main);
  assert.equal(meta.walk.sides.length, 4);
  assert.equal(meta.walk.tunnels.length, 4);
});

test("caves: không có khối đặc nào dưới 1,8 m lấn vào vùng đi được (lề 0,3 m)", () => {
  for (const part of [...parts, ...swapped]) {
    const { depth, at } = intrusion(part.tris, 0.3, 0.06, () => 1.8);
    assert.ok(depth <= 1e-6, `${part.label}: lấn ${depth.toFixed(3)} m gần ${at?.map((v) => v.toFixed(2))}`);
  }
});

test("caves: camera (vùng đi được + 0,6 m, 0,6 m tới trần phòng) không chạm đá (đệm 0,1 m)", () => {
  for (const part of [...parts, ...swapped]) {
    const { depth, at } = intrusion(part.tris, 0.7, 0.6, (o) => (o.top ?? 0) + 0.1);
    assert.ok(depth <= 1e-6, `${part.label}: lấn ${depth.toFixed(3)} m gần ${at?.map((v) => v.toFixed(2))}`);
  }
});

test("caves: tường hang lớn không gần tâm hơn 21,3 m dưới 1,8 m; hang nhỏ không gần hơn 7,6 m", () => {
  const minR = (tris: Tri[], cx: number, cz: number) => {
    let best = Infinity;
    for (const t of tris) {
      const poly = clipY(clipY(t, 0.06, true), 1.8, false).map((p): P2 => [p[0], p[2]]);
      if (poly.length) best = Math.min(best, polyDist(cx, cz, poly));
    }
    return best;
  };
  for (const part of parts.filter((p) => p.label.startsWith("tl_cave_main_wall")))
    assert.ok(minR(part.tris, 0, 0) >= 21.3, `${part.label}: ${minR(part.tris, 0, 0).toFixed(2)}`);
  for (const p of placements) {
    const part = parts.find((q) => q.label === `${p.side.asset}@${p.id}`)!;
    const r = minR(part.tris, p.side.at[0], p.side.at[2]);
    assert.ok(r >= 7.6, `${part.label}: ${r.toFixed(2)}`);
  }
});

test("caves: trần và đá treo không thấp hơn số liệu ceilingAt trong manifest", () => {
  const at = (get("tl_cave_main_floor_v01").meta as { ceilingAt: Record<"main" | "tunnel" | "side", { cameraTop: number; rock: number }> }).ceilingAt;
  assert.deepEqual([at.main.cameraTop, at.tunnel.cameraTop, at.side.cameraTop], [CAM_TOP.main, CAM_TOP.tunnel, CAM_TOP.side]);
  assert.ok(at.main.rock >= 9.5 && at.tunnel.rock > CAM_TOP.tunnel + 0.3 && at.side.rock >= 4);
  /** Lowest point above 2 m of the triangles over the region `inside` (sampled). */
  const lowest = (inside: (x: number, z: number) => boolean) => {
    let lo = Infinity;
    const N = 8;
    for (const part of parts)
      for (const t of part.tris) {
        if (Math.max(t[0][1], t[1][1], t[2][1]) < 2) continue;
        for (let i = 0; i <= N; i++)
          for (let j = 0; j <= N - i; j++) {
            const a = i / N,
              b = j / N,
              c = 1 - a - b;
            const y = t[0][1] * a + t[1][1] * b + t[2][1] * c;
            if (y > 2 && y < lo && inside(t[0][0] * a + t[1][0] * b + t[2][0] * c, t[0][2] * a + t[1][2] * b + t[2][2] * c)) lo = y;
          }
      }
    return lo;
  };
  const main = lowest((x, z) => Math.hypot(x, z) <= 20.6);
  assert.ok(main >= at.main.rock - 1e-3, `main: rock at ${main.toFixed(2)} < ${at.main.rock}`);
  assert.ok(main >= 7, "main: nothing hangs below 7 m");
  const tunnels = rooms.filter((o) => o.id?.startsWith("tunnel_"));
  const tun = lowest((x, z) => Math.hypot(x, z) > 20.6 && tunnels.some((o) => Math.hypot(x - o.x, z - o.z) <= o.r + 0.6));
  assert.ok(tun >= at.tunnel.rock - 1e-3, `tunnel: rock at ${tun.toFixed(2)} < ${at.tunnel.rock}`);
  const side = lowest((x, z) => CAVE_WALK.sides.some((o) => Math.hypot(x - o.x, z - o.z) <= o.r));
  assert.ok(side >= at.side.rock - 1e-3, `side: rock at ${side.toFixed(2)} < ${at.side.rock}`);
});

test("caves: sàn phẳng trong vùng đi được và không thủng", () => {
  const bvh = new Bvh(parts.flatMap((p) => p.tris));
  const tube = placements.map((p) => {
    const d = Math.hypot(p.side.at[0], p.side.at[2]);
    return { ux: p.side.at[0] / d, uz: p.side.at[2] / d, a: 23.4 + 0.3, b: d - 8.6 - 0.3 };
  });
  let n = 0;
  for (let x = -47; x <= 47; x += 0.45)
    for (let z = -33; z <= 33; z += 0.45) {
      if (!inRooms(x, z, rooms, 0.3)) continue;
      n++;
      const hit = bvh.cast([x, 1, z], [1e-9, -1, 1e-9]);
      assert.ok(Number.isFinite(hit.front), `no floor under (${x.toFixed(2)}, ${z.toFixed(2)})`);
      const y = 1 - hit.front;
      // 1 = on a tunnel floor, 0.5 = within 2 cm of its end (either floor), 0 = on a shell floor
      const inTube = Math.max(
        ...tube.map((t) => {
          const along = x * t.ux + z * t.uz;
          if (Math.abs(-x * t.uz + z * t.ux) > 2.6) return 0;
          return along > t.a + 0.02 && along < t.b - 0.02 ? 1 : along > t.a - 0.02 && along < t.b + 0.02 ? 0.5 : 0;
        }),
      );
      const onTube = Math.abs(y - 0.05) < 1e-6;
      const onShell = y >= 0.006 - 1e-9 && y <= 0.035 + 1e-9;
      const where = `at (${x.toFixed(2)}, ${z.toFixed(2)})`;
      if (inTube === 1) assert.ok(onTube, `tunnel floor y=${y} ${where}`);
      else if (inTube === 0) assert.ok(onShell, `floor y=${y.toFixed(4)} ${where}`);
      else assert.ok(onTube || onShell, `floor y=${y.toFixed(4)} ${where}`);
    }
  assert.ok(n > 9000);
  // main floor: flat for the whole r < 21 disc
  for (const t of localTris(get("tl_cave_main_floor_v01")))
    if (polyDist(0, 0, t.map((p): P2 => [p[0], p[2]])) < 21)
      for (const p of t) assert.ok(p[1] >= 0.006 && p[1] <= 0.035, `main floor y=${p[1]}`);
  for (const v of ["a", "b"])
    for (const t of localTris(get(`tl_cave_side_${v}_v01`)).filter((q) => q.every((p) => p[1] < 0.036)))
      if (polyDist(0, 0, t.map((p): P2 => [p[0], p[2]])) < 7.6)
        for (const p of t) assert.ok(p[1] >= 0.006 && p[1] <= 0.035, `side floor y=${p[1]}`);
});

test("caves: không có T-junction (đỉnh nằm giữa cạnh hở) — tránh hở từng pixel khi raster", () => {
  for (const m of models) {
    const tris = localTris(m);
    const key = (p: Vec3) => p.map((v) => Math.round(v * 1e5)).join(",");
    const verts = new Map<string, Vec3>();
    const edges = new Map<string, { a: Vec3; b: Vec3; n: number }>();
    for (const t of tris)
      for (let i = 0; i < 3; i++) {
        const a = t[i],
          b = t[(i + 1) % 3];
        verts.set(key(a), a);
        const ka = key(a),
          kb = key(b);
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edges.get(k);
        if (e) e.n++;
        else edges.set(k, { a, b, n: 1 });
      }
    for (const e of edges.values()) {
      if (e.n !== 1) continue; // only open edges can crack
      const d: Vec3 = [e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]];
      const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      for (const v of verts.values()) {
        const w: Vec3 = [v[0] - e.a[0], v[1] - e.a[1], v[2] - e.a[2]];
        const t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / l2;
        if (t <= 1e-4 || t >= 1 - 1e-4) continue;
        const off = Math.hypot(w[0] - d[0] * t, w[1] - d[1] * t, w[2] - d[2] * t);
        assert.ok(off > 1e-4, `${m.name}: vertex ${v.map((x) => x.toFixed(3))} sits on the open edge ${e.a.map((x) => x.toFixed(3))} -> ${e.b.map((x) => x.toFixed(3))}`);
      }
    }
  }
});

/**
 * Hole test: from every reachable camera position (walk discs + 0.6 m, 0.6 m .. the room's camera
 * top) every ray must end on a front face (the shells are single-sided, so a ray that only meets
 * back faces, or nothing, is a see-through hole), and no back face may be nearer than that front
 * face (which would be a view into the back of the rock).
 */
function holeTest(world: Part[], rays: number, step: number) {
  const bvh = new Bvh(world.flatMap((p) => p.tris));
  const dirs: Vec3[] = [];
  for (let i = 0; i < rays; i++) {
    const y = 1 - (2 * (i + 0.5)) / rays;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    dirs.push([Math.cos(a) * r || 1e-9, y || 1e-9, Math.sin(a) * r || 1e-9]);
  }
  const eyes: Vec3[] = [];
  const add = (x: number, z: number) => {
    let top = -1;
    for (const o of rooms) if (Math.hypot(x - o.x, z - o.z) <= o.r + 0.6) top = Math.max(top, o.top ?? 0);
    if (top < 0) return;
    for (const y of [0.6, 1.7, top]) eyes.push([x, y, z]);
  };
  for (let x = -47; x <= 47; x += step) for (let z = -33; z <= 33; z += step) add(x + 0.13, z + 0.07);
  for (const o of rooms) {
    const n = o.r > 5 ? 48 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      add(o.x + (o.r + 0.599) * Math.cos(a), o.z + (o.r + 0.599) * Math.sin(a));
    }
  }
  let escaped = 0,
    back = 0,
    near = Infinity;
  let first = "";
  for (const eye of eyes)
    for (const d of dirs) {
      const hit = bvh.cast(eye, d);
      near = Math.min(near, hit.any);
      if (!Number.isFinite(hit.front)) {
        escaped++;
        first ||= `escape from ${eye.map((v) => v.toFixed(2))} dir ${d.map((v) => v.toFixed(3))}`;
      } else if (hit.any < hit.front - 1e-6) {
        back++;
        if (back % 97 === 1 && first.length < 900)
          first += `back face from ${eye.map((v) => v.toFixed(2))} dir ${d.map((v) => v.toFixed(3))} at ${hit.any.toFixed(2)} m; `;
      }
    }
  return { eyes: eyes.length, rays: eyes.length * dirs.length, escaped, back, near, first };
}

test("caves: không thủng — mọi tia từ vị trí camera đều dừng trên mặt trước của vỏ hang", () => {
  // CAVES_HOLE_RAYS / CAVES_HOLE_STEP make a denser one-off run (e.g. 1500 rays, 1.3 m grid).
  const r = holeTest(parts, Number(process.env.CAVES_HOLE_RAYS) || 220, Number(process.env.CAVES_HOLE_STEP) || 2.2);
  assert.ok(r.eyes > 1500, `only ${r.eyes} eyes`);
  if (process.env.CAVES_HOLE_RAYS) console.log(`hole test: ${r.eyes} eyes, ${r.rays} rays, nearest geometry ${r.near.toFixed(3)} m`);
  assert.equal(r.escaped, 0, `${r.escaped} of ${r.rays} rays escaped; ${r.first}`);
  assert.equal(r.back, 0, `${r.back} of ${r.rays} rays met a back face first; ${r.first}`);
  assert.ok(r.near >= 0.1, `geometry ${r.near.toFixed(3)} m from a camera position`);
  // the other variant in every slot
  const main = parts.filter((p) => p.label.startsWith("tl_cave_main"));
  const s = holeTest([...main, ...swapped], 120, 3.1);
  assert.equal(s.escaped + s.back, 0, `swapped variants: ${s.escaped} escaped, ${s.back} back faces; ${s.first}`);
});

test("caves: build tất định (hai lần build cho cùng byte)", async () => {
  const again = build();
  for (const [i, m] of models.entries()) {
    const a = await exportGlb(m);
    const b = await exportGlb(again[i]);
    assert.equal(Buffer.compare(Buffer.from(a.glb), Buffer.from(b.glb)), 0, `${m.name} differs between builds`);
  }
});
