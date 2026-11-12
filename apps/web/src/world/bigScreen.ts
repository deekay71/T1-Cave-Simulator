/**
 * The big wall screen of the main cave (packages/shared/src/layout.ts HUB_SCREEN). The housing and the
 * dark glass are a GLB placement like every other prop; this module lays the live picture over the
 * rectangle the model declares (manifest meta.screen), split in two:
 *
 * - left 3/4: the clip playlist the admin sets (/admin.html, GET /v1/content): a 16:9 video between
 *   a title band ("ĐANG CHIẾU · …") and a progress band ("Tiếp theo · …"). Clips play muted, one
 *   after another in a loop; when every clip has a duration the playlist runs on the wall clock, so
 *   everyone in the cave sees the same moment. A clip that fails to load is skipped for a while.
 * - right 1/4: the T1 schedule from the match feed (matches/screenSlide.ts, never a score).
 *
 * A YouTube link in the playlist plays in the official embedded player behind the canvas, seen
 * through a transparent "hole" in the video window (world/youtubeScreen.ts); a file (mp4/webm) is
 * drawn as a texture. Sound is off until the player turns it on (BigScreen.sound), and fades with
 * the distance to the screen.
 *
 * Both are unlit and fog-free, so they read across the dark cave. The canvas (bands + schedule) is
 * redrawn once a second; the video texture is uploaded only for new video frames, and only while
 * the camera is in the main cave.
 */
import * as pc from 'playcanvas';
import { HUB_SCREEN, VIDEO_CATEGORIES, youtubeId, type Placement, type ScreenVideo } from '@te-liet/shared';
import { createYoutubeScreen, type YoutubeScreen } from './youtubeScreen.js';
import { content } from '../content/api.js';
import { playlistAt } from './playlist.js';
import { readMatches, type Feed } from '../matches/client.js';
import { screenSlide, slideKey, type ScreenSlide } from '../matches/screenSlide.js';
import { loadManifests } from './manifest.js';
import { quadMesh, renderEntity, WORLD_FONT } from './stalls.js';

type V3 = readonly [number, number, number];
interface ScreenFace {
  center: V3;
  /** [width, height] in metres. */
  size: readonly [number, number];
  /** Unit vectors in the model's frame: out of the glass, and along the picture's height. */
  normal: V3;
  up: V3;
}
/** Same numbers as the generator (tools/models/groups/furniture.ts WALL_SCREEN), used without a manifest. */
const FALLBACK_FACE: ScreenFace = { center: [0, 7.8082, 1.0661], size: [12.8, 7.2], normal: [0, -0.1772, 0.9842], up: [0, 0.9842, 0.1772] };
const POLL_MS = 60_000;
/** Canvas over the whole glass. The left 3/4 (LEFT px) holds the clip, the rest the schedule. */
const W = 1280, H = 720, LEFT = 960;
/** The 16:9 video inside the left part, between the title band and the progress band. */
const VIDEO = { x: 0, y: 90, w: 960, h: 540 } as const;
/** The camera further than this (m) from the screen: no video decoding or uploads. */
const WATCH_RANGE = 48;
/** A clip that failed to load is skipped for this long (ms). */
const RETRY_MS = 5 * 60_000;

const RED = '#E0353F', AMBER = '#FFC56B', WHITE = '#F2F4F8', DIM = '#8D97AB';

export type ScreenDemo = 'idle' | 'upcoming' | 'running';
export interface BigScreenOptions {
  /** Canned schedule instead of the feed (dev preview, screenshots). */
  demo?: ScreenDemo;
  /** Frozen world time: draw once, no polling, no blink, no video. */
  frozen?: boolean;
}
export type ScreenSound = 'none' | 'off' | 'on';
export interface BigScreen {
  root: pc.Entity;
  /** Resolves when the first picture is on the glass. Never rejects. */
  ready: Promise<void>;
  /** The clip's sound for this player: "none" while nothing plays. */
  sound: {
    readonly state: ScreenSound;
    toggle(): void;
    onChange(listener: (state: ScreenSound) => void): void;
  };
}

