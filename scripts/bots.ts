// Bot chơi thử: N fan lang thang khắp năm hang (đi, rẽ, dừng ngắm thứ gì đó, thỉnh thoảng emote, hiếm
// khi chat) để hang có người khi chụp ảnh hoặc chơi thử. Không phải load test (xem scripts/spike.ts).
// Bot tự ký vé bằng khóa dev (hoặc TICKET_PRIVATE_JWK) như spike, không gọi API.
//
// Đường đi: đồ thị điểm mốc (vòng quanh lửa trại, các lối ra miệng hầm, tim từng đường hầm, lòng
// từng hang nhỏ) nối bằng những đoạn thẳng không cắt vật cản; bot tìm đường ngắn nhất qua đồ thị
// (hang lớn ↔ hầm ↔ hang nhỏ) thay vì đi thẳng trong một đĩa. Khi dừng, in số lượt ghé từng hang
// (visits), thời gian có mặt (seconds) và số lần kẹt (stuck: 1,8 s không tiến thêm được).
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
  HUB_CAVES,
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_ROOMS,
  HUB_WALKWAYS,
  HUB_ZONES,
  inRooms,
  MoveInput,
  SIDE_CAVE_RADIUS,
  TICK_RATE,
  type SideCave,
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
/** Hang chứa điểm (x, z): "main" hoặc id hang nhỏ (đường hầm tính cho hang nhỏ nó dẫn tới). */
type Region = "main" | SideCave["id"];
const REGIONS: Region[] = ["main", ...HUB_CAVES.map((c) => c.id)];
function regionOf(p: P): Region {
  for (const c of HUB_CAVES)
    if (Math.hypot(p.x - c.x, p.z - c.z) <= SIDE_CAVE_RADIUS + 0.3) return c.id;
  if (Math.hypot(p.x, p.z) <= HUB_LAYOUT.radius) return "main";
  let best: Region = "main",
    bestD = Infinity;
  for (const c of HUB_CAVES) {
    const d = Math.hypot(p.x - c.tunnel.x, p.z - c.tunnel.z);
    if (d < bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}
/** Điểm trên tim hầm của hang c, cách gốc t m (dịch ngang `lat` m). */
const onAxis = (c: SideCave, t: number, lat = 0): P => {
  const d = Math.hypot(c.x, c.z),
    ux = c.x / d,
    uz = c.z / d;
  return { x: ux * t - uz * lat, z: uz * t + ux * lat };
};
const landmark = (id: string) => HUB_LANDMARKS.find((l) => l.id === id)!;
const MAIN_POIS: Poi[] = [
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
  // điểm tương tác của hang lớn (điểm danh, góc thâm niên, cửa điện thờ): đứng trên vành 0,9–1,6 m
  // quanh chỗ người chơi đứng xem (vẫn trong tầm nút E), không chiếm đúng điểm đó; nhìn vào đồ vật
  ...(["checkin", "rest", "altar"] as const).map((id): Poi => ({
    at: landmark(id),
    spread: 1.6,
    ring: [0.9, 1.6],
    look: HUB_ZONES[id],
    weight: 2,
    linger: [3, 9],
  })),
  // các góc sinh hoạt chung: đứng trước mặt vùng (trục +Z của khung vùng), nhìn vào nó
  ...(
    [
      ["crateCorner", 2.6, 1.5],
      ["living", 3.2, 1.5],
      ["water", 3.6, 1],
      ["tea", 3, 1.5],
      ["crates", 3.2, 1.2],
      ["rug", 2.8, 1.2],
    ] as const
  ).map(([zone, dist, weight]): Poi => ({
    at: frameToCave(HUB_ZONES[zone], 0, dist),
    spread: 1,
    look: HUB_ZONES[zone],
    weight,
    linger: [3, 9],
  })),
  { at: { x: 0, z: 9.5 }, spread: 2.2, look: FIRE, weight: 1, linger: [2, 6] },
];
/** Trong mỗi hang nhỏ: trước sạp (vành quanh chỗ đứng xem), giữa hang, và gần miệng hang. */
const sidePois = (c: SideCave): Poi[] => {
  const stall = HUB_ZONES[c.stall];
  const d = Math.hypot(c.x, c.z);
  return [
    {
      at: landmark(c.stall),
      spread: 1.7,
      ring: [0.8, 1.7],
      look: stall,
      weight: 4,
      linger: [4, 12],
    },
    { at: { x: c.x, z: c.z }, spread: 2.2, look: stall, weight: 2, linger: [3, 8] },
    { at: onAxis(c, d - 4.2), spread: 1.3, look: stall, weight: 1, linger: [2, 5] },
  ];
};
const POIS: Record<Region, Poi[]> = Object.fromEntries([
  ["main", MAIN_POIS],
  ...HUB_CAVES.map((c) => [c.id, sidePois(c)] as const),
]) as Record<Region, Poi[]>;
/** Bot chọn hang trước rồi mới chọn chỗ: hang lớn đông nhất, mỗi hang nhỏ ~1/8 số lượt. */
const REGION_WEIGHT: Record<Region, number> = {
  main: 4,
  ne_back: 1,
  nw_back: 1,
  nw_front: 1,
  ne_front: 1,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];
function weighted<T>(items: readonly T[], weight: (item: T) => number): T {
  let w = Math.random() * items.reduce((s, i) => s + weight(i), 0);
  for (const i of items) if ((w -= weight(i)) <= 0) return i;
  return items[items.length - 1];
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
const wrapPi = (a: number) => {
  const w = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return w - Math.PI;
};

/* ------------------------------------------------------------------ đường đi */

const { obstacles } = HUB_LAYOUT;
/**
 * Điểm đứng được: nằm trong vùng đi được (hợp các phòng) cách biên ≥ `inset` m và cách mọi vật cản
 * thêm `margin` m (collider đã gồm thân người).
 */
const clearOf = (x: number, z: number, margin: number, inset = 0.5) =>
  inRooms(x, z, HUB_ROOMS, -inset) &&
  obstacles.every((o) => Math.hypot(x - o.x, z - o.z) >= o.r + margin);
/** Đi thẳng từ a tới b không cắt vật cản nào và không rời vùng đi được. */
function clearPath(a: P, b: P): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!clearOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.12, 0.15))
      return false;
  }
  return true;
}

