import { test, type TestContext } from 'node:test';
import { Deferred, LocalPresence, type Client } from '@colyseus/core';
import type { SeatLease } from '@te-liet/security';
import assert from 'node:assert/strict';
import {
  ALTAR_CENTER, ALTAR_DURATION_MS, ALTAR_RESULTS_MS, AltarRequest, nearAltar,
} from '../packages/shared/src/altar.js';
import { AltarActivity, type AltarActor } from '../apps/game/src/altar.js';

const START = 1_000_000;
const join = { action: 'join', preset: 'prayer' };
function fixture() {
  let rounds = 0;
  const activity = new AltarActivity(() => `round-${++rounds}`);
  const actors = new Map<string, AltarActor>();
  const add = (id: string, overrides: Partial<AltarActor> = {}) => {
    actors.set(id, { ...ALTAR_CENTER, connected: true, activeSeat: true, ...overrides });
    return id;
  };
  const lookup = (id: string) => actors.get(id);
  const request = (id: string, raw: unknown = join, now = START) => activity.request(id, raw, now, lookup);
  return { activity, actors, add, lookup, request };
}

test('altar starts idle with authoritative server time and no client identity data', () => {
  const { activity } = fixture();
  assert.deepEqual(activity.snapshot(START), {
    phase: 'idle', roundId: null, serverNow: START, startedAt: null, endsAt: null,
    resultsUntil: null, participantCount: 0, participants: [], completedSessionIds: [],
  });
});

test('altar accepts only two preset actions, never custom text or client time/rewards', () => {
  assert.equal(AltarRequest.safeParse(join).success, true);
  assert.equal(AltarRequest.safeParse({ action: 'join', preset: 'cheer' }).success, true);
  assert.equal(AltarRequest.safeParse({ action: 'leave' }).success, true);
  for (const raw of [
    null, 'prayer', { action: 'join' }, { action: 'join', preset: 'attack' },
    { ...join, text: 'custom text' }, { ...join, x: 4, z: 4 },
    { ...join, endsAt: 1 }, { ...join, reward: 1_000 }, { action: 'complete' },
    { action: 'leave', sessionId: 'someone-else' },
  ]) assert.equal(AltarRequest.safeParse(raw).success, false);
});

test('solo completes once after exactly 30 server seconds with a temporary badge only', () => {
  const f = fixture();
  assert.equal(f.request(f.add('a')).changed, true);
  assert.equal(f.activity.snapshot(START).endsAt, START + ALTAR_DURATION_MS);
  assert.deepEqual(f.activity.advance(START + ALTAR_DURATION_MS - 1, f.lookup).completed, []);
  const completed = f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  assert.deepEqual(completed.completed, [{ sessionId: 'a', result: {
    roundId: 'round-1', completedAt: START + ALTAR_DURATION_MS,
    badge: 'Đồng hành tại bàn thờ', persistent: false,
  } }]);
  assert.equal(f.activity.snapshot(START + ALTAR_DURATION_MS).phase, 'completed');
  assert.deepEqual(f.activity.advance(START + ALTAR_DURATION_MS + 1, f.lookup).completed, []);
});

test('players share one round, deadline and count; duplicate joins cannot restart it', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.request(f.add('b'), { action: 'join', preset: 'cheer' }, START + 3_000);
  const duplicate = f.request('a', { action: 'join', preset: 'cheer' }, START + 5_000);
  assert.equal(duplicate.changed, false);
  const state = f.activity.snapshot(START + 5_000);
  assert.equal(state.roundId, 'round-1');
  assert.equal(state.startedAt, START);
  assert.equal(state.endsAt, START + ALTAR_DURATION_MS);
  assert.equal(state.participantCount, 2);
  assert.deepEqual(state.participants, [{ sessionId: 'a', preset: 'prayer' }, { sessionId: 'b', preset: 'cheer' }]);
  assert.equal(f.activity.advance(START + ALTAR_DURATION_MS, f.lookup).completed.length, 2);
});

test('proximity uses finite server positions and a 3m boundary', () => {
  assert.equal(nearAltar({ x: 7, z: 4 }), true);
  assert.equal(nearAltar({ x: 7.001, z: 4 }), false);
  assert.equal(nearAltar({ x: 7, z: 7 }), false);
  assert.equal(nearAltar({ x: NaN, z: 4 }), false);
  assert.equal(nearAltar({ x: Infinity, z: 4 }), false);
  const f = fixture();
  assert.equal(f.request(f.add('far', { x: 10 })).error, 'too-far');
  assert.equal(f.activity.snapshot(START).phase, 'idle');
});

test('missing, disconnected and inactive seats cannot participate', () => {
  const f = fixture();
  assert.equal(f.request('missing').error, 'inactive-seat');
  assert.equal(f.request(f.add('offline', { connected: false })).error, 'inactive-seat');
  assert.equal(f.request(f.add('revoked', { activeSeat: false })).error, 'inactive-seat');
  assert.equal(f.activity.snapshot(START).participantCount, 0);
});

