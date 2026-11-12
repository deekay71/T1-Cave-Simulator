/**
 * Điện thờ — a hidden grotto chapel in the same cave world, built by the fans from what the cave
 * had: the cave's own rock shell (scaled down and turned so its tunnel is the way back), a packed
 * earth floor with rough flagstones, 35 stone seats in three rings, a painted wooden idol on a boulder
 * (the 'silent' pose) with a glowing trophy turning above its head, a
 * timber gate, banner poles, a paper-strip rope round the walkable circle, torches and candles.
 *
 * Everything visible is a generated GLB (tools/models/groups/environment.ts, tl_env_shrine_*,
 * plus reused cave / fire assets) loaded through ../models.ts. Gameplay geometry (walk radius,
 * the centre obstacle, the 35 seats, entry / exit points, the cave-side portal) comes from
 * packages/shared/src/shrine.ts and is not changed here: this file only draws it.
 *
 * buildShrine() returns at once: the root, the 35 seat anchors (local +Z toward the idol) and
 * the fixed lights exist synchronously; the models arrive progressively and `ready` resolves when
 * they stand (a failed GLB is reported and skipped). Rendering budget: no shadow casters and no
 * shadow-casting lights; every still mesh shares one matte / one cloth material and joins the
 * static batch group "tl_shrine_static"; the grotto (meshes and lights) is switched off while the
 * camera is in the main cave, so the cave pays nothing for it.
 */
import * as pc from "playcanvas";
import { HUB_PLACEMENTS } from "@te-liet/shared";
import { worldSign } from "./stalls.js";
import type { Blocker } from "../cameraMath.js";
import { instantiateModel, loadModelContainer } from "../models.js";
import { loadManifests, modelUrl, type ManifestAsset, type ManifestIndex } from "./manifest.js";
import {
  SHRINE_CENTER,
  SHRINE_PORTAL,
  SHRINE_SEAT_HEIGHT,
  SHRINE_SEATS,
} from "../../../../packages/shared/src/shrine.js";

type V3 = [number, number, number];

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const ENV = "environment/";
const FIRE = "fire/";
const BATCH_GROUP = "tl_shrine_static";

/* ------------------------------------------------------------------ layout (shrine-local metres) */

/**
 * The rock shell around the island: the wall modules + ceiling of the original cave shell
 * (environment/tl_env_cave_*; named here, not CAVE_SHELL, so the grotto keeps its size whatever
 * the main cave uses), scaled to a 14 m mean wall radius / ~10 m ceiling and turned half a turn so
 * its tunnel opens on +Z, behind the entry point ("the way you came in"). The scale is taken from
 * the manifest bounds when they are there, so a regenerated shell of another size still fits.
 */
const SHELL_IDS: readonly string[] = [
  ...[0, 1, 2, 3, 4, 5].map((k) => `${ENV}tl_env_cave_wall_0${k}_v01`),
  `${ENV}tl_env_cave_ceiling_v01`,
];
const SHELL = {
  yaw: 180,
  /** Wanted outer radius (m) and wall-top height (m) of the scaled shell. */
  radius: 15.05,
  top: 10.05,
  /** The generator's own numbers (fallback, and what `ceilingAt` assumes): radius 20.9, top 13.95. */
  scale: 0.72,
  scaleY: 0.72,
};
/** Posts of the rope round the walkable circle (0.9 m beyond the r = 8 walking limit). */
const RIM_R = 8.9;
/**
 * The way back: a timber gate in front of the tunnel mouth on +Z, beyond the camera ring, so it
 * never stands between the camera and a player who has just arrived at SHRINE_ENTRY / SHRINE_EXIT.
 * The rope circle opens between two short posts where the flagstone approach crosses it.
 */
const GATE = { z: 12.25, beforeMouth: 1.65 };
/**
 * Posts of the low rope cordon, by angle from +Z (clockwise from above), mirrored. The first pair
 * leaves the opening of the circle on the approach; the rope closes behind the idol.
 */
const RIM_POSTS: readonly number[] = [15, 40, 70, 100, 130, 160];
/**
 * Torches and banner poles stand at the foot of the rock, beyond the camera ring: nothing tall
 * ever comes between the follow camera and a player (the cordon itself stays under the view).
 */
const TALL_R = 10.9;
const TORCHES: readonly number[] = [40, 102, 143];
const BANNERS: readonly { deg: number; scale?: number }[] = [{ deg: 70 }, { deg: 130 }, { deg: 164, scale: 1.22 }];
/** Span of tl_env_shrine_rope_v01 (the chord between two posts 30 degrees apart on the rim). */
const ROPE_SPAN = 2 * RIM_R * Math.sin(15 * DEG);

