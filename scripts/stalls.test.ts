import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_LANDMARKS, constrain } from '../packages/shared/src/index.js';
import { CAVE_STALLS, CAVE_STALL_RADIUS, closestCaveStall, nearCaveStall, stallApproach } from '../packages/shared/src/stalls.js';
import { SHRINE_PORTAL, nearShrinePortal, shrineReturnPoint } from '../packages/shared/src/shrine.js';

test('five distinct cave stalls map physical hosts to one shared proximity and landmark', () => {
  assert.deepEqual(CAVE_STALLS.map(s => s.id), ['checkin', 'shop', 'quiz', 'tv', 'memory']);
  assert.deepEqual(CAVE_STALLS.slice(0, 4).map(s => s.npc), ['Oner', 'Peyz', 'Keria', 'Doran']);
  for (const stall of CAVE_STALLS) {
    const p = stallApproach(stall);
    const landmark = HUB_LANDMARKS.find(l => l.id === stall.id)!;
    assert.equal(landmark.x, p.x); assert.equal(landmark.z, p.z);
    assert.deepEqual(constrain(p.x, p.z), p);
    assert.equal(closestCaveStall(p)?.id, stall.id);
    assert.equal(nearCaveStall(p, stall.id), true);
    assert.equal(nearCaveStall({ x: p.x + CAVE_STALL_RADIUS - .001, z: p.z }, stall.id), true);
    assert.equal(nearCaveStall({ x: p.x + CAVE_STALL_RADIUS + .001, z: p.z }, stall.id), false);
    for (const x of [NaN, Infinity, -Infinity]) assert.equal(nearCaveStall({ x, z: p.z }, stall.id), false);
  }
  assert.equal(closestCaveStall({ x: NaN, z: 0 }), null);
  assert.equal(closestCaveStall({ x: 48, z: 0 }), null);
});

test('shrine destination is the cave wall doorway and its return point is reachable', () => {
  assert.ok(Math.hypot(SHRINE_PORTAL.x, SHRINE_PORTAL.z) > 14);
  const landmark = HUB_LANDMARKS.find(l => l.id === 'altar')!;
  assert.equal(landmark.x, SHRINE_PORTAL.x); assert.equal(landmark.z, SHRINE_PORTAL.z);
  assert.equal(nearShrinePortal(landmark), true);
  const p = shrineReturnPoint();
  assert.deepEqual(constrain(p.x, p.z), p);
  assert.equal(nearShrinePortal(p), true);
});
