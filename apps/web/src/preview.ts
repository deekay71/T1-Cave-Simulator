/**
 * Dev-only world viewer (apps/web/preview.html). Not part of the production build: Vite only
 * builds index.html. Renders createWorld() from a camera preset or a custom camera.
 *
 * Query params (all optional):
 *   view=<preset>                  concept (default) | spawn | campfire | overview | checkin |
 *                                  crateCorner | screen | water | rest | living | tea | crates | rug | exit |
 *                                  memory | quest | quiz | shop | mouth_<id> | tunnel_<id> |
 *                                  tunnel_<id>_back | cave_<id>, <id> = ne_back | nw_back |
 *                                  nw_front | ne_front (apps/web/src/world/views.ts)
 *   cam=x,y,z look=x,y,z fov=deg   custom camera (overrides the preset)
 *   npcs=0                         no NPC fans
 *   screen=idle|upcoming|running   canned picture on the big wall screen (default: the match feed)
 *   post=0                         no post-processing (bloom, vignette, MSAA via pc.CameraFrame)
 *   quality=high|low|auto          render quality (default high here: stable screenshots; the game
 *                                  uses auto = low on touch devices / when frames stay slow)
 *   time=<s>                       freeze flicker / idles at that time (deterministic screenshots)
 *   stats=1                        overlay: draw calls, triangles, frame ms
 *   fans=1 | <n>                   drop 6 (or n) standing rest-pose fans at the spawn (scale / perf)
 *   debug=1                        floor overlay: collision circles (red), the walk rooms (cyan: big
 *                                  cave, side caves, tunnel chains) and the camera limit 0.6 m
 *                                  outside them (grey), spawn disc, landmarks (lime)
 *   clear=ff00ff                   clear colour (hex, no #), fog off: any pixel of that colour is a
 *                                  hole in the world (use with post=0)
 *   sweep=1                        camera sweep: drives the game's follow camera (camera.ts, same
 *                                  bounds and blockers as main.ts) from every reachable player
 *                                  position (grid `step` m, default 2.4, plus the tunnels every
 *                                  0.9 m) at 12 yaws x 3 pitches x 2 zooms, renders each view with a
 *                                  magenta clear colour and counts the pixels that show it (void
 *                                  behind the rock). Result in window.__info.sweep; implies post=0.
 *                                  sweepAt=x,z limits it to one player position (to screenshot a
 *                                  finding: add yaw=&pitch=&dist= and it stays on that view).
 *   bench=<n>                      also average n frames after ready (window.__info avgFrameMs, avgCpuMs)
 *   patch={"<i>": {...}}           (URL-encoded JSON) merge into HUB_PLACEMENTS[i] before the world is
 *                                  built (npc / tweak merged too): try poses and positions here
 *                                  without restarting the game server (it rebuilds on shared edits)
 *   add=[{...}, ...]               (URL-encoded JSON) extra placements, same shape as the table
 * window.__preview = { app, world } for scripted experiments over CDP.
 * When the world is ready and ~10 frames rendered: window.__ready = true, title "READY" and
 * window.__info holds the camera and the render stats. Load problems go to window.__errors.
 */
import * as pc from "playcanvas";
import {
  CAVE_CAMERA_MARGIN,
  constrain,
  HUB_CAVES,
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_PLACEMENTS,
  HUB_ROOMS,
  inRooms,
  SPAWN_CLEAR_RADIUS,
  type Placement,
} from "@te-liet/shared";
import { cameraBlockers } from "./blockers.js";
import { createFollowCamera } from "./camera.js";
import { CAVE_BOUNDS, ceilingAt, type Blocker } from "./cameraMath.js";
import { instantiateModel, loadModelContainer } from "./models.js";
import { createWorld } from "./scene.js";
import { loadManifests, modelUrl } from "./world/manifest.js";
import { STALL_CAMERA_BLOCKERS } from "./world/stalls.js";

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
    __info?: unknown;
    /** Live handles for scripted experiments over CDP (dev page only). */
    __preview?: { app: pc.Application; world: ReturnType<typeof createWorld> };
  }
}

