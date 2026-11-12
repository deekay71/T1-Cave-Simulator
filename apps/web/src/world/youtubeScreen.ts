/**
 * YouTube clips on the big wall screen. A browser never lets a page read the pixels of another
 * site's player, so the clip cannot become a texture. Instead the official embedded player (IFrame
 * API) sits in the page BEHIND the WebGL canvas, bent with a CSS matrix3d onto the four projected
 * corners of the screen's video window, and the screen quad draws fully transparent pixels there
 * (bigScreen.ts "hole"): the clip shows through the canvas exactly where the window is, and anybody
 * standing in front of the screen still covers it, because their pixels stay opaque.
 *
 * The player is hidden (and the hole closed) when the window is off screen, behind the camera, or
 * smaller than YouTube's 200 x 200 px minimum for embedded players; it never takes the mouse
 * (pointer-events: none), so dragging to orbit the camera still works over it.
 */
const API_URL = "https://www.youtube.com/iframe_api";
/** CSS size of the player before the perspective transform (the video window is 16:9). */
export const PLAYER_W = 960;
export const PLAYER_H = 540;
/** YouTube's minimum player size for embeds (px, on screen). */
const MIN_SIZE = 200;

/* ------------------------------------------------------------------ homography */

type Pt = readonly [number, number];
/**
 * CSS matrix3d that maps the rectangle (0,0)-(w,h) onto the quad p[0..3] (top-left, top-right,
 * bottom-right, bottom-left), transform-origin 0 0. null when the quad is degenerate.
 */
export function quadToMatrix3d(w: number, h: number, p: readonly Pt[]): string | null {
  const src: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  // Solve for the 8 unknowns of H (h33 = 1): u = (h11 x + h12 y + h13) / (h31 x + h32 y + 1), same for v.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = p[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let best = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    if (Math.abs(A[best][c]) < 1e-9) return null;
    [A[c], A[best]] = [A[best], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const sol = A.map((row, i) => row[8] / row[i]);
  const [a, b, c, d, e, f, g, k] = sol;
  // Column-major 4x4: x' = a x + b y + c, y' = d x + e y + f, w' = g x + k y + 1.
  const m = [a, d, 0, g, b, e, 0, k, 0, 0, 1, 0, c, f, 0, 1];
  if (m.some((n) => !Number.isFinite(n))) return null;
  return `matrix3d(${m.map((n) => +n.toFixed(9)).join(",")})`;
}

/** Shortest side (px) of a quad given as 4 corners in order. */
export function quadMinSide(p: readonly Pt[]): number {
  let min = Infinity;
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % 4];
    min = Math.min(min, Math.hypot(x1 - x0, y1 - y0));
  }
  return min;
}

/* ------------------------------------------------------------------ IFrame API */

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let apiPromise: Promise<YTNamespace> | null = null;
/** Load the IFrame API once (also used by the admin page to preview and measure a clip). */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Không tải được trình phát YouTube."));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/* ------------------------------------------------------------------ the screen player */

export type YoutubeState = "idle" | "loading" | "playing" | "error";
export interface YoutubeScreen {
  /** Play `id` from `offset` s (no-op when it already is). Muted unless setSound(true). */
  play(id: string, offset: number): void;
  stop(): void;
  /** Position in the clip (s), or null before it plays. */
  time(): number | null;
  seek(offset: number): void;
  readonly state: YoutubeState;
  /** Volume 0..1 (0 = muted). */
  setVolume(v: number): void;
  /** Put the player over these screen corners (CSS px) or hide it (null). Returns true if shown. */
  place(corners: readonly Pt[] | null): boolean;
  /** Called with the failed id (embedding disabled, removed, network). */
  onError(listener: (id: string) => void): void;
}

export function createYoutubeScreen(): YoutubeScreen {
  const box = document.createElement("div");
  box.id = "screen-yt";
  box.setAttribute("aria-hidden", "true");
  // Behind the canvas (negative z-index paints under in-flow content), never takes the mouse.
  Object.assign(box.style, {
    position: "fixed", left: "0", top: "0", width: `${PLAYER_W}px`, height: `${PLAYER_H}px`,
    transformOrigin: "0 0", zIndex: "-1", pointerEvents: "none", visibility: "hidden", background: "#000",
  });
  const mount = document.createElement("div");
  box.appendChild(mount);
  document.body.prepend(box);

  let player: YTPlayer | null = null;
  let creating = false;
  let current: string | null = null;
  let pending: { id: string; offset: number } | null = null;
  let state: YoutubeState = "idle";
  let volume = 0;
  let shown = false;
  const errors: ((id: string) => void)[] = [];
  const applyVolume = () => {
    if (!player) return;
    if (volume <= 0) player.mute();
    else {
      player.unMute();
      player.setVolume(Math.round(volume * 100));
    }
  };
  const start = (id: string, offset: number) => {
    current = id;
    state = "loading";
    if (!player) {
      pending = { id, offset };
      if (creating) return;
      creating = true;
      loadYouTubeApi()
        .then((YT) => {
          const first = pending ?? { id, offset };
          player = new YT.Player(mount, {
            width: PLAYER_W,
            height: PLAYER_H,
            videoId: first.id,
            host: "https://www.youtube.com",
            playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, start: Math.floor(first.offset) },
            events: {
              onReady: () => {
                applyVolume();
                const p = pending;
                pending = null;
                if (p && p.id !== first.id) player!.loadVideoById({ videoId: p.id, startSeconds: p.offset });
                else player!.playVideo();
              },
              onStateChange: (e: { data: number }) => {
                if (e.data === 1) state = "playing";
                // ended: loop the clip until the playlist moves on
                if (e.data === 0) { player!.seekTo(0, true); player!.playVideo(); }
              },
              onError: () => {
                state = "error";
                const failed = current;
                if (failed) errors.forEach((l) => l(failed));
              },
            },
          });
          const iframe = box.querySelector("iframe");
          iframe?.setAttribute("tabindex", "-1");
          iframe?.setAttribute("title", "Clip trên màn hình lớn");
        })
        .catch(() => {
          state = "error";
          errors.forEach((l) => l(id));
        })
        .finally(() => { creating = false; });
      return;
    }
    player.loadVideoById({ videoId: id, startSeconds: offset });
  };
  return {
    play(id, offset) {
      if (id === current && state !== "error") return;
      start(id, offset);
    },
    stop() {
      current = null;
      pending = null;
      state = "idle";
      player?.stopVideo();
      box.style.visibility = "hidden";
      shown = false;
    },
    time() {
      return player && state === "playing" ? player.getCurrentTime() : null;
    },
    seek(offset) {
      player?.seekTo(offset, true);
    },
    get state() {
      return state;
    },
    setVolume(v) {
      const next = Math.max(0, Math.min(1, v));
      if (Math.abs(next - volume) < 0.02 && (next > 0) === (volume > 0)) return;
      volume = next;
      applyVolume();
    },
    place(corners) {
      const ok = !!corners && !!current && state !== "error" && quadMinSide(corners) >= MIN_SIZE;
      const m = ok ? quadToMatrix3d(PLAYER_W, PLAYER_H, corners!) : null;
      if (m) box.style.transform = m;
      const visible = !!m;
      if (visible !== shown) {
        shown = visible;
        box.style.visibility = visible ? "visible" : "hidden";
      }
      return visible;
    },
    onError(listener) {
      errors.push(listener);
    },
  };
}
