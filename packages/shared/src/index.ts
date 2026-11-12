import { z } from "zod";
import { schema, t, type SchemaType } from "@colyseus/schema";
import {
  HUB_RADIUS,
  HUB_ROOMS,
  HUB_SPAWN,
  hubObstacles,
  type Obstacle,
} from "./layout.js";
import { clampToRooms, inRooms, type Room } from "./rooms.js";

export * from "./layout.js";
export * from "./rooms.js";
export * from "./nav.js";
export * from "./seats.js";

/** Số ghế tối đa của một room hub. */
export const ROOM_CAPACITY = 60;
/** Nhịp mô phỏng cố định (Hz). Server quảng bá nhịp này cho client qua handshake. */
export const TICK_RATE = 20;
/** Chu kỳ gửi patch state (ms). */
export const PATCH_MS = 50;
/** Tốc độ đi (m/s). */
export const MOVE_SPEED = 4;
/** Trục input lượng tử hóa vào int8: WASD là ±127, joystick là giá trị trung gian. */
export const AXIS_MAX = 127;
/** Mã đóng kết nối khi cùng tài khoản vừa vào ở phiên khác (4000–4099 do Colyseus dùng). */
export const CLOSE_SIGNED_IN_ELSEWHERE = 4100;

/** Bố cục va chạm: vùng đi được + vật cản tròn + điểm xuất hiện. */
export interface Layout {
  /**
   * Bán kính đĩa đi được quanh gốc (m). Với bố cục có `rooms` đây là bán kính hang lớn (phòng đầu
   * tiên); không có `rooms` thì đĩa này là toàn bộ vùng đi được (đảo điện thờ, test).
   */
  readonly radius: number;
  /** Vật cản tròn trên mặt phẳng XZ; obstacles[0] là vòng đá lửa trại ở tâm. */
  readonly obstacles: readonly Obstacle[];
  /** Người chơi xuất hiện quanh điểm này, nhìn về lửa trại và cửa hang (-Z). */
  readonly spawn: {
    readonly x: number;
    readonly z: number;
    readonly spread: number;
  };
  /** Vùng đi được là hợp các phòng tròn này (hang lớn, hang nhỏ, đường hầm); xem rooms.ts. */
  readonly rooms?: readonly Room[];
}

/**
 * Bố cục hub suy ra từ bảng đặt model (layout.ts): client dựng cảnh từ HUB_PLACEMENTS, server và
 * client va chạm với đúng các vật cản này, trong hợp các phòng HUB_ROOMS (hang lớn bán kính 20 m,
 * bốn hang nhỏ bán kính 7 m và bốn đường hầm nối).
 */
export const HUB_LAYOUT: Layout = {
  radius: HUB_RADIUS,
  obstacles: hubObstacles(),
  spawn: HUB_SPAWN,
  rooms: HUB_ROOMS,
};

/**
 * Dấu vân tay 8 ký tự hex của một bố cục (bán kính + vật cản + các phòng, đã làm tròn 1 mm): client
 * và server so với nhau để biết đang va chạm theo cùng một bảng (một tab mở từ trước lần deploy đổi
 * bố cục sẽ dự đoán lệch). FNV-1a trên chuỗi số, tất định ở mọi engine.
 */
export function layoutHash(
  layout: Pick<Layout, "radius" | "obstacles" | "rooms">,
): string {
  const num = (v: number) => v.toFixed(3);
  let text = [
    layout.radius,
    ...layout.obstacles.flatMap((o) => [o.x, o.z, o.r]),
  ]
    .map(num)
    .join(",");
  if (layout.rooms)
    text += "|" + layout.rooms.flatMap((o) => [o.x, o.z, o.r]).map(num).join(",");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
/** layoutHash(HUB_LAYOUT). */
export const HUB_LAYOUT_HASH = layoutHash(HUB_LAYOUT);

/** Input mỗi bước cố định. Chỉ gồm kiểu nguyên thủy, theo yêu cầu của defineInput(). */
export const MoveInput = schema({ moveX: t.int8(), moveZ: t.int8() });
export type MoveInput = SchemaType<typeof MoveInput>;

export interface Position {
  x: number;
  z: number;
}
export interface Axes {
  moveX: number;
  moveZ: number;
}

/** Lún sâu hơn ngưỡng này (m) mới tính là ở trong vật cản: điểm vừa bị đẩy ra nằm đúng trên biên. */
const SKIN = 1e-9;
const inside = (x: number, z: number, o: Obstacle) =>
  Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z)) < o.r - SKIN;
