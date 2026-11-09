/**
 * Dev-only GLB model gallery (apps/web/gallery.html). Not part of the production build: Vite only
 * builds index.html. Reads apps/web/public/models/manifest.<group>.json written by
 * tools/models/build.ts and shows the GLBs under game-like lighting.
 *
 * Query params (all optional):
 *   group=<g>[,<g2>] | all     every asset of the group(s)
 *   model=<g>/<name>[,...]     specific assets
 *   filter=<text>              only asset names containing text
 *   pose=<name> | all          apply a manifest pose (all = one copy per pose + rest)
 *   yaw=30 pitch=16            camera orbit in degrees (yaw 0 = looking at the model's front, +Z)
 *   zoom=1 | dist=<m>          zoom multiplies the auto-fit; dist sets the camera distance
 *   fov=35 target=x,y,z        vertical FOV / look-at override
 *   bg=cave|neutral            background + floor (default cave)
 *   light=game|studio          warm low key + dim fill + ambient (default) | neutral white
 *   key=<i> fill=<i>           override key / fill light intensity (game: 1.35 / 0.45)
 *   grid=1 ref=1 anchors=1     1 m floor grid / 1.75 m reference figure + pole / anchor markers
 *   labels=0 shadows=0 lights=0 floor=0
 *   cols=<n> gap=<m>           layout of several assets (rows go back along -Z)
 *   exposure=1 tonemap=aces (default; same as the game should use) | linear (exact palette) | aces2 | neutral | filmic | none
 * When everything is loaded and ~10 frames rendered: window.__ready = true, title "READY".
 * Load problems are listed in window.__errors (and on screen).
 */
import * as pc from "playcanvas";
import { instantiateModel, loadModelContainer } from "./models.js";

type Vec3 = [number, number, number];
interface LightDef {
  name?: string;
  at: Vec3;
  color: string;
  intensity?: number;
  range?: number;
}
type PoseDef = Record<string, Vec3 | { rot?: Vec3; at?: Vec3 }>;
interface ManifestAsset {
  name: string;
  file: string;
  url?: string;
  triangles: number;
  budget?: number;
  overBudget?: boolean;
  bounds: { min: Vec3; max: Vec3 };
  notes?: string;
  anchors?: Record<string, Vec3>;
  lights?: LightDef[];
  poses?: Record<string, PoseDef>;
}
interface Manifest {
  group: string;
  assets: ManifestAsset[];
}
interface Item {
  group: string;
  asset: ManifestAsset;
  pose?: string;
}
interface Inst {
  item: Item;
  holder: pc.Entity;
  aabb: pc.BoundingBox;
  label?: HTMLDivElement;
}

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
    __info?: unknown;
  }
}

const DEG = Math.PI / 180;
const q = new URLSearchParams(location.search);
const str = (k: string, d: string) => q.get(k) ?? d;
const num = (k: string, d: number) => {
  const v = q.get(k);
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const flag = (k: string, d: boolean) => {
  const v = q.get(k);
  if (v === null) return d;
  return !["0", "false", "off", "no"].includes(v.toLowerCase());
};
const vec = (k: string): Vec3 | null => {
  const v = q.get(k);
  if (!v) return null;
  const p = v.split(",").map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : null;
};
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const errors: string[] = [];
window.__errors = errors;
window.__ready = false;
const errorsEl = document.getElementById("errors") as HTMLDivElement;
const labelsEl = document.getElementById("labels") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const indexEl = document.getElementById("index") as HTMLDivElement;
function reportError(msg: string) {
  errors.push(msg);
  console.error("[gallery] " + msg);
  errorsEl.textContent = errors.join("\n");
}
window.addEventListener("error", (e) => reportError(String(e.message || e)));
window.addEventListener("unhandledrejection", (e) => reportError("unhandled: " + String(e.reason)));

/* ------------------------------------------------------------------ app + look */

const canvas = document.getElementById("gallery") as HTMLCanvasElement;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());
app.start();

