import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUB_CAVES, HUB_CAVE_GATES, HUB_LANDMARKS, HUB_QUEST_BOARD, HUB_SCREENS, SCREEN_SPOT, HUB_LAYOUT, HUB_PLACEMENTS, HUB_ROOMS, HUB_SCREEN, HUB_SPAWN, HUB_STALL_HOSTS, HUB_STALL_SIGNS, HUB_ZONES, CAVE_CAMERA_MARGIN, CAVE_CAMERA_TOP, SCREEN_WALL, SIDE_CAVE_RADIUS, STALL_SIGN_BOARD, STALL_SIGN_BOARDS, constrain, inRooms, placementObstacles } from '../packages/shared/src/index.js';
import { COSMETICS } from '../packages/shared/src/progression.js';
import { CAVE_STALLS, CAVE_STALL_RADIUS, closestCaveStall, nearCaveStall, stallApproach } from '../packages/shared/src/stalls.js';
import { SHRINE_PORTAL, nearShrinePortal, shrineReturnPoint } from '../packages/shared/src/shrine.js';

test('five distinct cave stalls map physical hosts to one shared proximity and landmark', () => {
  assert.deepEqual(CAVE_STALLS.map(s => s.id), ['checkin', 'shop', 'quiz', 'quest', 'memory']);
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
  assert.equal(closestCaveStall({ x: 120, z: 0 }), null);
});