/** Point at `deg` from +Z (clockwise seen from above) on radius r. */
const polar = (deg: number, r: number): [number, number] => [Math.sin(deg * DEG) * r, Math.cos(deg * DEG) * r];
/** Yaw (deg) that turns a model's +Z toward the idol from (x, z). */
const faceCentre = (x: number, z: number) => Math.atan2(-x, -z) / DEG;

interface Prop {
  id: string;
  x: number;
  z: number;
  y?: number;
  yaw?: number;
  scale?: number;
}
const at = (id: string, deg: number, r: number, yaw: number, scale = 1, y = 0): Prop => {
  const [x, z] = polar(deg, r);
  return { id, x, z, y, yaw, scale };
};
const R = {
  a: `${ENV}tl_env_rock_cluster_a_v01`,
  b: `${ENV}tl_env_rock_cluster_b_v01`,
  c: `${ENV}tl_env_rock_cluster_c_v01`,
  spikeA: `${ENV}tl_env_stalagmite_a_v01`,
  spikeB: `${ENV}tl_env_stalagmite_b_v01`,
  hangA: `${ENV}tl_env_stalactite_a_v01`,
  hangB: `${ENV}tl_env_stalactite_b_v01`,
  candles: `${ENV}tl_env_shrine_candles_v01`,
  banner: `${ENV}tl_env_shrine_banner_v01`,
  rope: `${ENV}tl_env_shrine_rope_v01`,
  post: `${ENV}tl_env_shrine_post_v01`,
  gate: `${ENV}tl_env_shrine_gate_v01`,
  idol: `${ENV}tl_env_shrine_idol_v01`,
  trophy: `${ENV}tl_env_shrine_trophy_v01`,
  floor: `${ENV}tl_env_shrine_floor_v01`,
  seatA: `${ENV}tl_env_shrine_seat_a_v01`,
  seatB: `${ENV}tl_env_shrine_seat_b_v01`,
  door: `${ENV}tl_env_shrine_door_v01`,
  torch: `${FIRE}tl_fx_torch_pole_v01`,
  lantern: `${FIRE}tl_fx_lantern_v01`,
};

/**
 * The rock rim between the rope and the wall. Big rocks keep their inner edge beyond r ~ 10.3
 * (the camera ring, see SHRINE_CAMERA_BLOCKERS); the +Z approach (|deg| < 20) stays open.
 */
