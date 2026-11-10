import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyInput,
  AXIS_MAX,
  CAVE_SHELL,
  Chat,
  constrain,
  frameToCave,
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_LAYOUT_HASH,
  HUB_PLACEMENTS,
  HUB_ZONES,
  hubObstacles,
  layoutHash,
  MIN_GAP,
  MOVE_SPEED,
  SPAWN_CLEAR_RADIUS,
  spawnPoint,
  type Layout,
  type Obstacle,
} from "@te-liet/shared";

const STEP = 0.05;

test("đi chéo cùng tốc độ với đi thẳng", () => {
  const straight = { x: 5, z: 5 },
    diagonal = { x: 5, z: 5 };
  applyInput(straight, { moveX: AXIS_MAX, moveZ: 0 }, STEP);
  applyInput(diagonal, { moveX: AXIS_MAX, moveZ: AXIS_MAX }, STEP);
  const a = Math.hypot(straight.x - 5, straight.z - 5),
    b = Math.hypot(diagonal.x - 5, diagonal.z - 5);
  assert.ok(Math.abs(a - MOVE_SPEED * STEP) < 1e-5);
  assert.ok(Math.abs(a - b) < 1e-5);
});

test("dt lớn không gây dịch chuyển tức thời", () => {
  const p = { x: 0, z: -8 };
  applyInput(p, { moveX: 0, moveZ: -AXIS_MAX }, 100);
  assert.ok(Math.abs(p.z - (-8 - MOVE_SPEED * 0.1)) < 1e-5);
});

test("giữ người chơi trong hang và ngoài lửa trại", () => {
  const far = constrain(20, 20);
  assert.ok(Math.hypot(far.x, far.z) <= HUB_LAYOUT.radius + 1e-9);
  for (const [x, z] of [
    [0.5, 0],
    [0, 0],
    [-1, 1],
  ]) {
    const p = constrain(x, z);
    assert.ok(Math.hypot(p.x, p.z) >= HUB_LAYOUT.obstacles[0].r - 1e-9);
  }
});

test("kết quả làm tròn float32 để client và server trùng từng bit", () => {
  const p = { x: 0.1, z: -12 };
  applyInput(p, { moveX: 37, moveZ: -90 }, STEP);
  assert.equal(p.x, Math.fround(p.x));
  assert.equal(p.z, Math.fround(p.z));
});

test("input 0 hoặc NaN không làm nhân vật di chuyển", () => {
  for (const cmd of [
    { moveX: 0, moveZ: 0 },
    { moveX: NaN, moveZ: 0 },
  ]) {
    const p = { x: 3, z: -3 };
    applyInput(p, cmd, STEP);
    assert.deepEqual(p, { x: 3, z: -3 });
  }
});

test("điểm xuất hiện ở cửa hang", () => {
  for (const r of [0, 0.5, 0.999]) {
    const p = spawnPoint(() => r);
    assert.ok(
      Math.hypot(p.x - HUB_LAYOUT.spawn.x, p.z - HUB_LAYOUT.spawn.z) <=
        HUB_LAYOUT.spawn.spread * Math.SQRT2 + 1e-6,
    );
    assert.ok(Math.hypot(p.x, p.z) > HUB_LAYOUT.obstacles[0].r);
  }
});

test("chat rỗng hoặc quá dài bị từ chối", () => {
  assert.equal(Chat.safeParse(" ").success, false);
  assert.equal(Chat.safeParse("x".repeat(241)).success, false);
  assert.equal(Chat.safeParse("Chào cả hang").success, true);
});

test("các vùng đồ vật dùng cùng collision cho client và server", () => {
  for (const obstacle of HUB_LAYOUT.obstacles) {
    const p = constrain(obstacle.x, obstacle.z);
    assert.ok(
      Math.hypot(p.x - obstacle.x, p.z - obstacle.z) >= obstacle.r - 1e-8,
    );
    assert.ok(Math.hypot(p.x, p.z) <= HUB_LAYOUT.radius);
  }
});

const { obstacles, radius, spawn } = HUB_LAYOUT;
/** Vật cản đầu tiên chứa (x, z) sâu hơn tol, nếu có. */
const insideObstacle = (x: number, z: number, tol = 1e-9) =>
  obstacles.find((o) => Math.hypot(x - o.x, z - o.z) < o.r - tol);