test('check-in stays by the spawn in the main cave; the other four stalls each own a side cave', () => {
  const checkin = stallApproach(CAVE_STALLS[0]);
  assert.ok(Math.hypot(checkin.x, checkin.z) < HUB_LAYOUT.radius - 1);
  assert.ok(Math.hypot(checkin.x - HUB_LAYOUT.spawn.x, checkin.z - HUB_LAYOUT.spawn.z) < 6, 'check-in is near the spawn');
  assert.deepEqual(HUB_CAVES.map(c => [c.id, c.stall, c.name]), [
    ['ne_back', 'quest', 'Hang Quest'],
    ['nw_back', 'memory', 'Hang ký ức'],
    ['nw_front', 'quiz', 'Hang đố vui'],
    ['ne_front', 'shop', 'Hang chợ'],
  ]);
  for (const cave of HUB_CAVES) {
    const stall = CAVE_STALLS.find(s => s.id === cave.stall)!;
    const inCave = (p: { x: number; z: number }, slack = 0) => Math.hypot(p.x - cave.x, p.z - cave.z) <= SIDE_CAVE_RADIUS + slack;
    assert.ok(inCave(stallApproach(stall)), `${stall.id}: approach point outside ${cave.id}`);
    // Sign and host stand in the same cave (the sign may stand in the niche, just beyond the walk disc).
    assert.ok(inCave(HUB_STALL_SIGNS[stall.id], 1.2), `${stall.id}: sign outside ${cave.id}`);
    assert.ok(inCave(HUB_STALL_HOSTS[stall.id], 0.5), `${stall.id}: host outside ${cave.id}`);
    assert.equal(HUB_ZONES[stall.id], stall);
    // No two approach discs overlap, and none reaches the main cave.
    for (const other of CAVE_STALLS) if (other !== stall) {
      const a = stallApproach(stall), b = stallApproach(other);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2 * CAVE_STALL_RADIUS);
    }
    assert.ok(Math.hypot(stallApproach(stall).x, stallApproach(stall).z) > HUB_LAYOUT.radius + CAVE_STALL_RADIUS + 5);
  }
  // The crate corner left of the fire is decoration only: no sign, no host, no landmark there. No
  // CRT is placed anywhere any more: one wall screen in the main cave replaced them.
  const corner = HUB_ZONES.crateCorner;
  assert.ok(Math.hypot(corner.x, corner.z) < 10 && corner.x < 0);
  assert.equal(HUB_PLACEMENTS.filter(p => p.asset === 'props/tl_prop_tv_crt_v01').length, 0);
  for (const p of HUB_PLACEMENTS) if (/tl_sign_stall|tl_char_host_/.test(p.asset) && !p.asset.includes('host_oner'))
    assert.ok(Math.hypot(p.x, p.z) > HUB_LAYOUT.radius, `${p.asset} still stands in the main cave`);
  for (const l of HUB_LANDMARKS) assert.ok(Math.hypot(l.x - corner.x, l.z - corner.z) > 6, l.id);
  // Hang Quest (the former match cave) has a quest board deep in its niche, facing the cave centre,
  // behind the sign; it adds no obstacle of its own (its camera circles are the sign posts). The only
  // screen left is the big one of the main cave, and standing in front of it opens the match panel.
  const quest = HUB_CAVES.find(c => c.stall === 'quest')!;
  assert.ok(HUB_PLACEMENTS.includes(HUB_QUEST_BOARD));
  assert.deepEqual(HUB_SCREENS, [HUB_SCREEN]);
  assert.equal(HUB_PLACEMENTS.filter(p => /wall_screen_small/.test(p.asset)).length, 0);
  const depth = Math.hypot(HUB_QUEST_BOARD.x - quest.x, HUB_QUEST_BOARD.z - quest.z);
  assert.ok(depth > 9.8 && depth < 10.3, `quest board ${depth} m from the cave centre`);
  assert.equal(HUB_QUEST_BOARD.yaw, quest.nicheYaw);
  assert.ok(depth > Math.hypot(HUB_STALL_SIGNS.quest.x - quest.x, HUB_STALL_SIGNS.quest.z - quest.z) + 1.5);
  assert.deepEqual(placementObstacles(HUB_QUEST_BOARD), placementObstacles(HUB_STALL_SIGNS.quest));
  const board = stallManifest('furniture').get(HUB_QUEST_BOARD.asset) as unknown as { meta: { board: { width: number; lift: number }; postColliders?: unknown } };
  assert.ok(board && board.meta.board.width <= 2.4 && board.meta.board.lift >= 0.9 && board.meta.postColliders === undefined);
  const spot = HUB_LANDMARKS.find(l => l.id === 'screen')!;
  assert.deepEqual({ x: spot.x, z: spot.z }, { x: SCREEN_SPOT.x, z: SCREEN_SPOT.z });
  const toScreen = Math.hypot(spot.x - HUB_SCREEN.x, spot.z - HUB_SCREEN.z);
  assert.ok(toScreen > 2.5 && toScreen < 5.5, `screen spot ${toScreen} m from the screen`);
  for (const o of HUB_LAYOUT.obstacles) assert.ok(Math.hypot(spot.x - o.x, spot.z - o.z) > o.r + 0.3, 'screen spot is free');
  // Every side cave is lit: at least two torches / lanterns of the placement table stand in it.
  for (const cave of HUB_CAVES) {
    const lights = HUB_PLACEMENTS.filter(p => /^fire\/tl_fx_(torch|lantern)/.test(p.asset) && (p.light ?? 1) > 0 && Math.hypot(p.x - cave.x, p.z - cave.z) < 8.2);
    assert.ok(lights.length >= 2 && lights.length <= 5, `${cave.id}: ${lights.length} lights`);
    // ... and every collider in it is reachable-side geometry: nothing blocks the cave centre.
    for (const p of HUB_PLACEMENTS) for (const o of placementObstacles(p))
      assert.ok(Math.hypot(o.x - cave.x, o.z - cave.z) > o.r + 0.5 || !inRooms(o.x, o.z, HUB_ROOMS), `${p.asset} blocks the centre of ${cave.id}`);
  }
});

test('shrine destination is the cave wall doorway and its return point is reachable', () => {
  // Just inside the walk limit of the main cave (r = 20), in front of the exit tunnel at -Z.
  assert.ok(Math.hypot(SHRINE_PORTAL.x, SHRINE_PORTAL.z) > HUB_LAYOUT.radius - 1);
  assert.ok(Math.hypot(SHRINE_PORTAL.x, SHRINE_PORTAL.z) <= HUB_LAYOUT.radius);
  assert.ok(SHRINE_PORTAL.z < 0 && SHRINE_PORTAL.x === 0);
  const landmark = HUB_LANDMARKS.find(l => l.id === 'altar')!;
  assert.equal(landmark.x, SHRINE_PORTAL.x); assert.equal(landmark.z, SHRINE_PORTAL.z);
  assert.equal(nearShrinePortal(landmark), true);
  const p = shrineReturnPoint();
  assert.deepEqual(constrain(p.x, p.z), p);
  assert.equal(nearShrinePortal(p), true);
});

/* ------------------------------------------------- stall structures, signs and hosts */

