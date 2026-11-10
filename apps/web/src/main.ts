/**
 * Tê Liệt — client game: hang (scene.ts), fan có animation (avatar.ts), camera bám theo
 * (camera.ts), bảng tên (nametags.ts) và lớp React (ui.tsx) trên một room Colyseus.
 *
 * Mỗi khung hình: input/dự đoán → vị trí + hướng avatar → avatar.update → camera.update → trạng
 * thái UI; bảng tên đặt ở "postrender" để khớp đúng ma trận camera của khung hình vừa vẽ.
 * Mạng giữ nguyên như trước: tự dự đoán bằng applyInput() dùng chung với server, đối chiếu khi
 * server xác nhận, gửi thưa khi đứng yên, xử lý onLeave và CLOSE_SIGNED_IN_ELSEWHERE.
 *
 * Tham số URL chỉ cho bản dev (import.meta.env.DEV; bản build bỏ qua):
 *   ?view=<preset>          không vào hang, đặt camera theo preset của world (concept, spawn,
 *                           campfire, memory, tv, rest, living, quiz, exit, overview)
 *   ?autojoin=<tên>         tự vào hang; &yaw=&pitch=&dist= cho camera bám theo
 *   ?stats=1                fps, ms/khung, draw call, tam giác
 *   ?batch=0                tắt gom batch avatar (so sánh)
 * window.__ready = true (title READY) khi: ?view → world xong + 10 khung; ?autojoin → đã vào,
 * avatar của mình đã có, mô hình đã tải + 20 khung. Lỗi đẩy vào window.__errors.
 * window.__game (chỉ dev) cho test headless: snapshot(), follow, world.
 */
import * as pc from "playcanvas";
import { Client, Predict, type InputHandle, type Room } from "@colyseus/sdk";
import {
  applyInput,
  CLOSE_SIGNED_IN_ELSEWHERE,
  Emote,
  LIMITS,
  MoveInput,
} from "@te-liet/shared";
import { SHRINE_CENTER, SHRINE_SEATS, SHRINE_RADIUS, applyShrineAwareInput, isInShrine } from "../../../packages/shared/src/shrine.js";
import "./style.css";
import { resident } from "./stalls/client.js";
import { CAVE_STALL_RADIUS } from "../../../packages/shared/src/stalls.js";
import { STALL_CAMERA_BLOCKERS } from "./world/stalls.js";
import { requestedRoom, roomInviteUrl } from "./roomInvite.js";
import {
  AVATAR_VARIANTS,
  createAvatar,
  preloadAvatars,
  variantFor,
  type Avatar,
  type AvatarEmote,
} from "./avatar.js";
import { cameraBlockers } from "./blockers.js";
import { createFollowCamera } from "./camera.js";
import { chatBucket } from "./chatLimit.js";
import { CAVE_BOUNDS, DEG, fitFov, type Blocker } from "./cameraMath.js";
import { GLOW_MATERIAL_PREFIX } from "./models.js";
import { createNameTags } from "./nametags.js";
import { createNearFlames } from "./nearFlames.js";
import { createWorld, landmarks } from "./scene.js";
import { CONTROLS_HELP, focusChat, mountUI, rememberInvite, touch, ui } from "./ui.js";
import { SHRINE_CAMERA_BLOCKERS } from "./world/shrine.js";
import { loadManifests } from "./world/manifest.js";

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
    __info?: unknown;
    __game?: unknown;
  }
}

const errors: string[] = (window.__errors ??= []);
function report(msg: string) {
  console.error(`[game] ${msg}`);
  if (errors.length < 100) errors.push(msg);
}
const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
window.addEventListener("error", (e) => report(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) =>
  report(`unhandled: ${describe(e.reason)}`),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Tham số dev (bản build: luôn null).
const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const devNum = (k: string) => {
  const v = dev?.get(k);
  const n = v === null || v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const devView = dev?.get("view") || null;
const autojoin = devView ? null : dev?.get("autojoin")?.trim() || null;

/* ------------------------------------------------------------------ cảnh */

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { antialias: true, alpha: false },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();
window.addEventListener("resize", () => app.resizeCanvas());

const world = createWorld(app);
const camera = world.camera;
/** Đồ cao (đuốc, bảng, đá, cột bạt) và thân NPC: camera không được nằm bên trong. Điền khi manifest đã tải. */
const blockers: Blocker[] = [...STALL_CAMERA_BLOCKERS, ...SHRINE_CAMERA_BLOCKERS];
const follow = createFollowCamera(camera, {
  bounds: { ...CAVE_BOUNDS, blockers },
});
/** Đuốc sát camera: ngọn lửa thụt xuống thay vì che kín khung hình. */
const flames = createNearFlames();
const tags = createNameTags(document.querySelector<HTMLElement>("#tags")!);
const log = ui.log;
const mutedSenders = new Set<string>();
/** Góc nhìn dọc của camera bám theo (độ) trên màn hình ngang; màn dọc được nới cho đủ bề ngang. */
const FOLLOW_FOV = 50;
const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);
/** Đặt góc nhìn dọc, chỉ khi đổi (tránh dựng lại ma trận chiếu mỗi khung). */
function setFov(fov: number) {
  const c = camera.camera!;
  if (Math.abs(c.fov - fov) > 0.01) c.fov = fov;
}

const LOADING = "Đang dựng hang…";
const IDLE = "Trong hang vẫn còn chỗ cho bạn.";
const AVATARS_FAILED =
  "Không tải được nhân vật. Tải lại trang để thử lại (vẫn đi lại và chat được).";
let worldReady = false;
let assetsReady = false;
/** Không tải được bộ đồ nào sau 3 lần: chơi tiếp không có avatar (bảng tên vẫn hiện). */
let avatarsFailed = false;
ui.set({ status: LOADING });
void world.ready.then(async () => {
  worldReady = true;
  flames.scan(app.root);
  const index = await loadManifests(
    ["environment", "fire", "furniture", "props"],
    report,
  );
  blockers.push(...cameraBlockers(index));
});
/**
 * Tải nhân vật: chưa có bộ đồ nào thì thử lại tối đa 3 lần. Thiếu vài bộ vẫn chơi được (createAvatar
 * dùng tạm bộ khác) và tải bù phần thiếu sau vài giây.
 */
async function loadAvatars() {
  for (let attempt = 1; ; attempt++) {
    try {
      const missing = await preloadAvatars(app);
      if (missing.length) retryMissingAvatars(missing, 1);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1500 * attempt);
    }
  }
}
function retryMissingAvatars(missing: string[], attempt: number) {
  report(`avatars: chưa tải được ${missing.join(", ")}; tạm dùng bộ đồ khác`);
  if (attempt > 2) return;
  void sleep(3000 * attempt)
    .then(() => preloadAvatars(app))
    .then(
      (left) => {
        if (left.length) retryMissingAvatars(left, attempt + 1);
      },
      () => {},
    );
}
Promise.all([world.ready, loadAvatars()]).then(
  () => {
    assetsReady = true;
    if (ui.get().status === LOADING) ui.set({ status: IDLE });
  },
  (err: unknown) => {
    avatarsFailed = true;
    report(`avatars: ${describe(err)}`);
    ui.set({ status: AVATARS_FAILED });
  },
);

