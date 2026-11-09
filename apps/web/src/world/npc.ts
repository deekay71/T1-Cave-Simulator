/**
 * Static NPC fans: manifest poses, a held prop and a subtle breathing idle.
 * Poses are ABSOLUTE local euler degrees per joint (setLocalEulerAngles) or {rot, at}, exactly as
 * written in manifest.characters.json; joints a pose does not list stay at rest.
 */
import * as pc from "playcanvas";
import type { HeldProp, PoseJoint, Vec3 } from "@te-liet/shared";

const TAU = Math.PI * 2;

const isVec3 = (v: PoseJoint): v is Vec3 => Array.isArray(v);

/** Apply pose joints to a character instance; returns the joint names that were not found. */
export function applyPose(
  root: pc.Entity,
  pose: Readonly<Record<string, PoseJoint>>,
): string[] {
  const missing: string[] = [];
  for (const [name, v] of Object.entries(pose)) {
    const node = root.findByName(name);
    if (!node) {
      missing.push(name);
      continue;
    }
    if (isVec3(v)) node.setLocalEulerAngles(v[0], v[1], v[2]);
    else {
      if (v.rot) node.setLocalEulerAngles(v.rot[0], v.rot[1], v.rot[2]);
      if (v.at) node.setLocalPosition(v.at[0], v.at[1], v.at[2]);
    }
  }
  return missing;
}

/**
 * Parent `prop` to `joint` so it follows the idle. `held.at` is in the joint's local frame; the
 * prop is oriented by `held.rot` relative to the NPC root (default upright) or, with `held.aim`,
 * so that its +Y (a phone's screen) faces a point given in another joint's frame, top edge (-Z)
 * along that joint's up.
 */
export function attachHeld(
  npc: pc.Entity,
  joint: pc.GraphNode,
  prop: pc.Entity,
  held: HeldProp,
): string | null {
  const v = (a: Vec3) => new pc.Vec3(a[0], a[1], a[2]);
  const pos = joint.getWorldTransform().transformPoint(v(held.at));
  let q: pc.Quat;
  if (held.aim) {
    const node = npc.findByName(held.aim.node);
    if (!node) return held.aim.node;
    const target = node.getWorldTransform().transformPoint(v(held.aim.at));
    const look = new pc.Mat4().setLookAt(
      pos,
      target,
      node.up.clone().mulScalar(-1),
    );
    q = new pc.Quat()
      .setFromMat4(look)
      .mul(new pc.Quat().setFromEulerAngles(-90, 0, 0));
  } else {
    const r = held.rot ?? [0, 0, 0];
    q = npc
      .getRotation()
      .clone()
      .mul(new pc.Quat().setFromEulerAngles(r[0], r[1], r[2]));
  }
  joint.addChild(prop);
  prop.setPosition(pos);
  prop.setRotation(q);
  return null;
}

interface BreathJoint {
  node: pc.GraphNode;
  base: pc.Vec3;
  amp: number;
  lag: number;
}

/** Breathing: spine, neck and head nod by ±1–2° at 0.2–0.3 Hz, phase per NPC. */
export class Breather {
  private readonly joints: BreathJoint[] = [];
  private readonly hz: number;
  private readonly phase: number;

  /** `pose` = the joints applied to `root` (base angles of the nod; unlisted joints rest at 0). */
  constructor(
    root: pc.Entity,
    pose: Readonly<Record<string, PoseJoint>>,
    seed: number,
  ) {
    // Deterministic per-NPC rate and phase (no Math.random: screenshots with ?time stay stable).
    const r1 = fract(Math.sin(seed * 12.9898) * 43758.5453),
      r2 = fract(Math.sin(seed * 78.233) * 12543.1234);
    this.hz = 0.2 + r1 * 0.1;
    this.phase = r2 * TAU;
    for (const [name, amp, lag] of [
      ["spine", 1.6, 0],
      ["neck", 1.1, 0.5],
      ["head", 1.3, 0.9],
    ] as const) {
      const node = root.findByName(name);
      const v = pose[name];
      const e = v === undefined ? null : isVec3(v) ? v : (v.rot ?? null);
      if (node)
        this.joints.push({
          node,
          base: new pc.Vec3(e?.[0] ?? 0, e?.[1] ?? 0, e?.[2] ?? 0),
          amp,
          lag,
        });
    }
  }

  update(t: number) {
    const a = TAU * this.hz * t + this.phase;
    for (const j of this.joints)
      j.node.setLocalEulerAngles(
        j.base.x + j.amp * Math.sin(a - j.lag),
        j.base.y,
        j.base.z,
      );
  }
}

const fract = (v: number) => v - Math.floor(v);
