import * as pc from "playcanvas";
import { Client, Predict, type InputHandle, type Room } from "@colyseus/sdk";
import {
  applyInput,
  AXIS_MAX,
  CLOSE_SIGNED_IN_ELSEWHERE,
  MoveInput,
} from "@te-liet/shared";
import "./style.css";
import { createCave, landmarks } from "./scene.js";
import { mountUI, ui } from "./ui.js";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const app = new pc.Application(canvas);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();
window.addEventListener("resize", () => app.resizeCanvas());
const cave = createCave(app);
const log = ui.log;

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLButtonElement
  )
    return;
  if (e.key === "Escape") {
    ui.set({ panel: null });
    keys.clear();
    return;
  }
  if (ui.get().panel) return;
  if (e.key.toLowerCase() === "e") {
    const p = session?.room.state?.players?.get(session.room.sessionId);
    if (p) {
      const near = landmarks.find((l) => Math.hypot(l.x - p.x, l.z - p.z) < 3);
      if (near) {
        ui.set({ panel: near.id });
        keys.clear();
      }
    }
    return;
  }
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
const held = (...names: string[]) => names.some((n) => keys.has(n));
function axes() {
  if (ui.get().panel) return { moveX: 0, moveZ: 0 };
  const right =
    Number(held("d", "arrowright")) - Number(held("a", "arrowleft"));
  const back = Number(held("s", "arrowdown")) - Number(held("w", "arrowup"));
  return { moveX: right * AXIS_MAX, moveZ: back * AXIS_MAX };
}

type Session = {
  room: Room<any>;
  predict: Predict<any>;
  input: InputHandle<MoveInput>;
  reconciled: boolean;
  idleSteps: number;
};
let session: Session | undefined;
const avatars = new Map<string, pc.Entity>();
function clearAvatars() {
  for (const e of avatars.values()) e.destroy();
  avatars.clear();
}

app.on("update", (dt: number) => {
  if (!session) return;
  const { room, predict, input } = session;
  const players = room.state?.players;
  if (!players) return;

  // Nhân vật của mình: dự đoán ngay bằng cùng applyInput() với server, rồi đối chiếu khi server xác nhận.
  const self = players.get(room.sessionId);
  if (self && !session.reconciled) {
    predict.reconciler(self, {
      input,
      fields: ["x", "z"],
      smoothMs: 65,
      step: (ctx, s, cmd) => applyInput(s, cmd, ctx.dt),
    });
    session.reconciled = true;
  }

  // Gửi trước, đọc sau. Đứng yên thì chỉ gửi 5 bước đuôi và 1 bước mỗi giây (giữ đồng hồ đồng bộ),
  // thay vì 20 input/giây.
  const steps = predict.tick(performance.now());
  for (let i = 0; i < steps; i++) {
    const a = axes();
    const moving = a.moveX !== 0 || a.moveZ !== 0;
    session.idleSteps = moving ? 0 : session.idleSteps + 1;
    if (moving || session.idleSteps <= 5 || session.idleSteps % 20 === 0) {
      input.data.moveX = a.moveX;
      input.data.moveZ = a.moveZ;
      input.send();
    }
  }

  const seen = new Set<string>();
  players.forEach((p: any, id: string) => {
    seen.add(id);
    let e = avatars.get(id);
    if (!e) {
      e = cave.avatar(id === room.sessionId);
      avatars.set(id, e);
    }
    const x = predict.value(p, "x"),
      z = predict.value(p, "z");
    const old = e.getPosition();
    const dx = x - old.x,
      dz = z - old.z;
    if (Math.hypot(dx, dz) > 0.005)
      e.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
    e.setPosition(x, 0, z);
  });
  for (const [id, e] of avatars)
    if (!seen.has(id)) {
      e.destroy();
      avatars.delete(id);
    }
  if (ui.get().count !== seen.size) ui.set({ count: seen.size });
  if (self) {
    const target = avatars.get(room.sessionId)?.getPosition();
    if (target) {
      const pos = cave.camera.getPosition();
      const alpha = 1 - Math.exp(-3 * dt);
      cave.camera.setPosition(
        pc.math.lerp(pos.x, target.x, alpha),
        pc.math.lerp(pos.y, 6.5, alpha),
        pc.math.lerp(pos.z, target.z + 9, alpha),
      );
      cave.camera.lookAt(target.x, 1, target.z - 2);
      const near = landmarks.find(
        (l) => Math.hypot(l.x - target.x, l.z - target.z) < 3,
      );
      const msg = near
        ? `E · ${near.name}`
        : "WASD / mũi tên · E tương tác khi ở gần";
      if (ui.get().status !== msg) ui.set({ status: msg });
    }
  }
});

const apiUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:3000/v1/guest" : "/v1/guest");
const gameUrl =
  import.meta.env.VITE_GAME_URL ||
  (import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

async function join(name: string) {
  if (session || ui.get().busy) return;
  ui.set({ busy: true });
  let joined: Room<any> | undefined;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name }),
    });
    if (!res.ok) throw new Error("Không thể đăng nhập");
    const { ticket } = await res.json();
    const room = await new Client(gameUrl).joinOrCreate("hub_v1", { ticket });
    joined = room;
    const input = room.input({ type: MoveInput });
    if (input.tickRate === undefined)
      throw new Error("Server chưa khai báo nhịp mô phỏng cố định");
    const predict = Predict.get(room, { mode: "lerp", delay: 100 });
    predict.attachAll("players", { x: "lerp", z: "lerp" });
    session = { room, predict, input, reconciled: false, idleSteps: 0 };
    ui.set({
      connected: true,
      busy: false,
      status: "Đã vào hang · " + room.roomId,
    });

    room.onMessage("chat", (m: any) => log(m.name + ": " + m.text));
    room.onMessage("emote", (m: { id: string; emote: string }) => {
      log(
        "👋 " +
          (room.state.players.get(m.id)?.name || "Bạn trong hang") +
          " chào cả hang",
      );
      const arm = avatars.get(m.id)?.findByName("right-arm");
      if (arm) {
        arm.setLocalEulerAngles(0, 0, -130);
        setTimeout(() => {
          if (arm.parent) arm.setLocalEulerAngles(0, 0, 0);
        }, 1400);
      }
    });
    room.onLeave((code: number) => {
      predict.dispose();
      session = undefined;
      clearAvatars();
      ui.set({
        connected: false,
        busy: false,
        count: 0,
        status:
          code === CLOSE_SIGNED_IN_ELSEWHERE
            ? "Bạn vừa vào hang ở tab hoặc máy khác, phiên này đã đóng."
            : "Đã rời hang. Bấm Vào hang để kết nối lại.",
      });
    });
  } catch (err) {
    if (joined) await joined.leave().catch(() => {});
    ui.set({ status: String(err), busy: false });
  }
}
mountUI({
  join,
  chat: (text) => session?.room.send("chat", text),
  emote: () => session?.room.send("emote", "wave"),
  leave: () => {
    keys.clear();
    void session?.room.leave();
  },
  move: (key, down) => {
    if (down) keys.add(key);
    else keys.delete(key);
  },
});