// Trước khi vào hang: khung hình concept 01, trôi rất chậm.
if (devView && !world.setView(devView))
  report(`unknown view "${devView}" (${Object.keys(world.views).join(", ")})`);
const concept = world.views.concept;
/**
 * Màn ngang, trước khi vào hang: thẻ chào che ~30 % bên trái, nên khung concept lùi ra sau
 * WELCOME_BACK m và quay ngang cho lửa trại nằm ở NDC x = WELCOME_FIRE_X (~62 % bề ngang): góc TV
 * lộ ra ngay bên phải thẻ, bạt góc thâm niên vẫn trong khung.
 */
const WELCOME_FIRE_X = 0.24;
const WELCOME_BACK = 1.5;
let driftT = 0;
function drift(dt: number) {
  driftT += dt;
  const t = driftT,
    [px0, py0, pz0] = concept.pos,
    [lx0, ly0, lz0] = concept.look;
  let px = px0 + 0.5 * Math.sin(t * 0.09),
    pz = pz0 + 0.3 * Math.sin(t * 0.07 + 2.1);
  const py = py0 + 0.1 * Math.sin(t * 0.13 + 1.1);
  const ar = aspect();
  const fov = fitFov(concept.fov ?? 64, ar);
  setFov(fov);
  let lx = lx0 + 0.9 * Math.sin(t * 0.05),
    lz = lz0;
  if (!session && ar > 1.2 && window.innerWidth > 700) {
    const dx = lx0 - px0,
      dz = lz0 - pz0;
    const len = Math.sqrt(dx * dx + dz * dz);
    px -= (dx / len) * WELCOME_BACK;
    pz -= (dz / len) * WELCOME_BACK;
    const yaw =
      Math.atan2(-px, -pz) +
      Math.atan(WELCOME_FIRE_X * Math.tan((fov * DEG) / 2) * ar) +
      0.05 * Math.sin(t * 0.05);
    lx = px + Math.sin(yaw) * len;
    lz = pz + Math.cos(yaw) * len;
  }
  camera.setPosition(px, py, pz);
  camera.lookAt(lx, ly0 + 0.12 * Math.sin(t * 0.08), lz);
}

/* ------------------------------------------------------------------ bàn phím */

const keys = new Set<string>();
/** Phím di chuyển theo vị trí vật lý (e.code), dự phòng theo e.key. */
const MOVE_CODES: Record<string, string> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
};
const MOVE_NAMES = new Set(Object.values(MOVE_CODES));
const EMOTE_CODES: Record<string, AvatarEmote> = {
  Digit1: "wave",
  Numpad1: "wave",
  Digit2: "laugh",
  Numpad2: "laugh",
  Digit3: "cheer",
  Numpad3: "cheer",
};
const EMOTE_KEYS: Record<string, AvatarEmote> = {
  "1": "wave",
  "2": "laugh",
  "3": "cheer",
};
function moveKey(e: KeyboardEvent): string | undefined {
  const k = e.key.toLowerCase();
  return MOVE_CODES[e.code] ?? (MOVE_NAMES.has(k) ? k : undefined);
}
const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable);

window.addEventListener("keydown", (e) => {
  if (typing(e.target)) return; // ô chat tự xử lý Enter (gửi) và Escape (thoát ra)
  if (e.key === "Escape") {
    ui.set({ panel: null });
    keys.clear();
    return;
  }
  if (ui.get().panel) return;
  // Nút đang focus giữ Enter / Space; Cmd/Ctrl/Alt là phím tắt trình duyệt (macOS không gửi keyup).
  if (
    e.target instanceof HTMLButtonElement &&
    (e.key === "Enter" || e.key === " ")
  )
    return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter") {
    // Enter → gõ chat → Enter gửi và quay lại đi lại. preventDefault: keypress của chính phím
    // Enter này không được rơi vào ô chat vừa focus (sẽ gửi form rỗng).
    if (!e.repeat && session && focusChat()) {
      e.preventDefault();
      keys.clear();
    }
    return;
  }
  if (e.code === "KeyE" || e.key.toLowerCase() === "e") {
    if (!e.repeat) interact();
    return;
  }
  const emote = EMOTE_CODES[e.code] ?? EMOTE_KEYS[e.key];
  if (emote) {
    if (!e.repeat) sendEmote(emote);
    return;
  }
  const k = moveKey(e);
  if (!k) return;
  if (k.startsWith("arrow")) e.preventDefault();
  keys.add(k);
});
window.addEventListener("keyup", (e) => {
  const k = moveKey(e);
  if (k) keys.delete(k);
});
window.addEventListener("blur", () => keys.clear());
// Bắt đầu gõ chat: nhân vật dừng (keyup của phím đang giữ có thể không tới).
window.addEventListener("focusin", (e) => {
  if (typing(e.target)) keys.clear();
});
const held = (...names: string[]) => names.some((n) => keys.has(n));

