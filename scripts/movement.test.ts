import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyInput,
  AXIS_MAX,
  CAVE_CAMERA_MARGIN,
  CAVE_CAMERA_TOP,
  CAVE_SHELL,
  CAVE_SHELL_PIECES,
  Chat,
  constrain,
  frameToCave,
  HUB_CAVES,
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_LAYOUT_HASH,
  HUB_PLACEMENTS,
  HUB_RADIUS,
  HUB_ROOMS,
  HUB_WALKWAYS,
  HUB_ZONES,
  hubObstacles,
  inRooms,
  layoutHash,
  MIN_GAP,
  MOVE_SPEED,
  SIDE_CAVE_RADIUS,
  SIDE_FOCAL_DISTANCE,
  SPAWN_CLEAR_RADIUS,
  spawnPoint,
  TUNNEL_RADIUS,
  WALKWAY_WIDTH,
  type Layout,
  type Obstacle,
  type Room,
  type SideCave,
} from "@te-liet/shared";
import { CAVE_STALL_RADIUS, CAVE_STALLS, stallApproach } from "../packages/shared/src/stalls.js";

const STEP = 0.05;
/** Trong vùng đi được (hợp các phòng), cho phép lệch `tol` m. */
const walkable = (x: number, z: number, tol = 1e-9) => inRooms(x, z, HUB_ROOMS, tol);

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
  // Ngoài mọi hang: kéo về điểm gần nhất của hợp các phòng.
  for (const [x, z] of [
    [20, 20],
    [60, 60],
    [0, -40],
    [-50, 0],
    [25, 0],
  ]) {
    const far = constrain(x, z);
    assert.ok(walkable(far.x, far.z), `(${x}, ${z})`);
  }
  // Hang lớn vẫn là đĩa bán kính 20 m quanh lửa trại: ra khỏi nó ở chỗ không có hầm thì bị giữ lại.
  const south = constrain(0, 30);
  assert.ok(Math.abs(south.x) < 1e-9 && Math.abs(south.z - HUB_RADIUS) < 1e-9);
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
    assert.ok(walkable(p.x, p.z));
  }
});

const { obstacles, radius, spawn } = HUB_LAYOUT;
const rooms = HUB_ROOMS;
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

/** Điểm nằm trong một vật cản khác (không thuộc `skip`). */
const inOther = (x: number, z: number, skip: readonly Obstacle[]) =>
  obstacles.some(
    (c) => !skip.includes(c) && Math.hypot(x - c.x, z - c.z) < c.r - 1e-3,
  );
/**
 * Chỗ thắt giữa hai vật cản (khe hẹp, chỗ chồng nông) được phép nếu mọi điểm thắt nằm trong một vật
 * cản khác (đã bị bịt) hoặc ngoài vùng đi được.
 */
const sealed = (pts: [number, number][], skip: readonly Obstacle[]) =>
  pts.every(([x, z]) => !walkable(x, z, -1e-3) || inOther(x, z, skip));
/**
 * Chỗ thắt giữa một vật cản và biên của phòng `room` được phép nếu mọi điểm thắt nằm trong một vật
 * cản khác, hoặc nằm hẳn trong một phòng khác (chỗ đó không phải biên của vùng đi được).
 */
const sealedAtWall = (pts: [number, number][], o: Obstacle, room: Room) =>
  pts.every(
    ([x, z]) =>
      inOther(x, z, [o]) ||
      rooms.some(
        (k) => k !== room && Math.hypot(x - k.x, z - k.z) < k.r - 1e-3,
      ),
  );

