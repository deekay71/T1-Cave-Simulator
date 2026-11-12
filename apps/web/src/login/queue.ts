/**
 * The login queue: fans from the normal avatar variants trudging in single file down the path and
 * into the cave mouth, one after another, without end. Each fan keeps its slot on a loop (evenly
 * spaced, with a slow personal sway and a small sideways offset), darkens to a silhouette against
 * the red glow past the threshold, dissolves, and comes back over the crest from the gully behind
 * the camera.
 *
 * Avatars are children of the set root and positioned in set space; their materials are per-fan
 * copies (opacity dither + a brightness factor), so nothing leaks into the in-game avatars.
 */
import * as pc from "playcanvas";
import { AVATAR_VARIANTS, createAvatar, type Avatar } from "../avatar.js";
import { GLOW_MATERIAL_PREFIX } from "../models.js";
import {
  QUEUE,
  buildPath,
  fanLight,
  fanOpacity,
  fanS,
  queueLoop,
  samplePath,
  type P3,
  type PathSample,
  type QueueLoop,
  type QueuePath,
} from "./queueMath.js";

/** Outfit order in the line (indices into AVATAR_VARIANTS): neighbours never look alike. */
const LINE_UP = [2, 0, 4, 1, 3, 5, 6, 2];

interface QueueFan {
  avatar: Avatar;
  materials: pc.StandardMaterial[];
  shadow: pc.Entity;
  lateral: number;
  swayPhase: number;
  swayHz: number;
  lastSway: number;
  light: number;
  opacity: number;
}

export interface LoginQueue {
  readonly count: number;
  /** Advance the line (dt seconds) and animate the fans. */
  update(dt: number): void;
  /** Put every fan in place in a mid-stride pose without advancing (reduced motion, first frame). */
  settle(): void;
  inspect(): { s: number; past: number; opacity: number }[];
  destroy(): void;
}

