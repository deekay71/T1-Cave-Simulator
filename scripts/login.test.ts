/**
 * Login screen: the exterior set (tools/models/groups/login.ts) and the queue maths
 * (apps/web/src/login/queueMath.ts). Budgets, determinism, the path the fans walk and the
 * endless, evenly spaced line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportGlb, NAME_PATTERN, type Model, type Vec3 } from "../tools/models/lib.js";
import build, {
  LOGIN_TRIANGLE_BUDGET,
  loginGroundY,
  loginSetTriangles,
  type LoginPlacement,
} from "../tools/models/groups/login.js";
import {
  QUEUE,
  buildPath,
  fanLight,
  fanOpacity,
  fanS,
  queueLoop,
  samplePath,
  type P3,
} from "../apps/web/src/login/queueMath.js";

const models = build();
const byName = new Map(models.map((m) => [m.name, m]));
const get = (name: string): Model => {
  const m = byName.get(name);
  assert.ok(m, `missing asset ${name}`);
  return m;
};
const placementsOf = (m: Model) => (m.meta.placements ?? []) as LoginPlacement[];
const ground = get("tl_env_login_ground_v01");
const path = ground.meta.path as P3[];
const crest = ground.meta.pathCrest as number;
const mouth = ground.meta.pathMouth as number;

test("login set: names, budgets and the 9000-triangle total as placed", () => {
  assert.equal(new Set(models.map((m) => m.name)).size, models.length);
  for (const m of models) {
    assert.match(m.name, NAME_PATTERN);
    const s = m.stats();
    assert.ok(s.triangles > 0 && s.triangles <= m.budget, `${m.name}: ${s.triangles} / ${m.budget} triangles`);
    assert.equal(s.degenerate, 0, `${m.name}: degenerate triangles`);
    assert.ok(placementsOf(m).length >= 1, `${m.name}: no placement`);
    // usual pivot: bottom centre
    assert.ok(Math.abs(s.bounds.min[1]) < 0.02, `${m.name}: min y ${s.bounds.min[1]}`);
  }
  assert.equal(LOGIN_TRIANGLE_BUDGET, 9000);
  assert.ok(loginSetTriangles(models) <= LOGIN_TRIANGLE_BUDGET, `set: ${loginSetTriangles(models)} triangles`);
  // the pieces the concept needs
  for (const part of ["ground", "cave_mouth", "boulder_a", "spires_near", "spires_mid", "spires_far", "tree_a", "tree_b", "sky"])
    get(`tl_env_login_${part}_v01`);
  get("tl_fx_login_sun_v01");
});

test("login set: the build is deterministic", async () => {
  const again = build();
  assert.equal(again.length, models.length);
  for (let i = 0; i < models.length; i++) {
    const a = await exportGlb(models[i]);
    const b = await exportGlb(again[i]);
    assert.equal(Buffer.compare(Buffer.from(a.glb), Buffer.from(b.glb)), 0, `${models[i].name}: bytes differ between two builds`);
    assert.deepEqual(models[i].meta, again[i].meta);
  }
});

test("login set: glow only where the concept glows, the symbol comes from the library", () => {
  const glowOf = (name: string) => get(name).stats().emissive.reduce((n, e) => n + e.triangles, 0);
  assert.ok(glowOf("tl_env_login_ground_v01") > 40, "cracks");
  assert.ok(glowOf("tl_env_login_cave_mouth_v01") > 40, "throat glow + painted symbol");
  assert.ok(glowOf("tl_fx_login_sun_v01") > 0);
  for (const n of ["boulder_a", "boulder_b", "boulder_c", "boulder_dark", "spires_near", "spires_mid", "spires_far", "tree_a", "tree_b"])
    assert.equal(glowOf(`tl_env_login_${n}_v01`), 0, n);
  const cave = get("tl_env_login_cave_mouth_v01");
  assert.ok(cave.anchors.emblem && cave.anchors.mouth);
  assert.equal(cave.lights.length, 2);
});

test("login path: from the gully over the crest, downhill into the mouth, clear of rocks and trees", () => {
  assert.ok(path.length > 40);
  const p = buildPath(path);
  assert.ok(crest > 4 && mouth > crest + 15 && p.length > mouth + QUEUE.tail, `crest ${crest}, mouth ${mouth}, length ${p.length}`);
  for (const [x, y, z] of path) assert.ok(Math.abs(loginGroundY(x, z) - y) < 2e-3, "path points sit on the ground");
  const at = (s: number) => samplePath(p, s, { x: 0, y: 0, z: 0, yaw: 0, slope: 0 });
  // the threshold is the set's origin; the crest is ~2 m above it and the start lies lower again
  const m = at(mouth);
  assert.ok(Math.hypot(m.x, m.z) < 0.05 && Math.abs(m.y) < 0.1);
  const c = at(crest);
  assert.ok(c.y > 1.8 && c.y < 2.4, `crest height ${c.y}`);
  assert.ok(at(crest - QUEUE.lead).y < c.y - 1, "the loop starts down in the gully");
  // crest -> mouth never climbs, and never turns sharply
  let last = at(crest + 1);
  for (let s = crest + 1.5; s <= mouth + QUEUE.tail; s += 0.5) {
    const q = at(s);
    assert.ok(q.y <= last.y + 0.02, `path climbs at s=${s}`);
    let d = Math.abs(q.yaw - last.yaw);
    if (d > Math.PI) d = 2 * Math.PI - d;
    assert.ok(d < 0.2, `path turns ${d} rad in 0.5 m at s=${s}`);
    last = q;
  }
  // nothing stands on the path
  for (const m2 of models) {
    if (!/_boulder_|_tree_/.test(m2.name)) continue;
    const s = m2.stats();
    const foot = m2.anchors.trunk as Vec3 | undefined;
    for (const pl of placementsOf(m2)) {
      const radius = foot ? 0.5 * pl.scale : (Math.max(s.bounds.max[0] - s.bounds.min[0], s.bounds.max[2] - s.bounds.min[2]) / 2) * pl.scale;
      let cx = pl.at[0],
        cz = pl.at[2];
      if (foot) {
        const co = Math.cos((pl.yaw * Math.PI) / 180),
          si = Math.sin((pl.yaw * Math.PI) / 180);
        cx += (foot[0] * co + foot[2] * si) * pl.scale;
        cz += (-foot[0] * si + foot[2] * co) * pl.scale;
      }
      let best = Infinity;
      for (const [x, , z] of path) best = Math.min(best, Math.hypot(x - cx, z - cz));
      assert.ok(best > radius + 0.55, `${m2.name} at ${pl.at}: ${best.toFixed(2)} m from the path, radius ${radius.toFixed(2)}`);
    }
  }
});

test("login queue: an endless, evenly spaced line that fades in the cave", () => {
  const p = buildPath(path);
  const loop = queueLoop(p, crest, mouth);
  assert.ok(QUEUE.fans >= 6 && QUEUE.fans <= 8);
  assert.ok(QUEUE.speed >= 0.6 && QUEUE.speed <= 0.8);
  assert.ok(Math.abs(loop.spacing * QUEUE.fans - loop.length) < 1e-9);
  assert.ok(loop.spacing > 2.5 && loop.spacing < 4.5, `spacing ${loop.spacing}`);
  for (const travelled of [0, 1.3, 17.77, loop.length - 1e-6, loop.length * 3 + 0.4]) {
    const s = Array.from({ length: QUEUE.fans }, (_, i) => fanS(loop, i, travelled)).sort((a, b) => a - b);
    assert.ok(s[0] >= loop.start && s[s.length - 1] < loop.start + loop.length);
    for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i] - s[i - 1] - loop.spacing) < 1e-6, "even spacing");
  }
  // one fan after another: a slot's period is spacing / speed seconds
  assert.ok(loop.spacing / QUEUE.speed > 3.5, "slow rhythm");
  // fade: untouched outside, a dark silhouette inside, gone before the loop wraps
  assert.equal(fanLight(-3), 1);
  assert.equal(fanOpacity(-3), 1);
  assert.equal(fanOpacity(1), 1);
  assert.ok(fanLight(3) < 0.15);
  assert.equal(fanOpacity(QUEUE.tail - 0.3), 0);
  assert.equal(fanOpacity(QUEUE.tail), 0);
  // and the loop's first metres are below the crest's sight line (newcomers rise into view)
  const start = samplePath(p, loop.start, { x: 0, y: 0, z: 0, yaw: 0, slope: 0 });
  const top = samplePath(p, crest, { x: 0, y: 0, z: 0, yaw: 0, slope: 0 });
  assert.ok(start.y < top.y - 1.2);
});

test("login path sampling: continuous, clamped at the ends", () => {
  const p = buildPath(path);
  const out = { x: 0, y: 0, z: 0, yaw: 0, slope: 0 };
  let prev = { ...samplePath(p, 0, out) };
  for (let s = 0.1; s <= p.length; s += 0.1) {
    const q = samplePath(p, s, out);
    assert.ok(Math.hypot(q.x - prev.x, q.z - prev.z) < 0.11, `jump at s=${s}`);
    prev = { ...q };
  }
  const end = { ...samplePath(p, p.length, out) };
  assert.deepEqual({ ...samplePath(p, p.length + 5, out) }, end);
  assert.deepEqual({ ...samplePath(p, -3, out) }, { ...samplePath(p, 0, out) });
});
