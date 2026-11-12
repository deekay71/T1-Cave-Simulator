/**
 * Entry markers: every E-key point of the hub (packages/shared HUB_LANDMARKS) gets a glowing ring on
 * the floor and an arrow that bobs above it, pointing down at the spot — the way open-world games
 * mark a mission entrance. Unlit and fog-free, so in the dark cave they read from across the hall.
 *
 *   const markers = buildMarkers(app, parent, [{ id, x, z, color }]);
 *   markers.update(dt, { x, z }, destinationId);   // every frame
 *
 * - The ring breathes; the arrow bobs +-0.16 m and turns slowly.
 * - The marker the player is being guided to (`active`) is larger, brighter and bobs faster.
 * - Standing on a spot (< HIDE_WITHIN m) hides its arrow so it never hangs in the player's face; the
 *   ring stays. Markers further than FAR m fade out (the black haze hides the world there anyway).
 */
import * as pc from "playcanvas";

export interface MarkerSpot {
  id: string;
  x: number;
  z: number;
  /** CSS hex colour. */
  color: string;
}
export interface Markers {
  root: pc.Entity;
  update(dt: number, player: { x: number; z: number } | null, active: string | null): void;
}

const RING_R = 0.95;
const RING_W = 0.13;
const ARROW_Y = 2.35;
const BOB = 0.16;
const HIDE_WITHIN = 2.2;
const FAR = 46;

function mesh(device: pc.GraphicsDevice, pos: number[], idx: number[]): pc.Mesh {
  const m = new pc.Mesh(device);
  m.setPositions(pos);
  m.setIndices(idx);
  m.update(pc.PRIMITIVE_TRIANGLES);
  return m;
}
/** Flat annulus on the floor (y = 0), both windings so it shows from any side. */
function ringMesh(device: pc.GraphicsDevice, r: number, w: number, n = 40): pc.Mesh {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * (r - w), 0, s * (r - w), c * r, 0, s * r);
    const a0 = i * 2, a1 = a0 + 1, b0 = ((i + 1) % n) * 2, b1 = b0 + 1;
    idx.push(a0, b0, a1, a1, b0, b1, a0, a1, b0, a1, b1, b0);
  }
  return mesh(device, pos, idx);
}
/** Arrow pointing down: a four-sided head (tip at y = 0) under a square shaft. */
function arrowMesh(device: pc.GraphicsDevice): pc.Mesh {
  const head = 0.34, headH = 0.46, shaft = 0.13, shaftH = 0.42;
  const pos: number[] = [0, 0, 0], idx: number[] = [];
  const ring = (half: number, y: number) => {
    const base = pos.length / 3;
    pos.push(-half, y, -half, half, y, -half, half, y, half, -half, y, half);
    return base;
  };
  const h = ring(head, headH);
  for (let i = 0; i < 4; i++) idx.push(0, h + ((i + 1) % 4), h + i);
  idx.push(h, h + 1, h + 2, h, h + 2, h + 3); // top of the head
  const s0 = ring(shaft, headH), s1 = ring(shaft, headH + shaftH);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(s0 + i, s0 + j, s1 + j, s0 + i, s1 + j, s1 + i);
  }
  idx.push(s1, s1 + 2, s1 + 1, s1, s1 + 3, s1 + 2);
  return mesh(device, pos, idx);
}

function glow(color: string): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString(color);
  m.emissiveIntensity = 1;
  m.opacity = 1;
  m.blendType = pc.BLEND_ADDITIVEALPHA;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

