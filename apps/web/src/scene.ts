/**
 * Hang trú thua — the game world (design/concepts/v3), assembled from the generated GLBs
 * (apps/web/public/models, loaded through ./models.ts) and the shared placement table
 * (packages/shared/src/layout.ts), which is also where the server's collision comes from: what
 * players see and what they bump into are the same data.
 *
 * The world is five caves: the big communal cave around the campfire and four small side caves
 * joined to it by short walk-through tunnels (shell: the "caves" model group, placed by
 * CAVE_SHELL_PIECES / HUB_CAVES of the shared layout). Every side cave has its own warm fill light
 * and a focal light at its rock niche, where the stall stands.
 *
 * createWorld(app) owns the single camera (ACES + sRGB, clear colour, fog, clip planes), the scene
 * lighting and every model of the cave. It registers its own update handler (flame, ember and
 * light flicker, sparks, NPC breathing, water glints, the quality monitor), creates no player
 * avatars and reads no input.
 *
 * Loading is progressive: every GLB is requested at once and placed as soon as it arrives (cave
 * shell first), so one slow or missing file never holds back the rest of the cave; batching is
 * set up once everything has arrived.
 *
 * Rendering budget: the campfire is the only shadow-casting light (a short-range light raised
 * above the seated fans, so their shadows stay near the fire; a wide unshadowed twin lights the
 * hall); props and characters cast, the cave shell and small props never do; static props share
 * one matte material and are statically batched; glow parts are unlit, so real omni lights sit at
 * the manifest light anchors. Quality "low" (touch-first devices, or frames that stay slow) drops
 * the post-processing and halves the shadow atlas.
 */
import * as pc from "playcanvas";
import {
  CAVE_SHELL_PIECES,
  HUB_CAVES,
  HUB_LANDMARKS,
  HUB_PLACEMENTS,
  frameToCave,
  type LandmarkId,
  type Placement,
  type PoseJoint,
} from "@te-liet/shared";
import {
  glowMaterials,
  instantiateModel,
  loadModelContainer,
} from "./models.js";
import {
  loadManifests,
  modelUrl,
  type ManifestAsset,
} from "./world/manifest.js";
import { applyPose, attachHeld, Breather } from "./world/npc.js";
import { hubViews, type CameraView } from "./world/views.js";
import { createWaterGlints, type GlintSource } from "./world/water.js";
import { buildShrine } from "./world/shrine.js";
import { buildCaveStalls } from "./world/stalls.js";
import { buildBigScreen, type ScreenDemo } from "./world/bigScreen.js";

export type { LandmarkId } from "@te-liet/shared";
export type { CameraView } from "./world/views.js";

declare global {
  interface Window {
    __errors?: string[];
  }
}

/** E-key points of interest: where a player stands to look at the object (trigger < 3 m). */
export const landmarks: readonly {
  id: LandmarkId;
  name: string;
  x: number;
  z: number;
}[] = HUB_LANDMARKS;

/** "high": post-processing (HDR, MSAA, bloom, vignette) + PCF5 shadows; "low": neither. */
export type Quality = "high" | "low";

export interface World {
  /** The single camera entity, configured (ACES, sRGB, clear colour, fog, clip planes). */
  camera: pc.Entity;
  /** Resolves when every GLB is loaded and placed; failures are reported, never block. */
  ready: Promise<void>;
  /** Camera presets (world/views.ts): concept, spawn, overview, the zones, every side cave and tunnel. */
  views: Record<string, CameraView>;
  /** Put the camera at a preset (dev / screenshots). */
  setView(name: string): boolean;
  /** Current render quality. */
  readonly quality: Quality;
  /** Switch the render quality (a settings menu, or tests); stops the automatic monitor. */
  setQuality(quality: Quality): void;
}

export interface WorldOptions {
  /** Static NPC fans (default true). */
  npcs?: boolean;
  /**
   * Post-processing (pc.CameraFrame: ACES, MSAA, soft bloom on flames, vignette). Default: on at
   * quality "high", off at "low"; true / false forces it either way.
   */
  post?: boolean;
  /**
   * "auto" (default): "low" on touch-first devices (coarse pointer), otherwise "high", dropping
   * to "low" for good when the average frame stays above 25 ms for two 4 s windows.
   */
  quality?: Quality | "auto";
  /** Freeze flicker and idles at this time in seconds (deterministic screenshots). */
  time?: number;
  /** Canned picture on the big wall screen instead of the match feed (dev preview, screenshots). */
  screen?: ScreenDemo;
}

