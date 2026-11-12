import { CAVE_SHRINE_GATE } from "./stalls.js";
import { z } from 'zod';
import { applyInput, constrain, type Axes, type Layout, type Position } from './index.js';

/**
 * A separate island in the same room: all zone changes are server-authoritative. It lies far east
 * of the cave (the side caves reach x = 39 with their walk discs and ~44 with their rock).
 */
export const SHRINE_CENTER = { x: 120, z: 0 } as const;
export const SHRINE_RADIUS = 8;
export const SHRINE_PORTAL = CAVE_SHRINE_GATE;
export const SHRINE_ENTRY = { x: SHRINE_CENTER.x, z: SHRINE_CENTER.z + 6.8 } as const;
export const SHRINE_EXIT = { x: SHRINE_CENTER.x, z: SHRINE_CENTER.z + 7.2 } as const;
/** Everything east of this x is the shrine island (the cave's walk area ends at x = 39). */
export const SHRINE_ZONE_X = 80;
export const SHRINE_PORTAL_DISTANCE = 3;
export const SHRINE_SEAT_DISTANCE = 2;
export const SHRINE_GESTURE_MS = 3_000;
export const SHRINE_SEAT_HEIGHT = 0.48;
export const SHRINE_LIMIT = { capacity: 6, perMs: 3_000 } as const;

export interface ShrineSeat {
  id: string;
  label: string;
  ring: 1 | 2 | 3;
  index: number;
  x: number;
  z: number;
  /** Degrees around Y, facing the statue. */
  yaw: number;
}

/**
 * Three rings of stone seats round the statue: 8 at 3 m, 12 at 5 m and a rim ring at 7 m on an
 * 18-slot grid (20 degrees apart) whose three slots on the +Z approach stay empty, so the way in
 * from SHRINE_ENTRY is never blocked: 35 seats. `index` is the slot on the ring's grid (angle =
 * index * 360 / slots from +Z); ids number the seats that exist.
 */
const SHRINE_RINGS = [
  { ring: 1, slots: 8, radius: 3, prefix: 'inner', label: 'Vòng trong', skip: [] },
  { ring: 2, slots: 12, radius: 5, prefix: 'outer', label: 'Vòng ngoài', skip: [] },
  { ring: 3, slots: 18, radius: 7, prefix: 'rim', label: 'Vòng rìa', skip: [0, 1, 17] },
] as const;
export const SHRINE_SEATS: readonly ShrineSeat[] = SHRINE_RINGS.flatMap(({ ring, slots, radius, prefix, label, skip }) =>
  Array.from({ length: slots }, (_, index) => index)
    .filter(index => !(skip as readonly number[]).includes(index))
    .map((index, n) => {
      const angle = index * Math.PI * 2 / slots;
      return {
        id: `${prefix}-${n + 1}`, label: `${label} · ${n + 1}`,
        ring, index,
        x: Math.fround(SHRINE_CENTER.x + Math.sin(angle) * radius),
        z: Math.fround(SHRINE_CENTER.z + Math.cos(angle) * radius),
        yaw: (index * 360 / slots + 180) % 360,
      };
    }));

/** The translated shrine-local layout reuses the deterministic cave solver. */
const SHRINE_LAYOUT: Layout = {
  radius: SHRINE_RADIUS,
  obstacles: [{ x: 0, z: 0, r: 1.2 }],
  spawn: { x: 0, z: 6.8, spread: 0 },
};

export function isInShrine(p: Position): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.z) && p.x > SHRINE_ZONE_X;
}

export function nearShrinePortal(p: Position): boolean {
  return near(p, SHRINE_PORTAL, SHRINE_PORTAL_DISTANCE);
}

export function near(p: Position, target: Position, radius: number): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.z)
    && (p.x - target.x) ** 2 + (p.z - target.z) ** 2 <= radius ** 2;
}

export function constrainShrine(x: number, z: number): Position {
  const p = constrain(x - SHRINE_CENTER.x, z - SHRINE_CENTER.z, SHRINE_LAYOUT);
  return { x: Math.fround(p.x + SHRINE_CENTER.x), z: Math.fround(p.z + SHRINE_CENTER.z) };
}

/** Shared server movement and client prediction. A reserved seat suppresses all movement. */
export function applyShrineAwareInput(p: Position & { shrineSeat?: string }, cmd: Axes, dt: number): void {
  if (p.shrineSeat) return;
  if (!isInShrine(p)) return applyInput(p, cmd, dt);
  const local = { x: p.x - SHRINE_CENTER.x, z: p.z - SHRINE_CENTER.z };
  applyInput(local, cmd, dt, SHRINE_LAYOUT);
  p.x = Math.fround(local.x + SHRINE_CENTER.x);
  p.z = Math.fround(local.z + SHRINE_CENTER.z);
}

/** Stand on the outward side of the seat, safely inside the walking floor. */
export function shrineStandingPoint(seat: ShrineSeat): Position {
  const dx = seat.x - SHRINE_CENTER.x, dz = seat.z - SHRINE_CENTER.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  return constrainShrine(seat.x + dx / length * 0.9, seat.z + dz / length * 0.9);
}

/** Return beside the portal; never put an avatar inside the old altar collider. */
export function shrineReturnPoint(): Position {
  const p = constrain(SHRINE_PORTAL.x, SHRINE_PORTAL.z + 2.2);
  return { x: Math.fround(p.x), z: Math.fround(p.z) };
}

export const ShrineGesture = z.enum(['pray', 'bow']);
export type ShrineGesture = z.infer<typeof ShrineGesture>;
export const ShrineRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enter') }).strict(),
  z.object({ action: z.literal('exit') }).strict(),
  z.object({ action: z.literal('sit'), seatId: z.string().min(1).max(32) }).strict(),
  z.object({ action: z.literal('stand') }).strict(),
  z.object({ action: z.literal('gesture'), gesture: ShrineGesture }).strict(),
]);
export type ShrineRequest = z.infer<typeof ShrineRequest>;
export interface ShrineSnapshot {
  serverNow: number;
  seats: { id: string; occupant: string | null }[];
}