interface StallManifestAsset {
  name: string;
  triangles: number;
  budget: number;
  bounds: { min: number[]; max: number[] };
  poses?: Record<string, unknown>;
  meta?: {
    kind?: string;
    sign?: { faces: { center: number[]; size: number[]; normal: number[]; up: number[] }[]; planks: { y0: number; y1: number; color: string }[] };
    postColliders?: { center: number[]; radius: number }[];
  };
}
const stallManifest = (group: string) => new Map<string, StallManifestAsset>(
  (JSON.parse(readFileSync(new URL(`../apps/web/public/models/manifest.${group}.json`, import.meta.url), 'utf8')) as { assets: StallManifestAsset[] })
    .assets.map(a => [`${group}/${a.name}`, a] as const),
);

test('every stall has a GLB sign board whose painted faces match the shared board table', () => {
  const furniture = stallManifest('furniture');
  for (const stall of CAVE_STALLS) {
    const p = HUB_STALL_SIGNS[stall.id];
    assert.ok(HUB_PLACEMENTS.includes(p), `${stall.id}: sign model is not placed`);
    const asset = furniture.get(p.asset);
    assert.ok(asset, `${p.asset} missing from manifest.furniture.json`);
    assert.ok(asset.triangles <= asset.budget && asset.budget <= 1500, `${p.asset}: ${asset.triangles} triangles`);
    const board = STALL_SIGN_BOARDS[p.asset];
    assert.ok(board, `${p.asset}: no entry in STALL_SIGN_BOARDS`);
    const sign = asset.meta?.sign;
    assert.ok(sign && sign.faces.length === 2 && sign.planks.length >= 3, `${p.asset}: meta.sign`);
    const [front, back] = sign.faces;
    // One face per side, facing opposite ways: text is painted per side and never mirrored.
    assert.deepEqual(front.normal, [0, 0, 1]);
    assert.deepEqual(back.normal, [0, 0, -1]);
    for (const face of sign.faces) {
      assert.deepEqual(face.up, [0, 1, 0]);
      assert.ok(Math.abs(face.center[2] - board.z) < 0.05, `${p.asset}: board plane`);
      assert.ok(Math.abs(face.center[1] - (STALL_SIGN_BOARD.bottom + STALL_SIGN_BOARD.height / 2)) < 0.01);
      assert.ok(face.size[0] <= 2 * board.half && face.size[0] > 2 * board.half - 0.5, `${p.asset}: face width ${face.size[0]}`);
      assert.ok(Math.abs(face.size[1] - STALL_SIGN_BOARD.height) < 0.03);
    }
    for (const k of sign.planks) assert.match(k.color, /^#[0-9a-f]{6}$/i);
    // The model's own colliders are exactly its two posts (thin camera blockers, see layout.ts).
    const posts = asset.meta?.postColliders ?? [];
    assert.equal(p.colliders?.length, posts.length);
    posts.forEach((post, i) => {
      const c = p.colliders![i];
      assert.ok(Math.hypot(c.dx - post.center[0], c.dz - post.center[2]) < 0.05, `${p.asset}: post ${i}`);
    });
    // The board faces the approach point (within 60 degrees), so the name reads from where players stand.
    const a = stallApproach(stall);
    const yaw = p.yaw * Math.PI / 180;
    const boardAt = { x: p.x + Math.sin(yaw) * board.z, z: p.z + Math.cos(yaw) * board.z };
    const d = Math.hypot(a.x - boardAt.x, a.z - boardAt.z);
    assert.ok(((a.x - boardAt.x) * Math.sin(yaw) + (a.z - boardAt.z) * Math.cos(yaw)) / d > 0.5, `${stall.id}: sign turned away`);
  }
});

test('stall hosts are rigged NPC placements with a standing pose, never player outfits', () => {
  const characters = stallManifest('characters');
  for (const stall of CAVE_STALLS) {
    const p = HUB_STALL_HOSTS[stall.id];
    assert.ok(HUB_PLACEMENTS.includes(p), `${stall.id}: host is not placed`);
    assert.match(p.asset, /^characters\/tl_char_host_[a-z]+_v01$/);
    const asset = characters.get(p.asset);
    assert.ok(asset, `${p.asset} missing from manifest.characters.json`);
    assert.equal(asset.meta?.kind, 'host');
    assert.ok(p.npc && asset.poses && p.npc.pose in asset.poses, `${p.asset}: pose ${p.npc?.pose}`);
    assert.match(p.npc.pose, /^host_/);
    // Within reach of the approach point and facing it (within 75 degrees).
    const a = stallApproach(stall);
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    assert.ok(d < 3.2, `${stall.id}: host ${d.toFixed(2)} m from the approach point`);
    const yaw = p.yaw * Math.PI / 180;
    assert.ok(((a.x - p.x) * Math.sin(yaw) + (a.z - p.z) * Math.cos(yaw)) / d > 0.25, `${stall.id}: host looks away`);
  }
  // Player outfits come from the fixed AVATAR_VARIANTS list and the cosmetics catalogue only.
  const avatar = readFileSync(new URL('../apps/web/src/avatar.ts', import.meta.url), 'utf8');
  assert.ok(!avatar.includes('tl_char_host_'), 'avatar.ts must not hand host models to players');
  for (const item of COSMETICS) assert.ok(!item.assetKey.includes('_host_'), item.id);
  const variants = [...avatar.matchAll(/"(tl_char_[a-z_]+_v01)"/g)].map(m => m[1]);
  assert.ok(variants.length >= 7);
  for (const v of variants) assert.equal(characters.get(`characters/${v}`)?.meta?.kind, 'avatar', v);
});

test('the stall renderer builds no box-primitive stalls or hosts', () => {
  const source = readFileSync(new URL('../apps/web/src/world/stalls.ts', import.meta.url), 'utf8');
  assert.ok(!/type:\s*['"](box|plane)['"]/.test(source));
});

test('every tunnel mouth has a name gate the player and the camera pass under', () => {
  const asset = stallManifest('furniture').get('furniture/tl_sign_cave_gate_v01') as (StallManifestAsset & { meta: { gate: { postHalf: number; clearHeight: number } } }) | undefined;
  assert.ok(asset, 'tl_sign_cave_gate_v01 missing from manifest.furniture.json');
  const { postHalf, clearHeight } = asset.meta.gate;
  // The board hangs above the camera ceiling of the tunnels, with two text faces (front and back).
  assert.ok(clearHeight > CAVE_CAMERA_TOP.tunnel + 0.4);
  const faces = asset.meta.sign?.faces ?? [];
  assert.equal(faces.length, 2);
  assert.ok(faces.every(f => f.center[1] - f.size[1] / 2 >= clearHeight - 0.01));
  for (const cave of HUB_CAVES) {
    const gate = HUB_CAVE_GATES[cave.id];
    assert.equal(gate.asset, 'furniture/tl_sign_cave_gate_v01');
    assert.equal(gate.yaw, cave.yaw);
    // On the tunnel axis, between the walk limit of the main cave and the mouth plane (23.4 m).
    const d = Math.hypot(cave.x, cave.z), along = (gate.x * cave.x + gate.z * cave.z) / d, lateral = (-gate.x * cave.z + gate.z * cave.x) / d;
    assert.ok(along > HUB_LAYOUT.radius + 0.8 && along < 22.4, `${cave.id}: gate at ${along}`);
    assert.ok(Math.abs(lateral) < 0.01);
    // Its posts are the only colliders, where the manifest puts them, and nobody can touch them:
    // not the player (outside every room) and not the camera (outside every room grown by its margin).
    const posts = placementObstacles(gate);
    assert.equal(posts.length, 2);
    assert.deepEqual((gate.colliders ?? []).map(c => Math.abs(c.dx)), [postHalf, postHalf]);
    for (const post of posts) {
      assert.ok(!inRooms(post.x, post.z, HUB_ROOMS, post.r + 0.3), `${cave.id}: a gate post stands in the walk area`);
      assert.ok(!inRooms(post.x, post.z, HUB_ROOMS, CAVE_CAMERA_MARGIN + 0.1), `${cave.id}: a gate post stands in the camera area`);
    }
  }
});

test('the big screen is bolted to the back-left wall, out of reach, in view from the spawn', () => {
  const asset = stallManifest('furniture').get('furniture/tl_furn_wall_screen_v01') as (StallManifestAsset & { meta: { screen: { center: number[]; size: number[]; normal: number[] } } }) | undefined;
  assert.ok(asset, 'tl_furn_wall_screen_v01 missing from manifest.furniture.json');
  const { center, size, normal } = asset.meta.screen;
  assert.ok(Math.abs(size[0] / size[1] - 16 / 9) < 1e-3, '16:9 picture');
  // Leans forward a little (the wall behind leans in), so the picture looks down at the cave floor.
  assert.ok(normal[0] === 0 && normal[2] > 0.97 && normal[1] < -0.05 && normal[1] > -0.25);
  // Wall-mounted: the housing starts well above the floor and the model declares no posts.
  const mount = (asset.meta as { mount?: { lift: number } }).mount;
  assert.ok(mount && mount.lift >= 2 && asset.meta.postColliders === undefined);
  // It lies on the flat rock face the cave model provides: same bearing, lean and distance, and the
  // housing (picture + bezel) fits inside the face, below the height where the face stops being flat.
  const face = (stallManifest('caves').get('caves/tl_cave_main_floor_v01')!.meta as unknown as { screenWall: { bearing: number; r0: number; slope: number; halfWidth: number; tilt: number; flatTo: number } }).screenWall;
  assert.deepEqual([face.bearing, face.r0, face.slope, face.halfWidth], [SCREEN_WALL.bearing, SCREEN_WALL.r0, SCREEN_WALL.slope, SCREEN_WALL.halfWidth]);
  assert.ok(Math.abs(Math.asin(-normal[1]) * 180 / Math.PI - face.tilt) < 0.05, 'the screen leans with the rock face');
  assert.equal(HUB_SCREEN.yaw, Math.round((face.bearing - 180) * 100) / 100);
  const back = Math.hypot(HUB_SCREEN.x, HUB_SCREEN.z) - (face.r0 - face.slope * mount.lift);
  assert.ok(back >= 0 && back < 0.05, `housing back ${back} m behind the rock face`);
  assert.ok(size[0] / 2 + 0.14 < face.halfWidth - 0.2 && center[1] + size[1] / 2 + 0.6 < face.flatTo);
  assert.ok(center[1] - size[1] / 2 >= 1.95, 'bottom edge above head height and the low wall rocks');
  assert.ok(size[0] >= 9.5, 'the big screen stays big');
  // Exactly one, in the main cave shell but outside the walk and camera areas.
  assert.equal(HUB_PLACEMENTS.filter(p => p.asset === HUB_SCREEN.asset).length, 1);
  const r = Math.hypot(HUB_SCREEN.x, HUB_SCREEN.z);
  assert.ok(r > HUB_LAYOUT.radius + CAVE_CAMERA_MARGIN + 0.8 && r < 23.2, `screen at r = ${r}`);
  assert.ok(HUB_SCREEN.x < 0 && HUB_SCREEN.z < 0);
  for (const post of placementObstacles(HUB_SCREEN))
    assert.ok(!inRooms(post.x, post.z, HUB_ROOMS, CAVE_CAMERA_MARGIN + post.r));
  // It faces the campfire (within 1 deg) ...
  const DEG = Math.PI / 180, toFire = { x: Math.sin(HUB_SCREEN.yaw * DEG), z: Math.cos(HUB_SCREEN.yaw * DEG) };
  assert.ok((toFire.x * -HUB_SCREEN.x + toFire.z * -HUB_SCREEN.z) / r > Math.cos(1 * DEG));
  // ... and a player who has just spawned (looking along -Z) has it less than 25 deg off centre.
  const dx = HUB_SCREEN.x - HUB_SPAWN.x, dz = HUB_SCREEN.z - HUB_SPAWN.z;
  assert.ok(Math.abs(Math.atan2(dx, -dz)) < 25 * DEG);
  // No stall or landmark sits under it (but its own viewing spot), and it ends short of the tunnel mouths (5 m wide).
  for (const l of HUB_LANDMARKS) if (l.id !== 'screen') assert.ok(Math.hypot(l.x - HUB_SCREEN.x, l.z - HUB_SCREEN.z) > 8, l.id);
  for (const cave of HUB_CAVES) {
    const d = Math.hypot(cave.x, cave.z);
    assert.ok(Math.hypot((cave.x / d) * 23.4 - HUB_SCREEN.x, (cave.z / d) * 23.4 - HUB_SCREEN.z) > 4.94 + 2.5 + 0.8, cave.id);
  }
});