test("vật cản suy ra từ bảng đặt model, vòng lửa trại đứng đầu", () => {
  assert.deepEqual(obstacles, hubObstacles(HUB_PLACEMENTS));
  assert.deepEqual(obstacles[0], { x: 0, z: 0, r: 1.6 });
  for (const o of obstacles) {
    assert.ok(o.r > 0);
    // Làm tròn 1 mm: mọi engine JS dựng ra cùng một bộ số.
    for (const v of [o.x, o.z, o.r])
      assert.equal(Math.round(v * 1000) / 1000, v);
  }
});

/**
 * Chỗ thắt (khe hẹp giữa hai vật cản, chỗ chồng nông, khe giữa vật cản và biên) được phép nếu mọi
 * điểm thắt nằm trong một vật cản khác (đã bị bịt) hoặc ngoài vùng đi được.
 */
const sealed = (pts: [number, number][], skip: readonly Obstacle[]) =>
  pts.every(
    ([x, z]) =>
      Math.hypot(x, z) > radius + 1e-3 ||
      obstacles.some(
        (c) => !skip.includes(c) && Math.hypot(x - c.x, z - c.z) < c.r - 1e-3,
      ),
  );

test("mỗi vật cản cách biên ≥ MIN_GAP, hoặc là khối chặn sát vách lấn sâu", () => {
  assert.ok(
    radius <= 16.6 - 0.4,
    "giữ người chơi cách vách/gờ gần nhất (16,6 m) ít nhất 0,4 m",
  );
  for (const o of obstacles) {
    const d = Math.hypot(o.x, o.z);
    if (d + o.r <= radius - MIN_GAP + 1e-9) continue;
    // Khối chặn: tâm ngoài biên đủ xa nên góc với biên tù (không thành khe hút người chơi).
    if (d * d >= radius * radius + o.r * o.r - 1e-9) continue;
    const ux = o.x / d,
      uz = o.z / d;
    let pts: [number, number][];
    if (d + o.r < radius) {
      const m = (d + o.r + radius) / 2;
      pts = [
        [ux * (d + o.r), uz * (d + o.r)],
        [ux * radius, uz * radius],
        [ux * m, uz * m],
      ];
    } else {
      const t = (radius * radius + d * d - o.r * o.r) / (2 * d),
        h = Math.sqrt(Math.max(0, radius * radius - t * t));
      pts = [
        [ux * t - uz * h, uz * t + ux * h],
        [ux * t + uz * h, uz * t - ux * h],
      ];
    }
    assert.ok(
      sealed(pts, [o]),
      `vật cản (${o.x}, ${o.z}, r ${o.r}) để khe ${(radius - d - o.r).toFixed(3)} m với biên`,
    );
  }
});

test("hai vật cản chồng sâu hoặc cách nhau ≥ MIN_GAP: không có khe để lách qua", () => {
  for (let i = 0; i < obstacles.length; i++)
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i],
        b = obstacles[j];
      const s = Math.hypot(a.x - b.x, a.z - b.z);
      if (s >= a.r + b.r + MIN_GAP - 1e-9) continue;
      if (s * s <= a.r * a.r + b.r * b.r + 1e-9) continue;
      const ux = (b.x - a.x) / s,
        uz = (b.z - a.z) / s;
      let pts: [number, number][];
      if (s > a.r + b.r) {
        const p: [number, number] = [a.x + ux * a.r, a.z + uz * a.r],
          q: [number, number] = [b.x - ux * b.r, b.z - uz * b.r];
        pts = [p, q, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]];
      } else {
        const t = (s * s + a.r * a.r - b.r * b.r) / (2 * s),
          h = Math.sqrt(Math.max(0, a.r * a.r - t * t));
        pts = [
          [a.x + ux * t - uz * h, a.z + uz * t + ux * h],
          [a.x + ux * t + uz * h, a.z + uz * t - ux * h],
        ];
      }
      assert.ok(
        sealed(pts, [a, b]),
        `(${a.x}, ${a.z}, r ${a.r}) và (${b.x}, ${b.z}, r ${b.r}): khe ${(s - a.r - b.r).toFixed(3)} m`,
      );
    }
});

test("đĩa quanh điểm xuất hiện trống", () => {
  for (const o of obstacles)
    assert.ok(
      Math.hypot(o.x - spawn.x, o.z - spawn.z) - o.r >= SPAWN_CLEAR_RADIUS,
    );
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const p = spawnPoint(() => r);
    assert.equal(insideObstacle(p.x, p.z), undefined);
  }
});

