import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeedSchema, freshness, bucketFreshness, matchEndpoint } from '../apps/web/src/matches/client.js';

test('TV derives feed endpoint from guest API including mounted prefix', () => {
  assert.equal(matchEndpoint('/v1/guest', 'https://hang.example'), 'https://hang.example/v1/matches/t1');
  assert.equal(matchEndpoint('https://api.example/prefix/v1/guest?invite=secret', 'https://hang.example'), 'https://api.example/prefix/v1/matches/t1');
});
test('freshness distinguishes unverified, delayed live and disconnected cached data', () => {
  const now = Date.parse('2026-11-10T00:10:00Z');
  assert.equal(freshness(null, now, true), 'Chưa có dữ liệu được xác minh.');
  assert.equal(freshness('2026-11-10T00:09:30Z', now, true), null);
  assert.match(freshness('2026-11-10T00:08:00Z', now, true)!, /chậm/);
  assert.match(freshness('2026-11-10T00:00:00Z', now, true)!, /gián đoạn/);
  assert.equal(freshness('2026-11-10T00:00:00Z', now, false), null);
});
test('public client validates buckets and preserves unknown scores', () => {
  const match = { id: 1, teams: [{ id: 1, name: 'T1', score: null }], competition: 'Fixture', bestOf: 3,
    scheduledAt: null, originalScheduledAt: null, beginAt: null, endAt: null, status: 'not_started', winnerId: null, forfeit: false, modifiedAt: null };
  const bucket = { checkedAt: null, matches: [match] };
  const feed = FeedSchema.parse({ source: 'Source: PandaScore', enabled: true, capabilities: { inProgressScore: false }, buckets: { upcoming: bucket, running: bucket, past: bucket } });
  assert.equal(feed.buckets.upcoming.matches[0].teams[0].score, null);
  assert.equal(FeedSchema.safeParse({ enabled: true }).success, false);
});

test('empty running bucket does not warn during healthy five-minute idle polling', () => {
  const now = Date.parse('2026-11-10T00:10:00Z');
  const bucket = { checkedAt: '2026-11-10T00:06:00Z', matches: [] };
  assert.equal(bucketFreshness(bucket, now, true), null);
  const match = { id: 1, teams: [], competition: 'Fixture', bestOf: 3,
    scheduledAt: null, originalScheduledAt: null, beginAt: null, endAt: null,
    status: 'running', winnerId: null, forfeit: false, modifiedAt: null };
  assert.match(bucketFreshness({ ...bucket, matches: [match] }, now, true)!, /chậm/);
  assert.match(bucketFreshness({ checkedAt: '2026-11-10T00:00:00Z', matches: [match] }, now, true)!, /gián đoạn/);
  assert.match(bucketFreshness({ checkedAt: '2026-11-09T23:30:00Z', matches: [] }, now, true)!, /gián đoạn/);
});
