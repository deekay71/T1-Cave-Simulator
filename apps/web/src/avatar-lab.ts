/**
 * Dev-only lab for avatar.ts + camera.ts (apps/web/avatar-lab.html). Not in the production build:
 * Vite only builds index.html. Loads the cave shell, the campfire and a few torches with their
 * lights (ACES + sRGB like the game), spawns avatars and follows one with the follow camera
 * (drag / wheel / pinch work here too).
 *
 * Query params (all optional):
 *   count=8          avatars, cycling the 7 variants; i % 4: 0 walk a circle at 4 m/s, 1 idle,
 *                    2 emotes in place (wave, laugh, cheer...), 3 walk + emotes
 *   follow=0         followed avatar; yaw / pitch / dist / shoulder = follow camera (defaults 180 /
 *                    18 / 5.5 / 0.45 m like the game; shoulder=0 centres the avatar)
 *   radius=<m>       circle radius of the walkers (default 4.5-9 m); speed=<m/s> their speed (4)
 *   view=lineup      the 7 variants side by side (pick=0,3 to choose), front-lit, fixed camera
 *                    (yaw 180 looks at the fronts); face=<deg> turns the avatars (90 = profile,
 *                    facing screen right), speed=<m/s> walks them in place, emote=wave|laugh|cheer|mix
 *                    (at t = 0), x=<m> pans the camera, gap=<m> spacing; seed=<n> + stagger=<s>
 *                    make a filmstrip (identical copies, copy i runs i * stagger s ahead);
 *                    turn=<deg> turns copy i by i * turn more (turntable: pick=1,1,1,1&turn=90)
 *   wall=1           park the followed avatar at r = 16 (angle=<deg>, theta from +X toward -Z),
 *                    facing outward, camera behind it (yaw=<deg> overrides) to check containment
 *   rank=<1-5>       rank look of every avatar (2 oxygen trolley, 3 crutches, 4 wheelchair, 5 bed);
 *   ranks=all | 2,4  one rank per avatar, cycling 1..5 (or the given list)
 *   cosmetic=<id>    shop look of every avatar (cave-glasses, cave-keyboard, cave-ragged-shorts,
 *                    cave-tshirt, cave-tank-top, cave-jersey); cosmetic=all cycles them per avatar,
 *                    cosmetic=a,b,none cycles a list
 *   late=<s>         apply rank / cosmetic that many seconds into the run instead of at spawn
 *   gearwait=0       do not wait for the gear GLBs: setProgression runs before they are loaded
 *   churn=<n>        robustness: n rounds of random rank / look / shrine-seat changes on every
 *                    avatar before the final look; __info.churn compares the avatars' node count
 *                    with freshly built twins (a leak shows as a difference)
 *   batch=1          put the avatars in one dynamic batch group with shared materials, like the
 *                    game does for other players (gear must follow); fade=<0..1> gives avatar
 *                    `follow` (lineup: every avatar) the game's dithered self-fade at that opacity
 *   t=<s>            simulate t seconds in fixed 60 Hz steps, then freeze (deterministic shots)
 *   stats=1          overlay: fps, frame ms, draw calls, avatar update ms
 *   bench=<frames>   time that many avatar update frames up front (reported in __info)
 *   probe=1          foot slip / floor penetration of the followed avatar (in __info)
 *   tags=0           hide the name tags drawn at avatar.headTop
 *   ui=1             a test button over the canvas (drags starting on it must not orbit, and a
 *                    press on the canvas released over it must not leave hover orbiting);
 *                    window.__lab = { camera, clicks } for scripted input tests
 * Ready: window.__ready = true and title READY after load + 10 frames; window.__info = numbers.
 */
import * as pc from "playcanvas";
import { AVATAR_VARIANTS, createAvatar, preloadAvatars, type Avatar, type AvatarEmote } from "./avatar.js";
import { COSMETIC_IDS, preloadGear } from "./avatarProgression.js";
import { createFollowCamera, type FollowCamera } from "./camera.js";
import { instantiateModel, loadModelContainer } from "./models.js";

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
    __info?: unknown;
    __lab?: { camera: FollowCamera | null; clicks: number; uiClicks: number };
  }
}

