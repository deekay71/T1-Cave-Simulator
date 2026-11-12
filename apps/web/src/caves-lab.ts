/**
 * Dev-only viewer of the multi-cave shell (apps/web/caves-lab.html). Not part of the production
 * build: Vite only builds index.html. Assembles the world from the "caves" model group
 * (tools/models/groups/caves.ts): main shell at the origin, four tunnels and four side caves placed
 * by the recipe in the main floor's manifest meta, the campfire, a torch with a warm light at every
 * torch anchor, and standing fans for scale.
 *
 * Query params (all optional):
 *   view=<name>            main (default) | concept | wide | overview | exit | mouth_<id> |
 *                          tunnel_<id> | tunnel_<id>_back | inside_<id> | side_<id> | side_<id>_back
 *                          with <id> = ne_back | nw_back | nw_front | ne_front
 *   cam=x,y,z look=x,y,z fov=deg   custom camera (overrides the view)
 *   clear=ff00ff           clear colour (hex, no #); also turns the fog off: any pixel of that colour
 *                          is a hole in the shell. window.__info.clearPixels counts them.
 *   ceiling=0              hide the main ceiling, the side cave ceilings and the tunnel roofs
 *   debug=1                draw the walk discs (cyan), the camera margin (grey) and the anchors (lime)
 *   stats=1                overlay: draw calls, triangles, frame ms
 *   torches=0 fans=0       leave the torches / the standing fans out
 *   holes=1                hole sweep: renders six directions from every reachable camera position
 *                          (walk discs + 0.6 m, 0.6 m .. camera top) with clear=ff00ff and counts the
 *                          clear-coloured pixels. Result in window.__info.holes.
 *   step=<m>               grid step of the hole sweep (default 2.5)
 * When everything is loaded and ~10 frames rendered: window.__ready = true, title "READY";
 * window.__info holds the camera and the render stats. Load problems go to window.__errors.
 */
import * as pc from "playcanvas";
import { inRooms, tunnelRooms, type Room } from "../../../packages/shared/src/rooms.js";
import { instantiateModel, loadModelContainer } from "./models.js";
import { loadManifests, modelUrl, type ManifestAsset } from "./world/manifest.js";

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
    __info?: unknown;
  }
}

type V3 = [number, number, number];
interface Placement {
  id: string;
  theta: number;
  rotY: number;
  side: { asset: string; at: V3 };
  tunnel: { asset: string; at: V3 };
}
interface WalkMeta {
  main: { x: number; z: number; r: number };
  sides: { id: string; x: number; z: number; r: number }[];
  tunnels: { id: string; from: { x: number; z: number }; to: { x: number; z: number }; r: number }[];
  cameraMargin: number;
}
interface CeilingMeta {
  main: { cameraTop: number };
  tunnel: { cameraTop: number };
  side: { cameraTop: number };
}
interface View {
  pos: V3;
  look: V3;
  fov?: number;
  ceiling?: boolean;
  fog?: boolean;
}

const DEG = Math.PI / 180;
const q = new URLSearchParams(location.search);
const num = (k: string): number | undefined => {
  const v = q.get(k);
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const flag = (k: string, d: boolean) => {
  const v = q.get(k);
  return v === null ? d : !["0", "false", "off", "no"].includes(v.toLowerCase());
};
const vec = (k: string): V3 | null => {
  const p = (q.get(k) ?? "").split(",").map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : null;
};

const errors: string[] = (window.__errors ??= []);
window.__ready = false;
const errorsEl = document.getElementById("errors") as HTMLDivElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const report = (msg: string) => {
  errors.push(msg);
  errorsEl.textContent = errors.join("\n");
};
window.addEventListener("error", (e) => report(String(e.message || e)));
window.addEventListener("unhandledrejection", (e) => report("unhandled: " + String(e.reason)));

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());
app.start();

/* ------------------------------------------------------------------ look (mirrors scene.ts) */