test('invalid requests consume the same per-session token bucket as valid requests', () => {
  const f = fixture();
  f.add('a');
  for (let i = 0; i < 3; i++) assert.equal(f.request('a', { ...join, text: 'untrusted' }).error, 'invalid-request');
  assert.equal(f.request('a').error, 'rate-limit');
  assert.equal(f.request(f.add('b')).error, undefined);
  assert.equal(f.request('a', join, START + 1_667).error, undefined);
  assert.equal(f.activity.snapshot(START + 1_667).participantCount, 2);
});

test('dropping immediately removes participation, reconnect alone cannot restore it', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.request(f.add('b'));
  f.actors.get('a')!.connected = false;
  assert.equal(f.activity.remove('a'), true);
  assert.equal(f.activity.snapshot(START).participantCount, 1);
  f.actors.get('a')!.connected = true;
  const result = f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  assert.deepEqual(result.completed.map((item) => item.sessionId), ['b']);
  assert.equal(f.activity.completionFor('a'), undefined);
});

test('disconnected participants are also rejected by the completion sweep', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.actors.get('a')!.connected = false;
  const result = f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  assert.deepEqual(result.completed, []);
  assert.equal(f.activity.snapshot(START + ALTAR_DURATION_MS).phase, 'idle');
});

test('walking away or losing a seat is checked before a delayed completion callback', () => {
  const f = fixture();
  f.request(f.add('walking'));
  f.request(f.add('revoked'));
  f.request(f.add('remaining'));
  f.actors.get('walking')!.x = 12;
  f.actors.get('revoked')!.activeSeat = false;
  const result = f.activity.advance(START + ALTAR_DURATION_MS + 10_000, f.lookup);
  assert.deepEqual(result.completed.map((item) => item.sessionId), ['remaining']);
  assert.equal(f.activity.completionFor('walking'), undefined);
  assert.equal(f.activity.completionFor('revoked'), undefined);
});

test('missing player is removed on heartbeat and cannot be rewarded', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.actors.delete('a');
  assert.equal(f.activity.advance(START + 250, f.lookup).changed, true);
  assert.equal(f.activity.snapshot(START + 250).phase, 'idle');
  assert.deepEqual(f.activity.advance(START + ALTAR_DURATION_MS, f.lookup).completed, []);
});

test('leave withdraws only sender and a last departure cancels rather than grants a badge', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.request(f.add('b'));
  f.request('a', { action: 'leave' }, START + 1_000);
  assert.deepEqual(f.activity.snapshot(START + 1_000).participants.map((p) => p.sessionId), ['b']);
  f.request('b', { action: 'leave' }, START + 1_000);
  assert.equal(f.activity.snapshot(START + 1_000).phase, 'idle');
  assert.equal(f.activity.completionFor('a'), undefined);
  assert.equal(f.activity.completionFor('b'), undefined);
});

test('request exactly at deadline settles the old round before rejecting a late join', () => {
  const f = fixture();
  f.request(f.add('a'));
  const late = f.request(f.add('late'), join, START + ALTAR_DURATION_MS);
  assert.equal(late.error, 'results');
  assert.deepEqual(late.completed.map((item) => item.sessionId), ['a']);
  assert.equal(f.activity.completionFor('late'), undefined);
});

test('completion is visible for eight seconds, then another round gets its own ID and clock', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  assert.equal(f.activity.snapshot(START + ALTAR_DURATION_MS).resultsUntil, START + ALTAR_DURATION_MS + ALTAR_RESULTS_MS);
  assert.equal(f.request('a', join, START + ALTAR_DURATION_MS + 1).error, 'results');
  const next = START + ALTAR_DURATION_MS + ALTAR_RESULTS_MS;
  assert.equal(f.request('a', join, next).error, undefined);
  assert.equal(f.activity.snapshot(next).roundId, 'round-2');
  assert.equal(f.activity.snapshot(next).endsAt, next + ALTAR_DURATION_MS);
  assert.deepEqual(f.activity.snapshot(next).completedSessionIds, []);
});

test('badge survives a temporary reconnection but is forgotten when session leaves', () => {
  const f = fixture();
  f.request(f.add('a'));
  f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  f.activity.remove('a');
  assert.equal(f.activity.completionFor('a')?.persistent, false);
  f.activity.forget('a');
  assert.equal(f.activity.completionFor('a'), undefined);
});

test('snapshots and completion objects cannot mutate server state', () => {
  const f = fixture();
  f.request(f.add('a'));
  const snapshot = f.activity.snapshot(START);
  snapshot.participants[0].preset = 'cheer';
  snapshot.participants.push({ sessionId: 'forged', preset: 'prayer' });
  assert.deepEqual(f.activity.snapshot(START).participants, [{ sessionId: 'a', preset: 'prayer' }]);
  f.activity.advance(START + ALTAR_DURATION_MS, f.lookup);
  const result = f.activity.completionFor('a')!;
  result.roundId = 'fake';
  assert.equal(f.activity.completionFor('a')!.roundId, 'round-1');
  f.activity.snapshot(START).completedSessionIds.push('forged');
  assert.deepEqual(f.activity.snapshot(START).completedSessionIds, ['a']);
});

