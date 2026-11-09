/**
 * Dev-only world viewer (apps/web/preview.html). Not part of the production build: Vite only
 * builds index.html. Renders createWorld() from a camera preset or a custom camera.
 *
 * Query params (all optional):
 *   view=<preset>                  concept (default) | spawn | campfire | memory | tv | rest |
 *                                  living | quiz | exit | overview
 *   cam=x,y,z look=x,y,z fov=deg   custom camera (overrides the preset)
 *   npcs=0                         no NPC fans
 *   post=0                         no post-processing (bloom, vignette, MSAA via pc.CameraFrame)
 *   quality=high|low|auto          render quality (default high here: stable screenshots; the game
 *                                  uses auto = low on touch devices / when frames stay slow)
 *   time=<s>                       freeze flicker / idles at that time (deterministic screenshots)
 *   stats=1                        overlay: draw calls, triangles, frame ms
 *   fans=1 | <n>                   drop 6 (or n) standing rest-pose fans at the spawn (scale / perf)
 *   debug=1                        floor overlay: collision circles, walk radius, spawn disc, landmarks
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
  HUB_LANDMARKS,
  HUB_LAYOUT,
  HUB_PLACEMENTS,
  SPAWN_CLEAR_RADIUS,
  type Placement,
} from "@te-liet/shared";
import { instantiateModel, loadModelContainer } from "./models.js";
import { createWorld } from "./scene.js";
import { modelUrl } from "./world/manifest.js";

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
const world = createWorld(app, {
  npcs: flag("npcs", true),
  post: q.get("post") === null ? undefined : flag("post", true),
  quality:
    qualityParam === "low" || qualityParam === "auto" ? qualityParam : "high",
  time: num("time"),
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
        new pc.Vec3(x + r * Math.cos(a), 0.06, z + r * Math.sin(a)),
        new pc.Vec3(x + r * Math.cos(b), 0.06, z + r * Math.sin(b)),
      );
    }
  };
  const obstacleLines: pc.Vec3[] = [];
  for (const o of HUB_LAYOUT.obstacles) circle(o.x, o.z, o.r);
  obstacleLines.push(...lines.splice(0));
  circle(0, 0, HUB_LAYOUT.radius, 120);
  circle(HUB_LAYOUT.spawn.x, HUB_LAYOUT.spawn.z, SPAWN_CLEAR_RADIUS, 40);
  const areaLines = lines.splice(0);
  for (const l of HUB_LANDMARKS) {
    circle(l.x, l.z, 0.25, 12);
    circle(l.x, l.z, 3, 48);
  }
  const markLines = lines.splice(0);
  const red = new pc.Color(1, 0.25, 0.2),
    cyan = new pc.Color(0.3, 0.9, 1),
    lime = new pc.Color(0.6, 1, 0.3);
  app.on("update", () => {
    app.drawLines(obstacleLines, red, false);
    app.drawLines(areaLines, cyan, false);
    app.drawLines(markLines, lime, false);
  });
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
