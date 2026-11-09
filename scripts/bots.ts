// Bot chơi thử: N fan lang thang trong hang (đi, rẽ, dừng ngắm thứ gì đó, thỉnh thoảng emote, hiếm
// khi chat) để hang có người khi chụp ảnh hoặc chơi thử. Không phải load test (xem scripts/spike.ts).
// Bot tự ký vé bằng khóa dev (hoặc TICKET_PRIVATE_JWK) như spike, không gọi API.
//
//   npm run bots                                    # 8 bot vào ws://127.0.0.1:2800, chạy tới Ctrl+C
//   BOTS=10 DURATION_SECONDS=600 npm run bots       # 10 bot trong 10 phút
//   GAME_URL=ws://localhost:2567 npm run bots
// Chỉ chạy vào máy local; server khác cần thêm ALLOW_REMOTE=1.
import { Client, type InputHandle, type Room } from "@colyseus/sdk";
import { randomUUID } from "node:crypto";
import { createTicketIssuer, loadPrivateJwk } from "@te-liet/auth";
import {
  AXIS_MAX,
  CLOSE_SIGNED_IN_ELSEWHERE,
  frameToCave,
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_ZONES,
  MoveInput,
  TICK_RATE,
} from "@te-liet/shared";

function fail(msg: string): never {
  console.error(`bots: ${msg}`);
  process.exit(1);
}

const endpoint = process.env.GAME_URL || "ws://127.0.0.1:2800";
const count = Number(process.env.BOTS || 8);
const duration = Number(process.env.DURATION_SECONDS || 0);
if (!Number.isInteger(count) || count < 1 || count > 120)
  fail("BOTS phải là số nguyên từ 1 đến 120");
if (!Number.isFinite(duration) || duration < 0)
  fail("DURATION_SECONDS phải ≥ 0 (0 = chạy tới Ctrl+C)");
let host = "";
try {
  host = new URL(endpoint).hostname;
} catch {
  fail(`GAME_URL không hợp lệ: ${endpoint}`);
}
const local =
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ||
  host.endsWith(".localhost");
if (!local && process.env.ALLOW_REMOTE !== "1")
  fail(
    `từ chối chạy vào ${endpoint}: không phải máy local (đặt ALLOW_REMOTE=1 nếu thật sự muốn)`,
  );

/* ------------------------------------------------------------------ dữ liệu */

const NICKS = [
  "Tèo",
  "Bin",
  "Mít",
  "Su",
  "Gấu",
  "Bơ",
  "Sóc",
  "Khoai",
  "Ốc",
  "Tý",
  "Na",
  "Cốm",
  "Bắp",
  "Mận",
  "Nhím",
  "Đậu",
  "Xoài",
  "Kem",
  "Muối",
  "Tiêu",
];
const LINES = [
  "Thua thì về hang ngồi chút đã.",
  "Có ai pha thêm ấm trà không?",
  "Mùa sau làm lại thôi anh em.",
  "Ngồi gần lửa cho ấm nè.",
  "Chào cả hang nha.",
  "Mì gói còn không ai ơi?",
  "Không sao, còn có nhau.",
  "Ai lên bảng đố vui không?",
  "Thôi đừng xem lại trận đó nữa.",
  "Hít thở sâu, rồi tính tiếp.",
];
const EMOTES = ["wave", "laugh", "cheer"] as const;

type P = { x: number; z: number };
/**
 * Chỗ bot thích đứng: quanh `at` (bán kính `spread`, hoặc trên vành `ring` = [trong, ngoài] m),
 * quay mặt về `look`, đứng `linger` giây.
 */
