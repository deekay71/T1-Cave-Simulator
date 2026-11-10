import { randomUUID } from 'node:crypto';
import {
  ALTAR_DURATION_MS, ALTAR_LIMIT, ALTAR_RESULTS_MS, AltarRequest, nearAltar,
  type AltarCompletion, type AltarPreset, type AltarSnapshot,
} from '../../../packages/shared/src/altar.js';
import { RateLimiter } from './rateLimit.js';

/** Trusted room state only. Never construct this from a client payload. */
export interface AltarActor {
  x: number;
  z: number;
  connected: boolean;
  activeSeat: boolean;
}
export type AltarLookup = (sessionId: string) => AltarActor | undefined;
export interface AltarUpdate {
  changed: boolean;
  completed: { sessionId: string; result: AltarCompletion }[];
}
export type AltarError = 'rate-limit' | 'invalid-request' | 'inactive-seat' | 'too-far' | 'results';
export interface AltarActionResult extends AltarUpdate { error?: AltarError }

/** One shared round per hub, no database writes or persistent rewards. */
export class AltarActivity {
  private phase: AltarSnapshot['phase'] = 'idle';
  private roundId: string | null = null;
  private startedAt: number | null = null;
  private endsAt: number | null = null;
  private resultsUntil: number | null = null;
  private participants = new Map<string, AltarPreset>();
  private completedSessionIds: string[] = [];
  private badges = new Map<string, AltarCompletion>();
  private limiter = new RateLimiter();

  constructor(private readonly createRoundId: () => string = randomUUID) {}

  snapshot(now: number): AltarSnapshot {
    return {
      phase: this.phase, roundId: this.roundId, serverNow: now,
      startedAt: this.startedAt, endsAt: this.endsAt, resultsUntil: this.resultsUntil,
      participantCount: this.participants.size,
      participants: [...this.participants].map(([sessionId, preset]) => ({ sessionId, preset })),
      completedSessionIds: [...this.completedSessionIds],
    };
  }

  /** Heartbeat, join and reconnect all call this before publishing current state. */
  advance(now: number, lookup: AltarLookup): AltarUpdate {
    const update: AltarUpdate = { changed: false, completed: [] };
    if (this.phase === 'completed' && now >= this.resultsUntil!) {
      this.reset();
      update.changed = true;
    }
    if (this.phase !== 'running') return update;
    // Revalidate before completing, including if the server's timer was delayed.
    for (const sessionId of this.participants.keys()) {
      const actor = lookup(sessionId);
      if (!actor?.connected || !actor.activeSeat || !nearAltar(actor)) {
        this.participants.delete(sessionId);
        update.changed = true;
      }
    }
    if (!this.participants.size) {
      this.reset();
      update.changed = true;
    } else if (now >= this.endsAt!) {
      this.phase = 'completed';
      this.resultsUntil = now + ALTAR_RESULTS_MS;
      this.completedSessionIds = [...this.participants.keys()];
      for (const sessionId of this.completedSessionIds) {
        const result: AltarCompletion = {
          roundId: this.roundId!, completedAt: this.endsAt!,
          badge: 'Đồng hành tại bàn thờ', persistent: false,
        };
        this.badges.set(sessionId, result);
        update.completed.push({ sessionId, result });
      }
      update.changed = true;
    }
    return update;
  }

  request(sessionId: string, raw: unknown, now: number, lookup: AltarLookup): AltarActionResult {
    const update: AltarActionResult = this.advance(now, lookup);
    // Invalid payloads cost tokens too; unknown keys cannot smuggle custom text or scores.
    if (!this.limiter.allow(`${sessionId}:altar`, ALTAR_LIMIT, now)) return { ...update, error: 'rate-limit' };
    const parsed = AltarRequest.safeParse(raw);
    if (!parsed.success) return { ...update, error: 'invalid-request' };
    const actor = lookup(sessionId);
    if (!actor?.connected || !actor.activeSeat) return { ...update, error: 'inactive-seat' };
    if (parsed.data.action === 'leave') {
      update.changed = this.remove(sessionId) || update.changed;
      return update;
    }
    if (!nearAltar(actor)) return { ...update, error: 'too-far' };
    if (this.phase === 'completed') return { ...update, error: 'results' };
    if (this.phase === 'idle') {
      this.phase = 'running';
      this.roundId = this.createRoundId();
      this.startedAt = now;
      this.endsAt = now + ALTAR_DURATION_MS;
    }
    // A second join is idempotent: it cannot restart the clock or add a participant.
    if (this.participants.has(sessionId)) return update;
    this.participants.set(sessionId, parsed.data.preset);
    update.changed = true;
    return update;
  }

  /** A dropped/revoked seat loses participation immediately, even if it later reconnects. */
  remove(sessionId: string): boolean {
    if (this.phase !== 'running' || !this.participants.delete(sessionId)) return false;
    if (!this.participants.size) this.reset();
    return true;
  }

  completionFor(sessionId: string): AltarCompletion | undefined {
    const result = this.badges.get(sessionId);
    return result ? { ...result } : undefined;
  }

  forget(sessionId: string): boolean {
    const changed = this.remove(sessionId);
    this.badges.delete(sessionId);
    this.limiter.forget(`${sessionId}:`);
    return changed;
  }

  private reset(): void {
    this.phase = 'idle';
    this.roundId = this.startedAt = this.endsAt = this.resultsUntil = null;
    this.participants.clear();
    this.completedSessionIds = [];
  }
}