test("vùng đi được: hang lớn, bốn hang nhỏ và bốn đường hầm khớp manifest của vỏ hang", () => {
  assert.equal(HUB_LAYOUT.rooms, HUB_ROOMS);
  assert.equal(radius, HUB_RADIUS);
  assert.deepEqual(
    { x: rooms[0].x, z: rooms[0].z, r: rooms[0].r, id: rooms[0].id },
    { x: 0, z: 0, r: 20, id: "main" },
  );
  // Tâm và bán kính làm tròn 1 mm: mọi engine JS dựng ra cùng một bộ số.
  for (const o of rooms)
    for (const v of [o.x, o.z, o.r])
      assert.equal(Math.round(v * 1000) / 1000, v, `${o.id}`);
  const floor = JSON.parse(
    readFileSync(
      new URL("../apps/web/public/models/manifest.caves.json", import.meta.url),
      "utf8",
    ),
  ).assets.find((a: { name: string }) => a.name === "tl_cave_main_floor_v01").meta as {
    walk: {
      main: { x: number; z: number; r: number };
      sides: { id: string; x: number; z: number; r: number }[];
      tunnels: { id: string; from: { x: number; z: number }; to: { x: number; z: number }; r: number }[];
      cameraMargin: number;
    };
    layout: {
      placements: {
        id: string;
        rotY: number;
        side: { asset: string; at: number[] };
        tunnel: { asset: string; at: number[] };
      }[];
    };
    ceilingAt?: Record<string, { cameraTop: number }>;
  };
  assert.deepEqual(floor.walk.main, { x: 0, z: 0, r: radius });
  assert.equal(floor.walk.cameraMargin, CAVE_CAMERA_MARGIN);
  assert.deepEqual(
    HUB_CAVES.map((c) => c.id),
    floor.walk.sides.map((s) => s.id),
  );
  for (const c of HUB_CAVES) {
    const side = floor.walk.sides.find((s) => s.id === c.id)!;
    assert.deepEqual({ x: side.x, z: side.z, r: side.r }, { x: c.x, z: c.z, r: SIDE_CAVE_RADIUS });
    const room = rooms.find((o) => o.id === c.id)!;
    assert.deepEqual(
      { x: room.x, z: room.z, r: room.r, top: room.top },
      { x: c.x, z: c.z, r: SIDE_CAVE_RADIUS, top: CAVE_CAMERA_TOP.side },
    );
    // Công thức đặt vỏ: yaw = atan2(-u.x, -u.z), đường hầm ở trung điểm hai mặt phẳng miệng hầm.
    const placed = floor.layout.placements.find((p) => p.id === c.id)!;
    assert.equal(c.yaw, placed.rotY);
    assert.ok(Math.abs(c.yaw - (Math.atan2(-c.x, -c.z) * 180) / Math.PI) < 1e-3);
    assert.deepEqual([c.tunnel.x, c.tunnel.z], [placed.tunnel.at[0], placed.tunnel.at[2]]);
    assert.equal(placed.side.asset, `tl_cave_side_${c.variant}_v01`);
    assert.equal(placed.tunnel.asset, `tl_cave_tunnel_${c.variant}_v01`);
    const pieces = CAVE_SHELL_PIECES.filter((p) => p.yaw === c.yaw);
    assert.deepEqual(
      pieces.map((p) => [p.asset, p.x, p.z, p.overhead]),
      [
        [`caves/${placed.tunnel.asset}`, c.tunnel.x, c.tunnel.z, `tl_cave_tunnel_${c.variant}_roof`],
        [`caves/${placed.side.asset}`, c.x, c.z, `tl_cave_side_${c.variant}_ceiling`],
      ],
    );
    // Đường hầm: chuỗi hình tròn r 1,7 m từ trong hang lớn tới trong hang nhỏ, tâm cách nhau ≤ 0,8 m.
    const t = floor.walk.tunnels.find((k) => k.id === c.id)!;
    const chain = rooms.filter((o) => o.id === `tunnel_${c.id}`);
    assert.ok(chain.length >= 14);
    const first = chain[0],
      last = chain[chain.length - 1];
    assert.ok(Math.hypot(first.x - t.from.x, first.z - t.from.z) < 2e-3);
    assert.ok(Math.hypot(last.x - t.to.x, last.z - t.to.z) < 2e-3);
    assert.ok(Math.hypot(first.x, first.z) < radius, "hầm bắt đầu trong hang lớn");
    assert.ok(Math.hypot(last.x - c.x, last.z - c.z) < SIDE_CAVE_RADIUS, "hầm kết thúc trong hang nhỏ");
    for (let i = 0; i < chain.length; i++) {
      assert.equal(chain[i].r, TUNNEL_RADIUS);
      assert.equal(t.r, TUNNEL_RADIUS);
      assert.equal(chain[i].top, CAVE_CAMERA_TOP.tunnel);
      if (i)
        assert.ok(
          Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z) <= 0.8 + 1e-3,
        );
    }
    // Đi dọc tim hầm từ lửa trại tới tâm hang nhỏ không rời vùng đi được.
    for (let i = 0; i <= 400; i++)
      assert.ok(walkable((c.x * i) / 400, (c.z * i) / 400), `${c.id} hở tại ${i / 400}`);
  }
  assert.equal(rooms[0].top, CAVE_CAMERA_TOP.main);
  if (floor.ceilingAt)
    assert.deepEqual(
      [floor.ceilingAt.main.cameraTop, floor.ceilingAt.tunnel.cameraTop, floor.ceilingAt.side.cameraTop],
      [CAVE_CAMERA_TOP.main, CAVE_CAMERA_TOP.tunnel, CAVE_CAMERA_TOP.side],
    );
  assert.equal(rooms.length, 1 + 4 + rooms.filter((o) => o.id?.startsWith("tunnel_")).length);
});

