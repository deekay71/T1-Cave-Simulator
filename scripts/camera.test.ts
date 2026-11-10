import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInput, AXIS_MAX, MOVE_SPEED } from "@te-liet/shared";
import {
  CAVE_BOUNDS,
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
  type V3,
} from "../apps/web/src/cameraMath.js";

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

test("containBoom: camera không ra ngoài hình trụ 16,8 m, rút cần về phía mục tiêu", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  // centre of the cave: nothing in the way
  assert.equal(containBoom({ x: 0, y: 1.3, z: 0 }, lookDir(30, 14, d), 5.5), 5.5);
  // player at r = 16 looking inward (camera pushed outward): boom ~0.8 m
  for (const yawDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const a = (yawDeg * Math.PI) / 180;
    const pivot = { x: -Math.sin(a) * 16, y: 1.3, z: -Math.cos(a) * 16 };
    lookDir(yawDeg, 14, d);
    const b = containBoom(pivot, d, 5.5);
    const cx = pivot.x - d.x * b,
      cz = pivot.z - d.z * b;
    assert.ok(Math.hypot(cx, cz) <= CAVE_BOUNDS.maxRadius + 1e-9);
    assert.ok(Math.abs(Math.hypot(cx, cz) - CAVE_BOUNDS.maxRadius) < 1e-6, "touches the limit");
    assert.ok(b > 0.75 && b < 0.9, `boom ${b}`);
  }
  // sideways along the wall: partially shortened, still inside
  const pivot = { x: 16, y: 1.3, z: 0 };
  const b = containBoom(pivot, lookDir(0, 14, d), 8);
  assert.ok(b < 8 && b > 1);
  assert.ok(Math.hypot(pivot.x - d.x * b, pivot.z - d.z * b) <= 16.8 + 1e-9);
});

test("containBoom: giữ độ cao camera trong [0,6; 9] m", () => {
  const d: V3 = { x: 0, y: 0, z: 0 };
  const pivot = { x: 0, y: 1.3, z: 0 };
  // steep top-down view: capped by the 9 m ceiling limit
  let b = containBoom(pivot, lookDir(0, 60, d), 8);
  assert.ok(Math.abs(pivot.y - d.y * b - 9) < 1e-9 || pivot.y - d.y * b < 9);
  assert.ok(pivot.y - d.y * b <= 9 + 1e-9);
  // looking up from a low pivot: capped by the floor limit
  b = containBoom({ x: 0, y: 0.9, z: 0 }, lookDir(0, -5, d), 8);
  assert.ok(0.9 - d.y * b >= 0.6 - 1e-9);
  assert.ok(b < 8);
  // pivot already beyond the radius: some slack, never negative
  b = containBoom({ x: 17.2, y: 1.3, z: 0 }, lookDir(-90, 14, d), 5.5);
  assert.ok(b >= 0 && b < 0.5);
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
});
test('elevated shrine lintel allows camera below but excludes its solid beam', () => {
  const block = {x:0,z:4,r:1,top:4.6,bottom:3.4};
  assert.equal(containBoom({x:0,y:1.3,z:0},{x:0,y:0,z:-1},4,{maxRadius:14,minY:.6,maxY:9,blockers:[block]}),4);
  const b=containBoom({x:0,y:1.3,z:0},{x:0,y:-.6,z:-.8},5,{maxRadius:14,minY:.6,maxY:9,blockers:[block]});
  assert.ok(b<5);
});
