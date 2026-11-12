/** Shared physical destinations. Original procedural fan homages, not official player assets. */
export type CaveStallId = 'checkin' | 'shop' | 'quiz' | 'quest' | 'memory';
export interface CaveStall {
  readonly id: CaveStallId;
  readonly name: string;
  readonly npc: string;
  readonly role: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly accent: string;
}
export const CAVE_STALL_RADIUS = 2.5;
/** Where a player stands to enter the shrine: just inside the walk limit, in front of the exit tunnel (mouth plane z = -23.4, door frame z = -22.45). */
export const CAVE_SHRINE_GATE = { x: 0, z: -19.9, yaw: 0 } as const;
/**
 * The check-in stall stands by the spawn in the main cave. The other four stand at the rock niche of
 * their own side cave (packages/shared/src/layout.ts HUB_CAVES), facing the cave centre: x, z is the
 * stall's main object (board, crate shelf, counter) at the niche's focal point, yaw the niche frame's.
 * scripts/stalls.test.ts checks these against HUB_CAVES.
 */
export const CAVE_STALLS: readonly CaveStall[] = [
  { id: 'checkin', name: 'ĐIỂM DANH', npc: 'Oner', role: 'Chào mừng về hang', x: 4, z: 8, yaw: -153, accent: '#DA4A48' },
  { id: 'shop', name: 'QUẦY TRANG PHỤC', npc: 'Peyz', role: 'Đồ nghề fan cứng', x: 38.635, z: 17.571, yaw: -82.0333, accent: '#8DAFC5' },
  { id: 'quiz', name: 'ĐỐ VUI T1', npc: 'Keria', role: 'Thử trí nhớ của bạn', x: -38.233, z: 22.104, yaw: 120.0333, accent: '#D9B75E' },
  { id: 'quest', name: 'BẢNG QUEST', npc: 'Doran', role: 'Quest về T1', x: 38.233, z: -22.104, yaw: -59.9667, accent: '#B3B7E0' },
  { id: 'memory', name: 'KÝ ỨC HUY HOÀNG', npc: 'Người giữ ký ức', role: 'Những mùa giải đáng nhớ', x: -39.131, z: -17.502, yaw: 97.9667, accent: '#CBA36B' },
];
export function stallApproach(stall: CaveStall) {
  const a = stall.yaw * Math.PI / 180;
  return { x: Math.round((stall.x + Math.sin(a) * 1.8) * 1000) / 1000, z: Math.round((stall.z + Math.cos(a) * 1.8) * 1000) / 1000 };
}
export function nearCaveStall(p: { x: number; z: number }, id: CaveStallId): boolean {
  const s = CAVE_STALLS.find(s => s.id === id);
  if (!s || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const target = stallApproach(s);
  return Math.hypot(p.x - target.x, p.z - target.z) <= CAVE_STALL_RADIUS;
}
export function closestCaveStall(p: { x: number; z: number }): CaveStall | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  let best: CaveStall | null = null, distance = CAVE_STALL_RADIUS;
  for (const s of CAVE_STALLS) {
    const target = stallApproach(s);
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    if (d <= distance) { best = s; distance = d; }
  }
  return best;
}
