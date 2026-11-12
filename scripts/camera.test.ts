import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyInput,
  AXIS_MAX,
  CAVE_CAMERA_MARGIN,
  CAVE_CAMERA_TOP,
  constrain,
  HUB_CAVES,
  HUB_LAYOUT,
  HUB_ROOMS,
  inRooms,
  MOVE_SPEED,
} from "@te-liet/shared";
import {
  CAVE_BOUNDS,
  ceilingAt,
  clearLine,
  containBoom,
  DEG,
  fitFov,
  lookDir,
  outsideBlockers,
  shoulderShift,
  springStep,
  stepBoom,
  stickToWorld,
  wrapDeg,
  type CameraBounds,
  type V3,
} from "../apps/web/src/cameraMath.js";

/** Hình trụ quanh gốc (đảo điện thờ dùng dạng này, dời tâm): không có rooms. */
const CYLINDER: CameraBounds = { maxRadius: 16.8, minY: 0.6, maxY: 9 };

const M = AXIS_MAX;
const len = (a: { moveX: number; moveZ: number }) => Math.hypot(a.moveX, a.moveZ);

test("tiến (W) đi theo hướng camera nhìn: yaw 0 / 90 / 180 / -45", () => {
  assert.deepEqual(stickToWorld(0, 0, 1), { moveX: 0, moveZ: M });
  assert.deepEqual(stickToWorld(90, 0, 1), { moveX: M, moveZ: 0 });
  assert.deepEqual(stickToWorld(180, 0, 1), { moveX: 0, moveZ: -M });
  assert.deepEqual(stickToWorld(-45, 0, 1), { moveX: -M, moveZ: M });
  assert.deepEqual(stickToWorld(0, 0, -1), { moveX: 0, moveZ: -M });
});

test("đi ngang (A/D) vuông góc với hướng nhìn, sang phải màn hình", () => {
  // yaw 180 looks toward -Z: screen right is +X (the old fixed camera's convention)
  assert.deepEqual(stickToWorld(180, 1, 0), { moveX: M, moveZ: 0 });
  assert.deepEqual(stickToWorld(180, -1, 0), { moveX: -M, moveZ: 0 });
  // yaw 0 looks toward +Z: screen right is -X
  assert.deepEqual(stickToWorld(0, 1, 0), { moveX: -M, moveZ: 0 });
  assert.deepEqual(stickToWorld(90, 1, 0), { moveX: 0, moveZ: M });
});

test("đi chéo: cả hai trục đầy, ở mọi yaw độ dài >= AXIS_MAX", () => {
  assert.deepEqual(stickToWorld(180, 1, 1), { moveX: M, moveZ: -M });
  assert.deepEqual(stickToWorld(0, -1, 1), { moveX: M, moveZ: M });
  assert.deepEqual(stickToWorld(45, 0, 1), { moveX: M, moveZ: M });
  for (let yaw = -180; yaw <= 180; yaw += 7.5)
    for (const [r, f] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
      [0.3, -0.8],
      [0.01, 0],
    ]) {
      const a = stickToWorld(yaw, r, f);
      assert.ok(Number.isInteger(a.moveX) && Number.isInteger(a.moveZ));
      assert.ok(Math.abs(a.moveX) <= M && Math.abs(a.moveZ) <= M);
      assert.ok(Math.max(Math.abs(a.moveX), Math.abs(a.moveZ)) === M, `yaw ${yaw} (${r}, ${f})`);
      assert.ok(len(a) >= M);
      // direction kept within the int8 rounding error
      const want = Math.atan2(
        -Math.cos(yaw * (Math.PI / 180)) * r + Math.sin(yaw * (Math.PI / 180)) * f,
        Math.sin(yaw * (Math.PI / 180)) * r + Math.cos(yaw * (Math.PI / 180)) * f,
      );
      const got = Math.atan2(a.moveX, a.moveZ);
      const err = Math.abs(((got - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      assert.ok(err < 0.006, `direction yaw ${yaw}: ${err}`);
    }
});

test("không bấm, hoặc hai phím ngược nhau, là đứng yên (không có -0)", () => {
  for (const yaw of [0, 33, 180, -90]) {
    const z = stickToWorld(yaw, 0, 0);
    assert.ok(Object.is(z.moveX, 0) && Object.is(z.moveZ, 0));
    const right = 1 - 1,
      fwd = 1 - 1;
    assert.deepEqual(stickToWorld(yaw, right, fwd), { moveX: 0, moveZ: 0 });
  }
  assert.deepEqual(stickToWorld(10, Number.NaN, 1), { moveX: 0, moveZ: 0 });
  // a single axis that rounds the other to 0 must give +0, never -0
  const a = stickToWorld(180, 0, 1);
  assert.ok(Object.is(a.moveX, 0));
});

test("trục đã lượng tử hoá luôn đi đủ tốc độ trong applyInput", () => {
  for (let yaw = -180; yaw < 180; yaw += 15) {
    const p = { x: 0, z: 9 };
    applyInput(p, stickToWorld(yaw, 0.2, 0.4), 0.05);
    assert.ok(Math.abs(Math.hypot(p.x, p.z - 9) - MOVE_SPEED * 0.05) < 1e-4, `yaw ${yaw}`);
  }
});

test("lookDir: yaw θ nhìn theo (sin θ, ·, cos θ), pitch dương nhìn xuống", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  lookDir(180, 0, d);
  assert.ok(Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12 && Math.abs(d.z + 1) < 1e-12);
  lookDir(90, 30, d);
  assert.ok(Math.abs(d.x - Math.cos(Math.PI / 6)) < 1e-12 && Math.abs(d.y + 0.5) < 1e-12);
  assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-12);
});

