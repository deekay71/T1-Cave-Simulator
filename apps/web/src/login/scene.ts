/**
 * Login scene (design/concepts/login-low-poly): the exterior set of tools/models/groups/login.ts
 * with the queue of fans walking into the cave mouth, shown before a player joins and again
 * after leaving.
 *
 * It lives in the same pc app as the cave, far away from it (SET_AT, turned so its camera looks
 * away from the cave) and in its own render layer: the cave's lights never reach the set and the
 * set's lights never reach the cave. While it is shown it owns the camera (pose and fov, written
 * in "prerender" so it wins over anything set during "update"), the camera's fog and far plane
 * and the scene's ambient light and exposure; hide() puts all of those back exactly as it found
 * them and disables the set, so in game it costs nothing (one early return per frame).
 *
 *   const login = createLoginScene(app, world.camera, { report });
 *   login.show();                 // startup, and when the player is back outside
 *   login.enterCave();            // joined: push toward the mouth, fade through red-black, hide()
 *
 * Framing: a fixed composition for landscape screens (queue receding to the mouth on the right,
 * the left third free for the title) and one for portrait phones (mouth above, queue below),
 * blended by the aspect ratio, with a very slow drift. prefers-reduced-motion: no drift, a
 * standing queue, no transition.
 */
import * as pc from "playcanvas";
import { preloadAvatars } from "../avatar.js";
import { glowMaterials, instantiateModel, loadModelContainer } from "../models.js";
import { loadManifests, modelUrl, type ManifestAsset } from "../world/manifest.js";
import { createLoginQueue, type LoginQueue } from "./queue.js";
import type { P3 } from "./queueMath.js";

type V3 = readonly [number, number, number];

/** World position of the set's origin (the cave hall is around the world origin). */
const SET_AT: V3 = [0, 0, 400];
/** The set is turned half round: its camera looks toward world +Z, away from the cave. */
const SET_YAW = 180;

const LOOK = {
  /** Cool purple haze; the sky dome's lowest band has nearly the same colour. */
  fog: { color: "#655E68", start: 8, end: 140 },
  ambient: [0.3, 0.29, 0.33] as const,
  exposure: 1.05,
  farClip: 330,
  /** Dim cool light from the sky, over the viewer's left shoulder (direction it travels, set space). */
  sky: { color: [0.92, 0.9, 0.95] as const, intensity: 0.8, dir: [0.42, -0.78, -0.46] as const },
  /** Red rim from the low sun behind the spires. */
  sun: { color: [1, 0.36, 0.3] as const, intensity: 0.85, dir: [0.25, -0.1, 0.96] as const },
  /** Slow breathing of the cracks, the throat's glow and its lights. */
  pulse: { amount: 0.14, hz: 0.11 },
};

interface Framing {
  pos: V3;
  look: V3;
  /** vertical fov at `aspect` */
  fov: number;
}
/** Landscape (authored at 16:9): eye 2 m above the crest, pitched 6 degrees down. */
const WIDE: Framing = { pos: [-7.07, 4.1, 21], look: [-7.07, 2.0, 1], fov: 40 };
/** Portrait phones: from the side of the path, the mouth in the middle, the line coming in below it. */
const TALL: Framing = { pos: [-13.5, 5.6, 17.5], look: [-2.2, 2.9, 3.5], fov: 58 };
const WIDE_ASPECT = 16 / 9;
/** Keeps the 16:9 horizontal view on narrower landscape screens, up to this vertical fov. */
const WIDE_MAX_FOV = 52;

/** Join transition: push toward the mouth while the screen goes red-black, then clear. */
const PUSH = 0.62;
const CLEAR = 0.5;
/**
 * First show: the veil lifts over this long once the set stands and the queue is on the path (or
 * after REVEAL_WAIT seconds without the fans, on a slow connection).
 */
const REVEAL = 0.7;
const REVEAL_WAIT = 5;
const PUSH_TO: Framing = { pos: [-1.6, 2.3, 5.2], look: [1.2, 1.9, -8], fov: 46 };

export interface LoginScene {
  /** The set is shown and this module owns the camera, fog and scene light. */
  readonly active: boolean;
  /** Set placed, the queue created (or their failures reported) and the loading veil lifted. */
  readonly ready: boolean;
  /** Show the login scene: startup, and after leaving the cave. */
  show(): void;
  /** Joined: push toward the cave mouth, fade through red-black, then hide(). */
  enterCave(): void;
  /** Hide at once and give the camera, fog and light back to the cave. */
  hide(): void;
  inspect(): unknown;
}

export interface LoginSceneOptions {
  report?: (msg: string) => void;
}