const STILL = { moveX: 0, moveZ: 0 } as const;
/** Trục input theo hướng camera (int8, đúng giá trị gửi lên và dùng để dự đoán). */
function axes(s: Session): { moveX: number; moveZ: number } {
  if (ui.get().panel || s.dropped || playersOf(s.room)?.get(s.room.sessionId)?.shrineSeat) return STILL;
  const right =
    Number(held("d", "arrowright")) - Number(held("a", "arrowleft"));
  const forward = Number(held("w", "arrowup")) - Number(held("s", "arrowdown"));
  return right || forward ? follow.toWorldAxes(right, forward) : STILL;
}

/* ------------------------------------------------------------------ người chơi */

/**
 * Phần state của room mà client đọc (schema HubState của apps/game). Client không có class schema
 * nên SDK để state là any; mọi chỗ đọc đi qua playersOf() để được kiểm kiểu.
 */
interface PlayerState {
  name: string;
  x: number;
  z: number;
  connected: boolean;
  shrineSeat: string; shrineGesture: string; shrineGestureAt: number;
}
interface HubState {
  players: {
    get(id: string): PlayerState | undefined;
    forEach(cb: (p: PlayerState, id: string) => void): void;
  };
}
const playersOf = (room: Room) => (room.state as HubState | undefined)?.players;

type Session = {
  room: Room;
  predict: Predict;
  input: InputHandle<MoveInput>;
  reconciled: boolean;
  controller?: { reset(): void };
  shrinePose?: string;
  idleSteps: number;
  /** Mất kết nối, SDK đang tự nối lại: không gửi di chuyển. */
  dropped: boolean;
};
let session: Session | undefined;
let shrineClockOffset = 0;
let shrineUiAt = 0;

interface Fan {
  readonly self: boolean;
  avatar: Avatar | null;
  /** createAvatar đã lỗi một lần: không thử lại mỗi khung. */
  failed: boolean;
  name: string;
  away: boolean;
  /** Vị trí đang hiển thị (dự đoán hoặc nội suy). */
  x: number;
  z: number;
  /** Hướng hiện tại và hướng muốn quay tới (radian; mặt model là (sin, cos)). */
  yaw: number;
  wantYaw: number;
  /** Tốc độ ngang đã lọc (m/s). */
  speed: number;
  /** Avatar của mình mờ hẳn (camera bị ép sát đầu): không vẽ, không đặt bảng tên. */
  hidden: boolean;
}
const fans = new Map<string, Fan>();

/** Quay tối đa (rad/s) theo cung ngắn nhất. */
const TURN_RATE = 12;
/** Dưới tốc độ này (m/s) coi như đứng: giữ hướng cũ. */
const FACE_SPEED = 0.35;
/** Hằng thời gian lọc tốc độ (s): avatar mình dùng vị trí dự đoán (mượt), người khác dùng nội suy. */
const SPEED_TAU_SELF = 0.05;
const SPEED_TAU_REMOTE = 0.12;
/** Nhảy xa hơn thế trong một khung là dịch chuyển (nối lại, xuất hiện lại): không đi bộ. */
const TELEPORT = 2.5;
/** Avatar của mình mờ dần (dither) khi cần camera ngắn hơn SELF_FADE_FROM, mất hẳn ở SELF_FADE_TO (m). */
const SELF_FADE_FROM = 1.8;
const SELF_FADE_TO = 1.0;
/** Bảng tên khi không có avatar (không tải được nhân vật): độ cao trên chân (m). */
const TAG_HEIGHT = 2;
/** Đứng yên gần điểm tương tác lâu chừng này (s) thì camera lùi sang vai để nhìn rõ đồ vật. */
const FOCUS_AFTER = 0.4;

const wrapPi = (a: number) => {
  const w = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return w - Math.PI;
};
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Avatar người khác vào chung một nhóm batch động (các khớp vẫn là node sống, như NPC của world) và
 * dùng chung vật liệu tl_matte / tl_cloth (mọi GLB giống hệt nhau): mỗi vật liệu một draw call cho cả
 * hang thay vì 12 phần × mỗi người, kể cả lượt vẽ bóng. Batch chỉ dựng lại khi có người vào / ra.
 * Avatar của mình ở nhóm riêng với bản sao vật liệu có dither (cả bóng) để mờ dần sát vách mà không
 * đụng tới batch chung. Batch động tự nhân bản vật liệu lúc dựng, nên khi đang mờ avatar mình tạm ra
 * khỏi nhóm (vẽ từng phần bằng vật liệu dither) và vào lại khi rõ hẳn: mỗi lần chỉ dựng lại batch
 * 12 phần của riêng nó. Tắt gom batch bằng ?batch=0 (dev) để so sánh.
 */
