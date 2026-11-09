import { Room, type Client } from '@colyseus/core';
import type { Deferred } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  AXIS_MAX, applyInput, Chat, CLOSE_SIGNED_IN_ELSEWHERE, Emote, LIMITS, MoveInput,
  PATCH_MS, ROOM_CAPACITY, spawnPoint, TICK_RATE,
} from '@te-liet/shared';
import type { TicketIdentity } from '@te-liet/auth';
import { verifyTicket } from './auth.js';
import { RateLimiter } from './rateLimit.js';
import { log, metrics } from './telemetry.js';

export const Player = schema({
  name: t.string().default(''),
  x: t.float32().default(0),
  z: t.float32().default(0),
  connected: t.boolean().default(true),
});
export type Player = SchemaType<typeof Player>;
export const HubState = schema({ players: t.map(Player) });
export type HubState = SchemaType<typeof HubState>;

const RECONNECT_SECONDS = 15;
const identity = (c: Client) => c.auth as TicketIdentity | undefined;

export class HubRoom extends Room<{ state: HubState; input: MoveInput }> {
  maxClients = ROOM_CAPACITY;

  /** Input theo từng client, đệm sẵn; sanitize kẹp trục về miền hợp lệ (kể cả NaN). */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 32,
    sanitize: { moveX: [-AXIS_MAX, AXIS_MAX], moveZ: [-AXIS_MAX, AXIS_MAX] },
  });

  private limiter = new RateLimiter();
  private seatListeners = new Map<string, (sessionId: string) => void>();
  private reconnecting = new Map<string, Deferred<Client>>();
  /** Phiên bị đóng vì tài khoản đã vào ở nơi khác: không giữ ghế chờ kết nối lại. */
  private replaced = new Set<string>();

  onCreate() {
    this.setState(new HubState());
    this.setPatchRate(PATCH_MS);
    // Mỗi bước áp đúng một input của mỗi người chơi; client dự đoán bằng cùng applyInput().
    this.setFixedTimestep((ctx) => {
      const done = metrics.startTick();
      for (const [sessionId, player] of this.state.players) {
        const cmd = this.inputs.get(sessionId).next();
        if (cmd) applyInput(player, cmd, ctx.dt);
      }
      done();
    }, TICK_RATE);

    // Rate limit trước, parse sau: payload sai cũng bị tính vào giới hạn.
    this.onMessage('chat', (c, raw) => {
      const limit = (identity(c)?.trust ?? 0) > 0 ? LIMITS.chat.member : LIMITS.chat.guest;
      if (!this.limiter.allow(`${c.sessionId}:chat`, limit)) return;
      const text = Chat.safeParse(raw);
      if (text.success) this.broadcast('chat', { name: this.state.players.get(c.sessionId)?.name, text: text.data });
    });
    this.onMessage('emote', (c, raw) => {
      if (!this.limiter.allow(`${c.sessionId}:emote`, LIMITS.emote)) return;
      const emote = Emote.safeParse(raw);
      if (emote.success) this.broadcast('emote', { id: c.sessionId, emote: emote.data });
    });
    this.onMessage('ping', (c, raw) => {
      if (!this.limiter.allow(`${c.sessionId}:ping`, LIMITS.ping)) return;
      if (typeof raw === 'number' && Number.isFinite(raw)) c.send('pong', raw);
    });
    metrics.rooms.inc();
  }

  async onAuth(_c: Client, options: { ticket?: unknown } | undefined) {
    return verifyTicket(options?.ticket);
  }

  async onJoin(c: Client) {
    const who = identity(c)!;
    const player = new Player();
    player.name = who.name;
    const spawn = spawnPoint();
    player.x = spawn.x;
    player.z = spawn.z;
    this.state.players.set(c.sessionId, player);
    metrics.clients.inc();

    // Mỗi tài khoản một chỗ: báo phiên cũ (ở bất kỳ room/process nào) rời đi, rồi mới bắt đầu nghe.
    const topic = `seat:${who.id}`;
    await this.presence.publish(topic, c.sessionId);
    const listener = (sessionId: string) => {
      if (sessionId === c.sessionId) return;
      const pending = this.reconnecting.get(c.sessionId);
      if (pending) return void pending.reject(new Error('signed-in-elsewhere'));   // đang rớt mạng: hủy giữ chỗ
      // Mã đóng khác CONSENTED nên Colyseus gọi onDrop; đánh dấu để onDrop không giữ ghế.
      this.replaced.add(c.sessionId);
      c.leave(CLOSE_SIGNED_IN_ELSEWHERE, 'signed-in-elsewhere');
    };
    this.seatListeners.set(c.sessionId, listener);
    await this.presence.subscribe(topic, listener);
  }

  async onDrop(c: Client) {
    if (this.replaced.delete(c.sessionId)) return;   // không gọi allowReconnection: Colyseus chuyển thẳng sang onLeave
    const player = this.state.players.get(c.sessionId);
    if (player) player.connected = false;
    const pending = this.allowReconnection(c, RECONNECT_SECONDS);
    this.reconnecting.set(c.sessionId, pending);
    try {
      await pending;
    } catch {
      // Hết hạn hoặc tài khoản đã vào ở phiên khác: onLeave dọn ghế.
    } finally {
      this.reconnecting.delete(c.sessionId);
    }
  }

  onReconnect(c: Client) {
    const player = this.state.players.get(c.sessionId);
    if (player) player.connected = true;
  }

  async onLeave(c: Client) {
    this.state.players.delete(c.sessionId);
    this.limiter.forget(`${c.sessionId}:`);
    const listener = this.seatListeners.get(c.sessionId);
    const who = identity(c);
    if (listener && who) await this.presence.unsubscribe(`seat:${who.id}`, listener);
    this.seatListeners.delete(c.sessionId);
    this.replaced.delete(c.sessionId);
    metrics.clients.dec();
  }

  onDispose() {
    metrics.rooms.dec();
    log.debug({ roomId: this.roomId }, 'room disposed');
  }
}
