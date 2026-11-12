/**
 * Furniture group — wooden / cloth furniture and signage for concept v3 "Hang trú thua".
 *
 * Targets: design/concepts/v3/04-props.png catalog (STOOL, TABLE, TARP SHELTER, CRATE, MEMORY
 * BOARD, ENTRANCE SIGN), 02-memory-wall.png (wall of memories, quiz corner, living corner) and
 * the rest corner of 01-environment.png (pallet bed base under a patched tarp).
 *
 * Conventions: metres, Y up, every asset faces +Z, pivot at the bottom centre of its bounds.
 * All randomness comes from seeded Rng streams / builder rngs used in a fixed order, so the
 * output is byte-identical across builds.
 */
import {
  MeshBuilder,
  Model,
  PALETTE as P,
  Rng,
  mix,
  rotatePoint,
  shade,
  shape2d,
  type Color,
  type PrimOpts,
  type Vec2,
  type Vec3,
} from "../lib.js";

const DEG = Math.PI / 180;

/* =========================================================================================
 * Small helpers (local to this group)
 * ========================================================================================= */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const rn = (x: number) => Math.round(x * 1e4) / 1e4;
const r4 = (v: Vec3): Vec3 => v.map(rn) as Vec3;
/** Rotate a 2D point CCW by `deg` around the origin. */
const rot2 = ([x, y]: Vec2, deg: number): Vec2 => {
  const c = Math.cos(deg * DEG),
    s = Math.sin(deg * DEG);
  return [x * c - y * s, x * s + y * c];
};
/** Point on the segment top -> bottom at height y. */
const atY = (top: Vec3, bottom: Vec3, y: number): Vec3 => lerp3(top, bottom, (top[1] - y) / (top[1] - bottom[1]));

/*
 * Group wood tones. Derived from the palette woods but a little darker and redder: rendered under
 * ACES + the warm game key, P.woodLight came out ~15 % brighter and yellower than the concept
 * catalog (04) furniture, so these are calibrated against samples of that catalog.
 */
/** Seats, table tops, lids, lit boards (catalog stool top ~#B07B50 under neutral light). */
const WOOD_TOP = shade(mix(P.woodLight, P.rust, 0.25), 0.88);
/** Legs, crate frames, posts. */
const WOOD = shade(mix(P.wood, P.rust, 0.2), 0.86);
/** Stretchers, battens, struts. */
const WOOD_DARK = P.woodDark;
/** Recessed crate panels. */
const WOOD_PANEL = shade(P.wood, 0.72);
/** Weathered greyish wood of the entrance sign (paler than the furniture, as in the concept). */
const PALE_WOOD = mix(mix(P.woodLight, P.woodGrey, 0.45), P.worn, 0.24);
/** Rope / twine colour (between worn cloth and pale wood). */
const ROPE = mix(P.cardboard, P.worn, 0.25);

/** Matte wood: slightly lighter tops, darker end grain / undersides, gentle per-face variation. */
function wood(c: Color, vary = 0.06): PrimOpts {
  return {
    color: c,
    parts: {
      top: shade(c, 1.06),
      bottom: shade(c, 0.7),
      end: shade(c, 0.8),
      cap: shade(c, 0.8),
      bevel: shade(c, 1.03),
    },
    vary,
  };
}

/**
 * Square leg / post from `top` to `bottom` with HORIZONTAL end cuts, so a splayed leg stands flat
 * on the floor. Faces are turned toward the splay direction (or `yawDeg`). 12 tris.
 */
function leg(b: MeshBuilder, top: Vec3, bottom: Vec3, size: number | Vec2, style: PrimOpts, yawDeg?: number): void {
  const [sx, sz] = typeof size === "number" ? [size, size] : size;
  const dx = bottom[0] - top[0],
    dz = bottom[2] - top[2];
  const yaw = yawDeg !== undefined ? yawDeg * DEG : Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dz, dx) : 0;
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const pts: Vec3[] = [];
  for (const p of [top, bottom])
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const a = (u * sx) / 2,
        w = (v * sz) / 2;
      pts.push([p[0] + a * c - w * s, p[1], p[2] + a * s + w * c]);
    }
  b.hull(pts, style);
}

/** Round-ish pole with horizontal end cuts: hull of two n-gons. sides 6 -> 20 tris. */
function pole(b: MeshBuilder, bottom: Vec3, top: Vec3, radius: number | Vec2, style: PrimOpts, sides = 6, phase = 0): void {
  const [rb, rt] = typeof radius === "number" ? [radius, radius] : radius;
  const pts: Vec3[] = [];
  for (const [p, r] of [
    [bottom, rb],
    [top, rt],
  ] as const)
    for (let i = 0; i < sides; i++) {
      const a = phase * DEG + (i / sides) * Math.PI * 2;
      pts.push([p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r]);
    }
  b.hull(pts, style);
}

/** Square bar between two points (stretchers, battens, struts). 12 tris. */
function bar(b: MeshBuilder, a: Vec3, c: Vec3, size: number, style: PrimOpts): void {
  b.tube([a, c], { radius: size / Math.SQRT2, sides: 4, phase: 45, ...style });
}

