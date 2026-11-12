import { Room, type Client } from '@colyseus/core';
import type { Deferred } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  AXIS_MAX, CaveSeating, CaveSeatRequest, Chat, HUB_CAVES, HUB_RADIUS, SIDE_CAVE_RADIUS, CLOSE_SIGNED_IN_ELSEWHERE, Emote, LIMITS, MoveInput,
  PATCH_MS, ROOM_CAPACITY, spawnPoint, TICK_RATE,
} from '@te-liet/shared';
import type { TicketIdentity } from '@te-liet/auth';
import { verifyTicket } from './auth.js';
import { RateLimiter } from './rateLimit.js';
import { AltarActivity, type AltarUpdate } from './altar.js';
import { ShrineActivity, type ShrineUpdate } from './shrine.js';
import { applyShrineAwareInput, isInShrine } from '../../../packages/shared/src/shrine.js';
import { log, metrics } from './telemetry.js';
import {SeatLease,banned,moderate,rateLimit} from '@te-liet/security';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import { COSMETICS } from '../../../packages/shared/src/progression.js';
const reportDb=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:1500,statement_timeout:1500,query_timeout:2000}):null;

export const Player = schema({
  name: t.string().default(''),
  avatarKey: t.string().default(''),
  x: t.float32().default(0),
  z: t.float32().default(0),
  connected: t.boolean().default(true),
  shrineSeat: t.string().default(''),
  shrineGesture: t.string().default(''),
  shrineGestureAt: t.float64().default(0),
  /** Chỗ ngồi trong hang (packages/shared seats.ts): id ghế và hướng mặt (độ). */
  seat: t.string().default(''),
  seatYaw: t.int16().default(0),
});
export type Player = SchemaType<typeof Player>;
export const HubState = schema({ players: t.map(Player) });
export type HubState = SchemaType<typeof HubState>;

const RECONNECT_SECONDS = 15;

/* ---------------------------------------------------------------- theo dõi (cổng quản trị) */

/** Các room của tiến trình này và vài con số từ lúc khởi động, cho /live của cổng quản trị. */
const LIVE_ROOMS = new Set<HubRoom>();
const LIVE = {
  startedAt: Date.now(),
  joins: 0,
  peak: 0,
  /** 40 lượt vào gần nhất (mới nhất trước). */
  recent: [] as { id: string; name: string; at: number; leftAt: number | null }[],
};
function zoneOf(p: { x: number; z: number }): string {
  if (isInShrine(p)) return 'Điện thờ';
  for (const c of HUB_CAVES) if (Math.hypot(p.x - c.x, p.z - c.z) <= SIDE_CAVE_RADIUS + 1.5) return c.name;
  return Math.hypot(p.x, p.z) <= HUB_RADIUS + 1 ? 'Hang lớn' : 'Đường hầm';
}
const onlineNow = () => [...LIVE_ROOMS].reduce((n, r) => n + r.state.players.size, 0);
/** Ảnh chụp cho trang quản trị: ai đang ở đâu, bao lâu; không có IP hay tài khoản. */
export function liveSnapshot(now = Date.now()) {
  const rooms = [...LIVE_ROOMS].map((r) => r.describe(now));
  const zones: Record<string, number> = {};
  for (const room of rooms) for (const p of room.players) zones[p.zone] = (zones[p.zone] ?? 0) + 1;
  return {
    at: now,
    startedAt: LIVE.startedAt,
    online: rooms.reduce((n, r) => n + r.players.length, 0),
    peak: LIVE.peak,
    joins: LIVE.joins,
    zones,
    rooms,
    recent: LIVE.recent.map((e) => ({ name: e.name, at: e.at, leftAt: e.leftAt })),
  };
}
const identity = (c: Client) => c.auth as TicketIdentity | undefined;

export class HubRoom extends Room<{ state: HubState; input: MoveInput }> {
  maxClients = ROOM_CAPACITY;

