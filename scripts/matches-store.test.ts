import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { PoolClient, Pool } from 'pg';
import { emptyFeed, saveBucket, readFeed, reserveRequest, pauseFeed } from '../apps/api/src/matches/store.js';
import { intervalMs } from '../apps/api/src/matches/scheduler.js';
import type { Match } from '../packages/shared/src/matches.js';
const m = (patch: Partial<Match> = {}): Match => ({ id: 1,teams:[{id:11,name:'Synthetic T1',score:2},{id:7,name:'Opponent',score:1}],competition:'Synthetic tournament',bestOf:3,scheduledAt:'2026-11-01T08:00:00Z',originalScheduledAt:null,beginAt:null,endAt:null,status:'finished',winnerId:11,forfeit:false,modifiedAt:'2026-11-01T11:00:00Z',...patch });
async function setup() { const db=new PGlite();await db.exec(await readFile('db/002_matches.sql','utf8'));return db; }
test('migration and store retain original schedule, accept correction and reject older provider revision',async()=>{
 const db=await setup();try {
 const client=db as unknown as PoolClient;
 await saveBucket(client,'past',[m({originalScheduledAt:'2026-10-30T08:00:00Z'})],'2026-11-01T12:00:00Z');
 await saveBucket(client,'past',[m({scheduledAt:'2026-11-01T09:00:00Z',modifiedAt:'2026-11-01T13:00:00Z',teams:[{id:11,name:'Synthetic T1',score:1}]})],'2026-11-01T14:00:00Z');
 let feed=await readFeed(db as unknown as Pool,true);
 assert.equal(feed.buckets.past.matches[0].originalScheduledAt,'2026-10-30T08:00:00Z'); assert.equal(feed.buckets.past.matches[0].teams[0].score,1);
 await saveBucket(client,'past',[m()],'2026-11-01T15:00:00Z');
 feed=await readFeed(db as unknown as Pool,true); assert.equal(feed.buckets.past.matches[0].teams[0].score,1);
 assert.equal(feed.buckets.past.checkedAt,'2026-11-01T15:00:00.000Z');
 // An old fetch cannot replace a newer successful bucket, including with an empty response.
 await saveBucket(client,'past',[],'2026-11-01T12:00:00Z');
 assert.equal((await readFeed(db as unknown as Pool,true)).buckets.past.matches.length,1);
 } finally {await db.close();}
});
test('fresh empty running snapshot does not infer any final result',async()=>{
 const db=await setup();try {const client=db as unknown as PoolClient;
 await saveBucket(client,'running',[m({status:'running',winnerId:null})],'2026-11-01T12:00:00Z');
 await saveBucket(client,'running',[],'2026-11-01T13:00:00Z');
 const feed=await readFeed(db as unknown as Pool,true);assert.equal(feed.buckets.running.matches.length,0);assert.equal(feed.buckets.past.matches.length,0);
 const history=await db.query<{data:Match}>('SELECT data FROM match_feed_history');assert.equal(history.rows[0].data.winnerId,null);
 }finally{await db.close();}
});
test('durable quota enforces minute/hour limits, cooldown, expiry and missing control fail closed',async()=>{
 const db=await setup();try {const client=db as unknown as PoolClient;
 for(let i=0;i<45;i++) await reserveRequest(client);
 await assert.rejects(reserveRequest(client),/feed_budget/);
 await db.exec("UPDATE match_feed_requests SET requested_at=clock_timestamp()-interval '2 minutes'");
 await reserveRequest(client);
 await pauseFeed(client,60000);await assert.rejects(reserveRequest(client),/feed_cooldown/);
 await db.exec("UPDATE match_feed_control SET paused_until='-infinity'; DELETE FROM match_feed_requests; INSERT INTO match_feed_requests(requested_at) SELECT clock_timestamp()-interval '2 minutes' FROM generate_series(1,800)");
 await assert.rejects(reserveRequest(client),/feed_budget/);
 await db.exec("UPDATE match_feed_requests SET requested_at=clock_timestamp()-interval '2 hours'");await reserveRequest(client);
 assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM match_feed_requests')).rows[0].count,1);
 await db.exec('UPDATE match_feed_control SET auth_blocked=true');await assert.rejects(reserveRequest(client),/feed_auth_blocked/);
 await db.exec('UPDATE match_feed_control SET auth_blocked=false');await reserveRequest(client);
 await db.exec('DELETE FROM match_feed_control');await assert.rejects(reserveRequest(client),/feed_control_missing/);
 }finally{await db.close();}
});
test('scheduler chooses idle, upcoming and running polling cadence without score dependency',()=>{
 const feed=emptyFeed(true);const now=Date.parse('2026-11-01T08:00:00Z');
 assert.equal(intervalMs(feed,'running',now),300000);assert.equal(intervalMs(feed,'past',now),900000);
 feed.buckets.upcoming.matches=[m({status:'not_started'})];assert.equal(intervalMs(feed,'upcoming',now),60000);assert.equal(intervalMs(feed,'running',now),30000);
 feed.buckets.running.matches=[m({status:'running'})];assert.equal(intervalMs(feed,'upcoming',now),300000);assert.equal(intervalMs(feed,'past',now),60000);
});

