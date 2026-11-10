import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Deferred, LocalPresence, type Client } from '@colyseus/core';
import type { SeatLease } from '@te-liet/security';
import { applyInput, HUB_LAYOUT, type Axes } from '../packages/shared/src/index.js';
import {
  SHRINE_CENTER, SHRINE_ENTRY, SHRINE_GESTURE_MS, SHRINE_LIMIT, SHRINE_PORTAL, SHRINE_RADIUS,
  SHRINE_SEATS, ShrineRequest, applyShrineAwareInput, constrainShrine, isInShrine,
  nearShrinePortal, shrineReturnPoint, shrineStandingPoint, type ShrineSnapshot,
} from '../packages/shared/src/shrine.js';
import { ALTAR_CENTER } from '../packages/shared/src/altar.js';
import { ShrineActivity, type ShrineActor, type ShrineMember } from '../apps/game/src/shrine.js';

const START = 1_900_000_000_000;
const inner = SHRINE_SEATS[0], outer = SHRINE_SEATS[8];
const sit = { action: 'sit', seatId: outer.id };
function fixture() {
  const activity = new ShrineActivity();
  const actors = new Map<string, ShrineMember>();
  const add = (id: string, overrides: Partial<ShrineActor> = {}) => {
    const player: ShrineActor = {
      ...SHRINE_PORTAL, connected: true, shrineSeat: '', shrineGesture: '', shrineGestureAt: 0, ...overrides,
    };
    actors.set(id, { player, activeSeat: true });
    return player;
  };
  const lookup = (id: string) => actors.get(id);
  const request = (id: string, raw: unknown, now = START) => activity.request(id, raw, now, lookup);
  const seat = (id: string) => {
    const player = add(id, { x: outer.x, z: outer.z });
    assert.equal(request(id, sit).changed, true);
    return player;
  };
  return { activity, actors, add, lookup, request, seat };
}

test('shrine has twenty unique evenly spaced seats in two inward-facing concentric rings', () => {
  assert.equal(SHRINE_SEATS.length, 20);
  assert.equal(new Set(SHRINE_SEATS.map((seat) => seat.id)).size, 20);
  for (const [ring, count, radius] of [[1, 8, 3], [2, 12, 5]]) {
    const seats = SHRINE_SEATS.filter((seat) => seat.ring === ring);
    assert.equal(seats.length, count);
    for (let i = 0; i < count; i++) {
      const seat = seats[i];
      assert.ok(Math.abs(Math.hypot(seat.x - SHRINE_CENTER.x, seat.z) - radius) < 0.00001);
      assert.equal(seat.index, i);
      assert.equal(seat.yaw, (i * 360 / count + 180) % 360);
      const next = seats[(i + 1) % count];
      assert.ok(Math.abs(Math.hypot(next.x - seat.x, next.z - seat.z) - 2 * radius * Math.sin(Math.PI / count)) < 0.00001);
    }
  }
});

test('shrine schema allows only explicit actions and rejects client positions, identities and clocks', () => {
  for (const request of [{ action: 'enter' }, { action: 'exit' }, sit, { action: 'stand' },
    { action: 'gesture', gesture: 'pray' }, { action: 'gesture', gesture: 'bow' }]) {
    assert.equal(ShrineRequest.safeParse(request).success, true);
  }
  for (const request of [null, 'sit', {}, { action: 'sit' }, { action: 'sit', seatId: '' },
    { action: 'gesture', gesture: 'cheer' }, { action: 'enter', x: 48, z: 5 },
    { ...sit, sessionId: 'another-player' }, { action: 'gesture', gesture: 'pray', at: START },
    { action: 'exit', reward: 100 }, { action: 'stand', text: 'untrusted' }]) {
    assert.equal(ShrineRequest.safeParse(request).success, false);
  }
});

