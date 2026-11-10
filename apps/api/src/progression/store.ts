import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CAVE_CURRENCY, COSMETICS, dailyReward, emptyProgression, experienceState, nextRewardCheckin,
  CHECKIN_XP, QUIZ_ATTEMPT_LIMIT, QUIZ_CORRECT_XP, QuizSubmitRequest,
  type QuizAttempt, type QuizStartResult, type QuizSubmitResult,
  type CheckInResult, type CosmeticItem, type ProgressionState, type PurchaseResult,
} from '../../../../packages/shared/src/progression.js';
import { pickQuestions, publicQuestions, type GradedQuestion } from './questions.js';
import { ProgressionError, SESSION_TTL_SECONDS } from './security.js';

export interface GuestIdentity { id: string; name: string; avatarKey: string | null }
type Queryable = Pick<PoolClient, 'query'>;
interface WalletRow {
  account_id: string; display_name: string; avatar_key: string;
  balance: number; xp: number; total_checkins: number; equipped_item_id: string | null; last_checkin_day: string | null; streak: number; day: string;
}
interface AttemptRow { id: string; day: string; questions: GradedQuestion[]; answers: number[] | null; correct: number | null; xp_earned: number | null; submitted_at: string | null }
const publicAttempt = (row: AttemptRow): QuizAttempt => ({ id: row.id, day: row.day, questions: publicQuestions(row.questions) });
function cosmeticMetadata(item: CosmeticItem): CosmeticItem {
  const metadata = COSMETICS.find(candidate => candidate.id === item.id);
  return metadata ? { ...metadata, ...item } : item;
}
const knownItems = COSMETICS.map(item => item.id);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
export function nextStreak(lastDay: string | null, streak: number, today: string): number {
  if (lastDay === today) return streak;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return lastDay === yesterday ? streak + 1 : 1;
}

