import { z } from 'zod';

const iso = z.string().datetime({ offset: true }).nullable();
const MatchSchema = z.object({
  id: z.number(), teams: z.array(z.object({ id: z.number(), name: z.string(), score: z.number().nullable() })),
  competition: z.string(), bestOf: z.number().nullable(), scheduledAt: iso,
  originalScheduledAt: iso, beginAt: iso, endAt: iso, status: z.string(),
  winnerId: z.number().nullable(), forfeit: z.boolean(), modifiedAt: iso,
});
const BucketSchema = z.object({ checkedAt: iso, matches: z.array(MatchSchema) });
export const FeedSchema = z.object({
  source: z.literal('Source: PandaScore'), enabled: z.boolean(),
  capabilities: z.object({ inProgressScore: z.literal(false) }),
  buckets: z.object({ upcoming: BucketSchema, running: BucketSchema, past: BucketSchema }),
});
export type Match = z.infer<typeof MatchSchema>;
export type Feed = z.infer<typeof FeedSchema>;

/** VITE_API_URL already points to /v1/guest, not the API root. */
export function matchEndpoint(guestUrl: string, origin: string): string {
  const url = new URL(guestUrl, origin);
  url.pathname = url.pathname.replace(/\/guest\/?$/, '/matches/t1');
  url.search = ''; url.hash = '';
  return url.toString();
}
export async function readMatches(signal: AbortSignal): Promise<Feed> {
  const guestUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/v1/guest' : '/v1/guest');
  const response = await fetch(matchEndpoint(guestUrl, location.origin), { signal });
  if (!response.ok) throw new Error('Không tải được lịch đấu.');
  return FeedSchema.parse(await response.json());
}
export function freshness(checkedAt: string | null, now: number, live: boolean): string | null {
  if (!checkedAt) return 'Chưa có dữ liệu được xác minh.';
  const age = Math.max(0, now - Date.parse(checkedAt));
  if (age > (live ? 300_000 : 1_800_000)) return 'Dữ liệu cũ: kết nối cập nhật đang gián đoạn.';
  if (age > (live ? 90_000 : 1_200_000)) return 'Dữ liệu có thể chậm cập nhật.';
  return null;
}

/** Empty running buckets use idle freshness: the worker checks them every five minutes. */
export function bucketFreshness(bucket: Feed['buckets']['running'], now: number, runningBucket: boolean): string | null {
  return freshness(bucket.checkedAt, now, runningBucket && bucket.matches.some(match => match.status === 'running'));
}