test("điểm tương tác đứng được: trong hang, ngoài mọi vật cản", () => {
  assert.deepEqual(HUB_LANDMARKS.map((l) => l.id).sort(), [
    "altar",
    "checkin",
    "memory",
    "quiz",
    "rest",
    "shop",
    "tv",
  ]);
  for (const l of HUB_LANDMARKS) {
    assert.ok(Math.hypot(l.x, l.z) < radius, l.id);
    assert.equal(insideObstacle(l.x, l.z, 0), undefined, l.id);
    assert.deepEqual(constrain(l.x, l.z), { x: l.x, z: l.z });
  }
});

test("từ điểm xuất hiện đi tới từng điểm tương tác, vòng qua lửa khi tới cửa, không xuyên vật cản", () => {
  for (const r of [0, 0.5, 0.999])
    for (const l of HUB_LANDMARKS) {
      const p = spawnPoint(() => r);
      // The wall door lies behind the campfire. Follow the open right-hand aisle,
      // rather than asserting that a straight line can pass through the fire.
      const route = l.id === "altar" ? [{ x: 4, z: 5 }, { x: 4, z: -7 }, l] : [l];
      let waypoint = 0;
      let near = Infinity;
      for (let i = 0; i < 40 / STEP && near > 0.5; i++) {
        const target = route[waypoint];
        if (Math.hypot(target.x - p.x, target.z - p.z) < 1.2 && waypoint < route.length - 1) waypoint++;
        const dx = route[waypoint].x - p.x,
          dz = route[waypoint].z - p.z,
          len = Math.hypot(dx, dz);
        applyInput(
          p,
          {
            moveX: Math.round((dx / len) * AXIS_MAX),
            moveZ: Math.round((dz / len) * AXIS_MAX),
          },
          STEP,
        );
        // Server lưu float32: điểm trên biên có thể lún ~1e-7 m, bước sau lại bị đẩy ra.
        assert.equal(
          insideObstacle(p.x, p.z, 1e-4),
          undefined,
          `${l.id} bước ${i}`,
        );
        assert.ok(Math.hypot(p.x, p.z) <= radius + 1e-4);
        near = Math.min(near, Math.hypot(l.x - p.x, l.z - p.z));
      }
      assert.ok(near < 3, `${l.id}: chỉ tới gần ${near.toFixed(2)} m`);
    }
});

test("lưới điểm dày: constrain luôn trả điểm trong hang, ngoài vật cản", () => {
  const check = (x: number, z: number) => {
    const p = constrain(x, z);
    assert.ok(
      Math.hypot(p.x, p.z) <= radius + 1e-9,
      `(${x}, ${z}) ra ngoài hang`,
    );
    const o = insideObstacle(p.x, p.z);
    assert.equal(
      o,
      undefined,
      `(${x}, ${z}) -> (${p.x}, ${p.z}) trong vật cản`,
    );
  };
  for (let i = 0; i <= 680; i++)
    for (let j = 0; j <= 680; j++) check(-17 + i * 0.05, -17 + j * 0.05);
  // Điểm khó: tâm vật cản và trung điểm hai tâm của cặp chồng nhau (bị đẩy qua lại dọc đường nối tâm).
  for (const a of obstacles) {
    check(a.x, a.z);
    for (const b of obstacles) check((a.x + b.x) / 2, (a.z + b.z) / 2);
  }
});

test("khối chặn lấn qua biên: điểm kẹt ở góc ra đúng góc, không ra ngoài hang", () => {
  // Vòng tròn chặn tâm ngoài biên (16,4 > sqrt(16² + 1,2²)), lấn vào ~0,8 m.
  const plug = { x: 0, z: -16.4, r: 1.2 };
  const layout: Layout = { ...HUB_LAYOUT, obstacles: [plug] };
  // tol: applyInput lưu float32, điểm trên biên có thể lún ~1e-7 m.
  const free = (p: { x: number; z: number }, tol = 1e-9) =>
    Math.hypot(p.x, p.z) <= layout.radius + tol &&
    Math.hypot(p.x - plug.x, p.z - plug.z) >= plug.r - tol;
  for (let i = 0; i <= 200; i++)
    for (let j = 0; j <= 60; j++) {
      const p = constrain(-3 + i * 0.03, -13.5 - j * 0.07, layout);
      assert.ok(
        free(p),
        `(${-3 + i * 0.03}, ${-13.5 - j * 0.07}) -> (${p.x}, ${p.z})`,
      );
    }
  // Men theo vách vào góc giữa vách và khối chặn: dừng sát góc (vài cm), không lách vào giữa khối và
  // vách; muốn qua thì phải đi vòng phía trong khối chặn như vòng qua một tảng đá.
  const phi = Math.acos(
    (16 * 16 + plug.z * plug.z - plug.r * plug.r) / (2 * 16 * -plug.z),
  );
  const corner = { x: -16 * Math.sin(phi), z: -16 * Math.cos(phi) };
  const p = { x: -5, z: -15.2 };
  for (let k = 0; k < 120; k++) {
    applyInput(p, { moveX: 30, moveZ: -AXIS_MAX }, STEP, layout);
    applyInput(p, { moveX: AXIS_MAX, moveZ: -AXIS_MAX }, STEP, layout);
    assert.ok(free(p, 1e-5), `bước ${k}: (${p.x}, ${p.z})`);
  }
  assert.ok(
    Math.hypot(p.x - corner.x, p.z - corner.z) < 0.06,
    `dừng ở (${p.x}, ${p.z}), góc ở (${corner.x}, ${corner.z})`,
  );
});