test('altar activity is scoped to its own hub instance', () => {
  const first = fixture();
  const second = fixture();
  first.request(first.add('a'));
  assert.equal(second.activity.snapshot(START).phase, 'idle');
  assert.equal(second.activity.completionFor('a'), undefined);
});


/** Room wiring without sockets, signing keys, credentials, timers, or external services. */
async function roomFixture(t: TestContext) {
  const publicJwks = process.env.TICKET_PUBLIC_JWKS;
  // HubRoom's verifier is unused here. Avoid its dev-key generation fallback on a clean checkout.
  process.env.TICKET_PUBLIC_JWKS = '{"keys":[]}';
  let module: typeof import('../apps/game/src/HubRoom.js');
  try { module = await import('../apps/game/src/HubRoom.js'); }
  finally {
    if (publicJwks === undefined) delete process.env.TICKET_PUBLIC_JWKS;
    else process.env.TICKET_PUBLIC_JWKS = publicJwks;
  }
  const room = new module.HubRoom();
  const broadcast: { type: string | number; value: unknown }[] = [];
  t.mock.method(room, 'setFixedTimestep', () => {});
  t.mock.method(room, 'broadcast', (type: string | number, value: unknown) => { broadcast.push({ type, value }); });
  room.presence = new LocalPresence();
  room.onCreate();
  const add = (id: string) => {
    const sent: { type: string | number; value: unknown }[] = [];
    const left: unknown[][] = [];
    const client = {
      sessionId: id, auth: { id: `test-account-${id}`, name: id, trust: 0 },
      send: (type: string | number, value: unknown) => { sent.push({ type, value }); },
      leave: (...args: unknown[]) => { left.push(args); },
    } as unknown as Client;
    const player = new module.Player();
    player.name = id; player.x = ALTAR_CENTER.x; player.z = ALTAR_CENTER.z;
    room.state.players.set(id, player);
    room.clients.push(client);
    const lease = { active: true, release: async () => {} } as unknown as SeatLease;
    room['leases'].set(id, lease);
    return { client, player, lease, sent, left };
  };
  const send = (client: Client, type: string, raw?: unknown) => room['onMessageEvents'].emit(type, client, raw);
  t.after(() => { room.clock.clear(); room.clock.stop(); room.onDispose(); });
  return { room, add, send, broadcast };
}

test('room altarSync repairs initial listener race, validates seat, and limits repeated reads', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t);
  const a = f.add('a');
  f.send(a.client, 'altarSync');
  assert.equal(a.sent[0].type, 'altarState');
  assert.equal((a.sent[0].value as { phase: string }).phase, 'idle');
  f.send(a.client, 'altarSync');
  f.send(a.client, 'altarSync');
  assert.equal(a.sent.length, 2);
  const disconnected = f.add('disconnected');
  disconnected.player.connected = false;
  f.send(disconnected.client, 'altarSync');
  assert.equal(disconnected.sent.length, 0);
  const revoked = f.add('revoked');
  Object.defineProperty(revoked.lease, 'active', { value: false });
  f.send(revoked.client, 'altarSync');
  assert.equal(revoked.sent.length, 0);
});

test('room drop/reconnect broadcasts current shared state without restoring lost participation', async (t) => {
  let now = START;
  t.mock.method(Date, 'now', () => now);
  const f = await roomFixture(t);
  const a = f.add('a');
  const b = f.add('b');
  f.send(a.client, 'altar', join);
  f.send(b.client, 'altar', { action: 'join', preset: 'cheer' });
  assert.equal(f.room['altar'].snapshot(now).participantCount, 2);
  const reconnect = new Deferred<Client>();
  t.mock.method(f.room, 'allowReconnection', () => reconnect);
  const drop = f.room.onDrop(a.client);
  assert.equal(a.player.connected, false);
  assert.equal(f.room['altar'].snapshot(now).participantCount, 1);
  reconnect.resolve(a.client);
  await drop;
  f.room.onReconnect(a.client);
  assert.equal(a.player.connected, true);
  assert.equal(a.sent.at(-1)?.type, 'altarState');
  assert.equal(f.room['altar'].snapshot(now).participantCount, 1);
  now += ALTAR_DURATION_MS;
  f.send(b.client, 'altarSync');
  assert.equal(a.sent.some((m) => m.type === 'altarComplete'), false);
  assert.equal(b.sent.filter((m) => m.type === 'altarComplete').length, 1, 'resync that settles the round emits completion only once');
  assert.equal(f.broadcast.at(-1)?.type, 'altarState');
  await f.room.onLeave(b.client);
  assert.equal(f.room['altar'].completionFor('b'), undefined);
  assert.equal(f.room.state.players.has('b'), false);
});

test('room evicts a revoked participant before it can complete and never resyncs an invalid reconnect', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t);
  const a = f.add('a');
  f.send(a.client, 'altar', join);
  Object.defineProperty(a.lease, 'active', { value: false });
  f.room.onReconnect(a.client);
  assert.equal(a.left.length, 1);
  assert.equal(a.player.connected, false);
  assert.equal(f.room['altar'].snapshot(START).phase, 'idle');
  assert.equal(a.sent.length, 0);
});
