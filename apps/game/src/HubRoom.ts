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
import {SeatLease,banned,moderate,rateLimit} from '@te-liet/security';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const reportDb=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:3}):null;

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
  private leases=new Map<string,SeatLease>();
  private history:{id:string;accountId:string;name:string;text:string;at:number}[]=[];
  private renewing=false;
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
        if (cmd && player.connected && this.leases.get(sessionId)?.active) applyInput(player, cmd, ctx.dt);
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
       this.broadcast('chat',{id:message.id,name:message.name,text:message.text});
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
    const who=await verifyTicket(options?.ticket);if(!moderate(who.name,'name').ok||await banned(who.id,'ban'))throw new Error('Access denied');return who;
  }

  private evict(c:Client){
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
      const player=new Player();player.name=who.name;const spawn=spawnPoint();player.x=spawn.x;player.z=spawn.z;
      this.state.players.set(c.sessionId,player);metrics.clients.inc();
    }catch(e){await lease.release().catch(()=>{});await this.presence.unsubscribe(topic,listener);this.seatListeners.delete(c.sessionId);throw e;}
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
    if (player && this.leases.get(c.sessionId)?.active) player.connected = true;
    else this.evict(c);
  }

  async onLeave(c: Client) {
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
  }

  onDispose() {
    metrics.rooms.dec();
    log.debug({ roomId: this.roomId }, 'room disposed');
  }
}