test("mỗi vật cản cách biên ≥ MIN_GAP, hoặc là khối chặn sát vách lấn sâu", () => {
  assert.ok(
    radius <= 22.59 - 2,
    "hang lớn: vách gần nhất 22,59 m; nền chỉ phẳng tới 21 m",
  );
  assert.ok(SIDE_CAVE_RADIUS <= 7.75 - 0.4, "hang nhỏ: vách gần nhất 7,75 m");
  for (const o of obstacles) {
    // Nằm trọn trong một phòng và cách biên phòng đó ≥ MIN_GAP: không có biên nào ở gần.
    if (
      rooms.some(
        (k) => Math.hypot(o.x - k.x, o.z - k.z) + o.r <= k.r - MIN_GAP + 1e-9,
      )
    )
      continue;
    for (const k of rooms) {
      const dx = o.x - k.x,
        dz = o.z - k.z,
        d = Math.hypot(dx, dz);
      if (d - o.r >= k.r - 1e-9) continue; // không chạm phòng này
      // Khối chặn: tâm ngoài biên đủ xa nên góc với biên tù (không thành khe hút người chơi).
      if (d * d >= k.r * k.r + o.r * o.r - 1e-9) continue;
      const ux = dx / d,
        uz = dz / d;
      let pts: [number, number][];
      if (d + o.r < k.r) {
        const m = (d + o.r + k.r) / 2;
        pts = [
          [k.x + ux * (d + o.r), k.z + uz * (d + o.r)],
          [k.x + ux * k.r, k.z + uz * k.r],
          [k.x + ux * m, k.z + uz * m],
        ];
      } else {
        const t = (k.r * k.r + d * d - o.r * o.r) / (2 * d),
          h = Math.sqrt(Math.max(0, k.r * k.r - t * t));
        pts = [
          [k.x + ux * t - uz * h, k.z + uz * t + ux * h],
          [k.x + ux * t + uz * h, k.z + uz * t - ux * h],
        ];
      }
      assert.ok(
        sealedAtWall(pts, o, k),
        `vật cản (${o.x}, ${o.z}, r ${o.r}) để khe ${(k.r - d - o.r).toFixed(3)} m với biên phòng ${k.id}`,
      );
    }
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
    "quest",
    "quiz",
    "rest",
    "screen",
    "shop",
  ]);
  for (const l of HUB_LANDMARKS) {
    assert.ok(walkable(l.x, l.z, -0.05), l.id);
    assert.equal(insideObstacle(l.x, l.z, 0), undefined, l.id);
    assert.deepEqual(constrain(l.x, l.z), { x: l.x, z: l.z });
  }
});

/** Hang nhỏ chứa điểm (x, z), nếu có. */
const caveAt = (x: number, z: number): SideCave | undefined =>
  HUB_CAVES.find((c) => Math.hypot(x - c.x, z - c.z) <= SIDE_CAVE_RADIUS + 1e-6);
/** Điểm trên tim hầm của hang c, cách gốc t m (dịch ngang `lat` m). */
const onAxis = (c: SideCave, t: number, lat = 0) => {
  const d = Math.hypot(c.x, c.z),
    ux = c.x / d,
    uz = c.z / d;
  return { x: ux * t - uz * lat, z: uz * t + ux * lat };
};
/** Vòng đi quanh lửa trại (r = 6,5 m, ngoài hàng ghế): các điểm cách nhau ≤ 30° từ hướng a tới hướng b. */
function ringPath(fromDeg: number, toDeg: number): { x: number; z: number }[] {
  const turn = ((toDeg - fromDeg + 540) % 360) - 180;
  const n = Math.max(1, Math.ceil(Math.abs(turn) / 30));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((fromDeg + (turn * i) / n) * Math.PI) / 180;
    return { x: 6.5 * Math.sin(a), z: 6.5 * Math.cos(a) };
  });
}
/**
 * Lộ trình từ chỗ xuất hiện tới một điểm: theo vòng quanh lửa trại tới lối đi (HUB_WALKWAYS) của
 * đích. Điểm trong hang nhỏ: ra miệng hầm, dọc tim hầm, vào giữa hang nhỏ rồi mới tới đích. Cửa điện
 * thờ: lối sau lửa trại. Điểm khác trong hang lớn: đi thẳng.
 */
function routeTo(target: { x: number; z: number }, id = ""): { x: number; z: number }[] {
  const c = caveAt(target.x, target.z);
  if (c) {
    const bearing = (Math.atan2(c.x, c.z) * 180) / Math.PI;
    return [...ringPath(0, bearing), onAxis(c, 12), onAxis(c, 17), onAxis(c, 24), onAxis(c, 31.5), { x: c.x, z: c.z }, target];
  }
  if (id === "altar") return [...ringPath(0, 180), { x: 0, z: -12 }, target];
  // Màn hình lớn: theo lối ra cửa điện thờ rồi rẽ trái dọc chân vách.
  if (id === "screen") return [...ringPath(0, 180), { x: 0, z: -12 }, { x: -3.5, z: -16.5 }, target];
  return [target];
}
/** Đi theo lộ trình bằng applyInput; trả về khoảng cách gần đích nhất và số bước đã dùng. */
function walkRoute(
  p: { x: number; z: number },
  route: { x: number; z: number }[],
  seconds: number,
  what: string,
) {
  const goal = route[route.length - 1];
  let waypoint = 0,
    near = Infinity,
    steps = 0;
  for (; steps < seconds / STEP && near > 0.5; steps++) {
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
    assert.equal(insideObstacle(p.x, p.z, 1e-4), undefined, `${what} bước ${steps}`);
    assert.ok(walkable(p.x, p.z, 1e-4), `${what} bước ${steps}: (${p.x}, ${p.z}) ngoài vùng đi được`);
    if (waypoint === route.length - 1)
      near = Math.min(near, Math.hypot(goal.x - p.x, goal.z - p.z));
  }
  return { near, steps };
}

