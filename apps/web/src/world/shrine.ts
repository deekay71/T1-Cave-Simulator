/**
 * A separate, open-air low-poly shrine. Geometry is authored here; all walkable
 * bounds, the centre obstacle and the twenty seat locations come from shared data.
 * The figure is an original, abstract esports-champion homage, not a licensed asset.
 */
import * as pc from "playcanvas";
import { worldSign } from "./stalls.js";
import type { Blocker } from "../cameraMath.js";
import {
  SHRINE_CENTER,
  SHRINE_EXIT,
  SHRINE_PORTAL,
  SHRINE_SEAT_HEIGHT,
  SHRINE_SEATS,
} from "../../../../packages/shared/src/shrine.js";

type V3 = [number, number, number];
type Shape = "box" | "octagon" | "taper" | "pyramid";

/** Shared by the rendered columns and camera-only bounds, never player collision. */
const PILLARS: readonly V3[] = [
  [-3.5, 0, 8], [3.5, 0, 8], [-8.55, 0, 0], [8.55, 0, 0],
  [-3.5, 0, -8], [3.5, 0, -8], [-7.45, 0, -4.6], [7.45, 0, -4.6],
];

/** Elevated arch bounds leave the entrance below y=3.35 entirely open. */
export const SHRINE_CAMERA_BLOCKERS: readonly (Blocker & { bottom?: number })[] = [
  { x: SHRINE_CENTER.x, z: SHRINE_CENTER.z, r: 1.15, top: 4.6 },
  ...PILLARS.map(([x, , z]) => ({ x: SHRINE_CENTER.x + x, z: SHRINE_CENTER.z + z, r: 0.6, top: 4.65 })),
  ...[-8, 8].flatMap(z => Array.from({ length: 17 }, (_, i) => ({
    x: SHRINE_CENTER.x - 4 + i * 0.5, z: SHRINE_CENTER.z + z,
    r: 0.5, bottom: 3.35, top: 4.65,
  }))),
];

export interface ShrineWorld {
  root: pc.Entity;
  /** Seat roots use shared ids; their local +Z points toward the statue. */
  seats: ReadonlyMap<string, pc.Entity>;
}