const insideAny = (x: number, z: number, obstacles: readonly Obstacle[]) =>
  obstacles.some((o) => inside(x, z, o));
/** Trong vùng đi được: hợp các phòng nếu bố cục có `rooms`, không thì đĩa gốc bán kính `radius`. */
const inBounds = (x: number, z: number, layout: Layout) =>
  layout.rooms
    ? inRooms(x, z, layout.rooms, SKIN)
    : Math.sqrt(x * x + z * z) <= layout.radius + SKIN;
/** Điểm đứng được: trong vùng đi được và ngoài mọi vật cản. */
const isFree = (x: number, z: number, layout: Layout) =>
  inBounds(x, z, layout) && !insideAny(x, z, layout.obstacles);

/** Đẩy p ra khỏi từng vật cản đang chứa nó, theo hướng từ tâm vật cản. Trả về true nếu có dịch chuyển. */
function pushOut(p: Position, obstacles: readonly Obstacle[]): boolean {
  let moved = false;
  for (const o of obstacles) {
    const ox = p.x - o.x,
      oz = p.z - o.z,
      d = Math.sqrt(ox * ox + oz * oz);
    if (d >= o.r - SKIN) continue;
    moved = true;
    if (d === 0) {
      p.x = o.x;
      p.z = o.z - o.r;
    } // đứng đúng tâm: đẩy về phía cửa hang
    else {
      p.x = o.x + (ox / d) * o.r;
      p.z = o.z + (oz / d) * o.r;
    }
  }
  return moved;
}

/** Hai giao điểm của hai đường tròn (nếu cắt nhau) đưa cho `consider`. */
function crossings(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
  consider: (x: number, z: number) => void,
): void {
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
}

/** Tầm xét trước của nearestFree (m): rộng hơn mọi bước đi (≤ 0,4 m), nên hầu như chỉ cần tầng này. */
const NEAR_REACH = 1;

/**
 * Điểm đứng được gần (x, z) nhất, chỉ xét các đường biên đi qua trong vòng `reach` m quanh điểm:
 * hình chiếu xuyên tâm lên từng vòng vật cản và lên biên từng phòng, giao điểm của hai vòng vật cản,
 * giao điểm của vật cản với biên phòng. Điểm trống gần nhất luôn là một trong các ứng viên đó (góc
 * giữa hai phòng là góc lõm của vùng đi được nên không bao giờ là điểm gần nhất); nếu nó cách (x, z)
 * không quá `reach` thì mọi đường biên đi qua nó đều đã được xét, nên kết quả là đúng. isFree lọc
 * các ứng viên nằm ngoài hợp các phòng hoặc trong vật cản khác.
 */
function nearestFreeWithin(
  x: number,
  z: number,
  layout: Layout,
  reach: number,
): Position | null {
  const { obstacles } = layout;
  const near: Obstacle[] = [];
  for (const o of obstacles) {
    const d = Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z));
    if (Math.abs(d - o.r) <= reach) near.push(o);
  }
  let best: Position | null = null,
    bestD = reach === Infinity ? Infinity : reach * reach;
  const consider = (px: number, pz: number) => {
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d > bestD || (best && d === bestD)) return;
    if (!isFree(px, pz, layout)) return;
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
  // Biên vùng đi được: từng phòng có biên đi qua trong tầm (bố cục một đĩa: chính đĩa đó).
  const walls = layout.rooms ?? [{ x: 0, z: 0, r: layout.radius }];
  const edges: { x: number; z: number; r: number }[] = [];
  for (const w of walls) {
    const wx = x - w.x,
      wz = z - w.z,
      dc = Math.sqrt(wx * wx + wz * wz);
    if (!(Math.abs(dc - w.r) <= reach)) continue;
    edges.push(w);
    if (dc === 0) consider(w.x, w.z - w.r);
    else consider(w.x + (wx / dc) * w.r, w.z + (wz / dc) * w.r);
  }
  for (let i = 0; i < near.length; i++) {
    const a = near[i];
    for (let j = i + 1; j < near.length; j++) {
      const b = near[j];
      crossings(a.x, a.z, a.r, b.x, b.z, b.r, consider);
    }
    for (const w of edges) crossings(w.x, w.z, w.r, a.x, a.z, a.r, consider);
  }
  return best;
}

/**
 * Dự phòng khi các lượt đẩy chưa hội tụ (điểm kẹt giữa hai vật cản chồng nhau, ví dụ đúng trên
 * đường nối tâm) hoặc khi một khối chặn sát vách (vật cản lấn qua biên) đẩy điểm ra ngoài bán kính:
 * điểm trống gần (x, z) nhất. Xét các đường biên trong vòng NEAR_REACH trước, rồi mới xét toàn bộ.
 */
