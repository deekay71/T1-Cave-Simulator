/**
 * What the big wall screen of the main cave shows (apps/web/src/world/bigScreen.ts draws it). Pure:
 * one slide from the match feed and the clock, so it can be tested without a canvas.
 *
 * The screen hangs where everybody sees it, so it never shows a score or a result: those stay behind
 * the spoiler switch of the match panel (E in front of the screen). It only says who plays, when, and whether
 * the match is on right now.
 */
import type { Feed, Match } from './client.js';

/** A "running" bucket older than this (ms) is not trusted as live any more (same limit as the panel). */
export const LIVE_STALE_MS = 300_000;
/** A scheduled start may lie this far (ms) in the past before the match stops counting as upcoming. */
export const START_GRACE_MS = 3 * 3_600_000;

interface Pairing {
  /** T1 first when it plays. */
  home: string;
  away: string;
  competition: string;
  bestOf: number | null;
}
export type ScreenSlide =
  | { kind: 'idle'; note: string }
  | ({ kind: 'running' } & Pairing)
  | ({ kind: 'upcoming'; at: number; countdown: string } & Pairing);

function pairing(match: Match): Pairing {
  const names = match.teams.map(team => team.name.trim()).filter(Boolean);
  const t1 = names.findIndex(name => /^T1\b/i.test(name));
  if (t1 > 0) names.unshift(...names.splice(t1, 1));
  return {
    home: names[0] ?? 'T1',
    away: names[1] ?? 'Chưa rõ đối thủ',
    competition: match.competition.trim(),
    bestOf: match.bestOf,
  };
}

/** "CÒN 2 NGÀY 3 GIỜ", "CÒN 5 GIỜ 07 PHÚT", "CÒN 12 PHÚT", "SẮP BẮT ĐẦU": changes once a minute at most. */
export function countdownText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return 'SẮP BẮT ĐẦU';
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  if (days > 0) return hours ? `CÒN ${days} NGÀY ${hours} GIỜ` : `CÒN ${days} NGÀY`;
  if (hours > 0) return `CÒN ${hours} GIỜ ${String(rest).padStart(2, '0')} PHÚT`;
  return `CÒN ${rest} PHÚT`;
}

export function screenSlide(feed: Feed | null, now: number): ScreenSlide {
  if (!feed) return { kind: 'idle', note: 'Đang chờ lịch thi đấu' };
  if (!feed.enabled) return { kind: 'idle', note: 'Chưa nối nguồn lịch thi đấu' };
  const running = feed.buckets.running;
  const fresh = running.checkedAt !== null && now - Date.parse(running.checkedAt) <= LIVE_STALE_MS;
  const live = fresh ? running.matches.find(match => match.status === 'running') : undefined;
  if (live) return { kind: 'running', ...pairing(live) };
  let next: Match | null = null, nextAt = Infinity;
  for (const match of feed.buckets.upcoming.matches) {
    if (match.status === 'canceled' || match.status === 'finished' || !match.scheduledAt) continue;
    const at = Date.parse(match.scheduledAt);
    if (at < now - START_GRACE_MS || at >= nextAt) continue;
    next = match; nextAt = at;
  }
  if (next) return { kind: 'upcoming', at: nextAt, countdown: countdownText(nextAt - now), ...pairing(next) };
  return { kind: 'idle', note: 'Chưa có lịch thi đấu sắp tới' };
}

/** Changes exactly when the picture has to be redrawn. */
export function slideKey(slide: ScreenSlide): string {
  if (slide.kind === 'idle') return `idle|${slide.note}`;
  const base = `${slide.kind}|${slide.home}|${slide.away}|${slide.competition}|${slide.bestOf ?? ''}`;
  return slide.kind === 'upcoming' ? `${base}|${slide.at}|${slide.countdown}` : base;
}
