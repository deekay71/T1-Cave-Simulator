import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Feed, Match } from '../apps/web/src/matches/client.js';
import { countdownText, screenSlide, slideKey, LIVE_STALE_MS, START_GRACE_MS } from '../apps/web/src/matches/screenSlide.js';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
// Synthetic fixtures only: not real schedules or results.
const match = (over: Partial<Match> = {}): Match => ({
  id: 1, teams: [{ id: 12, name: 'Test Opponent', score: 2 }, { id: 11, name: 'T1', score: 1 }],
  competition: 'Test fixture only', bestOf: 5, scheduledAt: iso(NOW + 3_600_000),
  originalScheduledAt: null, beginAt: null, endAt: null, status: 'not_started',
  winnerId: null, forfeit: false, modifiedAt: null, ...over,
});
function feed(buckets: Partial<Record<'running' | 'upcoming' | 'past', Match[]>> = {}, checkedAt = iso(NOW - 30_000)): Feed {
  const bucket = (matches: Match[] = []) => ({ checkedAt, matches });
  return {
    source: 'Source: PandaScore', enabled: true, capabilities: { inProgressScore: false },
    buckets: { running: bucket(buckets.running), upcoming: bucket(buckets.upcoming), past: bucket(buckets.past) },
  };
}

test('không có dữ liệu thì màn hình đứng ở DEFEAT với lý do đúng', () => {
  assert.deepEqual(screenSlide(null, NOW), { kind: 'idle', note: 'Đang chờ lịch thi đấu' });
  assert.equal(screenSlide({ ...feed(), enabled: false }, NOW).kind, 'idle');
  assert.match((screenSlide({ ...feed(), enabled: false }, NOW) as { note: string }).note, /Chưa nối nguồn/);
  assert.deepEqual(screenSlide(feed(), NOW), { kind: 'idle', note: 'Chưa có lịch thi đấu sắp tới' });
  // Kết quả đã đấu không bao giờ lên màn hình chung.
  assert.equal(screenSlide(feed({ past: [match({ status: 'finished', winnerId: 12 })] }), NOW).kind, 'idle');
});

test('trận sắp tới: T1 đứng trước, chọn trận gần nhất, đếm ngược theo phút', () => {
  const far = match({ id: 2, scheduledAt: iso(NOW + 50 * 3_600_000), teams: [{ id: 11, name: 'T1', score: null }, { id: 13, name: 'Later Team', score: null }] });
  const slide = screenSlide(feed({ upcoming: [far, match()] }), NOW);
  assert.equal(slide.kind, 'upcoming');
  if (slide.kind !== 'upcoming') return;
  assert.equal(slide.home, 'T1');
  assert.equal(slide.away, 'Test Opponent');
  assert.equal(slide.at, NOW + 3_600_000);
  assert.equal(slide.countdown, 'CÒN 1 GIỜ 00 PHÚT');
  assert.equal(slide.bestOf, 5);
  // Không có tỉ số trong bất kỳ trường nào của slide.
  assert.ok(!JSON.stringify(slide).includes('score'));
  // Trận đã hủy, không có giờ, hoặc quá giờ hẹn hơn mức cho phép: bỏ qua.
  assert.equal(screenSlide(feed({ upcoming: [match({ status: 'canceled' })] }), NOW).kind, 'idle');
  assert.equal(screenSlide(feed({ upcoming: [match({ scheduledAt: null })] }), NOW).kind, 'idle');
  assert.equal(screenSlide(feed({ upcoming: [match({ scheduledAt: iso(NOW - START_GRACE_MS - 1000) })] }), NOW).kind, 'idle');
  const late = screenSlide(feed({ upcoming: [match({ scheduledAt: iso(NOW - 600_000) })] }), NOW);
  assert.equal(late.kind === 'upcoming' && late.countdown, 'SẮP BẮT ĐẦU');
});

test('trận đang đấu thắng trận sắp tới, nhưng chỉ khi dữ liệu còn mới', () => {
  const live = match({ id: 3, status: 'running' });
  const both = feed({ running: [live], upcoming: [match({ id: 4 })] });
  const slide = screenSlide(both, NOW);
  assert.equal(slide.kind, 'running');
  assert.equal(slide.kind === 'running' && slide.home, 'T1');
  assert.ok(!JSON.stringify(slide).includes('score'));
  // Nguồn im quá 5 phút: không còn dám nói "đang thi đấu".
  assert.equal(screenSlide(both, NOW + LIVE_STALE_MS + 31_000).kind, 'upcoming');
  assert.equal(screenSlide(feed({ running: [live] }, null as unknown as string), NOW).kind, 'idle');
  // Trận trong bucket running nhưng chưa ở trạng thái running thì không tính.
  assert.equal(screenSlide(feed({ running: [match({ status: 'not_started' })] }), NOW).kind, 'idle');
});

test('đếm ngược và khóa vẽ lại', () => {
  assert.equal(countdownText(49 * 3_600_000 + 30 * 60_000), 'CÒN 2 NGÀY 1 GIỜ');
  assert.equal(countdownText(48 * 3_600_000), 'CÒN 2 NGÀY');
  assert.equal(countdownText(5 * 3_600_000 + 7 * 60_000), 'CÒN 5 GIỜ 07 PHÚT');
  assert.equal(countdownText(12 * 60_000), 'CÒN 12 PHÚT');
  assert.equal(countdownText(61_000), 'CÒN 2 PHÚT');
  assert.equal(countdownText(60_000), 'SẮP BẮT ĐẦU');
  assert.equal(countdownText(-5_000), 'SẮP BẮT ĐẦU');
  // Trong cùng một phút khóa không đổi (không vẽ lại mỗi giây), sang phút sau thì đổi.
  const f = feed({ upcoming: [match()] });
  assert.equal(slideKey(screenSlide(f, NOW + 1_000)), slideKey(screenSlide(f, NOW + 50_000)));
  assert.notEqual(slideKey(screenSlide(f, NOW + 1_000)), slideKey(screenSlide(f, NOW + 61_000)));
});
