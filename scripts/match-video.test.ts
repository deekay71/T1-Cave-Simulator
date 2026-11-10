import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readVideoConfiguration, officialEmbedUrl } from '../apps/web/src/matches/video.js';
import { MatchCard, MatchPanelView, preferredMatchTab } from '../apps/web/src/matches/MatchPanelView.js';
import { FeedSchema, type Feed, type Match } from '../apps/web/src/matches/client.js';

const verified = { VITE_MATCH_VIDEO_ENABLED: 'true', VITE_MATCH_VIDEO_OFFICIAL_VERIFIED: 'true' };
// Synthetic IDs are used only to test URL validation. Nothing here is an official source.
const youtube = 'https://www.youtube.com/watch?v=abcdefghijk';
const fixture: Match = {
  id: 1, teams: [{ id: 11, name: 'T1', score: 74 }, { id: 12, name: 'Test Opponent', score: 83 }],
  competition: 'Test fixture only', bestOf: 3, scheduledAt: '2026-11-10T07:00:00Z',
  originalScheduledAt: null, beginAt: null, endAt: null, status: 'finished',
  winnerId: 12, forfeit: true, modifiedAt: null,
};
function feedWith(tab: 'running' | 'upcoming' | 'past', match = fixture): Feed {
  const empty = () => ({ checkedAt: '2026-11-10T07:00:00Z', matches: [] as Match[] });
  const feed: Feed = { source: 'Source: PandaScore', enabled: true, capabilities: { inProgressScore: false }, buckets: { running: empty(), upcoming: empty(), past: empty() } };
  feed.buckets[tab].matches.push(match);
  return feed;
}
function panel(feed: Feed | null, extras = {}) {
  return renderToStaticMarkup(createElement(MatchPanelView, {
    feed, error: false, refreshing: false, now: Date.parse('2026-11-10T07:01:00Z'),
    onRefresh: () => {}, video: readVideoConfiguration({}), ...extras,
  }));
}

test('official video fails closed unless both explicit enable and verification are set', () => {
  assert.equal(readVideoConfiguration({}).state, 'disabled');
  assert.equal(readVideoConfiguration({ VITE_MATCH_VIDEO_URL: youtube }).state, 'disabled');
  assert.equal(readVideoConfiguration({ VITE_MATCH_VIDEO_ENABLED: 'true', VITE_MATCH_VIDEO_URL: youtube }).state, 'unverified');
  assert.equal(readVideoConfiguration({ ...verified, VITE_MATCH_VIDEO_OFFICIAL_VERIFIED: true, VITE_MATCH_VIDEO_URL: youtube }).state, 'unverified');
  assert.equal(readVideoConfiguration(verified).state, 'invalid');
});

test('official YouTube watch/live/short links become canonical videos without arbitrary parameters', () => {
  for (const url of [youtube, `${youtube}&autoplay=1&origin=https://evil.example`, 'https://youtube.com/live/abcdefghijk?feature=share', 'https://youtu.be/abcdefghijk?t=50']) {
    const config = readVideoConfiguration({ ...verified, VITE_MATCH_VIDEO_URL: url });
    assert.equal(config.state, 'ready');
    assert.equal(config.video!.sourceUrl, youtube);
    const embed = officialEmbedUrl(config.video!, 'https://cave.example')!;
    assert.equal(new URL(embed).hostname, 'www.youtube-nocookie.com');
    assert.equal(new URL(embed).pathname, '/embed/abcdefghijk');
    assert.equal(new URL(embed).searchParams.get('origin'), null);
  }
});

test('malformed, credentialed, arbitrary and lookalike video sources are rejected', () => {
  for (const url of [
    'javascript:alert(1)', 'http://youtube.com/watch?v=abcdefghijk',
    'https://youtube.com.evil.example/watch?v=abcdefghijk', 'https://evil.example/abcdefghijk',
    'https://user:password@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk',
    'https://youtube.com/watch?v=abcdefghijk&v=zzzzzzzzzzz', 'https://youtube.com/@somechannel/live',
    'https://youtube.com/watch?v=bad', 'https://player.twitch.tv/?channel=channel',
    'https://twitch.tv/videos/123456789', 'https://twitch.tv/directory', 'https://twitch.tv/channel/extra',
  ]) assert.equal(readVideoConfiguration({ ...verified, VITE_MATCH_VIDEO_URL: url }).state, 'invalid', url);
});

test('Twitch embed uses actual host parent and HTTPS or local-development origin only', () => {
  const config = readVideoConfiguration({ ...verified, VITE_MATCH_VIDEO_URL: 'https://www.twitch.tv/Test_Channel?parent=evil.example' });
  assert.equal(config.state, 'ready');
  assert.equal(config.video!.sourceUrl, 'https://www.twitch.tv/test_channel');
  const embed = new URL(officialEmbedUrl(config.video!, 'https://cave.example:8443')!);
  assert.equal(embed.hostname, 'player.twitch.tv');
  assert.equal(embed.searchParams.get('parent'), 'cave.example');
  assert.equal(embed.searchParams.get('channel'), 'test_channel');
  assert.ok(officialEmbedUrl(config.video!, 'http://localhost:5173'));
  assert.equal(officialEmbedUrl(config.video!, 'http://cave.example'), null);
  assert.equal(officialEmbedUrl(config.video!, 'file:///tmp/test.html'), null);
});

