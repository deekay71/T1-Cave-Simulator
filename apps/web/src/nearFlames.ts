/**
 * Torch flames near the camera. Torch flames are about 1 m tall and burn at the follow camera's
 * height (~2.6 m), so orbiting past a free-standing torch can fill the frame with flame. Each
 * torch's own 'flames' node (per instance, not batched) sinks into its cup as the camera comes
 * close: scale k = smoothstep(NEAR, FAR, camera distance to the flame centre). Lights stay as they
 * are. The camera blockers (blockers.ts) keep the camera itself out of the torch.
 *
 * Call update() every frame AFTER the world's own update handler (which sets the flame flicker
 * scale earlier in the same frame: createWorld() registers it first) and after the camera moved.
 */
import * as pc from "playcanvas";

/** Fully sunk at or below this camera distance (m) ... */
const NEAR = 1;
/** ... untouched from this distance (m). */
const FAR = 2.4;
/** Flame centre above the node's pivot (the cup / bowl rim), m. */
const CENTRE = 0.45;

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface NearFlames {
  /** Collect the torch flames under `root` (once the world is built). Returns how many. */
  scan(root: pc.Entity): number;
  update(camera: pc.Entity): void;
}

interface Flame {
  node: pc.GraphNode;
  at: pc.Vec3;
  /** Scale before our factor, and the scale we wrote (to tell whether the world re-set it). */
  base: pc.Vec3;
  last: pc.Vec3;
  mine: boolean;
}

export function createNearFlames(): NearFlames {
  const flames: Flame[] = [];
  return {
    scan(root) {
      flames.length = 0;
      const seen = new Set<pc.GraphNode>();
      for (const torch of root.find((n) => n.name.startsWith("tl_fx_torch_"))) {
        const node = torch.findByName("flames");
        if (!node || seen.has(node)) continue; // the GLB root may repeat the torch's name
        seen.add(node);
        const at = node.getPosition().clone();
        at.y += CENTRE;
        const base = node.getLocalScale().clone();
        flames.push({ node, at, base, last: base.clone(), mine: false });
      }
      return flames.length;
    },
    update(camera) {
      const c = camera.getPosition();
      for (const f of flames) {
        // the world's flicker sets the scale every frame; if it did not, never compound our factor
        const s = f.node.getLocalScale();
        if (!(f.mine && s.equals(f.last))) f.base.copy(s);
        const d = c.distance(f.at);
        const k = d >= FAR ? 1 : Math.max(0.001, smoothstep(NEAR, FAR, d));
        if (k === 1) {
          if (f.mine) f.node.setLocalScale(f.base);
          f.mine = false;
          continue;
        }
        f.node.setLocalScale(f.base.x * k, f.base.y * k, f.base.z * k);
        f.last.copy(f.node.getLocalScale());
        f.mine = true;
      }
    },
  };
}
