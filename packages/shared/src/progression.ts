import { z } from 'zod';

/** Earned in-game points only. No cash value, payments, transfers or cash-out. */
export const CAVE_CURRENCY = { key: 'cave_coins', name: 'Xu Hang' } as const;
export const COSMETICS = [
  { id: 'fan-cap-red', name: 'Mũ đỏ cổ vũ', description: 'Bộ fan mũ đỏ.', assetKey: 'tl_char_fan_cap_red_v01', price: 50 },
  { id: 'fan-hoodie-white', name: 'Hoodie trắng', description: 'Bộ fan hoodie trắng.', assetKey: 'tl_char_fan_hoodie_white_v01', price: 100 },
  { id: 'fan-headband', name: 'Băng đô quyết tâm', description: 'Bộ fan đeo băng đô.', assetKey: 'tl_char_fan_headband_v01', price: 150 },
  { id: 'cave-ragged-shorts', name: 'Quần đùi rách', description: 'Phong cách cư dân hang.', assetKey: 'tl_char_fan_headband_v01', price: 25, slot: 'outfit', styleKey: 'cave-ragged-shorts' },
  { id: 'cave-tshirt', name: 'Áo thun', description: 'Áo thun cổ vũ.', assetKey: 'tl_char_fan_cap_red_v01', price: 50, slot: 'outfit', styleKey: 'cave-tshirt' },
  { id: 'cave-tank-top', name: 'Áo ba lỗ', description: 'Mát mẻ trong hang.', assetKey: 'tl_char_fan_headband_v01', price: 60, slot: 'outfit', styleKey: 'cave-tank-top' },
  { id: 'cave-jersey', name: 'Áo đấu', description: 'Sắc đỏ ngày thi đấu.', assetKey: 'tl_char_fan_hoodie_white_v01', price: 100, slot: 'outfit', styleKey: 'cave-jersey' },
  { id: 'cave-glasses', name: 'Kính cổ vũ', description: 'Diện mạo fan đeo kính.', assetKey: 'tl_char_fan_cap_red_v01', price: 75, slot: 'accessory', styleKey: 'cave-glasses' },
  { id: 'cave-keyboard', name: 'Bàn phím cầm tay', description: 'Đạo cụ cổ vũ trong hang.', assetKey: 'tl_char_fan_headband_v01', price: 125, slot: 'handheld', styleKey: 'cave-keyboard' },
] as const;

export interface CosmeticItem {
  id: string;
  name: string;
  description: string;
  assetKey: string;
  price: number;
  slot?: 'outfit' | 'accessory' | 'handheld';
  styleKey?: string;
}

export interface ProgressionState {
  enabled: boolean;
  authenticated: boolean;
  account: { id: string; name: string } | null;
  currency: { key: 'cave_coins'; name: 'Xu Hang'; balance: number };
  experience: ExperienceState;
  quiz: QuizState;
  daily: {
    day: string | null;
    timezone: 'UTC';
    claimed: boolean;
    streak: number;
    totalCheckins: number;
    rewardEligible: boolean;
    nextRewardCheckin: number;
    reward: number;
    nextAt: string | null;
  };
  catalog: CosmeticItem[];
  inventory: string[];
  equippedItemId: string | null;
  avatarKey: string | null;
}

export const PurchaseRequest = z.object({
  itemId: z.string().min(1).max(80),
  idempotencyKey: z.uuid(),
}).strict();
export const EquipRequest = z.object({ itemId: z.string().min(1).max(80).nullable() }).strict();

export interface CheckInResult { claimed: boolean; reward: number; xpEarned: number; state: ProgressionState }
export interface PurchaseResult { purchased: boolean; replayed: boolean; state: ProgressionState }

export const RANKS = [
  { level: 1, title: 'Tê con mới nhú', minXp: 0 },
  { level: 2, title: 'Tê Thở', minXp: 100 },
  { level: 3, title: 'Tê Nạng', minXp: 300 },
  { level: 4, title: 'Tê Lăn', minXp: 700 },
  { level: 5, title: 'Tê Liệt', minXp: 1500 },
] as const;
export type CaveRank = typeof RANKS[number];
export interface ExperienceState { xp: number; rank: CaveRank; nextRank: CaveRank | null }
export function experienceState(xp: number): ExperienceState {
  const rank = [...RANKS].reverse().find(rank => xp >= rank.minXp) || RANKS[0];
  return { xp, rank, nextRank: RANKS.find(candidate => candidate.level === rank.level + 1) || null };
}
export const QUIZ_ATTEMPT_LIMIT = 3;
export const QUIZ_QUESTION_COUNT = 5;
export const QUIZ_CORRECT_XP = 10;
export const CHECKIN_XP = 20;
export interface QuizQuestion { id: string; prompt: string; options: string[] }
export interface QuizAttempt { id: string; day: string; questions: QuizQuestion[] }
export interface QuizState {
  day: string | null; timezone: 'UTC'; attemptLimit: number;
  attemptsUsed: number; remaining: number; activeAttempt: QuizAttempt | null;
}
export interface QuizStartResult { attempt: QuizAttempt; state: ProgressionState }
export interface QuizSubmitResult {
  attemptId: string; correct: number; total: number; xpEarned: number; replayed: boolean; state: ProgressionState;
}
export const QuizSubmitRequest = z.object({
  attemptId: z.uuid(), answers: z.array(z.number().int().min(0).max(3)).length(QUIZ_QUESTION_COUNT),
}).strict();

/** Counts every attendance day, not consecutive streak: days 1..15, then 18,21,... */
export function dailyReward(attendanceDay: number): number {
  return Number.isInteger(attendanceDay) && attendanceDay > 0 &&
    (attendanceDay <= 15 || attendanceDay % 3 === 0) ? 25 : 0;
}
export function nextRewardCheckin(attendanceDay: number): number {
  return attendanceDay <= 15 ? Math.max(1, attendanceDay) : Math.ceil(attendanceDay / 3) * 3;
}
export interface GalleryItem { id: string; title: string; imageUrl: string; credit: string; sourceUrl?: string }
export interface GalleryState {
  items: GalleryItem[];
  contribution: { enabled: false; proposedCost: number; reason: string };
}
/** Curated images only. Contributions remain closed until upload validation and review exist. */
export function galleryState(): GalleryState {
  return { items: [], contribution: { enabled: false, proposedCost: 25,
    reason: 'Góp ảnh chưa mở: cần kiểm duyệt và kiểm tra tệp an toàn. Chưa tải lên hay thu xu.',
  } };
}

export function emptyProgression(enabled: boolean): ProgressionState {
  return {
    enabled, authenticated: false, account: null,
    currency: { ...CAVE_CURRENCY, balance: 0 },
    experience: experienceState(0),
    quiz: { day: null, timezone: 'UTC', attemptLimit: QUIZ_ATTEMPT_LIMIT, attemptsUsed: 0, remaining: QUIZ_ATTEMPT_LIMIT, activeAttempt: null },
    daily: { day: null, timezone: 'UTC', claimed: false, streak: 0, totalCheckins: 0,
      rewardEligible: true, nextRewardCheckin: 1, reward: dailyReward(1), nextAt: null },
    catalog: COSMETICS.map(item => ({ ...item })), inventory: [], equippedItemId: null, avatarKey: null,
  };
}