const holes = flag("holes", false);
const clearHex = q.get("clear") ?? (holes ? "ff00ff" : null);
const LOOK = {
  clear: "#0D0907",
  exposure: 1.15,
  ambient: [0.27, 0.27, 0.3] as const,
  fog: { color: "#2A1A12", start: 16, end: 70 },
  fill: { color: [0.62, 0.68, 0.9] as const, intensity: 0.55, euler: [52, -24, 0] as const },
  wallColor: "#FFDCC4",
};
const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color().fromString("#" + (clearHex ?? LOOK.clear.slice(1))),
  fov: 52,
  nearClip: 0.1,
  farClip: 160,
});
const cam = camera.camera!;
cam.toneMapping = pc.TONEMAP_ACES;
cam.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);
app.scene.ambientLight = new pc.Color(...LOOK.ambient);
app.scene.exposure = LOOK.exposure;
function setFog(on: boolean) {
  const fog = new pc.FogParams();
  fog.type = on ? pc.FOG_LINEAR : pc.FOG_NONE;
  fog.color = new pc.Color().fromString(LOOK.fog.color);
  fog.start = LOOK.fog.start;
  fog.end = LOOK.fog.end;
  cam.fog = fog;
}

const root = new pc.Entity("caves");
app.root.addChild(root);
const fill = new pc.Entity("fill");
fill.addComponent("light", {
  type: "directional",
  color: new pc.Color(...LOOK.fill.color),
  intensity: LOOK.fill.intensity,
  castShadows: false,
});
fill.setEulerAngles(...LOOK.fill.euler);
root.addChild(fill);
function omni(at: readonly number[], color: string, intensity: number, range: number, shadows = false) {
  const e = new pc.Entity("omni");
  e.addComponent("light", {
    type: "omni",
    color: new pc.Color().fromString(color),
    intensity,
    range,
    castShadows: shadows,
    shadowBias: 0.25,
    shadowResolution: 1024,
  });
  e.setPosition(at[0], at[1], at[2]);
  root.addChild(e);
  return e;
}

/* ------------------------------------------------------------------ world */

const overhead: pc.Entity[] = [];
const yawPoint = (p: V3, at: V3, rotY: number): V3 => {
  const c = Math.cos(rotY * DEG),
    s = Math.sin(rotY * DEG);
  return [at[0] + p[0] * c + p[2] * s, at[1] + p[1], at[2] - p[0] * s + p[2] * c];
};

async function place(id: string, at: V3, rotY: number, shadows = false): Promise<pc.Entity | null> {
  try {
    const e = instantiateModel(await loadModelContainer(app, modelUrl(id)), shadows);
    e.name = id.slice(id.indexOf("/") + 1);
    e.setPosition(at[0], at[1], at[2]);
    e.setEulerAngles(0, rotY, 0);
    root.addChild(e);
    return e;
  } catch (err) {
    report(String(err));
    return null;
  }
}

interface Torch {
  name: string;
  at: V3;
  rotY: number;
}