/* ------------------------------------------------------------------ look */

const GROUPS = [
  "caves",
  "environment",
  "fire",
  "furniture",
  "props",
  "characters",
] as const;
const STATIC_BATCH_GROUP = "tl_static_props";
/** NPC fans move only spine/neck/head: one dynamic batch draws all of them (and their held props). */
const NPC_BATCH_GROUP = "tl_npc_fans";
/** Sub-nodes that move every frame (never statically batched). */
const ANIMATED_NODES = new Set([
  "flames",
  "flame_outer",
  "flame_mid",
  "flame_core",
  "sparks",
]);
/** Small or flat assets that would only add shadow-pass work (every caster is drawn 6 times). */
const NO_SHADOW =
  /^tl_env_stone_small_|^tl_furn_rug_|^tl_fx_embers_ring_|^tl_prop_(mug|noodle|kettle|gamepad|phone|blanket)_/;

const LOOK = {
  clear: "#0D0907",
  exposure: 1.15,
  /** sRGB; slightly cool so the big rock faces keep their facets without turning orange. */
  ambient: [0.27, 0.27, 0.3] as const,
  /**
   * Warm haze: far walls fade toward a lit brown, not toward black. The main cave is ~47 m across
   * (wall to wall), so the haze starts beyond the fire group and leaves the far wall readable.
   */
  fog: { color: "#2A1A12", start: 20, end: 88 },
  /** Dim cool light from above the spawn: keeps the far walls' facets and lowers the saturation. */
  fill: {
    color: [0.62, 0.68, 0.9] as const,
    intensity: 0.55,
    euler: [52, -24, 0] as const,
  },
  post: { bloom: 0.07, bloomThreshold: 0.55, vignette: 0.32 },
  /** Unshadowed warm bounce over the hall (the fire lighting the cave as a whole). */
  bounce: {
    at: [0, 5.5, -1] as const,
    color: "#FFE4CC",
    intensity: 0.45,
    range: 34,
  },
  /**
   * Warm lights high up near the walls (wall face ~23.4 m at the floor, leaning in to ~21 m at
   * 9 m): the big faceted walls of board 01 read far from the fire. They sit ~6 m in front of the
   * rock, between the tunnel mouths, so each lights one stretch of wall.
   */
  walls: [
    // Behind the exit (the backdrop of board 01) and its two back corners.
    { at: [0, 7.5, -15], intensity: 0.85, range: 19 },
    { at: [-9, 8, -17], intensity: 0.9, range: 15 },
    { at: [9, 8, -17], intensity: 0.9, range: 15 },
    // Left and right walls (between the back and front tunnel mouths).
    { at: [-15, 7, 0], intensity: 0.85, range: 19 },
    { at: [15, 7, 0], intensity: 0.85, range: 19 },
    // Behind the spawn: lights the wall a player sees on turning round, less the foreground floor.
    { at: [-8, 7, 14], intensity: 0.7, range: 18 },
    { at: [8, 7, 14], intensity: 0.7, range: 18 },
  ] as const,
  /** Pale warm: the rock's own ochre does the rest (a deeper orange oversaturates the walls). */
  wallColor: "#FFDCC4",
  /** Warm light on the exit sign above the tunnel mouth (the focal point at the back). */
  sign: {
    at: [0, 4.2, -20.5] as const,
    color: "#FFC78C",
    intensity: 1,
    range: 4.5,
  },
  /**
   * Per side cave (walk radius 7 m, rock ceiling 5.1-7.2 m): a soft warm fill under the ceiling at
   * the cave centre, so the small cave reads beyond its torches, and a focal light in front of the
   * rock niche (niche-frame z, i.e. metres from the centre toward the niche) on the stall.
   */
  side: {
    fill: { y: 3.6, intensity: 0.85, range: 12.5 },
    focal: { z: -4.9, y: 2.7, color: "#FFD2A0", intensity: 0.95, range: 7 },
  },
};