const DEG = Math.PI / 180;
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = q.get(k);
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const flag = (k: string, d: boolean) => {
  const v = q.get(k);
  return v === null ? d : !["0", "false", "off", "no"].includes(v.toLowerCase());
};

const errors: string[] = [];
window.__errors = errors;
window.__ready = false;
const errorsEl = document.getElementById("errors") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const tagsEl = document.getElementById("tags") as HTMLDivElement;
function reportError(msg: string) {
  errors.push(msg);
  console.error("[avatar-lab] " + msg);
  errorsEl.textContent = errors.join("\n");
}
window.addEventListener("error", (e) => reportError(String(e.message || e)));
window.addEventListener("unhandledrejection", (e) => reportError("unhandled: " + String(e.reason)));

/* ------------------------------------------------------------------ app + look */

const canvas = document.getElementById("lab") as HTMLCanvasElement;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());
app.start();

const lineup = q.get("view") === "lineup";
const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color().fromString("#140F0C"),
  fov: 50,
  nearClip: 0.1,
  farClip: 90,
});
const cam = camera.camera!;
cam.toneMapping = pc.TONEMAP_ACES;
cam.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);

app.scene.ambientLight = new pc.Color(0.3, 0.25, 0.22);
app.scene.fog.type = pc.FOG_LINEAR;
app.scene.fog.color = new pc.Color().fromString("#140F0C");
app.scene.fog.start = 22;
app.scene.fog.end = 60;

const key = new pc.Entity("key");
key.addComponent("light", {
  type: "directional",
  color: new pc.Color(1, 0.86, 0.7),
  intensity: lineup ? 1.25 : 0.75,
  castShadows: true,
  shadowResolution: 2048,
  shadowDistance: 35,
  shadowBias: 0.05,
  normalOffsetBias: 0.04,
  shadowType: pc.SHADOW_PCF3_32F,
});
app.root.addChild(key);
/** Point a directional light so it shines FROM (yaw, elevation) toward the origin. */
function aim(e: pc.Entity, yawDeg: number, elevDeg: number) {
  const y = yawDeg * DEG,
    el = elevDeg * DEG;
  e.setPosition(Math.sin(y) * Math.cos(el) * 10, Math.sin(el) * 10, Math.cos(y) * Math.cos(el) * 10);
  e.lookAt(0, 0, 0);
  e.rotateLocal(90, 0, 0); // directional lights shine along local -Y
}

function omni(at: pc.Vec3, color: string, intensity: number, range: number) {
  const e = new pc.Entity("omni");
  e.addComponent("light", {
    type: "omni",
    color: new pc.Color().fromString(color),
    intensity,
    range,
    castShadows: false,
  });
  e.setPosition(at);
  app.root.addChild(e);
}

/* ------------------------------------------------------------------ cave */

const SHELL = ["floor", "wall_00", "wall_01", "wall_02", "wall_03", "wall_04", "wall_05", "ceiling"].map(
  (n) => `/models/environment/tl_env_cave_${n}_v01.glb`,
);
/** torches: [model, x, z] (yaw toward the fire); light offsets from manifest.fire.json */
const TORCHES: [string, number, number][] = [
  ["torch_pole", 8.5, -6.5],
  ["torch_tripod", -9, -5.5],
  ["torch_pole", -10.5, 5],
  ["torch_tripod", 10, 5.5],
];
const TORCH_LIGHT: Record<string, { y: number; color: string; intensity: number; range: number }> = {
  torch_pole: { y: 2.57, color: "#FFA552", intensity: 1.4, range: 6 },
  torch_tripod: { y: 2.36, color: "#FFA552", intensity: 1.5, range: 6.5 },
};

