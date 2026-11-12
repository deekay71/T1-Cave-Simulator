/**
 * The wall screens (packages/shared/src/layout.ts HUB_SCREENS): the big one bolted to the wall of the
 * main cave (the only one now: the side cave that had a small one became Hang Quest). The housings and the dark glass are GLB
 * placements like every other prop; this module lays one shared live picture over the rectangle each
 * model declares (manifest meta.screen): a canvas drawn from the T1 match feed, as an emissive
 * texture, so it reads from anywhere in the cave.
 *
 * What it shows is decided by matches/screenSlide.ts (never a score). The feed is polled once a
 * minute while the tab is visible; the picture is redrawn only when its text changes (the countdown
 * moves once a minute) plus one blink a second while a match is on.
 */
import * as pc from 'playcanvas';
import { HUB_SCREEN, HUB_SCREENS, type Placement } from '@te-liet/shared';
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
const FALLBACK_FACE: ScreenFace = { center: [0, 4.7224, 0.9066], size: [9.6, 5.4], normal: [0, -0.1772, 0.9842], up: [0, 0.9842, 0.1772] };
const POLL_MS = 60_000;
const W = 1280, H = 720;

const RED = '#E0353F', AMBER = '#FFC56B', WHITE = '#F2F4F8', DIM = '#8D97AB';

