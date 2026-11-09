import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "@te-liet/shared";
import { RateLimiter } from "../apps/game/src/rateLimit.js";
import { chatBucket } from "../apps/web/src/chatLimit.js";

test("chat client: 3 tin liền, rồi khoảng 3,6 s một tin; báo đúng thời gian phải chờ", () => {
  const b = chatBucket(LIMITS.chat.guest);
  const t0 = 1_000_000;
  assert.equal(b.take(t0), 0);
  assert.equal(b.take(t0 + 10), 0);
  assert.equal(b.take(t0 + 20), 0);
  const wait = b.take(t0 + 30);
  assert.ok(wait > 3000 && wait <= 3600, `wait ${wait}`);
  assert.ok(b.take(t0 + 30 + wait - 50) > 0, "còn chờ thì vẫn chặn");
  assert.equal(
    b.take(t0 + 30 + wait + 10),
    0,
    "hết thời gian chờ thì gửi được",
  );
  b.reset();
  assert.equal(b.take(t0 + 3700), 0);
});

test("chat client không bao giờ cho gửi tin mà server sẽ âm thầm bỏ (độ trễ mạng dao động)", () => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let total = 0;
  for (let run = 0; run < 60; run++) {
    const client = chatBucket(LIMITS.chat.guest);
    const server = new RateLimiter();
    let t = 1_000_000,
      lastArrival = 0;
    for (let i = 0; i < 300; i++) {
      // bấm dồn (spam Enter) xen với lúc ngừng tay
      t += rand() < 0.4 ? rand() * 250 : rand() * 5000;
      if (client.take(t) > 0) continue;
      // một websocket: tới theo thứ tự, trễ 20–250 ms, có thể tới sát nhau hơn lúc gửi
      const arrival = Math.max(lastArrival, t + 20 + rand() * 230);
      lastArrival = arrival;
      assert.ok(
        server.allow("s:chat", LIMITS.chat.guest, arrival),
        `run ${run}, tin ${i}`,
      );
      total++;
    }
  }
  assert.ok(total > 3000, `chỉ gửi được ${total} tin`);
});