async function loadCave() {
  const place = async (url: string, x = 0, z = 0, yaw = 0) => {
    const e = instantiateModel(await loadModelContainer(app, url));
    e.setPosition(x, 0, z);
    e.setEulerAngles(0, yaw, 0);
    app.root.addChild(e);
  };
  await Promise.all([
    ...SHELL.map((u) => place(u)),
    place("/models/fire/tl_fx_campfire_v01.glb"),
    place("/models/fire/tl_fx_embers_ring_v01.glb"),
    ...TORCHES.map(([m, x, z]) => place(`/models/fire/tl_fx_${m}_v01.glb`, x, z, Math.atan2(-x, -z) / DEG)),
  ]);
  omni(new pc.Vec3(0, 1.2, 0), "#FF9A4C", 2.2, 9);
  for (const [m, x, z] of TORCHES) {
    const l = TORCH_LIGHT[m];
    omni(new pc.Vec3(x, l.y, z), l.color, l.intensity, l.range);
  }
}

/* ------------------------------------------------------------------ avatars */

type Kind = "walk" | "idle" | "emote" | "walk+emote" | "lineup" | "wall";
interface Bot {
  a: Avatar;
  kind: Kind;
  variant: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** walking circle */
  cx: number;
  cz: number;
  r: number;
  ang: number;
  dir: number;
  emoteIn: number;
  emoteNext: number;
  tag?: HTMLDivElement;
}
const EMOTES: AvatarEmote[] = ["wave", "laugh", "cheer"];
const bots: Bot[] = [];

function spawn(i: number, kind: Kind, variant: string, x: number, z: number, yaw: number): Bot {
  const a = createAvatar(app, { variant, seed: q.has("seed") ? num("seed", 1) : 1000 + i * 7919 });
  const b: Bot = {
    a,
    kind,
    variant,
    x,
    z,
    yaw,
    speed: 0,
    cx: 0,
    cz: 0,
    r: 0,
    ang: 0,
    dir: 1,
    emoteIn: 0.4 + 0.5 * i,
    emoteNext: i,
  };
  bots.push(b);
  return b;
}

function setupBots() {
  if (lineup) {
    const pick = (q.get("pick") ?? "")
      .split(",")
      .filter((s) => s.trim() !== "")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < AVATAR_VARIANTS.length);
    const list = pick.length ? pick : AVATAR_VARIANTS.map((_, i) => i);
    const face = num("face", 0);
    const gap = num("gap", 0.95);
    list.forEach((vi, i) => {
      const b = spawn(i, "lineup", AVATAR_VARIANTS[vi], (i - (list.length - 1) / 2) * gap, 5, face + i * num("turn", 0));
      b.speed = num("speed", 0);
    });
    const e = q.get("emote");
    if (e === "wave" || e === "laugh" || e === "cheer") for (const b of bots) b.a.emote(e);
    else if (e === "mix") bots.forEach((b, i) => b.a.emote(EMOTES[i % EMOTES.length]));
    return;
  }
  const count = Math.max(1, Math.min(60, Math.round(num("count", 8))));
  for (let i = 0; i < count; i++) {
    const variant = AVATAR_VARIANTS[i % AVATAR_VARIANTS.length];
    const kind: Kind = (["walk", "idle", "emote", "walk+emote"] as const)[i % 4];
    // idle / emote spots on a ring around the fire, facing it
    const ang = (i / count) * Math.PI * 2 + 0.3;
    const rr = 3.4 + (i % 3) * 1.6;
    const x = Math.cos(ang) * rr,
      z = Math.sin(ang) * rr;
    const b = spawn(i, kind, variant, x, z, Math.atan2(-x, -z) / DEG);
    if (kind === "walk" || kind === "walk+emote") {
      b.r = num("radius", 4.5 + ((i * 1.7) % 4.5));
      b.ang = ang;
      b.dir = i % 8 < 4 ? 1 : -1;
      b.speed = num("speed", 4);
    }
  }
  const fi = Math.max(0, Math.min(bots.length - 1, Math.round(num("follow", 0))));
  if (flag("wall", false)) {
    const b = bots[fi];
    const a = num("angle", 20) * DEG; // theta from +X toward -Z
    b.kind = "wall";
    b.x = Math.cos(a) * 16;
    b.z = -Math.sin(a) * 16;
    b.yaw = Math.atan2(b.x, b.z) / DEG; // facing outward
    b.speed = 0;
  }
}

