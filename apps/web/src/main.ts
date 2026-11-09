import * as pc from 'playcanvas';
import { Client, Predict, type InputHandle, type Room } from '@colyseus/sdk';
import { applyInput, AXIS_MAX, CLOSE_SIGNED_IN_ELSEWHERE, MoveInput } from '@te-liet/shared';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const app = new pc.Application(canvas);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();
window.addEventListener('resize', () => app.resizeCanvas());
app.scene.ambientLight = new pc.Color(0.25, 0.25, 0.32);

const camera = new pc.Entity();
camera.addComponent('camera', { clearColor: new pc.Color(0.035, 0.045, 0.065) });
camera.setPosition(22, 25, 28);
camera.lookAt(0, 0, 0);
app.root.addChild(camera);
const light = new pc.Entity();
light.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.78, 0.55), intensity: 1.4 });
light.setEulerAngles(45, 25, 0);
app.root.addChild(light);

function shape(type: 'box' | 'cone' | 'capsule', color: number[], x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const e = new pc.Entity();
  e.addComponent('render', { type });
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...color);
  m.update();
  e.render!.meshInstances.forEach((i) => (i.material = m));
  e.setPosition(x, y, z);
  e.setLocalScale(sx, sy, sz);
  app.root.addChild(e);
  return e;
}
shape('box', [0.15, 0.19, 0.21], 0, -0.6, 0, 30, 1, 30);
for (let i = 0; i < 18; i++) {
  const a = (i / 18) * Math.PI * 2;
  shape('box', [0.21, 0.24, 0.29], Math.cos(a) * 16, 1, Math.sin(a) * 16, 3, 3 + (i % 3), 3);
}
shape('cone', [1, 0.36, 0.12], 0, 0.6, 0, 1.5, 2, 1.5);

const status = document.querySelector('#status')!;
function log(text: string) {
  const p = document.createElement('p');
  p.textContent = text;
  const box = document.querySelector('#log')!;
  box.append(p);
  while (box.children.length > 40) box.firstChild?.remove();
  box.scrollTop = box.scrollHeight;
}

const keys = new Set<string>();
window.addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLInputElement)) keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
const held = (...names: string[]) => names.some((n) => keys.has(n));
function axes() {
  const right = Number(held('d', 'arrowright')) - Number(held('a', 'arrowleft'));
  const back = Number(held('s', 'arrowdown')) - Number(held('w', 'arrowup'));
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
function clearAvatars() { for (const e of avatars.values()) e.destroy(); avatars.clear(); }

app.on('update', () => {
  if (!session) return;
  const { room, predict, input } = session;
  const players = room.state?.players;
  if (!players) return;

  // Nhân vật của mình: dự đoán ngay bằng cùng applyInput() với server, rồi đối chiếu khi server xác nhận.
  const self = players.get(room.sessionId);
  if (self && !session.reconciled) {
    predict.reconciler(self, { input, fields: ['x', 'z'], smoothMs: 65, step: (ctx, s, cmd) => applyInput(s, cmd, ctx.dt) });
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
      e = shape('capsule', id === room.sessionId ? [0.4, 0.85, 0.75] : [0.75, 0.6, 0.95], p.x, 1, p.z);
      avatars.set(id, e);
    }
    e.setPosition(predict.value(p, 'x'), 1, predict.value(p, 'z'));
  });
  for (const [id, e] of avatars) if (!seen.has(id)) { e.destroy(); avatars.delete(id); }
});

const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/v1/guest' : '/v1/guest');
const gameUrl = import.meta.env.VITE_GAME_URL
  || (import.meta.env.DEV ? 'ws://localhost:2567' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

document.querySelector('#join')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (session) return;
  const button = document.querySelector<HTMLButtonElement>('#join button')!;
  button.disabled = true;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: document.querySelector<HTMLInputElement>('#name')!.value }),
    });
    if (!res.ok) throw new Error('Không thể đăng nhập');
    const { ticket } = await res.json();
    const room = await new Client(gameUrl).joinOrCreate('hub_v1', { ticket });
    const input = room.input({ type: MoveInput });
    if (input.tickRate === undefined) throw new Error('Server chưa khai báo nhịp mô phỏng cố định');
    const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
    predict.attachAll('players', { x: 'lerp', z: 'lerp' });
    session = { room, predict, input, reconciled: false, idleSteps: 0 };
    status.textContent = 'Đã vào hang · ' + room.roomId;

    room.onMessage('chat', (m: any) => log(m.name + ': ' + m.text));
    room.onMessage('emote', (m: any) => log('👋 ' + (room.state.players.get(m.id)?.name || 'Bạn trong hang') + ' · ' + m.emote));
    room.onLeave((code: number) => {
      predict.dispose();
      session = undefined;
      clearAvatars();
      button.disabled = false;
      status.textContent = code === CLOSE_SIGNED_IN_ELSEWHERE
        ? 'Bạn vừa vào hang ở tab hoặc máy khác, phiên này đã đóng.'
        : 'Đã rời hang. Bấm Vào hang để kết nối lại.';
    });
  } catch (err) {
    status.textContent = String(err);
    button.disabled = false;
  }
});

document.querySelector('#chat')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.querySelector<HTMLInputElement>('#message')!;
  if (session && input.value.trim()) session.room.send('chat', input.value);
  input.value = '';
});
document.querySelector('#wave')!.addEventListener('click', () => session?.room.send('emote', 'wave'));
