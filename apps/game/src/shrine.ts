import {
  SHRINE_ENTRY, SHRINE_GESTURE_MS, SHRINE_LIMIT, SHRINE_SEAT_DISTANCE, SHRINE_SEATS,
  ShrineRequest, isInShrine, near, nearShrinePortal, shrineReturnPoint, shrineStandingPoint,
  type ShrineSnapshot,
} from '../../../packages/shared/src/shrine.js';
import { RateLimiter } from './rateLimit.js';

export interface ShrineActor {
  x: number;
  z: number;
  connected: boolean;
  shrineSeat: string;
  shrineGesture: string;
  shrineGestureAt: number;
}
export interface ShrineMember { player: ShrineActor; activeSeat: boolean }
export type ShrineLookup = (id: string) => ShrineMember | undefined;
export type ShrineError = 'invalid-request' | 'inactive-seat' | 'rate-limit' | 'too-far'
  | 'outside-shrine' | 'unknown-seat' | 'occupied-seat' | 'not-seated';
export interface ShrineUpdate { changed: boolean; error?: ShrineError }

/** Reservations, transport and poses change synchronously before any response is broadcast. */
export class ShrineActivity {
  private occupants = new Map<string, string>();
  private reservations = new Map<string, string>();
  private limiter = new RateLimiter();

  snapshot(now: number): ShrineSnapshot {
    return { serverNow: now, seats: SHRINE_SEATS.map(({ id }) => ({ id, occupant: this.occupants.get(id) ?? null })) };
  }

  request(sessionId: string, raw: unknown, now: number, lookup: ShrineLookup): ShrineUpdate {
    if (!this.limiter.allow(`${sessionId}:shrine`, SHRINE_LIMIT, now)) return { changed: false, error: 'rate-limit' };
    const parsed = ShrineRequest.safeParse(raw);
    if (!parsed.success) return { changed: false, error: 'invalid-request' };
    const member = lookup(sessionId);
    if (!member?.player.connected || !member.activeSeat) return { changed: false, error: 'inactive-seat' };
    const player = member.player, request = parsed.data;
    if (request.action === 'enter') {
      if (isInShrine(player)) return { changed: false };
      if (!nearShrinePortal(player)) return { changed: false, error: 'too-far' };
      this.remove(sessionId, lookup);
      Object.assign(player, { x: Math.fround(SHRINE_ENTRY.x), z: Math.fround(SHRINE_ENTRY.z) });
      return { changed: true };
    }
    if (!isInShrine(player)) return { changed: false, error: 'outside-shrine' };
    if (request.action === 'exit') {
      this.remove(sessionId, lookup);
      Object.assign(player, shrineReturnPoint());
      return { changed: true };
    }
    if (request.action === 'stand') return { changed: this.remove(sessionId, lookup) };
    if (request.action === 'sit') {
      const seat = SHRINE_SEATS.find(({ id }) => id === request.seatId);
      if (!seat) return { changed: false, error: 'unknown-seat' };
      const occupant = this.occupants.get(seat.id);
      if (occupant === sessionId) return { changed: false };
      if (occupant) return { changed: false, error: 'occupied-seat' };
      if (!near(player, seat, SHRINE_SEAT_DISTANCE)) return { changed: false, error: 'too-far' };
      // Check the destination before releasing a prior reservation; a failed switch keeps the old seat.
      this.remove(sessionId, lookup);
      this.occupants.set(seat.id, sessionId);
      this.reservations.set(sessionId, seat.id);
      Object.assign(player, { x: seat.x, z: seat.z, shrineSeat: seat.id, shrineGesture: '', shrineGestureAt: 0 });
      return { changed: true };
    }
    const seat = this.reservations.get(sessionId);
    if (!seat || this.occupants.get(seat) !== sessionId || player.shrineSeat !== seat) {
      return { changed: false, error: 'not-seated' };
    }
    player.shrineGesture = request.gesture;
    player.shrineGestureAt = now;
    return { changed: true };
  }

  /** Defensively release invalid reservations and finish transient animations. */
  advance(now: number, lookup: ShrineLookup): ShrineUpdate {
    let changed = false;
    for (const [sessionId, seatId] of this.reservations) {
      const member = lookup(sessionId);
      const player = member?.player;
      if (!member?.activeSeat || !player?.connected || !isInShrine(player) || player.shrineSeat !== seatId) {
        changed = this.remove(sessionId, lookup) || changed;
        continue;
      }
      if (player.shrineGesture && now >= player.shrineGestureAt + SHRINE_GESTURE_MS) {
        player.shrineGesture = '';
        player.shrineGestureAt = 0;
        changed = true;
      }
    }
    return { changed };
  }

  /** Disconnect, leave, eviction and stand all release immediately. Reconnection never reclaims a seat. */
  remove(sessionId: string, lookup: ShrineLookup, forget = false): boolean {
    const id = this.reservations.get(sessionId);
    let changed = false;
    if (id) {
      if (this.occupants.get(id) === sessionId) this.occupants.delete(id);
      this.reservations.delete(sessionId);
      changed = true;
    }
    const player = lookup(sessionId)?.player;
    if (player) {
      const seat = SHRINE_SEATS.find((seat) => seat.id === id);
      if (seat && isInShrine(player)) Object.assign(player, shrineStandingPoint(seat));
      changed = Boolean(player.shrineSeat || player.shrineGesture) || changed;
      player.shrineSeat = '';
      player.shrineGesture = '';
      player.shrineGestureAt = 0;
    }
    if (forget) this.limiter.forget(`${sessionId}:`);
    return changed;
  }
}
