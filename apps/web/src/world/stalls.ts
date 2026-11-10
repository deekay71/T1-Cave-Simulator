/** Original low-poly hosts and readable canvas signs, generated without external art. */
import * as pc from 'playcanvas';
import type { Blocker } from '../cameraMath.js';
import { CAVE_STALLS } from '../../../../packages/shared/src/stalls.js';

/** Elevated signs do not push a low camera away from an otherwise open aisle. */
export const STALL_CAMERA_BLOCKERS: readonly (Blocker & { bottom?: number })[] = CAVE_STALLS.flatMap(s => {
  const a = s.yaw * Math.PI / 180;
  const sign = { x: s.x - Math.sin(a) * .3, z: s.z - Math.cos(a) * .3, r: 1.5, bottom: 2.2, top: 3.15 };
  const npcX = s.id === 'tv' ? 1.25 : s.id === 'quiz' ? .85 : 0;
  const npcZ = s.id === 'memory' ? .65 : -.15;
  return [sign, { x: s.x + npcX * Math.cos(a) + npcZ * Math.sin(a), z: s.z - npcX * Math.sin(a) + npcZ * Math.cos(a), r: .4, bottom: 0, top: 2 }];
});

export function worldSign(app: pc.AppBase, parent: pc.Entity, lines: readonly string[], width = 2.8, height = 0.8, accent = '#DA4A48') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#171B24'; ctx.fillRect(0, 0, 1024, 320);
  ctx.strokeStyle = accent; ctx.lineWidth = 16; ctx.strokeRect(8, 8, 1008, 304);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillStyle = i ? '#EEE5D3' : accent;
    let size = i ? 44 : 66;
    do { ctx.font = `700 ${size--}px sans-serif`; } while (ctx.measureText(line).width > 940 && size > 24);
    ctx.fillText(line, 512, lines.length === 1 ? 160 : i === 0 ? 115 : 224);
  });
  const texture = new pc.Texture(app.graphicsDevice, { width: 1024, height: 320, mipmaps: true });
  texture.setSource(canvas);
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture; material.emissiveMap = texture;
  material.emissive = new pc.Color(0.8, 0.8, 0.8); material.useLighting = false;
  material.cull = pc.CULLFACE_BACK; material.update();
  const sign = new pc.Entity('readable-sign'); parent.addChild(sign);
  // Each side has its own outward-facing UV frame. A double-sided single plane
  // exposes the front UVs from behind and makes the text read in a mirror.
  for (const yaw of [0, 180]) {
    const face = new pc.Entity(yaw === 0 ? 'sign-front' : 'sign-reverse');
    sign.addChild(face);
    face.addComponent('render', { type: 'plane', material, castShadows: false });
    face.setLocalPosition(0, 0, yaw === 0 ? .008 : -.008);
    face.setLocalEulerAngles(90, yaw, 0);
    face.setLocalScale(width, 1, height);
  }
  sign.on('destroy', () => { material.destroy(); texture.destroy(); });
  return sign;
}