/** Row locks serialize every wallet mutation across API instances. No process-local balances. */
export class ProgressionStore {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}

  private async transaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { db.release(); }
  }

  async findSession(tokenHash: string): Promise<GuestIdentity | null> {
    return this.transaction(async db => {
      const { rows } = await db.query<GuestIdentity>(
        `SELECT a.id, a.display_name AS name, NULLIF(p.avatar_key, 'default') AS "avatarKey"
         FROM guest_sessions s JOIN accounts a ON a.id = s.account_id
         JOIN profiles p ON p.account_id = a.id
         WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND a.deleted_at IS NULL AND a.kind = 'guest'`,
        [tokenHash],
      );
      return rows[0] || null;
    });
  }

  async createGuest(name: string, tokenHash: string): Promise<GuestIdentity> {
    return this.transaction(async db => {
      const id = randomUUID();
      await db.query('INSERT INTO accounts(id, display_name) VALUES ($1, $2)', [id, name]);
      await db.query('INSERT INTO profiles(account_id) VALUES ($1)', [id]);
      await db.query('INSERT INTO progression_wallets(account_id) VALUES ($1)', [id]);
      await db.query(`INSERT INTO guest_sessions(token_hash, account_id, expires_at)
        VALUES ($1, $2, clock_timestamp() + $3 * interval '1 second')`, [tokenHash, id, SESSION_TTL_SECONDS]);
      return { id, name, avatarKey: null };
    });
  }

  async renameGuest(id: string, name: string): Promise<void> {
    await this.transaction(async db => {
      const result = await db.query("UPDATE accounts SET display_name = $2 WHERE id = $1 AND deleted_at IS NULL AND kind = 'guest' RETURNING id", [id, name]);
      if (!result.rows.length) throw new ProgressionError('session_required', 401, 'Vào hang để bắt đầu phiên khách.');
    });
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.transaction(async db => { await db.query('DELETE FROM guest_sessions WHERE token_hash = $1', [tokenHash]); });
  }

  private async wallet(db: Queryable, id: string): Promise<WalletRow> {
    const { rows } = await db.query<WalletRow>(
      `SELECT w.account_id, w.balance, w.last_checkin_day::text, w.streak, w.total_checkins, w.xp, a.display_name, p.avatar_key,
        p.settings->>'equippedItemId' AS equipped_item_id,
        (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day
       FROM progression_wallets w JOIN accounts a ON a.id = w.account_id
       JOIN profiles p ON p.account_id = a.id
       WHERE w.account_id = $1 AND a.deleted_at IS NULL AND a.kind = 'guest'
       FOR UPDATE OF w`, [id],
    );
    if (!rows[0]) throw new ProgressionError('session_required', 401, 'Vào hang để bắt đầu phiên khách.');
    return rows[0];
  }

  private async state(db: Queryable, row: WalletRow): Promise<ProgressionState> {
    const { rows: catalog } = await db.query<CosmeticItem>(
      `SELECT id, display_name AS name, description, asset_key AS "assetKey", price
       FROM catalog_items WHERE enabled AND category = 'avatar' AND id = ANY($1::text[]) ORDER BY price, id`, [knownItems],
    );
    const { rows: inventory } = await db.query<{ item_id: string; asset_key: string }>(
      `SELECT i.item_id, c.asset_key FROM inventory i JOIN catalog_items c ON c.id = i.item_id
       WHERE i.account_id = $1 AND i.quantity > 0 AND c.id = ANY($2::text[]) ORDER BY i.item_id`, [row.account_id, knownItems],
    );
    const claimed = row.last_checkin_day === row.day;
    const streak = claimed ? row.streak : nextStreak(row.last_checkin_day, row.streak, row.day);
    const equippedItemId = inventory.find(item => row.equipped_item_id ? item.item_id === row.equipped_item_id : item.asset_key === row.avatar_key)?.item_id || null;
    const { rows: attempts } = await db.query<AttemptRow>('SELECT id, day::text, questions, submitted_at FROM progression_quiz_attempts WHERE account_id = $1 AND day = $2 ORDER BY ordinal', [row.account_id, row.day]);
    const active = attempts.find(attempt => !attempt.submitted_at);
    const attendanceDay = row.total_checkins + (claimed ? 0 : 1);
    return {
      enabled: true, authenticated: true, account: { id: row.account_id, name: row.display_name },
      currency: { ...CAVE_CURRENCY, balance: row.balance },
      experience: experienceState(row.xp),
      quiz: { day: row.day, timezone: 'UTC', attemptLimit: QUIZ_ATTEMPT_LIMIT, attemptsUsed: attempts.length, remaining: QUIZ_ATTEMPT_LIMIT - attempts.length, activeAttempt: active ? publicAttempt(active) : null },
      daily: { day: row.day, timezone: 'UTC', claimed, streak: claimed ? row.streak : Math.max(0, streak - 1),
        totalCheckins: row.total_checkins, rewardEligible: dailyReward(attendanceDay) > 0,
        nextRewardCheckin: nextRewardCheckin(row.total_checkins + 1), reward: dailyReward(attendanceDay), nextAt: nextDay(row.day) },
      catalog: catalog.map(cosmeticMetadata), inventory: inventory.map(item => item.item_id), equippedItemId,
      avatarKey: equippedItemId ? row.avatar_key : null,
    };
  }

  async read(id: string): Promise<ProgressionState> {
    return this.transaction(async db => this.state(db, await this.wallet(db, id)));
  }

  async anonymous(): Promise<ProgressionState> {
    return this.transaction(async db => {
      const result = emptyProgression(true);
      const { rows } = await db.query<CosmeticItem>(`SELECT id, display_name AS name, description, asset_key AS "assetKey", price
        FROM catalog_items WHERE enabled AND category = 'avatar' AND id = ANY($1::text[]) ORDER BY price, id`, [knownItems]);
      result.catalog = rows.map(cosmeticMetadata);
      return result;
    });
  }

  async checkIn(id: string): Promise<CheckInResult> {
    return this.transaction(async db => {
      let row = await this.wallet(db, id);
      const streak = nextStreak(row.last_checkin_day, row.streak, row.day);
      const reward = dailyReward(row.total_checkins + 1);
      const xp = reward > 0 ? CHECKIN_XP : 0;
      const result = await db.query(`INSERT INTO daily_checkins(account_id, day, streak, reward) VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id, day) DO NOTHING RETURNING day`, [id, row.day, streak, reward]);
      if (!result.rows.length) return { claimed: false, reward: 0, xpEarned: 0, state: await this.state(db, row) };
      if (reward > 0) {
        await db.query(`INSERT INTO reward_ledger(id, account_id, source_type, source_id, reward_key, amount) VALUES ($1, $2, 'daily_checkin', $3, 'cave_coins', $4), ($5, $2, 'daily_checkin', $3, 'xp', $6)`, [randomUUID(), id, row.day, reward, randomUUID(), xp]);
      }
      await db.query(`UPDATE progression_wallets SET balance = balance + $2, last_checkin_day = $3,
        streak = $4, total_checkins = total_checkins + 1, xp = xp + $5 WHERE account_id = $1`, [id, reward, row.day, streak, xp]);
      row = { ...row, balance: row.balance + reward, last_checkin_day: row.day, streak, xp: row.xp + xp, total_checkins: row.total_checkins + 1 };
      return { claimed: true, reward, xpEarned: xp, state: await this.state(db, row) };
    });
  }


  async startQuiz(id: string): Promise<QuizStartResult> {
    return this.transaction(async db => {
      const row = await this.wallet(db, id);
      const { rows } = await db.query<AttemptRow>('SELECT id, day::text, questions, submitted_at FROM progression_quiz_attempts WHERE account_id = $1 AND day = $2 ORDER BY ordinal', [id, row.day]);
      const active = rows.find(attempt => !attempt.submitted_at);
      if (active) return { attempt: publicAttempt(active), state: await this.state(db, row) };
      if (rows.length >= QUIZ_ATTEMPT_LIMIT) throw new ProgressionError('quiz_limit', 409, 'Đã dùng hết 3 lượt hôm nay. Lượt mới mở lúc 00:00 UTC.');
      const attempt = { id: randomUUID(), day: row.day, questions: pickQuestions() } as AttemptRow;
      await db.query('INSERT INTO progression_quiz_attempts(id, account_id, day, ordinal, questions) VALUES ($1, $2, $3, $4, $5::jsonb)', [attempt.id, id, row.day, rows.length + 1, JSON.stringify(attempt.questions)]);
      return { attempt: publicAttempt(attempt), state: await this.state(db, row) };
    });
  }

  async submitQuiz(id: string, attemptId: string, answers: number[]): Promise<QuizSubmitResult> {
    if (!QuizSubmitRequest.safeParse({ attemptId, answers }).success)
      throw new ProgressionError('invalid_request', 400, 'Cần đủ 5 câu trả lời hợp lệ.');
    return this.transaction(async db => {
      let row = await this.wallet(db, id);
      const { rows } = await db.query<AttemptRow>('SELECT id, day::text, questions, answers, correct, xp_earned, submitted_at FROM progression_quiz_attempts WHERE id = $1 AND account_id = $2', [attemptId, id]);
      const attempt = rows[0];
      if (!attempt) throw new ProgressionError('quiz_not_found', 404, 'Không tìm thấy lượt đố này.');
      if (attempt.submitted_at) {
        if (JSON.stringify(attempt.answers) !== JSON.stringify(answers)) throw new ProgressionError('idempotency_conflict', 409, 'Lượt này đã nộp với câu trả lời khác.');
        return { attemptId, correct: attempt.correct!, total: 5, xpEarned: attempt.xp_earned!, replayed: true, state: await this.state(db, row) };
      }
      if (attempt.day !== row.day) throw new ProgressionError('quiz_expired', 409, 'Lượt đố đã hết hạn lúc 00:00 UTC. Hãy mở lượt hôm nay.');
      const correct = attempt.questions.reduce((sum, question, index) => sum + Number(question.answer === answers[index]), 0);
      const xpEarned = correct * QUIZ_CORRECT_XP;
      await db.query('UPDATE progression_quiz_attempts SET answers = $2::jsonb, correct = $3, xp_earned = $4, submitted_at = clock_timestamp() WHERE id = $1', [attemptId, JSON.stringify(answers), correct, xpEarned]);
      if (xpEarned > 0) {
        await db.query("INSERT INTO reward_ledger(id, account_id, source_type, source_id, reward_key, amount) VALUES ($1, $2, 'quiz', $3, 'xp', $4)", [randomUUID(), id, attemptId, xpEarned]);
        await db.query('UPDATE progression_wallets SET xp = xp + $2 WHERE account_id = $1', [id, xpEarned]);
        row = { ...row, xp: row.xp + xpEarned };
      }
      return { attemptId, correct, total: 5, xpEarned, replayed: false, state: await this.state(db, row) };
    });
  }

  async purchase(id: string, itemId: string, idempotencyKey: string): Promise<PurchaseResult> {
    return this.transaction(async db => {
      let row = await this.wallet(db, id);
      const { rows: receipts } = await db.query<{ item_id: string }>(
        'SELECT item_id FROM progression_purchases WHERE account_id = $1 AND idempotency_key = $2', [id, idempotencyKey],
      );
      if (receipts[0]) {
        if (receipts[0].item_id !== itemId) throw new ProgressionError('idempotency_conflict', 409, 'Mã giao dịch đã dùng cho món khác.');
        return { purchased: false, replayed: true, state: await this.state(db, row) };
      }
      const { rows: items } = await db.query<{ price: number }>(`SELECT price FROM catalog_items
        WHERE id = $1 AND enabled AND category = 'avatar' AND id = ANY($2::text[]) FOR SHARE`, [itemId, knownItems]);
      if (!items[0]) throw new ProgressionError('item_unavailable', 404, 'Vật phẩm chưa mở bán.');
      const owned = await db.query('SELECT 1 FROM inventory WHERE account_id = $1 AND item_id = $2 AND quantity > 0', [id, itemId]);
      if (owned.rows.length) throw new ProgressionError('already_owned', 409, 'Bạn đã sở hữu vật phẩm này.');
      const price = items[0].price;
      if (row.balance < price) throw new ProgressionError('insufficient_funds', 409, 'Chưa đủ Xu Hang. Hãy điểm danh để tích lũy.');
      await db.query('UPDATE progression_wallets SET balance = balance - $2 WHERE account_id = $1', [id, price]);
      await db.query(`INSERT INTO inventory(account_id, item_id, quantity) VALUES ($1, $2, 1)
        ON CONFLICT (account_id, item_id) DO UPDATE SET quantity = 1`, [id, itemId]);
      await db.query(`INSERT INTO progression_purchases(id, account_id, idempotency_key, item_id, cost)
        VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), id, idempotencyKey, itemId, price]);
      row = { ...row, balance: row.balance - price };
      return { purchased: true, replayed: false, state: await this.state(db, row) };
    });
  }

  async equip(id: string, itemId: string | null): Promise<ProgressionState> {
    return this.transaction(async db => {
      let row = await this.wallet(db, id);
      let assetKey = 'default';
      if (itemId !== null) {
        const { rows } = await db.query<{ asset_key: string }>(`SELECT c.asset_key FROM inventory i
          JOIN catalog_items c ON c.id = i.item_id WHERE i.account_id = $1 AND i.item_id = $2
          AND i.quantity > 0 AND c.category = 'avatar' AND c.id = ANY($3::text[])`, [id, itemId, knownItems]);
        if (!rows[0]) throw new ProgressionError('item_not_owned', 403, 'Bạn chưa sở hữu vật phẩm này.');
        assetKey = rows[0].asset_key;
      }
      await db.query("UPDATE profiles SET avatar_key = $2, settings = jsonb_set(settings, '{equippedItemId}', $3::jsonb) WHERE account_id = $1", [id, assetKey, JSON.stringify(itemId)]);
      row = { ...row, avatar_key: assetKey, equipped_item_id: itemId };
      return this.state(db, row);
    });
  }
}
