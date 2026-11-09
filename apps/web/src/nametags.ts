/**
 * Name tags: DOM labels over the players' heads, positioned every frame from a world point
 * (avatar.headTop) through the camera's worldToScreen.
 *
 *   const tags = createNameTags(document.querySelector("#tags")!);
 *   tags.set(id, name, { self, away });     // create / rename (textContent only: names are user input)
 *   // every frame, AFTER the camera moved:
 *   tags.begin(cameraEntity);
 *   tags.place(id, avatar.headTop);         // or null to hide
 *   tags.end();                             // lay out and write this frame's tags
 *   tags.remove(id);                        // player left
 *
 * - Hidden when behind the camera, off-screen or farther than MAX_DIST from the camera; others'
 *   tags fade (and shrink a little) with distance.
 * - The own tag (self) is shown for SELF_SHOW s from the first frame it is on screen, so a player
 *   can spot themselves after joining, then fades out: it would otherwise sit on whatever the
 *   camera looks at. tags.set() with a new name shows it again.
 * - end() keeps tags inside the viewport (8 px gutter) and stacks overlapping tags: nearer tags keep
 *   their place, a farther one moves up above it.
 * - Per frame only `transform`, `opacity` and (quantised) `z-index` are written, and only when they
 *   change; visibility flips only on a state change. Layout is read once per tag after its text or
 *   style changed (its size), never per frame.
 */
import * as pc from "playcanvas";

/** Fully opaque up to this camera distance (m). */
const FADE_FROM = 9;
/** Hidden beyond this camera distance (m). */
const MAX_DIST = 18;
/** Closer than this in front of the camera counts as behind it (m). */
const NEAR = 0.2;
/** How far outside the viewport (px) a tag anchor may be before it is hidden. */
const MARGIN = 80;
/** Tags stay this far (px) inside the viewport edges. */
const GUTTER = 8;
/** Vertical gap (px) between stacked tags. */
const STACK_GAP = 2;
/** The own tag: shown this long (s) once on screen, then faded out over SELF_FADE s. */
const SELF_SHOW = 4;
const SELF_FADE = 0.8;

interface Tag {
  readonly el: HTMLDivElement;
  name: string;
  self: boolean;
  away: boolean;
  shown: boolean;
  /** Layout size (px, before scale); NaN = measure again. */
  w: number;
  h: number;
  /** This frame: wanted on screen, anchor (px), scale, opacity, camera distance. */
  want: boolean;
  ax: number;
  ay: number;
  wantScale: number;
  wantOpacity: number;
  dist: number;
  /** Own tag: when it was first on screen (s, performance clock), NaN = not yet. */
  selfSince: number;
  /** Written style. */
  x: number;
  y: number;
  scale: number;
  opacity: number;
  z: number;
}

export interface NameTagOptions {
  /** The local player's own tag (styled apart, shown for a few seconds only). */
  self: boolean;
  /** Connection lost, seat kept for a reconnect: shown dimmed. */
  away?: boolean;
}

