// Bot spike: kiểm tra game server đang chạy ở GAME_URL. Không phải load test 10k CCU.
// Bot tự ký vé bằng khóa dev (hoặc TICKET_PRIVATE_JWK) để chỉ đo game server, không đo API.
import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createTicketIssuer, loadPrivateJwk } from '@te-liet/auth';
import { AXIS_MAX, CLOSE_SIGNED_IN_ELSEWHERE, HUB_LAYOUT, LIMITS, MOVE_SPEED, MoveInput, ROOM_CAPACITY, TICK_RATE } from '@te-liet/shared';

const endpoint = process.env.GAME_URL || 'ws://localhost:2567';
const count = Number(process.env.BOTS || ROOM_CAPACITY + 1), duration = Number(process.env.DURATION_SECONDS || 10);
if (!Number.isInteger(count) || count < 2 || count > 10000 || !Number.isFinite(duration) || duration < 1) {
  throw new Error('Invalid load parameters');
}
const issue = createTicketIssuer(await loadPrivateJwk());
const ticketFor = (name: string) => issue({ id: crypto.randomUUID(), name, trust: 0 });
const join = (ticket: string) => new Client(endpoint).joinOrCreate('hub_v1', { ticket });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const self = (room: Room<any>) => room.state.players.get(room.sessionId);

const rooms: Room<any>[] = [];
const joins: number[] = [], rtts: number[] = [];
let errors = 0, spamReceived = 0;
let timer: ReturnType<typeof setInterval> | undefined;

try {
  // 1. Vé sai bị từ chối
  await assert.rejects(join('invalid'), 'Invalid ticket accepted');

  // 2. N bot vào; không room nào quá ROOM_CAPACITY, có room thứ hai khi N > ROOM_CAPACITY
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const room = await join(await ticketFor('Bot ' + i));
    rooms.push(room);
    joins.push(performance.now() - start);
    room.onError(() => errors++);
    room.onMessage('chat', (m: { text: string }) => { if (m.text.startsWith('spam')) spamReceived++; });
    room.onMessage('emote', () => {});
    room.onMessage('pong', (t: number) => rtts.push(performance.now() - t));
  }
  await sleep(300);
  const distribution: Record<string, number> = {};
  for (const room of rooms) distribution[room.roomId] = (distribution[room.roomId] || 0) + 1;
  assert.ok(Object.values(distribution).every((n) => n <= ROOM_CAPACITY));
  if (count > ROOM_CAPACITY) assert.ok(Object.keys(distribution).length > 1);

  // 3. Rate limit chat: guest gửi 10 tin liền, mỗi người cùng room chỉ nhận đủ giới hạn
  const receivers = rooms.filter((r) => r.roomId === rooms[0].roomId).length;
  for (let i = 0; i < 10; i++) rooms[0].send('chat', 'spam ' + i);
  await sleep(400);
  const chatDeliveredPerReceiver = spamReceived / receivers;
  assert.equal(chatDeliveredPerReceiver, LIMITS.chat.guest.capacity);

  // 4. Di chuyển qua kênh input: server quảng bá nhịp cố định, giữ biên hang, không vượt tốc độ
  const inputs = rooms.map((r) => r.input({ type: MoveInput }));
  assert.equal(inputs[0].tickRate, TICK_RATE);
  const before = { x: self(rooms[0]).x, z: self(rooms[0]).z };
  let tick = 0;
  const t0 = performance.now();
  timer = setInterval(() => {
    for (const [i, input] of inputs.entries()) {
      input.data.moveX = AXIS_MAX;
      input.data.moveZ = AXIS_MAX;
      input.send();
      if (tick % 20 === 0) rooms[i].send('ping', performance.now());
    }
    tick++;
  }, 1000 / TICK_RATE);
  await sleep(duration * 1000);
  clearInterval(timer);
  await sleep(500);
  const elapsed = (performance.now() - t0) / 1000;
  const after = self(rooms[0]);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  assert.ok(moved > 0, 'bot không di chuyển');
  assert.ok(moved <= MOVE_SPEED * elapsed + 0.25, `vượt tốc độ: ${moved} m trong ${elapsed} s`);
  for (const room of rooms) {
    const p = self(room);
    assert.ok(p && Math.hypot(p.x, p.z) <= HUB_LAYOUT.radius + 1e-3, 'ra ngoài biên hang');
  }
  assert.ok(rtts.length > 0);
  assert.equal(errors, 0);

  // 5. Mỗi tài khoản một chỗ: vào lại bằng cùng vé thì phiên cũ bị đóng
  const shared = await ticketFor('Clone');
  const first = await join(shared);
  let firstClosedWith: number | undefined;
  first.onLeave((code: number) => { firstClosedWith = code; });
  const second = await join(shared);
  await sleep(500);
  assert.equal(firstClosedWith, CLOSE_SIGNED_IN_ELSEWHERE);
  const clones = [...second.state.players.values()].filter((p: any) => p.name === 'Clone').length;
  assert.equal(clones, 1);
  await second.leave();

  const percentile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
  const report = {
    at: new Date().toISOString(),
    mode: 'single-process-local; no Redis/PostgreSQL',
    clients: count, durationSeconds: duration, rooms: distribution,
    joinP95Ms: percentile(joins, 0.95), rttP95Ms: percentile(rtts, 0.95), rttP99Ms: percentile(rtts, 0.99),
    errors, chatDeliveredPerReceiver, movedMeters: Number(moved.toFixed(2)), oneSeatPerAccount: true,
    limitations: 'Not a 10k CCU certification. RTT measured from local load generator. No browser rendering or WAN simulation.',
  };
  await mkdir('reports', { recursive: true });
  await writeFile('reports/spike.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (timer) clearInterval(timer);
  await Promise.allSettled(rooms.map((r) => r.leave()));
}
