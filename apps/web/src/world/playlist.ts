/** The wall screen's playlist clock (pure: tested without a browser). */
import type { ScreenVideo } from '@te-liet/shared';

/** Which clip plays now and how far into it (s). Wall-clock sync needs every duration. */
export function playlistAt(clips: readonly Pick<ScreenVideo, 'durationSec'>[], nowMs: number): { index: number; offset: number } | null {
  if (!clips.length) return null;
  const durations = clips.map((c) => c.durationSec ?? 0);
  if (durations.some((d) => !(d > 0))) return null;
  const total = durations.reduce((a, b) => a + b, 0);
  let t = ((nowMs / 1000) % total + total) % total;
  for (let i = 0; i < durations.length; i++) {
    if (t < durations[i]) return { index: i, offset: t };
    t -= durations[i];
  }
  return { index: 0, offset: 0 };
}
