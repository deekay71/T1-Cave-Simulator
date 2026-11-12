import type { Pool, PoolClient } from 'pg';
import type { Match, MatchFeed } from '../../../../packages/shared/src/matches.js';
export type Bucket = 'upcoming' | 'running' | 'past';
export const buckets: Bucket[] = ['upcoming', 'running', 'past'];
export function emptyFeed(enabled: boolean): MatchFeed {
  return { source: 'Source: PandaScore', enabled, capabilities: { inProgressScore: false }, buckets: {
    upcoming: { checkedAt: null, matches: [] }, running: { checkedAt: null, matches: [] }, past: { checkedAt: null, matches: [] },
  }};
}
export async function readFeed(db: Pick<Pool, 'query'>, enabled: boolean): Promise<MatchFeed> {
  const result = emptyFeed(enabled);
  const { rows } = await db.query('SELECT bucket, checked_at, matches FROM match_feed_buckets');
  for (const row of rows) if (buckets.includes(row.bucket)) result.buckets[row.bucket as Bucket] = { checkedAt: new Date(row.checked_at).toISOString(), matches: row.matches };
  return result;
}
export async function saveBucket(db: PoolClient, bucket: Bucket, matches: Match[], fetchedAt: string) {
  await db.query('BEGIN');
  try {
    // Serialize transitions across buckets, including inserts into an initially empty table.
    await db.query('LOCK TABLE match_feed_buckets IN SHARE ROW EXCLUSIVE MODE');
    const current = await db.query('SELECT checked_at,matches FROM match_feed_buckets WHERE bucket=$1', [bucket]);
    if (current.rows[0] && new Date(current.rows[0].checked_at).getTime() > Date.parse(fetchedAt)) {
      await db.query('COMMIT'); return;
    }
    const normalized: Match[] = [];
    for (const match of matches) {
      const old = await db.query('SELECT data, fetched_at, bucket FROM match_feed_history WHERE id=$1', [match.id]);
      const previous = old.rows[0];
      // A final correction may lower a score or change status; a newer revision wins.
      // Equal provider revisions cannot move a match back through a delayed list response.
      const older = previous && (new Date(previous.fetched_at).getTime() > Date.parse(fetchedAt) ||
        (previous.data.modifiedAt && match.modifiedAt &&
          (Date.parse(previous.data.modifiedAt) > Date.parse(match.modifiedAt) ||
            (previous.bucket !== bucket && Date.parse(previous.data.modifiedAt) === Date.parse(match.modifiedAt)))));
      if (older) {
        // Retain only a record still in this snapshot, never resurrect a disappeared match
        // or insert a newer running/final state into the wrong source bucket.
        if (previous.bucket === bucket && current.rows[0]?.matches.some((m: Match) => m.id === match.id)) normalized.push(previous.data);
        continue;
      }
      const value = { ...match, originalScheduledAt: previous?.data.originalScheduledAt ?? match.originalScheduledAt ?? match.scheduledAt };
      await db.query(`INSERT INTO match_feed_history(id,bucket,fetched_at,data) VALUES($1,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET bucket=excluded.bucket,fetched_at=excluded.fetched_at,data=excluded.data WHERE match_feed_history.fetched_at <= excluded.fetched_at`, [match.id, bucket, fetchedAt, JSON.stringify(value)]);
      // Remove the previous group atomically, without falsely refreshing that group's checkedAt.
      await db.query(`UPDATE match_feed_buckets SET matches=(SELECT COALESCE(jsonb_agg(item),'[]'::jsonb)
        FROM jsonb_array_elements(matches) item WHERE (item->>'id')::bigint <> $1) WHERE bucket <> $2`, [match.id, bucket]);
      normalized.push(value);
    }
    await db.query(`INSERT INTO match_feed_buckets(bucket,checked_at,matches) VALUES($1,$2,$3)
      ON CONFLICT(bucket) DO UPDATE SET checked_at=excluded.checked_at,matches=excluded.matches WHERE match_feed_buckets.checked_at <= excluded.checked_at`, [bucket, fetchedAt, JSON.stringify(normalized)]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
}
/** Every page and retry reserves quota durably, even if the network subsequently fails. */
export async function reserveRequest(db: PoolClient) {
  await db.query('BEGIN');
  try {
    const state = await db.query('SELECT auth_blocked, paused_until > clock_timestamp() AS paused FROM match_feed_control WHERE id=1 FOR UPDATE');
    if (!state.rows.length) throw new Error('feed_control_missing');
    if (state.rows[0].auth_blocked) throw new Error('feed_auth_blocked');
    if (state.rows[0].paused) throw new Error('feed_cooldown');
    await db.query("DELETE FROM match_feed_requests WHERE requested_at < clock_timestamp() - interval '1 hour'");
    const { rows } = await db.query("SELECT count(*)::int AS hour, count(*) FILTER (WHERE requested_at > clock_timestamp() - interval '1 minute')::int AS minute FROM match_feed_requests");
    if (rows[0].hour >= 800 || rows[0].minute >= 45) throw new Error('feed_budget');
    await db.query('INSERT INTO match_feed_requests DEFAULT VALUES');
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
}
export async function pauseFeed(db: PoolClient, ms: number) {
  await db.query("UPDATE match_feed_control SET paused_until=GREATEST(paused_until,clock_timestamp()+($1 * interval '1 millisecond')) WHERE id=1", [ms]);
}
