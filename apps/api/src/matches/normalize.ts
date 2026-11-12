import { z } from 'zod';
import { MatchSchema, type Match } from '@te-liet/shared';
const id = z.number().int().positive();
const time = z.string().datetime({ offset: true }).nullish();
const RawMatch = z.object({
  id, opponents: z.array(z.object({ opponent: z.object({ id, name: z.string().nullable().optional() }).nullable() })),
  results: z.array(z.object({ team_id: id, score: z.number().int().nonnegative().nullable() })).nullish(),
  league: z.object({ name: z.string().nullish() }).nullish(),
  serie: z.object({ full_name: z.string().nullish(), name: z.string().nullish() }).nullish(),
  tournament: z.object({ name: z.string().nullish() }).nullish(),
  number_of_games: z.number().int().nonnegative().nullish(),
  scheduled_at: time, original_scheduled_at: time, begin_at: time, end_at: time, modified_at: time,
  status: z.string(), winner_id: id.nullish(), forfeit: z.boolean().nullish(),
});
/** Reject malformed payloads rather than silently publishing an incomplete successful refresh. */
export function normalizeMatch(raw: unknown, teamId: number): Match | null {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) throw new Error('Invalid configured team ID');
  const data = RawMatch.parse(raw);
  if (!data.opponents.some(({ opponent }) => opponent?.id === teamId)) return null;
  const results = new Map((data.results ?? []).map((result) => [result.team_id, result.score]));
  return MatchSchema.parse({
    id: data.id,
    teams: data.opponents.flatMap(({ opponent }) => opponent ? [{ id: opponent.id, name: opponent.name || 'TBD', score: results.get(opponent.id) ?? null }] : []),
    competition: [data.league?.name, data.serie?.full_name || data.serie?.name, data.tournament?.name].filter(Boolean).join(' · '),
    bestOf: data.number_of_games || null,
    scheduledAt: data.scheduled_at ?? null, originalScheduledAt: data.original_scheduled_at ?? null,
    beginAt: data.begin_at ?? null, endAt: data.end_at ?? null, modifiedAt: data.modified_at ?? null,
    status: data.status, winnerId: data.winner_id ?? null, forfeit: data.forfeit ?? false,
  });
}