type V3 = [number, number, number];
const q = new URLSearchParams(location.search);
const num = (k: string): number | undefined => {
  const v = q.get(k);
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const flag = (k: string, d: boolean) => {
  const v = q.get(k);
  return v === null
    ? d
    : !["0", "false", "off", "no"].includes(v.toLowerCase());
};
const vec = (k: string): V3 | null => {
  const p = (q.get(k) ?? "").split(",").map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : null;
};

const errors: string[] = (window.__errors ??= []);
window.__ready = false;
const errorsEl = document.getElementById("errors") as HTMLDivElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const showErrors = () => (errorsEl.textContent = errors.join("\n"));
window.addEventListener("error", (e) => {
  errors.push(String(e.message || e));
  showErrors();
});
window.addEventListener("unhandledrejection", (e) => {
  errors.push("unhandled: " + String(e.reason));
  showErrors();
});

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { antialias: true, alpha: false },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());
app.start();

/** Dev experiments: patch / extend the placement table of this page only (see the header). */
function patchPlacements() {
  const table = HUB_PLACEMENTS as unknown as Placement[];
  const json = <T>(k: string): T | null => {
    const v = q.get(k);
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch (err) {
      errors.push(`${k}: ${String(err)}`);
      return null;
    }
  };
  for (const [k, v] of Object.entries(
    json<Record<string, Partial<Placement>>>("patch") ?? {},
  )) {
    const old = table[Number(k)];
    if (!old) {
      errors.push(`patch: no placement ${k}`);
      continue;
    }
    const npc =
      v.npc && old.npc
        ? {
            ...old.npc,
            ...v.npc,
            tweak: { ...old.npc.tweak, ...v.npc.tweak },
          }
        : (v.npc ?? old.npc);
    table[Number(k)] = { ...old, ...v, ...(npc ? { npc } : {}) };
  }
  table.push(...(json<Placement[]>("add") ?? []));
}
patchPlacements();

const qualityParam = q.get("quality");
const sweeping = flag("sweep", false);
const clearHex = q.get("clear") ?? (sweeping ? "ff00ff" : null);
const screenDemo = q.get("screen");
const world = createWorld(app, {
  npcs: flag("npcs", true),
  post: sweeping ? false : q.get("post") === null ? undefined : flag("post", true),
  quality:
    qualityParam === "low" || qualityParam === "auto" ? qualityParam : "high",
  time: num("time"),
  screen: screenDemo === "idle" || screenDemo === "upcoming" || screenDemo === "running" ? screenDemo : undefined,
});
window.__preview = { app, world };
const viewName = q.get("view") ?? "concept";
if (!world.setView(viewName))
  errors.push(
    `unknown view "${viewName}" (${Object.keys(world.views).join(", ")})`,
  );
const cam = vec("cam"),
  look = vec("look"),
  fov = num("fov");
if (cam) world.camera.setPosition(...cam);
if (cam || look)
  world.camera.lookAt(...(look ?? world.views[viewName]?.look ?? [0, 1, 0]));
if (fov) world.camera.camera!.fov = fov;
if (clearHex) {
  // Any pixel of this colour is a hole: no haze to hide it.
  const c = world.camera.camera!;
  c.clearColor = new pc.Color().fromString("#" + clearHex);
  const fog = new pc.FogParams();
  fog.type = pc.FOG_NONE;
  c.fog = fog;
}

/** Standing rest-pose fans in rows at the spawn, facing the fire (players' scale / perf stand-ins). */
async function dropFans(n: number) {
  const variants = [
    "cap_red",
    "hoodie_white",
    "hoodie_black",
    "torn_jersey",
    "headband",
    "glasses",
    "oxygen",
  ];
  const res = await Promise.all(
    variants.map((v) =>
      loadModelContainer(
        app,
        modelUrl(`characters/tl_char_fan_${v}_v01`),
      ).catch((err: unknown) => {
        errors.push(String(err));
        return null;
      }),
    ),
  );
  for (let i = 0; i < n; i++) {
    const r = res[i % variants.length];
    if (!r) continue;
    const e = instantiateModel(r, true);
    const row = Math.floor(i / 6),
      col = i % 6;
    e.setPosition(
      HUB_LAYOUT.spawn.x - 2.5 + col + (row % 2) * 0.5,
      0,
      HUB_LAYOUT.spawn.z + 1.5 - row,
    );
    e.setEulerAngles(0, 180 + ((i * 37) % 50) - 25, 0);
    app.root.addChild(e);
  }
}