interface Poi {
  at: P;
  spread: number;
  ring?: [number, number];
  look: P;
  weight: number;
  linger: [number, number];
}
const FIRE: P = { x: 0, z: 0 };
const POIS: Poi[] = [
  // quanh lửa trại: phía +Z để trống cho người mới tới, hai bên giữa các ghế
  { at: { x: 0, z: 4.4 }, spread: 1.4, look: FIRE, weight: 3, linger: [5, 14] },
  {
    at: { x: -4.2, z: 2.4 },
    spread: 0.8,
    look: FIRE,
    weight: 1,
    linger: [4, 10],
  },
  {
    at: { x: 4.2, z: 2.4 },
    spread: 0.8,
    look: FIRE,
    weight: 1,
    linger: [4, 10],
  },
  // ba điểm tương tác: đứng trên vành 0,9–1,6 m quanh chỗ người chơi đứng xem (vẫn trong 3 m của
  // nút E), không chiếm đúng điểm đó; nhìn vào đồ vật
  ...HUB_LANDMARKS.map((l): Poi => ({
    at: { x: l.x, z: l.z },
    spread: 1.6,
    ring: [0.9, 1.6],
    look: HUB_ZONES[l.id],
    weight: 2,
    linger: [3, 9],
  })),
  {
    at: frameToCave(HUB_ZONES.quiz, 0, 3.2),
    spread: 1,
    look: HUB_ZONES.quiz,
    weight: 1.5,
    linger: [3, 8],
  },
  {
    at: frameToCave(HUB_ZONES.living, 0, 3),
    spread: 1,
    look: HUB_ZONES.living,
    weight: 1.5,
    linger: [3, 9],
  },
  {
    at: frameToCave(HUB_ZONES.water, 0, 3),
    spread: 1.2,
    look: HUB_ZONES.water,
    weight: 1,
    linger: [3, 7],
  },
  {
    at: { x: 0, z: -13 },
    spread: 1.2,
    look: { x: 0, z: -18.4 },
    weight: 1,
    linger: [2, 6],
  },
  { at: { x: 0, z: 9.5 }, spread: 2.2, look: FIRE, weight: 1, linger: [2, 6] },
];
const POI_WEIGHT = POIS.reduce((s, p) => s + p.weight, 0);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
const wrapPi = (a: number) => {
  const w = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return w - Math.PI;
};

/* ------------------------------------------------------------------ đường đi */

const { obstacles, radius } = HUB_LAYOUT;
/** Điểm đứng được, cách vật cản thêm `margin` m (collider đã gồm thân người). */
const clearOf = (x: number, z: number, margin: number) =>
  Math.hypot(x, z) <= radius - 1 &&
  obstacles.every((o) => Math.hypot(x - o.x, z - o.z) >= o.r + margin);
/** Đi thẳng từ a tới b không cắt vật cản nào. */
function clearPath(a: P, b: P): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!clearOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.1))
      return false;
  }
  return true;
}

interface Target extends P {
  look: P | null;
  linger: [number, number];
}
interface Bot {
  readonly id: string;
  readonly name: string;
  room: Room<any> | null;
  input: InputHandle<MoveInput> | null;
  mode: "rest" | "walk" | "face";
  target: Target | null;
  /** Hướng đi (rad): (sin, cos) trên XZ. */
  heading: number;
  /** rest: lúc đi tiếp (ms). */
  until: number;
  /** Chống kẹt: khoảng cách gần nhất tới đích và lúc đạt được. */
  best: number;
  bestAt: number;
  /** Bước quay mặt còn lại khi tới nơi. */
  faceTicks: number;
  wobble: number;
  idleSteps: number;
  emoteAt: number;
  nextChat: number;
}

/** Có người chơi khác (người thật hoặc bot) đang đứng trong 1,2 m quanh (x, z). */
function occupied(b: Bot, x: number, z: number): boolean {
  let hit = false;
  b.room?.state?.players?.forEach((p: { x: number; z: number }, id: string) => {
    if (!hit && id !== b.room?.sessionId && Math.hypot(p.x - x, p.z - z) < 1.2)
      hit = true;
  });
  return hit;
}

/**
 * Chọn đích: thường là một chỗ thú vị, đôi khi bất kỳ; đi thẳng tới được, không trùng đích của
 * bot khác, không đứng đè lên người đang đứng đó.
 */