test('entry is authorized only from finite server positions within three metres of the cave portal', () => {
  assert.equal(nearShrinePortal({ x: SHRINE_PORTAL.x + 3, z: SHRINE_PORTAL.z }), true);
  assert.equal(nearShrinePortal({ x: SHRINE_PORTAL.x + 3.001, z: SHRINE_PORTAL.z }), false);
  assert.equal(nearShrinePortal({ x: NaN, z: 4 }), false);
  assert.equal(nearShrinePortal({ x: Infinity, z: 4 }), false);
  const f = fixture();
  const far = f.add('far', { x: 0, z: -8 });
  assert.equal(f.request('far', { action: 'enter' }).error, 'too-far');
  assert.equal(far.x, 0);
  const player = f.add('a');
  assert.equal(f.request('a', { action: 'enter' }).changed, true);
  assert.equal(player.x, SHRINE_ENTRY.x);
  assert.equal(player.z, Math.fround(SHRINE_ENTRY.z));
  assert.equal(f.request('a', { action: 'enter' }).changed, false);
});

test('missing, disconnected and revoked members cannot enter or reserve seats', () => {
  const f = fixture();
  assert.equal(f.request('missing', { action: 'enter' }).error, 'inactive-seat');
  f.add('offline', { connected: false });
  f.add('revoked');
  f.actors.get('revoked')!.activeSeat = false;
  for (const id of ['offline', 'revoked']) assert.equal(f.request(id, { action: 'enter' }).error, 'inactive-seat');
  assert.ok(f.activity.snapshot(START).seats.every((seat) => seat.occupant === null));
});

test('same-seat contention has exactly one winner and never displaces an occupant', () => {
  const f = fixture();
  const a = f.add('a', { x: outer.x, z: outer.z });
  const b = f.add('b', { x: outer.x, z: outer.z });
  assert.equal(f.request('a', sit).changed, true);
  assert.equal(f.request('b', sit).error, 'occupied-seat');
  assert.equal(a.shrineSeat, outer.id);
  assert.equal(b.shrineSeat, '');
  assert.deepEqual(f.activity.snapshot(START).seats.filter((seat) => seat.occupant), [{ id: outer.id, occupant: 'a' }]);
  assert.equal(f.request('a', sit).changed, false);
});

test('seating checks the zone, known seat and two-metre server proximity', () => {
  const f = fixture();
  f.add('cave');
  assert.equal(f.request('cave', sit).error, 'outside-shrine');
  const player = f.add('a', { x: outer.x, z: outer.z + 2.001 });
  assert.equal(f.request('a', sit).error, 'too-far');
  assert.equal(f.request('a', { action: 'sit', seatId: 'forged-seat' }).error, 'unknown-seat');
  player.z = outer.z + 2;
  assert.equal(f.request('a', sit).changed, true);
  assert.equal(player.x, outer.x);
  assert.equal(player.z, outer.z);
});

test('switching to an available nearby seat is atomic and failed switches preserve the old reservation', () => {
  const f = fixture();
  const player = f.seat('a');
  f.add('b', { x: inner.x, z: inner.z });
  f.request('b', { action: 'sit', seatId: inner.id });
  assert.equal(f.request('a', { action: 'sit', seatId: inner.id }).error, 'occupied-seat');
  assert.equal(player.shrineSeat, outer.id);
  assert.equal(f.request('a', { action: 'sit', seatId: SHRINE_SEATS[14].id }).error, 'too-far');
  assert.equal(player.shrineSeat, outer.id);
  f.request('b', { action: 'stand' });
  assert.equal(f.request('a', { action: 'sit', seatId: inner.id }).changed, true);
  assert.equal(player.shrineSeat, inner.id);
  assert.deepEqual(f.activity.snapshot(START).seats.filter((seat) => seat.occupant), [{ id: inner.id, occupant: 'a' }]);
});

test('stand releases the seat and restores a nearby collision-safe floor position', () => {
  const f = fixture();
  const player = f.seat('a');
  f.request('a', { action: 'gesture', gesture: 'pray' });
  assert.equal(f.request('a', { action: 'stand' }).changed, true);
  assert.equal(player.shrineSeat, '');
  assert.equal(player.shrineGesture, '');
  assert.equal(player.shrineGestureAt, 0);
  assert.deepEqual({ x: player.x, z: player.z }, shrineStandingPoint(outer));
  for (const seat of SHRINE_SEATS) {
    const p = shrineStandingPoint(seat);
    assert.ok(Math.hypot(p.x - SHRINE_CENTER.x, p.z) <= SHRINE_RADIUS);
    assert.ok(Math.hypot(p.x - SHRINE_CENTER.x, p.z) >= 1.2);
    assert.ok(Math.abs(Math.hypot(p.x - seat.x, p.z - seat.z) - 0.9) < 0.00001);
  }
  assert.equal(f.request('a', { action: 'stand' }).changed, false);
});

