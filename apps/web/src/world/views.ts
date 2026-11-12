/**
 * Camera presets for screenshots, the dev preview and cut-aways. Zone views are derived from the
 * zone frames of the shared layout, so they follow the zones when the layout is nudged.
 */
import { HUB_CAVES, HUB_SCREEN, HUB_SPAWN, HUB_ZONES } from "@te-liet/shared";

type V3 = [number, number, number];
export interface CameraView {
  pos: V3;
  look: V3;
  fov?: number;
  /** false hides the cave ceilings and tunnel roofs (views from above the domes); default true. */
  ceiling?: boolean;
  /** false switches the distance haze off (views from far away); default true. */
  fog?: boolean;
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

/**
 * Presets:
 * - concept, spawn, campfire, overview (all five caves from above, ceilings hidden, no haze);
 * - main-cave zones: checkin, crateCorner, water, rest, living, tea, crates, rug, exit, and screen
 *   (the big wall screen seen from the fire side);
 * - the four stalls of the side caves, seen from where a visitor stands: quest (Hang Quest),
 *   memory (Hang ký ức), quiz (Hang đố vui), shop (Hang chợ);
 * - per side cave <id> = ne_back | nw_back | nw_front | ne_front: mouth_<id> (the tunnel mouth seen
 *   from the main cave), tunnel_<id> (inside the tunnel, looking into the side cave),
 *   tunnel_<id>_back (inside the tunnel, looking back at the main cave) and cave_<id> (the side
 *   cave seen from its mouth).
 */
export function hubViews(): Record<string, CameraView> {
  const z = HUB_ZONES;
  const views: Record<string, CameraView> = {
    /**
     * Concept 01 main view (and the welcome screen): the fire group as the middle band with two
     * fans in the foreground, water + the big screen left, the exit at the back, tarp right.
     */
    concept: { pos: [-0.9, 2.0, 8.0], look: [0.4, 1.45, -8], fov: 60 },
    /** What a player sees right after spawning. */
    spawn: {
      pos: [HUB_SPAWN.x, 2.6, HUB_SPAWN.z + 5.5],
      look: [0, 1.2, 0],
      fov: 50,
    },
    /** Concept 01 "campfire (closer)": from the front-right, rank 01 left, red cap right. */
    campfire: { pos: [2.9, 1.9, 5.9], look: [-1.3, 0.85, -1.4], fov: 54 },
    /** The check-in stall by the spawn. */
    checkin: zoneView(z.checkin, 4.6, 1.7, 0.6, [0, 1.3, 0], 52),
    /** The crate corner left of the fire (where the concept's DEFEAT TV stood). */
    crateCorner: zoneView(z.crateCorner, 4.3, 1.6, 0.5, [0, 0.9, 0.3], 50),
    /** The big wall screen (back-left wall), from 15 m in front of it at eye height. */
    screen: zoneView(HUB_SCREEN, 15, 2.0, 3.5, [0, 4.6, 0], 58),
    /** The water on the left, seen from the fire side. */
    water: zoneView(z.water, 8.5, 2.2, -1.5, [0, 0.4, 0], 55),
    /** Concept 01 rest corner: close on the bed, the lantern pool and the wheelchair. */
    rest: zoneView(z.rest, 3.9, 1.55, -0.6, [0.2, 0.8, -0.4], 55),
    /** Concept 02 living corner. */
    living: zoneView(z.living, 4.2, 1.6, 0.4, [0, 0.9, -0.3], 55),
    /** The three small seating groups of the main cave. */
    tea: zoneView(z.tea, 4.4, 1.7, 0.8, [0, 0.6, 0], 52),
    crates: zoneView(z.crates, 4.6, 1.7, -0.8, [0, 0.6, 0], 52),
    rug: zoneView(z.rug, 4.2, 1.7, 0.6, [0, 0.5, 0], 52),
    /** The exit tunnel with its sign and the shrine door. */
    exit: { pos: [0.9, 2.0, -12.6], look: [0, 2.3, -22.7], fov: 50 },
    /** Concept 02 main view: the wall of memories (Hang ký ức). */
    memory: zoneView(z.memory, 5.2, 1.7, 0.4, [0, 1.35, 0.4], 52),
    /** The quest board in the niche behind the crate shelf (Hang Quest). */
    quest: zoneView(z.quest, 5, 1.65, 0.5, [0, 1.2, 0.2], 52),
    /** Concept 02 quiz corner (Hang đố vui). */
    quiz: zoneView(z.quiz, 5.6, 1.75, 0, [0, 0.95, 0.6], 50),
    /** The apparel stall (Hang chợ). */
    shop: zoneView(z.shop, 4.8, 1.7, 0.5, [0, 1.3, 0], 52),
    /**
     * Concept 01 "overview (zoning)": all five caves and the four tunnels from high above, ceilings
     * and tunnel roofs hidden, haze off.
     */
    overview: { pos: [0, 76, 14], look: [0, 0, 0.6], fov: 46, ceiling: false, fog: false },
  };
  for (const c of HUB_CAVES) {
    const d = Math.hypot(c.x, c.z),
      ux = c.x / d,
      uz = c.z / d;
    /** Point on the tunnel axis t metres from the origin, `lat` metres to the side, at height y. */
    const at = (t: number, y: number, lat = 0): V3 => [
      r3(ux * t - uz * lat),
      y,
      r3(uz * t + ux * lat),
    ];
    views[`mouth_${c.id}`] = { pos: at(9, 1.9), look: at(23.4, 2.1), fov: 50 };
    views[`tunnel_${c.id}`] = { pos: at(22.3, 1.7, 0.4), look: at(31, 1.5), fov: 62 };
    views[`tunnel_${c.id}_back`] = { pos: at(29.4, 1.7, -0.4), look: at(20, 1.5), fov: 62 };
    views[`cave_${c.id}`] = { pos: at(d - 6.6, 1.9), look: at(d + 4, 1.4), fov: 68 };
  }
  return views;
}