test("sau vách ký ức đã bịt: men theo vách từ hai phía không chui ra sau tấm ván", () => {
  const m = HUB_ZONES.memory;
  // Cả dải giữa lưng tấm ván và biên hang nằm trong vật cản.
  for (let lx = -2.2; lx <= 2.2001; lx += 0.2)
    for (let lz = -0.5; lz >= -4; lz -= 0.1) {
      const q = frameToCave(m, lx, lz);
      if (Math.hypot(q.x, q.z) > radius) break;
      assert.ok(
        insideObstacle(q.x, q.z, 0) !== undefined,
        `(${q.x}, ${q.z}) sau tấm ván còn đứng được`,
      );
    }
  const bearing = (x: number, z: number) => Math.atan2(x, z);
  const mid = bearing(m.x, m.z);
  for (const side of [-1, 1]) {
    // Xuất phát sát biên ở một bên vách, đẩy tiếp tuyến về phía tấm ván trong 8 s.
    const a0 = mid + side * 0.42;
    const p = { x: 15.9 * Math.sin(a0), z: 15.9 * Math.cos(a0) };
    assert.equal(insideObstacle(p.x, p.z), undefined);
    for (let k = 0; k < 160; k++) {
      const a = bearing(p.x, p.z);
      const tx = -side * Math.cos(a),
        tz = side * Math.sin(a);
      applyInput(
        p,
        {
          moveX: Math.round((tx + 0.15 * Math.sin(a)) * 100),
          moveZ: Math.round((tz + 0.15 * Math.cos(a)) * 100),
        },
        STEP,
      );
    }
    // Vẫn ở phía mình (dừng ở góc khối chặn), không lọt qua phía sau tấm ván.
    const stayed = (bearing(p.x, p.z) - mid) * side;
    assert.ok(
      stayed > 0.05,
      `bên ${side}: lọt ra sau tấm ván (${stayed.toFixed(3)} rad)`,
    );
  }
});

test("mọi giá trị cần gạt camera (trục lớn = ±127) đi đúng MOVE_SPEED", () => {
  for (let k = -AXIS_MAX; k <= AXIS_MAX; k++)
    for (const [mx, mz] of [
      [AXIS_MAX, k],
      [-AXIS_MAX, k],
      [k, AXIS_MAX],
      [k, -AXIS_MAX],
    ]) {
      const p = { x: 4, z: 6 };
      applyInput(p, { moveX: mx, moveZ: mz }, STEP);
      const d = Math.hypot(p.x - 4, p.z - 6);
      assert.ok(Math.abs(d - MOVE_SPEED * STEP) < 2e-6, `(${mx}, ${mz}): ${d}`);
    }
});

test("dấu vân tay bố cục: tất định và đổi khi vật cản đổi", () => {
  assert.match(HUB_LAYOUT_HASH, /^[0-9a-f]{8}$/);
  assert.equal(HUB_LAYOUT_HASH, layoutHash(HUB_LAYOUT));
  assert.equal(
    layoutHash({ radius, obstacles: [...obstacles] }),
    HUB_LAYOUT_HASH,
  );
  const moved = obstacles.map((o, i) =>
    i === 3 ? { ...o, x: o.x + 0.001 } : o,
  );
  assert.notEqual(layoutHash({ radius, obstacles: moved }), HUB_LAYOUT_HASH);
});

/* ------------------------------------------------- bảng đặt model khớp manifest */

