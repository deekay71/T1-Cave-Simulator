import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARM,
  CRUTCH_DUTY,
  angleDelta,
  armPose,
  armReach,
  crutchTip,
  pointVelocity,
  solveArm,
  trailAngle,
  wheelSpin,
  type CrutchTip,
} from "../apps/web/src/avatarRankMath.js";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("solveArm: bàn tay chạm đúng điểm trong tầm với (cả hai tay, có xoay khuỷu)", () => {
  const p = armPose();
  const out = { x: 0, y: 0, z: 0 };
  const targets: [number, number, number][] = [
    [0.05, -0.4, 0.15],
    [0.1, -0.3, -0.2],
    [-0.05, -0.2, 0.3],
    [0.13, -0.325, -0.02],
    [0, -0.45, 0.25],
    [0.05, 0.25, 0.2],
  ];
  for (const side of [1, -1] as const)
    for (const twist of [0, 20, -35])
      for (const [x, y, z] of targets) {
        solveArm(side, side * x, y, z, p, twist);
        assert.ok(near(Math.hypot(p.x, p.y, p.z, p.w), 1), "quaternion đơn vị");
        assert.ok(p.elbow <= 4 && p.elbow >= -155, `khuỷu chỉ gập về trước: ${p.elbow}`);
        assert.ok(p.reach < 1);
        armReach(side, p, out);
        assert.ok(Math.hypot(out.x - side * x, out.y - y, out.z - z) < 1e-6, `tay ${side} lệch đích`);
      }
});

test("solveArm: ngoài tầm với thì duỗi thẳng về phía đích; điểm nắm tuỳ chọn (mép dưới bàn tay)", () => {
  const p = armPose();
  const out = { x: 0, y: 0, z: 0 };
  solveArm(1, 0.2, -0.9, 0.4, p);
  assert.ok(p.reach > 1);
  assert.ok(p.elbow > -3, "tay duỗi");
  armReach(1, p, out);
  const l = Math.hypot(out.x, out.y, out.z);
  const d = Math.hypot(0.2, 0.9, 0.4);
  assert.ok((out.x * 0.2 + out.y * -0.9 + out.z * 0.4) / (l * d) > 0.9999, "cùng hướng với đích");
  // lower edge of the hand (wheelchair push)
  solveArm(-1, -0.06, -0.5, -0.05, p, -14, ARM.handX, -0.3, 0.01);
  armReach(-1, p, out, ARM.handX, -0.3, 0.01);
  assert.ok(Math.hypot(out.x + 0.06, out.y + 0.5, out.z + 0.05) < 1e-6);
  // tay buông ở tư thế nghỉ: không xoay gì
  solveArm(1, ARM.elbowX + ARM.handX, ARM.elbowY + ARM.handY, ARM.handZ, p);
  assert.ok(Math.abs(p.elbow) < 0.5 && p.w > 0.9999);
});

test("crutchTip: đầu nạng đứng yên trên sàn khi chống, rồi nhấc và đưa về trước", () => {
  const stride = 0.8;
  const t: CrutchTip = { z: 0, lift: 0, planted: true };
  // planted: the tip slides back at exactly the body's speed (2 * stride per cycle)
  const a = crutchTip(0.05, stride, 0.1, { ...t }).z;
  const b = crutchTip(0.15, stride, 0.1, { ...t }).z;
  assert.ok(near(a - b, 2 * stride * 0.1));
  assert.equal(crutchTip(0.2, stride, 0.1, t).lift, 0);
  assert.equal(t.planted, true);
  // continuous at both ends of the plant, lifted in between, never below the floor
  const end = crutchTip(CRUTCH_DUTY - 1e-9, stride, 0.1, { ...t }).z;
  const start = crutchTip(CRUTCH_DUTY + 1e-9, stride, 0.1, { ...t }).z;
  assert.ok(near(end, start, 1e-6));
  assert.ok(near(crutchTip(1 - 1e-9, stride, 0.1, { ...t }).z, crutchTip(0, stride, 0.1, { ...t }).z, 1e-6));
  let top = 0;
  for (let p = 0; p < 1; p += 0.01) {
    crutchTip(p, stride, 0.1, t);
    assert.ok(t.lift >= 0);
    assert.ok(Math.abs(t.z) <= stride * CRUTCH_DUTY + 1e-9);
    top = Math.max(top, t.lift);
  }
  assert.ok(top > 0.09 && top <= 0.1);
  assert.ok(near(crutchTip(1.3, stride, 0.1, { ...t }).z, crutchTip(0.3, stride, 0.1, { ...t }).z), "pha tuần hoàn");
});

test("angleDelta / trailAngle: bám hướng theo cung ngắn nhất, có giới hạn tốc độ quay", () => {
  assert.ok(near(angleDelta(0.1, -0.1), 0.2));
  assert.ok(near(angleDelta(-3.1, 3.1), 2 * Math.PI - 6.2));
  assert.ok(near(angleDelta(3.1, -3.1), -(2 * Math.PI - 6.2)));
  let a = 3.0;
  for (let i = 0; i < 600; i++) a = trailAngle(a, -3.0, 1 / 60, 0.1, 6);
  assert.ok(Math.abs(angleDelta(a, -3.0)) < 1e-3, "đến đích qua +-PI");
  assert.ok(a > 3.0, "đi theo cung ngắn (tăng qua PI), không quay ngược cả vòng");
  const step = trailAngle(0, 3, 1 / 60, 0.001, 2) - 0;
  assert.ok(near(step, 2 / 60), "không quay nhanh hơn maxRate");
  assert.equal(trailAngle(1, 1, 0.016, 0.1, 5), 1);
});

test("wheelSpin / pointVelocity: bánh lăn theo quãng đường, quay tại chỗ thì hai bánh ngược nhau", () => {
  assert.ok(near(wheelSpin(0.3, 0, 0.285, 0.3), 1));
  // turning left on the spot: the left wheel (+x) rolls back, the right one forward
  assert.ok(wheelSpin(0, 0.2, 0.285, 0.3) < 0);
  assert.ok(near(wheelSpin(0, 0.2, 0.285, 0.3), -wheelSpin(0, 0.2, -0.285, 0.3)));
  // a turn about the left wheel: it does not roll at all
  assert.ok(near(wheelSpin(0.285 * 0.5, 0.5, 0.285, 0.3), 0));
  const v = { x: 0, z: 0 };
  pointVelocity(0, 2, 0, 0.4, 1, v);
  assert.deepEqual(v, { x: 0, z: 2 });
  // spinning left about the centre: the front-left corner moves toward +x... and back
  pointVelocity(0, 0, 1, 0.4, 1, v);
  assert.ok(near(v.x, 1) && near(v.z, -0.4));
  // v = omega x r is perpendicular to r
  assert.ok(near(v.x * 0.4 + v.z * 1, 0));
});