test("từ điểm xuất hiện đi tới từng điểm tương tác (qua hầm vào hang nhỏ), rồi quay về lửa trại", () => {
  for (const r of [0, 0.5, 0.999])
    for (const l of HUB_LANDMARKS) {
      const p = spawnPoint(() => r);
      const route = routeTo(l, l.id);
      const out = walkRoute(p, route, 60, l.id);
      assert.ok(out.near < 1, `${l.id}: chỉ tới gần ${out.near.toFixed(2)} m`);
      // Đi bộ ~4 m/s: không mất quá 2,2 lần chiều dài lộ trình.
      let length = Math.hypot(route[0].x, route[0].z - 10);
      for (let i = 1; i < route.length; i++)
        length += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
      assert.ok(
        out.steps * STEP * MOVE_SPEED < 2.2 * length + 8,
        `${l.id}: đi ${(out.steps * STEP * MOVE_SPEED).toFixed(1)} m cho lộ trình ${length.toFixed(1)} m`,
      );
      // Quay về: ngược lộ trình, tới cạnh lửa trại phía người chơi.
      const back = walkRoute(p, [...route.slice(0, -1).reverse(), { x: 0, z: 6.5 }], 60, `${l.id} về`);
      assert.ok(back.near < 1, `${l.id}: về lửa trại chỉ tới gần ${back.near.toFixed(2)} m`);
    }
});

test("chỗ đứng của sạp trong hang nhỏ: vào hang mới thấy nút E, không dính lối hầm", () => {
  for (const c of HUB_CAVES) {
    const stall = CAVE_STALLS.find((s) => s.id === c.stall)!;
    const a = stallApproach(stall);
    assert.equal(caveAt(a.x, a.z)?.id, c.id, `${stall.id} không nằm trong ${c.id}`);
    // Sạp đứng ở tiêu điểm trước hốc đá, quay mặt vào tâm hang (và về phía miệng hang).
    const want = frameToCave({ x: c.x, z: c.z, yaw: c.nicheYaw }, 0, -Math.hypot(stall.x - c.x, stall.z - c.z));
    assert.ok(Math.hypot(want.x - stall.x, want.z - stall.z) < 2e-3, `${stall.id}: lệch khung hốc`);
    assert.ok(Math.abs(stall.yaw - c.nicheYaw) < 1e-3);
    assert.ok(Math.hypot(stall.x - c.x, stall.z - c.z) <= SIDE_FOCAL_DISTANCE + 1e-3);
    const yaw = (stall.yaw * Math.PI) / 180;
    const mouth = onAxis(c, Math.hypot(c.x, c.z) - 8.6);
    const toMouth = Math.hypot(mouth.x - stall.x, mouth.z - stall.z);
    assert.ok(
      ((mouth.x - stall.x) * Math.sin(yaw) + (mouth.z - stall.z) * Math.cos(yaw)) / toMouth > 0.7,
      `${stall.id}: không quay mặt về miệng hang`,
    );
    // Vòng kích hoạt (CAVE_STALL_RADIUS quanh chỗ đứng) cách mọi hình tròn của lối hầm ≥ 1 m.
    for (const k of rooms)
      if (k.id?.startsWith("tunnel_"))
        assert.ok(
          Math.hypot(a.x - k.x, a.z - k.z) - k.r >= CAVE_STALL_RADIUS + 1,
          `${stall.id}: vòng E chạm ${k.id}`,
        );
  }
  // Sạp điểm danh ở lại hang lớn, cạnh chỗ xuất hiện.
  const checkin = stallApproach(CAVE_STALLS[0]);
  assert.ok(Math.hypot(checkin.x, checkin.z) < radius - 1);
  assert.equal(caveAt(checkin.x, checkin.z), undefined);
});

test("lối đi rộng ≥ 2,5 m từ vòng lửa trại ra từng miệng hầm, chỗ xuất hiện và cửa điện thờ", () => {
  assert.deepEqual(HUB_WALKWAYS.map((w) => w.id).sort(), [
    "altar",
    "ne_back",
    "ne_front",
    "nw_back",
    "nw_front",
    "spawn",
  ]);
  assert.ok(WALKWAY_WIDTH >= 2.5);
  for (const w of HUB_WALKWAYS) {
    const d = Math.hypot(w.to.x, w.to.z),
      ux = w.to.x / d,
      uz = w.to.z / d;
    for (const o of obstacles) {
      // Khoảng cách từ vật cản tới đoạn thẳng [r = 5,5 m → đích] trên trục lối đi.
      const t = Math.max(5.5, Math.min(d, o.x * ux + o.z * uz));
      const gap = Math.hypot(o.x - ux * t, o.z - uz * t) - o.r;
      assert.ok(
        gap >= WALKWAY_WIDTH / 2,
        `lối ${w.id}: vật cản (${o.x}, ${o.z}, r ${o.r}) cách trục ${gap.toFixed(2)} m`,
      );
    }
  }
  // Trong hầm không có vật cản nào.
  for (const k of rooms)
    if (k.id?.startsWith("tunnel_"))
      for (const o of obstacles)
        assert.ok(Math.hypot(o.x - k.x, o.z - k.z) >= k.r + o.r, `${k.id}: (${o.x}, ${o.z})`);
});