const ROCKS: readonly Prop[] = [
  // the apse behind the idol: a tall block flanked by slabs (candle shelves)
  at(R.a, 180, 12.8, 8, 1.3),
  at(R.c, 159, 12.2, 159, 1.15),
  at(R.c, -160, 12.2, 20, 1.1),
  // left and right of the hall
  at(R.b, 24, 12.9, 60, 1.25),
  at(R.b, -25, 13.0, -70, 1.2),
  at(R.c, 55, 11.9, 55, 1.0),
  at(R.c, -56, 12.0, 124, 1.05),
  at(R.a, 86, 12.9, 100, 1.05),
  at(R.a, -88, 13.0, -80, 1.1),
  at(R.b, 117, 12.7, 20, 1.35),
  at(R.b, -118, 12.7, 170, 1.3),
];
const SPIKES: readonly Prop[] = [
  at(R.spikeB, 136, 12.5, 30, 1.9),
  at(R.spikeB, -137, 12.6, 200, 2.1),
  at(R.spikeA, 109, 12.2, 0, 1.7),
  at(R.spikeA, -108, 12.1, 90, 1.5),
  at(R.spikeB, 76, 12.9, 120, 1.5),
  at(R.spikeB, -75, 13.0, -40, 1.7),
  at(R.spikeA, 33, 12.5, 40, 1.4),
  at(R.spikeA, -34, 12.6, 10, 1.6),
  at(R.spikeA, 171, 11.2, 70, 1.2),
  at(R.spikeA, -169, 11.3, 160, 1.35),
];
/** Loose stones between the cordon and the rock (and a few inside), never on a seat or the approach. */
const STONES: readonly Prop[] = [
  [28, 9.6, "a"], [47, 9.9, "d"], [63, 9.5, "b"], [81, 10.0, "a"], [93, 9.4, "c"], [112, 9.8, "d"],
  [124, 9.5, "b"], [139, 9.9, "a"], [151, 9.6, "c"], [176, 9.7, "d"], [-31, 9.7, "b"], [-45, 9.5, "a"],
  [-64, 9.9, "d"], [-79, 9.5, "c"], [-96, 9.9, "a"], [-110, 9.5, "b"], [-123, 9.9, "d"], [-141, 9.6, "a"],
  [-152, 9.9, "b"], [-178, 9.4, "c"], [22, 7.2, "c"], [-50, 6.2, "b"], [110, 7.6, "d"], [-150, 7.6, "c"],
  [90, 7.7, "b"], [-110, 7.6, "a"],
].map(([deg, r, v], i) => at(`${ENV}tl_env_stone_small_${v as string}_v01`, deg as number, r as number, (i * 67) % 360, 1 + ((i * 13) % 5) * 0.12));
/** Stalactites over the rim (never over the walkable circle or the camera ring). */
const HANGERS: readonly { id: string; deg: number; r: number; yaw: number; scale: number }[] = [
  { id: R.hangB, deg: 150, r: 11.2, yaw: 0, scale: 1.7 },
  { id: R.hangA, deg: -150, r: 11.4, yaw: 40, scale: 1.5 },
  { id: R.hangA, deg: -171, r: 11.8, yaw: 80, scale: 1.25 },
  { id: R.hangB, deg: 95, r: 11.7, yaw: 120, scale: 1.4 },
  { id: R.hangA, deg: -92, r: 11.6, yaw: 200, scale: 1.6 },
  { id: R.hangA, deg: 48, r: 11.9, yaw: 10, scale: 1.2 },
  { id: R.hangB, deg: -50, r: 12.0, yaw: 300, scale: 1.3 },
  { id: R.hangA, deg: 122, r: 11.3, yaw: 60, scale: 1.1 },
];
/** Candle slabs; `light` ones carry a small omni (the others glow near a torch or lantern). */
const CANDLES: readonly (Prop & { light?: number })[] = [
  { ...at(R.candles, 168, 9.45, 10), light: 0.9 },
  { ...at(R.candles, -167, 9.5, -30), light: 0.9 },
  // on the slab rocks (their flat tops: 1.07 m x the slab's scale)
  { ...at(R.candles, 159, 12.2, 40, 1.15, 1.2), light: 0 },
  { ...at(R.candles, -160, 12.2, -20, 1.1, 1.15), light: 0 },
  { ...at(R.candles, 55, 11.9, 200, 1.1, 1.04), light: 0.8 },
  { ...at(R.candles, -56, 12.0, 150, 1.1, 1.09), light: 0.8 },
  { ...at(R.candles, 74, 10.2, 180), light: 0 },
  { ...at(R.candles, -127, 10.25, 60), light: 0 },
  { ...at(R.candles, 126, 10.3, 100), light: 0 },
  { ...at(R.candles, -66, 10.2, 300), light: 0 },
  { x: 2.95, z: 9.0, yaw: 150, id: R.candles, light: 0 },
  { x: -3.0, z: 8.95, yaw: 215, id: R.candles, light: 0 },
  { x: 2.3, z: GATE.z + 0.25, yaw: 190, id: R.candles, light: 0 },
  { x: -2.35, z: GATE.z + 0.2, yaw: 170, id: R.candles, light: 0 },
];

interface LightLook {
  color: string;
  intensity: number;
  range: number;
  flicker: number;
  hz: number;
}
/** Same looks as scene.ts gives these assets in the cave (pale warm: the rock's ochre does the rest). */
const TORCH_LOOK: LightLook = { color: "#FFC890", intensity: 1.4, range: 7.5, flicker: 0.09, hz: 2.6 };
const LANTERN_LOOK: LightLook = { color: "#FFC27A", intensity: 1.5, range: 5, flicker: 0.06, hz: 1.4 };
const CANDLE_LOOK: LightLook = { color: "#FFB868", intensity: 1, range: 3.4, flicker: 0.12, hz: 3.1 };
/** Fixed, unshadowed lights of the grotto (shrine-local). The idol is the focal point. */
const LOOK = {
  /** Warm key from above the approach: the idol's face and jersey, the inner seats. */
  key: { at: [0, 5.6, 3.6] as V3, color: "#FFE2BC", intensity: 1.9, range: 13.5 },
  /** Dim cool rim from behind / above: separates the idol and the banners from the apse. */
  rim: { at: [0, 5.4, -4.4] as V3, color: "#AEBBDD", intensity: 0.8, range: 11 },
  /** Soft warm fill over the approach: an arriving player's back and the backs of the near seats. */
  approach: { at: [0, 3.6, 9.4] as V3, color: "#FFD2A4", intensity: 0.6, range: 8.5 },
  /** The idol's own candles (flicker). */
  offerings: { at: [0, 0.85, 1.1] as V3, color: "#FFB868", intensity: 1.35, range: 4.6 },
  /** Warm bounce high on the walls, so the big rock planes read beyond the torches. */
  walls: [
    { at: [0, 6.2, -10.2] as V3, intensity: 0.5, range: 11 },
    { at: [9.6, 6, 2.5] as V3, intensity: 0.4, range: 12 },
    { at: [-9.6, 6, 2.5] as V3, intensity: 0.4, range: 12 },
  ],
  wallColor: "#FFD9BE",
};