const bg = str("bg", "cave") === "neutral" ? "neutral" : "cave";
const lightMode = str("light", "game") === "studio" ? "studio" : "game";
const THEMES = {
  cave: { clear: "#140F0C", floor: "#3A2A1F", grid: new pc.Color(0.5, 0.4, 0.3) },
  neutral: { clear: "#7A7671", floor: "#64605B", grid: new pc.Color(0.38, 0.38, 0.38) },
} as const;
const theme = THEMES[bg];
const TONEMAPS: Record<string, number> = {
  neutral: pc.TONEMAP_NEUTRAL,
  aces: pc.TONEMAP_ACES,
  aces2: pc.TONEMAP_ACES2,
  filmic: pc.TONEMAP_FILMIC,
  linear: pc.TONEMAP_LINEAR,
  none: pc.TONEMAP_NONE,
};
const shadows = flag("shadows", true);
app.scene.exposure = num("exposure", 1);

const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color().fromString(theme.clear),
  fov: num("fov", 35),
});
const cam = camera.camera!;
cam.toneMapping = TONEMAPS[str("tonemap", "aces")] ?? pc.TONEMAP_ACES;
cam.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);

function directional(name: string, color: pc.Color, intensity: number, castShadows: boolean) {
  const e = new pc.Entity(name);
  e.addComponent("light", {
    type: "directional",
    color,
    intensity,
    castShadows,
    shadowResolution: 2048,
    shadowBias: 0.05,
    normalOffsetBias: 0.04,
    shadowType: pc.SHADOW_PCF3_32F,
  });
  app.root.addChild(e);
  return e;
}
/** Point a directional light so it shines FROM (yaw, elevation) toward the origin. */
function aim(e: pc.Entity, yawDeg: number, elevDeg: number) {
  const y = yawDeg * DEG;
  const el = elevDeg * DEG;
  e.setPosition(Math.sin(y) * Math.cos(el) * 10, Math.sin(el) * 10, Math.cos(y) * Math.cos(el) * 10);
  e.lookAt(0, 0, 0);
  e.rotateLocal(90, 0, 0); // directional lights shine along local -Y
}
// Light / ambient colours are sRGB in PlayCanvas (a "slightly warm" sRGB value is already quite
// orange in linear terms), so keep them only gently tinted.
const LIGHTS = {
  game: { ambient: [0.34, 0.28, 0.24], key: [1, 0.85, 0.68], keyI: 1.35, fill: [0.62, 0.6, 0.68], fillI: 0.45 },
  studio: { ambient: [0.45, 0.45, 0.45], key: [1, 1, 1], keyI: 1.3, fill: [1, 1, 1], fillI: 0.55 },
}[lightMode];
const rgb = (c: number[]) => new pc.Color(c[0], c[1], c[2]);
app.scene.ambientLight = rgb(LIGHTS.ambient);
const key = directional("key", rgb(LIGHTS.key), num("key", LIGHTS.keyI), shadows);
const fill = directional("fill", rgb(LIGHTS.fill), num("fill", LIGHTS.fillI), false);

/* ------------------------------------------------------------------ data */

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return JSON.parse(await r.text()) as T;
  } catch {
    return null;
  }
}
const stamp = Date.now();
const manifests = new Map<string, Promise<Manifest | null>>();
function manifest(group: string): Promise<Manifest | null> {
  let p = manifests.get(group);
  if (!p) {
    p = fetchJson<Manifest>(`/models/manifest.${group}.json?t=${stamp}`);
    manifests.set(group, p);
  }
  return p;
}
const loadContainer = (url: string) => loadModelContainer(app, url);

