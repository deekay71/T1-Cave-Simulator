import { z } from 'zod';

export const MatchBucketName = z.enum(['upcoming', 'running', 'past']);
export type MatchBucketName = z.infer<typeof MatchBucketName>;
const nullableTime = z.string().datetime({ offset: true }).nullable();
export const MatchSchema = z.object({
  id: z.number().int().positive(),
  teams: z.array(z.object({ id: z.number().int().positive(), name: z.string(), score: z.number().int().nonnegative().nullable() })),
  competition: z.string(), bestOf: z.number().int().positive().nullable(),
  scheduledAt: nullableTime, originalScheduledAt: nullableTime, beginAt: nullableTime, endAt: nullableTime,
  status: z.string(), winnerId: z.number().int().positive().nullable(), forfeit: z.boolean(), modifiedAt: nullableTime,
});
export type Match = z.infer<typeof MatchSchema>;
export const MatchBucketSchema = z.object({ checkedAt: nullableTime, matches: z.array(MatchSchema) });
export const MatchFeedSchema = z.object({
  source: z.literal('Source: PandaScore'), enabled: z.boolean(),
  capabilities: z.object({ inProgressScore: z.literal(false) }),
  buckets: z.object({ upcoming: MatchBucketSchema, running: MatchBucketSchema, past: MatchBucketSchema }),
});
export type MatchFeed = z.infer<typeof MatchFeedSchema>;
