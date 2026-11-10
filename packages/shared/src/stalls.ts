/** Shared physical destinations. Original procedural fan homages, not official player assets. */
export type CaveStallId = 'checkin' | 'shop' | 'quiz' | 'tv' | 'memory';
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
export const CAVE_SHRINE_GATE = { x: 0, z: -15.8, yaw: 0 } as const;
export const CAVE_STALLS: readonly CaveStall[] = [
  { id: 'checkin', name: 'ĐIỂM DANH', npc: 'Oner', role: 'Chào mừng về hang', x: 4, z: 8, yaw: -153, accent: '#DA4A48' },
  { id: 'shop', name: 'QUẦY TRANG PHỤC', npc: 'Peyz', role: 'Đồ nghề fan cứng', x: 10, z: 1.5, yaw: -101, accent: '#8DAFC5' },
  { id: 'quiz', name: 'ĐỐ VUI T1', npc: 'Keria', role: 'Thử trí nhớ của bạn', x: -10, z: 6, yaw: 95, accent: '#D9B75E' },
  { id: 'tv', name: 'TRẬN ĐẤU T1', npc: 'Doran', role: 'Cùng chờ giờ thi đấu', x: -7.3, z: -2.55, yaw: 71, accent: '#B3B7E0' },
  { id: 'memory', name: 'KÝ ỨC HUY HOÀNG', npc: 'Người giữ ký ức', role: 'Những mùa giải đáng nhớ', x: -6.294, z: -12.394, yaw: 27, accent: '#CBA36B' },
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