interface LightLook {
  color: string;
  intensity: number;
  range: number;
  /** Relative intensity flicker amplitude. */
  flicker: number;
  hz: number;
  /** Position jitter (m). */
  jitter?: number;
  shadows?: boolean;
  /**
   * Raise the light this far above its anchor (m). The fire's shadow caster sits above the seated
   * fans' heads, so their shadows end a few metres from the ring instead of striping the floor.
   */
  lift?: number;
  /** Unshadowed twin at the anchor itself (same colour and flicker): the fire's wide glow. */
  wide?: { intensity: number; range: number };
}
/** Per light-emitting asset (overrides the manifest's colour hint, which reads too red on the ochre rock). */
const LIGHT_LOOK: Record<string, LightLook> = {
  tl_fx_campfire_v01: {
    color: "#FFC284",
    intensity: 2.5,
    range: 6.5,
    flicker: 0.1,
    hz: 1.9,
    jitter: 0.05,
    shadows: true,
    lift: 1.4,
    wide: { intensity: 1, range: 12 },
  },
  tl_fx_torch_pole_v01: {
    color: "#FFC890",
    intensity: 1.5,
    range: 7,
    flicker: 0.09,
    hz: 2.6,
    jitter: 0.02,
  },
  tl_fx_torch_tripod_v01: {
    color: "#FFD0A0",
    intensity: 1.35,
    range: 7.5,
    flicker: 0.09,
    hz: 2.3,
    jitter: 0.02,
  },
  tl_fx_lantern_v01: {
    color: "#FFC27A",
    intensity: 2,
    range: 5.5,
    flicker: 0.06,
    hz: 1.4,
  },
  tl_prop_tv_crt_v01: {
    color: "#B4C4CE",
    intensity: 1.1,
    range: 3.5,
    flicker: 0.07,
    hz: 4.5,
  },
  /** The big wall screen: a cool wash over the rocks and the floor in front of it. */
  tl_furn_wall_screen_v01: {
    color: "#A9C2E8",
    intensity: 1.3,
    range: 13,
    flicker: 0.03,
    hz: 3.1,
  },
  tl_furn_wall_screen_small_v01: {
    color: "#A9C2E8",
    intensity: 0.9,
    range: 5,
    flicker: 0.03,
    hz: 3.4,
  },
  tl_env_shrine_candles_v01: {
    color: "#FFB65C",
    intensity: 0.9,
    range: 3.2,
    flicker: 0.12,
    hz: 2.2,
  },
};
/** Glow materials that are not flames (coals, embers, lantern glass, CRT) flicker at this rate. */
const GLOW_HZ = 8;
/** ... and only when the value moved by more than this fraction. */
const GLOW_STEP = 0.015;
/** Auto quality: drop to "low" after two windows whose average frame is slower than this. */
const SLOW_FRAME = 1 / 40;
const SLOW_WINDOW = 4;

