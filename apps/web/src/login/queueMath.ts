/**
 * Pure helpers of the login queue (no PlayCanvas import; unit-tested in scripts/login.test.ts):
 * the path as an arc-length table, where each fan stands on the endless loop, and how a fan fades
 * into the cave.
 *
 * The path comes from the ground's manifest entry (tools/models/groups/login.ts): points every
 * ~0.5 m in set space, from the gully behind the crest to the inside of the tunnel.
 */

export type P3 = readonly [number, number, number];

export interface QueuePath {
  pts: readonly P3[];
  /** horizontal arc length at each point (m) */
  s: number[];
  length: number;
}

export function buildPath(pts: readonly P3[]): QueuePath {
  const s = [0];
  for (let i = 1; i < pts.length; i++)
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  return { pts, s, length: s[s.length - 1] ?? 0 };
}

export interface PathSample {
  x: number;
  y: number;
  z: number;
  /** heading in radians: the walk direction is (sin yaw, cos yaw) in set space */
  yaw: number;
  /** rise per metre walked (negative = downhill) */
  slope: number;
}

/** Point of the path at arc length s (clamped to the ends). Allocation-free: writes into `out`. */
export function samplePath(path: QueuePath, s: number, out: PathSample): PathSample {
  const { pts, s: S } = path;
  const n = pts.length;
  if (n < 2) {
    out.x = pts[0]?.[0] ?? 0;
    out.y = pts[0]?.[1] ?? 0;
    out.z = pts[0]?.[2] ?? 0;
    out.yaw = out.slope = 0;
    return out;
  }
  const v = s < 0 ? 0 : s > path.length ? path.length : s;
  // the table is uniform to within rounding: start from the proportional guess
  let i = Math.min(n - 2, Math.max(0, Math.floor((v / path.length) * (n - 1))));
  while (i > 0 && S[i] > v) i--;
  while (i < n - 2 && S[i + 1] < v) i++;
  const a = pts[i],
    b = pts[i + 1];
  const seg = S[i + 1] - S[i] || 1;
  const t = (v - S[i]) / seg;
  out.x = a[0] + (b[0] - a[0]) * t;
  out.y = a[1] + (b[1] - a[1]) * t;
  out.z = a[2] + (b[2] - a[2]) * t;
  // heading from the neighbours' chord: no kink at the table's points
  const p = pts[Math.max(0, i - 1)],
    q = pts[Math.min(n - 1, i + 2)];
  out.yaw = Math.atan2(q[0] - p[0], q[2] - p[2]);
  out.slope = (b[1] - a[1]) / seg;
  return out;
}

/** Queue numbers. Speeds in m/s, lengths in metres. */
export const QUEUE = {
  fans: 8,
  /** slow trudge */
  speed: 0.7,
  /** the loop starts this far before the crest (hidden in the gully, below the frame) ... */
  lead: 4.6,
  /** ... and ends this far past the threshold (fully faded by then) */
  tail: 4.6,
  /** each fan drifts this far ahead of / behind its slot (m), slowly */
  sway: 0.22,
  /** each fan walks this far beside the centre line (m) */
  lateral: 0.16,
} as const;

export interface QueueLoop {
  start: number;
  length: number;
  /** distance between two fans */
  spacing: number;
}
export function queueLoop(path: QueuePath, crestS: number, mouthS: number, fans: number = QUEUE.fans): QueueLoop {
  const start = Math.max(0, crestS - QUEUE.lead);
  const end = Math.min(path.length, mouthS + QUEUE.tail);
  const length = Math.max(1, end - start);
  return { start, length, spacing: length / Math.max(1, fans) };
}

/** Arc length of fan `i` when the line has advanced `travelled` metres: evenly spaced, endless. */
export function fanS(loop: QueueLoop, i: number, travelled: number): number {
  const u = (travelled + i * loop.spacing) % loop.length;
  return loop.start + (u < 0 ? u + loop.length : u);
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A fan `past` metres beyond the threshold (negative = still outside): fanLight scales its colours
 * (1 outside -> a dark silhouette against the glow), fanOpacity dissolves it at the very end.
 */
export const fanLight = (past: number): number => 1 - 0.9 * smooth(-1.5, 2.6, past);
export const fanOpacity = (past: number): number => 1 - smooth(2.2, QUEUE.tail - 0.3, past);