test("containBoom (hình trụ): camera không ra ngoài hình trụ 16,8 m, rút cần về phía mục tiêu", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  // centre of the cylinder: nothing in the way
  assert.equal(containBoom({ x: 0, y: 1.3, z: 0 }, lookDir(30, 14, d), 5.5, CYLINDER), 5.5);
  // player at r = 16 looking inward (camera pushed outward): boom ~0.8 m
  for (const yawDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const a = (yawDeg * Math.PI) / 180;
    const pivot = { x: -Math.sin(a) * 16, y: 1.3, z: -Math.cos(a) * 16 };
    lookDir(yawDeg, 14, d);
    const b = containBoom(pivot, d, 5.5, CYLINDER);
    const cx = pivot.x - d.x * b,
      cz = pivot.z - d.z * b;
    assert.ok(Math.hypot(cx, cz) <= CYLINDER.maxRadius + 1e-9);
    assert.ok(Math.abs(Math.hypot(cx, cz) - CYLINDER.maxRadius) < 1e-6, "touches the limit");
    assert.ok(b > 0.75 && b < 0.9, `boom ${b}`);
  }
  // sideways along the wall: partially shortened, still inside
  const pivot = { x: 16, y: 1.3, z: 0 };
  const b = containBoom(pivot, lookDir(0, 14, d), 8, CYLINDER);
  assert.ok(b < 8 && b > 1);
  assert.ok(Math.hypot(pivot.x - d.x * b, pivot.z - d.z * b) <= 16.8 + 1e-9);
});

test("containBoom (hình trụ): giữ độ cao camera trong [0,6; 9] m", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const pivot = { x: 0, y: 1.3, z: 0 };
  // steep top-down view: capped by the 9 m ceiling limit
  let b = containBoom(pivot, lookDir(0, 60, d), 8, CYLINDER);
  assert.ok(Math.abs(pivot.y - d.y * b - 9) < 1e-9 || pivot.y - d.y * b < 9);
  assert.ok(pivot.y - d.y * b <= 9 + 1e-9);
  // looking up from a low pivot: capped by the floor limit
  b = containBoom({ x: 0, y: 0.9, z: 0 }, lookDir(0, -5, d), 8, CYLINDER);
  assert.ok(0.9 - d.y * b >= 0.6 - 1e-9);
  assert.ok(b < 8);
  // pivot already beyond the radius: some slack, never negative
  b = containBoom({ x: 17.2, y: 1.3, z: 0 }, lookDir(-90, 14, d), 5.5, CYLINDER);
  assert.ok(b >= 0 && b < 0.5);
});