/**
 * The trophy above the idol's head: it hovers at the idol's 'trophy' anchor (fallback `y`), turns
 * `spin` deg/s about Y, bobs +-`bob` m at `bobHz`, and carries a cool omni that breathes +-`pulse`.
 */
const TROPHY = { y: 3.75, spin: 36, bob: 0.07, bobHz: 0.32, color: "#CFE2FF", intensity: 1.5, range: 7.5, pulse: 0.2 };

/** A torch beside the approach lights arriving players (and the gate) from behind. */
const FORECOURT_TORCH = { x: 3.35, z: 11.75 };

/** The grotto is drawn and lit only while the camera is within this distance (m) of SHRINE_CENTER. */
const ZONE_RADIUS = 22;

/* ------------------------------------------------------------------ camera */

/** Camera ring: the camera stays inside this radius (wider on the +Z approach toward the tunnel). */
const cameraLimit = (deg: number) => {
  const d = Math.abs(((deg + 540) % 360) - 180);
  const k = d <= 14 ? 1 : d >= 30 ? 0 : 1 - (d - 14) / 16;
  return 10.3 + 1.2 * k * k * (3 - 2 * k);
};

/**
 * Solid things the follow camera must not sit in: the idol and — as a ring of tall cylinders —
 * the rock rim and walls, so the camera never leaves the grotto (the shared bounds allow 14 m; the
 * rock starts at ~10.5 m). The rim rocks, torches and banner poles all stand beyond the ring.
 */
export const SHRINE_CAMERA_BLOCKERS: readonly (Blocker & { bottom?: number })[] = (() => {
  const cx = SHRINE_CENTER.x,
    cz = SHRINE_CENTER.z;
  // the idol with the trophy floating above it (top of the cup ~4.8 m)
  const out: (Blocker & { bottom?: number })[] = [{ x: cx, z: cz, r: 1.15, top: 4.9 }];
  const RING = 2.3;
  const n = 40;
  for (let i = 0; i < n; i++) {
    const deg = (i / n) * 360;
    const [x, z] = polar(deg, cameraLimit(deg) + RING);
    out.push({ x: cx + x, z: cz + z, r: RING, top: 99 });
  }

  return out;
})();

/* ------------------------------------------------------------------ helpers */

export interface ShrineOptions {
  /** Freeze flicker at this time in seconds (deterministic screenshots). */
  time?: number;
}

export interface ShrineWorld {
  root: pc.Entity;
  /** Seat roots use shared ids; their local +Z points toward the idol. */
  seats: ReadonlyMap<string, pc.Entity>;
  /** Resolves when every model of the shrine stands (failures are reported, never block). */
  ready: Promise<void>;
}

/** Smooth deterministic flicker in about [-1, 1] (same recipe as scene.ts). */
const wobble = (t: number, hz: number, seed: number) =>
  0.55 * Math.sin(TAU * hz * t + seed) +
  0.3 * Math.sin(TAU * hz * 1.73 * t + seed * 2.1) +
  0.15 * Math.sin(TAU * hz * 2.91 * t + seed * 3.7);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function report(msg: string) {
  console.error(`[shrine] ${msg}`);
  (window.__errors ??= []).push(`shrine: ${msg}`);
}

/** One instance of the generator's "tl_matte" / "tl_cloth" for the whole shrine (lets it batch). */
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
}

const isUnder = (node: pc.GraphNode | null, stop: pc.GraphNode, name: string) => {
  for (let n = node; n && n !== stop; n = n.parent) if (n.name === name) return true;
  return false;
};

/** Ceiling height of the scaled shell at radius r (its base profile; the noise stays within ~0.4 m). */
const ceilingAt = (r: number) => SHELL.scaleY * (14 - 3 * Math.pow(Math.min(r / SHELL.scale / 20.5, 1.2), 2.5));

/* ------------------------------------------------------------------ build */