/* ------------------------------------------------------------------ helpers */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Smooth deterministic flicker in about [-1, 1]: three incommensurate sines. */
const wobble = (t: number, hz: number, seed: number) =>
  0.55 * Math.sin(TAU * hz * t + seed) +
  0.3 * Math.sin(TAU * hz * 1.73 * t + seed * 2.1) +
  0.15 * Math.sin(TAU * hz * 2.91 * t + seed * 3.7);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const range2 = (v: unknown, d: [number, number]): [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")
    ? [v[0], v[1]]
    : d;
const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function report(msg: string) {
  console.error(`[world] ${msg}`);
  (window.__errors ??= []).push(msg);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what}: timed out after ${ms} ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Model space -> world for a placement (yaw about Y, uniform scale). */
function placeToWorld(
  p: Placement,
  at: readonly [number, number, number],
): pc.Vec3 {
  const s = p.scale ?? 1,
    c = Math.cos(p.yaw * DEG),
    n = Math.sin(p.yaw * DEG);
  const x = at[0] * s,
    z = at[2] * s;
  return new pc.Vec3(
    p.x + x * c + z * n,
    (p.y ?? 0) + at[1] * s,
    p.z - x * n + z * c,
  );
}

/**
 * All GLBs come from one generator with identical "tl_matte" / "tl_cloth" materials (white,
 * vertex colours, roughness 0.9); sharing one instance of each lets the batcher merge props.
 */
class SharedMaterials {
  private readonly byName = new Map<string, pc.Material>();
  apply(root: pc.Entity) {
    for (const r of root.findComponents("render") as pc.RenderComponent[])
      for (const mi of r.meshInstances) {
        const m = mi.material;
        if (!m || (m.name !== "tl_matte" && m.name !== "tl_cloth")) continue;
        const s = this.byName.get(m.name);
        if (s) mi.material = s;
        else this.byName.set(m.name, m);
      }
  }
  matte(): pc.StandardMaterial | null {
    const m = this.byName.get("tl_matte");
    return m instanceof pc.StandardMaterial ? m : null;
  }
}

function isUnder(
  node: pc.GraphNode | null,
  stop: pc.GraphNode,
  names: Set<string>,
): boolean {
  for (let n = node; n && n !== stop; n = n.parent)
    if (names.has(n.name)) return true;
  return false;
}

const coarsePointer = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/* ------------------------------------------------------------------ world */

export function createWorld(app: pc.AppBase, opts: WorldOptions = {}): World {
  const withNpcs = opts.npcs ?? true;
  const frozen = opts.time !== undefined;
  let time = opts.time ?? 0;

  // Camera.
  const camera = new pc.Entity("camera");
  camera.addComponent("camera", {
    clearColor: new pc.Color().fromString(LOOK.clear),
    fov: 52,
    nearClip: 0.1,
    farClip: 130,
  });
  const cam = camera.camera!;
  cam.toneMapping = pc.TONEMAP_ACES;
  cam.gammaCorrection = pc.GAMMA_SRGB;
  const fog = new pc.FogParams();
  fog.type = pc.FOG_LINEAR;
  fog.color = new pc.Color().fromString(LOOK.fog.color);
  fog.start = LOOK.fog.start;
  fog.end = LOOK.fog.end;
  cam.fog = fog;
  app.root.addChild(camera);

  // Quality: post-processing and shadow filtering.
  let frame: pc.CameraFrame | null = null;
  const applyQuality = (q: Quality) => {
    const post = opts.post ?? q === "high";
    if (post) {
      if (!frame) {
        // Renders into an HDR target, so the glow parts (emissive 1.3–1.7) bloom like the
        // concept's torches; ACES is then applied by the frame's compose pass.
        frame = new pc.CameraFrame(app, cam);
        frame.rendering.toneMapping = pc.TONEMAP_ACES;
        frame.rendering.samples = 4;
        frame.bloom.intensity = LOOK.post.bloom;
        frame.bloom.threshold = LOOK.post.bloomThreshold;
        frame.bloom.blurLevel = 7;
        frame.vignette.intensity = LOOK.post.vignette;
        frame.vignette.inner = 0.55;
        frame.vignette.outer = 1.35;
        frame.vignette.curvature = 0.6;
        frame.update();
      } else frame.enabled = true;
      // The HDR target is cleared with the colour as linear values: convert so it stays near-black.
      cam.clearColor = new pc.Color().fromString(LOOK.clear).linear();
    } else {
      if (frame) frame.enabled = false;
      cam.clearColor = new pc.Color().fromString(LOOK.clear);
    }
    app.scene.lighting.shadowAtlasResolution = q === "high" ? 2048 : 1024;
    app.scene.lighting.shadowType =
      q === "high" ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;
  };
  const auto = (opts.quality ?? "auto") === "auto";
  let quality: Quality =
    opts.quality === "high" || opts.quality === "low"
      ? opts.quality
      : coarsePointer()
        ? "low"
        : "high";
  let monitor = auto && quality === "high";
  applyQuality(quality);

  const views = hubViews();
  /** The ceiling and everything hanging from it (hidden together for views from above the dome). */
  const overhead: pc.Entity[] = [];
  let ceilingWanted = true;
  const setView = (name: string) => {
    const v = views[name];
    if (!v) return false;
    camera.setPosition(v.pos[0], v.pos[1], v.pos[2]);
    camera.lookAt(v.look[0], v.look[1], v.look[2]);
    if (v.fov) cam.fov = v.fov;
    // Views from above the dome hide the ceilings of all five caves and the tunnel roofs (their
    // single-sided faces would show as cracks), and may switch the haze off (the overview stands
    // ~80 m away, beyond the fog).
    ceilingWanted = v.ceiling ?? true;
    for (const e of overhead) e.enabled = ceilingWanted;
    fog.type = (v.fog ?? true) ? pc.FOG_LINEAR : pc.FOG_NONE;
    cam.fog = fog;
    return true;
  };
  setView("concept");

  // Scene-wide light.
  app.scene.ambientLight = new pc.Color(...LOOK.ambient);
  app.scene.exposure = LOOK.exposure;
  app.scene.lighting.shadowsEnabled = true;
  const root = new pc.Entity("hang-tru-thua");
  app.root.addChild(root);
  const shrine = buildShrine(app, root, { time: opts.time });
  const stallSigns = buildCaveStalls(app, root, withNpcs);
  const bigScreen = buildBigScreen(app, root, {
    demo: opts.screen,
    frozen: opts.time !== undefined,
  });
  const fill = new pc.Entity("cave-fill");
  fill.addComponent("light", {
    type: "directional",
    color: new pc.Color(...LOOK.fill.color),
    intensity: LOOK.fill.intensity,
    castShadows: false,
  });
  fill.setEulerAngles(...LOOK.fill.euler);
  root.addChild(fill);
  const omni = (
    name: string,
    at: readonly number[],
    color: string,
    intensity: number,
    range: number,
  ) => {
    const e = new pc.Entity(name);
    e.addComponent("light", {
      type: "omni",
      color: new pc.Color().fromString(color),
      intensity,
      range,
      castShadows: false,
    });
    e.setPosition(at[0], at[1], at[2]);
    root.addChild(e);
  };
  omni(
    "cave-bounce",
    LOOK.bounce.at,
    LOOK.bounce.color,
    LOOK.bounce.intensity,
    LOOK.bounce.range,
  );
  for (const w of LOOK.walls)
    omni("cave-wall-bounce", w.at, LOOK.wallColor, w.intensity, w.range);
  omni(
    "sign-light",
    LOOK.sign.at,
    LOOK.sign.color,
    LOOK.sign.intensity,
    LOOK.sign.range,
  );
  for (const c of HUB_CAVES) {
    const { fill: f, focal } = LOOK.side;
    omni(`cave-fill-${c.id}`, [c.x, f.y, c.z], LOOK.wallColor, f.intensity, f.range);
    const at = frameToCave({ x: c.x, z: c.z, yaw: c.nicheYaw }, 0, focal.z);
    omni(`cave-focal-${c.id}`, [at.x, focal.y, at.z], focal.color, focal.intensity, focal.range);
  }

  const animators: ((t: number) => void)[] = [];
  // Auto quality: average frame time over SLOW_WINDOW s windows once the cave stands.
  let armed = false,
    acc = 0,
    frames = 0,
    slow = 0;
  app.on("update", (dt: number) => {
    if (!frozen) time += dt;
    for (const a of animators) a(time);
    if (!monitor || !armed || document.hidden || dt > 0.25) return;
    acc += dt;
    frames++;
    if (acc < SLOW_WINDOW) return;
    slow = acc / frames > SLOW_FRAME ? slow + 1 : 0;
    acc = frames = 0;
    if (slow < 2) return;
    monitor = false;
    quality = "low";
    applyQuality(quality);
    console.info("[world] frames stay slow: quality low (no post-processing)");
  });

  const ready = build(app, root, camera, withNpcs, animators)
    .then((built) => {
      overhead.push(...built.overhead);
      for (const e of overhead) e.enabled = ceilingWanted;
    })
    .then(() => shrine.ready)
    .then(() => stallSigns.ready)
    .then(() => bigScreen.ready)
    .catch((err: unknown) =>
      report(
        `world build failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      ),
    );
  void ready.then(() => setTimeout(() => (armed = true), 2000));
  return {
    camera,
    ready,
    views,
    setView,
    get quality() {
      return quality;
    },
    setQuality(q: Quality) {
      monitor = false;
      quality = q;
      applyQuality(q);
    },
  };
}

interface Built {
  /** The ceilings of the five caves, the tunnel roofs and any stalactites placed under them. */
  overhead: pc.Entity[];
}

async function build(
  app: pc.AppBase,
  root: pc.Entity,
  camera: pc.Entity,
  withNpcs: boolean,
  animators: ((t: number) => void)[],
): Promise<Built> {
  const placements = HUB_PLACEMENTS.filter((p) => withNpcs || !p.npc);
  // Request every GLB right away (loadModelContainer caches per URL); place each on arrival.
  const loads = new Map<string, Promise<pc.ContainerResource | null>>();
  const load = (id: string) => {
    let p = loads.get(id);
    if (!p) {
      p = withTimeout(loadModelContainer(app, modelUrl(id)), 30_000, id).catch(
        (err: unknown) => {
          report(`model ${id} failed: ${describe(err)}`);
          return null;
        },
      );
      loads.set(id, p);
    }
    return p;
  };
  for (const piece of CAVE_SHELL_PIECES) void load(piece.asset);
  for (const p of placements) {
    void load(p.asset);
    if (p.npc?.hold) void load(p.npc.hold.asset);
  }
  const manifestsP = loadManifests(GROUPS, report);

  const shared = new SharedMaterials();
  const shell = new pc.Entity("cave-shell");
  const props = new pc.Entity("props");
  const npcs = new pc.Entity("npcs");
  const lights = new pc.Entity("lights");
  root.addChild(shell);
  root.addChild(props);
  root.addChild(npcs);
  root.addChild(lights);
  const built: Built = { overhead: [] };

  // Cave shell (main cave in cave space; tunnels and side caves by the shared recipe):
  // single-sided, receives the fire's shadows but never casts. A piece's ceiling is either the
  // whole model or a child node; both are collected so views from above can hide them.
  const shellJobs = CAVE_SHELL_PIECES.map(async (piece, i) => {
    const res = await load(piece.asset);
    if (!res) return;
    const e = instantiateModel(res, false);
    e.name = `${piece.asset.slice(piece.asset.indexOf("/") + 1)}#${i}`;
    e.setLocalPosition(piece.x, 0, piece.z);
    e.setLocalEulerAngles(0, piece.yaw, 0);
    shared.apply(e);
    shell.addChild(e);
    if (piece.overhead === true) built.overhead.push(e);
    else if (piece.overhead) {
      const top = e.findByName(piece.overhead);
      if (top instanceof pc.Entity) built.overhead.push(top);
      else report(`${piece.asset}: ceiling node "${piece.overhead}" not found`);
    }
  });

  const manifests = await manifestsP;
  const staticRenders: pc.RenderComponent[] = [];
  const npcRenders: pc.RenderComponent[] = [];
  const glows = new GlowFlicker();
  const glints: GlintSource[] = [];
  let puddle: pc.Entity | null = null;
  const jobs = placements.map(async (p, index) => {
    const res = await load(p.asset);
    if (!res) return;
    const holdRes = p.npc?.hold ? await load(p.npc.hold.asset) : null;
    const name = p.asset.slice(p.asset.indexOf("/") + 1);
    const asset = manifests.get(p.asset);
    const e = instantiateModel(res, !NO_SHADOW.test(name));
    e.name = name;
    e.setLocalPosition(p.x, p.y ?? 0, p.z);
    e.setLocalEulerAngles(0, p.yaw, 0);
    if (p.scale) e.setLocalScale(p.scale, p.scale, p.scale);
    for (const n of p.hide ?? []) {
      const node = e.findByName(n);
      if (node instanceof pc.Entity) node.enabled = false;
      else report(`${p.asset}: node "${n}" to hide not found`);
    }
    (p.npc ? npcs : props).addChild(e);
    shared.apply(e);
    if (name.startsWith("tl_env_stalactite_")) built.overhead.push(e);
    const seed = index * 7.31 + 1.7;

    if (p.npc) {
      setUpNpc(e, p, asset, holdRes, shared, seed, animators);
      npcRenders.push(...(e.findComponents("render") as pc.RenderComponent[]));
      return;
    }
    if (name === "tl_env_puddle_v01") {
      makeWater(e, shared);
      puddle = e;
    }
    for (const r of e.findComponents("render") as pc.RenderComponent[])
      if (r.entity.enabled && !isUnder(r.entity, e, ANIMATED_NODES))
        staticRenders.push(r);
    animateFire(e, asset, seed, animators);
    glows.add(e, asset, seed);
    const at = addLights(lights, p, name, asset, seed, animators);
    if (at && name.startsWith("tl_fx_torch_")) glints.push({ at, seed });
    if (at && name === "tl_fx_campfire_v01")
      glints.push({ at: new pc.Vec3(at.x, 0.9, at.z), seed, size: 1.8 });
  });
  await Promise.all([...shellJobs, ...jobs]);
  animators.push((t) => glows.update(t));
  if (puddle) createWaterGlints(app, camera, puddle, glints, animators);

  // One static batch group for every non-moving prop (merged per material and ~10 m cell), one
  // dynamic group for the NPC fans (their joints stay live nodes). Set once everything stands.
  const batcher = app.batcher;
  if (batcher) {
    const still =
      batcher.getGroupByName(STATIC_BATCH_GROUP) ??
      batcher.addGroup(STATIC_BATCH_GROUP, false, 10);
    for (const r of staticRenders) r.batchGroupId = still.id;
    const fans =
      batcher.getGroupByName(NPC_BATCH_GROUP) ??
      batcher.addGroup(NPC_BATCH_GROUP, true, 100);
    for (const r of npcRenders) r.batchGroupId = fans.id;
  }
  return built;
}

/* ------------------------------------------------------------------ parts */

function setUpNpc(
  e: pc.Entity,
  p: Placement,
  asset: ManifestAsset | undefined,
  holdRes: pc.ContainerResource | null,
  shared: SharedMaterials,
  seed: number,
  animators: ((t: number) => void)[],
) {
  const npc = p.npc!;
  const base = asset?.poses?.[npc.pose];
  if (!base) report(`${p.asset}: pose "${npc.pose}" not in the manifest`);
  const pose: Record<string, PoseJoint> = {
    ...(base ?? {}),
    ...(npc.tweak ?? {}),
  };
  const missing = applyPose(e, pose);
  if (missing.length)
    report(`${p.asset}: pose joints not found: ${missing.join(", ")}`);
  const breather = new Breather(e, pose, seed);
  animators.push((t) => breather.update(t));
  const hold = npc.hold;
  if (!hold || !holdRes) return;
  const joint = e.findByName(hold.node);
  if (!joint) return report(`${p.asset}: hold joint "${hold.node}" not found`);
  const propName = hold.asset.slice(hold.asset.indexOf("/") + 1);
  const prop = instantiateModel(holdRes, !NO_SHADOW.test(propName));
  prop.name = propName;
  shared.apply(prop);
  const noAim = attachHeld(e, joint, prop, hold);
  if (noAim) report(`${p.asset}: aim joint "${noAim}" not found`);
}

/**
 * Dark glossy water on the puddle's 'water' node: the multiplied-down vertex colour keeps the
 * puddle's tint variation; torch highlights (gloss) and the glints (world/water.ts) sell it.
 */
function makeWater(e: pc.Entity, shared: SharedMaterials) {
  const node = e.findByName("water") as pc.Entity | null;
  const matte = shared.matte();
  if (!node?.render || !matte)
    return report("puddle: 'water' node or matte material missing");
  const water = matte.clone();
  water.name = "tl_water";
  // Cool blue-grey (board 01's water), darker than the floor; gloss catches the torches.
  water.diffuse = new pc.Color(0.42, 0.52, 0.6);
  water.useMetalness = true;
  water.metalness = 0;
  water.gloss = 0.92;
  water.emissive = new pc.Color().fromString("#13202A");
  water.diffuseVertexColor = true; // the clone keeps vertexColorGamma = false (linear COLOR_0)
  water.update();
  for (const mi of node.render.meshInstances) {
    mi.material = water;
    mi.castShadow = false;
  }
}

interface FlickerMeta {
  nodes?: string[];
  scaleY?: [number, number];
  scaleXZ?: [number, number];
  hz?: [number, number];
  emissiveIntensity?: [number, number];
}

/**
 * Flame scale flicker (out of phase per node and instance) and rising sparks, per the fire
 * manifest. This is what makes each flame live on its own: flame materials keep a steady glow.
 */
function animateFire(
  e: pc.Entity,
  asset: ManifestAsset | undefined,
  seed: number,
  animators: ((t: number) => void)[],
) {
  const meta = (asset?.meta ?? {}) as {
    flicker?: FlickerMeta | string;
    sparks?: { node?: string; riseSpeed?: number; loopHeight?: number };
  };
  const f = typeof meta.flicker === "object" ? meta.flicker : undefined;
  if (f?.nodes && (f.scaleY || f.scaleXZ)) {
    const sy = range2(f.scaleY, [1, 1]),
      sxz = range2(f.scaleXZ, [1, 1]),
      hz = range2(f.hz, [6, 9]);
    f.nodes.forEach((name, i) => {
      const node = e.findByName(name);
      if (!node) return;
      const base = node.getLocalScale().clone();
      const s = seed + i * 2.399;
      const fhz = lerp(hz[0], hz[1], (i * 0.37 + seed * 0.13) % 1);
      animators.push((t) => {
        const y = lerp(sy[0], sy[1], 0.5 + 0.5 * wobble(t, fhz * 0.5, s));
        const xz = lerp(
          sxz[0],
          sxz[1],
          0.5 + 0.5 * wobble(t, fhz * 0.37, s + 1.3),
        );
        node.setLocalScale(base.x * xz, base.y * y, base.z * xz);
      });
    });
  }
  const sparks = meta.sparks?.node ? e.findByName(meta.sparks.node) : null;
  if (sparks) {
    const base = sparks.getLocalPosition().clone();
    const rise = meta.sparks?.riseSpeed ?? 0.35,
      loop = meta.sparks?.loopHeight ?? 0.8;
    animators.push((t) => {
      const k = ((t * rise) / loop + seed * 0.1) % 1;
      sparks.setLocalPosition(base.x, base.y + k * loop, base.z);
      sparks.setLocalEulerAngles(0, (t * 23 + seed * 40) % 360, 0);
      const s = 1 - k * k;
      sparks.setLocalScale(s, s, s);
    });
  }
}

/**
 * emissiveIntensity flicker of the shared, batched glow materials (coals, embers, lantern glass,
 * CRT): global per asset type, updated GLOW_HZ times a second and only when the value moved by
 * more than GLOW_STEP (every material.update() re-uploads the material and allocates). Flame materials
 * are left steady: the per-instance flame scale flicker keeps the torches out of step.
 */
class GlowFlicker {
  private readonly seen = new Set<pc.StandardMaterial>();
  private readonly items: {
    m: pc.StandardMaterial;
    r: [number, number];
    hz: number;
    seed: number;
    last: number;
  }[] = [];
  private next = 0;

  add(e: pc.Entity, asset: ManifestAsset | undefined, seed: number) {
    const flames = new Set<pc.Material>();
    for (const r of e.findComponents("render") as pc.RenderComponent[])
      if (isUnder(r.entity, e, ANIMATED_NODES))
        for (const mi of r.meshInstances)
          if (mi.material) flames.add(mi.material);
    for (const m of glowMaterials(e)) {
      if (this.seen.has(m)) continue;
      this.seen.add(m);
      m.useFog = false; // flames shine through the haze
      m.update();
      if (flames.has(m)) continue;
      const base = m.emissiveIntensity;
      const meta = (asset?.meta ?? {}) as {
        flicker?: FlickerMeta | string;
        embers?: FlickerMeta;
      };
      const f = typeof meta.flicker === "object" ? meta.flicker : undefined;
      // Strong glows (1.5: lantern flame) follow meta.flicker; weaker ones (1.3: embers) follow
      // meta.embers or ±12 %; the CRT screen (1.0) shimmers 0.85..1.1.
      const r =
        base >= 1.45
          ? range2(f?.emissiveIntensity, [base * 0.88, base * 1.12])
          : base > 1.05
            ? range2(meta.embers?.emissiveIntensity ?? f?.emissiveIntensity, [
                base * 0.88,
                base * 1.12,
              ])
            : ([0.85 * base, 1.1 * base] as [number, number]);
      const hz = base > 1.05 && base < 1.45 ? 1.6 : base <= 1.05 ? 6 : 4;
      this.items.push({ m, r, hz, seed, last: base });
    }
  }

  update(t: number) {
    if (t >= this.next || t < this.next - 1) {
      this.next = t + 1 / GLOW_HZ;
      for (const g of this.items) {
        const v = lerp(
          g.r[0],
          g.r[1],
          0.5 + 0.5 * wobble(t, g.hz, g.seed + 0.7),
        );
        if (Math.abs(v - g.last) < GLOW_STEP * g.last) continue;
        g.last = v;
        g.m.emissiveIntensity = v;
        g.m.update();
      }
    }
  }
}

/**
 * Omni lights at the manifest light anchors, with independent flicker per instance. Returns the
 * world position of the (first) light anchor, or null when the asset has no light.
 */
function addLights(
  parent: pc.Entity,
  p: Placement,
  name: string,
  asset: ManifestAsset | undefined,
  seed: number,
  animators: ((t: number) => void)[],
): pc.Vec3 | null {
  const look = LIGHT_LOOK[name];
  const k = p.light ?? 1;
  if (!look || !(k > 0)) return null;
  let first: pc.Vec3 | null = null;
  for (const l of asset?.lights ?? []) {
    const anchor = placeToWorld(p, l.at);
    first ??= anchor;
    const make = (
      suffix: string,
      at: pc.Vec3,
      intensity: number,
      range: number,
      shadows: boolean,
      jitter: number,
    ) => {
      const e = new pc.Entity(`light_${l.name ?? name}${suffix}`);
      e.addComponent("light", {
        type: "omni",
        color: new pc.Color().fromString(look.color),
        intensity,
        range: range * (p.scale ?? 1),
        castShadows: shadows,
        shadowBias: 0.25,
        normalOffsetBias: 0.06,
      });
      e.setPosition(at);
      parent.addChild(e);
      const light = e.light!;
      animators.push((t) => {
        light.intensity =
          intensity * (1 + look.flicker * wobble(t, look.hz, seed + 3.1));
        if (jitter)
          e.setPosition(
            at.x + jitter * wobble(t, 1.3, seed + 5),
            at.y + jitter * 0.6 * wobble(t, 1.1, seed + 6),
            at.z + jitter * wobble(t, 1.5, seed + 7),
          );
      });
    };
    const lifted = anchor.clone();
    lifted.y += look.lift ?? 0;
    make(
      "",
      lifted,
      look.intensity * k,
      look.range,
      !!look.shadows,
      look.jitter ?? 0,
    );
    if (look.wide)
      make("_wide", anchor, look.wide.intensity * k, look.wide.range, false, 0);
  }
  return first;
}