/* ------------------------------------------------------------------ rank looks */

function rankOf(i: number): number {
  const list = q.get("ranks");
  if (list === "all") return 1 + (i % 5);
  if (list) {
    const ranks = list.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    if (ranks.length) return ranks[i % ranks.length];
  }
  return Math.max(1, Math.min(5, Math.round(num("rank", 1))));
}
function cosmeticOf(i: number): string | null {
  const c = q.get("cosmetic");
  if (c === "all") return COSMETIC_IDS[i % COSMETIC_IDS.length];
  if (!c) return null;
  const list = c.split(",").map((s) => s.trim());
  const id = list[i % list.length];
  return id && id !== "none" ? id : null;
}
function applyLooks() {
  bots.forEach((b, i) => b.a.setProgression(rankOf(i), cosmeticOf(i)));
}

/** Random look / seat changes on every avatar, then back to standing (see churn= in the header). */
function runChurn(rounds: number): { rounds: number } | null {
  if (rounds <= 0) return null;
  let s = 12345;
  const rnd = (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
  const looks = [null, ...COSMETIC_IDS, "fan-cap-red", "bogus"];
  for (let r = 0; r < rounds; r++)
    for (const b of bots) {
      b.a.setProgression(1 + rnd(5), looks[rnd(looks.length)]);
      if (rnd(3) === 0) b.a.setProgression(1 + rnd(5), looks[rnd(looks.length)]); // twice in a frame
      b.a.setShrinePose(rnd(6) === 0, rnd(2) ? "pray" : null, r / 10);
      if (rnd(8) === 0) b.a.emote(EMOTES[rnd(3)]);
      b.a.update(1 / 60, rnd(2) ? 3 : 0);
    }
  for (const b of bots) b.a.setShrinePose(false, null, 0);
  return { rounds };
}
const countNodes = (e: pc.GraphNode): number => e.children.reduce((n, c) => n + countNodes(c), 1);
/** After the final looks: every avatar against a fresh twin with the same look; the twins are destroyed. */
function churnCheck() {
  let nodes = 0,
    fresh = 0,
    twinsGone = true;
  bots.forEach((b, i) => {
    const twin = createAvatar(app, { variant: b.variant, seed: 1 });
    twin.setProgression(rankOf(i), cosmeticOf(i));
    twin.update(0, 0);
    fresh += countNodes(twin.entity);
    nodes += countNodes(b.a.entity);
    twin.destroy();
    twin.setProgression(5, "cave-jersey"); // after destroy: must be ignored
    twin.update(0.016, 1);
    if (app.root.children.includes(twin.entity)) twinsGone = false;
  });
  return { nodes, fresh, twinsGone };
}

/** What main.ts does for other players: shared tl_matte / tl_cloth materials + one dynamic batch group. */
const sharedMaterials = new Map<string, pc.Material>();
function batchLikeGame(a: Avatar) {
  const group = app.batcher.getGroupByName("tl_avatars") ?? app.batcher.addGroup("tl_avatars", true, 100);
  for (const r of a.entity.findComponents("render") as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material;
      if (!m || (m.name !== "tl_matte" && m.name !== "tl_cloth")) continue;
      const shared = sharedMaterials.get(m.name);
      if (shared) mi.material = shared;
      else sharedMaterials.set(m.name, m);
    }
    r.batchGroupId = group.id;
  }
}
/** What main.ts does for the player's own avatar: dithered clones at an opacity, not batched while faded. */
const fadeMaterials = new Map<string, pc.StandardMaterial>();
function fadeLikeGame(a: Avatar, opacity: number) {
  for (const r of a.entity.findComponents("render") as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material;
      if (!(m instanceof pc.StandardMaterial) || m.name.startsWith("tl_glow")) continue;
      let own = fadeMaterials.get(m.name);
      if (!own) {
        own = m.clone();
        own.opacityDither = pc.DITHER_BAYER8;
        own.opacityShadowDither = pc.DITHER_BAYER8;
        own.opacity = opacity;
        own.update();
        fadeMaterials.set(m.name, own);
      }
      mi.material = own;
    }
    r.batchGroupId = -1;
  }
}

