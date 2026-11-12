import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boomInRooms,
  clampToRooms,
  inRooms,
  tunnelRooms,
  type Room,
} from "../packages/shared/src/rooms.js";

const main: Room = { x: 0, z: 0, r: 20, id: "main" };
const side: Room = { x: 32, z: 18.5, r: 7, top: 5, id: "side" };
const tunnel = tunnelRooms({ x: 16.97, z: 9.81 }, { x: 26.4, z: 15.26 }, 1.7, { top: 3 });
const rooms: Room[] = [main, side, ...tunnel];

test("điểm trong hang lớn, hang nhỏ và đường hầm đều đi được", () => {
  assert.equal(inRooms(0, 0, rooms), true);
  assert.equal(inRooms(32, 18.5, rooms), true);
  assert.equal(inRooms(21.6, 12.5, rooms), true); // giữa hầm, ngoài cả hai hang
  assert.equal(inRooms(21.6, 12.5, [main, side]), false);
  assert.equal(inRooms(0, 25, rooms), false);
});

test("đường hầm liền mạch: đi dọc tim hầm không rời vùng đi được", () => {
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    assert.ok(inRooms(32 * t, 18.5 * t, rooms), `hở tại t=${t}`);
  }
  // tâm cách nhau không quá 0,8 m và làm tròn 1 mm
  for (let i = 1; i < tunnel.length; i++) {
    const d = Math.hypot(tunnel[i].x - tunnel[i - 1].x, tunnel[i].z - tunnel[i - 1].z);
    assert.ok(d <= 0.8 + 1e-3);
    assert.equal(tunnel[i].x, Math.round(tunnel[i].x * 1000) / 1000);
  }
});

test("kẹp về điểm gần nhất của hợp các phòng", () => {
  assert.deepEqual(clampToRooms(3, 4, rooms), { x: 3, z: 4 });
  const p = clampToRooms(0, 30, rooms);
  assert.ok(Math.abs(p.x) < 1e-12 && Math.abs(p.z - 20) < 1e-12);
  // lưới điểm: kết quả luôn trong hợp, và không xa hơn hình chiếu lên bất kỳ phòng nào
  for (let x = -30; x <= 45; x += 1.37)
    for (let z = -30; z <= 30; z += 1.37) {
      const q = clampToRooms(x, z, rooms);
      assert.ok(inRooms(q.x, q.z, rooms, 1e-9));
      const moved = Math.hypot(q.x - x, q.z - z);
      for (const o of rooms) {
        const d = Math.hypot(x - o.x, z - o.z) - o.r;
        assert.ok(moved <= Math.max(0, d) + 1e-9);
      }
    }
});

test("cần camera dừng ở vách và ở trần thấp của hầm", () => {
  const level = { x: 0, y: 0, z: -1 }; // nhìn về -Z, camera lùi về +Z
  // giữa hang lớn: đủ chỗ
  assert.equal(boomInRooms({ x: 0, y: 1.3, z: 0 }, level, 5.5, rooms, { margin: 0.8 }), 5.5);
  // sát vách +Z: bị chặn ở r + margin
  const b = boomInRooms({ x: 0, y: 1.3, z: 18 }, level, 5.5, rooms, { margin: 0.8 });
  assert.ok(Math.abs(b - 2.8) < 1e-9);
  // nhìn chúc xuống trong hầm: camera cao dần, chạm trần 3 m
  const down = { x: -0.8660254037844386 * 0.9, y: -0.4358898943540674, z: -0.5 * 0.9 };
  const inTunnel = boomInRooms({ x: 21.6, y: 1.3, z: 12.5 }, down, 8, rooms, { margin: 0.5 });
  assert.ok(inTunnel > 0 && 1.3 + inTunnel * 0.4358898943540674 <= 3 + 1e-9);
  // sàn: nhìn ngước lên thì camera hạ xuống, dừng ở minY
  const up = { x: 0, y: 0.6, z: -0.8 };
  const floor = boomInRooms({ x: 0, y: 1.3, z: 0 }, up, 5.5, rooms, { minY: 0.6 });
  assert.ok(Math.abs(1.3 - floor * 0.6 - 0.6) < 1e-9);
});

test("cần camera đi xuyên chỗ nối hầm với hang, không nhảy qua khe đá", () => {
  // đứng ở cửa hang nhỏ, camera lùi dọc hầm về phía hang lớn: liên tục
  const dir = { x: 0.8660254037844386, y: 0, z: 0.5 };
  const b = boomInRooms({ x: 27, y: 1.3, z: 15.6 }, dir, 8, rooms, { margin: 0.6 });
  assert.equal(b, 8);
  // đứng trong hang nhỏ sát vách xa hang lớn, camera lùi ra ngoài: dừng ở vách hang nhỏ
  const out = boomInRooms({ x: 37, y: 1.3, z: 21.4 }, { x: -0.8660254037844386, y: 0, z: -0.5 }, 8, rooms, { margin: 0.6 });
  assert.ok(out < 2.5);
});