  /** Input theo từng client, đệm sẵn; sanitize kẹp trục về miền hợp lệ (kể cả NaN). */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 32,
    sanitize: { moveX: [-AXIS_MAX, AXIS_MAX], moveZ: [-AXIS_MAX, AXIS_MAX] },
  });

  private limiter = new RateLimiter();
  private altar = new AltarActivity();
  private shrine = new ShrineActivity();
  private seating = new CaveSeating();
  private altarBroadcastAt = 0;
  private leases=new Map<string,SeatLease>();
  private history:{id:string;accountId:string;name:string;text:string;at:number}[]=[];
  private renewing=false;
  private seatListeners = new Map<string, (sessionId: string) => void>();
  private reconnecting = new Map<string, Deferred<Client>>();
  /** Phiên bị đóng vì tài khoản đã vào ở nơi khác: không giữ ghế chờ kết nối lại. */
  private replaced = new Set<string>();

  /** Lúc vào (ms) của từng phiên, cho trang quản trị. */
  private joinedAt = new Map<string, number>();

  describe(now: number) {
    const players: { id: string; name: string; zone: string; seat: 'cave' | 'shrine' | null; connected: boolean; minutes: number }[] = [];
    this.state.players.forEach((p, id) => players.push({
      id: id.slice(0, 6), name: p.name, zone: zoneOf(p),
      seat: p.shrineSeat ? 'shrine' : p.seat ? 'cave' : null,
      connected: p.connected, minutes: Math.round((now - (this.joinedAt.get(id) ?? now)) / 6000) / 10,
    }));
    return { roomId: this.roomId, players };
  }

  onCreate() {
    LIVE_ROOMS.add(this);
    this.setState(new HubState());
    this.setPatchRate(PATCH_MS);
    // Mỗi bước áp đúng một input; client dùng cùng solver theo khu vực và ghế ngồi.
    this.setFixedTimestep((ctx) => {
      const done = metrics.startTick();
      for (const [sessionId, player] of this.state.players) {
        const cmd = this.inputs.get(sessionId).next();
        if (cmd && player.connected && this.leases.get(sessionId)?.active) applyShrineAwareInput(player, cmd, ctx.dt);
      }
      done();
    }, TICK_RATE);

    // Rate limit trước, parse sau: payload sai cũng bị tính vào giới hạn.
    this.onMessage('chat', async (c, raw) => {
      try {
       const who=identity(c)!;
       const limit=who.trust>0?LIMITS.chat.member:LIMITS.chat.guest;
       if(!this.limiter.allow(`${c.sessionId}:chat`,limit)||!this.leases.get(c.sessionId)?.active)return;
       if(await banned(who.id,'ban'))return this.evict(c);
       if(await banned(who.id,'mute'))return c.send('notice','Bạn đang bị tạm khóa chat.');
       const parsed=Chat.safeParse(raw);if(!parsed.success)return;
       const verdict=moderate(parsed.data,'chat');if(!verdict.ok)return c.send('notice',verdict.reason);
       if(!this.leases.get(c.sessionId)?.active||!this.state.players.has(c.sessionId))return;
       const message={id:randomUUID(),accountId:who.id,name:who.name,text:parsed.data,at:Date.now()};
       this.history.push(message);if(this.history.length>50)this.history.shift();
       this.broadcast('chat',{id:message.id,senderId:c.sessionId,name:message.name,text:message.text});
      }catch{c.send('notice','Chat tạm ngừng vì không kiểm tra được trạng thái an toàn.');}
    });
    this.onMessage('report',async(c,raw)=>{
     try{
      const who=identity(c)!;if(!this.leases.get(c.sessionId)?.active||!this.limiter.allow(`${c.sessionId}:report`,{capacity:2,perMs:60000}))return;
      if(!raw||typeof raw.messageId!=='string'||typeof raw.reason!=='string'||raw.reason.length<3||raw.reason.length>240)return;
      if(!await rateLimit('report:'+who.id,5,3600000))return c.send('notice','Đã đạt giới hạn báo cáo.');
      const message=this.history.find(m=>m.id===raw.messageId);if(!message||message.accountId===who.id)return c.send('notice','Không tìm thấy tin nhắn có thể báo cáo.');
      if(!reportDb)return c.send('notice','Báo cáo cần database; bản local chưa lưu được báo cáo.');
      await reportDb.query('INSERT INTO moderation_reports(id,reporter_id,target_id,room_id,reason,evidence) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),who.id,message.accountId,this.roomId,raw.reason,JSON.stringify({message})]);
      c.send('notice','Đã gửi báo cáo để kiểm duyệt.');
     }catch{c.send('notice','Chưa lưu được báo cáo, vui lòng thử lại.');}
    });
    this.onMessage('emote', (c, raw) => {
      if (!this.leases.get(c.sessionId)?.active || !this.limiter.allow(`${c.sessionId}:emote`, LIMITS.emote)) return;
      const emote = Emote.safeParse(raw);
      if (emote.success) this.broadcast('emote', { id: c.sessionId, emote: emote.data });
    });
    // Ngồi lên ghế đẩu, thùng, đá thấp trong hang; đứng dậy trả về chỗ cũ.
    this.onMessage('seat', (c, raw) => {
      if (!this.leases.get(c.sessionId)?.active || !this.limiter.allow(`${c.sessionId}:seat`, LIMITS.emote)) return;
      const player = this.state.players.get(c.sessionId);
      const request = CaveSeatRequest.safeParse(raw);
      if (!player || !player.connected || !request.success || isInShrine(player)) return;
      const error = request.data.action === 'sit'
        ? this.seating.sit(c.sessionId, player, request.data.seatId)
        : this.seating.stand(c.sessionId, player);
      if (error === 'occupied-seat') c.send('notice', 'Chỗ này có người ngồi rồi.');
    });
    this.onMessage('altar', (c, raw) => {
      const now = Date.now();
      const result = this.altar.request(c.sessionId, raw, now, (id) => this.altarActor(id));
      this.publishAltar(result, now);
      if (result.error === 'rate-limit' || result.error === 'invalid-request' || result.error === 'inactive-seat') return;
      if (result.error === 'too-far') c.send('notice', 'Đến gần bàn thờ (trong 3 m) để cùng tham gia.');
      if (result.error === 'results') c.send('notice', 'Lượt vừa xong. Chờ vài giây để bắt đầu lượt mới.');
      if (!result.changed) c.send('altarState', this.altar.snapshot(now));
    });
    this.onMessage('altarSync', (c) => {
      if (!this.limiter.allow(`${c.sessionId}:altarSync`, { capacity: 2, perMs: 5_000 })) return;
      const actor = this.altarActor(c.sessionId);
      if (actor?.connected && actor.activeSeat) this.syncAltar(c);
    });
    this.onMessage('shrine', (c, raw) => {
      const now = Date.now();
      // Đang ngồi trong hang mà vào điện thờ: đứng dậy trước, kẻo mang ghế hang sang đảo.
      const seated = this.state.players.get(c.sessionId);
      if (seated?.seat) this.seating.stand(c.sessionId, seated);
      const result = this.shrine.request(c.sessionId, raw, now, (id) => this.shrineActor(id));
      if (result.changed && raw?.action === 'enter') this.removeFromAltar(c.sessionId);
      this.publishShrine(result, now);
      const notices = {
        'too-far': 'Đến gần cổng điện thờ (3 m) hoặc ghế muốn ngồi (2 m).',
        'outside-shrine': 'Vào điện thờ trước khi chọn chỗ ngồi.',
        'unknown-seat': 'Không tìm thấy chỗ ngồi này.',
        'occupied-seat': 'Chỗ này đã có người ngồi. Hãy chọn một ghế khác.',
        'not-seated': 'Ngồi vào một ghế đá để cầu nguyện hoặc cúi lạy.',
      };
      if (result.error && result.error in notices) c.send('notice', notices[result.error as keyof typeof notices]);
      if (!result.changed && !['rate-limit', 'invalid-request', 'inactive-seat'].includes(result.error ?? '')) {
        c.send('shrineState', this.shrine.snapshot(now));
      }
    });
    this.onMessage('shrineSync', (c) => {
      if (!this.limiter.allow(`${c.sessionId}:shrineSync`, { capacity: 2, perMs: 5_000 })) return;
      const actor = this.shrineActor(c.sessionId);
      if (actor?.player.connected && actor.activeSeat) this.syncShrine(c);
    });
    this.clock.setInterval(() => {
      const now = Date.now();
      const update = this.altar.advance(now, (id) => this.altarActor(id));
      const heartbeat = this.altar.snapshot(now).phase !== 'idle' && now - this.altarBroadcastAt >= 1_000;
      this.publishAltar(update, now, heartbeat);
      this.publishShrine(this.shrine.advance(now, (id) => this.shrineActor(id)), now);
    }, 250);
    this.onMessage('ping', (c, raw) => {
      if (!this.limiter.allow(`${c.sessionId}:ping`, LIMITS.ping)) return;
      if (typeof raw === 'number' && Number.isFinite(raw)) c.send('pong', raw);
    });
    this.clock.setInterval(async()=>{
      if(this.renewing)return;this.renewing=true;
      try{await Promise.all(this.clients.map(async c=>{try{const lease=this.leases.get(c.sessionId);if(!lease||!await lease.renew()||await banned(identity(c)!.id,'ban'))this.evict(c);}catch{this.evict(c);}}));}finally{this.renewing=false;}
    },3000);
    metrics.rooms.inc();
  }

  async onAuth(_c: Client, options: { ticket?: unknown } | undefined) {
    const who = await verifyTicket(options?.ticket);
    if (!moderate(who.name, 'name').ok || await banned(who.id, 'ban')) throw new Error('Access denied');
    let avatarKey = '';
    if (process.env.PROGRESSION_ENABLED === 'true' && reportDb) {
      try {
        const result = await reportDb.query('SELECT avatar_key FROM profiles WHERE account_id = $1', [who.id]);
        const saved = result.rows[0]?.avatar_key;
        if (COSMETICS.some(item => item.assetKey === saved)) avatarKey = saved;
      } catch { log.warn('Cosmetic profile unavailable; using default avatar'); }
    }
    return { ...who, avatarKey };
  }

  private altarActor(sessionId: string) {
    const player = this.state.players.get(sessionId);
    return player ? {
      x: player.x, z: player.z, connected: player.connected,
      activeSeat: this.leases.get(sessionId)?.active === true,
    } : undefined;
  }

  private shrineActor(sessionId: string) {
    const player = this.state.players.get(sessionId);
    return player ? { player, activeSeat: this.leases.get(sessionId)?.active === true } : undefined;
  }

  private publishShrine(update: ShrineUpdate, now = Date.now()) {
    if (update.changed) this.broadcast('shrineState', this.shrine.snapshot(now));
  }

  private syncShrine(c: Client) {
    const now = Date.now();
    this.publishShrine(this.shrine.advance(now, (id) => this.shrineActor(id)), now);
    c.send('shrineState', this.shrine.snapshot(now));
  }

  private removeFromShrine(sessionId: string, forget = false) {
    this.publishShrine({ changed: this.shrine.remove(sessionId, (id) => this.shrineActor(id), forget) });
  }

  private publishAltar(update: AltarUpdate, now: number, heartbeat = false) {
    for (const { sessionId, result } of update.completed) {
      this.clients.find((client) => client.sessionId === sessionId)?.send('altarComplete', result);
    }
    if (update.changed || heartbeat) {
      this.broadcast('altarState', this.altar.snapshot(now));
      this.altarBroadcastAt = now;
    }
  }

  private syncAltar(c: Client) {
    const now = Date.now();
    const update = this.altar.advance(now, (id) => this.altarActor(id));
    this.publishAltar(update, now);
    c.send('altarState', this.altar.snapshot(now));
    const completed = this.altar.completionFor(c.sessionId);
    if (completed && !update.completed.some(item => item.sessionId === c.sessionId)) c.send('altarComplete', completed);
  }

  private removeFromAltar(sessionId: string, forget = false) {
    const changed = forget ? this.altar.forget(sessionId) : this.altar.remove(sessionId);
    this.publishAltar({ changed, completed: [] }, Date.now());
  }

  private evict(c:Client){
    this.removeFromShrine(c.sessionId);
    this.removeFromAltar(c.sessionId);
    const player=this.state.players.get(c.sessionId);if(player)player.connected=false;
    const pending=this.reconnecting.get(c.sessionId);
    if(pending){pending.reject(new Error('signed-in-elsewhere'));return;}
    this.replaced.add(c.sessionId);c.leave(CLOSE_SIGNED_IN_ELSEWHERE,'seat-replaced-or-access-revoked');
  }
  async onJoin(c:Client){
    const who=identity(c)!;const topic=`seat:${who.id}`;
    const listener=(target:string)=>{if(target===c.sessionId)this.evict(c);};
    // Subscribe BEFORE acquiring; requests target the current token, not every listener.
    await this.presence.subscribe(topic,listener);this.seatListeners.set(c.sessionId,listener);
    const lease=new SeatLease(who.id,c.sessionId);
    try{
      let acquired=false;
      for(let attempt=0;attempt<20;attempt++){
        if(await lease.acquire()){acquired=true;break;}
        const owner=await lease.owner();if(owner)await this.presence.publish(topic,owner);
        await new Promise(r=>setTimeout(r,100));
      }
      if(!acquired||!lease.active)throw new Error('Seat busy; retry shortly');
      this.leases.set(c.sessionId,lease);
      const player=new Player();player.name=who.name;player.avatarKey=(c.auth as TicketIdentity & {avatarKey?:string}).avatarKey || '';const spawn=spawnPoint();player.x=spawn.x;player.z=spawn.z;
      this.state.players.set(c.sessionId,player);metrics.clients.inc();
      const at=Date.now();this.joinedAt.set(c.sessionId,at);LIVE.joins++;LIVE.peak=Math.max(LIVE.peak,onlineNow());
      LIVE.recent.unshift({id:c.sessionId,name:who.name,at,leftAt:null});LIVE.recent.length=Math.min(LIVE.recent.length,40);
      this.syncShrine(c);
      this.publishShrine({ changed: true });
      this.syncAltar(c);
    }catch(e){await lease.release().catch(()=>{});await this.presence.unsubscribe(topic,listener);this.seatListeners.delete(c.sessionId);throw e;}
  }

  async onDrop(c: Client) {
    this.removeFromShrine(c.sessionId);
    this.removeFromAltar(c.sessionId);
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
    if (player && this.leases.get(c.sessionId)?.active) {
      player.connected = true;
      this.syncShrine(c);
      this.syncAltar(c);
    }
    else this.evict(c);
  }

  async onLeave(c: Client) {
    this.removeFromShrine(c.sessionId, true);
    this.removeFromAltar(c.sessionId, true);
    this.seating.forget(c.sessionId);
    const hadPlayer=this.state.players.delete(c.sessionId);
    const lease=this.leases.get(c.sessionId);this.leases.delete(c.sessionId);
    await lease?.release().catch(()=>{});
    this.limiter.forget(`${c.sessionId}:`);
    const listener = this.seatListeners.get(c.sessionId);
    const who = identity(c);
    if (listener && who) await this.presence.unsubscribe(`seat:${who.id}`, listener);
    this.seatListeners.delete(c.sessionId);
    this.replaced.delete(c.sessionId);
    if(hadPlayer)metrics.clients.dec();
    this.joinedAt.delete(c.sessionId);
    const entry=LIVE.recent.find(e=>e.id===c.sessionId&&e.leftAt===null);if(entry)entry.leftAt=Date.now();
  }

  onDispose() {
    LIVE_ROOMS.delete(this);
    metrics.rooms.dec();
    log.debug({ roomId: this.roomId }, 'room disposed');
  }
}