function nearestFree(x: number, z: number, layout: Layout): Position | null {
  return (
    nearestFreeWithin(x, z, layout, NEAR_REACH) ??
    nearestFreeWithin(x, z, layout, Infinity)
  );
}

/**
 * Giữ một điểm trong vùng đi được và ngoài các vật cản. Vật cản chồng nhau có thể đẩy điểm sang
 * nhau, nên lặp tới khi đứng yên (tối đa 4 lượt; chưa hội tụ thì lấy điểm trống gần nhất), rồi kẹp
 * vào vùng đi được (điểm gần nhất của hợp các phòng, hoặc bán kính với bố cục một đĩa), rồi đẩy thêm
 * một lượt; điểm vẫn chưa hợp lệ (khối chặn sát vách lấn qua biên đẩy nó ra ngoài) thì lấy điểm trống
 * gần nhất. Với một vật cản đứng riêng, kết quả như đẩy xuyên tâm một lần.
 * Thuần và tất định (chỉ + − × ÷ và sqrt, đều làm tròn chuẩn IEEE): server và client ra cùng kết quả.
 */
export function constrain(
  x: number,
  z: number,
  layout: Layout = HUB_LAYOUT,
): Position {
  let p: Position = { x, z };
  let settled = false;
  for (let pass = 0; pass < 4 && !settled; pass++)
    settled = !pushOut(p, layout.obstacles);
  if (!settled && insideAny(p.x, p.z, layout.obstacles))
    p = nearestFree(x, z, layout) ?? p;
  if (layout.rooms) {
    const c = clampToRooms(p.x, p.z, layout.rooms);
    p.x = c.x;
    p.z = c.z;
  } else {
    const d = Math.sqrt(p.x * p.x + p.z * p.z);
    if (d > layout.radius) {
      p.x = (p.x / d) * layout.radius;
      p.z = (p.z / d) * layout.radius;
    }
  }
  pushOut(p, layout.obstacles);
  if (!isFree(p.x, p.z, layout)) p = nearestFree(x, z, layout) ?? p;
  return p;
}

/**
 * Một bước di chuyển cố định. Server (quyết định) và client (dự đoán) chạy CÙNG hàm này,
 * nên mọi thay đổi luật di chuyển chỉ được sửa ở đây.
 */
export function applyInput(
  p: Position,
  cmd: Axes,
  dt: number,
  layout: Layout = HUB_LAYOUT,
): void {
  let dx = cmd.moveX / AXIS_MAX,
    dz = cmd.moveZ / AXIS_MAX;
  // sqrt (làm tròn chuẩn IEEE), không dùng Math.hypot: hypot không được chuẩn hóa giữa các engine.
  const len = Math.sqrt(dx * dx + dz * dz);
  if (!(len > 0)) return; // đứng yên, hoặc NaN
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const step = MOVE_SPEED * Math.min(dt, 0.1);
  const next = constrain(p.x + dx * step, p.z + dz * step, layout);
  // State lưu float32: làm tròn ở đây để giá trị dự đoán trùng từng bit với giá trị server gửi về.
  p.x = Math.fround(next.x);
  p.z = Math.fround(next.z);
}

/** Điểm xuất hiện ngẫu nhiên quanh cửa hang. */
export function spawnPoint(
  rand: () => number = Math.random,
  layout: Layout = HUB_LAYOUT,
): Position {
  const { x, z, spread } = layout.spawn;
  const p = constrain(
    x + (rand() * 2 - 1) * spread,
    z + (rand() * 2 - 1) * spread,
    layout,
  );
  return { x: Math.fround(p.x), z: Math.fround(p.z) };
}

export const Chat = z.string().trim().min(1).max(240);
export const Emote = z.enum(["wave", "laugh", "cheer", "jump"]);

/** Giới hạn tần suất: tối đa `capacity` lần trong mỗi `perMs` (token bucket). */
export interface Limit {
  capacity: number;
  perMs: number;
}
export const LIMITS = {
  chat: {
    guest: { capacity: 3, perMs: 10_000 },
    member: { capacity: 5, perMs: 10_000 },
  },
  emote: { capacity: 2, perMs: 1_000 },
  ping: { capacity: 2, perMs: 1_000 },
} as const satisfies Record<string, Limit | Record<string, Limit>>;

export * from "./matches.js";

export * from "./altar.js";

export * from "./progression.js";
