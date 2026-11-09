/**
 * Warm glints on the puddle (board 01: long torch reflections on dark water). The renderer has no
 * reflections, so each nearby light source gets one soft additive streak lying on the water,
 * stretched toward the camera, on the line between the source and the camera: at the physical
 * mirror point when that falls on the water, otherwise as close to it as the water allows. The
 * streaks shimmer (scale only: one shared material, no per-frame material updates) and shrink away
 * when the line from the source to the camera misses the water.
 */
import * as pc from "playcanvas";

export interface GlintSource {
  /** World position of the light (flame centre). */
  at: pc.Vec3;
  seed: number;
  /** Streak width multiplier (the campfire is wider than a torch). */
  size?: number;
}

const TAU = Math.PI * 2;
/** Sources farther than this from the water's centre (m, plus its half length) are ignored. */
const REACH = 6;
/** Water surface above the puddle's pivot (manifest meta.waterY) and the glint's lift above it. */
const WATER_Y = 0.05;
const LIFT = 0.008;
/** Keep the streaks this far inside the water outline (the outline is irregular). */
const INSET = 0.8;
const COLOR = "#FFB45A";
/** Width of the main piece of a torch reflection (m). */
const WIDTH = 0.5;

const wobble = (t: number, hz: number, seed: number) =>
  0.6 * Math.sin(TAU * hz * t + seed) +
  0.4 * Math.sin(TAU * hz * 2.37 * t + seed * 1.9);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A 1 x 1 m lens in XZ (long axis Z), bright along the centre line, black at the rim (additive). */
function streakMesh(device: pc.GraphicsDevice): pc.Mesh {
  const xs = [-0.5, -0.22, 0, 0.22, 0.5];
  const zs = [-0.5, -0.36, -0.18, 0, 0.18, 0.36, 0.5];
  const positions: number[] = [];
  const colors: number[] = [];
  for (const z of zs)
    for (const x of xs) {
      positions.push(x, 0, z);
      const along = Math.pow(1 - Math.abs(2 * z), 0.6);
      const across = Math.pow(1 - Math.abs(2 * x), 1.6);
      const k = along * across;
      colors.push(k, k, k, 1);
    }
  const indices: number[] = [];
  const n = xs.length;
  for (let j = 0; j + 1 < zs.length; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setColors(colors);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function glintMaterial(): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.name = "tl_water_glint";
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString(COLOR);
  m.emissiveIntensity = 1.8;
  m.emissiveVertexColor = true;
  m.emissiveVertexColorChannel = "rgb";
  m.blendType = pc.BLEND_ADDITIVE;
  m.depthWrite = false;
  m.useFog = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

export function createWaterGlints(
  app: pc.AppBase,
  camera: pc.Entity,
  puddle: pc.Entity,
  sources: readonly GlintSource[],
  animators: ((t: number) => void)[],
): void {
  const water = puddle.findByName("water") as pc.Entity | null;
  const aabb = water?.render?.meshInstances[0]?.mesh?.aabb;
  if (!water || !aabb) return;
  // Water outline as an ellipse in the puddle's own frame (yaw + position only).
  const cx = aabb.center.x,
    cz = aabb.center.z;
  const a = aabb.halfExtents.x * INSET,
    b = aabb.halfExtents.z * INSET;
  const toLocal = puddle.getWorldTransform().clone().invert();
  const y0 = puddle.getPosition().y + WATER_Y;
  const centre = puddle
    .getWorldTransform()
    .transformPoint(new pc.Vec3(cx, 0, cz));
  const near = sources.filter(
    (s) =>
      Math.hypot(s.at.x - centre.x, s.at.z - centre.z) < REACH + Math.max(a, b),
  );
  if (!near.length) return;

  const mesh = streakMesh(app.graphicsDevice);
  const material = glintMaterial();
  /** A rippled reflection is broken into pieces along the line: [offset (x length), width, length]. */
  const PIECES = [
    [0, 1, 0.42],
    [-0.33, 0.7, 0.3],
    [0.33, 0.8, 0.3],
  ] as const;
  const glints = near.map((s) => {
    const pieces = PIECES.map(() => {
      const e = new pc.Entity("water-glint");
      e.addComponent("render", {
        meshInstances: [new pc.MeshInstance(mesh, material)],
        castShadows: false,
        receiveShadows: false,
      });
      puddle.addChild(e);
      return e;
    });
    const src = toLocal.transformPoint(s.at);
    return {
      pieces,
      sx: src.x - cx,
      sz: src.z - cz,
      sy: s.at.y - y0,
      seed: s.seed,
      size: s.size ?? 1,
    };
  });

  const c = new pc.Vec3();
  animators.push((t) => {
    toLocal.transformPoint(camera.getPosition(), c);
    const cy = camera.getPosition().y - y0;
    for (const g of glints) {
      const dx = c.x - cx - g.sx,
        dz = c.z - cz - g.sz;
      const dist = Math.hypot(dx, dz);
      let show = cy > 0.1 && g.sy > 0.1 && dist > 0.5;
      let lam = 0,
        len = 0,
        weight = 0;
      const ux = dx / (dist || 1),
        uz = dz / (dist || 1);
      if (show) {
        // Line source + lam * u against the ellipse (x/a)^2 + (z/b)^2 = 1.
        const A = (ux * ux) / (a * a) + (uz * uz) / (b * b);
        const B = 2 * ((g.sx * ux) / (a * a) + (g.sz * uz) / (b * b));
        const C = (g.sx * g.sx) / (a * a) + (g.sz * g.sz) / (b * b) - 1;
        const disc = B * B - 4 * A * C;
        if (disc <= 0) show = false;
        else {
          const r = Math.sqrt(disc);
          const l0 = Math.max(0, (-B - r) / (2 * A)),
            l1 = Math.min(dist - 0.3, (-B + r) / (2 * A));
          const inside = l1 - l0;
          if (inside < 0.6) show = false;
          else {
            // Seen at a grazing angle the glitter path runs across the whole water toward the
            // viewer: cover most of the crossing, centred toward the physical mirror point.
            len = clamp(inside * 0.9, 0.8, 4.5);
            const mirror = (dist * g.sy) / (g.sy + cy);
            lam = clamp(mirror, l0 + len / 2, l1 - len / 2);
            if (l1 - l0 < len) lam = (l0 + l1) / 2;
            weight = 1 - clamp((Math.abs(lam - mirror) - 2) / 6, 0, 0.5);
          }
        }
      }
      g.pieces.forEach((e, i) => {
        e.enabled = show;
        if (!show) return;
        const [off, w, l] = PIECES[i];
        const k = g.seed + i * 1.7;
        const at = lam + off * len + 0.05 * wobble(t, 0.45, k);
        e.setLocalPosition(
          cx + g.sx + ux * at,
          WATER_Y + LIFT,
          cz + g.sz + uz * at,
        );
        e.setLocalEulerAngles(0, (Math.atan2(ux, uz) * 180) / Math.PI, 0);
        e.setLocalScale(
          WIDTH * w * g.size * weight * (1 + 0.25 * wobble(t, 1.3, k + 1)),
          1,
          len * l * (1 + 0.12 * wobble(t, 0.7, k + 2)),
        );
      });
    }
  });
}
