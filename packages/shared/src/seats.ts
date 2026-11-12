/**
 * Chỗ ngồi trong hang: mọi ghế đẩu, thùng gỗ và phiến đá thấp của bảng đặt đồ (HUB_PLACEMENTS) mà
 * không có fan NPC ngồi sẵn và không có đồ đặt bên trên. Server giữ chỗ (một ghế một người) và đặt
 * người chơi vào đúng tâm ghế; đứng dậy thì trả về chỗ đứng trước khi ngồi. Ghế của điện thờ là
 * hệ riêng (shrine.ts).
 */
import { z } from "zod";
import { HUB_PLACEMENTS } from "./layout.js";

export interface CaveSeat {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Độ cao mặt ngồi (m). */
  readonly h: number;
}
/** Mặt ngồi (m) của từng model ở tỉ lệ 1; đá thấp ngồi ngay trên đỉnh. */
const SEAT_TOP: Readonly<Record<string, number>> = {
  "furniture/tl_furn_stool_v01": 0.42,
  "furniture/tl_furn_stool_square_v01": 0.44,
  "furniture/tl_furn_crate_small_v01": 0.47,
  "furniture/tl_furn_crate_large_v01": 0.8,
  "environment/tl_env_stone_small_a_v01": 0.15,
  "environment/tl_env_stone_small_d_v01": 0.12,
};
/** Đá thấp hơn mức này (m) thì không tính là chỗ ngồi. */
const MIN_SEAT = 0.24;
/** Đứng cách tâm ghế không quá ngần này (m) mới ngồi được. */
export const CAVE_SEAT_REACH = 1.7;

export const CAVE_SEATS: readonly CaveSeat[] = HUB_PLACEMENTS.flatMap((p, i) => {
  const top = SEAT_TOP[p.asset];
  if (top === undefined || p.npc || p.y) return [];
  const h = Math.round(top * (p.scale ?? 1) * 100) / 100;
  if (h < MIN_SEAT) return [];
  // Có fan NPC ngồi/đứng sát đó, hoặc có đồ đặt bên trên (ấm, cốc, đèn, thùng chồng): không ngồi được.
  const taken = HUB_PLACEMENTS.some(
    (q) => q !== p && (q.npc || (q.y ?? 0) > 0) && Math.hypot(q.x - p.x, q.z - p.z) < (q.npc ? 0.55 : 0.75),
  );
  return taken ? [] : [{ id: `s${i}`, x: Math.fround(p.x), z: Math.fround(p.z), h }];
});
const BY_ID = new Map(CAVE_SEATS.map((s) => [s.id, s]));
export const caveSeat = (id: string): CaveSeat | undefined => BY_ID.get(id);

export const CaveSeatRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sit"), seatId: z.string().min(1).max(16) }).strict(),
  z.object({ action: z.literal("stand") }).strict(),
]);
export type CaveSeatRequest = z.infer<typeof CaveSeatRequest>;

/** Phần state của người chơi mà chỗ ngồi đọc và ghi. */
export interface SeatedPlayer {
  x: number;
  z: number;
  seat: string;
  seatYaw: number;
}
export type CaveSeatError = "unknown-seat" | "occupied-seat" | "too-far" | "not-seated";

/** Giữ chỗ ngồi của một room. Thuần logic: không biết gì về mạng. */
export class CaveSeating {
  private occupants = new Map<string, string>();
  private returns = new Map<string, { seat: string; x: number; z: number }>();

  occupant(seatId: string): string | undefined {
    return this.occupants.get(seatId);
  }
  /** Ngồi xuống: người chơi được đặt vào tâm ghế, quay mặt về phía vừa đứng. */
  sit(sessionId: string, player: SeatedPlayer, seatId: string): CaveSeatError | null {
    const seat = BY_ID.get(seatId);
    if (!seat) return "unknown-seat";
    const holder = this.occupants.get(seatId);
    if (holder === sessionId) return null;
    if (holder) return "occupied-seat";
    // Đang ngồi ghế khác: tính khoảng cách từ chỗ đứng cũ, để không "nhảy cóc" qua các ghế.
    const from = this.returns.get(sessionId) ?? { x: player.x, z: player.z };
    const dx = from.x - seat.x,
      dz = from.z - seat.z;
    if (!(dx * dx + dz * dz <= CAVE_SEAT_REACH * CAVE_SEAT_REACH)) return "too-far";
    const prior = this.returns.get(sessionId);
    if (prior) this.occupants.delete(prior.seat);
    this.occupants.set(seatId, sessionId);
    this.returns.set(sessionId, { seat: seatId, x: from.x, z: from.z });
    player.x = seat.x;
    player.z = seat.z;
    player.seat = seatId;
    player.seatYaw = Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
    return null;
  }
  /** Đứng dậy: về lại chỗ đứng trước khi ngồi. */
  stand(sessionId: string, player: SeatedPlayer): CaveSeatError | null {
    const back = this.returns.get(sessionId);
    if (!back) return "not-seated";
    this.occupants.delete(back.seat);
    this.returns.delete(sessionId);
    player.x = Math.fround(back.x);
    player.z = Math.fround(back.z);
    player.seat = "";
    return null;
  }
  /** Người chơi rời room: trả ghế, không đụng tới state của họ. */
  forget(sessionId: string): void {
    const back = this.returns.get(sessionId);
    if (back) this.occupants.delete(back.seat);
    this.returns.delete(sessionId);
  }
}
