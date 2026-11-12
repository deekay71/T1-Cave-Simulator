/**
 * The clip a player hears on walking into the shrine (the commentary of Faker's 2013 Zed duel is
 * what the cave has in mind). Local only: it plays in this browser for this player, nobody else
 * hears it and nothing goes through the game server.
 *
 * The clip itself is NOT part of the repository: broadcast commentary is copyrighted, so whoever
 * hosts the game supplies a file they have the right to use, at /audio/shrine-entry.mp3
 * (apps/web/public/audio/, git-ignored) or at VITE_SHRINE_AUDIO_URL. Without a playable file the
 * feature stays off and shows no control.
 *
 * - enter(): starts the clip from the top (once per visit), fading in.
 * - leave(): fades it out and stops.
 * - The player's mute choice is remembered in localStorage.
 */
const KEY = "tl.shrineAudio.muted";
const VOLUME = 0.8;
const FADE_MS = 600;

export type ShrineAudioState = "none" | "on" | "muted";
export interface ShrineAudio {
  /** "none" until a playable file has been found. */
  readonly state: ShrineAudioState;
  /** True while the clip is audibly playing (tests, debugging). */
  readonly playing: boolean;
  enter(): void;
  leave(): void;
  /** Mute / unmute (remembered); unmuting inside the shrine restarts the clip. */
  toggle(): void;
  onChange(listener: (state: ShrineAudioState) => void): void;
}

export function createShrineAudio(url: string): ShrineAudio {
  let available = false,
    inside = false,
    fade = 0;
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === "1";
  } catch {
    /* private mode: not remembered */
  }
  const listeners: ((state: ShrineAudioState) => void)[] = [];
  const state = (): ShrineAudioState => (!available ? "none" : muted ? "muted" : "on");
  const emit = () => listeners.forEach((l) => l(state()));

  const audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("canplaythrough", () => {
    if (available) return;
    available = true;
    emit();
    if (inside) start();
  });
  // A missing file (404, or the page itself served in its place) ends here: the feature stays off.
  audio.addEventListener("error", () => {
    available = false;
    emit();
  });
  audio.src = url;

  const ramp = (to: number, then?: () => void) => {
    cancelAnimationFrame(fade);
    const from = audio.volume,
      t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      audio.volume = from + (to - from) * k;
      if (k < 1) fade = requestAnimationFrame(step);
      else then?.();
    };
    fade = requestAnimationFrame(step);
  };
  function start() {
    if (!available || muted) return;
    audio.currentTime = 0;
    audio.volume = 0;
    // Autoplay rules: the player has already clicked or pressed a key to get here; if the browser
    // still refuses, stay silent rather than throw.
    void audio.play().then(() => ramp(VOLUME), () => undefined);
  }
  const stop = () => ramp(0, () => audio.pause());

  return {
    get state() {
      return state();
    },
    get playing() {
      return !audio.paused && audio.volume > 0;
    },
    enter() {
      if (inside) return;
      inside = true;
      start();
    },
    leave() {
      if (!inside) return;
      inside = false;
      if (!audio.paused) stop();
    },
    toggle() {
      if (!available) return;
      muted = !muted;
      try {
        localStorage.setItem(KEY, muted ? "1" : "0");
      } catch {
        /* not remembered */
      }
      if (muted) {
        if (!audio.paused) stop();
      } else if (inside) start();
      emit();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
