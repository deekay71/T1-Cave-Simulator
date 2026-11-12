/**
 * Vùng đi được gồm nhiều hang: hợp của các hình tròn trên mặt phẳng XZ (hang lớn, hang nhỏ, và
 * đường hầm là một chuỗi hình tròn nhỏ nối nhau). Thuần và tất định: chỉ + − × ÷ và sqrt, để
 * server và client ra cùng kết quả.
 */
export interface Room {
  readonly x: number;
  readonly z: number;
  /** Bán kính đi được (m). */
  readonly r: number;
  /** Trần cho camera (m); không đặt thì dùng trần chung. */
  readonly top?: number;
  /** Nhãn để debug và để tìm phòng theo tên. */
  readonly id?: string;
}

/** Khoảng cách có dấu tới biên của một phòng: âm là ở trong. */
const depth = (x: number, z: number, o: Room) =>
  Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z)) - o.r;

/** Điểm nằm trong ít nhất một phòng (cho phép lệch `skin` m ra ngoài biên). */
export function inRooms(x: number, z: number, rooms: readonly Room[], skin = 0): boolean {
  for (const o of rooms) if (depth(x, z, o) <= skin) return true;
  return false;
}

/**
 * Điểm gần (x, z) nhất nằm trong hợp các phòng. Điểm đã ở trong thì giữ nguyên. Hình chiếu xuyên
 * tâm lên phòng gần nhất luôn thuộc hợp, và không có điểm nào của hợp gần hơn.
 * Phòng đứng trước trong mảng thắng khi bằng nhau, nên kết quả không phụ thuộc engine.
 */
export function clampToRooms(
  x: number,
  z: number,
  rooms: readonly Room[],
): { x: number; z: number } {
  let best: Room | null = null,
    bestDepth = Infinity;
  for (const o of rooms) {
    const d = depth(x, z, o);
    if (d <= 0) return { x, z };
    if (d < bestDepth) {
      best = o;
      bestDepth = d;
    }
  }
  if (!best) return { x, z };
  const ox = x - best.x,
    oz = z - best.z,
    d = Math.sqrt(ox * ox + oz * oz);
  return { x: best.x + (ox / d) * best.r, z: best.z + (oz / d) * best.r };
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Đường hầm thẳng từ a tới b, rộng 2r: chuỗi hình tròn bán kính r, tâm cách nhau không quá `step`.
 * Vách hầm gợn tối đa r − sqrt(r² − (step/2)²) (≈ 5 cm với r 1,7 và step 0,8). Tâm làm tròn 1 mm.
 */
export function tunnelRooms(
  a: { x: number; z: number },
  b: { x: number; z: number },
  r: number,
  opts: { step?: number; top?: number; id?: string } = {},
): Room[] {
  const step = opts.step ?? 0.8;
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.sqrt(dx * dx + dz * dz);
  const n = Math.max(1, Math.ceil(length / step));
  const rooms: Room[] = [];
  for (let i = 0; i <= n; i++)
    rooms.push({
      x: mm(a.x + (dx * i) / n),
      z: mm(a.z + (dz * i) / n),
      r,
      ...(opts.top === undefined ? {} : { top: opts.top }),
      ...(opts.id === undefined ? {} : { id: opts.id }),
    });
  return rooms;
}

/**
 * Cần camera dài nhất b trong [0, want] sao cho mọi điểm pivot − dir·t (0 ≤ t ≤ b) nằm trong hợp
 * các phòng đã nới `margin` m và dưới trần của phòng chứa nó. Hợp các phòng không lồi, nên đi dọc
 * tia và nối các đoạn [vào, ra] của từng phòng, bắt đầu từ đoạn chứa pivot.
 * `dir` là hướng nhìn đơn vị (camera ở pivot − dir·b); `minY` là sàn cho camera.
 */
export function boomInRooms(
  pivot: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  want: number,
  rooms: readonly Room[],
  opts: { margin?: number; top?: number; minY?: number } = {},
): number {
  const margin = opts.margin ?? 0,
    defaultTop = opts.top ?? Infinity,
    minY = opts.minY ?? -Infinity;
  // camera(t) = pivot − dir·t
  const vx = -dir.x,
    vy = -dir.y,
    vz = -dir.z;
  let limit = want;
  if (vy < -1e-9) limit = Math.min(limit, (minY - pivot.y) / vy);
  if (!(limit > 0)) return 0;
  const a = vx * vx + vz * vz;
  const spans: [number, number][] = [];
  for (const o of rooms) {
    const R = o.r + margin,
      px = pivot.x - o.x,
      pz = pivot.z - o.z;
    let lo = 0,
      hi = limit;
    if (a > 1e-12) {
      const half = px * vx + pz * vz,
        c = px * px + pz * pz - R * R,
        disc = half * half - a * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      lo = Math.max(lo, (-half - root) / a);
      hi = Math.min(hi, (-half + root) / a);
    } else if (px * px + pz * pz > R * R) continue;
    const top = o.top ?? defaultTop;
    if (vy > 1e-9) hi = Math.min(hi, (top - pivot.y) / vy);
    else if (pivot.y > top) continue;
    if (hi >= lo) spans.push([lo, hi]);
  }
  // Nối các đoạn bắt đầu từ t = 0 (cho phép hở 1 mm do làm tròn).
  let reach = -1;
  for (const [lo, hi] of spans) if (lo <= 1e-3) reach = Math.max(reach, hi);
  if (reach < 0) return 0;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [lo, hi] of spans)
      if (lo <= reach + 1e-3 && hi > reach) {
        reach = hi;
        grew = true;
      }
  }
  return Math.max(0, Math.min(limit, reach));
}
