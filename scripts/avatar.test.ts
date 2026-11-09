import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEG,
  WALK_DEFAULT,
  footLow,
  groundedHipsY,
  hash32,
  legAngles,
  pickIndex,
  strideAmplitude,
  strideFor,
  type FootPoint,
  type LegAngles,
} from "../apps/web/src/avatarMath.js";

test("hash32 / pickIndex ổn định và trải đều (cùng session id → cùng trang phục)", () => {
  assert.equal(hash32("abc"), hash32("abc"));
  assert.notEqual(hash32("abc"), hash32("abd"));
  assert.equal(pickIndex("x", 0), 0);
  // pinned values: changing the hash would reshuffle every player's outfit between builds
  assert.equal(hash32(""), 2872998923);
  assert.equal(hash32("abc"), 482950588);
  assert.equal(hash32("Qw3rTy9Zx"), 885861890);
  assert.equal(pickIndex("abc", 7), 1);
  assert.equal(pickIndex("h7Kd0LmPq", 7), 1893980953 % 7);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 7000; i++) counts[pickIndex(`s${i.toString(36)}x${(i * 7919) % 1000}`, 7)]++;
  for (const c of counts) assert.ok(c > 850 && c < 1150, `bucket ${c}`);
});

test("đứng thẳng: hông 0,94 m, đế giày chạm sàn", () => {
  const f: FootPoint = { y: 0, z: 0, corner: 0 };
  assert.ok(Math.abs(groundedHipsY(0, 0, 0, 0, f) - LEG.hipsY) < 1e-12);
  footLow(0, 0, f);
  assert.ok(Math.abs(f.y + LEG.shin + LEG.thigh) < 1e-12);
});

test("tư thế walk_a của manifest: gót trước và mũi sau gần sàn ở hông ~0,936", () => {
  const f: FootPoint = { y: 0, z: 0, corner: 0 };
  const front = footLow(WALK_DEFAULT.frontThigh, WALK_DEFAULT.frontKnee, f);
  assert.equal(front.corner, 0); // heel
  const frontY = 0.936 - LEG.hipDrop + front.y;
  const back = footLow(WALK_DEFAULT.backThigh, WALK_DEFAULT.backKnee, { y: 0, z: 0, corner: 0 });
  assert.equal(back.corner, 1); // toe
  const backY = 0.936 - LEG.hipDrop + back.y;
  assert.ok(Math.abs(frontY) < 0.015 && Math.abs(backY) < 0.015, `${frontY} ${backY}`);
});

/** Simulate one cycle at speed v and measure what the eye would notice. */
function simulate(v: number) {
  const st = strideFor(strideAmplitude(v));
  const period = (2 * st.length) / v;
  const L: LegAngles = { thigh: 0, knee: 0, stance: true };
  const R: LegAngles = { thigh: 0, knee: 0, stance: true };
  const tmp: FootPoint = { y: 0, z: 0, corner: 0 };
  const f: FootPoint = { y: 0, z: 0, corner: 0 };
  let minKnee = Infinity,
    minFootY = Infinity,
    maxSlip = 0,
    hipsMin = Infinity,
    hipsMax = -Infinity;
  let prev: { z: number; corner: number } | null = null;
  const n = 4000;
  for (let i = 0; i <= n; i++) {
    const phase = i / n;
    legAngles(phase, st, WALK_DEFAULT, L);
    legAngles(phase + 0.5, st, WALK_DEFAULT, R);
    minKnee = Math.min(minKnee, L.knee, R.knee);
    const hips = groundedHipsY(L.thigh, L.knee, R.thigh, R.knee, tmp);
    hipsMin = Math.min(hipsMin, hips);
    hipsMax = Math.max(hipsMax, hips);
    footLow(L.thigh, L.knee, f);
    const y = hips - LEG.hipDrop + f.y;
    minFootY = Math.min(minFootY, y);
    const z = v * phase * period + f.z; // world z of the touching corner
    if (L.stance && y < 0.003) {
      if (prev && prev.corner === f.corner) maxSlip = Math.max(maxSlip, Math.abs(z - prev.z) / (period / n));
      prev = { z, corner: f.corner };
    } else prev = null;
  }
  return { st, period, minKnee, minFootY, maxSlip, bob: hipsMax - hipsMin };
}

test("bước đi: chân trụ không trượt, gối không gập ngược, giày không xuyên sàn", () => {
  for (const v of [0.5, 1, 2, 3, 4]) {
    const s = simulate(v);
    assert.ok(s.minKnee >= 0, `knee ${s.minKnee}`);
    assert.ok(s.minFootY > -1e-9, `foot under the floor ${s.minFootY}`);
    assert.ok(s.maxSlip < 0.08 * v + 0.02, `v ${v}: slip ${s.maxSlip} m/s`);
    assert.ok(s.bob < 0.08, `bob ${s.bob}`);
  }
});

test("đi chậm thì bước ngắn và nhịp chậm hơn", () => {
  const cadence = (v: number) => v / (2 * strideFor(strideAmplitude(v)).length);
  const c1 = cadence(1),
    c2 = cadence(2),
    c4 = cadence(4);
  assert.ok(c1 < c2 && c2 < c4);
  assert.ok(c4 > 1.8 && c4 < 2.8, `cadence at 4 m/s ${c4} Hz`);
  assert.ok(strideFor(strideAmplitude(1)).length < strideFor(strideAmplitude(4)).length);
});