test("lưới điểm dày: constrain luôn trả điểm trong hợp các phòng, ngoài vật cản", () => {
  const check = (x: number, z: number) => {
    const p = constrain(x, z);
    assert.ok(walkable(p.x, p.z), `(${x}, ${z}) -> (${p.x}, ${p.z}) ra ngoài vùng đi được`);
    const o = insideObstacle(p.x, p.z);
    assert.equal(
      o,
      undefined,
      `(${x}, ${z}) -> (${p.x}, ${p.z}) trong vật cản`,
    );
  };
  // Cả năm hang + đường hầm + một dải ngoài vách (x: ±41, z: ±27,5), bước 7 cm.
  for (let i = 0; i <= 1172; i++)
    for (let j = 0; j <= 786; j++) check(-41 + i * 0.07, -27.5 + j * 0.07);
  // Điểm khó: tâm vật cản và trung điểm hai tâm của cặp chồng nhau (bị đẩy qua lại dọc đường nối tâm),
  // tâm và mép từng hình tròn của hầm, chỗ hầm nối với hang.
  for (const a of obstacles) {
    check(a.x, a.z);
    for (const b of obstacles) check((a.x + b.x) / 2, (a.z + b.z) / 2);
  }
  for (const k of rooms)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      for (const d of [-0.02, 0, 1e-7, 0.02, 0.3])
        check(k.x + (k.r + d) * Math.cos(a), k.z + (k.r + d) * Math.sin(a));
    }
});

test("không kẹt, không rung: đẩy theo 16 hướng từ lưới điểm thì hoặc đi đều, hoặc đứng yên", () => {
  const starts: { x: number; z: number }[] = [];
  for (let x = -40; x <= 40; x += 1.9)
    for (let z = -27; z <= 27; z += 1.9) {
      const p = constrain(x + 0.013, z - 0.007);
      if (Math.hypot(p.x - x, p.z - z) < 1) starts.push({ x: Math.fround(p.x), z: Math.fround(p.z) });
    }
  // Miệng hầm và chỗ hầm nối với hang: hai mép và tim hầm, mỗi 0,6 m.
  for (const c of HUB_CAVES)
    for (let t = 17.5; t <= 32.5; t += 0.6)
      for (const lat of [-1.65, 0, 1.65]) {
        const q = onAxis(c, t, lat),
          p = constrain(q.x, q.z);
        starts.push({ x: Math.fround(p.x), z: Math.fround(p.z) });
      }
  assert.ok(starts.length > 500);
  for (const s of starts)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + 0.11;
      const cmd = {
        moveX: Math.round(Math.sin(a) * AXIS_MAX),
        moveZ: Math.round(Math.cos(a) * AXIS_MAX),
      };
      const p = { ...s };
      const trail: { x: number; z: number }[] = [];
      for (let i = 0; i < 50; i++) {
        applyInput(p, cmd, STEP);
        assert.equal(insideObstacle(p.x, p.z, 1e-4), undefined);
        assert.ok(walkable(p.x, p.z, 1e-4));
        trail.push({ ...p });
      }
      // 10 bước cuối: nếu không tiến được (kẹt ở góc, tì vào vật cản) thì phải đứng yên hẳn, không
      // nhảy qua lại giữa hai điểm.
      const last = trail.slice(-10);
      const net = Math.hypot(last[9].x - last[0].x, last[9].z - last[0].z);
      let path = 0,
        maxStep = 0;
      for (let i = 1; i < last.length; i++) {
        const d = Math.hypot(last[i].x - last[i - 1].x, last[i].z - last[i - 1].z);
        path += d;
        maxStep = Math.max(maxStep, d);
      }
      // Không dịch chuyển tức thời. Kẹp về điểm gần nhất của vùng đi được dời điểm tối đa bằng độ
      // lún (≤ một bước), nên một bước không bao giờ dài quá hai bước thường (xảy ra ở góc lõm giữa
      // hầm và hang: đang trượt dọc vách hầm thì bắt sang vách hang).
      assert.ok(maxStep <= MOVE_SPEED * STEP * 2 + 1e-6, `(${s.x}, ${s.z}) hướng ${k}: bước ${maxStep}`);
      // Quãng đường đi trong 10 bước cuối không dài hơn hẳn độ dời: đứng yên thì đứng hẳn, bò chậm
      // dọc biên thì bò một chiều, không nhảy qua lại giữa hai điểm.
      assert.ok(
        path <= net * 1.6 + 0.02,
        `(${s.x}, ${s.z}) hướng ${k}: rung ${path.toFixed(3)} m, tiến ${net.toFixed(3)} m`,
      );
    }
});