/* ------------------------------------------------- hang nhiều phòng (CAVE_BOUNDS.rooms) */

const MARGIN = CAVE_CAMERA_MARGIN;
/** Điểm camera của cần b. */
const camAt = (pivot: V3, d: V3, b: number): V3 => ({ x: pivot.x - d.x * b, y: pivot.y - d.y * b, z: pivot.z - d.z * b });
/** Điểm trên tim hầm của hang c, cách gốc t m (dịch ngang lat m). */
const onAxis = (c: { x: number; z: number }, t: number, lat = 0) => {
  const len = Math.hypot(c.x, c.z),
    ux = c.x / len,
    uz = c.z / len;
  return { x: ux * t - uz * lat, z: uz * t + ux * lat };
};

test("CAVE_BOUNDS: các phòng đi được + 0,6 m, trần 9 / 2,6 / 3,2 m theo phòng", () => {
  assert.equal(CAVE_BOUNDS.rooms, HUB_ROOMS);
  assert.equal(CAVE_BOUNDS.roomMargin, 0.6);
  assert.equal(CAVE_BOUNDS.minY, 0.6);
  assert.equal(ceilingAt(0, 0, CAVE_BOUNDS), CAVE_CAMERA_TOP.main);
  assert.equal(ceilingAt(0, 20.5, CAVE_BOUNDS), 9);
  for (const c of HUB_CAVES) {
    assert.equal(ceilingAt(c.x, c.z, CAVE_BOUNDS), CAVE_CAMERA_TOP.side);
    const mid = onAxis(c, 25);
    assert.equal(ceilingAt(mid.x, mid.z, CAVE_BOUNDS), CAVE_CAMERA_TOP.tunnel);
    // chỗ hầm chồng lên hang lớn: trần của hang lớn (phòng cao nhất chứa điểm đó)
    const mouth = onAxis(c, 20.3);
    assert.equal(ceilingAt(mouth.x, mouth.z, CAVE_BOUNDS), 9);
  }
  // hình trụ (không có rooms): một trần chung
  assert.equal(ceilingAt(3, 4, CYLINDER), 9);
});

test("clearLine: bảng tên chỉ hiện khi không có vách đá giữa camera và người chơi", () => {
  const rooms = HUB_ROOMS;
  // trong cùng hang lớn
  assert.equal(clearLine(0, 8, -12, -9, rooms, MARGIN), true);
  assert.equal(clearLine(3, 3, 3, 3, rooms, MARGIN), true);
  for (const cave of HUB_CAVES) {
    const len = Math.hypot(cave.x, cave.z);
    // dọc tim hầm: từ lửa trại nhìn thấu tới giữa hang nhỏ
    assert.equal(clearLine(0, 0, cave.x, cave.z, rooms, MARGIN), true, cave.id);
    // từ giữa hang lớn (lệch khỏi trục hầm) tới người đứng sâu trong hang nhỏ, lệch trục: bị vách che
    const deep = onAxis(cave, len + 1, -4),
      viewer = onAxis(cave, 6, 12);
    assert.equal(clearLine(viewer.x, viewer.z, deep.x, deep.z, rooms, MARGIN), false, cave.id);
    assert.equal(clearLine(deep.x, deep.z, viewer.x, viewer.z, rooms, MARGIN), false, cave.id);
    // hai hang nhỏ khác nhau không thấy nhau, trừ hai hang đối xứng qua lửa trại (hai hầm thẳng hàng:
    // nhìn thấu từ hầm này qua hang lớn sang hầm kia)
    for (const other of HUB_CAVES)
      if (other !== cave)
        assert.equal(
          clearLine(cave.x, cave.z, other.x, other.z, rooms, MARGIN),
          other.x === -cave.x && other.z === -cave.z,
          `${cave.id} - ${other.id}`,
        );
    // người đứng sát vách hang lớn cạnh miệng hầm không thấy người trong hang nhỏ sau vách
    const beside = onAxis(cave, 19.5, 6);
    const hidden = onAxis(cave, len - 2, 5.5);
    assert.equal(clearLine(beside.x, beside.z, hidden.x, hidden.z, rooms, MARGIN), false, cave.id);
  }
});