/** Soft low-poly contact shadow: an octagon whose alpha falls to zero at the rim. */
function shadowMesh(device: pc.GraphicsDevice): pc.Mesh {
  const N = 8;
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0, 0, 0, 150];
  const idx: number[] = [];
  for (const [r, a] of [
    [0.3, 110],
    [0.62, 0],
  ] as const)
    for (let k = 0; k < N; k++) {
      const t = ((k + 0.5) / N) * Math.PI * 2;
      pos.push(Math.cos(t) * r * 0.8, 0, Math.sin(t) * r);
      col.push(0, 0, 0, a);
    }
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    idx.push(0, 1 + k1, 1 + k);
    idx.push(1 + k, 1 + k1, 1 + N + k1, 1 + k, 1 + N + k1, 1 + N + k);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos);
  mesh.setNormals(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
  mesh.setColors32(col);
  mesh.setIndices(idx);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

export function createLoginQueue(
  app: pc.AppBase,
  root: pc.Entity,
  layerId: number,
  def: { path: readonly P3[]; crest: number; mouth: number },
): LoginQueue {
  const path: QueuePath = buildPath(def.path);
  const loop: QueueLoop = queueLoop(path, def.crest, def.mouth);
  const sample: PathSample = { x: 0, y: 0, z: 0, yaw: 0, slope: 0 };

  // deterministic per-fan variation (same line on every visit)
  let seed = 0x51ed270b;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Avatars first: while no outfit is loaded createAvatar throws, before anything else exists.
  const avatars: Avatar[] = [];
  try {
    for (let i = 0; i < QUEUE.fans; i++) {
      const variant = AVATAR_VARIANTS[LINE_UP[i % LINE_UP.length] % AVATAR_VARIANTS.length];
      avatars.push(createAvatar(app, { variant, seed: 0x1000 + i * 7919, trudge: 0.82 + 0.18 * rand() }));
    }
  } catch (err) {
    for (const a of avatars) a.destroy();
    throw err;
  }

  const shadowMat = new pc.StandardMaterial();
  shadowMat.name = "login-contact-shadow";
  shadowMat.useLighting = false;
  shadowMat.diffuse.set(0, 0, 0);
  shadowMat.emissive.set(0, 0, 0);
  shadowMat.opacityVertexColor = true;
  shadowMat.opacityVertexColorChannel = "a";
  shadowMat.blendType = pc.BLEND_NORMAL;
  shadowMat.depthWrite = false;
  shadowMat.update();
  const mesh = shadowMesh(app.graphicsDevice);

  const fans: QueueFan[] = [];
  for (let i = 0; i < QUEUE.fans; i++) {
    const avatar = avatars[i];
    avatar.entity.reparent(root);
    const own = new Map<pc.Material, pc.StandardMaterial>();
    for (const r of avatar.entity.findComponents("render") as pc.RenderComponent[]) {
      r.layers = [layerId];
      r.castShadows = false;
      for (const mi of r.meshInstances) {
        const m = mi.material;
        if (!(m instanceof pc.StandardMaterial) || m.name.startsWith(GLOW_MATERIAL_PREFIX)) continue;
        let copy = own.get(m);
        if (!copy) {
          copy = m.clone();
          copy.opacityDither = pc.DITHER_BAYER8;
          copy.update();
          own.set(m, copy);
        }
        mi.material = copy;
      }
    }
    const shadow = new pc.Entity("login-fan-shadow");
    shadow.addComponent("render", {
      meshInstances: [new pc.MeshInstance(mesh, shadowMat)],
      layers: [layerId],
      castShadows: false,
      receiveShadows: false,
    });
    root.addChild(shadow);
    fans.push({
      avatar,
      materials: [...own.values()],
      shadow,
      lateral: (rand() * 2 - 1) * QUEUE.lateral,
      swayPhase: rand() * Math.PI * 2,
      swayHz: 0.035 + 0.03 * rand(),
      lastSway: 0,
      light: 1,
      opacity: 1,
    });
  }

  let travelled = loop.spacing * 0.35;
  let time = 0;
  let dead = false;

  const swayOf = (f: QueueFan) => QUEUE.sway * Math.sin(time * f.swayHz * Math.PI * 2 + f.swayPhase);
  const place = (f: QueueFan, i: number, dt: number, speed: number) => {
    const sway = swayOf(f);
    const s = fanS(loop, i, travelled) + sway;
    samplePath(path, s, sample);
    const c = Math.cos(sample.yaw),
      sn = Math.sin(sample.yaw);
    // sideways = the walk direction turned 90 degrees
    const x = sample.x + c * f.lateral,
      z = sample.z - sn * f.lateral;
    const yawDeg = (sample.yaw * 180) / Math.PI;
    const e = f.avatar.entity;
    e.setLocalPosition(x, sample.y, z);
    e.setLocalEulerAngles(0, yawDeg, 0);
    f.avatar.update(dt, dt > 0 ? Math.max(0, speed + (sway - f.lastSway) / dt) : speed);
    f.lastSway = sway;

    const past = s - def.mouth;
    const light = Math.round(fanLight(past) * 24) / 24;
    const opacity = Math.round(fanOpacity(past) * 16) / 16;
    if (light !== f.light || opacity !== f.opacity) {
      f.light = light;
      f.opacity = opacity;
      for (const m of f.materials) {
        m.diffuse.set(light, light, light);
        m.opacity = opacity;
        m.update();
      }
      e.enabled = opacity > 0;
    }
    // contact shadow: on the ground, tilted with the path; none in the dark of the cave
    const lit = past < 1.2;
    if (f.shadow.enabled !== lit) f.shadow.enabled = lit;
    if (lit) {
      f.shadow.setLocalPosition(x, sample.y + 0.035, z);
      f.shadow.setLocalEulerAngles((-Math.atan(sample.slope) * 180) / Math.PI, yawDeg, 0);
    }
  };

  return {
    count: fans.length,
    update(dt: number) {
      if (dead) return;
      time += dt;
      travelled = (travelled + QUEUE.speed * dt) % loop.length;
      for (let i = 0; i < fans.length; i++) place(fans[i], i, dt, QUEUE.speed);
    },
    settle() {
      if (dead) return;
      // a few steps on the spot so everyone stands mid-stride, bowed
      for (let k = 0; k < 14; k++) for (let i = 0; i < fans.length; i++) place(fans[i], i, 0.05 + 0.011 * i, QUEUE.speed);
    },
    inspect() {
      return fans.map((f, i) => {
        const s = fanS(loop, i, travelled) + swayOf(f);
        return { s: Math.round(s * 100) / 100, past: Math.round((s - def.mouth) * 100) / 100, opacity: f.opacity };
      });
    },
    destroy() {
      if (dead) return;
      dead = true;
      for (const f of fans) {
        f.avatar.destroy();
        f.shadow.destroy();
        for (const m of f.materials) m.destroy();
      }
      fans.length = 0;
      shadowMat.destroy();
      mesh.destroy();
    },
  };
}
