import { z } from 'zod';

/** Shared, non-wagering gathering. All progress is temporary room/session state. */
export const ALTAR_CENTER = { x: 4, z: 4 } as const;
export const ALTAR_RADIUS = 3;
export const ALTAR_DURATION_MS = 30_000;
export const ALTAR_RESULTS_MS = 8_000;
export const ALTAR_LIMIT = { capacity: 3, perMs: 5_000 } as const;
export const ALTAR_PRESETS = {
  prayer: 'Cầu một trận đấu đẹp',
  cheer: 'Cùng nhau cổ vũ',
} as const;
export const AltarPreset = z.enum(['prayer', 'cheer']);
export type AltarPreset = z.infer<typeof AltarPreset>;
export const AltarRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), preset: AltarPreset }).strict(),
  z.object({ action: z.literal('leave') }).strict(),
]);
export type AltarRequest = z.infer<typeof AltarRequest>;
export interface AltarParticipant {
  sessionId: string;
  preset: AltarPreset;
}
export interface AltarSnapshot {
  phase: 'idle' | 'running' | 'completed';
  roundId: string | null;
  serverNow: number;
  startedAt: number | null;
  endsAt: number | null;
  resultsUntil: number | null;
  participantCount: number;
  participants: AltarParticipant[];
  completedSessionIds: string[];
}
export interface AltarCompletion {
  roundId: string;
  completedAt: number;
  badge: 'Đồng hành tại bàn thờ';
  /** Not an account entitlement, currency, reward ledger entry, or permanent unlock. */
  persistent: false;
}
export function nearAltar(position: { x: number; z: number }): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.z) &&
    (position.x - ALTAR_CENTER.x) ** 2 + (position.z - ALTAR_CENTER.z) ** 2 <= ALTAR_RADIUS ** 2;
}
