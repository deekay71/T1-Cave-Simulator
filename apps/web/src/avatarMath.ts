/**
 * Pure helpers behind avatar.ts (no PlayCanvas import, unit-tested in scripts/avatar.test.ts):
 * the session-id -> variant hash and the leg kinematics of the procedural walk.
 *
 * Rig facts (tools/models/groups/characters.ts, manifest meta.rig): hips pivot 0.94 m above the
 * feet, hip joints 0.1 m below it, thigh 0.32 m, knee -> sole 0.52 m, no ankle (the shoe turns
 * with the shin). Leg angles are local X rotations in degrees: thigh X < 0 swings the leg forward,
 * knee X > 0 bends the knee (foot back). A tilted shoe touches the floor with its heel (shin
 * forward) or toe (shin back), so the walk is solved on the shoe's corners, not on one sole point.
 */

/* ------------------------------------------------------------------ hashing */

/** FNV-1a over UTF-16 code units, then the murmur3 finaliser so short ids spread evenly. */
export function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable bucket in [0, n): the same key gives the same index on every client and every run. */
export const pickIndex = (key: string, n: number): number => (n > 0 ? hash32(key) % n : 0);

/** Small deterministic PRNG (mulberry32) returning [0, 1). */
export function rng32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ leg kinematics */

const RAD = Math.PI / 180;

export const LEG = {
  /** hips pivot height in the rest pose */
  hipsY: 0.94,
  /** hip joint below the hips pivot */
  hipDrop: 0.1,
  thigh: 0.32,
  /** knee -> sole */
  shin: 0.52,
  /** shoe outline in the shin's frame (z forward), sneakers and sandals included */
  heelZ: -0.112,
  toeZ: 0.19,
  /** top of the toe box above the sole (matters when the swing foot points down) */
  shoeTop: 0.08,
} as const;

/** Lowest shoe point relative to the hip joint (y < 0 below it, z > 0 in front). */
export interface FootPoint {
  y: number;
  z: number;
  /** which corner touches: 0 heel, 1 toe, 2 heel top, 3 toe top */
  corner: number;
}

/** Forward kinematics of one leg: the lowest corner of the shoe for thigh/knee X angles (deg). */
export function footLow(thighDeg: number, kneeDeg: number, out: FootPoint): FootPoint {
  const a = thighDeg * RAD;
  const c = (thighDeg + kneeDeg) * RAD;
  const ky = -LEG.thigh * Math.cos(a);
  const kz = -LEG.thigh * Math.sin(a);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  out.y = Infinity;
  for (let i = 0; i < 4; i++) {
    const pz = i & 1 ? LEG.toeZ : LEG.heelZ;
    const py = i & 2 ? -LEG.shin + LEG.shoeTop : -LEG.shin;
    const y = ky + py * cc - pz * sc;
    if (y < out.y) {
      out.y = y;
      out.z = kz + py * sc + pz * cc;
      out.corner = i;
    }
  }
  return out;
}

/** z of one shoe corner relative to the hip joint (0 heel or 1 toe, on the sole). */
function cornerZ(thighDeg: number, kneeDeg: number, toe: boolean): number {
  const a = thighDeg * RAD;
  const c = (thighDeg + kneeDeg) * RAD;
  const pz = toe ? LEG.toeZ : LEG.heelZ;
  return -LEG.thigh * Math.sin(a) - LEG.shin * Math.sin(c) + pz * Math.cos(c);
}

/**
 * Walk extremes from the manifest poses walk_a / walk_b (left leg's values): the leading leg at
 * heel strike and the trailing leg at toe-off. The cycle goes front -> rest -> back on the ground
 * (stance) and back -> front in the air (swing), so it passes through the rest pose like the
 * pose blend walk_a <-> rest <-> walk_b.
 */
export interface WalkExtremes {
  frontThigh: number;
  frontKnee: number;
  backThigh: number;
  backKnee: number;
}
export const WALK_DEFAULT: WalkExtremes = { frontThigh: -22, frontKnee: 5, backThigh: 14, backKnee: 22 };

/** Ground contact of one stance, for a stride amplitude k (1 = the poses as authored). */
export interface Stride {
  k: number;
  /** trailing knee at toe-off (deg), solved so both feet touch at heel strike */
  backKnee: number;
  /** heel travel (m) relative to the hips while rolling onto the flat foot */
  heel: number;
  /** toe travel (m) while rolling from the flat foot to toe-off */
  toe: number;
  /** total backward travel of the contact point during one stance = half a cycle */
  length: number;
  /** share of the stance spent on the heel */
  heelShare: number;
}

const TOE_R = Math.hypot(LEG.shin, LEG.toeZ);
const TOE_A = Math.atan2(LEG.toeZ, LEG.shin);
const strideFoot: FootPoint = { y: 0, z: 0, corner: 0 };