test("containBoom (phòng): sát vách hang lớn và hang nhỏ, camera dừng cách biên đi được 0,6 m", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  assert.equal(containBoom({ x: 0, y: 1.3, z: 0 }, lookDir(30, 14, d), 5.5), 5.5);
  // hang lớn: đứng ở r = 20 nhìn vào tâm (các hướng không có miệng hầm)
  for (const yawDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const a = (yawDeg * Math.PI) / 180;
    const pivot = { x: -Math.sin(a) * 20, y: 1.3, z: -Math.cos(a) * 20 };
    lookDir(yawDeg, 14, d);
    const b = containBoom(pivot, d, 5.5);
    const c = camAt(pivot, d, b);
    assert.ok(Math.abs(Math.hypot(c.x, c.z) - (20 + MARGIN)) < 1e-6, `yaw ${yawDeg}: r ${Math.hypot(c.x, c.z)}`);
    assert.ok(b > 0.55 && b < 0.7, `boom ${b}`);
  }
  // hang nhỏ: đứng sát vách xa miệng hang, nhìn về tâm hang
  for (const cave of HUB_CAVES) {
    const out = onAxis(cave, Math.hypot(cave.x, cave.z) + 7);
    const yawDeg = (Math.atan2(cave.x - out.x, cave.z - out.z) * 180) / Math.PI;
    lookDir(yawDeg, 14, d);
    const pivot = { x: out.x, y: 1.3, z: out.z };
    const b = containBoom(pivot, d, 5.5);
    const c = camAt(pivot, d, b);
    assert.ok(Math.abs(Math.hypot(c.x - cave.x, c.z - cave.z) - (7 + MARGIN)) < 1e-6);
    assert.ok(c.y <= CAVE_CAMERA_TOP.side + 1e-9);
  }
});

test("containBoom (phòng): trần riêng từng phòng: 9 m hang lớn, 3,2 m hang nhỏ, 2,6 m trong hầm", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  lookDir(0, 60, d);
  let b = containBoom({ x: 0, y: 1.3, z: 0 }, d, 8);
  assert.ok(Math.abs(1.3 - d.y * b - 9) < 1e-9 || b === 8);
  for (const cave of HUB_CAVES) {
    // giữa hang nhỏ, nhìn chúc xuống: camera lên tới 3,2 m rồi dừng
    const pivot = { x: cave.x, y: 1.3, z: cave.z };
    b = containBoom(pivot, lookDir(cave.yaw, 60, d), 8);
    assert.ok(Math.abs(pivot.y - d.y * b - CAVE_CAMERA_TOP.side) < 1e-9, `${cave.id}: ${pivot.y - d.y * b}`);
    // giữa hầm, nhìn dọc hầm về phía hang nhỏ, chúc xuống: 2,6 m
    const mid = onAxis(cave, 25.5);
    const p2 = { x: mid.x, y: 1.3, z: mid.z };
    b = containBoom(p2, lookDir(cave.yaw + 180, 40, d), 8);
    assert.ok(Math.abs(p2.y - d.y * b - CAVE_CAMERA_TOP.tunnel) < 1e-9, `${cave.id} hầm: ${p2.y - d.y * b}`);
    // nhìn ngang qua hầm: vách hầm cách tim 1,7 + 0,6 m
    b = containBoom(p2, lookDir(cave.yaw + 90, 0, d), 8);
    assert.ok(Math.abs(b - (1.7 + MARGIN)) < 0.06, `${cave.id} ngang hầm: ${b}`);
  }
  // sàn: nhìn ngước lên thì camera hạ xuống, dừng ở 0,6 m
  b = containBoom({ x: 0, y: 0.9, z: 0 }, lookDir(0, -5, d), 8);
  assert.ok(0.9 - d.y * b >= 0.6 - 1e-9 && b < 8);
});

