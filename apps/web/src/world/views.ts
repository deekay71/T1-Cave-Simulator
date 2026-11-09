/**
 * Camera presets for screenshots, the dev preview and cut-aways. Zone views are derived from the
 * zone frames of the shared layout, so they follow the zones when the layout is nudged.
 */
import { HUB_SPAWN, HUB_ZONES } from "@te-liet/shared";

type V3 = [number, number, number];
export interface CameraView {
  pos: V3;
  look: V3;
  fov?: number;
  /** false hides the cave ceiling (views from above the dome); default true. */
  ceiling?: boolean;
}

const DEG = Math.PI / 180;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Camera in front of a zone: `dist` metres along the zone's facing (+Z of its frame), shifted
 * `side` metres to the zone's +X, at height `h`, looking at the zone origin offset by `at`
 * (zone-local x, height, zone-local z).
 */
function zoneView(
  zone: { x: number; z: number; yaw: number },
  dist: number,
  h: number,
  side: number,
  at: V3,
  fov: number,
): CameraView {
  const c = Math.cos(zone.yaw * DEG),
    s = Math.sin(zone.yaw * DEG);
  const world = (lx: number, lz: number): [number, number] => [
    zone.x + lx * c + lz * s,
    zone.z - lx * s + lz * c,
  ];
  const [px, pz] = world(side, dist);
  const [tx, tz] = world(at[0], at[2]);
  return { pos: [r3(px), h, r3(pz)], look: [r3(tx), at[1], r3(tz)], fov };
}

export function hubViews(): Record<string, CameraView> {
  const z = HUB_ZONES;
  return {
    /**
     * Concept 01 main view (and the welcome screen): the fire group as the middle band with two
     * fans in the foreground, water + TV left, memory wall and exit at the back, tarp right.
     */
    concept: { pos: [-0.9, 2.0, 8.0], look: [0.4, 1.45, -8], fov: 60 },
    /** What a player sees right after spawning. */
    spawn: {
      pos: [HUB_SPAWN.x, 2.6, HUB_SPAWN.z + 5.5],
      look: [0, 1.2, 0],
      fov: 50,
    },
    /** Concept 01 "campfire (closer)": from the front-right, TV top-left, rank 01 left, red cap right. */
    campfire: { pos: [2.9, 1.9, 5.9], look: [-1.3, 0.85, -1.4], fov: 54 },
    /** Concept 02 main view: the wall of memories. */
    memory: zoneView(z.memory, 5.2, 1.7, 0.4, [0, 1.35, 0.4], 52),
    /** Concept 02 minigame corner. */
    tv: zoneView(z.tv, 4.3, 1.6, 0.5, [0, 0.9, 0.3], 50),
    /** Concept 01 rest corner: close on the bed, the lantern pool and the wheelchair. */
    rest: zoneView(z.rest, 3.9, 1.55, -0.6, [0.2, 0.8, -0.4], 55),
    /** Concept 02 living corner. */
    living: zoneView(z.living, 4.2, 1.6, 0.4, [0, 0.9, -0.3], 55),
    /** Concept 02 quiz corner. */
    quiz: zoneView(z.quiz, 5.6, 1.75, 0, [0, 0.95, 0.6], 50),
    /** The exit tunnel with its sign. */
    exit: { pos: [0.9, 2.0, -8.5], look: [0, 2.3, -18.6], fov: 50 },
    /** Concept 01 "overview (zoning)": high oblique view over the whole hall, ceiling hidden. */
    overview: { pos: [0, 30, 21], look: [0, 0, -1.8], fov: 46, ceiling: false },
  };
}
