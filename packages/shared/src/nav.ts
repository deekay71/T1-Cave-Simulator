/**
 * Tìm đường trong hub (năm hang): dùng chung cho bot (scripts/bots.ts) và tính năng tự đi tới đích
 * của client (apps/web/src/main.ts).
 *
 * Đồ thị điểm mốc: vòng quanh lửa trại, dọc các lối đi (HUB_WALKWAYS), tim từng đường hầm và trong
 * lòng mỗi hang nhỏ. Hai điểm nối nhau khi cách ≤ 13 m và đi thẳng giữa chúng không cắt vật cản,
 * không rời vùng đi được. Không tính đảo điện thờ (ở đó chỉ có một vật cản giữa đảo).
 */
import { HUB_CAVES, HUB_ROOMS, HUB_WALKWAYS, hubObstacles, type SideCave } from "./layout.js";
import { inRooms } from "./rooms.js";

export interface NavPoint {
  x: number;
  z: number;
}
type P = NavPoint;
/** Điểm trên trục từ gốc tới tâm hang `c`, cách gốc t m, lệch ngang lat m. */
export const onCaveAxis = (c: SideCave, t: number, lat = 0): P => {
  const d = Math.sqrt(c.x * c.x + c.z * c.z),
    ux = c.x / d,
    uz = c.z / d;
  return { x: ux * t - uz * lat, z: uz * t + ux * lat };
};
/** Cùng danh sách với HUB_LAYOUT.obstacles (index.ts), lấy thẳng từ bảng đặt đồ để tránh import vòng. */
const obstacles = hubObstacles();
/**
 * Điểm đứng được: nằm trong vùng đi được (hợp các phòng) cách biên ≥ `inset` m và cách mọi vật cản
 * thêm `margin` m (collider đã gồm thân người).
 */
export const navClearOf = (x: number, z: number, margin: number, inset = 0.5) =>
  inRooms(x, z, HUB_ROOMS, -inset) &&
  obstacles.every((o) => Math.hypot(x - o.x, z - o.z) >= o.r + margin);
/** Đi thẳng từ a tới b không cắt vật cản nào và không rời vùng đi được. */
export function navClearPath(a: P, b: P): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!navClearOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.12, 0.15))
      return false;
  }
  return true;
}

/**
 * Điểm mốc: vòng quanh lửa trại (r 6,5 m), dọc sáu lối đi (HUB_WALKWAYS: chỗ xuất hiện, cửa điện thờ,
 * bốn miệng hầm), tim mỗi đường hầm, và trong mỗi hang nhỏ (tâm + vòng r 3,6 m). Điểm bị vật cản
 * chiếm thì bỏ. Cạnh: hai điểm cách nhau ≤ 13 m và nhìn thấy nhau (clearPath).
 */
export const NAV_NODES: P[] = [];
{
  const add = (p: P) => {
    if (navClearOf(p.x, p.z, 0.3, 0.4)) NAV_NODES.push(p);
  };
  for (let a = 0; a < 360; a += 20)
    add({ x: 6.5 * Math.sin((a * Math.PI) / 180), z: 6.5 * Math.cos((a * Math.PI) / 180) });
  for (const w of HUB_WALKWAYS) {
    const d = Math.hypot(w.to.x, w.to.z);
    for (const t of [9.5, 13, 16.5]) if (t < d) add({ x: (w.to.x / d) * t, z: (w.to.z / d) * t });
  }
  for (const c of HUB_CAVES) {
    const d = Math.hypot(c.x, c.z);
    for (const t of [19.5, 22, 24.5, 27, 29.5, d - 5]) add(onCaveAxis(c, t));
    add({ x: c.x, z: c.z });
    for (let a = 0; a < 360; a += 45)
      add({ x: c.x + 3.6 * Math.sin((a * Math.PI) / 180), z: c.z + 3.6 * Math.cos((a * Math.PI) / 180) });
  }
}
export const NAV_EDGES: number[][] = NAV_NODES.map(() => []);
for (let i = 0; i < NAV_NODES.length; i++)
  for (let j = i + 1; j < NAV_NODES.length; j++)
    if (
      Math.hypot(NAV_NODES[i].x - NAV_NODES[j].x, NAV_NODES[i].z - NAV_NODES[j].z) <= 13 &&
      navClearPath(NAV_NODES[i], NAV_NODES[j])
    ) {
      NAV_EDGES[i].push(j);
      NAV_EDGES[j].push(i);
    }

/**
 * Đường đi từ `from` tới `to`: thẳng nếu thông, không thì đường ngắn nhất qua các điểm mốc (Dijkstra
 * trên đồ thị nhỏ, `from` và `to` nối với mọi điểm mốc chúng nhìn thấy). null nếu không có đường.
 */
export function findPath(from: P, to: P): P[] | null {
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
  if (dist(from, to) <= 13 && navClearPath(from, to)) return [to];
  const n = NAV_NODES.length;
  const cost = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  const done = new Array<boolean>(n + 1).fill(false);
  const goalLinks = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (dist(from, NAV_NODES[i]) <= 13 && navClearPath(from, NAV_NODES[i])) cost[i] = dist(from, NAV_NODES[i]);
    if (dist(to, NAV_NODES[i]) <= 13 && navClearPath(NAV_NODES[i], to)) goalLinks.add(i);
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i <= n; i++) if (!done[i] && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || cost[u] === Infinity) return null;
    if (u === n) break;
    done[u] = true;
    for (const v of NAV_EDGES[u]) {
      const c = cost[u] + dist(NAV_NODES[u], NAV_NODES[v]);
      if (c < cost[v]) {
        cost[v] = c;
        prev[v] = u;
      }
    }
    if (goalLinks.has(u)) {
      const c = cost[u] + dist(NAV_NODES[u], to);
      if (c < cost[n]) {
        cost[n] = c;
        prev[n] = u;
      }
    }
  }
  const path: P[] = [to];
  for (let u = prev[n]; u >= 0; u = prev[u]) path.unshift(NAV_NODES[u]);
  return path;
}