/** Floor overlay of the shared collision data (immediate-mode lines, redrawn every frame). */
function debugOverlay() {
  const lines: pc.Vec3[] = [];
  const circle = (x: number, z: number, r: number, seg = 28) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2,
        b = ((i + 1) / seg) * Math.PI * 2;
      lines.push(
        new pc.Vec3(x + r * Math.cos(a), 0.09, z + r * Math.sin(a)),
        new pc.Vec3(x + r * Math.cos(b), 0.09, z + r * Math.sin(b)),
      );
    }
  };
  const obstacleLines: pc.Vec3[] = [];
  for (const o of HUB_LAYOUT.obstacles) circle(o.x, o.z, o.r);
  obstacleLines.push(...lines.splice(0));
  // Walk rooms: the big cave, the four side caves and the chains of small discs of the tunnels.
  for (const o of HUB_ROOMS) circle(o.x, o.z, o.r, o.r > 5 ? 120 : 24);
  circle(HUB_LAYOUT.spawn.x, HUB_LAYOUT.spawn.z, SPAWN_CLEAR_RADIUS, 40);
  const areaLines = lines.splice(0);
  // Camera limit: the rooms grown by the camera margin.
  for (const o of HUB_ROOMS)
    circle(o.x, o.z, o.r + CAVE_CAMERA_MARGIN, o.r > 5 ? 120 : 24);
  const cameraLines = lines.splice(0);
  for (const l of HUB_LANDMARKS) {
    circle(l.x, l.z, 0.25, 12);
    circle(l.x, l.z, 3, 48);
  }
  const markLines = lines.splice(0);
  const red = new pc.Color(1, 0.25, 0.2),
    cyan = new pc.Color(0.3, 0.9, 1),
    grey = new pc.Color(0.55, 0.55, 0.55),
    lime = new pc.Color(0.6, 1, 0.3);
  app.on("update", () => {
    app.drawLines(obstacleLines, red, false);
    app.drawLines(areaLines, cyan, false);
    app.drawLines(cameraLines, grey, false);
    app.drawLines(markLines, lime, false);
  });
}

/* ------------------------------------------------------------------ camera sweep */

/** Blockers exactly as main.ts builds them for the cave (the shrine's own ring is on the island). */
async function caveBlockers(): Promise<Blocker[]> {
  const index = await loadManifests(
    ["environment", "fire", "furniture", "props"],
    (msg) => errors.push(msg),
  );
  return [...STALL_CAMERA_BLOCKERS, ...cameraBlockers(index)];
}

/**
 * Off-screen frame for the sweep: the camera renders into a plain (not multisampled) texture that
 * is read back right after app.render(). Reading the canvas itself between renders of one task
 * returns stale frames, so the sweep never uses it.
 */