async function build() {
  const manifests = await loadManifests(["caves", "fire"], report);
  const asset = (id: string): ManifestAsset | undefined => manifests.get(id);
  const floor = asset("caves/tl_cave_main_floor_v01");
  if (!floor?.meta) throw new Error("manifest.caves.json: tl_cave_main_floor_v01 meta missing");
  const meta = floor.meta as {
    walk: WalkMeta;
    layout: { placements: Placement[] };
    ceilingAt: CeilingMeta;
    openings: { id: string; kind: string; mouth: V3; dir: V3 }[];
    torches: { id: string; at: V3; rotY: number; room: string }[];
  };
  const placements = meta.layout.placements;
  const jobs: Promise<unknown>[] = [];
  const torches: Torch[] = [];

  // Main shell: cave space, no rotation.
  jobs.push(place("caves/tl_cave_main_floor_v01", [0, 0, 0], 0));
  jobs.push(
    place("caves/tl_cave_main_ceiling_v01", [0, 0, 0], 0).then((e) => {
      if (e) overhead.push(e);
    }),
  );
  for (let s = 0; s < 6; s++) jobs.push(place(`caves/tl_cave_main_wall_0${s}_v01`, [0, 0, 0], 0));
  // Every torch spot of the world, already in cave space (meta.torches of the main floor).
  // (one niche torch per side cave is enough for the lab)
  for (const t of meta.torches) if (!t.id.endsWith("_niche_b")) torches.push({ name: t.id, at: t.at, rotY: t.rotY });
  // Tunnels and side caves by the recipe.
  for (const p of placements) {
    jobs.push(
      place(`caves/${p.tunnel.asset}`, p.tunnel.at, p.rotY).then((e) => {
        const roof = e?.findByName(p.tunnel.asset.slice(0, -4) + "_roof");
        if (roof) overhead.push(roof as pc.Entity);
      }),
    );
    jobs.push(
      place(`caves/${p.side.asset}`, p.side.at, p.rotY).then((e) => {
        const top = e?.findByName(p.side.asset.slice(0, -4) + "_ceiling");
        if (top) overhead.push(top as pc.Entity);
      }),
    );
    // soft bounce so the small cave reads beyond its torches
    omni([p.side.at[0], 3.2, p.side.at[2]], LOOK.wallColor, 0.5, 11);
  }

  // Campfire + the hall's bounce lights (scene.ts values, moved out to the bigger walls).
  jobs.push(place("fire/tl_fx_campfire_v01", [0, 0, 0], 0, true));
  omni([0, 2.6, 0], "#FFC284", 2.5, 6.5, true);
  omni([0, 1.2, 0], "#FFC284", 1, 12);
  omni([0, 5, -1], "#FFE4CC", 0.45, 34);
  for (const w of [
    { at: [0, 7.5, -14.5], i: 0.85, r: 19 },
    { at: [-14, 7, -3.5], i: 0.85, r: 19 },
    { at: [14, 7, -3.5], i: 0.85, r: 19 },
    { at: [-9.5, 7, 11], i: 0.7, r: 19 },
    { at: [9.5, 7, 11], i: 0.7, r: 19 },
    { at: [-8.5, 8, -17.5], i: 0.9, r: 14 },
    { at: [8.5, 8, -17.5], i: 0.9, r: 14 },
  ])
    omni(w.at, LOOK.wallColor, w.i, w.r);

  if (flag("torches", true)) {
    const lightAt = asset("fire/tl_fx_torch_tripod_v01")?.anchors?.light ?? [0, 2.36, 0];
    for (const t of torches) {
      jobs.push(place("fire/tl_fx_torch_tripod_v01", t.at, t.rotY));
      omni(yawPoint(lightAt, t.at, t.rotY), "#FFD0A0", 1.35, 7.5);
    }
  }
  if (flag("fans", true)) {
    const variants = ["cap_red", "hoodie_white", "hoodie_black", "torn_jersey", "headband", "glasses"];
    const spots: { at: V3; rotY: number }[] = [
      { at: [0, 0, 11], rotY: 180 },
      { at: [-1.6, 0, 3.2], rotY: 150 },
      { at: [6, 0, -14], rotY: 20 },
    ];
    for (const p of placements) {
      const d = Math.hypot(p.side.at[0], p.side.at[2]);
      const u: V3 = [p.side.at[0] / d, 0, p.side.at[2] / d];
      const along = (t: number, lat = 0): V3 => [u[0] * t - u[2] * lat, 0, u[2] * t + u[0] * lat];
      spots.push({ at: along(20.6, 1.1), rotY: p.rotY }); // at the mouth, main side
      spots.push({ at: along(25.9, -0.9), rotY: p.rotY + 180 }); // inside the tunnel
      spots.push({ at: along(d - 2, 1.5), rotY: p.rotY + 40 }); // in the side cave
    }
    spots.forEach((s, i) => jobs.push(place(`characters/tl_char_fan_${variants[i % variants.length]}_v01`, s.at, s.rotY)));
  }
  await Promise.all(jobs);
  return { meta, placements, torches };
}

/* ------------------------------------------------------------------ views */

function views(placements: Placement[]): Record<string, View> {
  const v: Record<string, View> = {
    main: { pos: [0, 2.6, 16.5], look: [0, 1.2, 0], fov: 50 },
    concept: { pos: [-0.9, 2.0, 8.0], look: [0.4, 1.45, -8], fov: 60 },
    wide: { pos: [0, 5.5, 19.5], look: [0, 4.5, -10], fov: 72 },
    overview: { pos: [0, 108, 0.5], look: [0, 0, 0], fov: 40, ceiling: false, fog: false },
    exit: { pos: [0, 2.2, -8], look: [0, 2.4, -23.4], fov: 50 },
  };
  for (const p of placements) {
    const d = Math.hypot(p.side.at[0], p.side.at[2]);
    const u = [p.side.at[0] / d, p.side.at[2] / d];
    const at = (t: number, y: number, lat = 0): V3 => [u[0] * t - u[1] * lat, y, u[1] * t + u[0] * lat];
    v[`mouth_${p.id}`] = { pos: at(8, 1.9), look: at(23.4, 2.2), fov: 50 };
    v[`tunnel_${p.id}`] = { pos: at(22.3, 1.7, 0.4), look: at(31, 1.5), fov: 62 };
    v[`tunnel_${p.id}_back`] = { pos: at(29.4, 1.7, -0.4), look: at(20, 1.5), fov: 62 };
    v[`inside_${p.id}`] = { pos: at(25.2, 1.7, 0.9), look: at(31, 1.6, -0.6), fov: 70 };
    v[`side_${p.id}`] = { pos: at(d - 6.6, 1.9), look: at(d + 4, 1.5), fov: 68 };
    v[`side_${p.id}_back`] = { pos: at(d + 5.2, 1.9, 1.2), look: at(24, 1.6), fov: 62 };
  }
  return v;
}

