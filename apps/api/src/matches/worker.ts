import pg from 'pg';
import { Redis } from 'ioredis';
import { fetchMatches, ProviderError } from './provider.js';
import { buckets, pauseFeed, readFeed, reserveRequest, saveBucket } from './store.js';
import { intervalMs } from './scheduler.js';
const enabled = process.env.MATCH_FEED_ENABLED === 'true';
const token = process.env.PANDASCORE_TOKEN;
const teamId = Number(process.env.PANDASCORE_T1_TEAM_ID);
async function park(reason: string): Promise<never> {
  console.error(reason);
  // Keep the optional service idle instead of crash-looping under unless-stopped.
  const timer = setInterval(() => {}, 60_000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(timer); process.exit(0); });
  return new Promise<never>(() => {});
}
if (!enabled) await park('Match feed disabled; restart after changing configuration');
if (!token || !Number.isSafeInteger(teamId) || teamId <= 0 || !process.env.DATABASE_URL) {
  await park('Match feed requires server PANDASCORE_TOKEN, verified PANDASCORE_T1_TEAM_ID and DATABASE_URL; restart after configuring');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 0, enableOfflineQueue: false }) : null;
redis?.on('error', () => {});
let stopped = false;
let request: AbortController | null = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopped = true; request?.abort(); });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
while (!stopped) {
  const db = await pool.connect().catch(() => null);
  if (!db) { await sleep(5000); continue; }
  let lost = false;
  const onError = () => { lost = true; request?.abort(); };
  db.on('error', onError);
  try {
    const lock = await db.query('SELECT pg_try_advisory_lock(921772) AS acquired');
    if (!lock.rows[0].acquired) { await sleep(5000); continue; }
    // Leadership is tied to this connection. No API process polls upstream.
    const next = { upcoming: 0, running: 0, past: 0 };
    const failures = { upcoming: 0, running: 0, past: 0 };
    while (!stopped && !lost) {
      const control = await db.query('SELECT auth_blocked FROM match_feed_control WHERE id=1');
      if (!control.rows.length || control.rows[0].auth_blocked) { await sleep(10_000); continue; }
      const feed = await readFeed(db as unknown as pg.Pool, true);
      for (const bucket of buckets) {
        if (stopped || lost || Date.now() < next[bucket]) continue;
        request = new AbortController();
        try {
          const fetchedAt = new Date().toISOString();
          const matches = await fetchMatches(bucket, { token: token!, teamId, signal: request.signal,
            beforeRequest: async () => { if (lost || stopped) throw new Error('leadership_lost'); await reserveRequest(db); },
            onRateLimit: async info => { if (info.remaining === 0) await pauseFeed(db, Math.max(info.retryAfterMs ?? 0, 3_600_000)); },
          });
          if (lost || stopped) break;
          await saveBucket(db, bucket, matches, fetchedAt);
          const snapshot = await readFeed(db as unknown as pg.Pool, true);
          try { await redis?.set('t1:matches:v1', JSON.stringify(snapshot), 'EX', 30); } catch { /* optional cache */ }
          failures[bucket] = 0;
          next[bucket] = Date.now() + intervalMs(snapshot, bucket) + Math.random() * 1000;
        } catch (error) {
          failures[bucket]++;
          let delay = Math.min(300_000, 5000 * 2 ** Math.min(failures[bucket], 6));
          if (error instanceof ProviderError) {
            if (error.status === 401 || error.status === 403) { await db.query('UPDATE match_feed_control SET auth_blocked=true WHERE id=1'); console.error('Match provider authorization unavailable; durable pause requires configuration correction and explicit reset.'); break; }
            if (error.status === 429) { delay = Math.max(error.retryAfterMs ?? 60_000, 60_000); await pauseFeed(db, delay); }
          }
          // Never log request, response body, headers, token, or database connection strings.
          console.warn(`Match feed ${bucket} refresh failed; cached data retained`);
          next[bucket] = Date.now() + delay + Math.random() * 1000;
        } finally { request = null; }
      }
      await sleep(1000);
    }
  } catch { console.warn('Match feed database unavailable; retrying without upstream polling'); }
  finally {
    db.off('error', onError);
    if (!lost) await db.query('SELECT pg_advisory_unlock(921772)').catch(() => {});
    db.release(lost);
  }
  if (!stopped) await sleep(5000);
}
redis?.disconnect();
await pool.end();
