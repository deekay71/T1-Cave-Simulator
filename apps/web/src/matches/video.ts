/** Public build-time settings only. Never place provider API tokens in VITE_* values. */
export type VideoSettings = Record<string, unknown>;
export type OfficialVideo = {
  provider: 'youtube' | 'twitch';
  id: string;
  sourceUrl: string;
  label: string;
};
export type VideoConfiguration =
  | { state: 'disabled' | 'unverified' | 'invalid'; video: null }
  | { state: 'ready'; video: OfficialVideo };

/** Verification is a deployment-owner attestation, not something a URL can prove. */
export function readVideoConfiguration(settings: VideoSettings): VideoConfiguration {
  if (settings.VITE_MATCH_VIDEO_ENABLED !== 'true') return { state: 'disabled', video: null };
  if (settings.VITE_MATCH_VIDEO_OFFICIAL_VERIFIED !== 'true') return { state: 'unverified', video: null };
  const raw = settings.VITE_MATCH_VIDEO_URL;
  if (typeof raw !== 'string') return { state: 'invalid', video: null };
  let url: URL;
  try { url = new URL(raw); } catch { return { state: 'invalid', video: null }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return { state: 'invalid', video: null };
  const host = url.hostname.toLowerCase();
  let provider: OfficialVideo['provider'] | undefined;
  let id: string | undefined;
  if (host === 'youtube.com' || host === 'www.youtube.com') {
    provider = 'youtube';
    if (url.pathname === '/watch') {
      const ids = url.searchParams.getAll('v');
      if (ids.length === 1) id = ids[0];
    } else id = /^\/live\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  } else if (host === 'youtu.be') {
    provider = 'youtube';
    id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  } else if (host === 'twitch.tv' || host === 'www.twitch.tv') {
    provider = 'twitch';
    id = /^\/([a-zA-Z0-9_]{3,25})\/?$/.exec(url.pathname)?.[1]?.toLowerCase();
    if (id && ['directory', 'downloads', 'jobs', 'settings', 'subscriptions', 'videos', 'wallet'].includes(id)) id = undefined;
  }
  if (!provider || !id || (provider === 'youtube' && !/^[\w-]{11}$/.test(id))) return { state: 'invalid', video: null };
  const label = typeof settings.VITE_MATCH_VIDEO_LABEL === 'string' ? settings.VITE_MATCH_VIDEO_LABEL.trim().slice(0, 100) : '';
  return {
    state: 'ready',
    video: {
      provider, id,
      sourceUrl: provider === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://www.twitch.tv/${id}`,
      label: label || (provider === 'youtube' ? 'Nguồn YouTube đã cấu hình' : 'Kênh Twitch đã cấu hình'),
    },
  };
}

/** Build only after a viewer clicks Play. Drop all source query parameters. */
export function officialEmbedUrl(video: OfficialVideo, pageOrigin: string): string | null {
  if (video.provider === 'youtube') {
    if (!/^[\w-]{11}$/.test(video.id)) return null;
    return `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0`;
  }
  if (video.provider !== 'twitch' || !/^[a-z0-9_]{3,25}$/.test(video.id)) return null;
  let page: URL;
  try { page = new URL(pageOrigin); } catch { return null; }
  const local = page.hostname === 'localhost' || page.hostname === '127.0.0.1';
  if (page.protocol !== 'https:' && !(local && page.protocol === 'http:')) return null;
  if (!/^[a-z0-9.-]+$/i.test(page.hostname)) return null;
  const url = new URL('https://player.twitch.tv/');
  url.searchParams.set('channel', video.id);
  url.searchParams.set('parent', page.hostname);
  url.searchParams.set('autoplay', 'true');
  url.searchParams.set('muted', 'false');
  return url.toString();
}
