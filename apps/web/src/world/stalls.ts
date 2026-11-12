/**
 * Stall signs and the name boards of the tunnel gates: lettering painted on weathered planks. The stalls themselves (counters, awning,
 * clothes rail, sign posts and boards) and their hosts are GLB placements of the shared table
 * (packages/shared/src/layout.ts: HUB_STALL_SIGNS / HUB_STALL_HOSTS), so they load, batch, collide
 * and idle like every other prop and NPC. This module only lays a canvas texture (wood grain,
 * seams, nail heads, worn paint) over the flat faces the sign boards declare in the furniture
 * manifest (meta.sign.faces), one texture per side, so the text never reads mirrored. The gates in
 * front of the four tunnel mouths (HUB_CAVE_GATES) carry the same kind of board: the side cave's
 * name toward the main cave, "HANG LỚN" toward the tunnel.
 */
import * as pc from 'playcanvas';
import { HUB_CAVES, HUB_CAVE_GATES, HUB_STALL_SIGNS, STALL_SIGN_BOARD, STALL_SIGN_BOARDS, type Placement } from '@te-liet/shared';
import type { Blocker } from '../cameraMath.js';
import { CAVE_STALLS, type CaveStall } from '../../../../packages/shared/src/stalls.js';
import { loadManifests } from './manifest.js';

type V3 = readonly [number, number, number];
/** A flat rectangle of a sign board in the model's frame (manifest meta.sign.faces). */
export interface SignFace {
  center: V3;
  /** [width, height] in metres. */
  size: readonly [number, number];
  normal: V3;
  up: V3;
}
/** One plank row of a board: heights in the model's frame and the plank's exact front colour. */
export interface SignPlank {
  y0: number;
  y1: number;
  color: string;
}
interface SignMeta {
  faces: SignFace[];
  planks: SignPlank[];
}

/** Board wood when no manifest colours are known (tools/models/groups/furniture.ts SIGN_WOOD). */
const SIGN_WOOD = '#584232';
/** Lettering: worn white for the name, a paler tint of the stall's accent for the host line. */
const PAINT = '#D9D0BC';
const BOARD_HEIGHT = STALL_SIGN_BOARD.height;
const BOARD_BOTTOM = STALL_SIGN_BOARD.bottom;

const DEG = Math.PI / 180;
/** Model frame (x, z) of a placement -> cave space. */
function toCave(p: Placement, lx: number, lz: number): { x: number; z: number } {
  const s = p.scale ?? 1, c = Math.cos(p.yaw * DEG), n = Math.sin(p.yaw * DEG);
  return { x: p.x + (lx * c + lz * n) * s, z: p.z + (-lx * n + lz * c) * s };
}

/**
 * Camera-only bounds of what hangs overhead at a stall: the sign board with its crossbar and the
 * check-in awning. They start above head height, so a low camera still passes under them; the
 * posts (thin, floor to top) and the hosts come from cameraBlockers() like every placement.
 */
export const STALL_CAMERA_BLOCKERS: readonly (Blocker & { bottom?: number })[] = CAVE_STALLS.flatMap(s => {
  const p = HUB_STALL_SIGNS[s.id];
  const board = STALL_SIGN_BOARDS[p.asset];
  if (!board) return [];
  const y = p.y ?? 0;
  const out: (Blocker & { bottom?: number })[] = [];
  const n = Math.ceil((2 * board.half + 0.5) / 0.5);
  for (let i = 0; i <= n; i++) {
    const lx = -board.half - 0.25 + (i * (2 * board.half + 0.5)) / n;
    out.push({ ...toCave(p, lx, board.z), r: 0.4, bottom: y + BOARD_BOTTOM - 0.2, top: y + BOARD_BOTTOM + BOARD_HEIGHT + 0.6 });
    // awning: from the board plane forward to its front edge
    if (board.awning !== undefined)
      for (let lz = board.z + 0.45; lz < board.awning + 0.2; lz += 0.45)
        out.push({ ...toCave(p, lx, lz), r: 0.4, bottom: y + 1.85, top: y + 2.5 });
  }
  return out;
});

/* ------------------------------------------------------------------ painted wood texture */