test("men theo vách hang lớn thì trượt vào miệng hầm, qua hầm, sang hang nhỏ và ngược lại", () => {
  for (const c of HUB_CAVES)
    for (const side of [-1, 1]) {
      // Xuất phát sát vách hang lớn, lệch 3,2 m sang một bên miệng hầm; luôn đẩy thẳng về tâm hang nhỏ.
      const start = onAxis(c, 19.4, side * 3.2);
      const p = constrain(start.x, start.z);
      let reached = false;
      for (let i = 0; i < 12 / STEP && !reached; i++) {
        const dx = c.x - p.x,
          dz = c.z - p.z,
          len = Math.hypot(dx, dz);
        applyInput(p, { moveX: Math.round((dx / len) * AXIS_MAX), moveZ: Math.round((dz / len) * AXIS_MAX) }, STEP);
        assert.ok(walkable(p.x, p.z, 1e-4));
        reached = len < 2;
      }
      assert.ok(reached, `${c.id} bên ${side}: không qua được miệng hầm, dừng ở (${p.x}, ${p.z})`);
      // Từ hang nhỏ, men theo vách phía miệng hang rồi đẩy thẳng về lửa trại.
      const d = Math.hypot(c.x, c.z);
      const from = onAxis(c, d - 5.6, side * 3.6);
      const q = constrain(from.x, from.z);
      let home = false;
      for (let i = 0; i < 14 / STEP && !home; i++) {
        const len = Math.hypot(q.x, q.z);
        applyInput(q, { moveX: Math.round((-q.x / len) * AXIS_MAX), moveZ: Math.round((-q.z / len) * AXIS_MAX) }, STEP);
        assert.ok(walkable(q.x, q.z, 1e-4));
        assert.equal(insideObstacle(q.x, q.z, 1e-4), undefined);
        home = len < 16;
      }
      assert.ok(home, `${c.id} bên ${side}: không ra được hang lớn, dừng ở (${q.x}, ${q.z})`);
    }
});

test("khối chặn lấn qua biên: điểm kẹt ở góc ra đúng góc, không ra ngoài hang", () => {
  for (const multi of [false, true]) {
    // Bố cục một đĩa (đảo điện thờ, bố cục cũ) và bố cục nhiều phòng: cùng một hành vi ở vách hang lớn.
    const R = multi ? radius : 16;
    // Vòng tròn chặn tâm ngoài biên (R + 0,4 > sqrt(R² + 1,2²)), lấn vào ~0,8 m.
    const plug = { x: 0, z: R + 0.4, r: 1.2 };
    const layout: Layout = multi
      ? { ...HUB_LAYOUT, obstacles: [plug] }
      : { radius: R, obstacles: [plug], spawn: HUB_LAYOUT.spawn };
    // tol: applyInput lưu float32, điểm trên biên có thể lún ~1e-7 m.
    const free = (p: { x: number; z: number }, tol = 1e-9) =>
      (multi ? walkable(p.x, p.z, tol) : Math.hypot(p.x, p.z) <= R + tol) &&
      Math.hypot(p.x - plug.x, p.z - plug.z) >= plug.r - tol;
    for (let i = 0; i <= 200; i++)
      for (let j = 0; j <= 60; j++) {
        const p = constrain(-3 + i * 0.03, R - 2.5 + j * 0.07, layout);
        assert.ok(
          free(p),
          `(${-3 + i * 0.03}, ${R - 2.5 + j * 0.07}) -> (${p.x}, ${p.z})`,
        );
      }
    // Men theo vách vào góc giữa vách và khối chặn: dừng sát góc (vài cm), không lách vào giữa khối và
    // vách; muốn qua thì phải đi vòng phía trong khối chặn như vòng qua một tảng đá.
    const phi = Math.acos(
      (R * R + plug.z * plug.z - plug.r * plug.r) / (2 * R * plug.z),
    );
    const corner = { x: -R * Math.sin(phi), z: R * Math.cos(phi) };
    const p = { x: -5, z: R - 0.8 };
    for (let k = 0; k < 120; k++) {
      applyInput(p, { moveX: 30, moveZ: AXIS_MAX }, STEP, layout);
      applyInput(p, { moveX: AXIS_MAX, moveZ: AXIS_MAX }, STEP, layout);
      assert.ok(free(p, 1e-5), `bước ${k}: (${p.x}, ${p.z})`);
    }
    assert.ok(
      Math.hypot(p.x - corner.x, p.z - corner.z) < 0.06,
      `dừng ở (${p.x}, ${p.z}), góc ở (${corner.x}, ${corner.z})`,
    );
  }
});