const AVATAR_BATCH = "tl_avatars";
const SELF_BATCH = "tl_avatar_self";
const avatarBatching = dev?.get("batch") !== "0";
const avatarMaterials = new Map<string, pc.Material>();
const selfMaterials = new Map<string, pc.StandardMaterial>();
let selfOpacity = 1;
/** Avatar của mình đang nằm trong nhóm SELF_BATCH (chỉ khi rõ hẳn). */
let selfBatched = false;
function batchGroup(name: string) {
  return (
    app.batcher.getGroupByName(name) ?? app.batcher.addGroup(name, true, 100)
  );
}
function batchAvatar(a: Avatar) {
  if (!avatarBatching) return;
  const group = batchGroup(AVATAR_BATCH);
  for (const r of a.entity.findComponents("render") as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material;
      if (!m || (m.name !== "tl_matte" && m.name !== "tl_cloth")) continue;
      const shared = avatarMaterials.get(m.name);
      if (shared) mi.material = shared;
      else avatarMaterials.set(m.name, m);
    }
    r.batchGroupId = group.id;
  }
}
/** Avatar của mình: vật liệu riêng (opacity dither, cả bóng), vào nhóm batch riêng khi rõ hẳn. */
function prepareSelf(a: Avatar) {
  for (const r of a.entity.findComponents("render") as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material;
      if (!(m instanceof pc.StandardMaterial)) continue;
      if (m.name.startsWith(GLOW_MATERIAL_PREFIX)) continue;
      let own = selfMaterials.get(m.name);
      if (!own) {
        own = m.clone();
        own.opacityDither = pc.DITHER_BAYER8;
        own.opacityShadowDither = pc.DITHER_BAYER8;
        own.opacity = selfOpacity;
        own.update();
        selfMaterials.set(m.name, own);
      }
      mi.material = own;
    }
  }
  selfBatched = false;
  batchSelf(a, selfOpacity >= 1);
}
function batchSelf(a: Avatar, on: boolean) {
  if (!avatarBatching || on === selfBatched) return;
  selfBatched = on;
  const id = on ? batchGroup(SELF_BATCH).id : -1; // -1: không thuộc nhóm nào
  for (const r of a.entity.findComponents("render") as pc.RenderComponent[])
    r.batchGroupId = id;
}
/** Độ mờ avatar của mình (lượng tử 1/20, chỉ cập nhật vật liệu khi đổi). */
function setSelfOpacity(f: Fan, opacity: number) {
  const q = Math.round(opacity * 20) / 20;
  if (q !== selfOpacity) {
    selfOpacity = q;
    for (const m of selfMaterials.values()) {
      m.opacity = q;
      m.update();
    }
  }
  if (f.avatar) batchSelf(f.avatar, q >= 1);
  const hidden = q <= 0;
  if (hidden !== f.hidden) {
    f.hidden = hidden;
    if (f.avatar) f.avatar.entity.enabled = !hidden;
  }
}

function spawnAvatar(id: string, f: Fan) {
  if (f.avatar || f.failed || !assetsReady) return;
  try {
    const saved = session ? (playersOf(session.room)?.get(id) as { avatarKey?: string } | undefined)?.avatarKey : '';
    f.avatar = createAvatar(app, { variant: saved && AVATAR_VARIANTS.includes(saved) ? saved : variantFor(id) });
    if (f.self) prepareSelf(f.avatar);
    else batchAvatar(f.avatar);
    f.avatar.entity.enabled = !f.hidden;
    if(f.self){const p=resident.get();f.avatar.setProgression(p.visualRank??p.state?.experience.rank.level??1,p.visualItem!==undefined?p.visualItem:p.state?.equippedItemId);}
  } catch (err) {
    f.failed = true;
    report(`avatar ${id}: ${describe(err)}`);
  }
}

function dropFan(id: string) {
  fans.get(id)?.avatar?.destroy();
  fans.delete(id);
  tags.remove(id);
}
function clearFans() {
  for (const id of [...fans.keys()]) dropFan(id);
}

/** Cập nhật một fan từ vị trí hiển thị mới. intent: trục input của mình (quay mặt khi bị chặn). */
function moveFan(
  f: Fan,
  x: number,
  z: number,
  dt: number,
  intent: { moveX: number; moveZ: number } | null,
) {
  const dx = x - f.x,
    dz = z - f.z;
  const d = Math.sqrt(dx * dx + dz * dz); // Math.hypot cấp phát trong V8
  f.x = x;
  f.z = z;
  if (d > TELEPORT) f.speed = 0;
  else if (dt > 0) {
    const v = d / dt;
    const tau = f.self ? SPEED_TAU_SELF : SPEED_TAU_REMOTE;
    f.speed += (v - f.speed) * (1 - Math.exp(-dt / tau));
    if (v > FACE_SPEED) f.wantYaw = Math.atan2(dx, dz);
    else if (intent && (intent.moveX || intent.moveZ))
      f.wantYaw = Math.atan2(intent.moveX, intent.moveZ);
  }
  const turn = wrapPi(f.wantYaw - f.yaw);
  const step = TURN_RATE * dt;
  f.yaw = wrapPi(
    f.yaw + (Math.abs(turn) <= step ? turn : Math.sign(turn) * step),
  );
  const a = f.avatar;
  if (!a) return;
  a.entity.setPosition(x, 0, z);
  a.entity.setEulerAngles(0, (f.yaw * 180) / Math.PI, 0);
  a.update(dt, f.speed);
}

resident.subscribe(()=>{const f=me(),p=resident.get(); if(f?.avatar) f.avatar.setProgression(p.visualRank??p.state?.experience.rank.level??1,p.visualItem!==undefined?p.visualItem:p.state?.equippedItemId);});

/** Điểm tương tác gần nhất trong 3 m. */
function nearestLandmark(x: number, z: number) {
  let best: (typeof landmarks)[number] | null = null,
    bestD2 = 9;
  for (const l of landmarks) {
    const dx = l.x - x,
      dz = l.z - z;
    const d2 = dx * dx + dz * dz;
    const radius = l.id === "altar" || l.id === "rest" ? 3 : CAVE_STALL_RADIUS;
    if (d2 <= radius * radius && d2 < bestD2) {
      best = l;
      bestD2 = d2;
    }
  }
  return best;
}
function me(): Fan | undefined {
  return session ? fans.get(session.room.sessionId) : undefined;
}

