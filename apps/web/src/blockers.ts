/**
 * Camera blockers: the tall props of the shared placement table (torches, boards, rock clusters,
 * tarp posts, the campfire flames) and the NPC fans' bodies, as vertical cylinders the follow
 * camera must not sit inside (cameraMath Blocker, passed in CameraBounds.blockers).
 *
 * Footprints are the props' collision circles, which already include a body-width margin; props
 * without colliders (out of reach, hanging, standing on a crate) use their manifest footprint plus
 * a margin. Heights come from the manifest bounds. Low props stay under the camera. NPC fans get a
 * body cylinder from their pose (seated or standing; fans lying in bed stay under the camera), so
 * a low camera (pitch near 0) slides past a seated fan instead of through their head.
 */
import {
  HUB_PLACEMENTS,
  placementObstacles,
  type Placement,
} from "@te-liet/shared";
import type { Blocker } from "./cameraMath.js";
import type { ManifestIndex } from "./world/manifest.js";

const DEG = Math.PI / 180;
/** Props lower than this (m) stay under the camera: stools, crates, tables, the TV crate. */
const MIN_TOP = 1.5;
/** Clearance (m) above the top, and around footprints that have no collider. */
const MARGIN = 0.25;
/** Torches: the camera keeps at least this far (m) from the pole (nearFlames.ts sinks the flame). */
const TORCH_R = 0.9;
/** NPC fan body: radius (m) around the torso, centred this far (m) in front of the root (knees). */
const NPC_R = 0.5;
const NPC_FORWARD = 0.1;
/** Head top (m above the root) of a seated fan (a 0.6 m crate seat included) and a standing one. */
const NPC_SEATED_TOP = 1.6;
const NPC_STANDING_TOP = 1.8;

/** Body cylinder of an NPC fan, or null when it lies down (lower than the camera ever goes). */
function npcBlocker(p: Placement, pose: string): Blocker | null {
  if (pose.startsWith("lie")) return null;
  const seated = pose.startsWith("sit") || pose === "head_in_hands";
  const c = Math.cos(p.yaw * DEG),
    n = Math.sin(p.yaw * DEG);
  return {
    x: p.x + NPC_FORWARD * n,
    z: p.z + NPC_FORWARD * c,
    r: NPC_R,
    top: (p.y ?? 0) + (seated ? NPC_SEATED_TOP : NPC_STANDING_TOP) + MARGIN,
  };
}

export function cameraBlockers(index: ManifestIndex): Blocker[] {
  const out: Blocker[] = [];
  for (const p of HUB_PLACEMENTS) {
    if (p.npc) {
      const b = npcBlocker(p, p.npc.pose);
      if (b) out.push(b);
      continue;
    }
    const a = index.get(p.asset);
    if (!a) continue;
    const s = p.scale ?? 1;
    const height = (p.y ?? 0) + a.bounds.max[1] * s;
    if (height < MIN_TOP) continue;
    const top = height + MARGIN;
    const minR = p.asset.startsWith("fire/tl_fx_torch_") ? TORCH_R : 0;
    const circles = placementObstacles(p);
    if (circles.length) {
      for (const o of circles)
        out.push({ x: o.x, z: o.z, r: Math.max(o.r, minR), top });
      continue;
    }
    const [x0, , z0] = a.bounds.min,
      [x1, , z1] = a.bounds.max;
    const cx = ((x0 + x1) / 2) * s,
      cz = ((z0 + z1) / 2) * s;
    const c = Math.cos(p.yaw * DEG),
      n = Math.sin(p.yaw * DEG);
    out.push({
      x: p.x + cx * c + cz * n,
      z: p.z - cx * n + cz * c,
      r: Math.max((Math.max(x1 - x0, z1 - z0) / 2) * s + MARGIN, minR),
      top,
    });
  }
  return out;
}
