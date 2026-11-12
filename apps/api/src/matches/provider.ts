import type { Match, MatchBucketName } from '@te-liet/shared';
import { normalizeMatch } from './normalize.js';
export interface RateInfo { remaining: number | null; retryAfterMs: number | null }
export class ProviderError extends Error {
  constructor(public code: string, public status: number | null = null, public retryAfterMs: number | null = null, public remaining: number | null = null) {
    super(`PandaScore request failed: ${code}`); this.name = 'ProviderError';
  }
}
export interface ProviderOptions {
  token: string; teamId: number; beforeRequest: () => Promise<void>; signal?: AbortSignal;
  fetchImpl?: typeof fetch; maxPages?: number;
  onRateLimit?: (info: RateInfo) => Promise<void> | void;
}
function rateInfo(headers: Headers): RateInfo {
  const raw = headers.get('X-Rate-Limit-Remaining');
  const remaining = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const retry = headers.get('Retry-After');
  const retryAfterMs = retry === null ? null : /^\d+(\.\d+)?$/.test(retry)
    ? Math.ceil(Number(retry) * 1000) : Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - Date.now()) : null;
  return { remaining, retryAfterMs };
}
/** All-plans list endpoints only; never falls back to paid match/game detail endpoints.
 * Quota reservation occurs before EVERY page, including future retries managed by the worker.
 */
export async function fetchMatches(bucket: MatchBucketName, options: ProviderOptions): Promise<Match[]> {
  if (!['upcoming', 'running', 'past'].includes(bucket) || !options.token.trim() || !Number.isSafeInteger(options.teamId) || options.teamId <= 0)
    throw new ProviderError('configuration');
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new ProviderError('configuration');
  const matches = new Map<number, Match>();
  for (let page = 1; page <= maxPages; page++) {
    options.signal?.throwIfAborted();
    await options.beforeRequest();
    const url = new URL(`https://api.pandascore.co/lol/matches/${bucket}`);
    url.searchParams.set('filter[opponent_id]', String(options.teamId));
    // Reconcile the most recent 90 days, not T1's entire multi-year history.
    if (bucket === 'past') url.searchParams.set('range[begin_at]', `${new Date(Date.now() - 90 * 86400000).toISOString()},${new Date().toISOString()}`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', bucket === 'past' ? '-begin_at' : 'begin_at');
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]),
        redirect: 'error',
      });
    } catch { throw new ProviderError(options.signal?.aborted ? 'aborted' : 'network_or_timeout'); }
    const info = rateInfo(response.headers);
    await options.onRateLimit?.(info);
    if (!response.ok) throw new ProviderError(response.status === 429 ? 'rate_limit' : response.status === 401 || response.status === 403 ? 'authentication' : 'http', response.status, info.retryAfterMs, info.remaining);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderError('invalid_json', response.status); }
    if (!Array.isArray(payload)) throw new ProviderError('invalid_payload', response.status);
    try {
      for (const item of payload) {
        const match = normalizeMatch(item, options.teamId);
        if (match) matches.set(match.id, match);
      }
    } catch { throw new ProviderError('invalid_payload', response.status); }
    if (payload.length < 100) return [...matches.values()];
  }
  // No truncated result can overwrite the last complete snapshot.
  throw new ProviderError('pagination_limit');
}