function sweepTarget(w: number, h: number) {
  const cam = world.camera.camera!;
  const device = app.graphicsDevice as pc.GraphicsDevice & {
    gl: WebGL2RenderingContext;
    setFramebuffer(fb: WebGLFramebuffer | null): void;
  };
  const tex = new pc.Texture(device, {
    name: "camera-sweep",
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
  const c = cam.clearColor;
  const want = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
  return {
    count(): number {
      app.render();
      const fb = (rt as unknown as { impl: { _glFrameBuffer: WebGLFramebuffer } }).impl._glFrameBuffer;
      device.setFramebuffer(fb);
      device.gl.readPixels(0, 0, w, h, device.gl.RGBA, device.gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (Math.abs(px[i] - want[0]) < 12 && Math.abs(px[i + 1] - want[1]) < 12 && Math.abs(px[i + 2] - want[2]) < 12) n++;
      return n;
    },
    release() {
      (cam as unknown as { renderTarget: pc.RenderTarget | null }).renderTarget = null;
      rt.destroy();
      tex.destroy();
    },
  };
}

/** Reachable player positions: a grid over the walk area plus the tunnels (axis and both walls). */
function sweepSpots(step: number): { x: number; z: number }[] {
  const one = (q.get("sweepAt") ?? "").split(",").map(Number);
  if (one.length === 2 && one.every(Number.isFinite)) return [constrain(one[0], one[1])];
  const spots: { x: number; z: number }[] = [];
  for (let x = -40; x <= 40; x += step)
    for (let z = -27; z <= 27; z += step) {
      const p = constrain(x + 0.013, z + 0.007);
      if (Math.hypot(p.x - x, p.z - z) < step * 0.6) spots.push(p);
    }
  for (const c of HUB_CAVES) {
    const d = Math.hypot(c.x, c.z),
      ux = c.x / d,
      uz = c.z / d;
    for (let t = 18; t <= 32; t += 0.9)
      for (const lat of [-1.65, 0, 1.65])
        spots.push(constrain(ux * t - uz * lat, uz * t + ux * lat));
    // the side cave's rim, where the camera is squeezed against the rock
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spots.push(constrain(c.x + 6.95 * Math.cos(a), c.z + 6.95 * Math.sin(a)));
    }
  }
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    spots.push(constrain(19.95 * Math.cos(a), 19.95 * Math.sin(a)));
  }
  return spots;
}

/**
 * Camera sweep through the real follow camera: for every spot, yaw, pitch and zoom the camera is
 * snapped behind a player standing there (camera.ts containment: rooms, ceilings, blockers) and
 * the view rendered with a magenta clear colour. Counts magenta pixels (void) and camera points
 * outside the rooms + margin, above the room's ceiling or inside a blocker.
 */
async function cameraSweep() {
  const blockers = await caveBlockers();
  const follow = createFollowCamera(world.camera, {
    bounds: { ...CAVE_BOUNDS, blockers },
  });
  const cam = world.camera.camera!;
  cam.fov = 50;
  const spots = sweepSpots(num("step") ?? 2.4);
  const yaws = num("yaw") !== undefined ? [num("yaw")!] : Array.from({ length: 12 }, (_, i) => -180 + i * 30);
  const pitches = num("pitch") !== undefined ? [num("pitch")!] : [-5, 18, 60];
  const zooms = num("dist") !== undefined ? [num("dist")!] : [2.5, 8];
  const single = spots.length * yaws.length * pitches.length * zooms.length === 1;
  const target = single ? null : sweepTarget(480, 270);
  const feet = new pc.Vec3();
  const bad: { at: number[]; yaw: number; pitch: number; dist: number; cam: number[]; pixels: number; why: string }[] = [];
  let frames = 0,
    clearPixels = 0,
    outside = 0,
    inBlocker = 0,
    shortest = Infinity;
  for (const s of spots)
    for (const yaw of yaws)
      for (const pitch of pitches)
        for (const dist of zooms) {
          follow.snapBehind(yaw);
          follow.pitch = pitch;
          follow.distance = dist;
          follow.update(1 / 60, feet.set(s.x, 0, s.z));
          const p = world.camera.getPosition();
          shortest = Math.min(shortest, follow.boom);
          const why: string[] = [];
          // 0.16 m: the over-the-shoulder pivot may sit that far outside the grown rooms
          if (!inRooms(p.x, p.z, HUB_ROOMS, CAVE_CAMERA_MARGIN + 0.16)) why.push("outside rooms");
          // the pivot lift (short boom) is capped by the ceiling of the camera's own room
          // (getPosition() is float32: test the ceiling 1 mm toward the player)
          const back = 0.001 / Math.max(0.001, Math.hypot(s.x - p.x, s.z - p.z));
          const top = ceilingAt(p.x + (s.x - p.x) * back, p.z + (s.z - p.z) * back, CAVE_BOUNDS);
          if (p.y > top + 1e-3 || p.y < 0.6 - 1e-3) why.push(`height ${p.y.toFixed(2)} (ceiling ${top})`);
          if (why.length) outside++;
          const k = blockers.find(
            (b) =>
              (p.x - b.x) ** 2 + (p.z - b.z) ** 2 < (b.r - 1e-3) ** 2 &&
              p.y < b.top - 1e-3 &&
              p.y > (b.bottom ?? -Infinity) + 1e-3 &&
              // a blocker whose footprint holds the (shoulder-shifted) pivot is ignored by design
              Math.hypot(s.x - b.x, s.z - b.z) > b.r + 0.8,
          );
          if (k) {
            inBlocker++;
            why.push(`in blocker (${k.x.toFixed(2)}, ${k.z.toFixed(2)})`);
          }
          const pixels = target ? target.count() : 0;
          frames++;
          clearPixels += pixels;
          if (pixels) why.push("void");
          if (why.length && bad.length < 60)
            bad.push({
              at: [+s.x.toFixed(2), +s.z.toFixed(2)],
              yaw,
              pitch,
              dist,
              cam: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
              pixels,
              why: why.join(", "),
            });
        }
  target?.release();
  return {
    spots: spots.length,
    frames,
    pixelsPerFrame: 480 * 270,
    clearPixels,
    outside,
    inBlocker,
    shortestBoom: +shortest.toFixed(3),
    blockers: blockers.length,
    bad,
  };
}

function stats() {
  const s = app.stats;
  const dc = s.drawCalls;
  return {
    drawCalls: s.drawCallCount,
    forward: dc.forward,
    shadow: dc.shadow,
    triangles: s.primitiveCount ?? null,
    frameMs: +s.frameTime.toFixed(2),
    cpuRenderMs: +s.cpuRenderTime.toFixed(2),
    fps: s.fps,
  };
}

async function main() {
  const fans = q.get("fans");
  const jobs: Promise<unknown>[] = [world.ready];
  if (fans !== null && fans !== "0")
    jobs.push(
      dropFans(fans === "1" ? 6 : Math.max(0, Math.min(60, Number(fans) || 0))),
    );
  if (flag("debug", false)) debugOverlay();
  await Promise.all(jobs);
  showErrors();
  if (flag("stats", false)) {
    statsEl.style.display = "block";
    let acc = 0;
    app.on("update", (dt: number) => {
      if ((acc += dt) < 0.5) return;
      acc = 0;
      const st = stats();
      statsEl.textContent =
        `draw calls ${st.drawCalls} (forward ${st.forward}, shadow ${st.shadow})\n` +
        `triangles ${st.triangles ?? "n/a"}\n` +
        `frame ${st.frameMs} ms · cpu render ${st.cpuRenderMs} ms · ${st.fps} fps`;
    });
  }
  // The sweep runs once the world stands (it renders its own frames, off-screen).
  const sweep = sweeping ? await cameraSweep() : null;
  // Ready after ~10 frames; with bench=<n> also average the next n frames (frame / CPU render ms).
  const bench = Math.max(0, Math.min(1000, num("bench") ?? 0));
  let frames = 0,
    sumFrame = 0,
    sumCpu = 0,
    maxFrame = 0;
  app.on("update", () => {
    frames++;
    if (frames > 10 && frames <= 10 + bench) {
      sumFrame += app.stats.frameTime;
      sumCpu += app.stats.cpuRenderTime + app.stats.cpuUpdateTime;
      maxFrame = Math.max(maxFrame, app.stats.frameTime);
    }
    if (frames !== 10 + bench) return;
    const p = world.camera.getPosition();
    window.__info = {
      view: viewName,
      quality: world.quality,
      cam: [p.x, p.y, p.z].map((v) => +v.toFixed(3)),
      fov: world.camera.camera!.fov,
      ...stats(),
      ...(sweep ? { sweep } : {}),
      ...(bench
        ? {
            benchFrames: bench,
            avgFrameMs: +(sumFrame / bench).toFixed(2),
            maxFrameMs: +maxFrame.toFixed(2),
            avgCpuMs: +(sumCpu / bench).toFixed(2),
          }
        : {}),
    };
    window.__ready = true;
    document.title = "READY";
  });
}

main().catch((err: unknown) => {
  errors.push(
    `preview failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  showErrors();
  window.__ready = true;
});