function interact() {
  const f = me();
  const near = f ? nearestLandmark(f.x, f.z) : null;
  if (!near) return;
  ui.set({ panel: near.id, destination: null });
  keys.clear();
}

const EMOTE_LINES: Record<AvatarEmote, (who: string) => string> = {
  wave: (who) => `✋ ${who} vẫy tay chào cả hang`,
  laugh: (who) => `😆 ${who} cười trừ cho qua`,
  cheer: (who) => `🙌 ${who} hô to: mùa sau làm lại!`,
};
/** Một người emote liên tục chỉ ghi một dòng chat mỗi ngần này (ms); avatar vẫn diễn mọi lần. */
const EMOTE_LOG_GAP = 8000;
const emoteLogged = new Map<string, number>();
let lastEmoteAt = -Infinity;
function sendEmote(name: AvatarEmote) {
  const s = session;
  if (!s || s.dropped) return;
  // server cho 2 emote/giây; chặn bấm dồn ở client cho khỏi mất lượt
  const now = performance.now();
  if (now - lastEmoteAt < 550) return;
  lastEmoteAt = now;
  s.room.send("emote", name);
}

/**
 * Chat theo đúng giới hạn của server cho khách (LIMITS.chat.guest: 3 tin rồi 1 tin mỗi ~3,3 s).
 * Hết lượt: không gửi, trả về số ms phải chờ; UI giữ nguyên chữ và nhắc nói chậm lại.
 */
const chatLimit = chatBucket(LIMITS.chat.guest);
function sendChat(text: string): number {
  const s = session;
  if (!s) return 0;
  const wait = chatLimit.take(performance.now());
  if (wait > 0) return wait;
  s.room.send("chat", text);
  return 0;
}

/* ------------------------------------------------------------------ vòng lặp */

const target = new pc.Vec3();
const tagAt = new pc.Vec3();
const seen = new Set<string>();
let devFrames = 0;
/** Thời gian (s) avatar mình đã đứng yên liên tục. */
let stillFor = 0;

app.on("update", (dt: number) => {
  devTick();
  const s = session;
  if (!s) {
    if (!devView) drift(dt);
    return;
  }
  const { room, predict, input } = s;
  const players = playersOf(room);
  if (!players) return drift(dt);

  // Nhân vật của mình: dự đoán ngay bằng cùng applyInput() với server, rồi đối chiếu khi server xác nhận.
  const self = players.get(room.sessionId);
  if (self && !s.reconciled) {
    s.controller = predict.reconciler(self, {
      input,
      fields: ["x", "z"],
      smoothMs: 65,
      snap: 2,
      step: (ctx, st, cmd) => { if (!self.shrineSeat) applyShrineAwareInput(st, cmd, ctx.dt); },
    });
    s.reconciled = true;
  }

  if (self && s.controller) {
    const pose = `${isInShrine(self) ? "shrine" : "cave"}:${self.shrineSeat || ""}`;
    if (s.shrinePose !== undefined && s.shrinePose !== pose) {
      s.controller.reset(); keys.clear();
      if (s.shrinePose.split(":")[0] !== pose.split(":")[0]) {
        follow.snapBehind(180); follow.distance = isInShrine(self) ? 7.5 : 5.5; follow.pitch = isInShrine(self) ? 12 : 18;
      }
    }
    s.shrinePose = pose;
  }

  // Gửi trước, đọc sau. Đứng yên thì chỉ gửi 5 bước đuôi và 1 bước mỗi giây (giữ đồng hồ đồng bộ),
  // thay vì 20 input/giây. Trục gửi đi chính là trục reconciler dùng để dự đoán.
  const a = axes(s);
  const moving = a.moveX !== 0 || a.moveZ !== 0;
  const steps = predict.tick(performance.now());
  for (let i = 0; i < steps; i++) {
    s.idleSteps = moving ? 0 : s.idleSteps + 1;
    if (moving || s.idleSteps <= 5 || s.idleSteps % 20 === 0) {
      input.data.moveX = a.moveX;
      input.data.moveZ = a.moveZ;
      input.send();
    }
  }

  // Avatar: vị trí hiển thị (dự đoán cho mình, nội suy cho người khác) → hướng, tốc độ, animation.
  seen.clear();
  players.forEach((p, id) => {
    seen.add(id);
    const px: number = predict.value(p, "x"), pz: number = predict.value(p, "z");
    const x = p.shrineSeat ? p.x : px;
    const z = p.shrineSeat ? p.z : pz;
    let f = fans.get(id);
    if (!f) {
      const face = Math.atan2(-x, -z); // xuất hiện: nhìn về lửa trại
      f = {
        self: id === room.sessionId,
        avatar: null,
        failed: false,
        name: "",
        away: false,
        x,
        z,
        yaw: face,
        wantYaw: face,
        speed: 0,
        hidden: false,
      };
      fans.set(id, f);
    }
    const name = String(p.name || "Người trong hang");
    const away = p.connected === false;
    if (f.name !== name || f.away !== away) {
      f.name = name;
      f.away = away;
      tags.set(id, name, { self: f.self, away });
    }
    spawnAvatar(id, f);
    const shrineSeat = SHRINE_SEATS.find(seat => seat.id === p.shrineSeat);
    if (shrineSeat) f.yaw = f.wantYaw = shrineSeat.yaw * DEG;
    f.avatar?.setShrinePose(!!shrineSeat, p.shrineGesture === "pray" || p.shrineGesture === "bow" ? p.shrineGesture : null, Math.max(0,(Date.now()+shrineClockOffset-p.shrineGestureAt)/1000));
    moveFan(f, x, z, dt, f.self && !shrineSeat ? a : null);
    if (shrineSeat && f.avatar) { f.yaw = f.wantYaw = shrineSeat.yaw * DEG; f.avatar.entity.setEulerAngles(0,shrineSeat.yaw,0); }
    // Separate spaces share a server room, but residents do not float across the void visually.
    if (f.avatar) f.avatar.entity.enabled = !f.hidden && isInShrine(p) === isInShrine(self ?? p);
  });
  for (const id of fans.keys()) if (!seen.has(id)) dropFan(id);
  if (ui.get().count !== seen.size) ui.set({ count: seen.size });

  const mine = fans.get(room.sessionId);
  if (!mine) return drift(dt);
  const near = nearestLandmark(mine.x, mine.z);
  // Đứng yên trước Vách ký ức / TV / góc thâm niên: camera lùi sang vai, nhìn xuống chút để thấy rõ.
  stillFor = mine.speed < 0.15 && !moving ? stillFor + dt : 0;
  follow.focus = !!near && stillFor >= FOCUS_AFTER;
  setFov(fitFov(FOLLOW_FOV, aspect()));
  const inShrine = isInShrine(self ?? mine);
  follow.setBoundsCenter(inShrine ? SHRINE_CENTER.x : 0, 0, inShrine ? 14 : CAVE_BOUNDS.maxRadius);
  follow.update(dt, target.set(mine.x, 0, mine.z));
  if (performance.now() - shrineUiAt > 120 || ui.get().shrineSeat !== (self?.shrineSeat || "")) {
    shrineUiAt = performance.now();
    const nearest = inShrine && !self?.shrineSeat ? SHRINE_SEATS.filter(seat => !ui.get().shrine?.seats.find(s=>s.id===seat.id)?.occupant && Math.hypot(seat.x-mine.x,seat.z-mine.z)<=2).sort((a,b)=>Math.hypot(a.x-mine.x,a.z-mine.z)-Math.hypot(b.x-mine.x,b.z-mine.z))[0] : null;
    ui.set({ position:{x:mine.x,z:mine.z}, shrineSeat:self?.shrineSeat || "", nearbyShrineSeat: nearest ? {id:nearest.id,label:nearest.label} : null });
  }
  flames.update(camera); // sau hiệu ứng lửa của world (handler update của world chạy trước)
  // Camera bị ép sát đầu (lưng sát vách, sát đồ cao): avatar mình mờ dần rồi ẩn hẳn.
  setSelfOpacity(mine, smoothstep(SELF_FADE_TO, SELF_FADE_FROM, follow.boom));

  const prompt = ui.get().prompt;
  if ((prompt?.id ?? null) !== (near?.id ?? null))
    ui.set({ prompt: near ? { id: near.id, name: near.name } : null });
  const status = s.dropped
    ? "Mất kết nối, đang nối lại…"
    : avatarsFailed
      ? AVATARS_FAILED
      : !assetsReady
        ? LOADING
        : near
          ? touch
            ? `Chạm nút sáng để xem ${near.name}`
            : `Nhấn E để xem ${near.name}`
          : CONTROLS_HELP;
  if (ui.get().status !== status) ui.set({ status });
});