test('exit works anywhere in the shrine, clears a reserved seat and never returns inside a cave collider', () => {
  const f = fixture();
  const player = f.seat('a');
  assert.equal(f.request('a', { action: 'exit' }).changed, true);
  assert.equal(isInShrine(player), false);
  assert.equal(player.shrineSeat, '');
  assert.deepEqual({ x: player.x, z: player.z }, shrineReturnPoint());
  assert.ok(Math.hypot(player.x, player.z) <= HUB_LAYOUT.radius);
  for (const o of HUB_LAYOUT.obstacles) assert.ok(Math.hypot(player.x - o.x, player.z - o.z) >= o.r - 0.00001);
  assert.ok(f.activity.snapshot(START).seats.every((seat) => seat.occupant === null));
  assert.equal(f.request('a', { action: 'exit' }).error, 'outside-shrine');
});

test('only seated players can gesture, timestamps are server-owned and animations expire after three seconds', () => {
  const f = fixture();
  const player = f.add('a', { x: outer.x, z: outer.z });
  assert.equal(f.request('a', { action: 'gesture', gesture: 'pray' }).error, 'not-seated');
  f.request('a', sit);
  assert.equal(f.request('a', { action: 'gesture', gesture: 'pray' }).changed, true);
  assert.equal(player.shrineGestureAt, START);
  assert.equal(player.shrineGesture, 'pray');
  assert.equal(f.activity.advance(START + SHRINE_GESTURE_MS - 1, f.lookup).changed, false);
  assert.equal(f.activity.advance(START + SHRINE_GESTURE_MS, f.lookup).changed, true);
  assert.equal(player.shrineGesture, '');
  assert.equal(player.shrineGestureAt, 0);
  f.request('a', { action: 'gesture', gesture: 'bow' }, START + 4_000);
  assert.equal(player.shrineGesture, 'bow');
  assert.equal(player.shrineGestureAt, START + 4_000);
});

test('invalid payloads consume request budget and one player cannot exhaust another player budget', () => {
  const f = fixture();
  f.add('a'); f.add('b');
  for (let i = 0; i < SHRINE_LIMIT.capacity; i++) assert.equal(f.request('a', { action: 'enter', x: 48 }).error, 'invalid-request');
  assert.equal(f.request('a', { action: 'enter' }).error, 'rate-limit');
  assert.equal(f.request('b', { action: 'enter' }).changed, true);
  assert.equal(f.request('a', { action: 'enter' }, START + 500).changed, true);
});

test('disconnection, revocation, missing players and wrong-zone players are swept without reclaiming seats', () => {
  for (const reason of ['disconnect', 'revoked', 'missing', 'wrong-zone', 'invalid-pose']) {
    const f = fixture();
    const player = f.seat('a');
    if (reason === 'disconnect') player.connected = false;
    if (reason === 'revoked') f.actors.get('a')!.activeSeat = false;
    if (reason === 'missing') f.actors.delete('a');
    if (reason === 'wrong-zone') Object.assign(player, SHRINE_PORTAL);
    if (reason === 'invalid-pose') player.shrineSeat = '';
    assert.equal(f.activity.advance(START, f.lookup).changed, true, reason);
    assert.ok(f.activity.snapshot(START).seats.every((seat) => seat.occupant === null), reason);
    if (reason !== 'missing') {
      player.connected = true;
      f.actors.get('a')!.activeSeat = true;
      assert.equal(player.shrineSeat, '');
      assert.equal(f.activity.advance(START + 1, f.lookup).changed, false);
    }
  }
});

test('snapshots cannot mutate reservations and separate rooms never share occupancy', () => {
  const f = fixture();
  f.seat('a');
  const snapshot = f.activity.snapshot(START);
  assert.equal(snapshot.serverNow, START);
  snapshot.seats[8].occupant = 'forged';
  snapshot.seats.pop();
  assert.equal(f.activity.snapshot(START).seats.length, 20);
  assert.equal(f.activity.snapshot(START).seats[8].occupant, 'a');
  assert.ok(fixture().activity.snapshot(START).seats.every((seat) => seat.occupant === null));
});