test("containBoom (phòng): cần đi xuyên chỗ nối hầm với hang, không nhảy qua khe đá", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  for (const cave of HUB_CAVES) {
    const len = Math.hypot(cave.x, cave.z);
    // đứng trong hang nhỏ ngay cửa hầm, nhìn vào hang: camera lùi dọc hầm, đủ cần
    const inSide = onAxis(cave, len - 6.2);
    let pivot: V3 = { x: inSide.x, y: 1.3, z: inSide.z };
    let b = containBoom(pivot, lookDir(cave.yaw + 180, 6, d), 5.5);
    assert.equal(b, 5.5, `${cave.id}: ${b}`);
    // đứng giữa hầm nhìn về hang nhỏ, camera lùi ra hang lớn: qua chỗ nối rồi lên cao được (trần 9 m)
    const mid = onAxis(cave, 23);
    pivot = { x: mid.x, y: 1.3, z: mid.z };
    b = containBoom(pivot, lookDir(cave.yaw + 180, 18, d), 8);
    const c = camAt(pivot, d, b);
    assert.ok(b > 4, `${cave.id}: ${b}`);
    assert.ok(c.y <= ceilingAt(c.x, c.z, CAVE_BOUNDS) + 1e-9);
    // đứng trong hang lớn cạnh miệng hầm, camera lùi chéo vào vách đá cạnh miệng hầm: dừng ở vách,
    // không nhảy sang hang nhỏ ở phía sau
    const beside = onAxis(cave, 19.2, 4.5);
    pivot = { x: beside.x, y: 1.3, z: beside.z };
    const yawOut = (Math.atan2(-cave.x, -cave.z) * 180) / Math.PI;
    b = containBoom(pivot, lookDir(yawOut, 5, d), 8);
    assert.ok(b < 2.2, `${cave.id}: ${b}`);
  }
});

test("containBoom (phòng): pivot lệch ra ngoài biên (lệch vai sát vách) không làm cần sụp về 0", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  // pivot ở r = 20,75 (ngoài 20,6): nhìn dọc vách thì camera vẫn lùi được một đoạn dọc vách (dây
  // cung của vòng 20,6 m từ điểm cách biên 1 cm dài ~0,64 m)
  const pivot = { x: 0, y: 1.3, z: 20.75 };
  const b = containBoom(pivot, lookDir(90, 14, d), 5.5);
  assert.ok(b > 0.6 && b < 0.75, `boom ${b}`);
  // nhìn chếch ra ngoài 30° (camera lùi vào trong hang): đủ cần
  assert.equal(containBoom(pivot, lookDir(30, 14, d), 5.5), 5.5);
  const c = camAt(pivot, d, b);
  assert.ok(inRooms(c.x, c.z, HUB_ROOMS, MARGIN + 0.16));
  // nhìn vào tâm (camera bị đẩy ra ngoài): cần bằng 0, không âm
  assert.ok(containBoom(pivot, lookDir(180, 14, d), 5.5) < 0.05);
});