test('even configured video has no iframe, preload or remote poster before viewer clicks', () => {
  const video = readVideoConfiguration({ ...verified, VITE_MATCH_VIDEO_URL: youtube, VITE_MATCH_VIDEO_LABEL: '<script>alert(1)</script>' });
  const html = panel(feedWith('past'), { video });
  assert.doesNotMatch(html, /<iframe|<img|<link|<script|youtube-nocookie/);
  assert.match(html, /Phát từ YouTube/);
  assert.match(html, /Video có thể lộ kết quả/);
  assert.match(html, /&lt;script&gt;/);
});

test('default disabled video renders useful fallback without third-party media URLs', () => {
  const html = panel(null);
  assert.match(html, /Chưa bật nguồn phát chính thức/);
  assert.match(html, /Đang tải lịch đấu/);
  assert.doesNotMatch(html, /<iframe|youtube|twitch|<img/);
});

test('match cards never expose hidden scores, winners or forfeit result', () => {
  const html = renderToStaticMarkup(createElement(MatchCard, { match: fixture, hide: true, liveScore: false }));
  assert.doesNotMatch(html, /74|83|match-winner|bỏ cuộc|Tỉ số 74|Tỉ số 83/);
  assert.match(html, /Đang ẩn kết quả/);
  assert.match(html, /Đang ẩn tỉ số/);
});

test('revealed finished result includes scores and winner; unknown remains unknown', () => {
  const html = renderToStaticMarkup(createElement(MatchCard, { match: fixture, hide: false, liveScore: false }));
  assert.match(html, /Tỉ số 74/);
  assert.match(html, /Tỉ số 83/);
  assert.match(html, /match-winner/);
  const unknown = renderToStaticMarkup(createElement(MatchCard, { match: { ...fixture, teams: [{ id: 11, name: 'T1', score: null }] }, hide: false, liveScore: false }));
  assert.match(unknown, /Chưa có tỉ số được xác minh/);
  assert.doesNotMatch(unknown, /Tỉ số 0/);
});

test('running and upcoming scores stay hidden even when viewer reveals results', () => {
  for (const status of ['running', 'not_started']) {
    const html = renderToStaticMarkup(createElement(MatchCard, { match: { ...fixture, status }, hide: false, liveScore: false }));
    assert.doesNotMatch(html, /74|83|match-winner/);
  }
  const feed = feedWith('running', { ...fixture, status: 'running' });
  assert.equal(FeedSchema.safeParse({ ...feed, capabilities: { inProgressScore: true } }).success, false);
});

test('tabs initially select real available data, with accessible tab/panel wiring and spoiler default', () => {
  assert.equal(preferredMatchTab(null), 'running');
  assert.equal(preferredMatchTab(feedWith('past')), 'past');
  assert.equal(preferredMatchTab(feedWith('upcoming')), 'upcoming');
  const html = panel(feedWith('past'));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.equal((html.match(/hidden=""/g) ?? []).length, 2);
  assert.match(html, /type="checkbox" checked=""/);
  assert.match(html, /Source: PandaScore/);
  assert.match(html, /Nguồn kiểm tra lúc/);
  assert.doesNotMatch(html, /Tỉ số 74|Tỉ số 83|match-winner/);
});

test('loading failure, disabled source and stale data are explicit rather than fabricated', () => {
  assert.match(panel(null, { error: true }), /Không cập nhật được lịch đấu/);
  assert.match(panel({ ...feedWith('past'), enabled: false }), /Nguồn lịch đấu chưa được bật/);
  const stale = panel(feedWith('running', { ...fixture, status: 'running' }), { error: true, now: Date.parse('2026-11-10T08:00:00Z') });
  assert.match(stale, /Đang giữ bản gần nhất/);
  assert.match(stale, /Dữ liệu cũ/);
  assert.match(stale, /Tỉ số trong trận chưa được xác minh/);
});

test('completed match notice explains spoiler state and provides an explicit reveal action', () => {
  const html = panel(feedWith('past'));
  assert.match(html, /Đã có 1 trận đã đấu/);
  assert.match(html, /Tỉ số đang được ẩn/);
  assert.match(html, /Hiện kết quả đã đấu/);
  assert.doesNotMatch(html, /Tỉ số 74|Tỉ số 83|match-winner/);
  assert.doesNotMatch(panel(null), /Hiện kết quả đã đấu/);
  assert.doesNotMatch(panel(feedWith('upcoming')), /Hiện kết quả đã đấu/);
});
