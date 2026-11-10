import {Redis} from 'ioredis';
import {performance} from 'node:perf_hooks';
const prefix=process.env.SECURITY_NAMESPACE||'te-liet:dev';
if(process.env.NODE_ENV==='production'&&!process.env.REDIS_URL)throw new Error('REDIS_URL required for security coordination');
export const redis=process.env.REDIS_URL?new Redis(process.env.REDIS_URL,{enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:3000}):null;
redis?.on('error',()=>{}); // Callers fail closed; never print a connection URL with credentials.
export async function ready(){if(redis&&redis.status!=='ready')await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Security store unavailable'));},4000);const ok=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error('Security store unavailable'));};function cleanup(){clearTimeout(timer);redis!.off('ready',ok);redis!.off('error',fail);}redis!.once('ready',ok);redis!.once('error',fail);});}
const memory=new Map<string,{value:string,until:number}>();
function get(key:string){const v=memory.get(key);if(v&&v.until>performance.now())return v.value;memory.delete(key);return null;}
export const securityKey=(key:string)=>`${prefix}:${key}`;
const leaseTTL=30000,localTTL=10000;
export class SeatLease {
 private deadline=0;
 constructor(readonly accountId:string,readonly token:string){}
 get key(){return securityKey('seat:'+this.accountId);}
 get active(){return this.deadline>performance.now();}
 async acquire(){const start=performance.now();await ready();const acquired=redis?await redis.set(this.key,this.token,'PX',leaseTTL,'NX'):(get(this.key)?null:(memory.set(this.key,{value:this.token,until:start+leaseTTL}),'OK'));if(acquired)this.deadline=start+localTTL;return acquired==='OK';}
 async owner(){await ready();return redis?redis.get(this.key):get(this.key);}
 async renew(){const start=performance.now();if(!this.active)return false;const result=redis?await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end",1,this.key,this.token,leaseTTL):(get(this.key)===this.token?(memory.set(this.key,{value:this.token,until:start+leaseTTL}),1):0);if(result===1&&this.active){this.deadline=start+localTTL;return true;}this.deadline=0;return false;}
 async release(){this.deadline=0;if(redis)await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,this.key,this.token);else if(get(this.key)===this.token)memory.delete(this.key);}
}
export async function banned(id:string,kind:'ban'|'mute'){await ready();const key=securityKey(`sanction:${kind}:${id}`);return !!(redis?await redis.get(key):get(key));}
export async function sanction(id:string,kind:'ban'|'mute',seconds:number){await ready();const key=securityKey(`sanction:${kind}:${id}`);if(redis)await redis.set(key,'1','EX',seconds);else memory.set(key,{value:'1',until:performance.now()+seconds*1000});}
export async function rateLimit(key:string,max:number,windowMs:number){await ready();const k=securityKey('rate:'+key);if(redis){const n=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n",1,k,windowMs);return Number(n)<=max;}const n=Number(get(k)||0)+1;const previous=memory.get(k);memory.set(k,{value:String(n),until:previous?.until||performance.now()+windowMs});return n<=max;}
export async function closeSecurity(){if(redis)await redis.quit();}

export {moderate, normalize} from './moderation.js';
