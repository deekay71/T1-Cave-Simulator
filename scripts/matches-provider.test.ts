import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMatch } from '../apps/api/src/matches/normalize.js';
import { fetchMatches, ProviderError } from '../apps/api/src/matches/provider.js';
const fixture = (extra: Record<string, unknown> = {}) => ({ id: 90, opponents: [{ opponent: { id: 7, name: 'Example opponent' } }, { opponent: { id: 11, name: 'Synthetic T1' } }], status: 'finished', results: [{ team_id: 11, score: 3 }, { team_id: 7, score: 2 }], number_of_games: 5, scheduled_at: '2026-11-01T08:00:00Z', modified_at: '2026-11-01T11:00:00Z', winner_id: 11, ...extra });
const response = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {status,headers});
const options = (fetchImpl: typeof fetch) => ({token:'synthetic-test-token',teamId:11,beforeRequest:async()=>{},fetchImpl});
test('normalizes team scores by ID regardless of opponent and result positions', () => {
  const match = normalizeMatch(fixture(), 11)!;
  assert.deepEqual(match.teams.map(t=>[t.id,t.score]), [[7,2],[11,3]]);
  assert.deepEqual(normalizeMatch(fixture({ opponents: [...fixture().opponents].reverse() }),11)!.teams.map(t=>[t.id,t.score]),[[11,3],[7,2]]);
  assert.equal(normalizeMatch(fixture(),99),null);
});
test('unknown scores, TBD and absent timestamps are not invented',()=>{
  const m = normalizeMatch(fixture({ results:null, winner_id:null, opponents:[{opponent:{id:11,name:null}},{opponent:null}], number_of_games:0 }),11)!;
  assert.equal(m.teams[0].score,null); assert.equal(m.teams[0].name,'TBD'); assert.equal(m.bestOf,null); assert.equal(m.beginAt,null);
});
test('supports BO1/3/5, cancelled/postponed/forfeit and score corrections without monotonic assumption',()=>{
  for(const bestOf of [1,3,5]) assert.equal(normalizeMatch(fixture({number_of_games:bestOf}),11)!.bestOf,bestOf);
  for(const status of ['canceled','postponed','finished']) assert.equal(normalizeMatch(fixture({status,forfeit:true}),11)!.status,status);
  assert.equal(normalizeMatch(fixture({results:[{team_id:11,score:1}]}),11)!.teams[1].score,1);
  assert.equal(normalizeMatch(fixture({original_scheduled_at:'2026-10-30T08:00:00Z'}),11)!.originalScheduledAt,'2026-10-30T08:00:00Z');
});
test('malformed records reject rather than becoming incomplete success',()=>{
  assert.throws(()=>normalizeMatch(fixture({scheduled_at:'not a timestamp'}),11));
  assert.throws(()=>normalizeMatch(fixture(),0));
});
test('provider only uses free list endpoint and server authorization; quota called on each page',async()=>{
  let requests=0,reservations=0;
  const result=await fetchMatches('past',{...options(async(input,init)=>{
    requests++;
    const url=new URL(String(input)); assert.equal(url.pathname,'/lol/matches/past'); assert.equal(url.searchParams.get('filter[opponent_id]'),'11');
    assert.equal(url.searchParams.get('page'),String(requests)); assert.equal(url.searchParams.get('per_page'),'100');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer synthetic-test-token'); assert.equal(url.href.includes('synthetic-test-token'),false);
    return response(requests===1?Array.from({length:100},(_,i)=>fixture({id:i+1})):[]);
  }),beforeRequest:async()=>{reservations++;}});
  assert.equal(requests,2); assert.equal(reservations,2); assert.equal(result.length,100);
});
test('429 exposes cooldown and remaining quota without retry or payload leakage',async()=>{
  let calls=0;let observed:unknown;
  await assert.rejects(fetchMatches('running',{...options(async()=>{calls++;return response({token:'secret'},429,{'Retry-After':'120','X-Rate-Limit-Remaining':'0'});}),onRateLimit:info=>{observed=info;}}),(error:unknown)=>{
    assert.ok(error instanceof ProviderError); assert.equal(error.code,'rate_limit');assert.equal(error.retryAfterMs,120000);assert.equal(error.remaining,0);assert.equal(error.message.includes('secret'),false);return true;
  });
  assert.equal(calls,1);assert.deepEqual(observed,{remaining:0,retryAfterMs:120000});
});
test('rejects pagination truncation, malformed JSON, network and auth errors',async()=>{
  await assert.rejects(fetchMatches('past',{...options(async()=>response(Array.from({length:100},()=>fixture()))),maxPages:1}),{code:'pagination_limit'});
  await assert.rejects(fetchMatches('upcoming',options(async()=>new Response('{bad'))),{code:'invalid_json'});
  await assert.rejects(fetchMatches('running',options(async()=>{throw new Error('secret-url');})),{code:'network_or_timeout'});
  for(const status of [401,403]) await assert.rejects(fetchMatches('running',options(async()=>response({},status))),{code:'authentication',status});
  await assert.rejects(fetchMatches('running',options(async()=>response({}))),{code:'invalid_payload'});
});
test('quota rejection prevents outbound requests and invalid config is rejected',async()=>{
  let calls=0;
  await assert.rejects(fetchMatches('running',{...options(async()=>{calls++;return response([]);}),beforeRequest:async()=>{throw new Error('budget exhausted');}}),/budget exhausted/);
  assert.equal(calls,0);
  await assert.rejects(fetchMatches('running',{...options(async()=>response([])),token:''}),{code:'configuration'});
});