async function selectItems(): Promise<Item[]> {
  const items: Item[] = [];
  const filter = q.get("filter");
  const modelParam = q.get("model");
  if (modelParam)
    for (const spec of modelParam.split(",").map((s) => s.trim()).filter(Boolean)) {
      const slash = spec.indexOf("/");
      const group = spec.slice(0, slash);
      const name = spec.slice(slash + 1);
      const m = slash > 0 ? await manifest(group) : null;
      const asset = m?.assets.find((a) => a.name === name);
      if (asset) items.push({ group, asset });
      else reportError(`model not found: ${spec}${m ? "" : ` (no manifest.${group}.json)`}`);
    }
  const groupParam = q.get("group");
  if (groupParam) {
    const groups =
      groupParam === "all"
        ? ((await fetchJson<{ groups: string[] }>(`/models/index.json?t=${stamp}`))?.groups ?? [])
        : groupParam.split(",").map((s) => s.trim()).filter(Boolean);
    for (const group of groups) {
      const m = await manifest(group);
      if (!m) {
        if (groupParam !== "all") reportError(`manifest not found: /models/manifest.${group}.json`);
        continue;
      }
      for (const asset of m.assets) if (!filter || asset.name.includes(filter)) items.push({ group, asset });
    }
  }
  const pose = q.get("pose");
  if (pose === "all")
    return items.flatMap((it) => [it, ...Object.keys(it.asset.poses ?? {}).map((p) => ({ ...it, pose: p }))]);
  if (pose) for (const it of items) if (it.asset.poses?.[pose]) it.pose = pose;
  return items;
}

/* ------------------------------------------------------------------ helpers */

function aabbOf(e: pc.Entity): pc.BoundingBox | null {
  let box: pc.BoundingBox | null = null;
  for (const r of e.findComponents("render"))
    for (const mi of r.meshInstances) {
      if (!box) box = new pc.BoundingBox(mi.aabb.center.clone(), mi.aabb.halfExtents.clone());
      else box.add(mi.aabb);
    }
  return box;
}
function applyPose(root: pc.Entity, pose: PoseDef) {
  for (const [name, v] of Object.entries(pose)) {
    const node = root.findByName(name);
    if (!node) {
      reportError(`pose node not found: ${name}`);
      continue;
    }
    if (Array.isArray(v)) node.setLocalEulerAngles(v[0], v[1], v[2]);
    else {
      if (v.rot) node.setLocalEulerAngles(v.rot[0], v.rot[1], v.rot[2]);
      if (v.at) node.setLocalPosition(v.at[0], v.at[1], v.at[2]);
    }
  }
}
function matteMaterial(hex: string) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(hex);
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.15;
  m.update();
  return m;
}
/** 1.75 m grey-blue mannequin + banded pole (0.25 m bands), feet at the origin. */
function makeReference(): pc.Entity {
  const root = new pc.Entity("ref_1_75m");
  const body = matteMaterial("#8C9BB0");
  const bands = [matteMaterial("#E8E2D6"), matteMaterial("#3B4250")];
  const part = (type: "box" | "sphere", mat: pc.Material, pos: Vec3, size: Vec3) => {
    const e = new pc.Entity();
    e.addComponent("render", { type, material: mat, castShadows: true });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalScale(size[0], size[1], size[2]);
    root.addChild(e);
  };
  part("box", body, [-0.09, 0.43, 0], [0.14, 0.86, 0.16]);
  part("box", body, [0.09, 0.43, 0], [0.14, 0.86, 0.16]);
  part("box", body, [0, 1.16, 0], [0.42, 0.6, 0.22]);
  part("box", body, [-0.27, 1.13, 0], [0.1, 0.58, 0.12]);
  part("box", body, [0.27, 1.13, 0], [0.1, 0.58, 0.12]);
  part("box", body, [0, 1.5, 0], [0.09, 0.08, 0.09]);
  part("sphere", body, [0, 1.625, 0], [0.24, 0.25, 0.24]);
  for (let i = 0; i < 7; i++) part("box", bands[i % 2], [0.5, 0.125 + i * 0.25, 0], [0.05, 0.25, 0.05]);
  return root;
}

/* ------------------------------------------------------------------ index page */