/** Flat normals give stone, metal and fabric clear facets without imported assets. */
function prism(device: pc.GraphicsDevice, sides: number, top: number): pc.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const triangle = (a: V3, b: V3, c: V3) => {
    const normal = new pc.Vec3().cross(
      new pc.Vec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      new pc.Vec3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    ).normalize();
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) normals.push(normal.x, normal.y, normal.z);
  };
  for (let i = 0; i < sides; i++) {
    const a = (i + 0.5) * 2 * Math.PI / sides;
    const b = (i + 1.5) * 2 * Math.PI / sides;
    const p: V3 = [Math.sin(a) * 0.5, -0.5, Math.cos(a) * 0.5];
    const q: V3 = [Math.sin(b) * 0.5, -0.5, Math.cos(b) * 0.5];
    const r: V3 = [q[0] * top, 0.5, q[2] * top];
    const s: V3 = [p[0] * top, 0.5, p[2] * top];
    triangle(p, q, r);
    if (top > 0) triangle(p, r, s);
    triangle([0, -0.5, 0], q, p);
    if (top > 0) triangle([0, 0.5, 0], s, r);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

export function buildShrine(app: pc.AppBase, parent: pc.Entity): ShrineWorld {
  const root = new pc.Entity("shrine-sanctuary");
  root.setLocalPosition(SHRINE_CENTER.x, 0, SHRINE_CENTER.z);
  parent.addChild(root);
  const meshes: Record<Shape, pc.Mesh> = {
    box: pc.Mesh.fromGeometry(app.graphicsDevice, new pc.BoxGeometry()),
    octagon: prism(app.graphicsDevice, 8, 1),
    taper: prism(app.graphicsDevice, 8, 0.72),
    pyramid: prism(app.graphicsDevice, 4, 0),
  };
  const material = (name: string, color: string, glow = 0) => {
    const m = new pc.StandardMaterial();
    m.name = `shrine-${name}`;
    m.diffuse = new pc.Color().fromString(color);
    m.gloss = 0.16;
    if (glow) {
      m.emissive = m.diffuse.clone().mulScalar(glow);
      m.useLighting = false;
    }
    m.update();
    return m;
  };
  const stone = material("stone", "#655C58");
  const pale = material("carved-stone", "#A0937F");
  const dark = material("basalt", "#292C36");
  const floor = material("paving", "#514A48");
  const gold = material("brass", "#A97A43");
  const red = material("crimson", "#A22B37");
  const wine = material("cloak-shadow", "#58222F");
  const face = material("warm-statuary", "#C6A483");
  const black = material("obsidian", "#191C28");
  const glow = material("amber-inlay", "#F2BA77", 0.7);
  const renders: pc.RenderComponent[] = [];
  const piece = (
    into: pc.Entity, name: string, shape: Shape, m: pc.Material,
    at: V3, size: V3, rotation: V3 = [0, 0, 0],
  ) => {
    const e = new pc.Entity(name);
    into.addChild(e);
    e.setLocalPosition(...at);
    e.setLocalScale(...size);
    e.setLocalEulerAngles(...rotation);
    e.addComponent("render", {
      type: "asset",
      meshInstances: [new pc.MeshInstance(meshes[shape], m)],
      castShadows: false,
      receiveShadows: true,
    });
    renders.push(e.render!);
    return e;
  };
  const box = (name: string, m: pc.Material, at: V3, size: V3, rot?: V3) =>
    piece(root, name, "box", m, at, size, rot);

  // The raised island is built DOWN from y=0. The authoritative player floor is
  // flat, so no invisible climb or client-only stair collision is introduced.
  piece(root, "island-lower-foundation", "octagon", dark, [0, -0.75, 0], [19.6, 0.72, 19.6]);
  piece(root, "island-stone-foundation", "octagon", stone, [0, -0.33, 0], [19, 0.3, 19]);
  piece(root, "temple-paving", "octagon", floor, [0, -0.09, 0], [18.5, 0.18, 18.5]);

  // Narrow, flush radial seams and brass orbit lines leave the approach open.
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const yaw = angle * 180 / Math.PI;
    box(`paving-spoke-${i}`, stone, [Math.sin(angle) * 4.8, 0.004, Math.cos(angle) * 4.8], [0.035, 0.008, 6.6], [0, yaw, 0]);
  }
  for (const [ring, radius, count] of [["inner", 3, 32], ["outer", 5, 48], ["edge", 7.85, 64]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i + 0.5) * Math.PI * 2 / count;
      box(`${ring}-orbit-${i}`, gold,
        [Math.sin(a) * radius, 0.012, Math.cos(a) * radius],
        [Math.sin(Math.PI / count) * radius * 2, 0.012, 0.025],
        [0, a * 180 / Math.PI, 0]);
    }
  }

  // Every solid architectural prop is beyond the shared r=8 walking limit.
  // An open crown instead of a roof keeps the follow camera and all seat views clear.
  for (const [i, [x, , z]] of PILLARS.entries()) {
    piece(root, `pillar-${i}-foot`, "octagon", pale, [x, 0.17, z], [0.95, 0.34, 0.95]);
    piece(root, `pillar-${i}-shaft`, "taper", stone, [x, 2.1, z], [0.64, 3.6, 0.64]);
    piece(root, `pillar-${i}-collar`, "octagon", gold, [x, 3.65, z], [0.64, 0.12, 0.64]);
    piece(root, `pillar-${i}-capital`, "octagon", pale, [x, 3.92, z], [0.9, 0.36, 0.9]);
    piece(root, `pillar-${i}-crown`, "pyramid", dark, [x, 4.35, z], [1.1, 0.54, 1.1], [0, 45, 0]);
  }
  for (const z of [8, -8]) {
    box("entry-lintel", pale, [0, 4.12, z], [7.8, 0.34, 0.64]);
    box("entry-shadow", dark, [0, 4.35, z], [8.15, 0.16, 0.94]);
    // Stepped, angular arch with a floating central keystone.
    for (const side of [-1, 1]) {
      box("arch-haunch", stone, [side * 2.75, 3.56, z], [1.2, 0.34, 0.53], [0, 0, side * 25]);
      box("arch-upper", gold, [side * 1.76, 3.91, z], [1.25, 0.19, 0.43], [0, 0, side * 12]);
      box("red-temple-banner", wine, [side * 3.5, 2.9, z + (z > 0 ? -0.36 : 0.36)], [0.4, 1.25, 0.045]);
      box("banner-brass-hem", gold, [side * 3.5, 2.28, z + (z > 0 ? -0.4 : 0.4)], [0.42, 0.07, 0.055]);
    }
    piece(root, "arch-keystone", "octagon", gold, [0, 4.28, z], [0.48, 0.68, 0.35]);
  }
  for (let i = 0; i < 32; i++) {
    const a = (i + 0.5) * Math.PI * 2 / 32;
    if (Math.cos(a) > 0.9) continue; // entrance opening
    const r = 8.65;
    box(`perimeter-stone-${i}`, dark, [Math.sin(a) * r, 0.18, Math.cos(a) * r], [1.63, 0.36, 0.24], [0, a * 180 / Math.PI, 0]);
  }

  const seats = new Map<string, pc.Entity>();
  for (const seat of SHRINE_SEATS) {
    const e = new pc.Entity(`shrine-seat-${seat.id}`);
    root.addChild(e);
    e.setLocalPosition(seat.x - SHRINE_CENTER.x, 0, seat.z - SHRINE_CENTER.z);
    e.setLocalEulerAngles(0, seat.yaw, 0);
    seats.set(seat.id, e);
    const stoneSeat = new pc.Entity("stone-seat");
    e.addChild(stoneSeat);
    // Set the stone slightly behind the player's floor anchor: the seated knees
    // project forward, and the vertical calves must clear the slab's front edge.
    stoneSeat.setLocalPosition(0, 0, -0.16);
    // No backrest: every player has an unobstructed inward view. The top is y=.48.
    piece(stoneSeat, "stone-seat-foot", "taper", dark, [0, 0.13, 0], [0.69, 0.26, 0.56]);
    piece(stoneSeat, "stone-seat-carving", "octagon", stone, [0, 0.32, 0], [0.82, 0.22, 0.65]);
    piece(stoneSeat, "stone-seat-top", "octagon", pale, [0, SHRINE_SEAT_HEIGHT - 0.045, 0], [0.98, 0.09, 0.72]);
    piece(stoneSeat, "seat-front-inlay", "box", gold, [0, 0.36, 0.308], [0.3, 0.045, 0.022]);
    // One or two brass notches distinguish the concentric rows without screen text.
    for (let i = 0; i < seat.ring; i++)
      piece(stoneSeat, "ring-notch", "box", gold, [(i - (seat.ring - 1) / 2) * 0.09, SHRINE_SEAT_HEIGHT + 0.003, -0.22], [0.035, 0.006, 0.1]);
  }

  // Pedestal fits entirely inside the shared radius1.2 obstacle.
  piece(root, "statue-base-lower", "octagon", dark, [0, 0.14, 0], [2.38, 0.28, 2.38]);
  piece(root, "statue-base-brass", "octagon", gold, [0, 0.31, 0], [2.15, 0.08, 2.15]);
  piece(root, "statue-plinth", "taper", stone, [0, 0.55, 0], [1.94, 0.4, 1.94]);
  piece(root, "statue-plinth-top", "octagon", pale, [0, 0.8, 0], [1.85, 0.1, 1.85]);
  const champion = new pc.Entity("faker-homage-abstract-lowpoly-statue");
  root.addChild(champion);
  champion.setLocalPosition(0, 0.85, 0);
  champion.setLocalScale(1.8, 1.8, 1.8);
  const statue = (name: string, shape: Shape, m: pc.Material, at: V3, size: V3, rot?: V3) =>
    piece(champion, name, shape, m, at, size, rot);
  statue("jersey-torso", "taper", red, [0, 1.01, 0], [0.72, 0.68, 0.39], [0, 0, 180]);
  statue("jersey-collar", "octagon", black, [0, 1.36, 0], [0.25, 0.09, 0.26]);
  statue("neck", "octagon", face, [0, 1.42, 0], [0.19, 0.16, 0.2]);
  statue("faceted-head", "octagon", face, [0, 1.65, 0.015], [0.45, 0.41, 0.39]);
  statue("hair-cap", "octagon", black, [0, 1.85, -0.005], [0.46, 0.14, 0.42]);
  statue("hair-fringe-left", "box", black, [-0.09, 1.79, 0.175], [0.25, 0.1, 0.065], [0, 0, -9]);
  statue("hair-fringe-right", "box", black, [0.12, 1.78, 0.17], [0.14, 0.12, 0.065], [0, 0, 14]);
  statue("nose", "taper", face, [0, 1.64, 0.205], [0.065, 0.12, 0.085]);
  statue("mouth", "box", wine, [0, 1.55, 0.198], [0.1, 0.017, 0.015]);
  for (const side of [-1, 1]) {
    statue("trouser-leg", "taper", black, [side * 0.15, 0.39, 0], [0.25, 0.75, 0.28]);
    statue("statue-shoe", "box", dark, [side * 0.15, 0.055, 0.07], [0.27, 0.11, 0.43]);
    statue("sleeve", "taper", red, [side * 0.4, 1.12, 0], [0.22, 0.4, 0.25], [0, 0, side * 14]);
    statue("forearm", "octagon", face, [side * 0.31, 0.91, 0.18], [0.18, 0.39, 0.18], [-64, 0, side * -40]);
    statue("hand", "octagon", face, [side * 0.125, 0.93, 0.35], [0.18, 0.15, 0.19]);
    // Recognizable glasses silhouette, with no branding or borrowed character mesh.
    const eyeX = side * 0.105;
    for (const dy of [-0.048, 0.048])
      statue("glasses-horizontal", "box", black, [eyeX, 1.685 + dy, 0.209], [0.17, 0.018, 0.02]);
    for (const dx of [-0.078, 0.078])
      statue("glasses-vertical", "box", black, [eyeX + dx, 1.685, 0.209], [0.018, 0.1, 0.02]);
    statue("glasses-temple", "box", black, [side * 0.205, 1.69, 0.11], [0.018, 0.018, 0.2]);
    statue("eye", "box", black, [eyeX, 1.685, 0.199], [0.028, 0.022, 0.02]);
    statue("cloak-fold", "box", side < 0 ? red : wine, [side * 0.21, 0.76, -0.26], [0.47, 1.18, 0.11], [-8, side * 12, side * -8]);
    statue("cloak-gold-edge", "box", gold, [side * 0.43, 0.76, -0.24], [0.035, 1.2, 0.13], [-8, side * 12, side * -8]);
  }
  statue("glasses-bridge", "box", black, [0, 1.69, 0.216], [0.06, 0.018, 0.025]);
  statue("cloak-shoulder-mantle", "taper", wine, [0, 1.26, -0.17], [0.86, 0.2, 0.43]);
  // A small, original geometric victory cup replaces any team logo or official icon.
  statue("victory-cup-stem", "octagon", gold, [0, 0.9, 0.38], [0.065, 0.19, 0.065]);
  statue("victory-cup", "taper", gold, [0, 1.06, 0.38], [0.27, 0.22, 0.24], [0, 0, 180]);
  statue("victory-cup-rim", "octagon", glow, [0, 1.17, 0.38], [0.28, 0.025, 0.25]);

  // Warm memorial lights, contrasted with a cool upper fill. None add shadow passes.
  for (const side of [-1, 1]) {
    piece(root, "memorial-lantern-base", "octagon", dark, [side * 0.88, 0.42, 0.38], [0.28, 0.24, 0.28]);
    piece(root, "memorial-lantern-glow", "octagon", glow, [side * 0.88, 0.6, 0.38], [0.15, 0.2, 0.15]);
  }
  const light = (name: string, at: V3, color: string, intensity: number, range: number) => {
    const e = new pc.Entity(name);
    root.addChild(e);
    e.setLocalPosition(...at);
    e.addComponent("light", { type: "omni", color: new pc.Color().fromString(color), intensity, range, castShadows: false });
  };
  light("shrine-warm-key", [0, 5.8, 3.1], "#FFE0B4", 1.65, 14);
  light("shrine-cool-rim", [0, 4.5, -4.5], "#9DAFE3", 0.95, 14);

  // A signed door occupies the existing cave tunnel beyond the walking boundary.
  // The shared proximity point is on the safe cave side, not a centre-floor pad.
  const gate = new pc.Entity("shrine-cave-portal");
  parent.addChild(gate);
  gate.setLocalPosition(SHRINE_PORTAL.x, 0, SHRINE_PORTAL.z);
  const inlay = (into: pc.Entity, label: string, radius: number) => {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      piece(into, `${label}-inlay-${i}`, "box", glow,
        [Math.sin(a) * radius, 0.018, Math.cos(a) * radius],
        [0.19, 0.018, 0.055], [0, a * 180 / Math.PI, 0]);
    }
    piece(into, `${label}-seal`, "octagon", wine, [0, 0.008, 0], [radius * 1.7, 0.012, radius * 1.7]);
    piece(into, `${label}-diamond`, "box", gold, [0, 0.018, 0], [0.45, 0.015, 0.45], [0, 45, 0]);
  };
  gate.setLocalEulerAngles(0, SHRINE_PORTAL.yaw, 0);
  // z=-1.3 puts the door at -17.1, inside the existing tunnel frame/wall opening.
  piece(gate, "door-shadow-recess", "box", black, [0, 1.65, -1.4], [3.4, 3.3, .2]);
  for (const side of [-1, 1]) {
    piece(gate, "stone-door-jamb", "box", stone, [side * 1.55, 1.65, -1.2], [.32, 3.3, .55]);
    piece(gate, "carved-door-leaf", "box", wine, [side * .7, 1.48, -1.24], [1.36, 2.92, .16]);
    piece(gate, "door-brass-edge", "box", gold, [side * 1.3, 1.48, -1.14], [.065, 2.8, .045]);
    piece(gate, "door-pull", "octagon", gold, [side * .19, 1.28, -1.1], [.12, .25, .07]);
    piece(gate, "door-upper-panel", "box", red, [side * .7, 2.17, -1.135], [.9, .85, .045]);
  }
  piece(gate, "door-stone-lintel", "box", pale, [0, 3.28, -1.2], [3.75, .32, .7]);
  const sign = worldSign(app, gate, ["ĐIỆN THỜ FAKER", "Đến gần cửa · Nhấn E để vào"], 3.55, .85, "#DABB7F");
  sign.setLocalPosition(0, 3.92, -1.1);
  piece(gate, "door-threshold", "box", gold, [0, .025, -.85], [2.9, .05, .35]);
  const exit = new pc.Entity("shrine-return-inlay");
  root.addChild(exit);
  exit.setLocalPosition(SHRINE_EXIT.x - SHRINE_CENTER.x, 0, SHRINE_EXIT.z - SHRINE_CENTER.z);
  inlay(exit, "exit", 0.5);

  // Hundreds of small authored pieces merge to a handful of material batches.
  if (app.batcher) {
    const group = app.batcher.getGroupByName("tl_shrine_static") ?? app.batcher.addGroup("tl_shrine_static", false, 24);
    for (const render of renders) render.batchGroupId = group.id;
  }
  return { root, seats };
}
