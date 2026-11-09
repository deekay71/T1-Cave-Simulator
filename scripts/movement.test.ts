import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyInput,
  AXIS_MAX,
  Chat,
  constrain,
  HUB_LAYOUT,
  MOVE_SPEED,
  spawnPoint,
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