function moveBot(b: Bot, dt: number) {
  if (b.kind === "walk" || b.kind === "walk+emote") {
    b.ang += ((b.dir * b.speed) / b.r) * dt;
    b.x = b.cx + Math.cos(b.ang) * b.r;
    b.z = b.cz + Math.sin(b.ang) * b.r;
    // velocity direction (d/dang of (cos, sin)) * dir
    b.yaw = Math.atan2(-Math.sin(b.ang) * b.dir, Math.cos(b.ang) * b.dir) / DEG;
  }
  if (b.kind === "emote" || b.kind === "walk+emote") {
    b.emoteIn -= dt;
    if (b.emoteIn <= 0) {
      b.a.emote(EMOTES[b.emoteNext++ % EMOTES.length]);
      b.emoteIn = 2.1;
    }
  }
}

/* ------------------------------------------------------------------ foot probe */

/** sole heel and toe on the shoe's centre line (leg_lower space) */
const SHOE: pc.Vec3[] = [new pc.Vec3(0, -0.52, -0.112), new pc.Vec3(0, -0.52, 0.19)];
interface FootTrack {
  node: pc.GraphNode;
  down: boolean;
  corner: number;
  ax: number;
  az: number;
  maxSlip: number;
}
const probe = { minY: Infinity, maxSlip: 0, contacts: 0, tracks: [] as FootTrack[] };
const pw = new pc.Vec3();
function probeStep() {
  for (const f of probe.tracks) {
    const m = f.node.getWorldTransform();
    let best = Infinity,
      bi = 0,
      bx = 0,
      bz = 0;
    for (let i = 0; i < SHOE.length; i++) {
      m.transformPoint(SHOE[i], pw);
      if (pw.y < best) {
        best = pw.y;
        bi = i;
        bx = pw.x;
        bz = pw.z;
      }
    }
    probe.minY = Math.min(probe.minY, best);
    const down = best < 0.006;
    if (down && (!f.down || f.corner !== bi)) {
      f.ax = bx;
      f.az = bz;
      f.corner = bi;
      probe.contacts++;
    } else if (down) {
      f.maxSlip = Math.max(f.maxSlip, Math.hypot(bx - f.ax, bz - f.az));
      probe.maxSlip = Math.max(probe.maxSlip, f.maxSlip);
    }
    if (!down) f.maxSlip = 0;
    f.down = down;
  }
}

/* ------------------------------------------------------------------ frame */

let follow: FollowCamera | null = null;
let followed: Bot | null = null;
let updMs = 0;
let updAvg = 0;
let frameAvg = 1 / 60;
const doProbe = flag("probe", false);

let simTime = 0;
let looksAt = -1;
function step(dt: number) {
  simTime += dt;
  if (looksAt >= 0 && simTime >= looksAt) {
    looksAt = -1;
    applyLooks();
  }
  for (const b of bots) {
    moveBot(b, dt);
    b.a.entity.setPosition(b.x, 0, b.z);
    b.a.entity.setEulerAngles(0, b.yaw, 0);
  }
  const t1 = performance.now();
  for (const b of bots) b.a.update(dt, b.speed);
  updMs = performance.now() - t1;
  if (follow && followed) follow.update(dt, followed.a.entity.getPosition());
  if (doProbe && simTime > 1) probeStep(); // skip the start (idle -> walk blend)
}