async function showIndex() {
  const idx = await fetchJson<{ groups: string[] }>(`/models/index.json?t=${stamp}`);
  const groups = idx?.groups ?? ["environment", "fire", "furniture", "props", "characters"];
  let html =
    "<h2>Model gallery</h2><p>?group=&lt;g&gt; | ?model=&lt;g&gt;/&lt;name&gt; · yaw, pitch, zoom, dist, fov, " +
    "target=x,y,z · bg=cave|neutral · light=game|studio · grid=1 · ref=1 · anchors=1 · pose=&lt;name&gt;|all · " +
    "labels=0 · shadows=0 · lights=0 · floor=0 · cols · gap · filter · key · fill · exposure · tonemap</p>";
  for (const g of groups) {
    const m = await manifest(g);
    html += `<h3><a href="?group=${esc(g)}">${esc(g)}</a> <small>(${m ? m.assets.length + " assets" : "no manifest yet"})</small></h3>`;
    if (m)
      html +=
        "<ul>" +
        m.assets
          .map(
            (a) =>
              `<li><a href="?model=${esc(g)}/${esc(a.name)}">${esc(a.name)}</a> · ${a.triangles} tris${
                a.notes ? " · " + esc(a.notes) : ""
              }</li>`,
          )
          .join("") +
        "</ul>";
  }
  indexEl.innerHTML = html;
  indexEl.style.display = "block";
  hudEl.style.display = "none";
  canvas.style.display = "none";
}

/* ------------------------------------------------------------------ main */

let readyFrames = -1;
app.on("update", () => {
  if (readyFrames >= 0 && ++readyFrames === 10) {
    window.__ready = true;
    document.title = "READY";
  }
});