export function buildShrine(app: pc.AppBase, parent: pc.Entity, opts: ShrineOptions = {}): ShrineWorld {
  const root = new pc.Entity("shrine-sanctuary");
  root.setLocalPosition(SHRINE_CENTER.x, 0, SHRINE_CENTER.z);
  parent.addChild(root);
  const models = new pc.Entity("shrine-models");
  const lights = new pc.Entity("shrine-lights");
  root.addChild(models);
  root.addChild(lights);

  // Seat anchors exist at once (the models are hung under them when they arrive).
  const seats = new Map<string, pc.Entity>();
  for (const seat of SHRINE_SEATS) {
    const e = new pc.Entity(`shrine-seat-${seat.id}`);
    root.addChild(e);
    e.setLocalPosition(seat.x - SHRINE_CENTER.x, 0, seat.z - SHRINE_CENTER.z);
    e.setLocalEulerAngles(0, seat.yaw, 0);
    seats.set(seat.id, e);
  }

  // The cave-side door: in the old exit tunnel, behind the timber frame (which stays as its porch).
  const gate = new pc.Entity("shrine-cave-door");
  parent.addChild(gate);
  gate.setLocalPosition(DOOR.x, 0, DOOR.z);
  gate.setLocalEulerAngles(0, DOOR.yaw, 0);
  const sign = worldSign(app, gate, ["ĐIỆN THỜ FAKER", "Đến gần cửa · Nhấn E để vào"], DOOR.sign.width, DOOR.sign.height, "#DABB7F");
  sign.setLocalPosition(...DOOR.sign.at);

  /* ---- animation: one update handler, frozen for deterministic screenshots */
  const frozen = opts.time !== undefined;
  let time = opts.time ?? 0;
  const animators: ((t: number) => void)[] = [];
  let camera: pc.GraphNode | null = null;
  let inside = true;
  app.on("update", (dt: number) => {
    // The grotto is a closed room far from the cave: draw and light it only while the camera is
    // in or near it (the follow camera always stays in the local player's zone).
    camera ??= app.root.findByName("camera");
    const eye = camera?.getPosition();
    const now = !eye || Math.hypot(eye.x - SHRINE_CENTER.x, eye.z - SHRINE_CENTER.z) < ZONE_RADIUS;
    if (now !== inside) {
      inside = now;
      root.enabled = now;
    }
    if (!frozen) time += dt;
    if (inside) for (const a of animators) a(time);
    else for (const a of doorAnimators) a(time);
  });
  const doorAnimators: ((t: number) => void)[] = [];

  const omni = (
    into: pc.Entity,
    name: string,
    pos: readonly number[],
    color: string,
    intensity: number,
    range: number,
  ): pc.LightComponent => {
    const e = new pc.Entity(name);
    e.addComponent("light", {
      type: "omni",
      color: new pc.Color().fromString(color),
      intensity,
      range,
      castShadows: false,
    });
    into.addChild(e);
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    return e.light!;
  };
  const flicker = (light: pc.LightComponent, look: LightLook, k: number, seed: number, into = animators) => {
    const base = look.intensity * k;
    into.push((t) => {
      light.intensity = base * (1 + look.flicker * wobble(t, look.hz, seed + 3.1));
    });
  };
  omni(lights, "shrine-key", LOOK.key.at, LOOK.key.color, LOOK.key.intensity, LOOK.key.range);
  omni(lights, "shrine-rim", LOOK.rim.at, LOOK.rim.color, LOOK.rim.intensity, LOOK.rim.range);
  omni(lights, "shrine-approach", LOOK.approach.at, LOOK.approach.color, LOOK.approach.intensity, LOOK.approach.range);
  for (const w of LOOK.walls) omni(lights, "shrine-wall-bounce", w.at, LOOK.wallColor, w.intensity, w.range);
  flicker(
    omni(lights, "shrine-offerings", LOOK.offerings.at, LOOK.offerings.color, LOOK.offerings.intensity, LOOK.offerings.range),
    { ...CANDLE_LOOK, intensity: LOOK.offerings.intensity, flicker: 0.1 },
    1,
    11.3,
  );

  const ready = populate(app, { root, models, lights, gate, seats, animators, doorAnimators, omni, flicker }).catch(
    (err: unknown) => report(`build failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`),
  );
  return { root, seats, ready };
}

/**
 * The door stands at the cave's tunnel frame (the tl_env_tunnel_frame_v01 placement of the shared
 * table), which stays as its porch. Without that placement it falls back to 2.55 m behind
 * SHRINE_PORTAL along the portal's facing (where the frame stands in the original layout).
 */
const DOOR = (() => {
  const frame = HUB_PLACEMENTS.find((p) => p.asset.endsWith("/tl_env_tunnel_frame_v01"));
  const a = SHRINE_PORTAL.yaw * DEG;
  return {
    x: frame?.x ?? SHRINE_PORTAL.x - Math.sin(a) * 2.55,
    z: frame?.z ?? SHRINE_PORTAL.z - Math.cos(a) * 2.55,
    yaw: frame?.yaw ?? SHRINE_PORTAL.yaw,
    /** Face of the name board of tl_env_shrine_door_v01 (its anchor "sign"); the board is 2.5 x 0.8 m. */
    sign: { at: [0, 2.33, 0.262] as V3, width: 2.34, height: 0.73 },
    lanternScale: 1.5,
  };
})();

interface Ctx {
  root: pc.Entity;
  models: pc.Entity;
  lights: pc.Entity;
  gate: pc.Entity;
  seats: ReadonlyMap<string, pc.Entity>;
  animators: ((t: number) => void)[];
  doorAnimators: ((t: number) => void)[];
  omni: (into: pc.Entity, name: string, pos: readonly number[], color: string, intensity: number, range: number) => pc.LightComponent;
  flicker: (light: pc.LightComponent, look: LightLook, k: number, seed: number, into?: ((t: number) => void)[]) => void;
}