// Bảng tên: sau khi vẽ, ma trận camera đúng là của khung hình đang hiện.
app.on("postrender", () => {
  if (!session) return;
  tags.begin(camera);
  for (const [id, f] of fans) {
    if (f.avatar) tags.place(id, f.hidden || !f.avatar.entity.enabled ? null : f.avatar.headTop);
    else if (avatarsFailed) tags.place(id, tagAt.set(f.x, TAG_HEIGHT, f.z));
    else tags.place(id, null);
  }
  tags.end();
});

/* ------------------------------------------------------------------ kết nối */

const apiUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:3000/v1/guest" : "/v1/guest");
const gameUrl =
  import.meta.env.VITE_GAME_URL ||
  (import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

async function join(name: string, invite = "") {
  if (session || ui.get().busy) return;
  ui.set({ busy: true });
  let joined: Room | undefined;
  try {
    const code = invite.trim();
    const res = await fetch(apiUrl, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-T1-Request": "1" },
      body: JSON.stringify(code ? { name, invite: code } : { name }),
    });
    if (res.status === 403) {
      // close test: API đòi mã mời (thiếu hoặc sai) → hiện ô nhập mã
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      ui.set({ needInvite: true });
      if (code) rememberInvite("");
      throw new Error(body?.error || "Cần mã mời để vào hang");
    }
    if (res.status === 429) throw new Error("Đông người vào quá, thử lại sau ít giây nhé.");
    if (!res.ok) throw new Error("Không thể đăng nhập");
    if (code) rememberInvite(code);
    const { ticket } = await res.json();
    const targetRoom = requestedRoom(location.href);
    if (new URL(location.href).searchParams.has("room") && !targetRoom) throw new Error("Link phòng không hợp lệ. Bỏ tham số room để tìm hang mới.");
    const client = new Client(gameUrl);
    let room: Room;
    try {
      room = targetRoom
        ? await client.joinById(targetRoom, { ticket })
        : await client.joinOrCreate("hub_v1", { ticket });
    } catch (error) {
      if (targetRoom) throw new Error("Không vào được phòng được mời: phòng có thể đã đầy hoặc đã đóng. Bỏ link phòng để tìm hang khác.");
      throw error;
    }
    joined = room;
    // Rớt mạng ngay sau khi vào (mặc định SDK: 5 s) vẫn tự nối lại vào đúng chỗ.
    room.reconnection.minUptime = 1000;
    const input = room.input({ type: MoveInput });
    if (input.tickRate === undefined)
      throw new Error("Server chưa khai báo nhịp mô phỏng cố định");
    const predict = Predict.get(room, { mode: "lerp", delay: 100 });
    predict.attachAll("players", { x: "lerp", z: "lerp", snap: 2 });
    const s: Session = {
      room,
      predict,
      input,
      reconciled: false,
      idleSteps: 0,
      dropped: false,
    };
    session = s;
    keys.clear();
    chatLimit.reset();
    mutedSenders.clear();
    ui.set({ messages: [] });
    stillFor = 0;

    // Camera bám theo avatar mình, nhìn về cửa hang (-Z) lúc xuất hiện.
    setFov(fitFov(FOLLOW_FOV, aspect()));
    follow.snapBehind(devNum("yaw") ?? 180);
    const pitch = devNum("pitch"),
      dist = devNum("dist");
    if (pitch !== undefined) follow.pitch = pitch;
    if (dist !== undefined) follow.distance = dist;
    follow.attach(canvas);

    resident.name(name);
    void resident.load(true);
    ui.set({
      connected: true,
      selfId: room.sessionId, altar: null, altarBadge: false, shrine:null, shrineSeat:"",
      busy: false,
      panel: null,
      prompt: null,
      status: assetsReady
        ? CONTROLS_HELP
        : avatarsFailed
          ? AVATARS_FAILED
          : LOADING,
    });

    room.onMessage("shrineState", (value) => {
      shrineClockOffset = value.serverNow - Date.now();
      ui.set({ shrine:value });
    });
    room.send("shrineSync");
    room.onMessage("altarState", (value) => ui.set({ altar: value }));
    room.send("altarSync");
    room.onMessage("altarComplete", () => ui.set({ altarBadge: true }));
    room.onMessage("chat", (m: { id?: string; senderId?: string; name?: string; text: string }) => {
      if (m.senderId && mutedSenders.has(m.senderId)) return;
      log(`${m.name || "Ai đó"}: ${m.text}`, { messageId: m.id, senderId: m.senderId });
    });
    // Thông báo riêng từ server: chat bị chặn (kiểm duyệt, bị mute), kết quả báo cáo…
    room.onMessage("notice", (text: unknown) => {
      if (typeof text === "string") log(`⚠ ${text}`);
    });
    room.onMessage("emote", (m: { id: string; emote: unknown }) => {
      const e = Emote.safeParse(m?.emote);
      if (!e.success) return;
      fans.get(m.id)?.avatar?.emote(e.data);
      // dòng chat: tối đa một dòng mỗi EMOTE_LOG_GAP cho mỗi người (avatar vẫn diễn mọi lần)
      const now = performance.now();
      if (now - (emoteLogged.get(m.id) ?? -Infinity) < EMOTE_LOG_GAP) return;
      emoteLogged.set(m.id, now);
      const who = playersOf(room)?.get(m.id)?.name || "Bạn trong hang";
      log(EMOTE_LINES[e.data](who));
    });
    room.onError((code: number, message?: string) => {
      // mỗi lần thử nối lại thất bại cũng báo lỗi (code undefined): dòng trạng thái đã nói rồi
      if (s.dropped) return;
      report(`room error ${code}: ${message ?? ""}`);
    });
    room.onDrop(() => {
      // SDK gọi lại sau mỗi lần thử nối lại thất bại: chỉ ghi log lần đầu
      if (!s.dropped) console.warn("[game] mất kết nối, đang nối lại…");
      s.dropped = true;
      keys.clear();
    });
    room.onReconnect(() => {
      s.dropped = false;
      room.send("altarSync");
      room.send("shrineSync");
    });
    room.onLeave((code: number) => {
      predict.dispose();
      if (session === s) session = undefined;
      clearFans();
      emoteLogged.clear();
      keys.clear();
      follow.detach();
      follow.focus = false;
      world.setView("concept");
      driftT = 0;
      ui.set({
        connected: false,
        altar: null, altarBadge: false, selfId: "", shrine:null, shrineSeat:"", nearbyShrineSeat:null,
        busy: false,
        count: 0,
        panel: null,
        prompt: null,
        status:
          code === CLOSE_SIGNED_IN_ELSEWHERE
            ? "Bạn vừa vào hang ở tab hoặc máy khác, phiên này đã đóng."
            : "Đã rời hang. Bấm Vào hang để kết nối lại.",
      });
    });
  } catch (err) {
    if (session && session.room === joined) {
      // lỗi sau khi đã dựng phiên: dọn như onLeave
      session.predict.dispose();
      session = undefined;
      clearFans();
      follow.detach();
      world.setView("concept");
    }
    if (joined) await joined.leave().catch(() => {});
    ui.set({ connected: false, status: describe(err), busy: false });
    if (autojoin) {
      report(`autojoin failed: ${describe(err)}`);
      window.__ready = true; // render.mjs báo lỗi ngay thay vì chờ hết giờ
    }
  }
}