test("quét mọi chỗ đứng được × yaw × pitch × zoom: camera luôn trong các phòng + 0,6 m, dưới trần phòng", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const spots: { x: number; z: number }[] = [];
  for (let x = -40; x <= 40; x += 2.3)
    for (let z = -27; z <= 27; z += 2.3) {
      const p = constrain(x + 0.01, z + 0.02);
      if (Math.hypot(p.x - x, p.z - z) < 1.2) spots.push(p);
    }
  // miệng hầm, trong hầm (tim và hai mép), chỗ hầm nối với hang nhỏ
  for (const cave of HUB_CAVES)
    for (let t = 18; t <= 32; t += 0.7)
      for (const lat of [-1.6, 0, 1.6]) {
        const q = onAxis(cave, t, lat);
        spots.push(constrain(q.x, q.z));
      }
  assert.ok(spots.length > 500);
  let shortest = Infinity;
  for (const s of spots)
    for (let yaw = -180; yaw < 180; yaw += 30)
      for (const pitch of [-25, -5, 18, 40, 60])
        for (const zoom of [2.5, 5.5, 8]) {
          // camera.ts: dưới -5° chỉ ngước hướng nhìn lên, cần vẫn ở chỗ của -5°
          lookDir(yaw, Math.max(pitch, -5), d);
          // lệch vai 0,45 m sang phải camera như camera.ts
          const a = yaw * DEG;
          const free = containBoom({ x: s.x, y: 1.3, z: s.z }, d, zoom);
          const side = shoulderShift(0.45, free);
          const pivot = { x: s.x - Math.cos(a) * side, y: 1.3, z: s.z + Math.sin(a) * side };
          const b = containBoom(pivot, d, zoom);
          assert.ok(b >= 0 && b <= zoom);
          const c = camAt(pivot, d, b);
          const what = `(${s.x.toFixed(2)}, ${s.z.toFixed(2)}) yaw ${yaw} pitch ${pitch} zoom ${zoom}`;
          // 0,16 m: pivot lệch vai có thể nằm ngoài biên nới tới 0,15 m (0,75 - 0,6)
          assert.ok(inRooms(c.x, c.z, HUB_ROOMS, MARGIN + 0.16), `${what}: camera (${c.x}, ${c.z}) ngoài phòng`);
          assert.ok(c.y >= 0.6 - 1e-9, `${what}: y ${c.y}`);
          assert.ok(c.y <= ceilingAt(c.x, c.z, CAVE_BOUNDS) + 1e-9, `${what}: y ${c.y} trên trần`);
          // cả đoạn pivot → camera nằm trong các phòng (không cắt qua đá giữa hầm và hang)
          for (let k = 1; k <= 8; k++) {
            const m = camAt(pivot, d, (b * k) / 8);
            assert.ok(inRooms(m.x, m.z, HUB_ROOMS, MARGIN + 0.16), `${what}: cần cắt qua đá`);
          }
          shortest = Math.min(shortest, b);
        }
  assert.ok(shortest >= 0);
  // đứng yên giữa hang lớn: đủ cần ở mọi hướng
  for (let yaw = -180; yaw < 180; yaw += 15) assert.equal(containBoom({ x: 3, y: 1.3, z: 6 }, lookDir(yaw, 18, d), 8), 8);
  assert.equal(HUB_LAYOUT.rooms, CAVE_BOUNDS.rooms);
});

test("springStep hội tụ êm, không vọt quá đích, độc lập với tốc độ khung hình", () => {
  const run = (dt: number) => {
    const s = { x: 0, v: 0 };
    let x = 0,
      v = 0,
      over = false;
    for (let t = 0; t < 1; t += dt) {
      springStep(x, v, 1, 18, dt, s);
      x = s.x;
      v = s.v;
      if (x > 1 + 1e-9) over = true;
    }
    return { x, over };
  };
  const a = run(1 / 30),
    b = run(1 / 144);
  assert.ok(!a.over && !b.over);
  assert.ok(Math.abs(a.x - 1) < 1e-3 && Math.abs(b.x - 1) < 1e-3);
  assert.ok(Math.abs(a.x - b.x) < 1e-3);
});

test("wrapDeg giữ góc trong (-180, 180]", () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-180), 180);
  assert.equal(wrapDeg(540), 180);
  assert.equal(wrapDeg(-30), -30);
  assert.equal(wrapDeg(725), 5);
});

test("bám theo nhân vật 4 m/s với khung hình không đều: độ trễ ổn định, không rung", () => {
  // the pivot follows a target moving at MOVE_SPEED; frame times jitter between 1/144 and 1/30 s
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const omega = 18;
  const s = { x: 0, v: 0 };
  let x = 0,
    v = 0,
    t = 0,
    lastGap = NaN,
    maxStep = 0;
  while (t < 4) {
    const dt = 1 / 144 + rand() * (1 / 30 - 1 / 144);
    t += dt;
    springStep(x, v, MOVE_SPEED * t, omega, dt, s);
    x = s.x;
    v = s.v;
    const gap = MOVE_SPEED * t - x; // where the avatar sits relative to the screen centre
    if (t > 1 && Number.isFinite(lastGap)) maxStep = Math.max(maxStep, Math.abs(gap - lastGap));
    lastGap = gap;
  }
  // ~2v/omega (0.44 m); a little less since each frame's target is applied over the whole step
  assert.ok(lastGap > 0.3 && lastGap < 0.5, `lag ${lastGap}`);
  assert.ok(maxStep < 0.01, `frame-to-frame wobble ${maxStep} m`);
});