function pickTarget(b: Bot, from: P): Target | null {
  for (let i = 0; i < 60; i++) {
    let x: number, z: number;
    let look: P | null = null;
    let linger: [number, number] = [1.5, 5];
    if (Math.random() < 0.7) {
      let w = Math.random() * POI_WEIGHT;
      let poi = POIS[0];
      for (const p of POIS)
        if ((w -= p.weight) <= 0) {
          poi = p;
          break;
        }
      const [r0, r1] = poi.ring ?? [0, poi.spread];
      const a = rand(0, 2 * Math.PI),
        r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0)); // đều theo diện tích
      x = poi.at.x + Math.cos(a) * r;
      z = poi.at.z + Math.sin(a) * r;
      look = poi.look;
      linger = poi.linger;
    } else {
      const a = rand(0, 2 * Math.PI),
        r = rand(3, 13);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    if (!clearOf(x, z, 0.35)) continue;
    if (Math.hypot(x - from.x, z - from.z) < 2.5) continue;
    if (
      bots.some(
        (o) =>
          o !== b &&
          o.target &&
          Math.hypot(o.target.x - x, o.target.z - z) < 1.3,
      )
    )
      continue;
    if (occupied(b, x, z)) continue;
    if (i < 45 && !clearPath(from, { x, z })) continue;
    return { x, z, look, linger };
  }
  return null;
}

/* ------------------------------------------------------------------ hành vi */

const DT = 1 / TICK_RATE;
/** Tốc độ rẽ khi đang đi (rad/s): đường đi cong nhẹ, không gãy góc. */
const TURN = 3.2;
const ARRIVE = 0.7;
const stats = { joins: 0, drops: 0, failures: 0, legs: 0, emotes: 0, chats: 0 };

function emote(b: Bot) {
  b.room?.send("emote", pick(EMOTES));
  stats.emotes++;
}

function rest(b: Bot, now: number, seconds: [number, number]) {
  b.mode = "rest";
  b.until = now + rand(seconds[0], seconds[1]) * 1000;
}

function startWalk(b: Bot, from: P, now: number) {
  const t = pickTarget(b, from);
  if (!t) return rest(b, now, [1, 3]);
  b.target = t;
  b.mode = "walk";
  b.heading = Math.atan2(t.x - from.x, t.z - from.z); // xuất phát nhìn thẳng về đích
  b.best = Math.hypot(t.x - from.x, t.z - from.z);
  b.bestAt = now;
  b.wobble = rand(0, 2 * Math.PI);
  b.emoteAt = Math.random() < 0.04 ? now + rand(800, 2500) : Infinity;
  stats.legs++;
}

/** Một bước cố định của một bot: trả về hướng đi (rad) hoặc null khi đứng. */
function decide(b: Bot, pos: P, now: number): number | null {
  if (b.mode === "rest") {
    if (now < b.until) return null;
    startWalk(b, pos, now);
  }
  const t = b.target;
  if (b.mode === "walk" && t) {
    const dx = t.x - pos.x,
      dz = t.z - pos.z,
      d = Math.hypot(dx, dz);
    if (now >= b.emoteAt) {
      b.emoteAt = Infinity;
      emote(b);
    }
    if (d < ARRIVE) {
      // tới nơi: một bước nhỏ về phía thứ đang xem để quay mặt, rồi đứng
      b.mode = "face";
      b.faceTicks = t.look ? 1 : 0;
    } else {
      if (d < b.best - 0.25) {
        b.best = d;
        b.bestAt = now;
      } else if (now - b.bestAt > 1800) {
        rest(b, now, [0.3, 1]); // kẹt sau vật cản: đứng một chút rồi chọn đích khác
        return null;
      }
      const meander =
        0.28 * Math.sin((now / 1000) * 0.9 + b.wobble) * Math.min(1, d / 4);
      const want = Math.atan2(dx, dz) + meander;
      const turn = wrapPi(want - b.heading),
        max = TURN * DT;
      b.heading = wrapPi(b.heading + Math.max(-max, Math.min(max, turn)));
      return b.heading;
    }
  }
  if (b.mode === "face") {
    if (b.faceTicks > 0 && t?.look) {
      b.faceTicks--;
      return Math.atan2(t.look.x - pos.x, t.look.z - pos.z);
    }
    rest(b, now, t?.linger ?? [2, 5]);
    if (Math.random() < 0.12) emote(b);
    return null;
  }
  return null;
}

/** Lượng tử hóa như client: thành phần lớn hơn đúng ±AXIS_MAX (đi đủ tốc độ). */
function axes(dir: number): [number, number] {
  const x = Math.sin(dir),
    z = Math.cos(dir);
  const m = Math.max(Math.abs(x), Math.abs(z));
  return [
    Math.round((x / m) * AXIS_MAX) || 0,
    Math.round((z / m) * AXIS_MAX) || 0,
  ];
}