mountUI({
  join,
  chat: sendChat,
  emote: sendEmote,
  interact,
  visit: (id) => {
    const landmark = landmarks.find(l => l.id === id); const f=me();
    if (!landmark || !f) return;
    const radius=id==='altar'||id==='rest'?3:CAVE_STALL_RADIUS;
    keys.clear();
    if (Math.hypot(f.x-landmark.x,f.z-landmark.z)<=radius) ui.set({panel:id,destination:null});
    else ui.set({panel:null,destination:id});
  },
  leave: () => {
    keys.clear();
    void session?.room.leave();
  },
  report: (messageId, reason) => session?.room.send("report", { messageId, reason }),
  mute: (senderId) => {
    mutedSenders.add(senderId);
    ui.removeSender(senderId);
    ui.set({ status: "Đã ẩn tin của người này trong phiên hiện tại. Vào lại hang để bỏ ẩn." });
  },
  shrine: (request) => {
    keys.clear(); session?.room.send("shrine", request);
    ui.set({panel:null});
  },
  altar: (action, preset) => {
    keys.clear();
    session?.room.send("altar", { action, ...(preset ? { preset } : {}) });
  },
  copyInvite: async () => {
    if (!session) return;
    const url = roomInviteUrl(location.href, session.room.roomId);
    try { await navigator.clipboard.writeText(url); ui.set({ status: "Đã sao chép link đúng phòng. Người được mời vẫn cần mã vào hang nếu có." }); }
    catch { ui.set({ status: `Link phòng: ${url}` }); }
  },
  move: (key, down) => {
    if (down) keys.add(key);
    else keys.delete(key);
  },
});