/* ------------------------------------------------------------------ debug + stats */

function walkRooms(walk: WalkMeta, tops: CeilingMeta): Room[] {
  return [
    { ...walk.main, top: tops.main.cameraTop, id: "main" },
    ...walk.sides.map((s) => ({ x: s.x, z: s.z, r: s.r, top: tops.side.cameraTop, id: s.id })),
    ...walk.tunnels.flatMap((t) => tunnelRooms(t.from, t.to, t.r, { top: tops.tunnel.cameraTop, id: `tunnel_${t.id}` })),
  ];
}

function debugOverlay(rooms: Room[], margin: number, torches: Torch[]) {
  const ring = (out: pc.Vec3[], x: number, z: number, r: number, seg = 48) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2,
        b = ((i + 1) / seg) * Math.PI * 2;
      out.push(new pc.Vec3(x + r * Math.cos(a), 0.09, z + r * Math.sin(a)), new pc.Vec3(x + r * Math.cos(b), 0.09, z + r * Math.sin(b)));
    }
  };
  const walk: pc.Vec3[] = [],
    camLines: pc.Vec3[] = [],
    marks: pc.Vec3[] = [];
  for (const o of rooms) {
    ring(walk, o.x, o.z, o.r, o.r > 5 ? 96 : 24);
    ring(camLines, o.x, o.z, o.r + margin, o.r > 5 ? 96 : 24);
  }
  for (const t of torches) ring(marks, t.at[0], t.at[2], 0.47, 14);
  const cyan = new pc.Color(0.3, 0.9, 1),
    grey = new pc.Color(0.6, 0.6, 0.6),
    lime = new pc.Color(0.6, 1, 0.3);
  app.on("update", () => {
    app.drawLines(walk, cyan, false);
    app.drawLines(camLines, grey, false);
    app.drawLines(marks, lime, false);
  });
}

function stats() {
  const s = app.stats;
  return {
    drawCalls: s.drawCallCount,
    triangles: s.primitiveCount ?? null,
    frameMs: +s.frameTime.toFixed(2),
    fps: s.fps,
  };
}

const isClear = (px: Uint8Array, i: number, want: number[]) =>
  Math.abs(px[i] - want[0]) < 12 && Math.abs(px[i + 1] - want[1]) < 12 && Math.abs(px[i + 2] - want[2]) < 12;
const clearRgb = () => {
  const c = cam.clearColor;
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
};

/** Clear-coloured pixels in the frame that was just rendered to the canvas (call from "frameend"). */
function clearPixels(): number {
  const gl = (app.graphicsDevice as unknown as { gl: WebGL2RenderingContext }).gl;
  const w = gl.drawingBufferWidth,
    h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const want = clearRgb();
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (isClear(px, i, want)) n++;
  return n;
}

/**
 * Off-screen frame for the hole sweep: the camera renders into a plain (not multisampled) texture
 * that is read back right after app.render(). Reading the canvas itself between renders of one
 * task returns stale frames, so the sweep never uses it.
 */