export interface NameTags {
  /** Create or update the tag of `id`. */
  set(id: string, name: string, opts: NameTagOptions): void;
  remove(id: string): void;
  clear(): void;
  /** Start a frame: read the camera once (call after the camera moved this frame). */
  begin(camera: pc.Entity): void;
  /** Anchor the bottom-centre of the tag at a world point this frame, or hide it (null). */
  place(id: string, at: pc.Vec3 | null): void;
  /** Finish the frame: keep tags on screen, stack overlapping ones, write the styles. */
  end(): void;
  /** Debug view of the tags (dev tools, headless tests). */
  inspect(): {
    id: string;
    name: string;
    self: boolean;
    shown: boolean;
    x: number;
    y: number;
    opacity: number;
  }[];
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createNameTags(container: HTMLElement): NameTags {
  const tags = new Map<string, Tag>();
  const camPos = new pc.Vec3();
  const camFwd = new pc.Vec3();
  const toTag = new pc.Vec3();
  const screen = new pc.Vec3();
  let cam: pc.CameraComponent | null = null;
  let width = 0;
  let height = 0;
  let now = 0;
  /** Scratch for end(): this frame's visible tags, nearest first, and their placed boxes. */
  const order: Tag[] = [];
  const boxes: number[] = [];

  const show = (t: Tag, on: boolean) => {
    if (t.shown === on) return;
    t.shown = on;
    t.el.style.visibility = on ? "" : "hidden";
  };

  const style = (t: Tag) => {
    const classes = ["tag"];
    if (t.self) classes.push("self");
    if (t.away) classes.push("away");
    t.el.className = classes.join(" ");
    t.w = t.h = NaN;
  };

  const byDistance = (a: Tag, b: Tag) => a.dist - b.dist;

  return {
    set(id, name, opts) {
      let t = tags.get(id);
      if (!t) {
        const el = document.createElement("div");
        el.style.visibility = "hidden";
        container.appendChild(el);
        t = {
          el,
          name: "",
          self: opts.self,
          away: !!opts.away,
          shown: false,
          w: NaN,
          h: NaN,
          want: false,
          ax: 0,
          ay: 0,
          wantScale: 1,
          wantOpacity: 0,
          dist: 0,
          selfSince: NaN,
          x: NaN,
          y: NaN,
          scale: NaN,
          opacity: NaN,
          z: NaN,
        };
        tags.set(id, t);
        style(t);
      } else if (t.self !== opts.self || t.away !== !!opts.away) {
        t.self = opts.self;
        t.away = !!opts.away;
        style(t);
      }
      if (t.name !== name) {
        t.name = name;
        t.el.textContent = name; // user input: never innerHTML
        t.w = t.h = NaN;
        t.selfSince = NaN; // a renamed own tag shows again
      }
    },

    remove(id) {
      const t = tags.get(id);
      if (!t) return;
      t.el.remove();
      tags.delete(id);
    },

    clear() {
      for (const t of tags.values()) t.el.remove();
      tags.clear();
    },

    begin(camera) {
      cam = camera.camera ?? null;
      camPos.copy(camera.getPosition());
      camFwd.copy(camera.forward);
      // the canvas fills the window (#scene is 100vw x 100vh): no layout read needed
      width = window.innerWidth;
      height = window.innerHeight;
      now = performance.now() / 1000;
      for (const t of tags.values()) t.want = false;
    },

    place(id, at) {
      const t = tags.get(id);
      if (!t || !at || !cam) return;
      toTag.sub2(at, camPos);
      const dist = toTag.length();
      if (toTag.dot(camFwd) < NEAR || dist > MAX_DIST) return;
      cam.worldToScreen(at, screen);
      const sx = screen.x,
        sy = screen.y;
      if (!(
        sx > -MARGIN &&
        sx < width + MARGIN &&
        sy > -MARGIN &&
        sy < height + MARGIN
      ))
        return;
      let opacity: number;
      if (t.self) {
        if (Number.isNaN(t.selfSince)) t.selfSince = now;
        const age = now - t.selfSince;
        opacity =
          age <= SELF_SHOW
            ? 1
            : Math.round(
                (1 - smoothstep(SELF_SHOW, SELF_SHOW + SELF_FADE, age)) * 20,
              ) / 20;
      } else
        opacity =
          Math.round((1 - smoothstep(FADE_FROM, MAX_DIST, dist)) * 20) / 20;
      if (opacity <= 0) return;
      t.want = true;
      t.ax = sx;
      t.ay = sy;
      t.dist = dist;
      t.wantOpacity = opacity;
      t.wantScale = t.self
        ? 1
        : Math.round((1 - 0.18 * smoothstep(4, MAX_DIST, dist)) * 50) / 50;
    },

    end() {
      order.length = 0;
      for (const t of tags.values()) {
        if (!t.want) {
          show(t, false);
          continue;
        }
        if (Number.isNaN(t.w)) {
          // once per text / style change (forces one layout); visibility:hidden still lays out
          t.w = t.el.offsetWidth;
          t.h = t.el.offsetHeight;
        }
        order.push(t);
      }
      order.sort(byDistance);
      boxes.length = 0;
      for (const t of order) {
        const s = t.wantScale;
        const hw = (t.w * s) / 2,
          h = t.h * s;
        // keep the whole tag inside the viewport, then lift it above any nearer tag it overlaps
        let x = Math.min(Math.max(t.ax, GUTTER + hw), width - GUTTER - hw);
        if (2 * hw > width - 2 * GUTTER) x = width / 2;
        let y = Math.min(Math.max(t.ay, GUTTER + h), height - GUTTER);
        for (
          let moved = true, guard = 0;
          moved && guard < order.length;
          guard++
        ) {
          moved = false;
          for (let i = 0; i < boxes.length; i += 4) {
            const l = boxes[i],
              r = boxes[i + 1],
              top = boxes[i + 2],
              bottom = boxes[i + 3];
            if (x + hw <= l || x - hw >= r || y <= top || y - h >= bottom)
              continue;
            y = top - STACK_GAP;
            moved = true;
          }
        }
        boxes.push(x - hw, x + hw, y - h, y);
        const rx = Math.round(x),
          ry = Math.round(y);
        if (rx !== t.x || ry !== t.y || s !== t.scale) {
          t.x = rx;
          t.y = ry;
          t.scale = s;
          t.el.style.transform = `translate3d(${rx}px,${ry}px,0) translate(-50%,-100%) scale(${s})`;
        }
        if (t.wantOpacity !== t.opacity) {
          t.opacity = t.wantOpacity;
          t.el.style.opacity = String(t.wantOpacity);
        }
        // nearer tags on top, in 0.5 m steps
        const z = 60 - Math.round(t.dist * 2);
        if (z !== t.z) {
          t.z = z;
          t.el.style.zIndex = String(z);
        }
        show(t, true);
      }
    },

    inspect() {
      return [...tags].map(([id, t]) => ({
        id,
        name: t.name,
        self: t.self,
        shown: t.shown,
        x: t.x,
        y: t.y,
        opacity: t.opacity,
      }));
    },
  };
}