/** Deterministic 0..1 stream (mulberry32) so a sign looks the same on every client and reload. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mixHex = (a: string, b: string, t: number) => {
  const p = hexRgb(a), q = hexRgb(b);
  return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`;
};
export const WORLD_FONT = '"Be Vietnam Pro", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif';

interface PaintOptions {
  /** Face size in metres (sets the canvas aspect). */
  width: number;
  height: number;
  accent: string;
  /** Plank rows as fractions of the face height, bottom to top. */
  rows: { v0: number; v1: number; color: string }[];
}

/**
 * Paints a sign face: plank colours of the board underneath with grain, seams between the planks
 * and nail heads, then hand-painted lettering (the name in worn white over a rough accent stroke,
 * the host line below), scuffed along the grain. Returns the colour canvas and a lettering-only
 * canvas used as a faint emissive map so the name stays readable in the dark.
 */
function paintSign(lines: readonly string[], o: PaintOptions): { color: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const W = 1024;
  const H = Math.max(64, Math.round((W * o.height) / o.width / 4) * 4);
  const rand = rng(lines.join('|') + o.width.toFixed(2));
  const color = document.createElement('canvas');
  color.width = W; color.height = H;
  const ctx = color.getContext('2d')!;
  const rowPx = o.rows.map(r => ({ top: Math.round((1 - r.v1) * H), bottom: Math.round((1 - r.v0) * H), color: r.color }));

  // Wood: each plank in its own colour, grain streaks, a darker band at knots.
  ctx.fillStyle = '#1B1410';
  ctx.fillRect(0, 0, W, H);
  for (const r of rowPx) {
    ctx.fillStyle = r.color;
    ctx.fillRect(0, r.top, W, r.bottom - r.top);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const y = r.top + 3 + rand() * (r.bottom - r.top - 6);
      const x = rand() * W, len = 60 + rand() * 420;
      const light = rand() < 0.4;
      ctx.strokeStyle = light ? `rgba(226,196,160,${0.05 + rand() * 0.07})` : `rgba(18,10,6,${0.08 + rand() * 0.14})`;
      ctx.lineWidth = 1 + rand() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 6, x + len * 0.7, y + (rand() - 0.5) * 6, x + len, y + (rand() - 0.5) * 4);
      ctx.stroke();
    }
    if (rand() < 0.7) {
      const kx = 80 + rand() * (W - 160), ky = r.top + (r.bottom - r.top) * (0.3 + rand() * 0.4);
      ctx.fillStyle = 'rgba(16,9,6,0.42)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, 15 + rand() * 12, 5 + rand() * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // plank edges: lit top edge, shaded bottom edge
    ctx.fillStyle = 'rgba(235,205,170,0.10)';
    ctx.fillRect(0, r.top, W, 2);
    ctx.fillStyle = 'rgba(10,6,4,0.28)';
    ctx.fillRect(0, r.bottom - 3, W, 3);
  }

  // Lettering on its own layer, so the wear can cut through the paint only.
  const paint = document.createElement('canvas');
  paint.width = W; paint.height = H;
  const p = paint.getContext('2d')!;
  p.textAlign = 'left';
  p.textBaseline = 'alphabetic';
  const single = lines.length === 1;
  const fit = (text: string, weight: number, size: number, maxWidth: number) => {
    let s = size;
    do { p.font = `${weight} ${s}px ${WORLD_FONT}`; s -= 2; } while (p.measureText(text).width > maxWidth && s > 18);
    return s + 2;
  };
  /** Letter by letter with a little wobble: reads as brushed by hand, stays legible. */
  const brush = (text: string, weight: number, size: number, cy: number, fill: string, wobble: number) => {
    p.font = `${weight} ${size}px ${WORLD_FONT}`;
    const total = p.measureText(text).width;
    const x0 = (W - total) / 2;
    const base = cy + size * 0.36;
    p.fillStyle = fill;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') continue;
      const x = x0 + p.measureText(text.slice(0, i)).width;
      const w = p.measureText(ch).width;
      p.save();
      p.translate(x + w / 2, base + (rand() - 0.5) * wobble * 2);
      p.rotate((rand() - 0.5) * wobble * 0.012);
      p.fillText(ch, -w / 2, 0);
      p.restore();
    }
    return total;
  };
  const title = lines[0]?.normalize('NFC') ?? '';
  const sub = lines.slice(1).join(' · ').normalize('NFC');
  const titleSize = fit(title, 800, Math.round(H * (single ? 0.5 : 0.4)), W * 0.9);
  const titleY = single ? H * 0.5 : H * 0.34;
  const titleW = brush(title, 800, titleSize, titleY, PAINT, 2.2);
  if (!single) {
    // one rough stroke of the accent colour under the name
    const y = titleY + titleSize * 0.56, half = Math.min(W * 0.44, titleW * 0.52);
    p.fillStyle = mixHex(o.accent, PAINT, 0.12);
    p.beginPath();
    p.moveTo(W / 2 - half, y + 2);
    for (let i = 0; i <= 12; i++) p.lineTo(W / 2 - half + (2 * half * i) / 12, y - 3 - rand() * 3);
    for (let i = 12; i >= 0; i--) p.lineTo(W / 2 - half + (2 * half * i) / 12 + (i === 12 ? 14 : 0), y + 4 + rand() * 4);
    p.closePath();
    p.fill();
    const subSize = fit(sub, 700, Math.round(H * 0.19), W * 0.92);
    brush(sub, 700, subSize, H * 0.78, mixHex(PAINT, o.accent, 0.3), 1.2);
  }
  // Wear: scuffs along the grain, chips, and no paint across the gaps between planks.
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 150; i++) {
    const y = rand() * H, x = rand() * W, len = 14 + rand() * 110;
    p.strokeStyle = `rgba(0,0,0,${0.25 + rand() * 0.5})`;
    p.lineWidth = 1 + rand() * 2;
    p.beginPath();
    p.moveTo(x, y);
    p.lineTo(x + len, y + (rand() - 0.5) * 3);
    p.stroke();
  }
  for (let i = 0; i < 46; i++) {
    p.fillStyle = `rgba(0,0,0,${0.35 + rand() * 0.5})`;
    p.beginPath();
    p.ellipse(rand() * W, rand() * H, 2 + rand() * 7, 1.5 + rand() * 3, rand() * 3, 0, Math.PI * 2);
    p.fill();
  }
  p.fillStyle = '#000';
  for (const r of rowPx.slice(1)) p.fillRect(0, r.bottom - 1, W, 5);
  p.globalCompositeOperation = 'source-over';

  // a thin dark edge under the paint gives it a little body, then the paint itself
  const shadow = document.createElement('canvas');
  shadow.width = W; shadow.height = H;
  const sh = shadow.getContext('2d')!;
  sh.drawImage(paint, 0, 0);
  sh.globalCompositeOperation = 'source-in';
  sh.fillStyle = '#120C09';
  sh.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(shadow, 1.5, 2.5);
  ctx.globalAlpha = 0.96;
  ctx.drawImage(paint, 0, 0);
  ctx.globalAlpha = 1;

  // nail heads near both ends of every plank (over the paint)
  for (const r of rowPx)
    for (const x of [W * 0.045, W * 0.955]) {
      const y = (r.top + r.bottom) / 2 + (rand() - 0.5) * 10;
      ctx.fillStyle = '#17110E';
      ctx.beginPath(); ctx.arc(x + (rand() - 0.5) * 8, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(190,170,150,0.35)';
      ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 1.6, 0, Math.PI * 2); ctx.fill();
    }

  const glow = document.createElement('canvas');
  glow.width = W / 2; glow.height = H / 2;
  const g = glow.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, glow.width, glow.height);
  g.drawImage(paint, 0, 0, glow.width, glow.height);
  return { color, glow };
}