function step(b: Bot, now: number) {
  const { room, input } = b;
  const me = room?.state?.players?.get(room.sessionId);
  if (!room || !input || !me) return;
  const dir = decide(b, { x: me.x, z: me.z }, now);
  // như client: đứng yên thì chỉ gửi 5 bước đuôi và 1 bước mỗi giây
  if (dir === null) {
    b.idleSteps++;
    if (b.idleSteps > 5 && b.idleSteps % TICK_RATE !== 0) return;
    input.data.moveX = 0;
    input.data.moveZ = 0;
  } else {
    b.idleSteps = 0;
    [input.data.moveX, input.data.moveZ] = axes(dir);
  }
  input.send();
  if (now >= b.nextChat) {
    b.nextChat = now + rand(120, 300) * 1000;
    room.send("chat", pick(LINES));
    stats.chats++;
  }
}

/* ------------------------------------------------------------------ kết nối */

const issue = createTicketIssuer(await loadPrivateJwk());
let stopping = false;
const bots: Bot[] = Array.from({ length: count }, (_, i) => ({
  id: randomUUID(),
  name: `${NICKS[i % NICKS.length]}${i >= NICKS.length ? ` ${Math.floor(i / NICKS.length) + 1}` : ""} (bot)`,
  room: null,
  input: null,
  mode: "rest",
  target: null,
  heading: 0,
  until: 0,
  best: Infinity,
  bestAt: 0,
  faceTicks: 0,
  wobble: 0,
  idleSteps: 0,
  emoteAt: Infinity,
  nextChat: Date.now() + rand(30, 240) * 1000,
}));

async function connect(b: Bot): Promise<void> {
  if (stopping) return;
  try {
    // id cố định cho mỗi bot: vào lại thì chiếm đúng ghế cũ (mỗi tài khoản một chỗ)
    const ticket = await issue({ id: b.id, name: b.name, trust: 0 });
    const room = await new Client(endpoint).joinOrCreate("hub_v1", { ticket });
    if (stopping) {
      await room.leave();
      return;
    }
    room.onMessage("chat", () => {});
    room.onMessage("emote", () => {});
    b.room = room;
    b.input = room.input({ type: MoveInput });
    b.target = null;
    b.idleSteps = 0;
    rest(b, Date.now(), [0.3, 2.5]);
    stats.joins++;
    console.log(`bots: ${b.name} vào room ${room.roomId}`);
    room.onLeave((code: number) => {
      if (b.room !== room) return;
      b.room = null;
      b.input = null;
      b.target = null;
      if (stopping) return;
      if (code === CLOSE_SIGNED_IN_ELSEWHERE) {
        console.log(`bots: ${b.name} bị phiên khác thay chỗ, dừng bot này`);
        return;
      }
      stats.drops++;
      console.log(`bots: ${b.name} rời room (mã ${code}), vào lại sau ít giây`);
      setTimeout(() => void connect(b), rand(1500, 4000));
    });
  } catch (err) {
    stats.failures++;
    console.error(
      `bots: ${b.name} không vào được (${describe(err)}), thử lại sau`,
    );
    if (!stopping) setTimeout(() => void connect(b), rand(3000, 6000));
  }
}

const timer = setInterval(() => {
  const now = Date.now();
  for (const b of bots) step(b, now);
}, 1000 / TICK_RATE);

async function stop(reason: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await Promise.allSettled(
    bots.map((b) =>
      b.room ? Promise.race([b.room.leave(), sleep(3000)]) : undefined,
    ),
  );
  console.log(
    `bots: dừng (${reason}) ` + JSON.stringify({ bots: count, ...stats }),
  );
  process.exit(0);
}
process.on("SIGINT", () => void stop("Ctrl+C"));
process.on("SIGTERM", () => void stop("SIGTERM"));
if (duration > 0)
  setTimeout(() => void stop(`hết ${duration} s`), duration * 1000);

console.log(
  `bots: ${count} bot → ${endpoint}` +
    (duration > 0 ? ` trong ${duration} s` : " (Ctrl+C để dừng)"),
);
for (const b of bots) {
  await connect(b);
  await sleep(rand(120, 350)); // vào lần lượt cho tự nhiên
}