function isFace(v: unknown): v is ScreenFace {
  const f = v as Partial<ScreenFace> | null;
  const v3 = (a: unknown) => Array.isArray(a) && a.length === 3;
  return !!f && v3(f.center) && v3(f.normal) && v3(f.up) && Array.isArray(f.size) && f.size.length === 2;
}

function demoSlide(kind: ScreenDemo): ScreenSlide {
  const pair = { home: 'T1', away: 'Đội khách', competition: 'Giải đấu mẫu', bestOf: 5 };
  if (kind === 'running') return { kind, ...pair };
  // A fixed date: screenshots stay the same from one day to the next.
  if (kind === 'upcoming') return { kind, at: Date.parse('2026-11-14T17:00:00+07:00'), countdown: 'CÒN 2 NGÀY 3 GIỜ', ...pair };
  return { kind: 'idle', note: 'Chưa có lịch thi đấu sắp tới' };
}

/* ------------------------------------------------------------------ drawing */

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): number {
  let s = size;
  for (;;) {
    ctx.font = `${weight} ${s}px ${WORLD_FONT}`;
    if (ctx.measureText(text).width <= maxWidth || s <= 24) return s;
    s -= 4;
  }
}
/** One centred line, shrunk to fit `maxWidth`, centred on `cx`. */
function line(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, weight: number, size: number, color: string, maxWidth: number) {
  fitFont(ctx, text, weight, size, maxWidth);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
}
const whenText = (at: number) => {
  const d = new Date(at);
  const day = d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return [`${day.charAt(0).toLocaleUpperCase('vi')}${day.slice(1)}`, time];
};

