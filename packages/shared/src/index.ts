import { z } from "zod";
import { schema, t, type SchemaType } from "@colyseus/schema";

/** Số ghế tối đa của một room hub. */
export const ROOM_CAPACITY = 30;
/** Nhịp mô phỏng cố định (Hz). Server quảng bá nhịp này cho client qua handshake. */
export const TICK_RATE = 20;
/** Chu kỳ gửi patch state (ms). */
export const PATCH_MS = 100;
/** Tốc độ đi (m/s). */
export const MOVE_SPEED = 4;
/** Trục input lượng tử hóa vào int8: WASD là ±127, joystick là giá trị trung gian. */
export const AXIS_MAX = 127;
/** Mã đóng kết nối khi cùng tài khoản vừa vào ở phiên khác (4000–4099 do Colyseus dùng). */
export const CLOSE_SIGNED_IN_ELSEWHERE = 4100;

/** Bố cục tạm của hub cho tới khi có level.json (docs/tech-decisions.md, T12). */
export const HUB_LAYOUT = {
  /** Biên vùng đi được: hang bán kính 15 m, chừa 1 m sát vách. */
  radius: 14,
  /** Vật cản tròn trên mặt phẳng XZ: lửa trại ở tâm. */
  obstacles: [
    { x: 0, z: 0, r: 1.6 },
    { x: -9, z: -5, r: 1.2 },
    { x: 9, z: -5, r: 1.9 },
    { x: 7, z: 4, r: 1.1 },
  ],
  /** Cửa hang (docs/cameras-and-layout.md): xuất hiện quanh điểm này. */
  spawn: { x: 0, z: 10, spread: 1.5 },
} as const;
export type Layout = typeof HUB_LAYOUT;

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

/** Giữ một điểm trong vùng đi được và ngoài các vật cản. */
export function constrain(
  x: number,
  z: number,
  layout: Layout = HUB_LAYOUT,
): Position {
  for (const o of layout.obstacles) {
    const ox = x - o.x,
      oz = z - o.z,
      d = Math.hypot(ox, oz);
    if (d >= o.r) continue;
    if (d === 0) {
      x = o.x;
      z = o.z - o.r;
    } // đứng đúng tâm: đẩy về phía cửa hang
    else {
      x = o.x + (ox / d) * o.r;
      z = o.z + (oz / d) * o.r;
    }
  }
  const d = Math.hypot(x, z);
  if (d > layout.radius) {
    x = (x / d) * layout.radius;
    z = (z / d) * layout.radius;
  }
  return { x, z };
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
  const len = Math.hypot(dx, dz);
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
export const Emote = z.enum(["wave", "laugh", "cheer"]);

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