test('route serves last good snapshot with original timestamps during DB outage, validates first-load failure',async()=>{
 const {default:Fastify}=await import('fastify');
 const {registerMatchRoutes}=await import('../apps/api/src/matches/routes.js');
 const oldEnabled=process.env.MATCH_FEED_ENABLED,oldRedis=process.env.REDIS_URL;
 process.env.MATCH_FEED_ENABLED='true';delete process.env.REDIS_URL;
 const app=Fastify();let fail=false;const originalNow=Date.now;
 const fakeDb={query:async()=>{if(fail)throw new Error('db unavailable');return {rows:[{bucket:'past',checked_at:'2026-11-01T12:00:00Z',matches:[m()]}]};}};
 try {
 await registerMatchRoutes(app,fakeDb as unknown as Pool);
 const first=await app.inject('/v1/matches/t1');assert.equal(first.statusCode,200);
 fail=true;Date.now=()=>originalNow()+11000;
 const stale=await app.inject('/v1/matches/t1');assert.equal(stale.statusCode,200);assert.equal(stale.headers['cache-control'],'no-store');assert.equal(stale.json().buckets.past.checkedAt,first.json().buckets.past.checkedAt);
 const cold=Fastify();try{await registerMatchRoutes(cold,fakeDb as unknown as Pool);assert.equal((await cold.inject('/v1/matches/t1')).statusCode,503);}finally{await cold.close();}
 }finally{Date.now=originalNow;await app.close();if(oldEnabled===undefined)delete process.env.MATCH_FEED_ENABLED;else process.env.MATCH_FEED_ENABLED=oldEnabled;if(oldRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=oldRedis;}
});

test('bucket transitions are exclusive, reject delayed revisions, and allow newer corrections', async () => {
 const db=await setup(); try {
 const client=db as unknown as PoolClient;
 const t=(hour:number)=>`2026-11-01T${String(hour).padStart(2,'0')}:00:00Z`;
 await saveBucket(client,'upcoming',[m({status:'not_started',winnerId:null,modifiedAt:t(8)})],t(9));
 await saveBucket(client,'running',[m({status:'running',winnerId:null,modifiedAt:t(10)})],t(11));
 let feed=await readFeed(db as unknown as Pool,true);
 assert.equal(feed.buckets.upcoming.matches.length,0);assert.equal(feed.buckets.running.matches.length,1);
 assert.equal(feed.buckets.upcoming.checkedAt,new Date(t(9)).toISOString());
 // Late response with earlier fetch, and later fetch with an old/equal provider revision.
 await saveBucket(client,'upcoming',[m({status:'not_started',modifiedAt:t(8)})],t(10));
 await saveBucket(client,'upcoming',[m({status:'not_started',modifiedAt:t(10)})],t(12));
 feed=await readFeed(db as unknown as Pool,true);assert.equal(feed.buckets.upcoming.matches.length,0);assert.equal(feed.buckets.running.matches.length,1);
 await saveBucket(client,'past',[m({status:'finished',modifiedAt:t(13)})],t(14));
 feed=await readFeed(db as unknown as Pool,true);assert.equal(feed.buckets.running.matches.length,0);assert.equal(feed.buckets.past.matches.length,1);
 await saveBucket(client,'running',[m({status:'running',modifiedAt:t(10)})],t(15));
 assert.equal((await readFeed(db as unknown as Pool,true)).buckets.running.matches.length,0);
 // An explicit newer provider correction can return a fixture to running; do not rank statuses.
 await saveBucket(client,'running',[m({status:'running',winnerId:null,modifiedAt:t(16)})],t(17));
 feed=await readFeed(db as unknown as Pool,true);assert.equal(feed.buckets.past.matches.length,0);assert.equal(feed.buckets.running.matches[0].winnerId,null);
 // Disappearance remains disappearance, even if an old revision arrives in another list.
 await saveBucket(client,'running',[],t(18));
 await saveBucket(client,'upcoming',[m({status:'not_started',modifiedAt:t(8)})],t(19));
 feed=await readFeed(db as unknown as Pool,true);assert.ok(Object.values(feed.buckets).every(b=>b.matches.length===0));
 } finally { await db.close(); }
});