/** Right quarter: the T1 schedule (never a score). */
function paintSchedule(ctx: CanvasRenderingContext2D, slide: ScreenSlide, blink: boolean) {
  const x0 = LEFT, w = W - LEFT, cx = x0 + w / 2, max = w - 40;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0C111F'); bg.addColorStop(1, '#0A0D17');
  ctx.fillStyle = bg;
  ctx.fillRect(x0, 0, w, H);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x0, 0, 3, H);
  ctx.fillStyle = RED;
  ctx.fillRect(x0, 0, w, 8);
  line(ctx, 'TRẬN ĐẤU T1', cx, 62, 800, 34, WHITE, max);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x0 + 20, 88, w - 40, 2);
  if (slide.kind === 'idle') {
    line(ctx, 'CHƯA CÓ', cx, 300, 800, 44, '#C9CFDA', max);
    line(ctx, 'TRẬN SẮP TỚI', cx, 352, 800, 44, '#C9CFDA', max);
    const words = slide.note.split(' ');
    const lines: string[] = [];
    ctx.font = `600 24px ${WORLD_FONT}`;
    for (const word of words) {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${word}`).width <= max) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    lines.slice(0, 3).forEach((l, i) => line(ctx, l, cx, 430 + i * 34, 600, 24, DIM, max));
  } else {
    if (slide.kind === 'running') {
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.roundRect(x0 + 30, 122, w - 60, 58, 29);
      ctx.fill();
      ctx.fillStyle = blink ? WHITE : 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(x0 + 62, 151, 10, 0, Math.PI * 2);
      ctx.fill();
      line(ctx, 'ĐANG ĐẤU', cx + 14, 163, 800, 32, WHITE, w - 120);
    } else line(ctx, 'TRẬN SẮP TỚI', cx, 160, 700, 30, '#B9C3D8', max);
    line(ctx, slide.home, cx, 262, 800, 64, WHITE, max);
    line(ctx, 'vs', cx, 306, 600, 28, DIM, max);
    line(ctx, slide.away, cx, 370, 800, 56, WHITE, max);
    const meta = [slide.competition, slide.bestOf ? `BO${slide.bestOf}` : ''].filter(Boolean).join(' · ');
    if (meta) line(ctx, meta, cx, 418, 600, 24, '#B9C3D8', max);
    if (slide.kind === 'upcoming') {
      line(ctx, slide.countdown, cx, 500, 800, 40, AMBER, max);
      const [day, time] = whenText(slide.at);
      line(ctx, day, cx, 548, 600, 26, WHITE, max);
      line(ctx, time, cx, 584, 700, 30, WHITE, max);
    } else line(ctx, 'Tỉ số: nhấn E ở đây', cx, 520, 600, 24, DIM, max);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x0 + 20, H - 70, w - 40, 2);
  line(ctx, 'Nhấn E trước màn hình', cx, H - 30, 500, 22, DIM, max);
}

interface NowPlaying {
  clip: ScreenVideo | null;
  next: ScreenVideo | null;
  /** 0..1 */
  progress: number;
  /** True once the video draws over VIDEO. */
  live: boolean;
  /** A YouTube clip, shown only from close enough. */
  remote: boolean;
}
/** Left 3/4: the title band, the video window (or a standby card) and the progress band. */
function paintClip(ctx: CanvasRenderingContext2D, now: NowPlaying) {
  ctx.fillStyle = '#05070D';
  ctx.fillRect(0, 0, LEFT, H);
  // title band
  ctx.fillStyle = '#0D1220';
  ctx.fillRect(0, 0, LEFT, VIDEO.y);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, LEFT, 8);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (now.clip) {
    ctx.font = `800 26px ${WORLD_FONT}`;
    ctx.fillStyle = RED;
    ctx.fillText('ĐANG CHIẾU', 36, 62);
    const label = ctx.measureText('ĐANG CHIẾU').width;
    const tag = [VIDEO_CATEGORIES[now.clip.category], now.clip.year ? String(now.clip.year) : ''].filter(Boolean).join(' · ');
    ctx.textAlign = 'right';
    ctx.font = `600 24px ${WORLD_FONT}`;
    ctx.fillStyle = DIM;
    ctx.fillText(tag, LEFT - 32, 62);
    const tagW = ctx.measureText(tag).width;
    const room = LEFT - 36 - label - 28 - tagW - 56;
    const size = fitFont(ctx, now.clip.title, 700, 34, room);
    ctx.font = `700 ${size}px ${WORLD_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = WHITE;
    ctx.fillText(now.clip.title, 36 + label + 28, 63);
  } else {
    ctx.font = `800 30px ${WORLD_FONT}`;
    ctx.fillStyle = WHITE;
    ctx.fillText('HANG TRÚ THUA', 36, 62);
  }
  // video window: the video quad covers it while a clip plays
  if (!now.live) {
    const bg = ctx.createLinearGradient(0, VIDEO.y, 0, VIDEO.y + VIDEO.h);
    bg.addColorStop(0, '#0A0E1A'); bg.addColorStop(0.55, '#121A2E'); bg.addColorStop(1, '#0B0E18');
    ctx.fillStyle = bg;
    ctx.fillRect(VIDEO.x, VIDEO.y, VIDEO.w, VIDEO.h);
    const glow = ctx.createRadialGradient(VIDEO.w / 2, VIDEO.y + VIDEO.h * 1.1, 30, VIDEO.w / 2, VIDEO.y + VIDEO.h * 1.1, VIDEO.h * 0.9);
    glow.addColorStop(0, 'rgba(150,34,44,0.42)'); glow.addColorStop(1, 'rgba(224,53,63,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(VIDEO.x, VIDEO.y, VIDEO.w, VIDEO.h);
    const cy = VIDEO.y + VIDEO.h * 0.6;
    const size = fitFont(ctx, 'DEFEAT', 800, 200, VIDEO.w * 0.8);
    ctx.textAlign = 'center';
    ctx.font = `800 ${size}px ${WORLD_FONT}`;
    ctx.fillStyle = 'rgba(70,190,220,0.30)';
    ctx.fillText('DEFEAT', VIDEO.w / 2 - 6, cy - 4);
    ctx.fillStyle = 'rgba(224,53,63,0.55)';
    ctx.fillText('DEFEAT', VIDEO.w / 2 + 6, cy + 4);
    ctx.fillStyle = '#C9CFDA';
    ctx.fillText('DEFEAT', VIDEO.w / 2, cy);
    line(ctx, !now.clip ? 'Màn hình chờ' : now.remote ? 'Lại gần màn hình để xem clip' : 'Đang tải clip…', VIDEO.w / 2, VIDEO.y + VIDEO.h - 60, 600, 34, DIM, VIDEO.w * 0.8);
  }
  // progress band
  const y = VIDEO.y + VIDEO.h;
  ctx.fillStyle = '#0D1220';
  ctx.fillRect(0, y, LEFT, H - y);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(36, y + 22, LEFT - 72, 6);
  if (now.clip) {
    ctx.fillStyle = RED;
    ctx.fillRect(36, y + 22, (LEFT - 72) * Math.max(0, Math.min(1, now.progress)), 6);
  }
  ctx.textAlign = 'left';
  ctx.font = `600 24px ${WORLD_FONT}`;
  ctx.fillStyle = DIM;
  const nextText = now.next && now.next !== now.clip ? `Tiếp theo · ${now.next.title}` : now.clip ? 'Phát lại từ đầu' : 'Chưa có clip nào trong danh sách';
  fitFont(ctx, nextText, 600, 24, LEFT - 72);
  ctx.fillText(nextText, 36, y + 66);
}

/** Scanlines and panel seams of the salvaged display, over the canvas parts (not the video). */
function grime(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 3; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, W * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------ world */

/**
 * A holder at the placement, with `e` on the glass: +Z out of it, +Y the picture's up, +X along the
 * text. (dx, dy) shifts `e` in the picture plane (m), dz out of it.
 */
function placeOnGlass(e: pc.Entity, p: Placement, face: ScreenFace, dx = 0, dy = 0, dz = 0) {
  const holder = new pc.Entity('big-screen');
  holder.setLocalPosition(p.x, p.y ?? 0, p.z);
  holder.setLocalEulerAngles(0, p.yaw, 0);
  if (p.scale) holder.setLocalScale(p.scale, p.scale, p.scale);
  holder.addChild(e);
  const n = new pc.Vec3(...face.normal).normalize(), up = new pc.Vec3(...face.up).normalize();
  const x = new pc.Vec3().cross(up, n).normalize();
  const m = new pc.Mat4();
  m.set([x.x, x.y, x.z, 0, up.x, up.y, up.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1]);
  e.setLocalRotation(new pc.Quat().setFromMat4(m));
  e.setLocalPosition(
    face.center[0] + x.x * dx + up.x * dy + n.x * dz,
    face.center[1] + x.y * dx + up.y * dy + n.y * dz,
    face.center[2] + x.z * dx + up.z * dy + n.z * dz,
  );
  return holder;
}
function unlit(texture: pc.Texture, intensity: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveMap = texture;
  m.emissiveIntensity = intensity;
  m.update();
  return m;
}

export function buildBigScreen(app: pc.AppBase, parent: pc.Entity, opts: BigScreenOptions = {}): BigScreen {
  const report = (msg: string) => console.error(`[screen] ${msg}`);
  const device = app.graphicsDevice;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new pc.Texture(device, { width: W, height: H, mipmaps: true, anisotropy: 8, flipY: true });
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  // The picture is the brightest thing in the dark cave: unlit, no haze on it, a little over full
  // brightness so it blooms like a lit panel. The glow on the rock comes from the model's light.
  const material = unlit(texture, 1.5);

  // The clip: one muted <video> on a texture of its own, over the canvas's video window.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  const videoTexture = new pc.Texture(device, { width: 16, height: 9, mipmaps: false, flipY: true, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR });
  videoTexture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  videoTexture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  const videoMaterial = unlit(videoTexture, 1.3);
  let videoEntity: pc.Entity | null = null;
  let frameDirty = false,
    videoBound = false;
  const watchFrames = () => {
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    video.requestVideoFrameCallback(() => { frameDirty = true; watchFrames(); });
  };
  watchFrames();

  // YouTube clips: the official player behind the canvas, seen through a transparent hole.
  let yt: YoutubeScreen | null = null;
  let ytShown = false;
  let holeEntity: pc.Entity | null = null;
  const holeMaterial = new pc.ShaderMaterial({
    uniqueName: 'tl-screen-hole',
    vertexGLSL: 'attribute vec3 aPosition; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; void main(void) { gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0); }',
    fragmentGLSL: 'void main(void) { gl_FragColor = vec4(0.0); }',
    attributes: { aPosition: pc.SEMANTIC_POSITION },
  });
  holeMaterial.update();
  const youtube = () => {
    if (!yt) {
      yt = createYoutubeScreen();
      yt.onError(() => {
        if (playing?.url) failed.set(playing.url, Date.now());
        playing = null;
      });
    }
    return yt;
  };

  // Sound: off until this player turns it on; fades with the camera's distance to the screen.
  let soundOn = false;
  let distance = Infinity;
  const soundListeners: ((s: ScreenSound) => void)[] = [];
  let soundState: ScreenSound = 'none';
  const setSoundState = (next: ScreenSound) => {
    if (next === soundState) return;
    soundState = next;
    soundListeners.forEach((l) => l(next));
  };
  const volume = () => (soundOn && near ? Math.max(0.2, Math.min(1, 1.2 - distance / 40)) : 0);

  let clips: ScreenVideo[] = content((doc) => { clips = doc.videos; }).videos;
  const failed = new Map<string, number>();
  let playing: ScreenVideo | null = null;
  let sourceSet = false;
  let near = true;

  let feed: Feed | null = null;
  let key = '', blink = true;
  const playable = () => clips.filter((c) => c.enabled && c.url && !(Date.now() - (failed.get(c.url) ?? -Infinity) < RETRY_MS));
  const nowPlaying = (): NowPlaying => {
    const list = playable();
    if (!list.length || opts.frozen) return { clip: null, next: null, progress: 0, live: false, remote: false };
    const clip = playing && list.includes(playing) ? playing : list[0];
    const i = list.indexOf(clip);
    const remote = youtubeId(clip.url) !== null;
    const d = remote ? clip.durationSec ?? 0 : video.duration;
    const t = remote ? yt?.time() ?? 0 : video.currentTime;
    return {
      clip,
      next: list[(i + 1) % list.length],
      progress: Number.isFinite(d) && d > 0 ? t / d : 0,
      live: remote ? ytShown : sourceSet && video.readyState >= 2 && !!videoEntity?.enabled,
      remote,
    };
  };
  const draw = (force = false) => {
    const slide = opts.demo ? demoSlide(opts.demo) : screenSlide(feed, Date.now());
    const now = nowPlaying();
    const running = slide.kind === 'running' && !opts.frozen;
    blink = running ? !blink : true;
    const next = `${slideKey(slide)}|${blink}|${now.clip?.id ?? ''}|${now.next?.id ?? ''}|${now.live}|${Math.round(now.progress * 200)}`;
    if (!force && next === key) return;
    key = next;
    paintClip(ctx, now);
    paintSchedule(ctx, slide, blink);
    grime(ctx);
    texture.setSource(canvas);
  };
  draw(true);

  /** Start `clip` (from `offset` s when known). */
  const load = (clip: ScreenVideo, offset: number | null) => {
    playing = clip;
    const id = youtubeId(clip.url);
    if (id) {
      if (sourceSet) { video.pause(); video.removeAttribute('src'); video.load(); sourceSet = false; }
      youtube().play(id, offset ?? 0);
      return;
    }
    yt?.stop();
    sourceSet = true;
    video.src = clip.url;
    const seek = () => {
      if (offset !== null && Number.isFinite(video.duration)) video.currentTime = Math.min(offset, Math.max(0, video.duration - 0.25));
      void video.play().catch(() => undefined);
    };
    video.addEventListener('loadedmetadata', seek, { once: true });
  };
  video.addEventListener('error', () => {
    if (playing?.url) failed.set(playing.url, Date.now());
    playing = null;
    sourceSet = false;
  });
  // Without durations for every clip there is no shared clock: play them in order.
  video.addEventListener('ended', () => {
    const list = playable();
    if (!list.length || playlistAt(list, Date.now())) return;
    load(list[(Math.max(0, list.indexOf(playing!)) + 1) % list.length], 0);
  });
  /** Where the clip of `clip` is now (s): the YouTube player or the <video>. */
  const position = (clip: ScreenVideo) => (youtubeId(clip.url) ? yt?.time() ?? null : video.readyState >= 1 ? video.currentTime : null);
  /** Once a second: follow the playlist clock, pause when nobody near can see it. */
  const steer = () => {
    if (opts.frozen) return;
    const list = playable();
    setSoundState(list.length && near && !document.hidden ? (soundOn ? 'on' : 'off') : 'none');
    if (!list.length || !near || document.hidden) {
      if (!video.paused) video.pause();
      if (yt && yt.state !== 'idle') { yt.stop(); ytShown = false; }
      if (!list.length && sourceSet) { video.removeAttribute('src'); video.load(); sourceSet = false; }
      if (!list.length) playing = null;
      else if (yt) playing = null; // back near: start the YouTube clip again at the right second
      return;
    }
    const loaded = (c: ScreenVideo) => c === playing && (youtubeId(c.url) ? yt !== null && yt.state !== 'idle' && yt.state !== 'error' : sourceSet);
    const at = playlistAt(list, Date.now());
    if (at) {
      const clip = list[at.index];
      if (!loaded(clip)) return load(clip, at.offset);
      const t = position(clip);
      if (t !== null && Math.abs(t - at.offset) > 2.5) {
        if (youtubeId(clip.url)) yt?.seek(at.offset);
        else video.currentTime = at.offset;
      }
    } else if (!playing || !list.includes(playing) || !loaded(playing)) return load(list[0], 0);
    if (playing && !youtubeId(playing.url) && video.paused) void video.play().catch(() => undefined);
    const v = volume();
    video.muted = v <= 0;
    video.volume = v;
    yt?.setVolume(playing && youtubeId(playing.url) ? v : 0);
  };

  const root = new pc.Entity('wall-screens');
  parent.addChild(root);
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  const refresh = async () => {
    clearTimeout(poll);
    if (disposed || document.hidden || request) return;
    const active = (request = new AbortController());
    const timeout = setTimeout(() => active.abort(), 12_000);
    try {
      feed = await readMatches(active.signal);
    } catch {
      // Keep the last good feed: screenSlide stops trusting a "running" bucket once it is stale.
    } finally {
      clearTimeout(timeout);
      request = null;
      if (!disposed) {
        draw();
        if (!document.hidden) poll = setTimeout(() => void refresh(), POLL_MS);
      }
    }
  };
  const visibility = () => {
    if (document.hidden) { clearTimeout(poll); request?.abort(); video.pause(); }
    else void refresh();
  };
  let camera: pc.Entity | null = null;
  const screenAt = new pc.Vec3(HUB_SCREEN.x, 4.7, HUB_SCREEN.z);
  const corner = new pc.Vec3(), view = new pc.Vec3(), projected = new pc.Vec3();
  let halfW = 0, halfH = 0;
  /** The video window's corners on screen (CSS px), or null when any is behind the camera. */
  const windowCorners = (): [number, number][] | null => {
    const cam = camera?.camera;
    if (!cam || !holeEntity) return null;
    const m = holeEntity.getWorldTransform();
    const out: [number, number][] = [];
    for (const [x, y] of [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]] as const) {
      m.transformPoint(corner.set(x, y, 0), corner);
      cam.viewMatrix.transformPoint(corner, view);
      if (view.z > -cam.nearClip) return null;
      cam.worldToScreen(corner, projected);
      out.push([projected.x, projected.y]);
    }
    return out;
  };
  const onUpdate = () => {
    camera ??= app.root.findByName('camera') as pc.Entity | null;
    const eye = camera?.getPosition();
    distance = eye ? eye.distance(screenAt) : 0;
    near = !eye || distance < WATCH_RANGE;
    const remote = !!playing && youtubeId(playing.url) !== null;
    ytShown = remote && near && !!yt ? yt.place(windowCorners()) : (yt?.place(null), false);
    if (holeEntity && holeEntity.enabled !== ytShown) holeEntity.enabled = ytShown;
    const show = !remote && sourceSet && video.readyState >= 2 && near;
    if (videoEntity && videoEntity.enabled !== show) videoEntity.enabled = show;
    if (!show || video.paused) return;
    // A new frame (or every frame where requestVideoFrameCallback is missing).
    if (frameDirty || typeof video.requestVideoFrameCallback !== 'function') {
      frameDirty = false;
      if (!videoBound) { videoTexture.setSource(video); videoBound = true; }
      else videoTexture.upload();
    }
  };
  const dispose = () => {
    disposed = true;
    clearInterval(timer); clearTimeout(poll); request?.abort();
    app.off('update', onUpdate);
    document.removeEventListener('visibilitychange', visibility);
    video.pause(); video.removeAttribute('src'); video.load();
    yt?.stop();
    material.destroy(); texture.destroy(); videoMaterial.destroy(); videoTexture.destroy(); holeMaterial.destroy();
  };

  const ready = loadManifests(['furniture'], report)
    .then(index => {
      const meshes: pc.Mesh[] = [];
      const declared = index.get(HUB_SCREEN.asset)?.meta?.screen;
      const face = isFace(declared) ? declared : FALLBACK_FACE;
      const mesh = quadMesh(device, face.size[0], face.size[1]);
      meshes.push(mesh);
      const picture = renderEntity('screen-picture', mesh, material);
      picture.render!.receiveShadows = false;
      root.addChild(placeOnGlass(picture, HUB_SCREEN, face));
      // The video window in metres: the canvas maps W px onto the glass width.
      const k = face.size[0] / W;
      const vMesh = quadMesh(device, VIDEO.w * k, VIDEO.h * k);
      meshes.push(vMesh);
      videoEntity = renderEntity('screen-video', vMesh, videoMaterial);
      videoEntity.render!.receiveShadows = false;
      videoEntity.enabled = false;
      const dx = (VIDEO.x + VIDEO.w / 2 - W / 2) * k, dy = (H / 2 - (VIDEO.y + VIDEO.h / 2)) * k;
      root.addChild(placeOnGlass(videoEntity, HUB_SCREEN, face, dx, dy, 0.004));
      // the hole the YouTube player shows through: same window, a hair further out
      holeEntity = renderEntity('screen-hole', vMesh, holeMaterial);
      holeEntity.render!.castShadows = false;
      holeEntity.render!.receiveShadows = false;
      holeEntity.enabled = false;
      root.addChild(placeOnGlass(holeEntity, HUB_SCREEN, face, dx, dy, 0.006));
      halfW = (VIDEO.w * k) / 2;
      halfH = (VIDEO.h * k) / 2;
      root.on('destroy', () => { dispose(); for (const m of meshes) m.destroy(); });
      // The web font may arrive after the first picture: draw again with it.
      void document.fonts?.ready.then(() => { if (!disposed) draw(true); });
      if (opts.frozen) return;
      app.on('update', onUpdate);
      timer = setInterval(() => { steer(); draw(); }, 1000);
      steer();
      if (opts.demo) return;
      document.addEventListener('visibilitychange', visibility);
      void refresh();
    })
    .catch((err: unknown) => report(`failed: ${err instanceof Error ? err.message : String(err)}`));
  return {
    root,
    ready,
    sound: {
      get state() {
        return soundState;
      },
      toggle() {
        soundOn = !soundOn;
        if (soundState !== 'none') setSoundState(soundOn ? 'on' : 'off');
        const v = volume();
        video.muted = v <= 0;
        video.volume = v;
        yt?.setVolume(playing && youtubeId(playing.url) ? v : 0);
      },
      onChange(listener) {
        soundListeners.push(listener);
      },
    },
  };
}