test('shared shrine movement preserves cave behavior and freezes all seated input', () => {
  const a = { x: 0, z: -8 }, b = { ...a };
  const command = { moveX: 127, moveZ: -80 };
  applyInput(a, command, 0.05);
  applyShrineAwareInput(b, command, 0.05);
  assert.deepEqual(a, b);
  const seated = { x: outer.x, z: outer.z, shrineSeat: outer.id };
  applyShrineAwareInput(seated, command, 100);
  assert.deepEqual(seated, { x: outer.x, z: outer.z, shrineSeat: outer.id });
});

test('shrine movement is deterministic, stays on its floor and cannot pass through the statue or into cave', () => {
  for (const command of [{ moveX: 127, moveZ: 0 }, { moveX: -127, moveZ: 127 }, { moveX: 0, moveZ: -127 }]) {
    const a = { ...SHRINE_ENTRY } as { x: number; z: number }, b = { ...a };
    for (let i = 0; i < 150; i++) {
      applyShrineAwareInput(a, command, 0.05);
      applyShrineAwareInput(b, command, 0.05);
      assert.deepEqual(a, b);
      const radius = Math.hypot(a.x - SHRINE_CENTER.x, a.z);
      assert.ok(radius <= SHRINE_RADIUS + 0.00001);
      assert.ok(radius >= 1.2 - 0.00001);
      assert.ok(isInShrine(a));
      assert.equal(a.x, Math.fround(a.x));
      assert.equal(a.z, Math.fround(a.z));
    }
  }
  const center = constrainShrine(SHRINE_CENTER.x, SHRINE_CENTER.z);
  assert.ok(Math.hypot(center.x - SHRINE_CENTER.x, center.z) >= 1.2 - 0.00001);
});

/** Room wiring without networking, dev-key generation, database or live security services. */
async function roomFixture(t: TestContext) {
  const publicJwks = process.env.TICKET_PUBLIC_JWKS;
  process.env.TICKET_PUBLIC_JWKS = '{"keys":[]}';
  let module: typeof import('../apps/game/src/HubRoom.js');
  try { module = await import('../apps/game/src/HubRoom.js'); }
  finally {
    if (publicJwks === undefined) delete process.env.TICKET_PUBLIC_JWKS;
    else process.env.TICKET_PUBLIC_JWKS = publicJwks;
  }
  const room = new module.HubRoom();
  const broadcast: { type: string | number; value: unknown }[] = [];
  let step: Parameters<typeof room.setFixedTimestep>[0] = () => {};
  t.mock.method(room, 'setFixedTimestep', (callback: typeof step) => { step = callback; });
  t.mock.method(room, 'broadcast', (type: string | number, value: unknown) => { broadcast.push({ type, value }); });
  room.presence = new LocalPresence();
  room.onCreate();
  const add = (id: string) => {
    const sent: { type: string | number; value: unknown }[] = [], left: unknown[][] = [];
    const client = {
      sessionId: id, auth: { id: `shrine-test-${id}`, name: id, trust: 0 },
      send: (type: string | number, value: unknown) => { sent.push({ type, value }); },
      leave: (...args: unknown[]) => { left.push(args); },
    } as unknown as Client;
    const player = new module.Player();
    player.name = id; player.x = SHRINE_PORTAL.x; player.z = SHRINE_PORTAL.z;
    room.state.players.set(id, player);
    room.clients.push(client);
    const lease = { active: true, release: async () => {} } as unknown as SeatLease;
    room['leases'].set(id, lease);
    return { client, player, lease, sent, left };
  };
  const send = (client: Client, type: string, raw?: unknown) => room['onMessageEvents'].emit(type, client, raw);
  const tick = (command: Axes) => {
    t.mock.method(room.inputs, 'get', () => ({ next: () => command }));
    step({ dt: 0.05, dtMs: 50, tick: 1, subSteps: 1, subDt: 0.05, subDtMs: 50 });
  };
  t.after(() => { room.clock.clear(); room.clock.stop(); room.onDispose(); });
  return { room, add, send, broadcast, tick };
}

