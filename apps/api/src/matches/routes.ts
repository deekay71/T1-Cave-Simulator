import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { Redis } from 'ioredis';
import { emptyFeed, readFeed } from './store.js';
import { MatchFeedSchema, type MatchFeed } from '../../../../packages/shared/src/matches.js';
export const CACHE_KEY = 't1:matches:v1';
export async function registerMatchRoutes(app: FastifyInstance, db: Pool | null) {
  const enabled = process.env.MATCH_FEED_ENABLED === 'true';
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 500 }) : null;
  redis?.on('error', () => {});
  void redis?.connect().catch(() => {});
  let cached: MatchFeed | null = null, expires = 0;
  let pending: Promise<MatchFeed> | null = null;
  const load = async (): Promise<MatchFeed> => {
    try { const raw = await redis?.get(CACHE_KEY); if (raw) return { ...MatchFeedSchema.parse(JSON.parse(raw)), enabled }; } catch { /* DB fallback, never provider */ }
    return db ? readFeed(db, enabled) : emptyFeed(enabled);
  };
  app.get('/v1/matches/t1', { config: { rateLimit: { max: 240, timeWindow: '1 minute', groupId: 'match-feed' } } }, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=10');
    if (!enabled) return emptyFeed(false);
    if (cached && Date.now() < expires) return cached;
    pending ??= load().then(value => { cached = value; expires = Date.now() + 10_000; return value; }).finally(() => { pending = null; });
    try { return await pending; } catch {
      // Preserve last-known data with its original checkedAt, never relabel it as fresh.
      reply.header('Cache-Control', 'no-store');
      if (cached) { reply.header('Warning', '110 - "Response is stale"'); return cached; }
      return reply.code(503).send({ error: 'match_feed_unavailable' });
    }
  });
  app.addHook('onClose', async () => { redis?.disconnect(); });
}