interface ManifestAsset {
  name: string;
  bounds: { min: number[]; max: number[] };
  anchors?: Record<string, number[]>;
  meta?: Record<string, unknown>;
}
const manifests = new Map<string, ManifestAsset>();
for (const g of ["environment", "fire", "furniture", "props", "characters"]) {
  const m = JSON.parse(
    readFileSync(
      new URL(`../apps/web/public/models/manifest.${g}.json`, import.meta.url),
      "utf8",
    ),
  ) as { assets: ManifestAsset[] };
  for (const a of m.assets) manifests.set(`${g}/${a.name}`, a);
}
const asset = (id: string) => {
  const a = manifests.get(id);
  assert.ok(a, `${id} không có trong manifest`);
  return a;
};
const byAsset = (id: string) => HUB_PLACEMENTS.filter((p) => p.asset === id);

test("mọi model trong bảng đặt (và đồ NPC cầm) có trong manifest", () => {
  for (const id of CAVE_SHELL) asset(id);
  for (const p of HUB_PLACEMENTS) {
    asset(p.asset);
    if (p.npc?.hold) asset(p.npc.hold.asset);
  }
});

test("biển cửa hang đứng trên xà khung hầm, trước mặt khung", () => {
  const frame = asset("environment/tl_env_tunnel_frame_v01");
  const signA = asset("furniture/tl_sign_entrance_v01");
  const [f] = byAsset("environment/tl_env_tunnel_frame_v01");
  const [s] = byAsset("furniture/tl_sign_entrance_v01");
  const scale = s.scale ?? 1;
  const lintelTop = (f.y ?? 0) + frame.anchors!.sign[1];
  assert.ok(
    Math.abs((s.y ?? 0) - lintelTop) < 0.05,
    `biển ở ${s.y}, xà ở ${lintelTop}`,
  );
  const frameFront = f.z + frame.bounds.max[2];
  assert.ok(
    s.z + signA.bounds.min[2] * scale >= frameFront,
    "biển lấn vào khung",
  );
});

test("đèn bão treo đúng móc của bạt, bình oxy đúng chỗ ống thở cần", () => {
  const tarp = asset("furniture/tl_furn_tarp_shelter_v01");
  const lantern = asset("fire/tl_fx_lantern_v01");
  const hook = tarp.anchors!.lantern_hook;
  const [t] = byAsset("furniture/tl_furn_tarp_shelter_v01");
  const hookAt = frameToCave(t, hook[0], hook[2]);
  const hung = byAsset("fire/tl_fx_lantern_v01").find(
    (l) => Math.hypot(l.x - hookAt.x, l.z - hookAt.z) < 0.01,
  );
  assert.ok(hung, "không có đèn bão ở móc bạt");
  assert.ok(
    Math.abs((hung.y ?? 0) - (hook[1] - lantern.anchors!.hang[1])) < 0.002,
  );
  // Ống thở vẽ trong hệ trục bình; ghế ở (0,50; 0,05) so với bình (manifest ống thở).
  const [tank] = byAsset("props/tl_prop_oxygen_cylinder_green_v01");
  const [hose] = byAsset("props/tl_prop_oxygen_hose_v01");
  const [chair] = byAsset("props/tl_prop_wooden_chair_v01");
  assert.deepEqual([hose.x, hose.z, hose.yaw], [tank.x, tank.z, tank.yaw]);
  assert.equal(chair.yaw, tank.yaw);
  const want = frameToCave(tank, 0.5, 0.05);
  assert.ok(Math.hypot(chair.x - want.x, chair.z - want.z) < 0.002);
});

test("collider cột bạt khớp poleColliders trong manifest", () => {
  const tarp = asset("furniture/tl_furn_tarp_shelter_v01");
  const poles = tarp.meta!.poleColliders as { a: number[] }[];
  for (const t of byAsset("furniture/tl_furn_tarp_shelter_v01")) {
    assert.equal(t.colliders?.length, poles.length);
    poles.forEach((pole, i) => {
      const c = t.colliders![i];
      assert.ok(
        Math.hypot(c.dx - pole.a[0], c.dz - pole.a[2]) < 0.05,
        `cột ${i}`,
      );
    });
  }
});

test("constrain giữ nguyên điểm đã hợp lệ", () => {
  for (let i = 0; i < 2000; i++) {
    const x = Math.sin(i * 12.9898) * 18,
      z = Math.cos(i * 78.233) * 18;
    const p = constrain(x, z),
      q = constrain(p.x, p.z);
    // Điểm vừa kẹp vào biên có thể lệch 1 ulp khi kẹp lại.
    assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < 1e-9, `(${x}, ${z})`);
  }
});