/**
 * Điểm mốc: vòng quanh lửa trại (r 6,5 m), dọc sáu lối đi (HUB_WALKWAYS: chỗ xuất hiện, cửa điện thờ,
 * bốn miệng hầm), tim mỗi đường hầm, và trong mỗi hang nhỏ (tâm + vòng r 3,6 m). Điểm bị vật cản
 * chiếm thì bỏ. Cạnh: hai điểm cách nhau ≤ 13 m và nhìn thấy nhau (clearPath).
 */
const NODES: P[] = [];
{
  const add = (p: P) => {
    if (clearOf(p.x, p.z, 0.3, 0.4)) NODES.push(p);
  };
  for (let a = 0; a < 360; a += 20)
    add({ x: 6.5 * Math.sin((a * Math.PI) / 180), z: 6.5 * Math.cos((a * Math.PI) / 180) });
  for (const w of HUB_WALKWAYS) {
    const d = Math.hypot(w.to.x, w.to.z);
    for (const t of [9.5, 13, 16.5]) if (t < d) add({ x: (w.to.x / d) * t, z: (w.to.z / d) * t });
  }
  for (const c of HUB_CAVES) {
    const d = Math.hypot(c.x, c.z);
    for (const t of [19.5, 22, 24.5, 27, 29.5, d - 5]) add(onAxis(c, t));
    add({ x: c.x, z: c.z });
    for (let a = 0; a < 360; a += 45)
      add({ x: c.x + 3.6 * Math.sin((a * Math.PI) / 180), z: c.z + 3.6 * Math.cos((a * Math.PI) / 180) });
  }
}
const EDGES: number[][] = NODES.map(() => []);
for (let i = 0; i < NODES.length; i++)
  for (let j = i + 1; j < NODES.length; j++)
    if (
      Math.hypot(NODES[i].x - NODES[j].x, NODES[i].z - NODES[j].z) <= 13 &&
      clearPath(NODES[i], NODES[j])
    ) {
      EDGES[i].push(j);
      EDGES[j].push(i);
    }

/**
 * Đường đi từ `from` tới `to`: thẳng nếu thông, không thì đường ngắn nhất qua các điểm mốc (Dijkstra
 * trên đồ thị nhỏ, `from` và `to` nối với mọi điểm mốc chúng nhìn thấy). null nếu không có đường.
 */
function findPath(from: P, to: P): P[] | null {
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
  if (dist(from, to) <= 13 && clearPath(from, to)) return [to];
  const n = NODES.length;
  const cost = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  const done = new Array<boolean>(n + 1).fill(false);
  const goalLinks = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (dist(from, NODES[i]) <= 13 && clearPath(from, NODES[i])) cost[i] = dist(from, NODES[i]);
    if (dist(to, NODES[i]) <= 13 && clearPath(NODES[i], to)) goalLinks.add(i);
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i <= n; i++) if (!done[i] && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || cost[u] === Infinity) return null;
    if (u === n) break;
    done[u] = true;
    for (const v of EDGES[u]) {
      const c = cost[u] + dist(NODES[u], NODES[v]);
      if (c < cost[v]) {
        cost[v] = c;
        prev[v] = u;
      }
    }
    if (goalLinks.has(u)) {
      const c = cost[u] + dist(NODES[u], to);
      if (c < cost[n]) {
        cost[n] = c;
        prev[n] = u;
      }
    }
  }
  const path: P[] = [to];
  for (let u = prev[n]; u >= 0; u = prev[u]) path.unshift(NODES[u]);
  return path;
}