async function populate(app: pc.AppBase, c: Ctx): Promise<void> {
  const loads = new Map<string, Promise<pc.ContainerResource | null>>();
  const load = (id: string) => {
    let p = loads.get(id);
    if (!p) {
      p = loadModelContainer(app, modelUrl(id)).catch((err: unknown) => {
        report(`model ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      loads.set(id, p);
    }
    return p;
  };
  for (const id of [...SHELL_IDS, ...Object.values(R)]) void load(id);
  const manifests: ManifestIndex = await loadManifests(["environment", "fire"], report);

  const shared = new SharedMaterials();
  const still: pc.RenderComponent[] = [];
  /** Instantiate (never a shadow caster), share materials, collect the still meshes for batching. */
  const spawn = async (id: string, into: pc.Entity, name?: string): Promise<pc.Entity | null> => {
    const res = await load(id);
    if (!res) return null;
    const e = instantiateModel(res, false);
    e.name = name ?? id.slice(id.indexOf("/") + 1);
    into.addChild(e);
    shared.apply(e);
    for (const r of e.findComponents("render") as pc.RenderComponent[])
      if (!isUnder(r.entity, e, "flames")) still.push(r);
    return e;
  };
  const place = async (p: Prop, into: pc.Entity = c.models) => {
    const e = await spawn(p.id, into);
    if (!e) return null;
    e.setLocalPosition(p.x, p.y ?? 0, p.z);
    e.setLocalEulerAngles(0, p.yaw ?? 0, 0);
    if (p.scale && p.scale !== 1) e.setLocalScale(p.scale, p.scale, p.scale);
    return e;
  };
  const asset = (id: string): ManifestAsset | undefined => manifests.get(id);
  const jobs: Promise<unknown>[] = [];

  /* ---- shell + floor */
  const shell = new pc.Entity("shrine-shell");
  c.models.addChild(shell);
  shell.setLocalEulerAngles(0, SHELL.yaw, 0);
  // Fit the shell to the grotto from its manifest bounds: wall top, and outer radius (not from
  // the tunnel module, whose bounds include the tunnel's length).
  let outer = 0,
    top = 0;
  for (const id of SHELL_IDS) {
    const bb = id.includes("_wall_") ? asset(id)?.bounds : undefined;
    if (!bb) continue;
    top = Math.max(top, bb.max[1]);
    if (!id.includes("_wall_01_"))
      outer = Math.max(outer, Math.abs(bb.min[0]), Math.abs(bb.max[0]), Math.abs(bb.min[2]), Math.abs(bb.max[2]));
  }
  const k = outer > 1 ? SHELL.radius / outer : SHELL.scale;
  const ky = top > 1 ? SHELL.top / top : SHELL.scaleY;
  shell.setLocalScale(k, ky, k);
  for (const id of SHELL_IDS) jobs.push(spawn(id, shell));
  // The shell is turned half a turn: its tunnel (anchors of the tunnel wall module) opens on +Z.
  const tunnel = asset(SHELL_IDS[1])?.anchors;
  const gateZ = tunnel?.tunnel_mouth ? -tunnel.tunnel_mouth[2] * k - GATE.beforeMouth : GATE.z;
  const tunnelTorch: [number, number] = tunnel?.tunnel_torch ? [-tunnel.tunnel_torch[0] * k, -tunnel.tunnel_torch[2] * k] : [-0.45, 16.7];
  jobs.push(spawn(R.floor, c.models));

  /* ---- seats */
  SHRINE_SEATS.forEach((seat, i) => {
    const id = seat.ring === 1 ? R.seatA : R.seatB;
    jobs.push(
      (async () => {
        const e = await spawn(id, c.seats.get(seat.id)!, "stone-seat");
        if (!e) return;
        const sit = asset(id)?.anchors?.sit ?? [0, SHRINE_SEAT_HEIGHT, 0.16];
        // The block sits behind the player's floor anchor: the calves must clear its front face.
        const yaw = ((i * 47) % 13) - 6;
        const k = 0.95 + ((i * 29) % 7) * 0.012;
        const cy = Math.cos(yaw * DEG),
          sy = Math.sin(yaw * DEG);
        e.setLocalPosition(-(k * sit[0] * cy + sit[2] * sy), 0, -(-k * sit[0] * sy + sit[2] * cy));
        e.setLocalEulerAngles(0, yaw, 0);
        e.setLocalScale(k, 1, 1);
      })(),
    );
  });

  /* ---- idol, and the trophy floating above its head (never batched: it turns) */
  jobs.push(spawn(R.idol, c.models));
  jobs.push(
    (async () => {
      const res = await load(R.trophy);
      if (!res) return;
      const e = instantiateModel(res, false);
      e.name = "shrine-trophy";
      c.models.addChild(e);
      shared.apply(e);
      const y0 = asset(R.idol)?.anchors?.trophy?.[1] ?? TROPHY.y;
      const glow = asset(R.trophy)?.lights?.[0]?.at ?? [0, 0.62, 0];
      const light = c.omni(c.lights, "shrine-trophy", [0, y0 + glow[1], 0], TROPHY.color, TROPHY.intensity, TROPHY.range);
      const move = (t: number) => {
        const lift = Math.sin(t * TROPHY.bobHz * Math.PI * 2) * TROPHY.bob;
        e.setLocalPosition(0, y0 + lift, 0);
        e.setLocalEulerAngles(0, (t * TROPHY.spin) % 360, 0);
        light.entity.setLocalPosition(0, y0 + glow[1] + lift, 0);
        light.intensity = TROPHY.intensity * (1 + TROPHY.pulse * Math.sin(t * 1.9));
      };
      move(0);
      c.animators.push(move);
    })(),
  );

  /* ---- gate (the way back) with two lanterns */
  jobs.push(
    (async () => {
      const e = await place({ id: R.gate, x: 0, z: gateZ, yaw: 180 });
      if (!e) return;
      const a = asset(R.gate)?.anchors;
      for (const [i, key] of (["lantern_l", "lantern_r"] as const).entries()) {
        const h = a?.[key] ?? [i ? -2.02 : 2.02, 3.38, 0.02];
        // gate yaw 180: local (x, z) -> (-x, -z)
        await hangLantern(c.models, c.lights, [-h[0], h[1], gateZ - h[2]], 1.55, 0.9, 5.7 + i * 2.3, c.animators);
      }
    })(),
  );

  /* ---- the rope cordon on its short posts */
  const ends = asset(R.rope)?.anchors;
  const ropeSpan = ends?.end_l && ends.end_r ? ends.end_l[0] - ends.end_r[0] : ROPE_SPAN;
  const rope = (a: [number, number], b: [number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    jobs.push(
      place({ id: R.rope, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, yaw: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) / DEG }).then((e) => {
        e?.setLocalScale(d / ropeSpan, 1, 1);
      }),
    );
  };
  for (const side of [1, -1]) {
    const posts = RIM_POSTS.map((deg) => polar(side * deg, RIM_R));
    posts.forEach(([x, z], i) => {
      jobs.push(place({ id: R.post, x, z, yaw: faceCentre(x, z) + 180 + ((i * 53) % 40) - 20 }));
      if (i + 1 < posts.length) rope(posts[i], posts[i + 1]);
    });
  }
  const last = RIM_POSTS[RIM_POSTS.length - 1];
  rope(polar(last, RIM_R), polar(-last, RIM_R));

  /* ---- torches and banner poles at the foot of the rock */
  for (const side of [1, -1]) {
    TORCHES.forEach((deg, i) => {
      const [x, z] = polar(side * deg, TALL_R);
      jobs.push(standTorch({ id: R.torch, x, z, yaw: faceCentre(x, z) + ((i * 37) % 60) }, 1, (side > 0 ? 0 : 50) + i * 7.31 + 1.7));
    });
    for (const b of BANNERS) {
      // put the banner's pole (not its pivot) on the spot; the cloth faces the idol
      const [x, z] = polar(side * b.deg, TALL_R);
      const yaw = faceCentre(x, z) + (b.scale ? side * 6 : 0);
      const k = b.scale ?? 1;
      const pole = asset(R.banner)?.anchors?.pole ?? [-0.45, 0, 0];
      const cy = Math.cos(yaw * DEG),
        sy = Math.sin(yaw * DEG);
      jobs.push(place({ id: R.banner, x: x - (pole[0] * cy + pole[2] * sy) * k, z: z - (-pole[0] * sy + pole[2] * cy) * k, yaw, scale: k }));
    }
  }

  /* ---- rock rim */
  for (const p of [...ROCKS, ...SPIKES, ...STONES]) jobs.push(place(p));
  for (const h of HANGERS) {
    const [x, z] = polar(h.deg, h.r);
    const length = (asset(h.id)?.bounds.max[1] ?? 2.5) * h.scale;
    jobs.push(place({ id: h.id, x, z, y: ceilingAt(h.r) + 0.45 - length, yaw: h.yaw, scale: h.scale }));
  }
  CANDLES.forEach((p, i) => {
    jobs.push(
      place(p).then((e) => {
        if (!e || !p.light) return;
        const l = asset(p.id)?.lights?.[0]?.at ?? [0, 0.42, 0];
        const s = p.scale ?? 1;
        c.flicker(c.omni(c.lights, "shrine-candles", [p.x, (p.y ?? 0) + l[1] * s, p.z], CANDLE_LOOK.color, CANDLE_LOOK.intensity * p.light, CANDLE_LOOK.range), CANDLE_LOOK, p.light, 20 + i * 3.7);
      }),
    );
  });
  // the way back: a torch beside the tunnel mouth (lights the gate from behind) and a dim one inside
  jobs.push(standTorch({ id: R.torch, x: FORECOURT_TORCH.x, z: FORECOURT_TORCH.z, yaw: 200 }, 0.9, 77.1));
  jobs.push(standTorch({ id: R.torch, x: tunnelTorch[0], z: tunnelTorch[1], yaw: 180, scale: 0.62 }, 0.5, 91.7));

  /* ---- the cave-side door and its two lanterns */
  jobs.push(
    (async () => {
      const e = await spawn(R.door, c.gate);
      if (!e) return;
      const a = asset(R.door)?.anchors;
      for (const [i, key] of (["lantern_l", "lantern_r"] as const).entries()) {
        const h = a?.[key] ?? [i ? -2.03 : 2.03, 2.24, 0.16];
        await hangLantern(c.gate, c.gate, h as V3, DOOR.lanternScale, 0.85, 31 + i * 4.1, c.doorAnimators);
      }
    })(),
  );

  await Promise.all(jobs);

  // One static batch group: a handful of draws for the whole grotto (per material and ~24 m cell).
  const batcher = app.batcher;
  if (batcher) {
    const group = batcher.getGroupByName(BATCH_GROUP) ?? batcher.addGroup(BATCH_GROUP, false, 24);
    for (const r of still) r.batchGroupId = group.id;
  }

  /* ---- local helpers (hoisted) */

  /** A torch pole with its flame flicker and an omni at the manifest light anchor. */
  async function standTorch(p: Prop, k: number, seed: number) {
    const e = await place(p);
    if (!e) return;
    const a = asset(p.id);
    const s = p.scale ?? 1;
    const l = a?.lights?.[0]?.at ?? [0.025, 2.57, -0.02];
    const cy = Math.cos((p.yaw ?? 0) * DEG),
      sy = Math.sin((p.yaw ?? 0) * DEG);
    const light = c.omni(
      c.lights,
      "shrine-torch",
      [p.x + (l[0] * cy + l[2] * sy) * s, l[1] * s, p.z + (-l[0] * sy + l[2] * cy) * s],
      TORCH_LOOK.color,
      TORCH_LOOK.intensity * k,
      TORCH_LOOK.range * s,
    );
    c.flicker(light, TORCH_LOOK, k, seed);
    const flames = e.findByName("flames");
    if (!flames) return;
    const meta = (a?.meta ?? {}) as { flicker?: { scaleY?: [number, number]; scaleXZ?: [number, number]; hz?: [number, number] } };
    const f = typeof meta.flicker === "object" ? meta.flicker : undefined;
    const sy2 = f?.scaleY ?? [0.88, 1.12],
      sxz = f?.scaleXZ ?? [0.94, 1.06],
      hz = f?.hz ?? [6, 10];
    const base = flames.getLocalScale().clone();
    const fhz = lerp(hz[0], hz[1], (seed * 0.13) % 1);
    c.animators.push((t) => {
      const y = lerp(sy2[0], sy2[1], 0.5 + 0.5 * wobble(t, fhz * 0.5, seed));
      const xz = lerp(sxz[0], sxz[1], 0.5 + 0.5 * wobble(t, fhz * 0.37, seed + 1.3));
      flames.setLocalScale(base.x * xz, base.y * y, base.z * xz);
    });
  }

  /** A lantern hung with its 'hang' anchor at `hook` (parent-local), with its omni. */
  async function hangLantern(
    into: pc.Entity,
    lightsInto: pc.Entity,
    hook: readonly number[],
    scale: number,
    k: number,
    seed: number,
    anims: ((t: number) => void)[],
  ) {
    const a = asset(R.lantern);
    const hang = a?.anchors?.hang ?? [0, 0.3445, 0];
    const lightAt = a?.lights?.[0]?.at ?? [0, 0.101, 0];
    const y = hook[1] - hang[1] * scale;
    const e = await place({ id: R.lantern, x: hook[0], z: hook[2], y, yaw: seed * 40, scale }, into);
    if (!e) return;
    c.flicker(
      c.omni(lightsInto, "shrine-lantern", [hook[0], y + lightAt[1] * scale, hook[2]], LANTERN_LOOK.color, LANTERN_LOOK.intensity * k, LANTERN_LOOK.range),
      LANTERN_LOOK,
      k,
      seed,
      anims,
    );
  }
}