test("sau vách ký ức đã bịt: men theo vách hang nhỏ từ hai phía không chui ra sau tấm ván", () => {
  const m = HUB_ZONES.memory;
  const cave = HUB_CAVES.find((c) => c.stall === "memory")!;
  // Cả dải sau lưng tấm ván (trong hang nhỏ) nằm trong vật cản.
  for (let lx = -2.2; lx <= 2.2001; lx += 0.2)
    for (let lz = -0.5; lz >= -4; lz -= 0.1) {
      const q = frameToCave(m, lx, lz);
      if (!walkable(q.x, q.z, 0)) break;
      assert.ok(
        insideObstacle(q.x, q.z, 0) !== undefined,
        `(${q.x}, ${q.z}) sau tấm ván còn đứng được`,
      );
    }
  const bearing = (x: number, z: number) => Math.atan2(x - cave.x, z - cave.z);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const mid = bearing(m.x, m.z);
  for (const side of [-1, 1]) {
    // Xuất phát sát vách hang nhỏ ở một bên tấm ván, đẩy tiếp tuyến về phía tấm ván trong 8 s.
    const a0 = mid + side * 0.75;
    const p = {
      x: cave.x + 6.9 * Math.sin(a0),
      z: cave.z + 6.9 * Math.cos(a0),
    };
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
      assert.ok(walkable(p.x, p.z, 1e-4));
      // Trong hệ trục tấm ván (mặt trước ở z = +0,43): không bao giờ đứng ngang hoặc sau mặt ván. Đi
      // vòng qua trước mặt ván thì được.
      const dx = p.x - m.x,
        dz = p.z - m.z,
        c = Math.cos((m.yaw * Math.PI) / 180),
        n = Math.sin((m.yaw * Math.PI) / 180);
      const lx = dx * c - dz * n,
        lz = dx * n + dz * c;
      assert.ok(
        Math.abs(lx) > 2.2 || lz > 0.45,
        `bên ${side} bước ${k}: (${lx.toFixed(2)}, ${lz.toFixed(2)}) lọt ra sau mặt ván`,
      );
    }
    // Đã rời chỗ xuất phát (trượt dọc vách tới tấm ván hoặc vòng qua trước mặt nó), không kẹt giữa chừng.
    assert.ok(Math.abs(wrap(bearing(p.x, p.z) - a0)) > 0.3, `bên ${side}: kẹt gần chỗ xuất phát`);
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

test("dấu vân tay bố cục: tất định, đổi khi vật cản hoặc phòng đổi, bố cục một đĩa giữ nguyên", () => {
  assert.match(HUB_LAYOUT_HASH, /^[0-9a-f]{8}$/);
  assert.equal(HUB_LAYOUT_HASH, layoutHash(HUB_LAYOUT));
  assert.equal(
    layoutHash({ radius, obstacles: [...obstacles], rooms: [...rooms] }),
    HUB_LAYOUT_HASH,
  );
  const moved = obstacles.map((o, i) =>
    i === 3 ? { ...o, x: o.x + 0.001 } : o,
  );
  assert.notEqual(layoutHash({ radius, obstacles: moved, rooms }), HUB_LAYOUT_HASH);
  // Phòng cũng nằm trong dấu vân tay: dời một hình tròn của hầm 1 mm, bỏ một phòng, hoặc bỏ hết.
  const shifted = rooms.map((o, i) => (i === 9 ? { ...o, z: o.z + 0.001 } : o));
  assert.notEqual(layoutHash({ radius, obstacles, rooms: shifted }), HUB_LAYOUT_HASH);
  assert.notEqual(layoutHash({ radius, obstacles, rooms: rooms.slice(0, -1) }), HUB_LAYOUT_HASH);
  assert.notEqual(layoutHash({ radius, obstacles }), HUB_LAYOUT_HASH);
  // Bố cục một đĩa (không có rooms): đúng công thức cũ, FNV-1a trên "bán kính, x, z, r, …".
  const disc = { radius: 8, obstacles: [{ x: 0, z: 0, r: 1.2 }, { x: 3.5, z: -2, r: 0.75 }] };
  const text = [8, 0, 0, 1.2, 3.5, -2, 0.75].map((v) => v.toFixed(3)).join(",");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  assert.equal(layoutHash(disc), h.toString(16).padStart(8, "0"));
});

/* ------------------------------------------------- bố cục một đĩa: hành vi cũ giữ nguyên */

/**
 * Bản sao thuật toán constrain() trước khi có nhiều phòng (một đĩa quanh gốc), để chứng minh bố cục
 * không có `rooms` (đảo điện thờ, test) cho kết quả trùng từng bit với trước đây.
 */
function legacyConstrain(x: number, z: number, layout: { radius: number; obstacles: readonly Obstacle[] }) {
  const SKIN = 1e-9;
  const { obstacles: obs, radius: R } = layout;
  const inside = (px: number, pz: number, o: Obstacle) =>
    Math.sqrt((px - o.x) * (px - o.x) + (pz - o.z) * (pz - o.z)) < o.r - SKIN;
  const insideAny = (px: number, pz: number) => obs.some((o) => inside(px, pz, o));
  const isFree = (px: number, pz: number) => Math.sqrt(px * px + pz * pz) <= R + SKIN && !insideAny(px, pz);
  const pushOut = (p: { x: number; z: number }) => {
    let moved = false;
    for (const o of obs) {
      const ox = p.x - o.x,
        oz = p.z - o.z,
        d = Math.sqrt(ox * ox + oz * oz);
      if (d >= o.r - SKIN) continue;
      moved = true;
      if (d === 0) {
        p.x = o.x;
        p.z = o.z - o.r;
      } else {
        p.x = o.x + (ox / d) * o.r;
        p.z = o.z + (oz / d) * o.r;
      }
    }
    return moved;
  };
  const crossings = (
    ax: number,
    az: number,
    ar: number,
    bx: number,
    bz: number,
    br: number,
    consider: (x: number, z: number) => void,
  ) => {
    const s = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (s === 0 || s >= ar + br) return;
    const t = (s * s + ar * ar - br * br) / (2 * s),
      h2 = ar * ar - t * t;
    if (!(h2 > 0)) return;
    const h = Math.sqrt(h2),
      ex = (bx - ax) / s,
      ez = (bz - az) / s;
    consider(ax + ex * t - ez * h, az + ez * t + ex * h);
    consider(ax + ex * t + ez * h, az + ez * t - ex * h);
  };
  const within = (reach: number) => {
    const near: Obstacle[] = [];
    for (const o of obs) {
      const d = Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z));
      if (Math.abs(d - o.r) <= reach) near.push(o);
    }
    const dc = Math.sqrt(x * x + z * z);
    const edge = Math.abs(dc - R) <= reach;
    let best: { x: number; z: number } | null = null,
      bestD = reach === Infinity ? Infinity : reach * reach;
    const consider = (px: number, pz: number) => {
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d > bestD || (best && d === bestD)) return;
      if (!isFree(px, pz)) return;
      best = { x: px, z: pz };
      bestD = d;
    };
    for (const o of near) {
      const ox = x - o.x,
        oz = z - o.z,
        d = Math.sqrt(ox * ox + oz * oz);
      if (d === 0) consider(o.x, o.z - o.r);
      else consider(o.x + (ox / d) * o.r, o.z + (oz / d) * o.r);
    }
    if (edge) {
      if (dc === 0) consider(0, -R);
      else consider((x / dc) * R, (z / dc) * R);
    }
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      for (let j = i + 1; j < near.length; j++) {
        const b = near[j];
        crossings(a.x, a.z, a.r, b.x, b.z, b.r, consider);
      }
      if (edge) crossings(0, 0, R, a.x, a.z, a.r, consider);
    }
    return best as { x: number; z: number } | null;
  };
  const nearestFree = () => within(1) ?? within(Infinity);
  let p = { x, z };
  let settled = false;
  for (let pass = 0; pass < 4 && !settled; pass++) settled = !pushOut(p);
  if (!settled && insideAny(p.x, p.z)) p = nearestFree() ?? p;
  const d = Math.sqrt(p.x * p.x + p.z * p.z);
  if (d > R) {
    p.x = (p.x / d) * R;
    p.z = (p.z / d) * R;
  }
  pushOut(p);
  if (!isFree(p.x, p.z)) p = nearestFree() ?? p;
  return p;
}