function signMaterial(app: pc.AppBase, lines: readonly string[], o: PaintOptions): { material: pc.StandardMaterial; destroy: () => void } {
  const { color, glow } = paintSign(lines, o);
  const texture = (c: HTMLCanvasElement) => {
    const t = new pc.Texture(app.graphicsDevice, { width: c.width, height: c.height, mipmaps: true, anisotropy: 8, flipY: true });
    t.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
    t.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
    t.setSource(c);
    return t;
  };
  const map = texture(color), emissive = texture(glow);
  // Matte like the GLB "tl_matte" (metallic 0, roughness 0.9): lit by the torches and the fire.
  const material = new pc.StandardMaterial();
  material.name = 'stall-sign-paint';
  material.diffuseMap = map;
  material.useMetalness = true;
  material.metalness = 0;
  material.gloss = 0.1;
  // The lettering alone glows a little: readable from across the cave without lighting the wood.
  material.emissiveMap = emissive;
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveIntensity = 0.42;
  material.cull = pc.CULLFACE_BACK;
  material.update();
  return { material, destroy: () => { material.destroy(); map.destroy(); emissive.destroy(); } };
}

/* ------------------------------------------------------------------ meshes */

/** Unit quad in the XY plane facing +Z; u runs along +X, v up, so text reads from the +Z side. */
export function quadMesh(device: pc.GraphicsDevice, w: number, h: number): pc.Mesh {
  const x = w / 2, y = h / 2;
  const mesh = new pc.Mesh(device);
  mesh.setPositions([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]);
  mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** A plank slab w x h x t: front and back carry the whole texture (each reads un-mirrored), the four edges a sliver of its wood. */
function slabMesh(device: pc.GraphicsDevice, w: number, h: number, t: number): pc.Mesh {
  const x = w / 2, y = h / 2, z = t / 2;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (pts: number[][], n: number[], uvs: number[][]) => {
    const base = pos.length / 3;
    pts.forEach((q, i) => { pos.push(...q); nrm.push(...n); uv.push(...uvs[i]); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const full = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const edge = [[0.004, 0.1], [0.012, 0.1], [0.012, 0.2], [0.004, 0.2]];
  face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1], full);
  face([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1], full);
  face([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0], edge);
  face([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0], edge);
  face([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0], edge);
  face([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0], edge);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setIndices(idx);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

export function renderEntity(name: string, mesh: pc.Mesh, material: pc.Material): pc.Entity {
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
  return e;
}

/** Plank rows for a free-standing board: four planks in slightly different tones of the sign wood. */
function defaultRows(seed: string): PaintOptions['rows'] {
  const rand = rng(seed);
  return [0, 1, 2, 3].map(i => {
    const k = 0.93 + rand() * 0.14;
    const [r, g, b] = hexRgb(SIGN_WOOD).map(v => Math.min(255, Math.round(v * k)));
    return { v0: i / 4 + (i ? 0.008 : 0), v1: (i + 1) / 4 - (i < 3 ? 0.008 : 0), color: `rgb(${r},${g},${b})` };
  });
}

/**
 * Free-standing painted board (used by the shrine doorway): a plank slab `width` x `height` m with
 * the lines painted on both sides, centred on the returned entity, facing its +Z and -Z. The first
 * line is the name, the rest a smaller line under it. Lit by the scene.
 */
export function worldSign(app: pc.AppBase, parent: pc.Entity, lines: readonly string[], width = 2.8, height = 0.8, accent = '#DA4A48') {
  const { material, destroy } = signMaterial(app, lines, { width, height, accent, rows: defaultRows(lines.join('|')) });
  const mesh = slabMesh(app.graphicsDevice, width, height, 0.05);
  const sign = renderEntity('readable-sign', mesh, material);
  parent.addChild(sign);
  sign.on('destroy', () => { destroy(); mesh.destroy(); });
  return sign;
}

/* ------------------------------------------------------------------ stall signs */

const stallLines = (s: CaveStall) => [s.name, `${s.npc} · ${s.role}`];

/** Faces of a board when the manifest is unavailable: same numbers as the generator. */
function fallbackSign(asset: string): SignMeta | null {
  const b = STALL_SIGN_BOARDS[asset];
  if (!b) return null;
  const cy = BOARD_BOTTOM + BOARD_HEIGHT / 2, h = BOARD_HEIGHT - 0.012;
  return {
    faces: [
      { center: [0, cy, b.z + 0.023], size: [2 * b.half - 0.15, h], normal: [0, 0, 1], up: [0, 1, 0] },
      { center: [0, cy, b.z - 0.023], size: [2 * b.half - 0.39, h], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    planks: [],
  };
}

function isSignMeta(v: unknown): v is SignMeta {
  const m = v as Partial<SignMeta> | null;
  return !!m && Array.isArray(m.faces) && m.faces.length > 0 && Array.isArray(m.planks);
}

/** What a board says: the side facing the model's +Z, and (when it differs) the side facing -Z. */
interface SignText {
  front: readonly string[];
  back?: readonly string[];
  accent: string;
}

/** Text faces for one board, parented to a node that copies the sign model's placement. */
function buildSign(app: pc.AppBase, parent: pc.Entity, id: string, text: SignText, p: Placement, meta: SignMeta) {
  const root = new pc.Entity(`sign-${id}`);
  parent.addChild(root);
  root.setLocalPosition(p.x, p.y ?? 0, p.z);
  root.setLocalEulerAngles(0, p.yaw, 0);
  if (p.scale) root.setLocalScale(p.scale, p.scale, p.scale);
  for (const face of meta.faces) {
    const [w, h] = face.size;
    const bottom = face.center[1] - h / 2;
    const rows = meta.planks.length
      ? meta.planks.map(k => ({ v0: Math.max(0, (k.y0 - bottom) / h), v1: Math.min(1, (k.y1 - bottom) / h), color: k.color }))
      : defaultRows(id);
    const lines = face.normal[2] >= 0 ? text.front : (text.back ?? text.front);
    const { material, destroy } = signMaterial(app, lines, { width: w, height: h, accent: text.accent, rows });
    const mesh = quadMesh(app.graphicsDevice, w, h);
    const e = renderEntity(face.normal[2] >= 0 ? 'sign-front' : 'sign-back', mesh, material);
    root.addChild(e);
    // Orthonormal frame: +Z = the face normal, +Y = up, +X = up x normal (text runs along +X).
    const n = new pc.Vec3(...face.normal).normalize(), up = new pc.Vec3(...face.up).normalize();
    const x = new pc.Vec3().cross(up, n).normalize();
    const m = new pc.Mat4();
    m.set([x.x, x.y, x.z, 0, up.x, up.y, up.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1]);
    e.setLocalRotation(new pc.Quat().setFromMat4(m));
    e.setLocalPosition(face.center[0], face.center[1], face.center[2]);
    e.on('destroy', () => { destroy(); mesh.destroy(); });
  }
  return root;
}

export interface CaveStallSigns {
  root: pc.Entity;
  /** Resolves when every sign is painted (the furniture manifest has been read). Never rejects. */
  ready: Promise<void>;
}

/** Board of the gate in front of a side tunnel: the cave's name and what waits there. */
function gateText(cave: (typeof HUB_CAVES)[number]): SignText {
  const stall = CAVE_STALLS.find(s => s.id === cave.stall);
  return {
    front: [cave.name.toLocaleUpperCase('vi'), ...(stall ? [`${stall.name} · ${stall.npc}`] : [])],
    back: ['HANG LỚN', 'Lửa trại · Điện thờ'],
    accent: stall?.accent ?? '#DA4A48',
  };
}

/**
 * Paints the five stall signs and the four tunnel-gate boards onto their GLB boards. `_withNpcs` is kept for the call site: the
 * hosts are NPC placements now and scene.ts already leaves those out when NPCs are off.
 */
export function buildCaveStalls(app: pc.AppBase, parent: pc.Entity, _withNpcs = true): CaveStallSigns {
  const root = new pc.Entity('cave-stall-signs');
  parent.addChild(root);
  const report = (msg: string) => console.error(`[stalls] ${msg}`);
  const ready = loadManifests(['furniture'], report)
    .then(index => {
      for (const stall of CAVE_STALLS) {
        const p = HUB_STALL_SIGNS[stall.id];
        const declared = index.get(p.asset)?.meta?.sign;
        const meta = isSignMeta(declared) ? declared : fallbackSign(p.asset);
        if (!meta) { report(`${p.asset}: no sign faces`); continue; }
        buildSign(app, root, `stall-${stall.id}`, { front: stallLines(stall), accent: stall.accent }, p, meta);
      }
      for (const cave of HUB_CAVES) {
        const p = HUB_CAVE_GATES[cave.id];
        const meta = index.get(p.asset)?.meta?.sign;
        if (!isSignMeta(meta)) { report(`${p.asset}: no sign faces`); continue; }
        buildSign(app, root, `gate-${cave.id}`, gateText(cave), p, meta);
      }
    })
    .catch((err: unknown) => report(`signs failed: ${err instanceof Error ? err.message : String(err)}`));
  return { root, ready };
}