interface Target extends P {
  look: P | null;
  linger: [number, number];
  /** Các điểm còn phải đi qua; điểm cuối là chính đích. */
  path: P[];
  region: Region;
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
 * Chọn đích: chọn hang trước (hang lớn nhiều lượt nhất), rồi thường là một chỗ thú vị trong hang đó,
 * đôi khi bất kỳ; phải có đường tới (findPath), không trùng đích của bot khác, không đứng đè lên
 * người đang đứng đó.
 */
function pickTarget(b: Bot, from: P): Target | null {
  for (let i = 0; i < 40; i++) {
    const region = weighted(REGIONS, (r) => REGION_WEIGHT[r]);
    let x: number, z: number;
    let look: P | null = null;
    let linger: [number, number] = [1.5, 5];
    if (Math.random() < 0.75) {
      const poi = weighted(POIS[region], (p) => p.weight);
      const [r0, r1] = poi.ring ?? [0, poi.spread];
      const a = rand(0, 2 * Math.PI),
        r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0)); // đều theo diện tích
      x = poi.at.x + Math.cos(a) * r;
      z = poi.at.z + Math.sin(a) * r;
      look = poi.look;
      linger = poi.linger;
    } else {
      const cave = HUB_CAVES.find((c) => c.id === region);
      const a = rand(0, 2 * Math.PI),
        r = cave ? rand(0.5, 5.8) : rand(3, 18);
      x = (cave?.x ?? 0) + Math.cos(a) * r;
      z = (cave?.z ?? 0) + Math.sin(a) * r;
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
    const path = findPath(from, { x, z });
    if (!path) continue;
    return { x, z, look, linger, path, region };
  }
  return null;
}

/* ------------------------------------------------------------------ hành vi */

const DT = 1 / TICK_RATE;
/** Tốc độ rẽ khi đang đi (rad/s): đường đi cong nhẹ, không gãy góc. */
const TURN = 3.2;
const ARRIVE = 0.7;
const stats = { joins: 0, drops: 0, failures: 0, legs: 0, emotes: 0, chats: 0, stuck: 0 };
/** Số lượt bot tới đích trong từng hang và tổng thời gian (giây-bot) có mặt ở đó. */
const visits = Object.fromEntries(REGIONS.map((r) => [r, 0])) as Record<Region, number>;
const seconds = Object.fromEntries(REGIONS.map((r) => [r, 0])) as Record<Region, number>;
/** Điểm mốc trung gian coi như đã tới khi cách dưới chừng này (m). */
const PASS = 0.9;

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
  const first = t.path[0];
  b.heading = Math.atan2(first.x - from.x, first.z - from.z); // xuất phát nhìn thẳng về điểm đầu
  b.best = Math.hypot(first.x - from.x, first.z - from.z);
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
    // qua điểm mốc trung gian: chuyển sang điểm kế (điểm cuối của path là đích)
    while (
      t.path.length > 1 &&
      Math.hypot(t.path[0].x - pos.x, t.path[0].z - pos.z) < PASS
    ) {
      t.path.shift();
      b.best = Math.hypot(t.path[0].x - pos.x, t.path[0].z - pos.z);
      b.bestAt = now;
    }
    const via = t.path[0];
    const dx = via.x - pos.x,
      dz = via.z - pos.z,
      d = Math.hypot(dx, dz);
    if (now >= b.emoteAt) {
      b.emoteAt = Infinity;
      emote(b);
    }
    if (t.path.length === 1 && d < ARRIVE) {
      // tới nơi: một bước nhỏ về phía thứ đang xem để quay mặt, rồi đứng
      b.mode = "face";
      b.faceTicks = t.look ? 1 : 0;
      visits[regionOf(pos)]++;
    } else {
      if (d < b.best - 0.25) {
        b.best = d;
        b.bestAt = now;
      } else if (now - b.bestAt > 1800) {
        stats.stuck++;
        console.log(
          `bots: ${b.name} kẹt ở (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) khi tới (${via.x.toFixed(2)}, ${via.z.toFixed(2)})`,
        );
        rest(b, now, [0.3, 1]); // kẹt sau vật cản: đứng một chút rồi chọn đích khác
        return null;
      }
      // trong hầm và giữa các điểm mốc gần nhau thì đi thẳng hơn (lượn ít)
      const meander =
        (t.path.length > 1 ? 0.12 : 0.28) *
        Math.sin((now / 1000) * 0.9 + b.wobble) *
        Math.min(1, d / 4);
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
  seconds[regionOf(me)] += DT;
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
    for (const type of ["chat", "emote", "notice", "shrineState", "altarState", "altarComplete"])
      room.onMessage(type, () => {});
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
  const round = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  console.log(
    `bots: dừng (${reason}) ` +
      JSON.stringify({ bots: count, ...stats, visits, seconds: round(seconds) }),
  );
  process.exit(0);
}
process.on("SIGINT", () => void stop("Ctrl+C"));
process.on("SIGTERM", () => void stop("SIGTERM"));
if (duration > 0)
  setTimeout(() => void stop(`hết ${duration} s`), duration * 1000);

console.log(
  `bots: ${NODES.length} điểm mốc, ${EDGES.reduce((n, e) => n + e.length, 0) / 2} cạnh nối năm hang`,
);
console.log(
  `bots: ${count} bot → ${endpoint}` +
    (duration > 0 ? ` trong ${duration} s` : " (Ctrl+C để dừng)"),
);
for (const b of bots) {
  await connect(b);
  await sleep(rand(120, 350)); // vào lần lượt cho tự nhiên
}