/** Flat polygon decal in the builder's XY plane at depth z, facing +Z. */
function decal(b: MeshBuilder, pts: Vec2[], z: number, color: Color): void {
  b.extrude(pts, { depth: 0, at: [0, 0, z], color });
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/**
 * Moves the temporary builder `g` into the model root so that min y = 0 and (optionally) the
 * bounds are centred on x/z. Returns the applied offset (apply it to anchors as well).
 */
function settle(m: Model, g: MeshBuilder, center: { x?: boolean; z?: boolean } = {}): Vec3 {
  const bb = g.bounds();
  if (!bb) throw new Error(`${m.name}: empty geometry`);
  const off = r4([
    center.x === false ? 0 : -(bb.min[0] + bb.max[0]) / 2,
    -bb.min[1],
    center.z === false ? 0 : -(bb.min[2] + bb.max[2]) / 2,
  ]);
  m.geo.add(g, { at: off });
  m.geo.degenerate += g.degenerate;
  return off;
}

/** Box collider = the model's (settled) bounding box. */
function boundsCollider(m: Model): { type: "box"; center: Vec3; size: Vec3 } {
  const bb = m.geo.bounds();
  if (!bb) throw new Error(`${m.name}: empty geometry`);
  return {
    type: "box",
    center: r4(lerp3(bb.min, bb.max, 0.5)),
    size: r4(sub3(bb.max, bb.min)),
  };
}

/* =========================================================================================
 * Stools
 * ========================================================================================= */

function stoolRound(): Model {
  const name = "tl_furn_stool_v01";
  const H = 0.42; // seat top
  const m = new Model(name, {
    budget: 300,
    notes:
      "Crude round stool (04 STOOL, 02 quiz/living corners): irregular octagonal seat with chamfered top, " +
      "4 splayed square legs, staggered stretcher ring. Seat top 0.42 m, footprint ~0.4 m.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const T = 0.066,
    R = 0.18;
  const poly: Vec2[] = Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2 + rng.jitter(0.06);
    const r = R * (1 + rng.jitter(0.04));
    return [Math.cos(a) * r, Math.sin(a) * r] as Vec2;
  });
  const ring = (k: number, y: number) => poly.map(([x, z]) => [x * k, y, z * k] as Vec3);
  g.hull([...ring(0.94, H - T), ...ring(1, H - 0.02), ...ring(0.86, H)], wood(WOOD_TOP, 0.05));
  // two hairline cracks on the seat (flat decals lying on the top face)
  const crackC = shade(P.woodDark, 0.75);
  for (const [a, len] of [
    [rng.range(0, 90), 0.1],
    [rng.range(180, 270), 0.07],
  ] as const) {
    const p0 = rot2([R * 0.82, 0], a),
      p1 = rot2([R * 0.82 - len, 0.004], a),
      p2 = rot2([R * 0.82, 0.009], a);
    g.extrude([p0, p1, p2], { depth: 0, rot: [-90, 0, 0], at: [0, H + 0.0015, 0], color: crackC });
  }
  const legs: [Vec3, Vec3][] = [];
  for (let i = 0; i < 4; i++) {
    const a = (45 + 90 * i) * DEG + rng.jitter(0.05);
    const top: Vec3 = [Math.cos(a) * 0.1, H - T + 0.012, Math.sin(a) * 0.1];
    const rb = 0.172 * (1 + rng.jitter(0.04));
    const bottom: Vec3 = [Math.cos(a) * rb, 0, Math.sin(a) * rb];
    legs.push([top, bottom]);
    leg(g, top, bottom, 0.054, wood(WOOD, 0.06));
  }
  for (let i = 0; i < 4; i++) {
    const [t0, b0] = legs[i],
      [t1, b1] = legs[(i + 1) % 4];
    const y = i % 2 ? 0.165 : 0.135;
    bar(g, atY(t0, b0, y), atY(t1, b1, y), 0.03, wood(WOOD_DARK, 0.05));
  }
  const off = settle(m, g);
  m.anchor("seat", add3([0, H, 0], off));
  m.collider = { type: "cylinder", center: [0, H / 2, 0], radius: 0.2, height: H };
  m.meta = { seatHeight: H, footprint: [0.4, 0.4] };
  return m;
}

function stoolSquare(): Model {
  const name = "tl_furn_stool_square_v01";
  const H = 0.44;
  const m = new Model(name, {
    budget: 300,
    notes:
      "Square plank stool variant: two seat planks on cleats, 4 splayed legs, stretchers at two heights. " +
      "Seat top 0.44 m, footprint ~0.4 m.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const T = 0.045;
  const seat: [number, number, Color][] = [
    [-0.088, 0.172, WOOD_TOP],
    [0.087, 0.166, shade(WOOD_TOP, 0.92)],
  ];
  for (const [z, w, c] of seat)
    g.plank({
      size: [0.39, T, w],
      at: [rng.jitter(0.01), H - T / 2, z],
      rot: [0, rng.jitter(2.5), 0],
      jitter: 0.14,
      ...wood(c, 0.05),
    });
  for (const x of [-0.115, 0.115]) g.box({ size: [0.05, 0.03, 0.33], at: [x, H - T - 0.016, 0], ...wood(WOOD_DARK) });
  const tops: Vec3[] = [];
  const bots: Vec3[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const top: Vec3 = [sx * 0.115, H - T - 0.02, sz * 0.12];
    const bottom: Vec3 = [sx * (0.155 + rng.jitter(0.006)), 0, sz * (0.16 + rng.jitter(0.006))];
    tops.push(top);
    bots.push(bottom);
    leg(g, top, bottom, 0.05, wood(WOOD, 0.06));
  }
  // front / back stretchers low, side stretchers higher (they cross without touching)
  for (const [a, c, y] of [
    [0, 1, 0.13],
    [2, 3, 0.13],
    [1, 2, 0.21],
    [3, 0, 0.21],
  ] as const)
    bar(g, atY(tops[a], bots[a], y), atY(tops[c], bots[c], y), 0.028, wood(WOOD_DARK, 0.05));
  const off = settle(m, g);
  m.anchor("seat", add3([0, H, 0], off));
  m.collider = { type: "box", center: [0, H / 2, 0], size: [0.38, H, 0.38] };
  m.meta = { seatHeight: H, footprint: [0.38, 0.38] };
  return m;
}

/* =========================================================================================
 * Tables
 * ========================================================================================= */

function table(
  name: string,
  L: number,
  D: number,
  H: number,
  o: { notes: string; budget: number; planks: number; longStretcher: boolean },
): Model {
  const m = new Model(name, { budget: o.budget, notes: o.notes });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const T = 0.055,
    gap = 0.01;
  const pw = (D - gap * (o.planks - 1)) / o.planks;
  const tones = [WOOD_TOP, shade(WOOD_TOP, 0.9), mix(WOOD_TOP, P.woodGrey, 0.25), mix(WOOD_TOP, WOOD, 0.4)];
  const crackC = shade(WOOD_DARK, 0.7);
  for (let i = 0; i < o.planks; i++) {
    const z = -D / 2 + pw / 2 + i * (pw + gap) + rng.jitter(0.004);
    const len = L * (1 + rng.jitter(0.016)),
      x = rng.jitter(0.02),
      top = H + rng.jitter(0.003);
    g.plank({
      size: [len, T, pw * (1 + rng.jitter(0.05))],
      at: [x, top - T / 2, z],
      rot: [0, rng.jitter(0.6), 0],
      jitter: 0.22,
      ...wood(tones[i % tones.length], 0.05),
    });
    // a split running in from one end of every other plank (as in the catalog table)
    if (i % 2 === 0) {
      const e = rng.sign(),
        xe = x + e * (len / 2 - 0.035),
        cl = rng.range(0.14, 0.26),
        cz = z + rng.jitter(pw * 0.2);
      g.extrude(
        [
          [xe, -(cz - 0.005)],
          [xe - e * cl, -cz],
          [xe, -(cz + 0.005)],
        ],
        { depth: 0, rot: [-90, 0, 0], at: [0, top + 0.002, 0], color: crackC },
      );
    }
  }
  const bx = L / 2 - Math.min(0.17, L * 0.13);
  const yb = H - T - 0.004 - 0.025;
  for (const s of [-1, 1]) g.box({ size: [0.08, 0.05, D * 1.05], at: [s * bx, yb, 0], ...wood(WOOD_DARK, 0.05) });
  const legs: [Vec3, Vec3][] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const top: Vec3 = [sx * bx, yb - 0.01, sz * (D / 2 - 0.075)];
      const bottom: Vec3 = [sx * (bx + 0.03 + rng.jitter(0.008)), 0, sz * (D / 2 - 0.05 + rng.jitter(0.008))];
      legs.push([top, bottom]);
      leg(g, top, bottom, 0.082, wood(WOOD, 0.06));
    }
  // end stretchers (front-back) and the long stretcher between them
  const ys = Math.min(0.2, H * 0.3);
  const mids: Vec3[] = [];
  for (const [a, c] of [
    [0, 1],
    [2, 3],
  ]) {
    const p0 = atY(legs[a][0], legs[a][1], ys),
      p1 = atY(legs[c][0], legs[c][1], ys);
    bar(g, p0, p1, 0.045, wood(WOOD_DARK, 0.05));
    mids.push(lerp3(p0, p1, 0.5));
  }
  if (o.longStretcher) bar(g, add3(mids[0], [0, 0.045, 0]), add3(mids[1], [0, 0.045, 0]), 0.05, wood(WOOD, 0.05));
  const off = settle(m, g);
  m.anchor("top", add3([0, H, 0], off));
  m.collider = { type: "box", center: [0, H / 2, 0], size: [L, H, D] };
  m.meta = { topHeight: H, footprint: [L, D] };
  return m;
}

/* =========================================================================================
 * Crates and pallet
 * ========================================================================================= */

function crate(
  name: string,
  size: Vec3,
  o: { notes: string; budget: number; frame: number; lidPlanks: number; xBrace?: boolean },
): Model {
  const [W, H, D] = size;
  const m = new Model(name, { budget: o.budget, notes: o.notes });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const t = 0.022,
    tr = 0.016, // raised lid rim
    w = o.frame,
    Hc = H - t - tr;
  const frameC = mix(WOOD_TOP, WOOD, 0.35);
  const panelC = WOOD_PANEL;
  // recessed panel core: three stacked slabs, the middle one inset 4 mm (reads as board seams)
  for (let k = 0; k < 3; k++) {
    const y0 = (Hc * k) / 3,
      y1 = (Hc * (k + 1)) / 3;
    const inset = t + (k === 1 ? 0.004 : 0);
    g.box({
      size: [W - 2 * inset, y1 - y0, D - 2 * inset],
      at: [0, (y0 + y1) / 2, 0],
      ...wood(shade(panelC, 1 + rng.jitter(0.07)), 0.05),
    });
  }
  // corner posts (outermost layer)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.box({ size: [w, Hc, w], at: [sx * (W / 2 - w / 2), Hc / 2, sz * (D / 2 - w / 2)], ...wood(frameC, 0.06) });
  // per face: top/bottom rails (3 mm behind the posts) and a diagonal brace (6 mm behind)
  const faces = [
    { yaw: 0, half: D / 2, width: W },
    { yaw: 90, half: W / 2, width: D },
    { yaw: 180, half: D / 2, width: W },
    { yaw: -90, half: W / 2, width: D },
  ];
  faces.forEach((f, i) => {
    g.group({ rot: [0, f.yaw, 0] }, (b) => {
      const rl = f.width - 2 * w + 0.01;
      for (const y of [w / 2, Hc - w / 2]) b.box({ size: [rl, w, t], at: [0, y, f.half - 0.003 - t / 2], ...wood(frameC, 0.06) });
      const x0 = -(f.width / 2 - w),
        x1 = f.width / 2 - w,
        y0 = w - 0.004,
        y1 = Hc - w + 0.004;
      const bw = (w * 0.92) / Math.sin(Math.atan2(y1 - y0, x1 - x0));
      let shape: Vec2[] = [
        [x0, y0],
        [x0 + bw, y0],
        [x1, y1],
        [x1 - bw, y1],
      ];
      if (i % 2) shape = shape.map(([x, y]) => [-x, y] as Vec2);
      b.extrude(shape, { depth: t, at: [0, 0, f.half - 0.006 - t], ...wood(frameC, 0.06) });
      if (o.xBrace && i % 2 === 0)
        b.extrude(
          shape.map(([x, y]) => [-x, y] as Vec2),
          { depth: t, at: [0, 0, f.half - 0.01 - t], ...wood(shade(frameC, 0.9), 0.06) },
        );
    });
  });
  // lid planks
  const gap = 0.007;
  const pw = (D - gap * (o.lidPlanks - 1)) / o.lidPlanks;
  for (let k = 0; k < o.lidPlanks; k++)
    g.plank({
      size: [W + 0.006, t, pw],
      at: [0, Hc + t / 2, -D / 2 + pw / 2 + k * (pw + gap)],
      jitter: 0.04,
      ...wood(shade(frameC, 1.02 + rng.jitter(0.07)), 0.05),
    });
  // raised rim around the lid (front/back full width, sides between)
  const yr = Hc + t + tr / 2;
  for (const s of [-1, 1]) {
    g.box({ size: [W, tr, w], at: [0, yr, s * (D / 2 - w / 2)], ...wood(shade(frameC, 1.04), 0.06) });
    g.box({ size: [w, tr, D - 2 * w], at: [s * (W / 2 - w / 2), yr, 0], ...wood(shade(frameC, 1.04), 0.06) });
  }
  const off = settle(m, g);
  m.anchor("top", add3([0, H, 0], off));
  m.collider = { type: "box", center: [0, H / 2, 0], size: [W, H, D] };
  m.meta = { topHeight: H, footprint: [W, D], stackable: true };
  return m;
}

function pallet(): Model {
  const name = "tl_furn_pallet_v01";
  const m = new Model(name, {
    budget: 400,
    notes:
      "Wooden pallet 1.2 x 0.144 x 1.0 m (EUR style: 5 deck boards along X, 3 stringer boards, 9 blocks, " +
      "3 bottom boards). Bed base for a mattress in the rest corner (two pallets side by side = 2.0 m bed).",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const L = 1.2,
    D = 1.0,
    tb = 0.022,
    bh = 0.078;
  const pale = mix(mix(WOOD_TOP, P.cardboard, 0.4), P.woodGrey, 0.15);
  for (const z of [-0.45, 0, 0.45]) g.box({ size: [L, tb, 0.1], at: [0, tb / 2, z], ...wood(shade(pale, 0.86), 0.06) });
  for (const x of [-0.55, 0, 0.55])
    for (const z of [-0.45, 0, 0.45])
      g.box({ size: [x === 0 ? 0.145 : 0.1, bh, 0.1], at: [x, tb + bh / 2 - 0.001, z], ...wood(WOOD, 0.07) });
  for (const x of [-0.55, 0, 0.55]) g.box({ size: [0.1, tb, D], at: [x, tb + bh + tb / 2, 0], ...wood(shade(pale, 0.9), 0.06) });
  const deck: [number, number][] = [
    [-0.4275, 0.145],
    [-0.214, 0.1],
    [0, 0.145],
    [0.214, 0.1],
    [0.4275, 0.145],
  ];
  for (const [z, w] of deck)
    g.plank({ size: [L, tb, w], at: [0, 2 * tb + bh + tb / 2, z], jitter: 0.04, ...wood(pale, 0.07) });
  const off = settle(m, g);
  const top = rn(3 * tb + bh);
  m.anchor("top", add3([0, top, 0], off));
  m.collider = { type: "box", center: [0, top / 2, 0], size: [L, top, D] };
  m.meta = { topHeight: top, footprint: [L, D] };
  return m;
}

/* =========================================================================================
 * Paper, photos and silhouettes (memory board)
 * ========================================================================================= */

/** Simple dark silhouette of a person (torso trapezoid + hexagon head + optional raised arms). */
function figure(b: MeshBuilder, rng: Rng, cx: number, base: number, s: number, z: number, color: Color, arms: number): void {
  const sw = s * 0.62,
    bh = s * 0.5,
    hr = s * 0.17;
  decal(
    b,
    [
      [cx - sw / 2, base],
      [cx + sw / 2, base],
      [cx + sw * 0.36, base + bh],
      [cx - sw * 0.36, base + bh],
    ],
    z,
    color,
  );
  decal(b, shape2d.circle(hr, 6, cx, base + bh + hr * 0.92, 90), z, color);
  const first = rng.sign();
  for (let k = 0; k < arms; k++) {
    const side = k === 0 ? first : -first;
    const sx = cx + side * sw * 0.3,
      sy = base + bh * 0.8;
    const ex = cx + side * (sw * 0.5 + rng.range(0, s * 0.1)),
      ey = base + bh + hr * 2.5 + rng.jitter(s * 0.05);
    decal(
      b,
      shape2d.stroke(
        [
          [sx, sy],
          [ex, ey],
        ],
        s * 0.1,
      ),
      z,
      color,
    );
  }
}

interface PaperSpec {
  at: Vec3;
  w: number;
  h: number;
  rot: number;
  color: Color;
  torn?: number; // corner index (0 bl, 1 br, 2 tr, 3 tl) torn off
  pin?: Color;
  tape?: boolean;
  /** Uniform scale of the whole sheet and its content (default 1). */
  scale?: number;
}

/** A sheet of paper (flat decal) with an optional torn corner, pin or tape; `content` draws on it. */
function paper(b: MeshBuilder, rng: Rng, o: PaperSpec, content?: (b: MeshBuilder, z: number) => void): void {
  b.group({ at: o.at, rot: [0, 0, o.rot], scale: o.scale ?? 1 }, (gb) => {
    const hw = o.w / 2,
      hh = o.h / 2;
    const corners: Vec2[] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    const pts: Vec2[] = [];
    corners.forEach((c, i) => {
      if (i === o.torn) {
        const prev = corners[(i + 3) % 4],
          next = corners[(i + 1) % 4];
        const ta = 0.16 + rng.next() * 0.12,
          tb = 0.18 + rng.next() * 0.12;
        const a: Vec2 = [lerp(c[0], prev[0], ta), lerp(c[1], prev[1], ta)];
        const d: Vec2 = [lerp(c[0], next[0], tb), lerp(c[1], next[1], tb)];
        const mid: Vec2 = [lerp((a[0] + d[0]) / 2, 0, 0.08), lerp((a[1] + d[1]) / 2, 0, 0.08)];
        pts.push(a, [mid[0] + rng.jitter(0.012), mid[1] + rng.jitter(0.012)], d);
      } else pts.push([c[0] + rng.jitter(0.006), c[1] + rng.jitter(0.006)]);
    });
    decal(gb, pts, 0, o.color);
    content?.(gb, 0.0015);
    if (o.pin) decal(gb, shape2d.circle(0.012, 6, rng.jitter(hw * 0.3), hh - 0.03), 0.003, o.pin);
    if (o.tape)
      gb.group({ at: [rng.jitter(hw * 0.3), hh - 0.005, 0.0025], rot: [0, 0, rng.jitter(12)] }, (tb) =>
        decal(tb, shape2d.rect(0.075, 0.03), 0, mix(P.worn, P.paper, 0.4)),
      );
  });
}

/** Wooden picture frame with a dark photo; `content` draws on the photo. */
function photoFrame(
  b: MeshBuilder,
  at: Vec3,
  w: number,
  h: number,
  rot: number,
  frameC: Color,
  photoC: Color,
  content: (b: MeshBuilder, z: number) => void,
  scale = 1,
): void {
  b.group({ at, rot: [0, 0, rot], scale }, (gb) => {
    const fw = 0.045,
      ft = 0.024;
    decal(gb, shape2d.rect(w - fw, h - fw), 0.004, photoC);
    for (const s of [-1, 1]) {
      gb.box({ size: [w, fw, ft], at: [0, s * (h / 2 - fw / 2), ft / 2], ...wood(frameC, 0.05) });
      gb.box({ size: [fw, h - 2 * fw, ft], at: [s * (w / 2 - fw / 2), 0, ft / 2], ...wood(shade(frameC, 0.92), 0.05) });
    }
    content(gb, 0.0055);
  });
}

/* =========================================================================================
 * Memory board (wall of memories)
 * ========================================================================================= */

function memoryBoard(): Model {
  const name = "tl_furn_memory_board_v01";
  const m = new Model(name, {
    budget: 1500,
    notes:
      "Wall of memories (02 main view): ~4.2 x 2.8 m wall of mismatched nailed planks standing on two posts " +
      "with back struts. Old newspapers with crowd silhouettes (no faces), pinned notes, two small photo " +
      "frames, faded red cards. No readable text, no dates. Board front faces +Z.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/layout`);
  const TH = 0.035;
  const tones = [
    WOOD_TOP,
    WOOD,
    mix(WOOD, P.woodGrey, 0.35),
    shade(WOOD_TOP, 0.86),
    mix(WOOD_TOP, P.ochre, 0.4),
    mix(WOOD, P.rust, 0.25),
    mix(PALE_WOOD, WOOD, 0.35),
    shade(WOOD, 0.8),
  ];
  const nailC = mix(P.metalDark, P.rust, 0.35);
  const postX = [-1.45, 1.45];
  for (const x of postX) {
    leg(g, [x, 2.66, -0.046], [x, 0, -0.046], [0.11, 0.09], wood(WOOD_DARK, 0.05), 0);
    leg(g, [x, 1.72, -0.12], [x + rng.jitter(0.03), 0, -0.8], [0.07, 0.07], wood(shade(WOOD_DARK, 0.92), 0.05), 0);
  }
  // two short plank "feet" under the lowest boards, as in the concept
  for (const x of [-0.62, 0.78]) leg(g, [x, 0.62, -0.012], [x + rng.jitter(0.02), 0, -0.012], [0.16, 0.024], wood(WOOD, 0.05), 0);

  // plank rows (bottom to top), alternating depth layers so overlaps never share a plane
  const rows = 10,
    yLo = 0.34,
    yHi = 2.64;
  const pitch = (yHi - yLo) / rows;
  const planks: { x: number; y: number; len: number; h: number; rot: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const yc = yLo + pitch * (r + 0.5) + rng.jitter(0.012);
    let left = -2.06 + rng.jitter(0.1),
      right = 2.06 + rng.jitter(0.1);
    if (r === 0) {
      left += 0.55;
      right -= 0.4;
    }
    if (r === rows - 1) {
      left += 0.15;
      right -= 0.75;
    }
    const segs: [number, number][] = [];
    if (r !== 0 && rng.chance(0.75)) {
      const split = rng.range(-1.3, 1.3);
      segs.push([left, split + 0.06], [split - 0.06, right]);
    } else segs.push([left, right]);
    segs.forEach(([x0, x1], k) =>
      planks.push({
        x: (x0 + x1) / 2,
        y: yc + rng.jitter(0.01),
        len: x1 - x0,
        h: pitch + 0.026 + rng.jitter(0.02),
        rot: rng.jitter(2.2),
        z: (r % 2) * 0.012 + k * 0.006,
      }),
    );
  }
  for (const p of planks)
    g.plank({ size: [p.len, TH, p.h], rot: [90, 0, p.rot], at: [p.x, p.y, p.z + TH / 2], jitter: 0.18, ...wood(rng.pick(tones), 0.05) });
  // a small scrap board nailed on top
  const scrap = { x: 0.08, y: 2.72, len: 0.36, h: 0.27, rot: 8, z: 0.024 };
  g.plank({ size: [scrap.len, TH, scrap.h], rot: [90, 0, scrap.rot], at: [scrap.x, scrap.y, scrap.z + TH / 2], jitter: 0.2, ...wood(WOOD, 0.05) });

  // square nail heads: near both ends of every plank and where it crosses a post
  const nail = (x: number, y: number, z: number) =>
    g.extrude(shape2d.rect(0.02, 0.02), { depth: 0, at: [x, y, z], rot: [0, 0, rng.range(0, 90)], color: nailC });
  for (const p of [...planks, scrap]) {
    const pts: Vec2[] = [];
    for (const e of [-1, 1]) {
      const lx = e * (p.len / 2 - 0.07);
      if (rng.chance(0.45)) pts.push([lx, p.h * 0.22], [lx, -p.h * 0.22]);
      else pts.push([lx, rng.jitter(p.h * 0.15)]);
    }
    for (const px of postX) {
      const lx = px - p.x;
      if (Math.abs(lx) < p.len / 2 - 0.2) pts.push([lx, rng.jitter(0.03)]);
    }
    for (const q of pts) {
      const [dx, dy] = rot2(q, p.rot);
      nail(p.x + dx, p.y + dy, p.z + TH + 0.002);
    }
  }

  // papers, photos, cards — each on its own depth layer
  const ink = mix(P.paper, P.shadow, 0.62);
  const lines = mix(P.paper, P.shadow, 0.36);
  // depth layers just in front of the frontmost planks (front faces up to z = 0.053, nails at +2 mm):
  // newspapers and frames never overlap each other (L0); notes sit one layer above (L1)
  const L0 = 0.057,
    L1 = 0.0605;
  const memories: Record<string, Vec3> = {};

  // A: big newspaper — headline block + cheering crowd
  const newsA: PaperSpec = { at: [-1.02, 1.9, L0], w: 0.9, h: 0.74, rot: 2.5, color: mix(P.paper, P.cardboard, 0.15), torn: 1, tape: true, scale: 1.17 };
  paper(g, rng, newsA, (b, z) => {
    decal(b, rect(-0.39, 0.235, 0.28, 0.31), z, ink);
    decal(b, rect(-0.39, 0.19, 0.06, 0.212), z, lines);
    decal(b, rect(-0.39, -0.345, 0.39, 0.15), z - 0.0005, mix(P.paper, P.shadow, 0.16));
    for (let i = 0; i < 5; i++) figure(b, rng, -0.31 + i * 0.155, -0.345, 0.3 * (1 + rng.jitter(0.1)), z, ink, i % 2 === 0 ? 2 : 1);
  });
  memories.mem_news_a = newsA.at;
  // B: smaller newspaper — row of fans, some arms raised, three text lines
  const newsB: PaperSpec = { at: [-0.22, 1.08, L0], w: 0.62, h: 0.53, rot: -3.5, color: P.paper, torn: 3, pin: P.crimson, scale: 1.15 };
  paper(g, rng, newsB, (b, z) => {
    for (let k = 0; k < 3; k++) decal(b, rect(-0.27, 0.19 - k * 0.04, 0.27 - k * 0.07, 0.205 - k * 0.04), z, lines);
    decal(b, rect(-0.27, -0.235, 0.27, 0.07), z - 0.0005, mix(P.paper, P.shadow, 0.14));
    for (let i = 0; i < 6; i++) figure(b, rng, -0.225 + i * 0.09, -0.235, 0.2 * (1 + rng.jitter(0.12)), z, ink, rng.chance(0.6) ? 2 : 0);
  });
  memories.mem_news_b = newsB.at;
  // C: team-photo style newspaper — three figures behind a desk
  const newsC: PaperSpec = { at: [0.72, 1.6, L0], w: 0.74, h: 0.6, rot: 1.5, color: mix(P.paper, P.worn, 0.35), torn: 2, tape: true, scale: 1.14 };
  paper(g, rng, newsC, (b, z) => {
    decal(b, rect(-0.32, -0.2, 0.32, 0.22), z - 0.0005, mix(P.paper, P.shadow, 0.15));
    for (let i = 0; i < 3; i++) figure(b, rng, -0.2 + i * 0.2, -0.14, 0.36, z, ink, 0);
    decal(b, rect(-0.32, -0.2, 0.32, -0.12), z + 0.0005, mix(P.paper, P.shadow, 0.5));
    decal(b, rect(-0.32, -0.262, 0.12, -0.245), z, lines);
  });
  memories.mem_news_c = newsC.at;
  // photo frames
  const photoC = mix(P.shadow, P.paper, 0.38);
  const photoInk = mix(P.shadow, P.paper, 0.1);
  const frameA: Vec3 = [1.56, 2.06, L0];
  photoFrame(
    g,
    frameA,
    0.6,
    0.46,
    -6,
    mix(WOOD_TOP, P.ochre, 0.3),
    photoC,
    (b, z) => {
      for (let i = 0; i < 4; i++) figure(b, rng, -0.18 + i * 0.12, -0.185, 0.24, z, photoInk, i === 1 || i === 2 ? 2 : 1);
    },
    1.12,
  );
  memories.mem_photo_a = frameA;
  const frameB: Vec3 = [-1.74, 1.0, L0];
  photoFrame(g, frameB, 0.3, 0.36, 4, WOOD_DARK, mix(P.shadow, P.paper, 0.45), (b, z) => {
    figure(b, rng, 0, -0.135, 0.34, z, photoInk, 0);
  });
  memories.mem_photo_b = frameB;
  // small notes and cards
  const notes: PaperSpec[] = [
    { at: [0.06, 2.33, 0], w: 0.25, h: 0.2, rot: 9, color: mix(P.paper, P.worn, 0.5), pin: nailC },
    { at: [-0.4, 1.62, 0], w: 0.16, h: 0.22, rot: -6, color: P.paper, torn: 0, tape: true },
    { at: [1.42, 1.28, 0], w: 0.2, h: 0.26, rot: 3, color: mix(P.paper, P.cardboard, 0.3), pin: P.crimson },
    { at: [-1.22, 0.92, 0], w: 0.15, h: 0.2, rot: -4, color: P.paper, pin: nailC },
    { at: [0.36, 0.86, 0], w: 0.22, h: 0.17, rot: 5, color: mix(P.paper, P.worn, 0.3), tape: true },
    { at: [1.78, 0.72, 0], w: 0.18, h: 0.22, rot: -3, color: P.crimsonFaded, pin: nailC },
    { at: [-1.62, 1.55, 0], w: 0.16, h: 0.21, rot: 6, color: mix(P.crimsonFaded, P.crimson, 0.3), tape: true },
    { at: [0.98, 2.33, 0], w: 0.17, h: 0.14, rot: -8, color: P.cardboard, pin: nailC },
  ];
  notes.forEach((n, i) => {
    n.at = [n.at[0], n.at[1], L1];
    const scribbles = n.color === P.paper || i % 3 === 0 ? 3 : 0;
    paper(g, rng, n, (b, z) => {
      for (let k = 0; k < scribbles; k++) {
        const y = n.h / 2 - 0.06 - k * 0.035;
        if (y < -n.h / 2 + 0.03) break;
        decal(b, rect(-n.w / 2 + 0.025, y, n.w / 2 - 0.03 - rng.range(0, n.w * 0.3), y + 0.011), z, lines);
      }
    });
  });

  const off = settle(m, g);
  for (const [k, v] of Object.entries(memories)) m.anchor(k, add3([v[0], v[1], L1 + 0.01], off));
  m.anchor("center", add3([0, 1.55, L1 + 0.01], off));
  const bb = m.geo.bounds()!;
  m.collider = boundsCollider(m);
  m.meta = {
    frontZ: r4(add3([0, 0, 0.055], off))[2],
    footprint: [r4(sub3(bb.max, bb.min))[0], r4(sub3(bb.max, bb.min))[2]],
    note: "Board front plane is at meta.frontZ (struts reach back). anchors mem_* = centres of the memory items for DOM prompts.",
  };
  return m;
}

/* =========================================================================================
 * Quiz board (chalkboard on an easel)
 * ========================================================================================= */

function quizBoard(): Model {
  const name = "tl_furn_quiz_board_v01";
  const m = new Model(name, {
    budget: 600,
    notes:
      "Quiz corner chalkboard on a wooden easel (02 QUIZ CORNER): 2.2 m wide, 1.65 m tall, writing surface " +
      "2.06 x 0.95 m. Flat chalk drawing: big '?' with rays, 3 + 2 check boxes with answer lines, chalk tray.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const W = 2.2,
    yB = 0.52,
    yT = 1.62;
  const fw = 0.075,
    ft = 0.04;
  const zp = 0; // posts centre plane
  const zb0 = 0.0375; // back of the board assembly (front of the posts)
  const frameC = mix(WOOD_TOP, P.ochre, 0.2);
  // front posts (legs), rear legs (A-frame), stays and a low cross bar
  const postC = WOOD;
  for (const s of [-1, 1]) {
    leg(g, [s * 1.04, 1.69, zp], [s * (1.06 + rng.jitter(0.01)), 0, zp + 0.02], 0.07, wood(postC, 0.05), 0);
    const rt: Vec3 = [s * 0.96, 1.42, -0.04],
      rb: Vec3 = [s * 1.0, 0, -0.62];
    leg(g, rt, rb, 0.06, wood(shade(postC, 0.9), 0.05), 0);
    bar(g, [s * 1.04, 0.62, zp], atY(rt, rb, 0.62), 0.04, wood(WOOD_DARK, 0.05));
  }
  bar(g, [-1.05, 0.26, zp - 0.04], [1.05, 0.26, zp - 0.04], 0.05, wood(WOOD_DARK, 0.05));
  // board slab and frame
  const zs = zb0 + 0.01;
  g.box({ size: [W - 0.1, yT - yB - 0.1, 0.02], at: [0, (yB + yT) / 2, zs], color: P.chalkboard, vary: 0.03 });
  g.plank({ size: [W, ft, fw], rot: [90, 0, 0.6], at: [0, yT - fw / 2, zb0 + ft / 2], jitter: 0.06, ...wood(frameC, 0.05) });
  g.plank({ size: [W, ft, fw], rot: [90, 0, -0.3], at: [0, yB + fw / 2, zb0 + ft / 2], jitter: 0.06, ...wood(frameC, 0.05) });
  for (const s of [-1, 1])
    g.box({ size: [fw, yT - yB - 2 * fw, ft], at: [s * (W / 2 - fw / 2), (yB + yT) / 2, zb0 + ft / 2], ...wood(shade(frameC, 0.93), 0.05) });
  // chalk tray with a chalk stick and an eraser
  const trayY = yB - 0.017;
  g.box({ size: [W + 0.16, 0.034, 0.12], at: [0, trayY, zb0 + 0.06], ...wood(shade(frameC, 0.96), 0.05) });
  g.box({ size: [0.09, 0.016, 0.016], at: [0.62, trayY + 0.025, zb0 + 0.08], rot: [0, 14, 0], color: P.chalk });
  g.box({ size: [0.15, 0.04, 0.06], at: [-0.7, trayY + 0.037, zb0 + 0.07], rot: [0, -8, 0], color: WOOD_DARK, parts: { bottom: P.charcoal } });

  // chalk drawing on the writing surface
  const zc = zs + 0.01 + 0.0015;
  const chalk = mix(P.chalk, P.chalkboard, 0.1);
  const cy = (yB + yT) / 2;
  // faint smudges first (just above the board)
  decal(g, shape2d.circle(0.26, 7, -0.32, cy - 0.27).map(([x, y]) => [x * 1.6 + 0.19, y * 0.55 + (cy - 0.27) * 0.45] as Vec2), zc - 0.0008, mix(P.chalkboard, P.chalk, 0.05));
  decal(g, shape2d.circle(0.2, 7, 0.62, cy + 0.3).map(([x, y]) => [x * 1.5 - 0.31, y * 0.5 + (cy + 0.3) * 0.5] as Vec2), zc - 0.0008, mix(P.chalkboard, P.chalk, 0.045));
  // big question mark: hook arc + stem + dot
  const qx = 0,
    qy = cy + 0.06;
  const hook: Vec2[] = [];
  for (let a = 165; a >= -50; a -= 27) hook.push([qx + Math.cos(a * DEG) * 0.1, qy + 0.075 + Math.sin(a * DEG) * 0.1]);
  hook.push([qx + 0.006, qy - 0.03], [qx + 0.004, qy - 0.085]);
  decal(g, shape2d.stroke(hook, 0.036), zc, chalk);
  decal(g, shape2d.circle(0.024, 6, qx + 0.004, qy - 0.15), zc, chalk);
  // rays around it
  for (const a of [5, 45, 90, 135, 175, 215, 325]) {
    const d: Vec2 = [Math.cos(a * DEG), Math.sin(a * DEG)];
    decal(g, shape2d.stroke([[qx + d[0] * 0.22, qy + d[1] * 0.2], [qx + d[0] * 0.29, qy + d[1] * 0.26]], 0.014), zc, chalk);
  }
  // check boxes with answer lines (3 left, 2 right)
  const box = (x: number, y: number) => {
    const s = 0.075,
      lw = 0.012;
    decal(g, rect(x - s / 2, y - s / 2, x + s / 2, y - s / 2 + lw), zc, chalk);
    decal(g, rect(x - s / 2, y + s / 2 - lw, x + s / 2, y + s / 2), zc, chalk);
    decal(g, rect(x - s / 2, y - s / 2 + lw, x - s / 2 + lw, y + s / 2 - lw), zc, chalk);
    decal(g, rect(x + s / 2 - lw, y - s / 2 + lw, x + s / 2, y + s / 2 - lw), zc, chalk);
  };
  for (const [x, y, len] of [
    [-0.8, cy + 0.24, 0.3],
    [-0.8, cy + 0.03, 0.26],
    [-0.8, cy - 0.18, 0.3],
    [0.42, cy + 0.2, 0.34],
    [0.42, cy - 0.01, 0.3],
  ] as const) {
    box(x, y);
    decal(g, rect(x + 0.08, y - 0.007 + rng.jitter(0.004), x + 0.08 + len, y + 0.007), zc, chalk);
  }
  const off = settle(m, g);
  m.anchor("board_center", add3([0, cy, zc], off));
  m.collider = boundsCollider(m);
  m.meta = {
    board: { center: r4(add3([0, cy, zs + 0.01], off)), size: [rn(W - 2 * fw), rn(yT - yB - 2 * fw)], normal: [0, 0, 1] },
    note: "meta.board = writable chalk area (model space) for runtime quiz overlays.",
  };
  return m;
}

/* =========================================================================================
 * Entrance sign
 * ========================================================================================= */

interface SignBoard {
  /** Top-edge rope attach points (local space before settle). */
  attach: [Vec3, Vec3];
  emblemCenter: Vec3;
  frontZ: number;
}

/** Three crooked pale planks with the red emblem raised on top, two back battens. */
function signBoard(g: MeshBuilder, rng: Rng, y0: number): SignBoard {
  const T = 0.035;
  const planks = [
    { x: -0.02, y: y0 + 0.5, len: 1.62, h: 0.2, rot: 2.4, z: 0.0, c: PALE_WOOD },
    { x: 0.05, y: y0 + 0.3, len: 1.54, h: 0.215, rot: -1.7, z: 0.009, c: shade(PALE_WOOD, 0.93) },
    { x: -0.01, y: y0 + 0.105, len: 1.6, h: 0.19, rot: 1.1, z: 0.0045, c: mix(PALE_WOOD, P.woodGrey, 0.22) },
  ];
  for (const s of [-1, 1]) g.box({ size: [0.075, 0.6, 0.025], at: [s * 0.5, y0 + 0.31, -0.0125], ...wood(P.woodGrey, 0.05) });
  for (const p of planks)
    g.plank({ size: [p.len, T, p.h], rot: [90, 0, p.rot], at: [p.x, p.y, p.z + T / 2], jitter: 0.32, ...wood(p.c, 0.05) });
  const frontZ = 0.009 + T;
  // a few dark knots / weathering marks and nails into the battens
  const nailC = mix(P.metalDark, P.rust, 0.4);
  for (const p of planks)
    for (const s of [-1, 1]) {
      const [dx, dy] = rot2([s * 0.5 - p.x, rng.jitter(0.03)], p.rot);
      g.extrude(shape2d.rect(0.018, 0.018), { depth: 0, at: [p.x + dx, p.y + dy, p.z + T + 0.002], rot: [0, 0, rng.range(0, 90)], color: nailC });
    }
  const knotC = shade(PALE_WOOD, 0.62);
  for (const [x, y] of [
    [-0.66, y0 + 0.48],
    [0.58, y0 + 0.12],
  ] as const)
    g.extrude(shape2d.circle(0.022, 6, 0, 0, 30).map(([a, b]) => [a * 1.8, b] as Vec2), { depth: 0, at: [x, y, frontZ + 0.002], color: knotC });
  // the red emblem (only allowed symbol), raised 5 mm
  const emblemCenter: Vec3 = [0.03, y0 + 0.31, frontZ + 0.002];
  g.emblem({ height: 0.44, depth: 0.005, at: emblemCenter, rot: [0, 0, 1.5], color: P.crimson, parts: { side: shade(P.crimson, 0.72) } });
  const top = planks[0];
  const attach = [-1, 1].map((s) => {
    const [dx, dy] = rot2([s * 0.52, top.h / 2 - 0.01], top.rot);
    return [top.x + dx, top.y + dy, top.z + T / 2] as Vec3;
  }) as [Vec3, Vec3];
  return { attach, emblemCenter: [emblemCenter[0], emblemCenter[1], emblemCenter[2] + 0.005], frontZ };
}

function entranceSign(): Model {
  const name = "tl_sign_entrance_v01";
  const m = new Model(name, {
    budget: 500,
    notes:
      "Cave-exit sign (01/02/04): three crooked weathered planks ~1.6 x 0.6 m with the raised red emblem, hanging " +
      "from two short ropes. Anchors hang_l / hang_r = top rope points (hang height); small iron spikes there go " +
      "back (-Z) into the rock/beam. Pivot = bottom centre of the boards.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const sb = signBoard(g, rng, 0);
  const hangY = 0.93;
  const hang: Vec3[] = [];
  sb.attach.forEach((a, i) => {
    const s = i === 0 ? -1 : 1;
    const h: Vec3 = [s * 0.46, hangY, 0.0];
    hang.push(h);
    const mid = add3(lerp3(a, h, 0.5), [s * 0.012, 0, 0.01]);
    g.tube([a, mid, h], { radius: 0.011, sides: 4, color: ROPE, vary: 0.05 });
    g.box({ size: [0.045, 0.04, 0.05], at: a, rot: [rng.jitter(20), 45 + rng.jitter(10), rng.jitter(20)], color: shade(ROPE, 0.9) });
    // iron spike the rope hangs from
    g.box({ size: [0.024, 0.024, 0.09], at: [h[0], h[1] + 0.006, h[2] - 0.035], color: P.metalDark, parts: { front: P.metal } });
  });
  const off = settle(m, g);
  m.anchor("hang_l", add3(hang[0], off));
  m.anchor("hang_r", add3(hang[1], off));
  m.anchor("emblem_center", add3(sb.emblemCenter, off));
  m.meta = {
    hangPoints: [r4(add3(hang[0], off)), r4(add3(hang[1], off))],
    note: "Place so hang_l/hang_r touch the beam or rock above the tunnel; the boards hang ~0.33 m below them.",
  };
  return m;
}

function entranceSignStanding(): Model {
  const name = "tl_sign_entrance_standing_v01";
  const m = new Model(name, {
    budget: 600,
    notes:
      "Free-standing version of the entrance sign (04 catalog ENTRANCE SIGN): same crooked planks + red emblem on " +
      "two splayed legs. Board centre ~1.2 m above the floor; total height ~1.55 m.",
  });
  const g = new MeshBuilder(`${name}/geo`);
  const rng = new Rng(`${name}/shape`);
  const y0 = 0.9;
  const sb = signBoard(g, rng, y0);
  for (const s of [-1, 1])
    leg(g, [s * 0.47, y0 + 0.6, -0.055], [s * (0.64 + rng.jitter(0.02)), 0, -0.07], [0.08, 0.065], wood(WOOD, 0.05), 0);
  const off = settle(m, g);
  m.anchor("emblem_center", add3(sb.emblemCenter, off));
  m.collider = boundsCollider(m);
  return m;
}

/* =========================================================================================
 * Tarp shelter (rest corner)
 * ========================================================================================= */

function tarpShelter(): Model {
  const name = "tl_furn_tarp_shelter_v01";
  const m = new Model(name, {
    budget: 1500,
    notes:
      "Rest-corner tarp shelter (01/03 rest corner), hypar pitch: two tall poles hold the high front-right (+X) " +
      "and back-left corners (~3.1 m; the front pole is braced by a crossing strut), a short T-pole holds the low " +
      "front-left corner (2.35 m) and the back-right corner is staked out by a rope (2.45 m), so the front edge " +
      "rises toward the tall pole as in the concept and the faded-crimson underside faces the hub. Double-sided " +
      "cloth with stitched worn-white patches, holes and irregular hanging tatters on every edge. Covers ~3.2 x 3 m. " +
      "Guy ropes to ground stakes. Only the poles should collide (meta.poleColliders).",
  });
  const b = m.geo;
  const rng = new Rng(`${name}/shape`);
  const xL = -1.6,
    xR = 1.6,
    zB = -1.45,
    zF = 1.5;
  const hBL = 3.1,
    hBR = 2.45,
    hFL = 2.35,
    hFR = 3.1;
  const sn = (t: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  /** Roof height: hypar (bilinear) between the four tie points, catenary sag along every free edge, and
   * tension folds radiating from the high front-right corner. */
  const roof = (x: number, z: number) => {
    const u = (x - xL) / (xR - xL),
      v = (z - zB) / (zF - zB);
    const base = lerp(lerp(hBL, hBR, u), lerp(hFL, hFR, u), v);
    const sag = 0.12 * sn(u) + 0.12 * sn(v) + 0.06 * sn(u) * sn(v);
    const d = Math.hypot(x - xR, z - zF);
    const folds = 0.045 * Math.sin(Math.atan2(z - zF, x - xR) * 11) * Math.min(1, d / 1.1) * Math.max(0, 1 - d / 4.4);
    return base - sag + folds * sn(u) * sn(v);
  };
  const nRx = 11,
    nRz = 10;
  const V: Vec3[][] = [];
  for (let i = 0; i <= nRx; i++) {
    V.push([]);
    for (let j = 0; j <= nRz; j++) {
      const x = lerp(xL, xR, i / nRx),
        z = lerp(zB, zF, j / nRz);
      const pinned = (i === 0 || i === nRx) && (j === 0 || j === nRz);
      const jit = (a: number) => (pinned ? 0 : rng.jitter(a));
      V[i].push([x + jit(0.02), roof(x, z) + jit(0.024), z + jit(0.02)]);
    }
  }
  // colours: dusty brick / faded crimson (concept 01 tarp samples ~#8A3C27 in the dim corner), a less
  // faded crimson panel, sun-faded and damp zones, pinkish worn-white patches
  const base = shade(mix(P.tarp, P.rust, 0.35), 0.84);
  const zones = [
    { x: -0.6, z: -0.5, r: 0.95, c: mix(base, P.crimsonFaded, 0.55) },
    { x: 0.75, z: 0.35, r: 0.7, c: mix(base, P.worn, 0.13) },
    { x: -1.1, z: 1.0, r: 0.65, c: shade(base, 0.84) },
    { x: 0.95, z: -1.0, r: 0.62, c: shade(mix(base, P.crimson, 0.55), 0.92) },
  ];
  const wornTarp = mix(P.worn, P.crimsonFaded, 0.12);
  const patches = [
    { i0: 8, i1: 10, j0: 7, j1: 10, c: wornTarp }, // front-right patch, continues down the front tatters
    { i0: 2, i1: 4, j0: 3, j1: 5, c: mix(wornTarp, P.wornDark, 0.45) },
    { i0: 6, i1: 7, j0: 1, j1: 2, c: mix(wornTarp, P.paper, 0.35) },
  ];
  const patchOf = (i: number, j: number) => patches.find((p) => i >= p.i0 && i < p.i1 && j >= p.j0 && j < p.j1);
  const cellC: Color[][] = [];
  for (let i = 0; i < nRx; i++) {
    cellC.push([]);
    for (let j = 0; j < nRz; j++) {
      const p = patchOf(i, j);
      let c: Color = p ? p.c : base;
      if (!p) {
        const ctr = lerp3(V[i][j], V[i + 1][j + 1], 0.5);
        for (const zn of zones) if (Math.hypot(ctr[0] - zn.x, ctr[2] - zn.z) < zn.r) c = zn.c;
      }
      cellC[i].push(shade(c, 1 + rng.jitter(p ? 0.025 : 0.045)));
    }
  }
  // holes: one full cell, two torn half cells
  const removed = new Set(["5,5"]);
  const half = new Map<string, number>([
    ["3,7", 1],
    ["8,3", 0],
  ]);
  let clothMinY = Infinity;
  const cloth = (pts: Vec3[], out: Vec3, color: Color) => {
    for (const p of pts) clothMinY = Math.min(clothMinY, p[1]);
    const n = cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0]));
    const q = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? pts.slice().reverse() : pts;
    if (q.length === 3) b.tri(q[0], q[1], q[2], { mat: "cloth", color });
    else if (q.length === 4) b.quad(q[0], q[1], q[2], q[3], { mat: "cloth", color });
    else b.poly(q, { mat: "cloth", color });
  };
  for (let i = 0; i < nRx; i++)
    for (let j = 0; j < nRz; j++) {
      const k = `${i},${j}`;
      if (removed.has(k)) continue;
      const a = V[i][j],
        bb = V[i + 1][j],
        c = V[i + 1][j + 1],
        d = V[i][j + 1];
      const tris: Vec3[][] = (i + j) % 2 ? [[a, d, bb], [bb, d, c]] : [[a, d, c], [a, c, bb]];
      const keep = half.get(k);
      for (const t of keep === undefined ? tris : [tris[keep]]) cloth(t, [0, 1, 0], cellC[i][j]);
    }
  /**
   * Ragged edge: a narrow continuous band hanging from `edge`, then strips of random length (one or two
   * ~0.15 m segments wide) with torn, slanted or pointed ends.
   */
  const fringe = (
    edge: Vec3[],
    colors: Color[],
    out: Vec3,
    o: { band: number; len: number; gap: number; flare: number; offset?: number },
  ) => {
    const pts: Vec3[] = [];
    const cols: Color[] = [];
    for (let k = 0; k < edge.length - 1; k++) {
      pts.push(edge[k], lerp3(edge[k], edge[k + 1], 0.5));
      cols.push(colors[k], colors[k]);
    }
    pts.push(edge[edge.length - 1]);
    /** Hang a point down by dd (and outward by the flare); `fromEdge` adds the over-the-pole offset. */
    const drop = (p: Vec3, dd: number, fromEdge = false): Vec3 => {
      const h = (fromEdge ? (o.offset ?? 0) * Math.min(1, dd / 0.045) : 0) + dd * o.flare;
      return [p[0] + out[0] * h, p[1] - dd, p[2] + out[2] * h];
    };
    const bandD = pts.map(() => o.band * (0.7 + rng.next() * 0.6));
    const bottom = pts.map((p, k) => drop(p, bandD[k], true));
    // over a pole: first wrap out around it (short row at full offset), then hang
    const wrap = o.offset ? pts.map((p) => drop(p, 0.045, true)) : null;
    for (let k = 0; k < pts.length - 1; ) {
      const span = Math.min(pts.length - 1 - k, rng.chance(0.4) ? 2 : 1);
      const col = shade(cols[k], 1 + rng.jitter(0.03));
      for (let s = k; s < k + span; s++)
        if (wrap) {
          cloth([pts[s], wrap[s], wrap[s + 1], pts[s + 1]], out, col);
          cloth([wrap[s], bottom[s], bottom[s + 1], wrap[s + 1]], out, col);
        } else cloth([pts[s], bottom[s], bottom[s + 1], pts[s + 1]], out, col);
      if (!rng.chance(o.gap)) {
        const L = o.len * (0.3 + rng.next() * 0.7);
        const sa = lerp3(bottom[k], bottom[k + 1], 0.06 + rng.next() * 0.08),
          sc = lerp3(bottom[k + span - 1], bottom[k + span], 0.94 - rng.next() * 0.08);
        const la = drop(sa, L * (0.55 + rng.next() * 0.5)),
          lc = drop(sc, L * (0.55 + rng.next() * 0.5));
        if (span === 2) {
          // two quads sharing the middle band vertex (keeps the strip attached along the band)
          const mid = bottom[k + 1];
          const lm = drop(mid, L * (0.8 + rng.next() * 0.5));
          cloth([sa, la, lm, mid], out, col);
          cloth([mid, lm, lc, sc], out, col);
        } else if (rng.chance(0.45)) {
          const tip = drop(lerp3(sa, sc, 0.3 + rng.next() * 0.4), L * (1.05 + rng.next() * 0.35));
          cloth([sa, la, tip, lc, sc], out, col);
        } else cloth([sa, la, lc, sc], out, col);
      }
      k += span;
    }
  };
  const col = (i: number, j: number) => cellC[Math.min(nRx - 1, Math.max(0, i))][Math.min(nRz - 1, Math.max(0, j))];
  fringe(
    V.map((r) => r[0]),
    Array.from({ length: nRx }, (_, i) => col(i, 0)),
    [0, 0, -1],
    { band: 0.08, len: 0.32, gap: 0.35, flare: 0.14 },
  );
  fringe(
    V.map((r) => r[nRz]),
    Array.from({ length: nRx }, (_, i) => col(i, nRz - 1)),
    [0, 0, 1],
    { band: 0.1, len: 0.45, gap: 0.2, flare: 0.14 },
  );
  fringe(
    V[0].slice(),
    Array.from({ length: nRz }, (_, j) => col(0, j)),
    [-1, 0, 0],
    { band: 0.08, len: 0.36, gap: 0.3, flare: 0.16 },
  );
  fringe(
    V[nRx].slice(),
    Array.from({ length: nRz }, (_, j) => col(nRx - 1, j)),
    [1, 0, 0],
    { band: 0.08, len: 0.36, gap: 0.3, flare: 0.16 },
  );
  // stitches around the two big patches (short dark ties across the patch border)
  const stitchC = shade(P.crimsonDark, 0.75);
  const cellN = (i: number, j: number) => norm3(cross3(sub3(V[i][j + 1], V[i][j]), sub3(V[i + 1][j], V[i][j])));
  const stitch = (A: Vec3, B: Vec3, n: Vec3) => {
    const e = norm3(sub3(B, A));
    const perp = norm3(cross3(n, e));
    for (const t of [0.28, 0.72]) {
      const c = add3(lerp3(A, B, t + rng.jitter(0.06)), scl3(n, 0.007));
      const q = (u: number, v: number) => add3(add3(c, scl3(perp, u)), scl3(e, v));
      const tilt = rng.jitter(0.012);
      cloth([q(-0.035, -0.006 + tilt), q(0.035, -0.006 - tilt), q(0.035, 0.006 - tilt), q(-0.035, 0.006 + tilt)], n, stitchC);
    }
  };
  for (const p of patches.slice(0, 2)) {
    for (let i = p.i0; i < p.i1; i++) {
      stitch(V[i][p.j0], V[i + 1][p.j0], cellN(i, p.j0));
      if (p.j1 < nRz) stitch(V[i][p.j1], V[i + 1][p.j1], cellN(i, p.j1 - 1));
    }
    for (let j = p.j0; j < p.j1; j++) {
      stitch(V[p.i0][j], V[p.i0][j + 1], cellN(p.i0, j));
      if (p.i1 < nRx) stitch(V[p.i1][j], V[p.i1][j + 1], cellN(p.i1 - 1, j));
    }
  }

  // poles (crooked, two segments each), stand just outside the tarp corners as in the concept
  const poleC = wood(mix(WOOD, WOOD_DARK, 0.25), 0.06);
  const FR = { b: [1.74, 0, 1.53] as Vec3, t: [1.72, 3.3, 1.52] as Vec3 };
  const BL = { b: [-1.75, 0, -1.48] as Vec3, t: [-1.72, 3.28, -1.47] as Vec3 };
  const FL = { b: [-1.73, 0, 1.53] as Vec3, t: [-1.71, 2.52, 1.5] as Vec3 };
  for (const [p, r] of [
    [FR, 0.058],
    [BL, 0.056],
    [FL, 0.05],
  ] as const) {
    const mid = add3(lerp3(p.b, p.t, 0.55), [rng.jitter(0.025), 0, rng.jitter(0.025)]);
    pole(b, p.b, mid, [r * 1.06, r], poleC, 6, rng.range(0, 60));
    pole(b, mid, p.t, [r, r * 0.9], poleC, 6, rng.range(0, 60));
  }
  // strut crossing the tall front pole near its top (the X-joint of the concept)
  const strutB: Vec3 = [1.84, 0, 0.42],
    strutT: Vec3 = [1.7, 3.32, 1.64];
  pole(b, strutB, strutT, [0.046, 0.04], poleC, 6, 15);
  // T crossbar on the short front pole carrying the front-left tarp corner
  b.tube(
    [
      [-1.86, hFL - 0.06, FL.t[2] - 0.035],
      [-1.32, hFL - 0.07, FL.t[2] - 0.035],
    ],
    { radius: 0.036, sides: 5, ...poleC },
  );
  const lash = (at: Vec3, r: number, h = 0.075) =>
    b.cylinder({ height: h, radius: r, sides: 6, at, color: ROPE, vary: 0.06, parts: { top: shade(ROPE, 1.08) } });
  const strutX = (1.52 - strutB[2]) / (strutT[2] - strutB[2]);
  lash([FR.t[0], lerp(strutB[1], strutT[1], strutX), 1.52], 0.085, 0.12);
  lash([BL.t[0], hBL - 0.03, BL.t[2]], 0.072);
  lash([FL.t[0], hFL - 0.062, 1.49], 0.064);
  // short tie ropes from the high tarp corners to their poles
  const tie = (corner: Vec3, poleAt: Vec3) => {
    b.tube([corner, add3(lerp3(corner, poleAt, 0.5), [0, -0.02, 0]), poleAt], { radius: 0.011, sides: 4, color: ROPE, vary: 0.04 });
    b.icosphere({ radius: 0.032, detail: 0, at: corner, color: shade(ROPE, 0.9) });
  };
  tie(V[nRx][nRz], [FR.t[0] - 0.04, hFR + 0.02, FR.t[2] - 0.01]);
  tie(V[0][0], [BL.t[0] + 0.04, hBL + 0.02, BL.t[2] + 0.01]);
  // guy ropes to stakes (slight sag); the back-right corner is staked out by its rope only
  const stake = (at: Vec3) => {
    b.cone({ radius: 0.035, height: 0.26, sides: 4, at: [at[0], 0.13, at[2]], rot: [180, 45, 0], ...wood(WOOD_DARK, 0.05) });
    b.box({ size: [0.07, 0.03, 0.07], at: [at[0], 0.26 - 0.015, at[2]], rot: [0, 45, 0], ...wood(WOOD_DARK, 0.05) });
  };
  const guy = (from: Vec3, to: Vec3, sagK = 0.05) => {
    const mid = add3(lerp3(from, to, 0.5), [0, -sagK, 0]);
    b.tube([from, mid, add3(to, [0, 0.22, 0])], { radius: 0.009, sides: 4, color: ROPE, vary: 0.04 });
    stake(to);
  };
  guy(add3(FR.t, [0.02, -0.1, 0.02]), [2.3, 0, 2.3]);
  guy(add3(BL.t, [-0.02, -0.1, -0.02]), [-2.3, 0, -2.3]);
  guy(add3(FL.t, [-0.03, -0.08, 0.03]), [-2.3, 0, 2.3]);
  const brCorner = V[nRx][0];
  guy(brCorner, [2.3, 0, -2.3], 0.08);
  b.icosphere({ radius: 0.034, detail: 0, at: brCorner, color: shade(ROPE, 0.9) });
  // peg on the back-left pole for a lantern
  const hook: Vec3 = [BL.b[0] + 0.03 + 0.11, 1.95, BL.b[2] + 0.03 + 0.11];
  bar(b, [BL.b[0] + 0.03, 1.97, BL.b[2] + 0.03], hook, 0.03, wood(WOOD_DARK, 0.05));

  m.anchor("pole_fr_top", FR.t);
  m.anchor("pole_bl_top", BL.t);
  m.anchor("pole_fl_top", FL.t);
  m.anchor("lantern_hook", add3(hook, [0, -0.02, 0]));
  m.anchor("floor_center", [0, 0, 0]);
  m.meta = {
    coverage: {
      x: [xL, xR],
      z: [zB, zF],
      cornerHeights: { fl: hFL, fr: hFR, bl: hBL, br: hBR },
      minRoofHeight: rn(Math.min(...V.flat().map((p) => p[1]))),
      tattersHangTo: rn(clothMinY),
    },
    poleColliders: [FR, BL, FL, { b: strutB, t: strutT }].map((p) => ({ type: "segment", a: r4(p.b), b: r4(p.t), radius: 0.07 })),
    note:
      "Open on all sides; place with the low back-right corner toward the cave wall. Tarp/ropes/stakes are " +
      "cosmetic (no collision). Rest props (pallet bed, wheelchair, crates) fit under it.",
  };
  return m;
}

/* =========================================================================================
 * Clothesline (living corner)
 * ========================================================================================= */

function clothesline(): Model {
  const name = "tl_furn_clothesline_v01";
  const m = new Model(name, {
    budget: 400,
    notes:
      "Living-corner clothesline (02 LIVING CORNER): two crooked poles 2.5 m apart, a sagging rope with a " +
      "faded red jersey (plain, no logo), two worn rags and a charcoal towel pegged on it. Rope ~1.85 m high.",
  });
  const b = m.geo;
  const rng = new Rng(`${name}/shape`);
  const poleC = wood(mix(WOOD, WOOD_DARK, 0.2), 0.06);
  const span = 1.25,
    ropeY = 1.86,
    sag = 0.13;
  for (const s of [-1, 1]) {
    const base: Vec3 = [s * (span + 0.02), 0, rng.jitter(0.02)],
      top: Vec3 = [s * span, ropeY + 0.12, rng.jitter(0.02)];
    const mid = add3(lerp3(base, top, 0.5), [rng.jitter(0.03), 0, rng.jitter(0.03)]);
    pole(b, base, mid, [0.042, 0.038], poleC, 6, rng.range(0, 60));
    pole(b, mid, top, [0.038, 0.033], poleC, 6, rng.range(0, 60));
    b.cylinder({ height: 0.05, radius: 0.05, sides: 6, at: [s * span, ropeY, top[2]], color: ROPE, vary: 0.05 });
  }
  const ropeAt = (x: number): Vec3 => [x, ropeY - sag * (1 - (x / span) ** 2), 0];
  b.tube(
    Array.from({ length: 7 }, (_, i) => ropeAt(-span + (2 * span * i) / 6)),
    { radius: 0.008, sides: 4, color: ROPE, vary: 0.04 },
  );
  const peg = (x: number) => {
    const p = ropeAt(x);
    b.box({ size: [0.018, 0.07, 0.03], at: [p[0], p[1] - 0.012, p[2]], rot: [0, 0, rng.jitter(8)], ...wood(WOOD_TOP, 0.06) });
  };
  /** Cloth hung over the rope: front panel (ragged bottom) and a shorter back panel. */
  const hang = (x0: number, x1: number, front: number, back: number, color: Color) => {
    const n = 3;
    for (const [side, len] of [
      [1, front],
      [-1, back],
    ] as const) {
      const top: Vec3[] = [],
        bot: Vec3[] = [];
      for (let i = 0; i <= n; i++) {
        const x = lerp(x0, x1, i / n);
        const p = ropeAt(x);
        top.push([p[0], p[1] + 0.004, p[2] + side * 0.006]);
        const l = len * (1 + rng.jitter(0.12)) * (i === 0 || i === n ? 0.94 : 1);
        bot.push([x + rng.jitter(0.012), p[1] - l, side * (0.012 + l * 0.05)]);
      }
      for (let i = 0; i < n; i++) {
        const c = shade(color, 1 + rng.jitter(0.05));
        const q = [top[i], bot[i], bot[i + 1], top[i + 1]];
        if (side < 0) q.reverse();
        b.quad(q[0], q[1], q[2], q[3], { mat: "cloth", color: c });
      }
    }
    peg(x0 + 0.04);
    peg(x1 - 0.04);
  };
  // faded jersey (plain), pegged by the shoulders, front facing +Z
  const jx = -0.62;
  const jy = ropeAt(jx)[1];
  const shirt: Vec2[] = [
    [-0.16, 0.0],
    [-0.06, 0.02],
    [0.0, -0.035],
    [0.06, 0.02],
    [0.16, 0.0],
    [0.27, -0.12],
    [0.2, -0.19],
    [0.15, -0.14],
    [0.15, -0.6],
    [-0.15, -0.6],
    [-0.15, -0.14],
    [-0.2, -0.19],
    [-0.27, -0.12],
  ];
  const jerseyC = shade(mix(P.crimson, P.crimsonFaded, 0.6), 0.9);
  b.group({ at: [jx, jy + 0.008, 0.012], rot: [-4, 0, rng.jitter(3)] }, (gb) => {
    gb.extrude(shirt, { depth: 0, mat: "cloth", color: jerseyC });
    // worn-white side stripes (fan shirt look, no text or logo)
    for (const s of [-1, 1])
      gb.extrude(rect(s * 0.15 - 0.025, -0.58, s * 0.15 + 0.025, -0.16).map(([x, y]) => [x - s * 0.03, y] as Vec2), {
        depth: 0,
        at: [0, 0, 0.003],
        mat: "cloth",
        color: P.worn,
      });
  });
  peg(jx - 0.12);
  peg(jx + 0.12);
  hang(-0.3, 0.06, 0.46, 0.22, mix(P.worn, P.wornDark, 0.3));
  hang(0.18, 0.62, 0.52, 0.3, mix(P.charcoal, P.earth, 0.2));
  hang(0.74, 1.02, 0.36, 0.2, mix(P.crimsonFaded, P.worn, 0.35));
  m.anchor("rope_mid", ropeAt(0));
  m.meta = {
    poleColliders: [-1, 1].map((s) => ({ type: "cylinder", center: [s * span, 1.0, 0], radius: 0.06, height: 2.0 })),
    note: "Cosmetic; only the two poles should collide.",
  };
  return m;
}

/* =========================================================================================
 * Rope cordon (exit tunnel)
 * ========================================================================================= */

/**
 * A rope tied between the two tripod torches in front of the exit tunnel (the edge of the walk
 * area): sagging line, a blank weathered plank hanging from the middle and a few rag strips, so
 * the stop in front of the tunnel reads as a barrier, not an invisible wall.
 */
function ropeCordon(): Model {
  const name = "tl_furn_rope_cordon_v01";
  const m = new Model(name, {
    budget: 400,
    notes:
      "Exit-tunnel cordon: a rope tied between two tripod torches 4.8 m apart (ends at x = +-2.4 m, y = 1.72 m: the " +
      "tripods' lashing) sagging to ~1.05 m, with a blank weathered plank hanging from the middle and faded rag strips. " +
      "Place it on the line between the two tripods, facing the hub. Cosmetic, no collider (it marks the walk limit).",
  });
  const b = m.geo;
  const rng = new Rng(`${name}/shape`);
  const span = 2.4,
    endY = 1.72,
    sag = 0.67;
  const ropeAt = (x: number): Vec3 => [x, endY - sag * (1 - (x / span) ** 2), 0];
  b.tube(
    Array.from({ length: 11 }, (_, i) => ropeAt(-span + (2 * span * i) / 10)),
    { radius: 0.011, sides: 4, color: ROPE, vary: 0.05 },
  );
  // Knots at the tripods.
  for (const s of [-1, 1])
    b.cylinder({ height: 0.06, radius: 0.03, sides: 5, at: ropeAt(s * (span - 0.03)), rot: [0, 0, 90], color: ROPE, vary: 0.05 });
  // Blank plank on two short cords from the lowest point (no text, no emblem).
  const mid = ropeAt(0);
  const plankTop = mid[1] - 0.12;
  for (const s of [-1, 1])
    pole(b, [s * 0.17, mid[1] - 0.004, 0], [s * 0.2, plankTop, 0.005], 0.006, { color: ROPE, vary: 0.04 }, 4);
  b.box({
    size: [0.52, 0.2, 0.025],
    at: [0, plankTop - 0.1, 0.008],
    rot: [4, 0, rng.jitter(4)],
    chamfer: 0.006,
    ...wood(WOOD_TOP, 0.08),
  });
  // Rag strips knotted on the rope.
  const rag = (x: number, len: number, w: number, color: Color) => {
    const p = ropeAt(x);
    const sway = rng.jitter(0.04);
    const q: Vec3[] = [
      [p[0] - w / 2, p[1] + 0.005, 0.006],
      [p[0] - w / 2 + sway, p[1] - len, 0.02],
      [p[0] + w / 2 + sway, p[1] - len * (0.85 + rng.next() * 0.2), 0.02],
      [p[0] + w / 2, p[1] + 0.005, 0.006],
    ];
    b.quad(q[0], q[1], q[2], q[3], { mat: "cloth", color: shade(color, 1 + rng.jitter(0.05)) });
  };
  rag(-1.45, 0.34, 0.09, mix(P.crimsonFaded, P.crimson, 0.4));
  rag(-0.7, 0.26, 0.07, mix(P.worn, P.wornDark, 0.4));
  rag(0.75, 0.3, 0.08, mix(P.crimsonFaded, P.worn, 0.3));
  rag(1.5, 0.24, 0.07, mix(P.charcoal, P.earth, 0.3));
  m.anchor("end_l", ropeAt(span));
  m.anchor("end_r", ropeAt(-span));
  m.meta = { span: 2 * span, endHeight: endY, lowest: rn(mid[1]), note: "Ends tie to tl_fx_torch_tripod_v01 lashings (1.75 m)." };
  return m;
}

/* =========================================================================================
 * Rug
 * ========================================================================================= */

function rugWorn(): Model {
  const name = "tl_furn_rug_worn_v01";
  const m = new Model(name, {
    budget: 250,
    notes: "Small worn striped floor mat 1.3 x 0.85 m (faded red / worn white / charcoal), frayed short ends, one hole.",
  });
  const red = shade(mix(P.crimsonFaded, P.earth, 0.4), 0.85);
  const pale = mix(P.wornDark, P.earth, 0.3);
  const dark = mix(P.charcoal, P.earth, 0.25);
  const stripes = [red, red, pale, dark, red, red, dark, pale, red, red];
  m.geo.cloth({
    size: [1.3, 0.85],
    seg: [10, 5],
    pin: "none",
    noise: 0.003,
    tear: 0.2,
    tearEdges: "+x -x",
    holes: 1,
    patches: 1,
    patchColor: mix(P.wornDark, P.cardboard, 0.3),
    mat: "solid",
    at: [0, 0.008, 0],
    vary: 0.05,
    color: (f) => stripes[Math.max(0, Math.min(9, Math.floor(((f.center[0] + 0.65) / 1.3) * 10)))],
  });
  m.meta = { footprint: [1.3, 0.85] };
  return m;
}

/* =========================================================================================
 * Market stalls: hanging sign boards, check-in stall, apparel stall
 * ========================================================================================= */

/** Dark weathered board wood of the stall signs (painted lettering has to read on it). */
const SIGN_WOOD = mix(WOOD_DARK, P.woodGrey, 0.28);
/** Faded tarp crimson of the two shelters, and its worn-white patches. */
const TARP = shade(mix(P.tarp, P.rust, 0.35), 0.84);
const TARP_WORN = mix(P.worn, P.crimsonFaded, 0.12);

/** A flat rectangle of a sign board the runtime paints its text texture on (model space). */
interface SignFace {
  name: "front" | "back";
  center: Vec3;
  /** [width along up x normal, height along up] in metres. */
  size: Vec2;
  normal: Vec3;
  up: Vec3;
}
interface SignFrame {
  faces: SignFace[];
  /** Board rows bottom to top with the exact front colour of each plank (the texture repeats them). */
  planks: { y0: number; y1: number; color: Color }[];
  /** Post axes at the floor. */
  posts: Vec3[];
  postTop: number;
  crossbarY: number;
}

/**
 * Stall sign: a board of four dark weathered planks hung by two rope loops from a crossbar
 * lashed to two rough posts wedged with rocks. The planks are flat and coplanar so the runtime
 * can lay a painted-text texture over each side (see SignFace); the two back battens sit outside
 * the back face. Built into `g` in the plane z = o.z, centred on x = 0, posts down to y = 0.
 */
function signFrame(
  g: MeshBuilder,
  rng: Rng,
  o: {
    width: number;
    z?: number;
    bottom?: number;
    rag?: -1 | 1;
    /** Post axes at +-postHalf instead of just outside the board (a gate wider than its board). */
    postHalf?: number;
    /** Thickness factor of posts, crossbar, lashings and foot rocks (default 1). */
    heavy?: number;
  },
): SignFrame {
  const W = o.width,
    z0 = o.z ?? 0,
    bottom = o.bottom ?? 2.24;
  const Hb = 0.78,
    rows = 4,
    gap = 0.012,
    T = 0.04;
  const h = (Hb - gap * (rows - 1)) / rows;
  const top = bottom + Hb;
  const planks: SignFrame["planks"] = [];
  for (let k = 0; k < rows; k++) {
    const y0 = bottom + k * (h + gap),
      y1 = y0 + h;
    const c = shade(SIGN_WOOD, 1 + rng.jitter(0.07));
    g.plank({
      size: [W + rng.jitter(0.045), T, h],
      rot: [90, 0, 0],
      at: [rng.jitter(0.025), (y0 + y1) / 2, z0],
      jitter: 0.05,
      color: c,
      parts: { top: c, bottom: c, side: shade(c, 0.78), end: shade(c, 0.66) },
    });
    planks.push({ y0: rn(y0), y1: rn(y1), color: c });
  }
  // back battens, outside the back face
  const battenX = W / 2 - 0.13;
  for (const s of [-1, 1])
    g.box({ size: [0.07, Hb - 0.07, 0.028], at: [s * battenX, bottom + Hb / 2, z0 - T / 2 - 0.014], ...wood(mix(WOOD_DARK, P.woodGrey, 0.5), 0.05) });
  // posts (a slight kink each), crossbar lashed across them, rocks wedging the feet
  const postTop = top + 0.3,
    crossY = top + 0.13;
  const postC = wood(mix(WOOD, WOOD_DARK, 0.3), 0.06);
  const posts: Vec3[] = [];
  const K = o.heavy ?? 1;
  for (const s of [-1, 1]) {
    const x = s * (o.postHalf ?? W / 2 + 0.16);
    const base: Vec3 = [x + s * 0.03 + rng.jitter(0.02), 0, z0 + rng.jitter(0.02)];
    const tp: Vec3 = [x, postTop + rng.jitter(0.05), z0];
    const mid = add3(lerp3(base, tp, 0.48), [rng.jitter(0.025), 0, rng.jitter(0.02)]);
    pole(g, base, mid, [0.062 * K, 0.054 * K], postC, 6, rng.range(0, 60));
    pole(g, mid, tp, [0.054 * K, 0.046 * K], postC, 6, rng.range(0, 60));
    posts.push(base);
    g.cylinder({ height: 0.11 * K, radius: 0.074 * K, sides: 6, at: [x, crossY, z0], color: ROPE, vary: 0.06 });
    for (const [dx, dz, k] of [
      [0.17, 0.1, 1],
      [-0.1, -0.13, 0.8],
    ] as const)
      g.rock({
        size: [0.32 * k * K, 0.2 * k * K, 0.28 * k * K],
        at: [base[0] + s * dx * K, 0, base[2] + dz * K],
        align: "bottom",
        rot: [0, rng.range(0, 180), 0],
        points: 9,
        jitter: 0.25,
        flat: 0.3,
        color: mix(P.rock, P.pebble, 0.25),
        parts: { top: mix(P.rockLight, P.pebble, 0.3), bottom: P.rockDark },
        vary: 0.07,
      });
  }
  const barEnd = o.postHalf === undefined ? [W / 2 + 0.42, W / 2 + 0.38] : [o.postHalf + 0.36, o.postHalf + 0.3];
  g.tube(
    [
      [-barEnd[0], crossY + rng.jitter(0.02), z0 + 0.012],
      [barEnd[1], crossY + rng.jitter(0.02), z0 + 0.012],
    ],
    { radius: 0.042 * K, sides: 6, ...wood(mix(WOOD, WOOD_DARK, 0.15), 0.06) },
  );
  // two rope loops: over the crossbar, down both sides of the top plank
  for (const s of [-1, 1]) {
    const x = s * W * 0.36;
    g.tube(
      [
        [x, top - 0.05, z0 + T / 2 + 0.009],
        [x, top + 0.02, z0 + T / 2 + 0.014],
        [x, crossY + 0.052, z0 + 0.02],
        [x, crossY + 0.02, z0 - 0.04],
        [x, top - 0.05, z0 - T / 2 - 0.009],
      ],
      { radius: 0.011, sides: 4, color: ROPE, vary: 0.05 },
    );
    g.box({ size: [0.05, 0.035, 0.03], at: [x, top - 0.055, z0 + T / 2 + 0.012], rot: [0, 0, rng.jitter(15)], color: shade(ROPE, 0.88) });
  }
  if (o.rag) {
    // a faded rag knotted on one end of the crossbar
    const x = o.rag * (W / 2 + 0.33);
    const c = mix(P.crimsonFaded, P.crimson, 0.45);
    g.quad([x - 0.045, crossY, z0 + 0.03], [x - 0.07, crossY - 0.36, z0 + 0.06], [x + 0.02, crossY - 0.3, z0 + 0.07], [x + 0.045, crossY, z0 + 0.03], {
      mat: "cloth",
      color: c,
    });
    g.quad([x - 0.03, crossY, z0 - 0.02], [x - 0.01, crossY - 0.22, z0 - 0.05], [x + 0.06, crossY - 0.26, z0 - 0.04], [x + 0.04, crossY, z0 - 0.02], {
      mat: "cloth",
      color: mix(P.worn, P.wornDark, 0.35),
    });
  }
  const faceH = Hb - 0.012,
    cy = bottom + Hb / 2;
  return {
    faces: [
      { name: "front", center: r4([0, cy, z0 + T / 2 + 0.003]), size: [rn(W - 0.15), rn(faceH)], normal: [0, 0, 1], up: [0, 1, 0] },
      { name: "back", center: r4([0, cy, z0 - T / 2 - 0.003]), size: [rn(2 * battenX - 0.13), rn(faceH)], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    planks,
    posts,
    postTop,
    crossbarY: crossY,
  };
}

function signMeta(f: SignFrame) {
  return {
    faces: f.faces,
    planks: f.planks,
    wood: SIGN_WOOD,
    note:
      "faces: flat rectangles (model space) for the runtime text texture, one per side, 3 mm proud of the planks; " +
      "planks: board rows with the exact front colour so the texture's wood matches the GLB.",
  };
}
const postColliders = (f: SignFrame) =>
  f.posts.map((p) => ({ type: "cylinder", center: r4([p[0], f.postTop / 2, p[2]]), radius: 0.08, height: rn(f.postTop) }));

function stallSign(name: string, width: number, rag: -1 | 1): Model {
  const m = new Model(name, {
    budget: 500,
    notes:
      `Stall sign, board ${width} x 0.78 m: four dark weathered planks hung by rope loops from a crossbar on two ` +
      "rough posts wedged with rocks (posts ~3.3 m, board 2.24-3.02 m above the floor), a faded rag on the crossbar. " +
      "No lettering in the GLB: meta.sign.faces gives the flat front/back rectangles (centre, size, normal, up) for " +
      "the runtime text texture, meta.sign.planks the plank rows and their colours. Only the posts collide.",
  });
  const rng = new Rng(`${name}/shape`);
  const f = signFrame(m.geo, rng, { width, rag });
  m.anchor("board_center", [0, f.faces[0].center[1], 0]);
  m.meta = { sign: signMeta(f), postColliders: postColliders(f) };
  return m;
}

/**
 * Gate in front of a side-tunnel mouth: two tall rough posts either side of the path, a crossbar
 * lashed across them with two knee braces, and the cave's name board hanging from the crossbar
 * above head height. Same board construction as the stall signs (signFrame), so the runtime paints
 * it the same way.
 */
const CAVE_GATE = { board: 3.2, bottom: 3.2, postHalf: 2.85 };
function caveGate(): Model {
  const m = new Model("tl_sign_cave_gate_v01", {
    budget: 700,
    notes:
      `Gate sign for a side-tunnel mouth: posts at x = +-${CAVE_GATE.postHalf} m (clear width ~5.5 m, the path is 3.4 m), ` +
      `crossbar at ~4.1 m with knee braces, a ${CAVE_GATE.board} x 0.78 m board of four dark planks hanging from it ` +
      `(${CAVE_GATE.bottom}-${CAVE_GATE.bottom + 0.78} m above the floor, above the camera ceiling of the tunnels). No lettering in ` +
      "the GLB: meta.sign.faces / planks as on tl_sign_stall_*. Front (+Z) faces the main cave. Only the posts collide.",
  });
  const rng = new Rng(`${m.name}/shape`);
  const g = m.geo;
  const f = signFrame(g, rng, { width: CAVE_GATE.board, bottom: CAVE_GATE.bottom, postHalf: CAVE_GATE.postHalf, heavy: 1.7, rag: 1 });
  const braceC = wood(mix(WOOD, WOOD_DARK, 0.5), 0.06);
  for (const s of [-1, 1])
    bar(g, [s * (CAVE_GATE.postHalf - 0.02), f.crossbarY - 0.8, 0], [s * (CAVE_GATE.postHalf - 0.78), f.crossbarY - 0.03, 0.01], 0.08, braceC);
  m.anchor("board_center", [0, f.faces[0].center[1], 0]);
  m.meta = {
    sign: signMeta(f),
    postColliders: postColliders(f),
    gate: { postHalf: CAVE_GATE.postHalf, clearHeight: CAVE_GATE.bottom },
  };
  return m;
}

/** Rock tones of the cave walls (tools/models/groups/caves.ts WALL_TONES): the rim reads as part of the wall. */
const WALL_ROCK: Color[] = [P.ochre, P.rock, mix(P.ochre, P.earth, 0.5), P.rock, P.rockLight, mix(P.rock, P.rockDark, 0.5)];

interface WallScreenSpec {
  name: string;
  /** Picture width (m); the height follows from 16:9. */
  w: number;
  /** Height of the housing's bottom edge above the pivot (m). */
  lift: number;
  /** Forward lean (deg): the rock face it is bolted to leans into the cave. */
  tilt: number;
  bezel: number;
  depth: number;
  /** Rim rocks: how far they run back into the wall (m) and how thick they are around the housing (0 = no rim). */
  rimBack: number;
  rim: number;
  speakers: boolean;
  /** Battery box on the floor, in model space, with the cable running down to it. */
  battery?: Vec3;
  light: { intensity: number; range: number; out: number };
  notes: string;
  budget: number;
}

/**
 * Screen bolted straight onto the cave wall: a salvaged 16:9 display in a dark housing, set in a
 * rim of wall rock that runs back into the rock face (so no gap shows where the wall bends away),
 * held by iron corner brackets and two chains running into the rock above. No frame, no legs. The
 * picture is not in the GLB: meta.screen gives the flat rectangle for the runtime texture.
 *
 * Model frame: pivot on the floor under the bottom-centre of the housing's BACK plane; the housing
 * starts `lift` m up and leans `tilt` degrees forward about its bottom edge. Place the model so
 * that back plane lies on the rock (packages/shared/src/layout.ts has the fitted poses).
 */
function wallScreen(o: WallScreenSpec): Model {
  const { w, lift, tilt, bezel, depth } = o;
  const h = (w * 9) / 16;
  const W = w + 2 * bezel,
    H = h + 2 * bezel;
  /** Panel frame (x right, y up the housing from its bottom edge, z out of the back plane) -> model space. */
  const panel = (p: Vec3): Vec3 => add3(rotatePoint(p, [tilt, 0, 0]), [0, lift, 0]);
  const m = new Model(o.name, { budget: o.budget, notes: o.notes });
  const rng = new Rng(`${m.name}/shape`);
  const g = m.geo;
  const CASE = "#22252A",
    CASE_LIT = "#30343B";

  g.push();
  g.translate(0, lift, 0);
  g.rotateX(tilt);
  // housing and glass
  g.box({
    size: [W, H, depth],
    at: [0, H / 2, depth / 2],
    chamfer: Math.min(0.035, depth * 0.12),
    color: CASE,
    parts: { front: shade(CASE, 0.9), top: CASE_LIT, bevel: CASE_LIT, bottom: shade(CASE, 0.7), back: shade(CASE, 0.6) },
    vary: 0.04,
  });
  const zg = depth + 0.004;
  g.quad([-w / 2, bezel, zg], [w / 2, bezel, zg], [w / 2, bezel + h, zg], [-w / 2, bezel + h, zg], { color: "#090B10" });

  // Rim of wall rock around the housing, running back into the rock face. Blocks overlap along each
  // edge; the bottom ones are the deepest and thickest: the ledge the housing sits on.
  const rimRock = (at: Vec3, size: Vec3, rot: Vec3) => {
    const tone = WALL_ROCK[rng.int(0, WALL_ROCK.length - 1)];
    g.rock({
      size,
      at,
      rot,
      points: 11,
      jitter: 0.22,
      flat: 0.25,
      color: shade(tone, 0.96),
      parts: { top: mix(tone, P.worn, 0.12), bottom: shade(tone, 0.6) },
      vary: 0.08,
    });
  };
  const zc = (depth - o.rimBack) / 2 - 0.04; // front of the rim just behind the glass
  const along = (len: number, target: number) => (o.rim > 0 ? Math.max(2, Math.round(len / target)) : 0);
  const nx = along(W, 1.25 * (o.rim / 0.5)),
    ny = along(H, 1.15 * (o.rim / 0.5));
  const reach = Math.max(o.rim, 0.2); // how far the chains climb above the housing
  for (const [side, thick] of [
    [1, o.rim],
    [-1, o.rim * 1.35],
  ] as const)
    for (let i = 0; i < nx; i++) {
      const x = -W / 2 + (W * (i + 0.5)) / nx + rng.jitter(0.1 * o.rim);
      const t = thick * rng.range(0.85, 1.25);
      rimRock(
        [x, side > 0 ? H + t * 0.34 : -t * 0.36, zc + rng.jitter(0.06)],
        [(W / nx) * rng.range(1.3, 1.55), t, o.rimBack + depth * 0.9],
        [rng.jitter(6), rng.jitter(8), rng.jitter(7)],
      );
    }
  for (const side of [-1, 1])
    for (let i = 0; i < ny; i++) {
      const y = (H * (i + 0.5)) / ny + rng.jitter(0.1 * o.rim);
      const t = o.rim * rng.range(0.9, 1.3);
      rimRock(
        [side * (W / 2 + t * 0.34), y, zc + rng.jitter(0.06)],
        [t, (H / ny) * rng.range(1.3, 1.55), o.rimBack + depth * 0.9],
        [rng.jitter(7), rng.jitter(8), rng.jitter(6)],
      );
    }

  // iron corner brackets with bolt heads, lapping over the bezel
  const IRON = shade(P.metalDark, 0.85);
  for (const sx of [-1, 1])
    for (const sy of [0, 1]) {
      const x = sx * (W / 2),
        y = sy * H,
        L = Math.min(0.75, W * 0.11),
        t = Math.min(0.13, bezel * 0.95);
      g.box({ size: [L, t, 0.035], at: [x - sx * (L / 2 - 0.03), y + (sy ? -t / 2 : t / 2), depth + 0.012], color: IRON, vary: 0.06 });
      g.box({ size: [t, L, 0.035], at: [x - sx * (t / 2), y + (sy ? -(L / 2 - 0.03) : L / 2 - 0.03), depth + 0.012], color: IRON, vary: 0.06 });
      for (const [dx, dy] of [
        [L * 0.78, t / 2],
        [t / 2, L * 0.78],
        [t / 2, t / 2],
      ] as const)
        g.cylinder({ height: 0.03, radius: t * 0.3, sides: 6, rot: [90, 0, 0], at: [x - sx * dx, y + (sy ? -dy : dy), depth + 0.04], color: P.metal });
    }
  // two chains from the top edge up and back into the rock above
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.36;
    g.tube(
      [
        [x, H - 0.02, depth * 0.6],
        [x + sx * 0.1 * (reach / 0.55), H + reach * 1.25, depth * 0.35],
        [x + sx * 0.22 * (reach / 0.55), H + reach * 1.9, -Math.max(o.rimBack, 0.4) * 0.6],
      ],
      { radius: Math.max(0.018, bezel * 0.2), sides: 4, color: P.metalDark, vary: 0.08 },
    );
  }
  if (o.speakers)
    for (const s of [-1, 1]) {
      // speaker bracketed to the rock beside the picture, tipped down toward the floor of the cave
      g.group({ at: [s * (W / 2 + 0.62), H - 1.05, depth + 0.2], rot: [8, -s * 14, 0] }, (b) => {
        b.box({ size: [0.66, 1.0, 0.5], chamfer: 0.03, color: "#2A2826", parts: { front: "#1C1B1A", top: "#37342F" }, vary: 0.05 });
        b.cylinder({ height: 0.03, radius: 0.22, sides: 10, rot: [90, 0, 0], at: [0, -0.17, 0.262], color: "#4A4C4E", parts: { top: "#3A3C3E" } });
        b.cylinder({ height: 0.03, radius: 0.1, sides: 8, rot: [90, 0, 0], at: [0, 0.27, 0.262], color: "#55585A" });
      });
      bar(g, [s * (W / 2 + 0.62), H - 1.05, depth - 0.05], [s * (W / 2 + 0.5), H - 1.0, -0.6], 0.07, { color: IRON, vary: 0.06 });
    }
  g.pop();

  if (o.battery) {
    // cable down the rock to a battery box on the floor
    const [bx, , bz] = o.battery;
    g.tube(
      [
        panel([-(W / 2 - 0.6), 0.02, depth * 0.4]),
        panel([-(W / 2 - 0.75), -reach * 1.6, depth * 0.3]),
        [bx + 0.25, lift * 0.45, bz * 0.45],
        [bx + 0.1, 0.5, bz - 0.2],
        [bx, 0.36, bz],
      ],
      { radius: 0.03, sides: 4, color: "#19181A", vary: 0.05 },
    );
    g.group({ at: [bx, 0, bz], rot: [0, 18, 0] }, (b) => {
      const c = mix(P.oxygen, P.metalDark, 0.55);
      b.box({ size: [0.85, 0.52, 0.5], at: [0, 0.26, 0], chamfer: 0.03, color: c, parts: { top: shade(c, 1.15), bottom: shade(c, 0.6) }, vary: 0.05 });
      b.box({ size: [0.5, 0.05, 0.08], at: [0, 0.6, 0], color: P.metalDark });
      for (const sx of [-1, 1]) b.box({ size: [0.05, 0.1, 0.06], at: [sx * 0.22, 0.55, 0], color: P.metalDark });
      b.box({ size: [0.06, 0.06, 0.02], at: [0.28, 0.36, 0.255], mat: "glow", glow: 1.4, color: "#FF5A3C" });
    });
  }

  const dir = (v: Vec3): Vec3 => r4(rotatePoint(v, [tilt, 0, 0]));
  m.anchor("screen_center", r4(panel([0, H / 2, depth])));
  m.light({ name: "screen", at: r4(panel([0, H / 2 - h * 0.1, depth + o.light.out])), color: "#AFC6E6", intensity: o.light.intensity, range: o.light.range });
  m.meta = {
    screen: {
      center: r4(panel([0, H / 2, depth + 0.01])),
      size: [rn(w), rn(h)],
      normal: dir([0, 0, 1]),
      up: dir([0, 1, 0]),
      tilt,
      note: "flat rectangle (model space) for the runtime picture; the GLB glass behind it is dark matte",
    },
    mount: {
      lift,
      housing: [rn(W), rn(H), depth],
      note: "pivot = floor point under the bottom-centre of the housing's back plane; that plane lies on the rock face",
    },
  };
  return m;
}

/**
 * The main cave's screen: 9.6 x 5.4 m on the flat rock face cut into the back-left wall
 * (tools/models/groups/caves.ts SCREEN_WALL: the face leans 0.18 m per metre = 10.204 deg).
 */
const WALL_SCREEN: WallScreenSpec = {
  name: "tl_furn_wall_screen_v01",
  w: 9.6,
  lift: 2.0,
  tilt: 10.204,
  bezel: 0.14,
  depth: 0.4,
  rimBack: 0.8,
  rim: 0.42,
  speakers: true,
  battery: [-2.6, 0, 1.4],
  light: { intensity: 1.3, range: 12, out: 2.6 },
  budget: 1400,
  notes:
    "Big wall screen bolted onto the flat rock face of the main cave's back-left wall: 9.6 x 5.4 m picture (16:9) in a dark " +
    "housing 0.4 m deep, leaning 10.2 deg forward with the rock face, bottom edge 2 m above the floor. A rim of wall-coloured " +
    "rock around it (ledge under it), iron corner brackets, two chains into the rock, two speakers, a cable down to a battery " +
    "box on the floor. No frame or legs. The glass is a dark matte quad; meta.screen gives the rectangle (centre, size, " +
    "normal, up) the runtime lays its live picture on, 6 mm in front; meta.mount explains the pivot.",
};

/**
 * The quest board of Hang Quest: planks on the flat back wall of the rock niche (side cave "a"), where
 * the small match screen used to hang. Pinned with paper notes; the stall sign above names it.
 */
function questBoard(): Model {
  const W = 2.2,
    H = 1.3,
    LIFT = 0.95,
    TILT = 10,
    D = 0.07;
  const m = new Model("tl_furn_quest_board_v01", {
    budget: 850,
    notes:
      "Quest board for the rock niche of a side cave: 2.2 x 1.3 m of rough planks in a darker frame, bottom edge 0.95 m " +
      "above the floor, leaning 10 deg forward with the niche wall (which leans in above 2 m). Paper notes pinned on it " +
      "(blank: no text), three with a crimson ribbon, iron nails; bolted flat to the rock. No posts or legs. " +
      "Pivot: floor point under the bottom-centre of the board's back plane; +Z faces the room.",
  });
  const rng = new Rng(`${m.name}/shape`);
  const g = m.geo;
  g.push();
  g.translate(0, LIFT, 0);
  g.rotateX(TILT);
  // five planks, slightly uneven
  const n = 5;
  for (let i = 0; i < n; i++) {
    const ph = H / n;
    const tone = mix(P.wood, i % 2 ? P.woodLight : P.woodDark, 0.25 + rng.range(0, 0.2));
    g.box({
      size: [W - rng.range(0, 0.05), ph - 0.012, D],
      at: [rng.jitter(0.012), ph * (i + 0.5), D / 2],
      chamfer: 0.008,
      color: tone,
      parts: { front: shade(tone, 1.04), top: shade(tone, 1.1), bottom: shade(tone, 0.72), back: shade(tone, 0.6) },
      vary: 0.05,
    });
  }
  // frame: two uprights and two rails lapping over the planks
  const FRAME = shade(P.woodDark, 0.9);
  for (const sx of [-1, 1])
    g.box({ size: [0.11, H + 0.1, 0.05], at: [sx * (W / 2 - 0.03), H / 2, D + 0.02], chamfer: 0.01, color: FRAME, parts: { front: shade(FRAME, 1.12) }, vary: 0.05 });
  for (const y of [0.02, H - 0.02])
    g.box({ size: [W + 0.08, 0.1, 0.045], at: [0, y, D + 0.04], chamfer: 0.01, color: FRAME, parts: { front: shade(FRAME, 1.12), top: shade(FRAME, 1.2) }, vary: 0.05 });
  // notes: [x, y, w, h, roll, ribbon]
  const PAPER = mix(P.white, P.worn, 0.3);
  const notes: [number, number, number, number, number, boolean][] = [
    [-0.78, 0.92, 0.36, 0.44, 4, true],
    [-0.34, 0.98, 0.3, 0.3, -6, false],
    [0.06, 0.9, 0.4, 0.5, 2, true],
    [0.52, 1.0, 0.28, 0.26, 7, false],
    [0.84, 0.86, 0.3, 0.4, -3, false],
    [-0.62, 0.4, 0.34, 0.3, -5, false],
    [-0.16, 0.36, 0.3, 0.36, 5, false],
    [0.3, 0.38, 0.36, 0.28, -2, true],
    [0.76, 0.36, 0.26, 0.32, 6, false],
  ];
  for (const [x, y, w, h, roll, ribbon] of notes) {
    const tone = mix(PAPER, P.cardboard, rng.range(0, 0.35));
    g.box({ size: [w, h, 0.006], at: [x, y, D + 0.008], rot: [0, 0, roll], color: tone, parts: { front: shade(tone, 1.03) }, vary: 0.03 });
    // a few ink lines (plain bars, no text), rolled with the note
    const lines = Math.max(2, Math.round(h / 0.11));
    const cr = Math.cos(roll * 0.0174533),
      sr = Math.sin(roll * 0.0174533);
    const onNote = (u: number, v: number): Vec3 => [x + u * cr - v * sr, y + u * sr + v * cr, D + 0.0125];
    for (let k = 0; k < lines; k++) {
      const v = h / 2 - 0.075 - (k * (h - 0.13)) / lines;
      const u0 = -w / 2 + 0.035,
        u1 = u0 + w * rng.range(0.45, 0.76);
      g.quad(onNote(u0, v - 0.007), onNote(u1, v - 0.007), onNote(u1, v + 0.007), onNote(u0, v + 0.007), { color: shade(P.woodDark, 0.7) });
    }
    if (ribbon) g.box({ size: [0.05, 0.13, 0.004], at: [x + w / 2 - 0.06, y - h / 2 + 0.04, D + 0.014], rot: [0, 0, roll - 8], color: P.crimson, vary: 0.05 });
    // nail
    g.cylinder({ height: 0.02, radius: 0.014, sides: 6, at: [x, y + h / 2 - 0.035, D + 0.02], rot: [90, 0, 0], color: P.metalDark });
  }
  g.pop();
  m.meta = { board: { width: W, height: H, lift: LIFT, tilt: TILT }, mount: { lift: LIFT, note: "hangs on the rock, no posts" } };
  return m;
}

/**
 * Rough counter: three top planks on corner posts, a front apron and end panels of upright
 * boards, open at the back (host side) with a shelf. Centred on x = 0, front at z = zc + depth/2.
 */
function stallCounter(g: MeshBuilder, rng: Rng, o: { width: number; depth: number; height: number; zc: number }): void {
  const { width: W, depth: D, height: H, zc } = o;
  const topT = 0.045,
    over = 0.045;
  const bodyH = H - topT;
  const zF = zc + D / 2 - over,
    zB = zc - D / 2 + over,
    xE = W / 2 - over;
  const frame = wood(mix(WOOD_TOP, WOOD, 0.45), 0.06);
  for (const sx of [-1, 1]) for (const z of [zF - 0.035, zB + 0.035]) g.box({ size: [0.07, bodyH, 0.07], at: [sx * (xE - 0.035), bodyH / 2, z], ...frame });
  // front apron: upright boards of uneven length
  const n = Math.round((2 * xE - 0.14) / 0.25);
  const bw = (2 * xE - 0.14) / n;
  for (let i = 0; i < n; i++) {
    const drop = rng.range(0, 0.05);
    g.box({
      size: [bw - 0.012, bodyH - 0.03 - drop, 0.024],
      at: [-xE + 0.07 + bw * (i + 0.5), (bodyH - 0.03 - drop) / 2 + 0.03 + drop, zF - 0.02],
      ...wood(shade(mix(WOOD, WOOD_PANEL, rng.range(0.2, 0.8)), 1 + rng.jitter(0.05)), 0.05),
    });
  }
  // end panels: two boards each
  const ew = (zF - zB - 0.14) / 2;
  for (const sx of [-1, 1])
    for (let i = 0; i < 2; i++)
      g.box({
        size: [0.024, bodyH - 0.04 - rng.range(0, 0.04), ew - 0.012],
        at: [sx * (xE - 0.02), (bodyH - 0.04) / 2 + 0.03, zB + 0.07 + ew * (i + 0.5)],
        ...wood(shade(mix(WOOD, WOOD_PANEL, 0.55), 1 + rng.jitter(0.06)), 0.05),
      });
  // back: shelf and a low stretcher
  g.plank({ size: [2 * xE - 0.1, 0.028, zF - zB - 0.1], at: [0, 0.42, (zF + zB) / 2], jitter: 0.05, ...wood(WOOD_DARK, 0.06) });
  bar(g, [-xE + 0.05, 0.1, zB + 0.035], [xE - 0.05, 0.1, zB + 0.035], 0.045, wood(WOOD_DARK, 0.06));
  // top: three long planks with a little overhang
  const gapT = 0.008;
  const pw = (D - 2 * gapT) / 3;
  for (let k = 0; k < 3; k++)
    g.plank({
      size: [W + rng.jitter(0.04), topT, pw],
      at: [rng.jitter(0.015), bodyH + topT / 2, zc - D / 2 + pw / 2 + k * (pw + gapT)],
      jitter: 0.08,
      ...wood(shade(WOOD_TOP, 1 + rng.jitter(0.06)), 0.05),
    });
}

/** Tattered cloth runner laid over the counter top and hanging down its front. */
function clothRunner(
  g: MeshBuilder,
  rng: Rng,
  o: { x: number; width: number; top: number; zFront: number; lay: number; drop: number; color: Color; patch: Color },
): void {
  const n = 4;
  const x0 = o.x - o.width / 2;
  const zf = o.zFront + 0.012;
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + (o.width * i) / n + (i > 0 && i < n ? rng.jitter(0.015) : 0));
  const bot = xs.map((_, i) => o.top - o.drop * (i === 0 || i === n ? 0.82 : 1) * (1 + rng.jitter(0.14)));
  for (let i = 0; i < n; i++) {
    const c = shade(o.color, 1 + rng.jitter(0.05));
    const y = o.top + 0.004;
    // on the top, then over the edge
    g.quad([xs[i], y, o.zFront - o.lay], [xs[i], y, zf], [xs[i + 1], y, zf], [xs[i + 1], y, o.zFront - o.lay], { mat: "cloth", color: shade(o.color, 1.04 + rng.jitter(0.03)) });
    g.quad([xs[i], y, zf], [xs[i] + rng.jitter(0.01), bot[i], zf + 0.012], [xs[i + 1] + rng.jitter(0.01), bot[i + 1], zf + 0.012], [xs[i + 1], y, zf], { mat: "cloth", color: c });
  }
  // a sewn-on patch, a little crooked, on the hanging part
  const px = o.x + o.width * 0.14,
    py = o.top - o.drop * 0.5,
    pw = o.width * 0.3,
    ph = o.drop * 0.34;
  g.extrude(rect(-pw / 2, -ph / 2, pw / 2, ph / 2), { depth: 0, at: [px, py, zf + 0.016], rot: [0, 0, rng.jitter(7)], mat: "cloth", color: o.patch });
}

/** Plain short-sleeved shirt outline hung by the shoulders (y = 0 at the shoulder line, 0.54 x 0.6 m). */
const SHIRT: Vec2[] = [
  [-0.16, 0.0],
  [-0.06, 0.02],
  [0.0, -0.035],
  [0.06, 0.02],
  [0.16, 0.0],
  [0.27, -0.12],
  [0.2, -0.19],
  [0.15, -0.14],
  [0.15, -0.6],
  [-0.15, -0.6],
  [-0.15, -0.14],
  [-0.2, -0.19],
  [-0.27, -0.12],
];
const SLEEVE = (s: number): Vec2[] => [
  [s * 0.16, 0.0],
  [s * 0.27, -0.12],
  [s * 0.2, -0.19],
  [s * 0.15, -0.14],
  [s * 0.105, -0.04],
];
/** A plain garment facing +Z (no logo, no text): body, optional sleeve / side-stripe / hem colours. */
function garment(g: MeshBuilder, o: { body: Color; sleeves?: Color; sides?: Color; band?: Color }): void {
  g.extrude(SHIRT, { depth: 0, mat: "cloth", color: o.body, vary: 0.04 });
  if (o.sleeves) for (const s of [-1, 1]) g.extrude(SLEEVE(s), { depth: 0, at: [0, 0, 0.004], mat: "cloth", color: o.sleeves });
  if (o.sides) for (const s of [-1, 1]) g.extrude(rect(s * 0.125 - 0.025, -0.58, s * 0.125 + 0.025, -0.17), { depth: 0, at: [0, 0, 0.004], mat: "cloth", color: o.sides });
  if (o.band) g.extrude(rect(-0.15, -0.6, 0.15, -0.545), { depth: 0, at: [0, 0, 0.004], mat: "cloth", color: o.band });
}

/** Stack of folded clothes: slabs of the given colours, bottom centre at `at`. */
function foldedStack(g: MeshBuilder, rng: Rng, at: Vec3, colors: Color[], size: Vec2 = [0.3, 0.23]): void {
  let y = at[1];
  for (const c of colors) {
    const t = rng.range(0.036, 0.05);
    g.box({
      size: [size[0] * (1 + rng.jitter(0.05)), t, size[1] * (1 + rng.jitter(0.05))],
      at: [at[0] + rng.jitter(0.012), y + t / 2, at[2] + rng.jitter(0.012)],
      rot: [0, rng.jitter(7), 0],
      color: c,
      parts: { top: shade(c, 1.06), bottom: shade(c, 0.75) },
      vary: 0.04,
    });
    y += t + 0.002;
  }
}

function stallCheckin(): Model {
  const name = "tl_furn_stall_checkin_v01";
  const m = new Model(name, {
    budget: 1500,
    notes:
      "Check-in stall, faces +Z (the visitor): rough plank counter 1.8 x 0.68 x 0.9 m with a tattered crimson runner, " +
      "an open ledger and pencil, a hand bell, a stamp with its ink pad and a box of cards; behind it (z = -1.05) the " +
      "stall sign on two posts, from which two booms carry a small patched crimson awning over the host's place " +
      "(root of the host ~0.62 m behind the counter centre). Anchors: host, lantern (counter top, left end), " +
      "counter_top. meta.sign as on tl_sign_stall_*; meta.postColliders = the two sign posts (the placement table adds one " +
      "convex footprint around counter + host). Pivot = counter centre, not the bounds centre.",
  });
  const g = m.geo;
  const rng = new Rng(`${name}/shape`);
  const H = 0.9,
    W = 1.8,
    D = 0.68,
    zc = 0.03;
  stallCounter(g, rng, { width: W, depth: D, height: H, zc });
  clothRunner(g, rng, { x: 0.12, width: 0.74, top: H, zFront: zc + D / 2, lay: 0.2, drop: 0.5, color: mix(P.crimson, P.crimsonFaded, 0.5), patch: P.worn });

  // open ledger + pencil
  g.group({ at: [-0.36, H, 0.0], rot: [0, 9, 0] }, (b) => {
    b.box({ size: [0.46, 0.014, 0.32], at: [0, 0.007, 0], color: P.crimsonDark, vary: 0.04 });
    for (const s of [-1, 1]) {
      b.box({ size: [0.212, 0.026, 0.29], at: [s * 0.109, 0.026, 0], rot: [0, 0, s * 3.5], color: P.paper, parts: { top: shade(P.paper, 1.05), side: shade(P.paper, 0.8) }, vary: 0.03 });
      // ruled lines (marks only, not lettering)
      for (let i = 0; i < 4; i++) {
        const z = -0.1 + i * 0.058,
          x0 = s * 0.03,
          x1 = s * (0.12 + rng.range(0.02, 0.07)),
          y = 0.0405 + 0.0035;
        b.quad([x0, y, z], [x0, y, z + 0.012], [x1, y + s * 0.0001, z + 0.012], [x1, y, z], { color: mix(P.shadow, P.paper, 0.35) });
      }
    }
    b.tube(
      [
        [0.02, 0.05, 0.11],
        [0.17, 0.047, 0.05],
      ],
      { radius: 0.007, sides: 4, color: P.torch, parts: { cap: P.shadow } },
    );
  });
  // hand bell
  const brass = mix(P.torch, P.rust, 0.55);
  g.cylinder({ height: 0.075, radius: 0.058, radiusTop: 0.026, sides: 6, at: [0.3, H + 0.0375, -0.12], color: brass, parts: { top: shade(brass, 1.15) }, vary: 0.06 });
  g.cylinder({ height: 0.07, radius: 0.013, sides: 5, at: [0.3, H + 0.11, -0.12], ...wood(WOOD_DARK, 0.04) });
  // stamp and ink pad
  g.box({ size: [0.13, 0.022, 0.095], at: [0.56, H + 0.011, -0.16], rot: [0, -14, 0], color: P.metalDark, parts: { top: P.crimsonDark } });
  g.cylinder({ height: 0.025, radius: 0.03, sides: 6, at: [0.66, H + 0.0125, -0.02], color: P.shadow });
  g.cylinder({ height: 0.075, radius: 0.017, radiusTop: 0.022, sides: 6, at: [0.66, H + 0.0625, -0.02], ...wood(WOOD_TOP, 0.05) });
  // box of cards
  g.group({ at: [0.66, H, 0.2], rot: [0, 12, 0] }, (b) => {
    b.box({ size: [0.2, 0.075, 0.13], at: [0, 0.0375, 0], ...wood(mix(WOOD, WOOD_PANEL, 0.4), 0.06) });
    for (let i = 0; i < 4; i++)
      b.box({ size: [0.16, 0.085, 0.006], at: [rng.jitter(0.008), 0.075, -0.04 + i * 0.027], rot: [rng.jitter(7), 0, 0], color: i === 2 ? mix(P.crimsonFaded, P.paper, 0.3) : shade(P.paper, 1 + rng.jitter(0.05)) });
  });

  // sign behind the host; its posts carry the awning booms
  const zS = -1.05;
  const f = signFrame(g, rng, { width: 2.3, z: zS, rag: 1 });
  const zTip = 0.2,
    yRear = 2.19,
    yTip = 2.05;
  for (const s of [-1, 1]) {
    const x = s * (2.3 / 2 + 0.16);
    g.tube(
      [
        [x, yRear + 0.02, zS - 0.14],
        [x + s * 0.02, yTip, zTip + 0.06],
      ],
      { radius: 0.034, sides: 6, ...wood(mix(WOOD, WOOD_DARK, 0.2), 0.06) },
    );
    g.cylinder({ height: 0.09, radius: 0.07, sides: 6, at: [x, yRear + 0.005, zS], color: ROPE, vary: 0.06 });
    // stay rope from the post top to the boom tip
    g.tube(
      [
        [x, f.postTop - 0.06, zS + 0.03],
        [x + s * 0.02, yTip + 0.03, zTip],
      ],
      { radius: 0.009, sides: 4, color: ROPE, vary: 0.05 },
    );
  }
  const aw = 2.3 + 0.26,
    ad = zTip - (zS + 0.04);
  const slope = (yRear - yTip) / ad;
  const sagA = 0.1;
  g.cloth({
    size: [aw, ad],
    seg: [8, 4],
    pin: "x",
    sag: sagA,
    noise: 0.012,
    tear: 0.3,
    tearEdges: "+z",
    patches: 2,
    patchColor: [TARP_WORN, mix(TARP_WORN, P.wornDark, 0.45)],
    displace: (_x, z) => -slope * z,
    at: [0, (yRear + yTip) / 2 + 0.035, (zS + 0.04 + zTip) / 2],
    color: (fc) => (fc.center[0] < -0.45 ? shade(mix(TARP, P.crimson, 0.3), 0.92) : fc.center[0] > 0.7 ? mix(TARP, P.worn, 0.12) : TARP),
    vary: 0.05,
  });
  // tatters hanging from the front edge
  for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7;
    const x = -aw / 2 + aw * u + rng.jitter(0.05);
    const y = yTip + 0.035 - sagA * (1 - (2 * u - 1) ** 2);
    const w = rng.range(0.09, 0.2),
      len = rng.range(0.07, 0.2);
    g.quad([x - w / 2, y, zTip], [x - w / 2 + rng.jitter(0.02), y - len, zTip + 0.02], [x + w / 2 + rng.jitter(0.02), y - len * rng.range(0.5, 1), zTip + 0.02], [x + w / 2, y, zTip], {
      mat: "cloth",
      color: shade(i % 3 === 1 ? TARP_WORN : TARP, 1 + rng.jitter(0.06)),
    });
  }

  m.anchor("host", [0, 0, -0.62]);
  m.anchor("lantern", [-0.74, H, 0.14]);
  m.anchor("counter_top", [0, H, zc]);
  m.anchor("board_center", [0, f.faces[0].center[1], zS]);
  m.meta = {
    sign: signMeta(f),
    counter: { width: W, depth: D, height: H, centerZ: zc },
    awning: { front: zTip, rear: zS + 0.04, height: [yTip, yRear] },
    postColliders: postColliders(f),
  };
  return m;
}

function stallApparel(): Model {
  const name = "tl_furn_stall_apparel_v01";
  const m = new Model(name, {
    budget: 1500,
    notes:
      "Apparel stall, faces +Z: plank counter 1.9 x 0.7 x 0.9 m with a worn-white runner, three stacks of folded " +
      "clothes and a small keyboard; behind it (z = -1.15) the stall sign whose posts also carry a clothes rail " +
      "with four plain garments on wooden hangers (crimson jersey, worn-white tee with black sleeves, black tee, " +
      "faded crimson tee: no logos, no text); a cross-pole stand with a display jersey at the left end and a crate of " +
      "folded stock at the right. Anchors: host, counter_top. meta.sign as on tl_sign_stall_*; meta.postColliders = the " +
      "two sign posts (the placement table adds one convex footprint around counter + host). Pivot = counter centre.",
  });
  const g = m.geo;
  const rng = new Rng(`${name}/shape`);
  const H = 0.9,
    W = 1.9,
    D = 0.7,
    zc = 0.03;
  stallCounter(g, rng, { width: W, depth: D, height: H, zc });
  clothRunner(g, rng, { x: -0.3, width: 0.66, top: H, zFront: zc + D / 2, lay: 0.24, drop: 0.42, color: mix(P.charcoal, P.earth, 0.25), patch: mix(P.worn, P.wornDark, 0.3) });

  const red = mix(P.crimson, P.crimsonFaded, 0.3),
    faded = mix(P.crimsonFaded, P.worn, 0.18),
    white = mix(P.worn, P.white, 0.5),
    black = mix(P.black, P.charcoal, 0.4);
  foldedStack(g, rng, [-0.62, H + 0.006, 0.0], [red, white, black]);
  foldedStack(g, rng, [0.56, H, -0.06], [white, red, white, faded]);
  foldedStack(g, rng, [0.6, H, 0.19], [black, red], [0.26, 0.18]);
  // small keyboard (the shop's hand-held prop): dark slab, lighter key rows
  g.group({ at: [0.08, H, 0.14], rot: [0, -8, 0] }, (b) => {
    b.box({ size: [0.36, 0.022, 0.125], at: [0, 0.011, 0], color: P.charcoal, vary: 0.04 });
    for (let r = 0; r < 3; r++) {
      const z = -0.04 + r * 0.036;
      b.quad([-0.165, 0.0235, z], [-0.165, 0.0235, z + 0.024], [0.165 - r * 0.02, 0.0235, z + 0.024], [0.165 - r * 0.02, 0.0235, z], { color: mix(P.metalDark, P.plastic, 0.3 + r * 0.08) });
    }
  });

  // sign + clothes rail on the same posts
  const zS = -1.15;
  const f = signFrame(g, rng, { width: 2.3, z: zS, rag: -1 });
  const xp = 2.3 / 2 + 0.16;
  const railY = 1.86,
    railZ = zS + 0.085;
  const railAt = (x: number): Vec3 => [x, railY - 0.03 * (1 - (x / xp) ** 2) + (x / xp) * 0.012, railZ];
  g.tube([railAt(-xp - 0.12), railAt(0), railAt(xp + 0.1)], { radius: 0.028, sides: 6, ...wood(mix(WOOD_TOP, WOOD, 0.5), 0.06) });
  for (const s of [-1, 1]) g.cylinder({ height: 0.09, radius: 0.07, sides: 6, at: [s * xp, railY, zS + 0.02], color: ROPE, vary: 0.06 });
  const rack: { x: number; body: Color; sleeves?: Color; sides?: Color; band?: Color }[] = [
    { x: -0.86, body: red, sides: P.worn },
    { x: -0.29, body: white, sleeves: black, band: red },
    { x: 0.29, body: black, sleeves: red },
    { x: 0.86, body: faded, sleeves: white },
  ];
  for (const it of rack) {
    const p = railAt(it.x);
    const yaw = rng.jitter(11),
      roll = rng.jitter(3);
    g.group({ at: [p[0], p[1] - 0.028, p[2]], rot: [0, yaw, roll] }, (b) => {
      // hanger: hook + shoulder bar
      b.tube(
        [
          [0, 0.03, 0],
          [0, -0.05, 0],
        ],
        { radius: 0.008, sides: 4, color: P.metalDark },
      );
      b.tube(
        [
          [-0.2, -0.085, 0],
          [0, -0.05, 0],
          [0.2, -0.085, 0],
        ],
        { radius: 0.012, sides: 4, ...wood(WOOD_TOP, 0.05) },
      );
      b.group({ at: [0, -0.062, 0.014], rot: [-3, 0, 0] }, (c) => garment(c, it));
    });
  }

  // display stand at the left end: cross foot, pole, shoulder bar with a jersey
  g.group({ at: [-1.32, 0, 0.3], rot: [0, 22, 0] }, (b) => {
    const st = wood(mix(WOOD, WOOD_DARK, 0.25), 0.06);
    bar(b, [-0.24, 0.03, 0], [0.24, 0.03, 0], 0.055, st);
    bar(b, [0, 0.035, -0.22], [0, 0.035, 0.22], 0.055, st);
    pole(b, [0, 0.05, 0], [0.01, 1.5, 0], [0.034, 0.028], st, 6, 20);
    bar(b, [-0.2, 1.41, 0], [0.2, 1.41, 0], 0.04, st);
    b.group({ at: [0, 1.435, 0.03] }, (c) => garment(c, { body: red, sleeves: black, sides: P.worn }));
    b.group({ at: [0, 1.435, -0.03], rot: [0, 180, 0] }, (c) => garment(c, { body: shade(red, 0.9), sleeves: black }));
  });
  // crate of stock at the right end
  g.group({ at: [1.3, 0, 0.12], rot: [0, -14, 0] }, (b) => {
    const cw = 0.5,
      ch = 0.44,
      cd = 0.42;
    for (let k = 0; k < 3; k++)
      b.box({ size: [cw - (k === 1 ? 0.05 : 0.04), ch / 3, cd - (k === 1 ? 0.05 : 0.04)], at: [0, ch / 6 + (k * ch) / 3, 0], ...wood(shade(WOOD_PANEL, 1 + rng.jitter(0.08)), 0.05) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box({ size: [0.06, ch + 0.01, 0.06], at: [sx * (cw / 2 - 0.03), (ch + 0.01) / 2, sz * (cd / 2 - 0.03)], ...wood(mix(WOOD_TOP, WOOD, 0.35), 0.06) });
    foldedStack(b, rng, [-0.04, ch, 0.0], [faded, white, red], [0.34, 0.26]);
  });

  m.anchor("host", [0, 0, -0.6]);
  m.anchor("counter_top", [0, H, zc]);
  m.anchor("board_center", [0, f.faces[0].center[1], zS]);
  m.meta = {
    sign: signMeta(f),
    counter: { width: W, depth: D, height: H, centerZ: zc },
    postColliders: postColliders(f),
  };
  return m;
}

/* =========================================================================================
 * Group entry
 * ========================================================================================= */

export default function build(): Model[] {
  return [
    stoolRound(),
    stoolSquare(),
    table("tl_furn_table_v01", 1.5, 0.7, 0.75, {
      budget: 400,
      planks: 3,
      longStretcher: true,
      notes: "Rough plank table 1.5 x 0.7 x 0.75 m (04 TABLE, 02 living corner): 3 top planks, end battens, 4 thick legs, H stretchers.",
    }),
    table("tl_furn_table_low_v01", 1.0, 0.52, 0.46, {
      budget: 350,
      planks: 2,
      longStretcher: false,
      notes: "Low plank table 1.0 x 0.52 x 0.46 m for cups / noodles near the campfire (04 main scene).",
    }),
    crate("tl_furn_crate_small_v01", [0.6, 0.6, 0.6], {
      budget: 400,
      frame: 0.075,
      lidPlanks: 3,
      notes: "Small wooden crate 0.6 m cube: corner posts, rails, diagonal brace on every side, plank lid. Seat / TV stand / side table.",
    }),
    crate("tl_furn_crate_large_v01", [0.9, 0.8, 0.8], {
      budget: 500,
      frame: 0.09,
      lidPlanks: 4,
      xBrace: true,
      notes: "Large wooden crate 0.9 x 0.8 x 0.8 m: X brace front/back, diagonal on the sides, plank lid. TV stand / storage.",
    }),
    pallet(),
    memoryBoard(),
    quizBoard(),
    entranceSign(),
    entranceSignStanding(),
    tarpShelter(),
    clothesline(),
    ropeCordon(),
    rugWorn(),
    stallSign("tl_sign_stall_v01", 2.3, -1),
    stallSign("tl_sign_stall_wide_v01", 3.0, 1),
    caveGate(),
    wallScreen(WALL_SCREEN),
    questBoard(),
    stallCheckin(),
    stallApparel(),
  ];
}
