import type { MatchFeed } from '../../../../packages/shared/src/matches.js';
import type { Bucket } from './store.js';
export function intervalMs(feed: MatchFeed, bucket: Bucket, now = Date.now()) {
  const live = feed.buckets.running.matches.some(m => m.status === 'running');
  const near = feed.buckets.upcoming.matches.some(m => m.scheduledAt && Math.abs(Date.parse(m.scheduledAt) - now) < 60 * 60_000);
  return (live ? { running: 30, upcoming: 300, past: 60 } : near ? { running: 30, upcoming: 60, past: 60 } : { running: 300, upcoming: 900, past: 900 })[bucket] * 1000;
}