export type ScreenDemo = 'idle' | 'upcoming' | 'running';
export interface BigScreenOptions {
  /** Canned picture instead of the feed (dev preview, screenshots). */
  demo?: ScreenDemo;
  /** Frozen world time: draw once, no polling, no blink. */
  frozen?: boolean;
}
export interface BigScreen {
  root: pc.Entity;
  /** Resolves when the first picture is on the glass. Never rejects. */
  ready: Promise<void>;
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
function line(ctx: CanvasRenderingContext2D, text: string, y: number, weight: number, size: number, color: string, maxWidth = W * 0.9) {
  fitFont(ctx, text, weight, size, maxWidth);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, y);
}
const whenText = (at: number) => {
  const d = new Date(at);
  const day = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${day.charAt(0).toLocaleUpperCase('vi')}${day.slice(1)} · ${time}`;
};

/** "T1  vs  <away>" on one line, the names as large as the width allows. */
function teams(ctx: CanvasRenderingContext2D, home: string, away: string, y: number, size: number) {
  const gap = 46, vs = 'vs';
  let s = size;
  let wh = 0, wa = 0, wv = 0;
  for (;;) {
    ctx.font = `800 ${s}px ${WORLD_FONT}`;
    wh = ctx.measureText(home).width; wa = ctx.measureText(away).width;
    ctx.font = `600 ${Math.round(s * 0.42)}px ${WORLD_FONT}`;
    wv = ctx.measureText(vs).width;
    if (wh + wa + wv + 2 * gap <= W * 0.9 || s <= 40) break;
    s -= 6;
  }
  let x = (W - (wh + wa + wv + 2 * gap)) / 2;
  ctx.textAlign = 'left';
  ctx.font = `800 ${s}px ${WORLD_FONT}`;
  ctx.fillStyle = WHITE;
  ctx.fillText(home, x, y);
  x += wh + gap;
  ctx.font = `600 ${Math.round(s * 0.42)}px ${WORLD_FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(vs, x, y - s * 0.12);
  x += wv + gap;
  ctx.font = `800 ${s}px ${WORLD_FONT}`;
  ctx.fillStyle = WHITE;
  ctx.fillText(away, x, y);
}

function paint(ctx: CanvasRenderingContext2D, slide: ScreenSlide, blink: boolean) {
  ctx.textBaseline = 'alphabetic';
  // Backdrop: a deep blue panel, a little lighter in the middle, a red glow rising from below.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0A0E1A'); bg.addColorStop(0.55, '#121A2E'); bg.addColorStop(1, '#0B0E18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 1.15, 40, W / 2, H * 1.15, H * 0.95);
  glow.addColorStop(0, slide.kind === 'idle' ? 'rgba(150,34,44,0.42)' : 'rgba(224,53,63,0.34)');
  glow.addColorStop(1, 'rgba(224,53,63,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Header strip.
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, 10);
  ctx.textAlign = 'left';
  ctx.font = `800 40px ${WORLD_FONT}`;
  ctx.fillStyle = WHITE;
  ctx.fillText('TRẬN ĐẤU T1', 56, 78);
  ctx.textAlign = 'right';
  ctx.font = `600 28px ${WORLD_FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText('HANG TRÚ THUA', W - 56, 76);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(56, 104, W - 112, 2);

  if (slide.kind === 'idle') {
    // The concept's TV: DEFEAT, a little out of register.
    const size = fitFont(ctx, 'DEFEAT', 800, 250, W * 0.86);
    ctx.textAlign = 'center';
    ctx.font = `800 ${size}px ${WORLD_FONT}`;
    ctx.fillStyle = 'rgba(70,190,220,0.30)';
    ctx.fillText('DEFEAT', W / 2 - 7, 412);
    ctx.fillStyle = 'rgba(224,53,63,0.55)';
    ctx.fillText('DEFEAT', W / 2 + 7, 420);
    ctx.fillStyle = '#C9CFDA';
    ctx.fillText('DEFEAT', W / 2, 416);
    line(ctx, slide.note, 536, 600, 46, DIM);
  } else {
    const meta = [slide.competition, slide.bestOf ? `BO${slide.bestOf}` : ''].filter(Boolean).join(' · ');
    if (slide.kind === 'running') {
      // Status pill with a blinking dot.
      ctx.font = `800 44px ${WORLD_FONT}`;
      const label = 'ĐANG THI ĐẤU', tw = ctx.measureText(label).width, pw = tw + 110, px = (W - pw) / 2, py = 150;
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, 76, 38);
      ctx.fill();
      ctx.fillStyle = blink ? WHITE : 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(px + 44, py + 38, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = WHITE;
      ctx.textAlign = 'left';
      ctx.fillText(label, px + 76, py + 54);
      teams(ctx, slide.home, slide.away, 410, 170);
      if (meta) line(ctx, meta, 492, 600, 42, '#B9C3D8');
      line(ctx, 'Tỉ số không hiện ở đây · đến gần màn hình, nhấn E', 590, 600, 36, DIM);
    } else {
      line(ctx, 'TRẬN SẮP TỚI', 196, 700, 44, '#B9C3D8');
      teams(ctx, slide.home, slide.away, 346, 150);
      if (meta) line(ctx, meta, 420, 600, 40, '#B9C3D8');
      line(ctx, slide.countdown, 534, 800, 92, AMBER);
      line(ctx, whenText(slide.at), 604, 600, 40, WHITE);
    }
  }

  // Footer.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(56, H - 72, W - 112, 2);
  ctx.font = `500 26px ${WORLD_FONT}`;
  ctx.fillStyle = DIM;
  ctx.textAlign = 'left';
  if (slide.kind !== 'idle') ctx.fillText('Source: PandaScore · giờ trên thiết bị', 56, H - 30);
  ctx.textAlign = 'right';
  ctx.fillText('Lịch và kết quả: đến gần màn hình, nhấn E', W - 56, H - 30);

  // Panel grid of the salvaged display and a soft vignette.
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  for (let y = 3; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  for (let x = 320; x < W; x += 320) ctx.fillRect(x - 1, 0, 2, H);
  ctx.fillRect(0, H / 2 - 1, W, 2);
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------ world */

function placeOnGlass(e: pc.Entity, p: Placement, face: ScreenFace) {
  const holder = new pc.Entity('big-screen');
  holder.setLocalPosition(p.x, p.y ?? 0, p.z);
  holder.setLocalEulerAngles(0, p.yaw, 0);
  if (p.scale) holder.setLocalScale(p.scale, p.scale, p.scale);
  holder.addChild(e);
  // Orthonormal frame: +Z = out of the glass, +Y = the picture's up, +X = up x normal (text runs along +X).
  const n = new pc.Vec3(...face.normal).normalize(), up = new pc.Vec3(...face.up).normalize();
  const x = new pc.Vec3().cross(up, n).normalize();
  const m = new pc.Mat4();
  m.set([x.x, x.y, x.z, 0, up.x, up.y, up.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1]);
  e.setLocalRotation(new pc.Quat().setFromMat4(m));
  e.setLocalPosition(face.center[0], face.center[1], face.center[2]);
  return holder;
}

export function buildBigScreen(app: pc.AppBase, parent: pc.Entity, opts: BigScreenOptions = {}): BigScreen {
  const report = (msg: string) => console.error(`[screen] ${msg}`);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new pc.Texture(app.graphicsDevice, { width: W, height: H, mipmaps: true, anisotropy: 8, flipY: true });
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  // Unlit: the picture is its own light. Kept under the bloom threshold's hot range so the
  // lettering stays crisp; the glow on the rock comes from the model's light (scene.ts).
  const material = new pc.StandardMaterial();
  material.name = 'big-screen-picture';
  material.useLighting = false;
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  // The picture is the brightest thing in the dark cave: no haze on it (the black fog would swallow it
  // from across the hall) and a little over full brightness so it blooms like a lit panel.
  material.useFog = false;
  material.emissiveIntensity = 1.5;
  material.update();

  let feed: Feed | null = null;
  let key = '', blink = true;
  const draw = (force = false) => {
    const slide = opts.demo ? demoSlide(opts.demo) : screenSlide(feed, Date.now());
    const next = slideKey(slide);
    const live = slide.kind === 'running' && !opts.frozen;
    if (live) blink = !blink; else blink = true;
    if (!force && !live && next === key) return;
    key = next;
    paint(ctx, slide, blink);
    texture.setSource(canvas);
  };
  draw(true);

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
    if (document.hidden) { clearTimeout(poll); request?.abort(); }
    else void refresh();
  };
  const dispose = () => {
    disposed = true;
    clearInterval(timer); clearTimeout(poll); request?.abort();
    document.removeEventListener('visibilitychange', visibility);
    material.destroy(); texture.destroy();
  };

  const ready = loadManifests(['furniture'], report)
    .then(index => {
      const meshes: pc.Mesh[] = [];
      for (const p of HUB_SCREENS) {
        const declared = index.get(p.asset)?.meta?.screen;
        const face = isFace(declared) ? declared : p === HUB_SCREEN ? FALLBACK_FACE : null;
        if (!face) { report(`${p.asset}: no screen face in the manifest`); continue; }
        const mesh = quadMesh(app.graphicsDevice, face.size[0], face.size[1]);
        meshes.push(mesh);
        const picture = renderEntity('screen-picture', mesh, material);
        picture.render!.receiveShadows = false;
        root.addChild(placeOnGlass(picture, p, face));
      }
      root.on('destroy', () => { dispose(); for (const mesh of meshes) mesh.destroy(); });
      // The web font may arrive after the first picture: draw again with it.
      void document.fonts?.ready.then(() => { if (!disposed) draw(true); });
      if (opts.demo || opts.frozen) return;
      timer = setInterval(() => draw(), 1000);
      document.addEventListener('visibilitychange', visibility);
      void refresh();
    })
    .catch((err: unknown) => report(`failed: ${err instanceof Error ? err.message : String(err)}`));
  return { root, ready };
}