export function buildCaveStalls(app: pc.AppBase, parent: pc.Entity, withNpcs = true) {
  const materials = new Map<string, pc.StandardMaterial>();
  const mat = (color: string) => {
    let m = materials.get(color);
    if (!m) { m = new pc.StandardMaterial(); m.diffuse = new pc.Color().fromString(color); m.gloss = .15; m.update(); materials.set(color, m); }
    return m;
  };
  const all = new pc.Entity('five-cave-stalls'); parent.addChild(all);
  const part = (into: pc.Entity, name: string, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const e = new pc.Entity(name); into.addChild(e);
    e.setLocalPosition(x, y, z); e.setLocalScale(sx, sy, sz);
    e.addComponent('render', { type: 'box', material: mat(color), castShadows: false });
    return e;
  };
  for (const s of CAVE_STALLS) {
    const root = new pc.Entity(`stall-${s.id}`); all.addChild(root);
    root.setLocalPosition(s.x, 0, s.z); root.setLocalEulerAngles(0, s.yaw, 0);
    const sign = worldSign(app, root, [s.name, `${s.npc} · ${s.role}`], s.id === 'memory' ? 3.5 : 2.9, .85, s.accent);
    sign.setLocalPosition(0, 2.65, -.3);
    for (const side of [-1, 1]) part(root, 'timber-sign-post', '#59493D', side * 1.08, 1.35, -.37, .085, 2.7, .085);
    // Shared, low counters already have collision in the placement table. Existing
    // quiz board, CRT crates and memory wall remain the furniture for those stalls.
    if (s.id === 'checkin' || s.id === 'shop') {
      part(root, 'counter-top', '#B59772', 0, .84, 0, 1.5, .1, .8);
      part(root, 'counter-accent', s.accent, 0, .48, .414, 1.15, .18, .025);
    }
    if (s.id === 'checkin') {
      part(root, 'checkin-ledger', '#EBD9B4', -.4, .915, .16, .36, .05, .29);
      part(root, 'ledger-spine', '#762B37', -.4, .95, .16, .025, .025, .29);
    }
    if (s.id === 'shop') {
      for (const side of [-1, 1]) {
        const shirt = new pc.Entity('display-jersey'); root.addChild(shirt);
        shirt.setLocalPosition(side * .68, 1.6, -.4); shirt.setLocalScale(.65, .65, .65);
        part(shirt, 'shirt-body', side < 0 ? '#B52F40' : '#EEE6D6', 0, 0, 0, .4, .45, .055);
        for (const arm of [-1, 1]) part(shirt, 'shirt-sleeve', side < 0 ? '#B52F40' : '#EEE6D6', arm * .25, .12, 0, .17, .2, .055);
      }
    }
    if (s.id === 'memory') {
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * .32;
        part(root, 'memory-cup', '#D7AD61', x, 2.02, .06, .2, .17, .14);
        part(root, 'memory-cup-stem', '#D7AD61', x, 1.87, .06, .055, .14, .06);
      }
    }
    if (!withNpcs) continue;
    const npc = new pc.Entity(`original-host-${s.npc}`); root.addChild(npc);
    npc.setLocalPosition(s.id === 'tv' ? 1.25 : s.id === 'quiz' ? .85 : 0, 0, s.id === 'memory' ? .65 : -.15);
    const jacket = s.id === 'checkin';
    const shirt = jacket ? '#302F36' : s.id === 'shop' ? '#E3DDCE' : '#A62D3E';
    const skin = '#D0A287'; const hair = '#24242B';
    part(npc, jacket ? 'oner-jacket' : 'host-shirt', shirt, 0, 1.05, 0, .5, .62, .29);
    part(npc, 'neck', skin, 0, 1.41, 0, .15, .16, .16);
    part(npc, 'head', skin, 0, 1.65, .015, .36, .38, .31);
    part(npc, 'hair-cap', hair, 0, 1.84, -.005, .38, .13, .34);
    part(npc, 'fringe', hair, -.065, 1.77, .173, .24, .12, .035).setLocalEulerAngles(0, 0, -10);
    for (const side of [-1, 1]) {
      part(npc, 'trouser', '#292B35', side * .135, .4, 0, .22, .73, .24);
      part(npc, 'shoe', '#151921', side * .135, .075, .07, .24, .15, .36);
      part(npc, 'sleeve', shirt, side * .32, 1.13, 0, .17, jacket ? .42 : .27, .22);
      part(npc, 'forearm', jacket ? shirt : skin, side * .32, .86, .07, .14, .27, .16);
      part(npc, 'hand', skin, side * .32, .72, .085, .145, .13, .17);
      part(npc, 'eye', hair, side * .085, 1.67, .177, .035, .025, .015);
      if (s.id === 'quiz') {
        part(npc, 'keria-glasses', hair, side * .085, 1.67, .19, .14, .085, .02);
        part(npc, 'glasses-lens', '#9DADB6', side * .085, 1.67, .204, .105, .052, .01);
      }
      if (jacket) part(npc, 'jacket-red-stripe', '#B73A46', side * .21, 1.06, .151, .055, .5, .025);
    }
    if (jacket) part(npc, 'jacket-zip', '#CFBC9A', 0, 1.08, .153, .018, .53, .022);
  }
  all.on('destroy', () => { for (const m of materials.values()) m.destroy(); });
  return all;
}