interface Saved {
  fog: { type: string; color: pc.Color; start: number; end: number; density: number } | null;
  ambient: pc.Color;
  exposure: number;
  farClip: number;
  fov: number;
  pos: pc.Vec3;
  rot: pc.Quat;
  layers: number[];
}

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createLoginScene(app: pc.AppBase, camera: pc.Entity, opts: LoginSceneOptions = {}): LoginScene {
  const report = opts.report ?? ((msg: string) => console.error(`[login] ${msg}`));
  const cam = camera.camera!;

  /** off: hidden · on: shown · push: joined, camera going in, veil closing · clear: hidden, veil lifting */
  type Mode = "off" | "on" | "push" | "clear";
  let mode: Mode = "off";
  let saved: Saved | null = null;
  /** seconds shown (drift, pulse) and seconds into the current transition phase */
  let time = 0;
  let phase = 0;
  let pulse = 1;
  /** 1 -> 0: the veil over a set that is still loading, lifted once it stands (first show only). */
  let reveal = 0;

  // Own layer, drawn right after the world's: separate lights, same depth buffer.
  const layer = new pc.Layer({ name: "Login" });
  const layers = app.scene.layers;
  const worldLayer = layers.getLayerByName("World");
  layers.insertOpaque(layer, worldLayer ? layers.getOpaqueIndex(worldLayer) + 1 : 0);
  layers.insertTransparent(layer, worldLayer ? layers.getTransparentIndex(worldLayer) + 1 : 0);

  const root = new pc.Entity("login-set");
  root.setPosition(SET_AT[0], SET_AT[1], SET_AT[2]);
  root.setEulerAngles(0, SET_YAW, 0);
  root.enabled = false;
  app.root.addChild(root);

  const directional = (name: string, l: { color: V3; intensity: number; dir: V3 }) => {
    const e = new pc.Entity(name);
    e.addComponent("light", {
      type: "directional",
      color: new pc.Color(l.color[0], l.color[1], l.color[2]),
      intensity: l.intensity,
      castShadows: false,
      layers: [layer.id],
    });
    e.setLocalRotation(new pc.Quat().setFromDirections(pc.Vec3.DOWN, new pc.Vec3(l.dir[0], l.dir[1], l.dir[2]).normalize()));
    root.addChild(e);
  };
  directional("login-sky-light", LOOK.sky);
  directional("login-sun-rim", LOOK.sun);

  /* ---------------------------------------------------------------- set + queue */

  const pulsing: { material: pc.StandardMaterial; base: number }[] = [];
  const glowLights: { light: pc.LightComponent; base: number }[] = [];
  let queueDef: { path: P3[]; crest: number; mouth: number } | null = null;
  let queue: LoginQueue | null = null;
  /** Earliest time (s) of the next attempt to build the queue (the avatars may still be loading). */
  let queueRetryAt = 0;
  let ready = false;

  const place = (asset: ManifestAsset, res: pc.ContainerResource) => {
    const meta = (asset.meta ?? {}) as {
      placements?: { at: V3; yaw: number; scale: number }[];
      lights?: { at: V3; color: string; intensity?: number; range?: number }[];
    };
    const unfogged = /_sky_|_sun_/.test(asset.name);
    for (const p of meta.placements ?? [{ at: [0, 0, 0] as V3, yaw: 0, scale: 1 }]) {
      const e = instantiateModel(res, false);
      for (const r of e.findComponents("render") as pc.RenderComponent[]) r.layers = [layer.id];
      e.setLocalPosition(p.at[0], p.at[1], p.at[2]);
      e.setLocalEulerAngles(0, p.yaw, 0);
      e.setLocalScale(p.scale, p.scale, p.scale);
      root.addChild(e);
      for (const m of glowMaterials(e)) {
        if (unfogged) {
          // the sky and the sun are the backdrop: the haze must not paint them over
          if (m.useFog) {
            m.useFog = false;
            m.update();
          }
        } else if (m.emissiveIntensity > 1.01 && !pulsing.some((x) => x.material === m))
          pulsing.push({ material: m, base: m.emissiveIntensity });
      }
    }
    for (const l of meta.lights ?? []) {
      const e = new pc.Entity("login-glow");
      e.addComponent("light", {
        type: "omni",
        color: new pc.Color().fromString(l.color),
        intensity: l.intensity ?? 1.5,
        range: l.range ?? 8,
        castShadows: false,
        layers: [layer.id],
      });
      e.setLocalPosition(l.at[0], l.at[1], l.at[2]);
      root.addChild(e);
      glowLights.push({ light: e.light!, base: l.intensity ?? 1.5 });
    }
    const path = (asset.meta as { path?: P3[]; pathCrest?: number; pathMouth?: number } | undefined)?.path;
    if (path && path.length > 1) {
      const m = asset.meta as { pathCrest?: number; pathMouth?: number };
      queueDef = { path, crest: m.pathCrest ?? 0, mouth: m.pathMouth ?? 0 };
    }
  };

  /**
   * The fans are the game's avatars. Their GLBs are loaded (and retried, and reported) by main.ts
   * through the same preloadAvatars(); until one outfit is there createAvatar throws, so this
   * just tries again a little later and the path stays empty meanwhile.
   */
  const buildQueue = () => {
    if (queue || !queueDef || mode === "off" || time < queueRetryAt) return;
    try {
      queue = createLoginQueue(app, root, layer.id, queueDef);
      queue.settle();
    } catch {
      queueRetryAt = time + 1.5;
    }
  };

  const setLoaded = (async () => {
    const index = await loadManifests(["login"], report);
    await Promise.all(
      [...index].map(async ([id, asset]) => {
        try {
          place(asset, await loadModelContainer(app, modelUrl(id)));
        } catch (err) {
          report(`login set: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  })();
  const avatars = preloadAvatars(app).then(
    () => {},
    () => {},
  );
  let setPlaced = false;
  void setLoaded.then(() => {
    setPlaced = true;
  });
  void Promise.all([setLoaded, avatars]).then(() => {
    queueRetryAt = 0;
    buildQueue();
    ready = true;
  });

  /* ---------------------------------------------------------------- look + camera */

  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => !!motion?.matches;
  motion?.addEventListener?.("change", () => {
    if (still()) queue?.settle();
  });

  // Red-black veil for the join transition: above the canvas and the name tags, below the UI.
  const veil = document.createElement("div");
  veil.className = "login-veil";
  veil.setAttribute("aria-hidden", "true");
  const uiRoot = document.querySelector("#ui");
  if (uiRoot?.parentNode) uiRoot.parentNode.insertBefore(veil, uiRoot);
  else document.body.appendChild(veil);
  let veilShown = -1;
  const setVeil = (v: number) => {
    const q = Math.round(v * 50) / 50;
    if (q === veilShown) return;
    veilShown = q;
    veil.style.opacity = String(q);
    veil.style.display = q > 0 ? "block" : "none";
  };
  setVeil(0);

  const takeOver = () => {
    const f = cam.fog;
    saved = {
      fog: f ? { type: f.type, color: f.color.clone(), start: f.start, end: f.end, density: f.density } : null,
      ambient: app.scene.ambientLight.clone(),
      exposure: app.scene.exposure,
      farClip: cam.farClip,
      fov: cam.fov,
      pos: camera.getPosition().clone(),
      rot: camera.getRotation().clone(),
      layers: cam.layers.slice(),
    };
    const fog = f ?? (cam.fog = new pc.FogParams());
    fog.type = pc.FOG_LINEAR;
    fog.color.fromString(LOOK.fog.color);
    fog.start = LOOK.fog.start;
    fog.end = LOOK.fog.end;
    app.scene.ambientLight = new pc.Color(LOOK.ambient[0], LOOK.ambient[1], LOOK.ambient[2]);
    app.scene.exposure = LOOK.exposure;
    cam.farClip = LOOK.farClip;
    if (!cam.layers.includes(layer.id)) cam.layers = [...cam.layers, layer.id];
    root.enabled = true;
  };
  const giveBack = () => {
    root.enabled = false;
    queue?.destroy();
    queue = null;
    const s = saved;
    saved = null;
    if (!s) return;
    if (s.fog && cam.fog) {
      cam.fog.type = s.fog.type;
      cam.fog.color.copy(s.fog.color);
      cam.fog.start = s.fog.start;
      cam.fog.end = s.fog.end;
      cam.fog.density = s.fog.density;
    } else if (!s.fog) cam.fog = null;
    app.scene.ambientLight = s.ambient;
    app.scene.exposure = s.exposure;
    cam.farClip = s.farClip;
    cam.fov = s.fov;
    cam.layers = s.layers;
    camera.setPosition(s.pos);
    camera.setRotation(s.rot);
  };

  const pos = new pc.Vec3();
  const look = new pc.Vec3();
  const frame: { pos: [number, number, number]; look: [number, number, number]; fov: number } = {
    pos: [0, 0, 0],
    look: [0, 0, 0],
    fov: 40,
  };
  /** Composition for the current aspect ratio (set space), before drift. */
  const compose = () => {
    const w = app.graphicsDevice.width,
      h = Math.max(1, app.graphicsDevice.height);
    const aspect = w / h;
    // landscape: keep the 16:9 horizontal view when the screen is narrower
    const wideFov =
      aspect >= WIDE_ASPECT
        ? WIDE.fov
        : Math.min(WIDE_MAX_FOV, (2 * Math.atan((Math.tan((WIDE.fov * DEG) / 2) * WIDE_ASPECT) / aspect)) / DEG);
    const t = smoothstep(0.8, 1.2, aspect); // 0 portrait .. 1 landscape
    for (let k = 0; k < 3; k++) {
      frame.pos[k] = lerp(TALL.pos[k], WIDE.pos[k], t);
      frame.look[k] = lerp(TALL.look[k], WIDE.look[k], t);
    }
    frame.fov = lerp(TALL.fov, wideFov, t);
  };
  const aim = () => {
    compose();
    const [p, l] = [frame.pos, frame.look];
    let fov = frame.fov;
    if (!still()) {
      // very slow drift: a breath, not a move
      p[0] += 0.28 * Math.sin(time * 0.11);
      p[1] += 0.07 * Math.sin(time * 0.13 + 1.1);
      p[2] += 0.22 * Math.sin(time * 0.07 + 2.1);
      l[0] += 0.3 * Math.sin(time * 0.05);
      l[1] += 0.08 * Math.sin(time * 0.08);
    }
    if (mode === "push") {
      const u = Math.min(1, phase / PUSH);
      const e = u * u * (3 - 2 * u) * 0.6; // part of the way: the veil closes before the mouth
      for (let k = 0; k < 3; k++) {
        p[k] = lerp(p[k], PUSH_TO.pos[k], e);
        l[k] = lerp(l[k], PUSH_TO.look[k], e);
      }
      fov = lerp(fov, PUSH_TO.fov, e);
    }
    const m = root.getWorldTransform();
    m.transformPoint(pos.set(p[0], p[1], p[2]), pos);
    m.transformPoint(look.set(l[0], l[1], l[2]), look);
    camera.setPosition(pos);
    camera.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.005) cam.fov = fov;
  };

  app.on("update", (dt: number) => {
    if (mode === "off") return;
    if (mode === "clear") {
      phase += dt;
      const u = Math.min(1, phase / CLEAR);
      setVeil(1 - u * u * (3 - 2 * u));
      if (u >= 1) mode = "off";
      return;
    }
    time += dt;
    if (!queue) buildQueue();
    if (reveal > 0 && mode === "on" && setPlaced && (ready || time > REVEAL_WAIT)) {
      reveal = still() ? 0 : Math.max(0, reveal - dt / REVEAL);
      setVeil(reveal * reveal * (3 - 2 * reveal));
    }
    if (!still()) {
      queue?.update(dt);
      const wave = 0.7 * Math.sin(time * LOOK.pulse.hz * Math.PI * 2) + 0.3 * Math.sin(time * 0.53 + 1.3);
      const k = 1 + LOOK.pulse.amount * (Math.round(wave * 40) / 40);
      if (k !== pulse) {
        pulse = k;
        for (const p of pulsing) {
          p.material.emissiveIntensity = p.base * k;
          p.material.update();
        }
        for (const g of glowLights) g.light.intensity = g.base * k;
      }
    }
    if (mode === "push") {
      phase += dt;
      const u = Math.min(1, phase / PUSH);
      setVeil(smoothstep(0.1, 1, u));
      if (u >= 1) {
        giveBack();
        mode = "clear";
        phase = 0;
      }
    }
  });
  // Last word on the camera while the set is shown (after every "update" handler).
  app.on("prerender", () => {
    if (mode === "on" || mode === "push") aim();
  });

  const api: LoginScene = {
    get active() {
      return mode === "on" || mode === "push";
    },
    get ready() {
      return ready && reveal <= 0;
    },
    show() {
      if (mode === "on") return;
      if (mode !== "push") takeOver(); // "push" still owns everything: just stay
      mode = "on";
      phase = 0;
      reveal = setPlaced ? 0 : 1;
      setVeil(reveal);
      buildQueue();
      aim();
    },
    enterCave() {
      if (mode !== "on") return;
      if (still()) return api.hide();
      mode = "push";
      phase = 0;
      reveal = 0;
    },
    hide() {
      if (mode === "on" || mode === "push") giveBack();
      mode = "off";
      setVeil(0);
    },
    inspect() {
      return {
        mode,
        ready,
        still: still(),
        veil: veilShown,
        fans: queue?.inspect() ?? [],
        fov: Math.round(cam.fov * 10) / 10,
      };
    },
  };
  return api;
}
