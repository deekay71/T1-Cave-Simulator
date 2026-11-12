import assert from 'node:assert/strict';
import test from 'node:test';
import { CAVE_SEATS, CAVE_SEAT_REACH, CaveSeating, CaveSeatRequest, HUB_PLACEMENTS, caveSeat } from '../packages/shared/src/index.js';

const player = (x: number, z: number) => ({ x, z, seat: '', seatYaw: 0 });

test('cave seats: stools, crates and low stones without an NPC or anything on top', () => {
  assert.ok(CAVE_SEATS.length >= 30, `${CAVE_SEATS.length} seats`);
  assert.equal(new Set(CAVE_SEATS.map(s => s.id)).size, CAVE_SEATS.length);
  for (const s of CAVE_SEATS) {
    assert.ok(s.h >= 0.24 && s.h <= 0.85, `${s.id} height ${s.h}`);
    assert.equal(caveSeat(s.id), s);
    for (const p of HUB_PLACEMENTS) if (p.npc) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= 0.55, `${s.id} under an NPC`);
  }
  assert.equal(caveSeat('nope'), undefined);
});

test('seat requests are strict', () => {
  assert.equal(CaveSeatRequest.safeParse({ action: 'sit', seatId: 's1' }).success, true);
  assert.equal(CaveSeatRequest.safeParse({ action: 'stand' }).success, true);
  for (const raw of [{ action: 'sit' }, { action: 'sit', seatId: '' }, { action: 'stand', seatId: 's1' }, { action: 'lie' }, null])
    assert.equal(CaveSeatRequest.safeParse(raw).success, false);
});

test('sitting moves the player onto the seat, one player per seat; standing returns them', () => {
  const seats = new CaveSeating(), seat = CAVE_SEATS[0];
  const a = player(seat.x + 1, seat.z), b = player(seat.x, seat.z + 1);
  assert.equal(seats.sit('a', player(seat.x + CAVE_SEAT_REACH + 0.2, seat.z), seat.id), 'too-far');
  assert.equal(seats.sit('a', a, 'nope'), 'unknown-seat');
  assert.equal(seats.sit('a', a, seat.id), null);
  assert.deepEqual([a.x, a.z, a.seat, a.seatYaw], [seat.x, seat.z, seat.id, 90]); // faces where they stood (+X)
  assert.equal(seats.sit('a', a, seat.id), null); // idempotent
  assert.equal(seats.sit('b', b, seat.id), 'occupied-seat');
  assert.equal(b.seat, '');
  assert.equal(seats.stand('b', b), 'not-seated');
  assert.equal(seats.stand('a', a), null);
  assert.deepEqual([a.x, a.z, a.seat], [Math.fround(seat.x + 1), seat.z, '']);
  assert.equal(seats.sit('b', b, seat.id), null);
  seats.forget('b');
  assert.equal(seats.occupant(seat.id), undefined);
});

test('switching seats measures the reach from where the player stood, and frees the old seat', () => {
  const seats = new CaveSeating();
  const first = CAVE_SEATS[0];
  const near = CAVE_SEATS.find(s => s !== first && Math.hypot(s.x - first.x, s.z - first.z) < 3);
  const p = player(first.x + 0.9, first.z);
  assert.equal(seats.sit('a', p, first.id), null);
  const far = CAVE_SEATS.find(s => Math.hypot(s.x - first.x, s.z - first.z) > 10)!;
  assert.equal(seats.sit('a', p, far.id), 'too-far');
  assert.equal(p.seat, first.id);
  if (near && Math.hypot(near.x - (first.x + 0.9), near.z - first.z) <= CAVE_SEAT_REACH) {
    assert.equal(seats.sit('a', p, near.id), null);
    assert.equal(seats.occupant(first.id), undefined);
    assert.equal(seats.occupant(near.id), 'a');
  }
});