function placeLineupCamera() {
  const yaw = num("yaw", 180) * DEG;
  const pitch = num("pitch", 6) * DEG;
  const dist = num("dist", 7.4);
  const tx = num("x", 0),
    ty = num("y", 0.95),
    tz = 5;
  const dx = Math.sin(yaw) * Math.cos(pitch),
    dy = -Math.sin(pitch),
    dz = Math.cos(yaw) * Math.cos(pitch);
  camera.setPosition(tx - dx * dist, ty - dy * dist, tz - dz * dist);
  camera.setEulerAngles(-pitch / DEG, yaw / DEG + 180, 0);
}

const screen = new pc.Vec3();
const toTag = new pc.Vec3();
function drawTags() {
  const fwd = camera.forward;
  const cp = camera.getPosition();
  for (const b of bots) {
    if (!b.tag) continue;
    const h = b.a.headTop;
    toTag.sub2(h, cp);
    if (toTag.dot(fwd) <= 0.1) {
      b.tag.style.display = "none";
      continue;
    }
    cam.worldToScreen(h, screen);
    b.tag.style.display = "";
    b.tag.style.left = `${screen.x.toFixed(1)}px`;
    b.tag.style.top = `${screen.y.toFixed(1)}px`;
  }
}

async function main() {
  await Promise.all([loadCave(), preloadAvatars(app)]);
  if (flag("gearwait", true)) {
    const gearOk = await preloadGear(app);
    if (!gearOk) reportError("rank gear failed to load");
  }
  setupBots();
  if (flag("batch", false)) for (const b of bots) batchLikeGame(b.a);
  if (q.get("fade") !== null) {
    const o = Math.max(0, Math.min(1, num("fade", 1)));
    const fi = Math.max(0, Math.min(bots.length - 1, Math.round(num("follow", 0))));
    bots.forEach((b, i) => {
      if (lineup || i === fi) fadeLikeGame(b.a, o);
    });
  }
  const churn = runChurn(Math.round(num("churn", 0)));
  if (q.get("late") !== null) looksAt = Math.max(0, num("late", 0));
  else applyLooks();
  if (flag("tags", true))
    bots.forEach((b, i) => {
      const d = document.createElement("div");
      d.className = "tag";
      const look = [rankOf(i) > 1 ? `r${rankOf(i)}` : "", (cosmeticOf(i) ?? "").replace(/^cave-/, "")].filter(Boolean).join(" ");
      d.textContent = `${i} ${b.variant.replace(/^tl_char_(fan_)?|_v01$/g, "")}${look ? ` · ${look}` : ""}`;
      tagsEl.appendChild(d);
      b.tag = d;
    });

  if (lineup) {
    placeLineupCamera();
    aim(key, num("yaw", 180) + 180 + 35, 42);
  } else {
    followed = bots[Math.max(0, Math.min(bots.length - 1, Math.round(num("follow", 0))))];
    const wall = followed.kind === "wall";
    follow = createFollowCamera(camera, {
      yaw: num("yaw", wall ? followed.yaw : 180),
      pitch: num("pitch", 18),
      distance: num("dist", 5.5),
      shoulder: num("shoulder", 0.45),
    });
    follow.snapBehind(follow.yaw);
    follow.attach(canvas);
    const lab = { camera: follow as FollowCamera | null, clicks: 0, uiClicks: 0 };
    window.__lab = lab;
    canvas.addEventListener("click", () => lab.clicks++);
    if (flag("ui", false)) {
      const btn = document.createElement("button");
      btn.id = "testbtn";
      btn.textContent = "UI button";
      btn.style.cssText = "position:fixed;left:20px;top:300px;width:140px;height:44px;z-index:5";
      btn.addEventListener("click", () => lab.uiClicks++);
      document.body.appendChild(btn);
    }
    aim(key, 35, 55);
    if (doProbe)
      probe.tracks = ["leg_lower_l", "leg_lower_r"].map((n) => ({
        node: followed!.a.entity.findByName(n)!,
        down: false,
        corner: 0,
        ax: 0,
        az: 0,
        maxSlip: 0,
      }));
  }

  // optional micro-benchmark of avatar updates alone
  const benchFrames = Math.round(num("bench", 0));
  let bench: { frames: number; msPerFrame: number; usPerAvatar: number } | null = null;
  if (benchFrames > 0) {
    const t0 = performance.now();
    for (let f = 0; f < benchFrames; f++) for (const b of bots) b.a.update(1 / 60, b.speed);
    const ms = (performance.now() - t0) / benchFrames;
    bench = {
      frames: benchFrames,
      msPerFrame: +ms.toFixed(4),
      usPerAvatar: +((ms * 1000) / bots.length).toFixed(2),
    };
  }

  // filmstrip: with seed=<n> every copy starts identical; avatar i runs i * stagger seconds ahead
  const stagger = num("stagger", 0);
  if (stagger > 0)
    bots.forEach((b, i) => {
      for (let s = Math.round((i * stagger) / (1 / 240)); s > 0; s--) b.a.update(1 / 240, b.speed);
    });

  // deterministic freeze: simulate t seconds at 60 Hz, then stop the clock
  const freezeAt = q.get("t") !== null ? Math.max(0, num("t", 0)) : -1;
  if (freezeAt >= 0) {
    const n = Math.round(freezeAt * 60);
    for (let i = 0; i < n; i++) step(1 / 60);
    step(0);
  }

  const showStats = flag("stats", false);
  let frames = 0;
  let hudT = 0;
  let sumUpd = 0,
    nUpd = 0;
  app.on("update", (dt: number) => {
    step(freezeAt >= 0 ? 0 : dt);
    frameAvg += (dt - frameAvg) * 0.05;
    updAvg += (updMs - updAvg) * 0.05;
    sumUpd += updMs;
    nUpd++;
    drawTags();
    hudT -= dt;
    if (showStats && hudT <= 0) {
      hudT = 0.25;
      const s = app.stats;
      hudEl.textContent =
        `${bots.length} avatars · ${s.frame.fps} fps · frame ${(frameAvg * 1000).toFixed(1)} ms\n` +
        `draw calls ${s.drawCalls.total} · avatar update ${updAvg.toFixed(3)} ms ` +
        `(${((updAvg * 1000) / bots.length).toFixed(1)} µs each)` +
        (follow
          ? `\ncam yaw ${follow.yaw.toFixed(0)} pitch ${follow.pitch.toFixed(0)} boom ${follow.boom.toFixed(2)} m`
          : "");
    }
    if (++frames === 10) {
      const p = camera.getPosition();
      window.__info = {
        avatars: bots.length,
        view: lineup ? "lineup" : followed?.kind === "wall" ? "wall" : "follow",
        updateMsAvg: +(sumUpd / Math.max(1, nUpd)).toFixed(4),
        bench,
        churn: churn ? { ...churn, ...churnCheck() } : null,
        drawCalls: app.stats.drawCalls.total,
        camera: {
          pos: [p.x, p.y, p.z].map((v) => +v.toFixed(3)),
          radius: +Math.hypot(p.x, p.z).toFixed(3),
          boom: follow ? +follow.boom.toFixed(3) : null,
          yaw: follow ? +follow.yaw.toFixed(2) : num("yaw", 180),
        },
        followed: followed
          ? { x: +followed.x.toFixed(3), z: +followed.z.toFixed(3), yaw: +followed.yaw.toFixed(1) }
          : null,
        headTop: bots[0]
          ? [bots[0].a.headTop.x, bots[0].a.headTop.y, bots[0].a.headTop.z].map((v) => +v.toFixed(3))
          : null,
        probe: doProbe
          ? { minFootY: +probe.minY.toFixed(4), maxSlip: +probe.maxSlip.toFixed(4), contacts: probe.contacts }
          : null,
      };
      window.__ready = true;
      document.title = "READY";
    }
  });
  if (!showStats) hudEl.style.display = "none";
}

main().catch((err) => {
  reportError(`lab failed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  window.__ready = true;
  document.title = "READY";
});