let seatPointer: {x:number;y:number;id:number;moved:boolean} | null = null;
canvas.addEventListener("pointerdown", e => {
  seatPointer=e.isPrimary && e.button===0 ? {x:e.clientX,y:e.clientY,id:e.pointerId,moved:false} : null;
});
canvas.addEventListener("pointermove", e => {
  if(seatPointer && (e.pointerId!==seatPointer.id || Math.hypot(e.clientX-seatPointer.x,e.clientY-seatPointer.y)>6)) seatPointer.moved=true;
});
canvas.addEventListener("pointercancel",()=>{seatPointer=null;});
canvas.addEventListener("pointerup", e => {
  const down=seatPointer; seatPointer=null;
  if (!down || down.moved || !e.isPrimary || e.button!==0 || e.pointerId!==down.id || Math.hypot(e.clientX-down.x,e.clientY-down.y)>6 || !session || ui.get().panel || !isInShrine(me() ?? {x:0,z:0})) return;
  const rect=canvas.getBoundingClientRect(); const x=e.clientX-rect.left,y=e.clientY-rect.top;
  const from=camera.camera!.screenToWorld(x,y,0); const to=camera.camera!.screenToWorld(x,y,100);
  const dy=to.y-from.y; if(Math.abs(dy)<1e-6)return;
  const t=(0.48-from.y)/dy; if(t<0||t>1)return;
  const hx=from.x+(to.x-from.x)*t,hz=from.z+(to.z-from.z)*t;
  const seat=SHRINE_SEATS.find(s=>Math.hypot(s.x-hx,s.z-hz)<0.68);
  if(seat){keys.clear();session.room.send("shrine",{action:"sit",seatId:seat.id});}
});

/* ------------------------------------------------------------------ dev */

const r = (v: number, k = 1000) => Math.round(v * k) / k;
/** Trạng thái đọc được cho test headless (window.__game.snapshot()). */
function selfShrineSeat() { return session ? playersOf(session.room)?.get(session.room.sessionId)?.shrineSeat || "" : ""; }
function snapshot() {
  const s = session,
    mine = me(),
    st = app.stats,
    p = camera.getPosition();
  return {
    joined: !!s,
    roomId: s?.room.roomId ?? null,
    sessionId: s?.room.sessionId ?? null,
    assetsReady,
    avatarsFailed,
    me: mine
      ? {
          x: r(mine.x),
          z: r(mine.z),
          yaw: r((mine.yaw * 180) / Math.PI, 10),
          speed: r(mine.speed, 100),
          hidden: mine.hidden,
          opacity: selfOpacity,
          shrineSeat: selfShrineSeat(),
        }
      : null,
    camera: {
      pos: [r(p.x), r(p.y), r(p.z)],
      yaw: r(follow.yaw, 10),
      pitch: r(follow.pitch, 10),
      distance: r(follow.distance, 100),
      boom: r(follow.boom, 100),
      focus: follow.focus,
      fov: r(camera.camera!.fov, 10),
    },
    players: [...fans].map(([id, f]) => ({
      id,
      name: f.name,
      self: f.self,
      x: r(f.x),
      z: r(f.z),
      yaw: r((f.yaw * 180) / Math.PI, 10),
      speed: r(f.speed, 100),
      avatar: !!f.avatar,
    })),
    tags: tags.inspect(),
    ui: {
      status: ui.get().status,
      panel: ui.get().panel,
      prompt: ui.get().prompt?.id ?? null,
      count: ui.get().count,
      messages: ui
        .get()
        .messages.slice(-8)
        .map((m) => m.text),
    },
    stats: {
      fps: st.fps,
      frameMs: r(st.frameTime, 100),
      drawCalls: st.drawCallCount,
      triangles: st.primitiveCount ?? null,
    },
  };
}

function devTick() {
  if (!dev || window.__ready || !(devView || autojoin)) return;
  const ok = devView ? worldReady : assetsReady && !!session && !!me()?.avatar;
  devFrames = ok ? devFrames + 1 : 0;
  if (devFrames < (devView ? 10 : 20)) return;
  window.__info = snapshot();
  window.__ready = true;
  document.title = "READY";
}

if (dev) {
  window.__game = { snapshot, follow, world, app, blockers };
  if (dev.get("stats") === "1") {
    const el = document.createElement("div");
    el.className = "dev-stats";
    document.body.appendChild(el);
    let acc = 0;
    app.on("update", (dt: number) => {
      if ((acc += dt) < 0.5) return;
      acc = 0;
      const st = app.stats;
      el.textContent =
        `${st.fps} fps · ${st.frameTime.toFixed(1)} ms\n` +
        `draw calls ${st.drawCallCount} · tris ${st.primitiveCount ?? "n/a"}\n` +
        `fans ${fans.size}`;
    });
  }
  if (autojoin) void join(autojoin.slice(0, 24));
}