test("bố cục một đĩa (không có rooms): constrain trùng từng bit với thuật toán trước khi có hang nhỏ", () => {
  const layouts: Layout[] = [
    // Đảo điện thờ (packages/shared/src/shrine.ts).
    { radius: 8, obstacles: [{ x: 0, z: 0, r: 1.2 }], spawn: { x: 0, z: 6.8, spread: 0 } },
    // Hang một đĩa với vật cản chồng nhau, khối chặn sát vách và khe hẹp.
    {
      radius: 16,
      obstacles: [
        { x: 0, z: 0, r: 1.6 },
        { x: 0, z: -16.4, r: 1.2 },
        { x: -6.9, z: -13.6, r: 1.35 },
        { x: -5.7, z: -13, r: 1.35 },
        { x: -4.5, z: -12.4, r: 1.35 },
        { x: -7.2, z: -15.6, r: 1.4 },
        { x: 9, z: -5.5, r: 0.55 },
        { x: 9.3, z: -4.9, r: 0.55 },
        { x: 15.8, z: 3, r: 0.75 },
        { x: 3, z: 3, r: 0.6 },
        { x: 3.9, z: 3.2, r: 0.5 },
      ],
      spawn: { x: 0, z: 10, spread: 1.5 },
    },
  ];
  for (const layout of layouts) {
    const R = layout.radius + 1.5;
    let n = 0;
    for (let x = -R; x <= R; x += 0.083)
      for (let z = -R; z <= R; z += 0.079) {
        const a = constrain(x, z, layout),
          b = legacyConstrain(x, z, layout);
        assert.ok(Object.is(a.x, b.x) && Object.is(a.z, b.z), `(${x}, ${z}): (${a.x}, ${a.z}) != (${b.x}, ${b.z})`);
        n++;
      }
    for (const o of layout.obstacles)
      for (const q of layout.obstacles) {
        const x = (o.x + q.x) / 2,
          z = (o.z + q.z) / 2;
        assert.deepEqual(constrain(x, z, layout), legacyConstrain(x, z, layout));
      }
    assert.ok(n > 10_000);
  }
});

/* ------------------------------------------------- bảng đặt model khớp manifest */

interface ManifestAsset {
  name: string;
  bounds: { min: number[]; max: number[] };
  anchors?: Record<string, number[]>;
  meta?: Record<string, unknown>;
}
const manifests = new Map<string, ManifestAsset>();
for (const g of ["caves", "environment", "fire", "furniture", "props", "characters"]) {
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
  for (const p of CAVE_SHELL_PIECES) {
    const a = asset(p.asset);
    // Node trần / vòm hầm (ẩn khi nhìn từ trên xuống) có thật trong GLB.
    if (typeof p.overhead === "string")
      assert.ok((a as { nodes?: string[] }).nodes?.includes(p.overhead), `${p.asset}: node ${p.overhead}`);
  }
  assert.equal(CAVE_SHELL_PIECES.length, CAVE_SHELL.length + 2 * HUB_CAVES.length);
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
    const x = Math.sin(i * 12.9898) * 41,
      z = Math.cos(i * 78.233) * 27;
    const p = constrain(x, z),
      q = constrain(p.x, p.z);
    // Điểm vừa kẹp vào biên có thể lệch 1 ulp khi kẹp lại.
    assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < 1e-9, `(${x}, ${z})`);
  }
});