test("containBoom + blockers: camera không nằm trong đuốc / bảng cao, dừng ở phía gần", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const pivot = { x: 0, y: 1.3, z: 0 };
  const dir = lookDir(0, 14, d); // nhìn +Z: camera lùi về -Z, cao dần
  const torch = { x: 0, z: -5, r: 0.6, top: 3.2 };
  const bounds = { ...CAVE_BOUNDS, blockers: [torch] };
  // cần 5,5 m: camera ở z = -5,34, y = 2,63 → trong đuốc → kéo về chỗ tia đi vào (z = -4,4)
  const b = containBoom(pivot, dir, 5.5, bounds);
  assert.ok(Math.abs(b - 4.4 / Math.cos(14 * DEG)) < 1e-4, String(b));
  // không có blockers: như cũ
  assert.equal(containBoom(pivot, dir, 5.5), 5.5);
  // đuốc nằm giữa camera và mục tiêu (camera ở xa hơn): không kéo cần
  assert.equal(containBoom(pivot, dir, 8, bounds), 8);
  // vật thấp dưới camera: không ảnh hưởng
  const stool = { x: 0, z: -5.34, r: 0.6, top: 1.5 };
  assert.equal(containBoom(pivot, dir, 5.5, { ...CAVE_BOUNDS, blockers: [stool] }), 5.5);
  // mục tiêu đứng trong chân vật (không có collider): bỏ qua
  const around = { x: 0, z: 0, r: 1, top: 3 };
  assert.equal(containBoom(pivot, dir, 5.5, { ...CAVE_BOUNDS, blockers: [around] }), 5.5);
});

test("containBoom + blockers: rơi vào vật thứ hai thì kéo tiếp; nhìn ngước thì vào từ đỉnh", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const dir = lookDir(0, 14, d);
  const two = [
    { x: 0, z: -5, r: 0.6, top: 3.2 },
    { x: 0, z: -4.2, r: 0.5, top: 3.2 },
  ];
  const b = containBoom({ x: 0, y: 1.3, z: 0 }, dir, 5.5, { ...CAVE_BOUNDS, blockers: two });
  assert.ok(Math.abs(b - 3.7 / Math.cos(14 * DEG)) < 1e-4, String(b));
  // pitch -5: camera thấp dần khi cần dài ra, đi vào khối từ mặt trên (y = top)
  const up = lookDir(0, -5, d);
  const pivot = { x: 0, y: 3.5, z: 0 };
  const wide = { x: 0, z: -5, r: 3, top: 3.2 };
  const b2 = containBoom(pivot, up, 5.5, { ...CAVE_BOUNDS, blockers: [wide] });
  assert.ok(Math.abs(b2 - 0.3 / Math.sin(5 * DEG)) < 1e-4, String(b2));
  assert.ok(pivot.y - up.y * b2 >= wide.top - 1e-6);
});

test("stepBoom: vách hang kéo cần vào ngay, đồ vật kéo vào nhanh nhưng không giật một khung", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const pivot = { x: 0, y: 1.3, z: 0 };
  const dir = lookDir(0, 14, d);
  // vừa xuất hiện / dịch chuyển: nhảy thẳng tới cần mong muốn
  assert.equal(stepBoom(Infinity, 5.5, 4.2, 1 / 60, pivot, dir), 4.2);
  // vách: tức thì
  assert.equal(stepBoom(5.5, 2, 2, 1 / 60, pivot, dir), 2);
  // đuốc chen vào (cần muốn 4,95): khung đầu đi < 0,25 m, sau 0,2 s còn cách < 1 cm
  let b = 5.5;
  b = stepBoom(b, 5.5, 4.95, 1 / 60, pivot, dir);
  assert.ok(b < 5.5 && 5.5 - b < 0.25, `first frame ${b}`);
  for (let t = 1 / 60; t < 0.2; t += 1 / 60) b = stepBoom(b, 5.5, 4.95, 1 / 60, pivot, dir);
  assert.ok(Math.abs(b - 4.95) < 0.01, `after 0.2 s ${b}`);
});