function sweepTarget(w: number, h: number) {
  const device = app.graphicsDevice as pc.GraphicsDevice & {
    gl: WebGL2RenderingContext;
    setFramebuffer(fb: WebGLFramebuffer | null): void;
  };
  const tex = new pc.Texture(device, {
    name: "hole-sweep",
    width: w,
    height: h,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_NEAREST,
    magFilter: pc.FILTER_NEAREST,
  });
  const rt = new pc.RenderTarget({ colorBuffer: tex, depth: true, samples: 1 });
  cam.renderTarget = rt;
  const px = new Uint8Array(w * h * 4);
  const want = clearRgb();
  return {
    /** Pixel (x from the left, y from the bottom) of the first clear-coloured pixel of the last count. */
    first: [0, 0] as [number, number],
    /** Render the current camera and count the clear-coloured pixels. */
    count(): number {
      app.render();
      const fb = (rt as unknown as { impl: { _glFrameBuffer: WebGLFramebuffer } }).impl._glFrameBuffer;
      device.setFramebuffer(fb);
      device.gl.readPixels(0, 0, w, h, device.gl.RGBA, device.gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (isClear(px, i, want) && n++ === 0) this.first = [(i / 4) % w, Math.floor(i / 4 / w)];
      return n;
    },
    release() {
      (cam as unknown as { renderTarget: pc.RenderTarget | null }).renderTarget = null;
      rt.destroy();
      tex.destroy();
    },
  };
}

/** Hole sweep: six 100-degree looks from every reachable camera position. */
function holeSweep(rooms: Room[], margin: number) {
  const step = num("step") ?? 2.5;
  const pts: V3[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const o of rooms) {
    minX = Math.min(minX, o.x - o.r - margin);
    maxX = Math.max(maxX, o.x + o.r + margin);
    minZ = Math.min(minZ, o.z - o.r - margin);
    maxZ = Math.max(maxZ, o.z + o.r + margin);
  }
  const add = (x: number, z: number) => {
    // highest camera top among the rooms that hold this point
    let top = -1;
    for (const o of rooms) if (Math.hypot(x - o.x, z - o.z) <= o.r + margin) top = Math.max(top, o.top ?? 3);
    if (top < 0) return;
    for (const y of [0.6, 1.7, top]) pts.push([x, y, z]);
  };
  for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) add(x, z);
  // the boundary of every room (the camera's outermost positions), tunnels included
  for (const o of rooms) {
    const n = o.r > 5 ? 40 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const x = o.x + (o.r + margin) * Math.cos(a),
        z = o.z + (o.r + margin) * Math.sin(a);
      if (inRooms(x, z, rooms, margin + 1e-6)) add(x, z);
    }
  }
  cam.fov = 100;
  const target = sweepTarget(480, 270);
  const dirs: V3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0.02, 1, 0],
    [0.02, -1, 0],
  ];
  const bad: { cam: V3; dir: V3; pixels: number; at: [number, number] }[] = [];
  let frames = 0,
    total = 0;
  for (const p of pts)
    for (const d of dirs) {
      camera.setPosition(p[0], p[1], p[2]);
      camera.lookAt(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
      const n = target.count();
      frames++;
      if (n) {
        total += n;
        if (bad.length < 40) bad.push({ cam: p.map((v) => +v.toFixed(3)) as V3, dir: d, pixels: n, at: [...target.first] });
      }
    }
  target.release();
  return { positions: pts.length, frames, pixelsPerFrame: 480 * 270, clearPixels: total, bad };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const { meta, placements, torches } = await build();
  const all = views(placements);
  const name = q.get("view") ?? "main";
  const view = all[name];
  if (!view) report(`unknown view "${name}" (${Object.keys(all).join(", ")})`);
  const v = view ?? all.main;
  const pos = vec("cam") ?? v.pos;
  const look = vec("look") ?? v.look;
  camera.setPosition(...pos);
  camera.lookAt(...look);
  cam.fov = num("fov") ?? v.fov ?? 52;
  setFog(!clearHex && (v.fog ?? true));
  const ceiling = flag("ceiling", v.ceiling ?? true);
  for (const e of overhead) e.enabled = ceiling;
  const rooms = walkRooms(meta.walk, meta.ceilingAt);
  if (flag("debug", false)) debugOverlay(rooms, meta.walk.cameraMargin, torches);
  if (flag("stats", false)) {
    statsEl.style.display = "block";
    let acc = 0;
    app.on("update", (dt: number) => {
      if ((acc += dt) < 0.5) return;
      acc = 0;
      const st = stats();
      statsEl.textContent = `draw calls ${st.drawCalls}\ntriangles ${st.triangles ?? "n/a"}\nframe ${st.frameMs} ms · ${st.fps} fps`;
    });
  }
  let frames = 0;
  app.on("frameend", () => {
    frames++;
    if (frames !== 10) return;
    const info: Record<string, unknown> = {
      view: name,
      cam: pos,
      look,
      fov: cam.fov,
      torches: torches.length,
      ...stats(),
    };
    if (clearHex) info.clearPixels = clearPixels();
    if (holes) info.holes = holeSweep(rooms, meta.walk.cameraMargin);
    window.__info = info;
    window.__ready = true;
    document.title = "READY";
  });
}

main().catch((err: unknown) => {
  report(`caves-lab failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  window.__ready = true;
});