/**
 * Stride for amplitude k: the leading leg strikes at the walk_a thigh / knee scaled by k; the
 * trailing knee is solved so its toe touches the floor at the same hips height as that heel
 * (without an ankle the toe works as a lever: the pose's knee would lift the hips at small k and
 * leave the leading heel in the air).
 */
export function strideFor(k: number, w: WalkExtremes = WALK_DEFAULT, out?: Stride): Stride {
  const s = out ?? { k: 0, backKnee: 0, heel: 0, toe: 0, length: 0, heelShare: 0.5 };
  const ft = w.frontThigh * k,
    fk = w.frontKnee * k,
    bt = w.backThigh * k;
  const reach = -footLow(ft, fk, strideFoot).y;
  const cosv = (reach - LEG.thigh * Math.cos(bt * RAD)) / TOE_R;
  const shin = (TOE_A + Math.acos(cosv > 1 ? 1 : cosv < -1 ? -1 : cosv)) / RAD;
  s.k = k;
  s.backKnee = Math.min(55, Math.max(4, shin - bt));
  s.heel = Math.max(1e-4, cornerZ(ft, fk, false) - LEG.heelZ);
  s.toe = Math.max(1e-4, LEG.toeZ - cornerZ(bt, s.backKnee, true));
  s.length = s.heel + s.toe;
  s.heelShare = s.heel / s.length;
  return s;
}

/** Stride amplitude for a speed (m/s): short quick steps when slow, longer ones at 4 m/s. */
export const strideAmplitude = (speed: number): number => Math.min(1.3, Math.max(0.3, 0.3 + 0.26 * speed));

/** Mid-swing knee lift and hip flexion (deg): without an ankle the toe hangs down, so the swing
 * foot needs a real knee bend plus a forward thigh to clear the floor. */
export const swingLift = (k: number): number => 44 + 10 * Math.min(1.3, k);
export const swingFlex = (k: number): number => 20 - 7 * Math.min(1.3, k);

/** Cubic Hermite from (p0, slope m0) at u = 0 to (p1, slope m1) at u = 1. */
const hermite = (p0: number, m0: number, p1: number, m1: number, u: number) => {
  const u2 = u * u,
    u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * p1 + (u3 - u2) * m1;
};
/** sin^2 bump on [0, 1] peaking where u^q = 0.5, flat at both ends. */
const bump = (u: number, q: number) => {
  const s = Math.sin(Math.PI * Math.pow(u, q));
  return s * s;
};

export interface LegAngles {
  thigh: number;
  knee: number;
  /** true while the foot is on the ground */
  stance: boolean;
}

/**
 * Thigh / knee X angles for one leg at leg phase p in [0, 1): [0, 0.5) stance (heel strike ->
 * flat -> toe-off, the contact point sliding back at a constant rate so it stays put on the
 * floor), [0.5, 1) swing (knee lifts, thigh swings forward). The swing curves leave toe-off and
 * reach heel strike with the stance's angular speed (the lift bumps are flat at both ends), so a
 * foot never starts or stops sliding while it touches the floor. Knees never bend backwards.
 */
export function legAngles(p: number, st: Stride, w: WalkExtremes, out: LegAngles): LegAngles {
  const k = st.k;
  const h = st.heelShare;
  const ft = w.frontThigh * k,
    fk = w.frontKnee * k,
    bt = w.backThigh * k,
    bk = st.backKnee;
  p -= Math.floor(p);
  if (p < 0.5) {
    const tau = p * 2;
    out.stance = true;
    if (tau < h) {
      const u = 1 - tau / h;
      out.thigh = ft * u;
      out.knee = fk * u;
    } else {
      const u = (tau - h) / (1 - h);
      out.thigh = bt * u;
      out.knee = bk * u;
    }
  } else {
    const u = (p - 0.5) * 2;
    out.stance = false;
    // slopes per unit u (= per unit stance time tau): toe phase rate at u = 0, heel phase at u = 1
    out.thigh = hermite(bt, bt / (1 - h), ft, -ft / h, u) - swingFlex(k) * bump(u, 1.35);
    out.knee = hermite(bk, bk / (1 - h), fk, -fk / h, u) + swingLift(k) * bump(u, 0.85);
  }
  if (out.knee < 0) out.knee = 0;
  return out;
}

/** Hips height that puts the lower foot on the floor (the other one is in the air or also down). */
export function groundedHipsY(
  lThigh: number,
  lKnee: number,
  rThigh: number,
  rKnee: number,
  tmp: FootPoint,
): number {
  const l = footLow(lThigh, lKnee, tmp).y;
  const r = footLow(rThigh, rKnee, tmp).y;
  return LEG.hipDrop - Math.min(l, r);
}