test("stepBoom: dài ra từ từ và dừng ở mặt gần của đồ vật, không lùi xuyên qua nó", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const pivot = { x: 0, y: 1.3, z: 0 };
  const dir = lookDir(0, 14, d);
  const torch = { x: 0, z: -5, r: 0.6, top: 3.2 };
  const blockers = [torch];
  const entry = 4.4 / Math.cos(14 * DEG);
  // camera ở 8 m nằm sau đuốc (ngoài khối): cần muốn 8, nhưng đi từ 3 m ra phải dừng trước đuốc
  const want = outsideBlockers(pivot, dir, 8, blockers);
  assert.equal(want, 8);
  let b = 3;
  let maxB = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    b = stepBoom(b, 8, want, 1 / 60, pivot, dir, blockers);
    maxB = Math.max(maxB, b);
  }
  assert.ok(maxB <= entry + 1e-6, `max ${maxB} > entry ${entry}`);
  assert.ok(entry - b < 0.01, `rests at ${b}`);
  // không có đồ vật: ra tới 8 m
  b = 3;
  for (let t = 0; t < 3; t += 1 / 60) b = stepBoom(b, 8, 8, 1 / 60, pivot, dir);
  assert.ok(8 - b < 0.01);
});

test("shoulderShift: 0,45 m ở cần thường, nhỏ dần khi cần ngắn (avatar không trôi khỏi màn hình)", () => {
  assert.equal(shoulderShift(0.45, 5.5), 0.45);
  assert.equal(shoulderShift(0.75, 5.5), 0.75);
  assert.ok(Math.abs(shoulderShift(0.45, 1) - 0.15) < 1e-12);
  assert.equal(shoulderShift(0.45, 0), 0);
  assert.equal(shoulderShift(-1, 5), 0);
  // độ lệch trên màn hình (tan) không quá 0,15 ở mọi độ dài cần
  for (let b = 0.2; b <= 8; b += 0.1) assert.ok(shoulderShift(0.75, b) / b <= 0.15 + 1e-12);
});

test("fitFov: màn ngang giữ 50°, màn dọc nới để thấy ≥ 60° ngang (tối đa 75° dọc)", () => {
  assert.equal(fitFov(50, 1280 / 720), 50);
  assert.equal(fitFov(50, 390 / 844), 75);
  assert.ok(Math.abs(fitFov(50, 1) - 60) < 1e-9);
  const hfov = (v: number, a: number) => (2 * Math.atan(Math.tan((v * DEG) / 2) * a)) / DEG;
  assert.ok(hfov(fitFov(50, 0.8), 0.8) >= 60 - 1e-9);
  assert.ok(hfov(fitFov(50, 390 / 844), 390 / 844) > 38, "điện thoại dọc: ~39° ngang thay vì 24°");
  assert.equal(fitFov(64, 0), 64);
  assert.equal(fitFov(64, Number.NaN), 64);
});

test('translated sanctuary camera bounds behave like origin bounds', () => {
  const dir = { x: 0.6, y: -0.3, z: 0.74 };
  const a = containBoom({x:2,y:1.3,z:3}, dir, 7, {maxRadius:8.8,minY:0.6,maxY:9});
  const b = containBoom({x:50,y:1.3,z:3}, dir, 7, {maxRadius:8.8,minY:0.6,maxY:9,centerX:48,centerZ:0});
  assert.equal(a,b);
  // the island now stands at x = 120: same cylinder, far from every cave room
  const c = containBoom({x:122,y:1.3,z:3}, dir, 7, {maxRadius:8.8,minY:0.6,maxY:9,centerX:120,centerZ:0});
  assert.ok(Math.abs(a - c) < 1e-9);
});
test('elevated shrine lintel allows camera below but excludes its solid beam', () => {
  const block = {x:0,z:4,r:1,top:4.6,bottom:3.4};
  assert.equal(containBoom({x:0,y:1.3,z:0},{x:0,y:0,z:-1},4,{maxRadius:14,minY:.6,maxY:9,blockers:[block]}),4);
  const b=containBoom({x:0,y:1.3,z:0},{x:0,y:-.6,z:-.8},5,{maxRadius:14,minY:.6,maxY:9,blockers:[block]});
  assert.ok(b<5);
});