async function main() {
  if (!q.get("group") && !q.get("model")) {
    await showIndex();
    window.__info = { index: true };
    readyFrames = 0;
    return;
  }
  const items = await selectItems();
  const insts: Inst[] = [];
  await Promise.all(
    items.map((it) => loadContainer(`${it.asset.url ?? `/models/${it.asset.file}`}?v=${stamp}`).catch(() => null)),
  );
  for (const item of items) {
    try {
      const res = await loadContainer(`${item.asset.url ?? `/models/${item.asset.file}`}?v=${stamp}`);
      const holder = new pc.Entity(`inst_${item.asset.name}`);
      const model = instantiateModel(res, shadows);
      holder.addChild(model);
      app.root.addChild(holder);
      if (item.pose && item.asset.poses?.[item.pose]) applyPose(model, item.asset.poses[item.pose]);
      const b = item.asset.bounds;
      const aabb =
        aabbOf(holder) ??
        new pc.BoundingBox(
          new pc.Vec3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2),
          new pc.Vec3((b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2),
        );
      insts.push({ item, holder, aabb });
    } catch (err) {
      reportError(`failed to load ${item.group}/${item.asset.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!insts.length) {
    if (!errors.length) reportError("nothing to show (check group/model/filter)");
    hudEl.textContent = "no models";
    readyFrames = 0;
    return;
  }

  // Layout: rows along +X, further rows behind (-Z).
  const n = insts.length;
  const cols = Math.max(1, Math.round(num("cols", n <= 5 ? n : Math.ceil(Math.sqrt(n * 1.8)))));
  const widths = insts.map((i) => i.aabb.halfExtents.x * 2).sort((a, b) => a - b);
  const gap = num("gap", Math.max(0.25, 0.35 * widths[Math.floor(widths.length / 2)]));
  let rowZ = 0;
  let prevDepth = 0;
  for (let r = 0; r * cols < n; r++) {
    const row = insts.slice(r * cols, r * cols + cols);
    const depth = Math.max(...row.map((i) => i.aabb.halfExtents.z * 2));
    if (r > 0) rowZ -= prevDepth / 2 + gap + depth / 2;
    prevDepth = depth;
    const total = row.reduce((s, i) => s + i.aabb.halfExtents.x * 2, 0) + gap * (row.length - 1);
    let x = -total / 2;
    for (const inst of row) {
      const w = inst.aabb.halfExtents.x * 2;
      const off = new pc.Vec3(x + w / 2 - inst.aabb.center.x, 0, rowZ - inst.aabb.center.z);
      inst.holder.setPosition(off);
      inst.aabb.center.add(off);
      x += w + gap;
    }
  }
  const rows = Math.ceil(n / cols);
  const union = new pc.BoundingBox(insts[0].aabb.center.clone(), insts[0].aabb.halfExtents.clone());
  for (const i of insts) union.add(i.aabb);

  // Optional reference figure, left of the first row.
  if (flag("ref", false)) {
    const ref = makeReference();
    const first = insts[0].aabb;
    ref.setPosition(union.getMin().x - 0.75, 0, first.center.z);
    app.root.addChild(ref);
    const rb = aabbOf(ref);
    if (rb) union.add(rb);
  }

  // Asset-defined lights (campfire, torch, lantern…).
  if (flag("lights", true))
    for (const inst of insts)
      for (const l of inst.item.asset.lights ?? []) {
        const e = new pc.Entity(`light_${l.name ?? inst.item.asset.name}`);
        e.addComponent("light", {
          type: "omni",
          color: new pc.Color().fromString(l.color),
          intensity: l.intensity ?? 1.5,
          range: l.range ?? 5,
          castShadows: false,
        });
        const p = inst.holder.getPosition();
        e.setPosition(p.x + l.at[0], p.y + l.at[1], p.z + l.at[2]);
        app.root.addChild(e);
      }

  // Camera auto-fit.
  const yaw = num("yaw", 30);
  const pitch = num("pitch", rows > 1 ? 26 : 16);
  const c = union.center;
  const t = vec("target");
  const target = t ? new pc.Vec3(t[0], t[1], t[2]) : c.clone();
  const dir = new pc.Vec3(
    Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
    Math.sin(pitch * DEG),
    Math.cos(yaw * DEG) * Math.cos(pitch * DEG),
  );
  const fwd = dir.clone().mulScalar(-1);
  const right = new pc.Vec3().cross(fwd, pc.Vec3.UP).normalize();
  const up = new pc.Vec3().cross(right, fwd).normalize();
  const aspect = Math.max(0.2, app.graphicsDevice.width / Math.max(1, app.graphicsDevice.height));
  const tanV = Math.tan((cam.fov * DEG) / 2) * 0.86;
  const tanH = tanV * aspect;
  const mn = union.getMin();
  const mx = union.getMax();
  let fit = 0.1;
  for (const cx of [mn.x, mx.x])
    for (const cy of [mn.y, mx.y])
      for (const cz of [mn.z, mx.z]) {
        const v = new pc.Vec3(cx - target.x, cy - target.y, cz - target.z);
        const depth = v.dot(fwd);
        fit = Math.max(fit, Math.abs(v.dot(right)) / tanH - depth, Math.abs(v.dot(up)) / tanV - depth);
      }
  const dist = num("dist", fit) / num("zoom", 1);
  camera.setPosition(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
  camera.lookAt(target);
  const radius = union.halfExtents.length();
  cam.nearClip = Math.max(0.01, dist * 0.01);
  cam.farClip = dist + radius * 8 + 40;

  // Lights follow the camera so every yaw is readable: key front-left-above, fill from behind-right.
  aim(key, yaw + 45, 52);
  aim(fill, yaw - 125, 28);
  key.light!.shadowDistance = dist + radius * 2.5;

  // Floor + fog to fade its edges.
  if (flag("floor", true)) {
    const floor = new pc.Entity("floor");
    floor.addComponent("render", { type: "plane", material: matteMaterial(theme.floor), castShadows: false });
    const size = Math.max(30, radius * 10);
    floor.setLocalScale(size, 1, size);
    floor.setPosition(c.x, -0.002, c.z);
    app.root.addChild(floor);
  }
  if (bg === "cave") {
    app.scene.fog.type = pc.FOG_LINEAR;
    app.scene.fog.color = new pc.Color().fromString(theme.clear);
    app.scene.fog.start = dist + radius * 1.2;
    app.scene.fog.end = dist + radius * 4 + 8;
  }

  // Grid + anchors (immediate-mode lines, redrawn every frame).
  const gridPos: pc.Vec3[] = [];
  if (flag("grid", false)) {
    const x0 = Math.floor(mn.x) - 1,
      x1 = Math.ceil(mx.x) + 1,
      z0 = Math.floor(mn.z) - 1,
      z1 = Math.ceil(mx.z) + 1;
    for (let x = x0; x <= x1; x++) gridPos.push(new pc.Vec3(x, 0.003, z0), new pc.Vec3(x, 0.003, z1));
    for (let z = z0; z <= z1; z++) gridPos.push(new pc.Vec3(x0, 0.003, z), new pc.Vec3(x1, 0.003, z));
  }
  const anchorPos: pc.Vec3[] = [];
  if (flag("anchors", false))
    for (const inst of insts) {
      const p = inst.holder.getPosition();
      for (const a of Object.values(inst.item.asset.anchors ?? {})) {
        const s = 0.06;
        const ax = p.x + a[0],
          ay = p.y + a[1],
          az = p.z + a[2];
        anchorPos.push(
          new pc.Vec3(ax - s, ay, az), new pc.Vec3(ax + s, ay, az),
          new pc.Vec3(ax, ay - s, az), new pc.Vec3(ax, ay + s, az),
          new pc.Vec3(ax, ay, az - s), new pc.Vec3(ax, ay, az + s),
        );
      }
    }
  const magenta = new pc.Color(1, 0.2, 0.9);
  app.on("update", () => {
    if (gridPos.length) app.drawLines(gridPos, theme.grid, true);
    if (anchorPos.length) app.drawLines(anchorPos, magenta, false);
  });

  // Labels.
  const showLabels = flag("labels", true);
  let totalTris = 0;
  for (const inst of insts) {
    const a = inst.item.asset;
    totalTris += a.triangles;
    if (!showLabels) continue;
    const over = a.overBudget ?? (a.budget !== undefined && a.triangles > a.budget);
    const div = document.createElement("div");
    div.className = "lbl";
    div.innerHTML =
      `<b>${esc(a.name)}</b>${inst.item.pose ? " · " + esc(inst.item.pose) : ""}<br>` +
      `${a.triangles} tris${a.budget ? " / " + a.budget : ""}${over ? ' <span class="over">OVER</span>' : ""}`;
    labelsEl.appendChild(div);
    inst.label = div;
  }
  const screen = new pc.Vec3();
  app.on("update", () => {
    for (const inst of insts) {
      if (!inst.label) continue;
      const b = inst.aabb;
      cam.worldToScreen(new pc.Vec3(b.center.x, b.getMin().y, b.getMax().z), screen);
      inst.label.style.left = `${screen.x.toFixed(1)}px`;
      inst.label.style.top = `${screen.y.toFixed(1)}px`;
    }
  });
  const groupsShown = [...new Set(insts.map((i) => i.item.group))].join(", ");
  if (showLabels)
    hudEl.textContent =
      `${groupsShown} · ${insts.length} asset${insts.length > 1 ? "s" : ""} · ${totalTris} tris · ` +
      `yaw ${yaw} pitch ${pitch} dist ${dist.toFixed(2)} m · ${bg}/${lightMode}`;
  else hudEl.style.display = "none";

  window.__info = {
    assets: insts.length,
    triangles: totalTris,
    groups: groupsShown,
    camera: { yaw, pitch, dist: +dist.toFixed(3), target: [target.x, target.y, target.z].map((v) => +v.toFixed(3)) },
  };
  readyFrames = 0;
}

main().catch((err) => {
  reportError(`gallery failed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  readyFrames = 0;
});