export function buildMarkers(app: pc.AppBase, parent: pc.Entity, spots: readonly MarkerSpot[]): Markers {
  const device = app.graphicsDevice;
  const root = new pc.Entity("entry-markers");
  parent.addChild(root);
  const ring = ringMesh(device, RING_R, RING_W);
  const inner = ringMesh(device, RING_R * 0.62, RING_W * 0.5);
  const arrow = arrowMesh(device);
  const items = spots.map((spot, i) => {
    const material = glow(spot.color);
    const node = new pc.Entity(`marker-${spot.id}`);
    node.setLocalPosition(spot.x, 0.04, spot.z);
    const add = (name: string, m: pc.Mesh) => {
      const e = new pc.Entity(name);
      e.addComponent("render", { meshInstances: [new pc.MeshInstance(m, material)], castShadows: false, receiveShadows: false });
      node.addChild(e);
      return e;
    };
    const outer = add("ring", ring);
    add("ring-inner", inner);
    const pointer = add("arrow", arrow);
    root.addChild(node);
    return { spot, node, outer, pointer, material, phase: i * 1.7, level: 1 };
  });
  let time = 0;
  return {
    root,
    update(dt, player, active) {
      time += dt;
      for (const it of items) {
        const on = it.spot.id === active;
        const d = player ? Math.hypot(player.x - it.spot.x, player.z - it.spot.z) : Infinity;
        const visible = d < FAR;
        if (it.node.enabled !== visible) it.node.enabled = visible;
        if (!visible) continue;
        const speed = on ? 4.2 : 2.4;
        const bob = Math.sin(time * speed + it.phase);
        const k = on ? 1.45 : 1;
        it.pointer.enabled = d > HIDE_WITHIN;
        it.pointer.setLocalPosition(0, ARROW_Y + BOB * (on ? 1.5 : 1) * bob, 0);
        it.pointer.setLocalEulerAngles(0, ((time * 70 + it.phase * 40) % 360), 0);
        it.pointer.setLocalScale(k, k, k);
        const breathe = 1 + 0.07 * Math.sin(time * 2.1 + it.phase);
        it.outer.setLocalScale(k * breathe, 1, k * breathe);
        // Brightness: the guided marker pulses; the others sit a little dimmer and fade toward FAR.
        const fade = Math.min(1, Math.max(0, (FAR - d) / 10));
        const level = (on ? 1.5 + 0.45 * Math.sin(time * 5) : 0.9) * fade;
        if (Math.abs(level - it.level) > 0.02) {
          it.level = level;
          it.material.emissiveIntensity = level;
          it.material.update();
        }
      }
    },
  };
}

/**
 * Seat rings: a thin white circle on the floor round every thing a player can sit on (stools,
 * crates, low stones: packages/shared CAVE_SEATS), so it reads at a glance what F works on. One
 * shared unlit material; rings further than SEAT_FAR m from the player are switched off, and a
 * ring whose seat is taken dims.
 */
export interface SeatRings {
  root: pc.Entity;
  update(player: { x: number; z: number } | null, taken: ReadonlySet<string>): void;
}
const SEAT_FAR = 16;
export function buildSeatRings(app: pc.AppBase, parent: pc.Entity, seats: readonly { id: string; x: number; z: number; r: number }[]): SeatRings {
  const root = new pc.Entity("seat-rings");
  parent.addChild(root);
  const free = glow("#FFFFFF");
  free.emissiveIntensity = 0.55;
  free.update();
  const busy = glow("#FFFFFF");
  busy.emissiveIntensity = 0.14;
  busy.update();
  // unit ring (outer radius 1), scaled per seat; the line stays ~4.5 cm wide at a typical 0.5 m radius
  const unit = ringMesh(app.graphicsDevice, 1, 0.09, 32);
  const items = seats.map((seat) => {
    const e = new pc.Entity(`seat-ring-${seat.id}`);
    const instance = new pc.MeshInstance(unit, free);
    e.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: false });
    e.setLocalPosition(seat.x, 0.03, seat.z);
    e.setLocalScale(seat.r, 1, seat.r);
    e.enabled = false;
    root.addChild(e);
    return { seat, e, instance, taken: false };
  });
  return {
    root,
    update(player, taken) {
      for (const it of items) {
        const on = !!player && Math.hypot(player.x - it.seat.x, player.z - it.seat.z) < SEAT_FAR;
        if (it.e.enabled !== on) it.e.enabled = on;
        if (!on) continue;
        const t = taken.has(it.seat.id);
        if (t !== it.taken) {
          it.taken = t;
          it.instance.material = t ? busy : free;
        }
      }
    },
  };
}