test('room shrineSync repairs initial listener races, validates active membership and limits repeated reads', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t), a = f.add('a');
  f.send(a.client, 'shrineSync');
  const state = a.sent[0].value as ShrineSnapshot;
  assert.equal(a.sent[0].type, 'shrineState');
  assert.equal(state.serverNow, START);
  assert.equal(state.seats.length, 20);
  f.send(a.client, 'shrineSync'); f.send(a.client, 'shrineSync');
  assert.equal(a.sent.length, 2);
  const offline = f.add('offline'); offline.player.connected = false;
  f.send(offline.client, 'shrineSync'); assert.equal(offline.sent.length, 0);
  const revoked = f.add('revoked'); Object.defineProperty(revoked.lease, 'active', { value: false });
  f.send(revoked.client, 'shrineSync'); assert.equal(revoked.sent.length, 0);
});

test('room entry leaves the legacy altar, seat changes broadcast and server ticks cannot move a seated player', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t), a = f.add('a');
  a.player.x = ALTAR_CENTER.x; a.player.z = ALTAR_CENTER.z;
  f.send(a.client, 'altar', { action: 'join', preset: 'prayer' });
  assert.equal(f.room['altar'].snapshot(START).participantCount, 1);
  a.player.x = SHRINE_PORTAL.x; a.player.z = SHRINE_PORTAL.z;
  f.send(a.client, 'shrine', { action: 'enter' });
  assert.equal(f.room['altar'].snapshot(START).participantCount, 0);
  assert.equal(isInShrine(a.player), true);
  f.send(a.client, 'shrine', sit);
  assert.equal(a.player.shrineSeat, outer.id);
  assert.equal(f.broadcast.at(-1)?.type, 'shrineState');
  f.tick({ moveX: 127, moveZ: 127 });
  assert.equal(a.player.x, outer.x); assert.equal(a.player.z, outer.z);
  f.send(a.client, 'shrine', { action: 'gesture', gesture: 'bow' });
  assert.equal(a.player.shrineGestureAt, START, 'schema stores epoch milliseconds without float32 truncation');
  f.send(a.client, 'shrine', { action: 'stand' });
  const stood = { x: a.player.x, z: a.player.z };
  f.tick({ moveX: 127, moveZ: 0 });
  assert.ok(a.player.x > stood.x);
  assert.ok(isInShrine(a.player));
});

test('room drop releases immediately and reconnect sends occupancy without restoring an old seat', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t), a = f.add('a'), b = f.add('b');
  f.send(a.client, 'shrine', { action: 'enter' }); f.send(a.client, 'shrine', sit);
  const reconnect = new Deferred<Client>();
  t.mock.method(f.room, 'allowReconnection', () => reconnect);
  const drop = f.room.onDrop(a.client);
  assert.equal(a.player.shrineSeat, ''); assert.equal(a.player.connected, false);
  assert.equal(f.room['shrine'].snapshot(START).seats[8].occupant, null);
  f.send(b.client, 'shrine', { action: 'enter' }); f.send(b.client, 'shrine', sit);
  reconnect.resolve(a.client); await drop; f.room.onReconnect(a.client);
  assert.equal(a.player.connected, true); assert.equal(a.player.shrineSeat, '');
  const state = a.sent.filter((message) => message.type === 'shrineState').at(-1)!.value as ShrineSnapshot;
  assert.equal(state.seats[8].occupant, 'b');
});

test('room eviction and final leave release reservations and never resync a revoked reconnect', async (t) => {
  t.mock.method(Date, 'now', () => START);
  const f = await roomFixture(t), a = f.add('a');
  f.send(a.client, 'shrine', { action: 'enter' }); f.send(a.client, 'shrine', sit);
  Object.defineProperty(a.lease, 'active', { value: false });
  f.room.onReconnect(a.client);
  assert.equal(a.player.connected, false); assert.equal(a.player.shrineSeat, '');
  assert.equal(a.left.length, 1); assert.equal(a.sent.length, 0);
  assert.equal(f.room['shrine'].snapshot(START).seats[8].occupant, null);
  const b = f.add('b');
  f.send(b.client, 'shrine', { action: 'enter' }); f.send(b.client, 'shrine', sit);
  await f.room.onLeave(b.client);
  assert.equal(f.room.state.players.has('b'), false);
  assert.ok(f.room['shrine'].snapshot(START).seats.every((seat) => seat.occupant === null));
});
