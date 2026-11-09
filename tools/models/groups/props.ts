/**
 * Props group — small props, tenure-rank props and the CRT TV for "Hang trú thua" (concept v3).
 *
 * References: design/concepts/v3/04-props.png (prop catalog: TV DEFEAT, kettle, noodle cup,
 * wheelchair, oxygen cylinder, metal bed, blanket), 03-tenure.png (rank 02 wheelchair, rank 03
 * oxygen chair + green cylinder + hose, rank 04 metal bed + phone), 02-memory-wall.png (minigame
 * corner gamepad, living-corner mugs).
 *
 * Conventions: metres, Y up, models face +Z (left = +X), pivot bottom centre. One shared matte
 * material (+ tl_cloth for blankets, tl_glow for the TV screen / phone screen / LED).
 * Everything is deterministic (builder rng + forks of the model rng).
 */
import {
  Model,
  MeshBuilder,
  PALETTE as P,
  Rng,
  arcPoints,
  mix,
  shade,
  type Color,
  type MatKind,
  type PrimOpts,
  type Vec2,
  type Vec3,
} from "../lib.js";

/* =========================================================================================
 * Local helpers
 * ========================================================================================= */

const DEG = Math.PI / 180;
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const centroid = (pts: Vec3[]): Vec3 => scl3(pts.reduce<Vec3>((s, p) => add3(s, p), [0, 0, 0]), 1 / pts.length);

/** Newell normal (right-hand rule). */
function newell(pts: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** Convex planar polygon whose front side faces `out` (winding fixed automatically). */
function face(b: MeshBuilder, pts: Vec3[], out: Vec3, o: PrimOpts = {}): void {
  b.poly(dot3(newell(pts), out) >= 0 ? pts : [...pts].reverse(), o);
}

/** Two unit tangents spanning the plane perpendicular to n (t1 horizontal when possible). */
function tangents(n: Vec3): [Vec3, Vec3] {
  const up: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = norm3(cross3(up, n));
  return [t1, cross3(n, t1)];
}

/**
 * Small flat decal quad (rust spot, patch, sticker) centred at c on a surface with normal n,
 * lifted 2 mm off the surface. w along tangent 1, h along tangent 2. jit = corner jitter.
 */
function decal(b: MeshBuilder, c: Vec3, n: Vec3, w: number, h: number, o: PrimOpts, rng?: Rng, jit = 0, lift = 0.002) {
  const nn = norm3(n);
  const [t1, t2] = tangents(nn);
  const base = add3(c, scl3(nn, lift));
  const pts = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([a, d]) => {
    const ja = rng ? rng.jitter(jit) : 0;
    const jd = rng ? rng.jitter(jit) : 0;
    return add3(base, add3(scl3(t1, ((a * w) / 2) * (1 + ja)), scl3(t2, ((d * h) / 2) * (1 + jd))));
  });
  face(b, pts, nn, o);
}

interface LatheOpts {
  sides: number;
  /** Rotation of the polygon in degrees (0 = first vertex on +X, angles grow toward +Z). */
  phase?: number;
  at?: Vec3;
  color: Color | ((band: number, side: number, center: Vec3) => Color);
  vary?: number;
  mat?: MatKind;
  glow?: number;
  /** Radial multiplier per (ring, side) for dents. */
  dent?: (ring: number, side: number) => number;
}

/**
 * Surface of revolution around Y. The profile [r, y] is walked with the solid on the left:
 * bottom centre -> outward -> up the outside -> (over a rim and down an inner wall) -> centre.
 * Flat bands touching the axis become single polygons (caps). Band i = profile[i]..profile[i+1].
 */
function lathe(b: MeshBuilder, profile: Vec2[], o: LatheOpts): void {
  const n = o.sides;
  const ph = (o.phase ?? 0) * DEG;
  const [ox, oy, oz] = o.at ?? [0, 0, 0];
  const rings = profile.map(([r, y], i) =>
    Array.from({ length: n }, (_, k) => {
      const a = ph + (k * 2 * Math.PI) / n;
      const d = r > 1e-9 && o.dent ? o.dent(i, k) : 1;
      return [ox + Math.cos(a) * r * d, oy + y, oz + Math.sin(a) * r * d] as Vec3;
    }),
  );
  const style = (band: number, side: number, pts: Vec3[]): PrimOpts => ({
    color: typeof o.color === "function" ? o.color(band, side, centroid(pts)) : o.color,
    vary: o.vary,
    mat: o.mat,
    glow: o.glow,
  });
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (r0 < 1e-9 && r1 < 1e-9) continue;
    if (Math.abs(y1 - y0) < 1e-9 && (r0 < 1e-9 || r1 < 1e-9)) {
      const pts = (r0 < 1e-9 ? rings[i + 1] : rings[i]).slice();
      face(b, pts, [0, r1 < r0 ? 1 : -1, 0], style(i, -1, pts));
      continue;
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const A = rings[i][k];
      const B = rings[i + 1][k];
      const C = rings[i + 1][k1];
      const D = rings[i][k1];
      const pts = r0 < 1e-9 ? [A, B, C] : r1 < 1e-9 ? [A, B, D] : [A, B, C, D];
      b.poly(pts, style(i, k, pts));
    }
  }
}

interface SheetOpts {
  /** Colour of cell (i, j); null = hole. */
  color: (i: number, j: number) => Color | null;
  /** 0 / 1 keeps only one triangle of the cell (ragged edges). */
  half?: (i: number, j: number) => 0 | 1 | undefined;
  vary?: number;
  mat?: MatKind;
  /** Reverse the winding (front = dv x du instead of du x dv). */
  flip?: boolean;
}

/** Parametric sheet (blankets, drapes, screens): pos(u, v) with u, v in 0..1, nu x nv cells. */
function sheet(b: MeshBuilder, nu: number, nv: number, pos: (u: number, v: number) => Vec3, o: SheetOpts): void {
  const G: Vec3[][] = [];
  for (let i = 0; i <= nu; i++) {
    const row: Vec3[] = [];
    for (let j = 0; j <= nv; j++) row.push(pos(i / nu, j / nv));
    G.push(row);
  }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const c = o.color(i, j);
      if (!c) continue;
      let q: Vec3[] = [G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]];
      if (o.flip) q = q.reverse();
      const st: PrimOpts = { color: c, vary: o.vary, mat: o.mat ?? "cloth" };
      const h = o.half?.(i, j);
      if (h === 0) b.tri(q[0], q[1], q[2], st);
      else if (h === 1) b.tri(q[0], q[2], q[3], st);
      else b.poly(q, st);
    }
}

/** Catmull-Rom resampling of a control polyline (per = points per span). */
function catmull(ctrl: Vec3[], per: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        [0, 1, 2].map(
          (k) =>
            0.5 *
            (2 * p1[k] +
              (-p0[k] + p2[k]) * t +
              (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
              (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
        ) as Vec3,
      );
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** Straight axis-aligned square bar (for rust spots): centre line a..b, half width hw. */
interface Bar {
  a: Vec3;
  b: Vec3;
  hw: number;
}

/** Rust / wear spots scattered on the visible faces of square bars. */
function barSpots(g: MeshBuilder, bars: Bar[], count: number, rng: Rng, colors: Color[]): void {
  const dirs: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let i = 0; i < count; i++) {
    const bar = bars[rng.int(0, bars.length - 1)];
    const axis = norm3(sub3(bar.b, bar.a));
    const cands = dirs.filter((n) => Math.abs(dot3(n, axis)) < 0.1);
    const n = cands[rng.int(0, cands.length - 1)];
    const len = len3(sub3(bar.b, bar.a));
    const along = Math.min(len * 0.6, rng.range(0.03, 0.08));
    const t = rng.range(0.08 + along / len / 2, 0.92 - along / len / 2);
    const c = add3(lerp3(bar.a, bar.b, t), scl3(n, bar.hw));
    const across = Math.min(bar.hw * 1.5, rng.range(0.016, 0.03));
    const [t1] = tangents(n);
    const alongT1 = Math.abs(dot3(t1, axis)) > 0.5;
    decal(g, c, n, alongT1 ? along : across, alongT1 ? across : along, { color: rng.pick(colors) }, rng, 0.22);
  }
}

/** Square-bar tube (4 sides, axis aligned) radius for a given half width. */
const sq = (hw: number) => hw * Math.SQRT2;

/* =========================================================================================
 * TV — chunky CRT with inset emissive DEFEAT screen (04 catalog, 02 minigame corner, 01)
 * ========================================================================================= */

function buildTv(): Model {
  const m = new Model("tl_prop_tv_crt_v01", {
    budget: 500,
    notes:
      "Chunky old CRT TV: 0.60 W x 0.49 H body (0.80 H with antennas) x 0.48 D. Inset emissive screen (tl_glow, dim grey " +
      "static) with DEFEAT in pixel letters (red-tinted white) and a red underline. Screen faces +Z. Pivot bottom centre: " +
      "stand it on a crate.",
  });
  const g = m.geo;
  const C = {
    body: "#3E3733",
    top: "#4B433E",
    dark: "#2B2624",
    bezel: "#443C37",
    bezelEdge: "#514842",
    recess: "#1B1817",
    plinth: "#231F1D",
    screen: "#4C5254",
    text: "#F6E0D8",
    shadow: "#22272A",
    red: "#D8454C",
    knob: "#1E1C1B",
    knobTop: "#3B3532",
    led: "#FF5838",
    vent: "#1C1918",
    antenna: "#8E8B87",
  };
  const hx = 0.3;
  const y0 = 0.03;
  const y1 = 0.49;
  const zB = 0.03;
  const zF = 0.24;
  const bev = 0.026;
  const zBev = zF - 0.022;

  // Front shell sides (front opening is closed by the bevel + bezel ring).
  face(g, [[-hx, y0, zB], [hx, y0, zB], [hx, y0, zBev], [-hx, y0, zBev]], [0, -1, 0], { color: C.dark });
  face(g, [[-hx, y1, zB], [hx, y1, zB], [hx, y1, zBev], [-hx, y1, zBev]], [0, 1, 0], { color: C.top });
  for (const s of [1, -1])
    face(g, [[s * hx, y0, zB], [s * hx, y1, zB], [s * hx, y1, zBev], [s * hx, y0, zBev]], [s, 0, 0], { color: C.body });
  face(g, [[-hx, y0, zB], [hx, y0, zB], [hx, y1, zB], [-hx, y1, zB]], [0, 0, -1], { color: C.dark });

  // Chunky rounded-looking bevel around the front.
  const ix = hx - bev;
  const iy0 = y0 + bev;
  const iy1 = y1 - bev;
  face(g, [[-hx, y0, zBev], [hx, y0, zBev], [ix, iy0, zF], [-ix, iy0, zF]], [0, -1, 1], { color: C.body });
  face(g, [[-hx, y1, zBev], [hx, y1, zBev], [ix, iy1, zF], [-ix, iy1, zF]], [0, 1, 1], { color: C.bezelEdge });
  for (const s of [1, -1])
    face(g, [[s * hx, y0, zBev], [s * hx, y1, zBev], [s * ix, iy1, zF], [s * ix, iy0, zF]], [s, 0, 1], { color: C.bezelEdge });

  // Bezel ring around the screen opening (thicker at the bottom for knobs).
  const sx = 0.226;
  const sy0 = 0.125;
  const sy1 = 0.432;
  face(g, [[-ix, iy0, zF], [ix, iy0, zF], [sx, sy0, zF], [-sx, sy0, zF]], [0, 0, 1], { color: C.bezel });
  face(g, [[-sx, sy1, zF], [sx, sy1, zF], [ix, iy1, zF], [-ix, iy1, zF]], [0, 0, 1], { color: C.bezel });
  for (const s of [1, -1])
    face(g, [[s * sx, sy0, zF], [s * ix, iy0, zF], [s * ix, iy1, zF], [s * sx, sy1, zF]], [0, 0, 1], { color: C.bezel });

  // Recess walls down to the screen.
  const zS = zF - 0.03;
  const k = 0.014;
  const qx = sx - k;
  const qy0 = sy0 + k;
  const qy1 = sy1 - k;
  face(g, [[-sx, sy0, zF], [sx, sy0, zF], [qx, qy0, zS], [-qx, qy0, zS]], [0, 1, 0.4], { color: shade(C.recess, 1.25) });
  face(g, [[-sx, sy1, zF], [sx, sy1, zF], [qx, qy1, zS], [-qx, qy1, zS]], [0, -1, 0.4], { color: C.recess });
  for (const s of [1, -1])
    face(g, [[s * sx, sy0, zF], [s * sx, sy1, zF], [s * qx, qy1, zS], [s * qx, qy0, zS]], [-s, 0, 0.4], { color: C.recess });

  // Emissive screen: slightly bulged grid of grey "static" cells.
  sheet(
    g,
    6,
    5,
    (u, v) => [lerp(-qx, qx, u), lerp(qy0, qy1, v), zS + 0.012 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)],
    { color: () => C.screen, vary: 0.13, mat: "glow" },
  );

  // DEFEAT (pixel letters) with a dark drop shadow, then the red underline stroke.
  const zT = zS + 0.016;
  const pix = 0.0113;
  const ty = 0.296;
  g.text("DEFEAT", { pixel: pix, at: [0.004, ty - 0.004, zT - 0.0015], color: C.shadow, mat: "glow" });
  g.text("DEFEAT", { pixel: pix, at: [0, ty, zT], color: C.text, mat: "glow" });
  g.extrude(
    [
      [-0.155, -0.01],
      [0.125, 0.002],
      [0.165, 0.014],
      [-0.115, 0.004],
    ],
    { depth: 0, at: [0, 0.236, zT], color: C.red, mat: "glow" },
  );

  // Plinth under the front, tapered tube housing at the back.
  g.box({ size: [0.54, 0.03, 0.2], at: [0, 0.015, 0.135], color: C.plinth });
  g.hull(
    [
      [-0.25, 0.07, 0.035],
      [0.25, 0.07, 0.035],
      [0.25, 0.46, 0.035],
      [-0.25, 0.46, 0.035],
      [-0.17, 0.16, -0.24],
      [0.17, 0.16, -0.24],
      [0.17, 0.42, -0.24],
      [-0.17, 0.42, -0.24],
    ],
    { color: C.body, parts: { top: C.top, bottom: C.dark }, vary: 0.04 },
  );
  const yTop = (z: number) => 0.42 + ((z + 0.24) / 0.275) * 0.04;
  for (let i = 0; i < 4; i++) {
    const z0 = -0.215 + i * 0.035;
    const z1 = z0 + 0.014;
    face(
      g,
      [
        [-0.1, yTop(z0) + 0.002, z0],
        [0.1, yTop(z0) + 0.002, z0],
        [0.1, yTop(z1) + 0.002, z1],
        [-0.1, yTop(z1) + 0.002, z1],
      ],
      [0, 1, 0],
      { color: C.vent },
    );
  }

  // Antennas (V) on a small base.
  const az = -0.075;
  const ay = yTop(az);
  g.box({ size: [0.1, 0.035, 0.07], at: [0, ay + 0.01, az], color: C.dark });
  for (const s of [1, -1]) {
    const base: Vec3 = [s * 0.025, ay + 0.025, az];
    const tip: Vec3 = [s * 0.19, ay + 0.335, az - 0.06];
    g.cylinder({ height: 0.024, radius: 0.012, sides: 6, at: [s * 0.03, ay + 0.03, az], rot: [0, 0, -s * 28], color: C.dark });
    g.tube([base, tip], { radius: 0.0065, sides: 4, color: C.antenna });
    g.icosphere({ radius: 0.011, at: tip, color: shade(C.antenna, 1.1) });
  }

  // Knobs, power LED and speaker slits on the bottom bezel.
  for (const [x, r] of [
    [0.175, 0.016],
    [0.225, 0.013],
  ] as const)
    g.cylinder({ height: 0.016, radius: r, sides: 6, rot: [90, 0, 0], at: [x, 0.087, zF + 0.008], color: C.knob, parts: { top: C.knobTop } });
  g.box({ size: [0.012, 0.012, 0.004], at: [0.126, 0.087, zF + 0.002], color: C.led, mat: "glow" });
  for (let i = 0; i < 3; i++) {
    const y = 0.072 + i * 0.012;
    face(
      g,
      [
        [-0.225, y, zF + 0.002],
        [-0.105, y, zF + 0.002],
        [-0.105, y + 0.005, zF + 0.002],
        [-0.225, y + 0.005, zF + 0.002],
      ],
      [0, 0, 1],
      { color: C.vent },
    );
  }

  // Repair tape across the top bezel (patched TV).
  face(
    g,
    [
      [-0.205, 0.4345, zF + 0.0025],
      [-0.115, 0.4475, zF + 0.0025],
      [-0.117, 0.461, zF + 0.0025],
      [-0.207, 0.448, zF + 0.0025],
    ],
    [0, 0, 1],
    { color: "#A99272" },
  );
  m.anchor("screen_center", [0, 0.28, zS + 0.012]);
  m.anchor("antenna_base", [0, ay + 0.025, az]);
  m.light({ name: "tv_screen", at: [0, 0.3, 0.6], color: "#B4C4CE", intensity: 0.7, range: 3 });
  m.collider = { type: "box", center: [0, 0.245, 0], size: [0.6, 0.49, 0.48] };
  m.meta = { screenGlowMaterial: "tl_glow", flicker: "animate emissiveIntensity 0.85..1.1 for CRT shimmer" };
  return m;
}

/* =========================================================================================
 * Kettle — dented faceted metal kettle (04 catalog)
 * ========================================================================================= */

function buildKettle(): Model {
  const m = new Model("tl_prop_kettle_v01", {
    budget: 500,
    notes: "Dented low-poly metal kettle: body 0.23 m wide, 0.25 m tall with the arched handle; spout points -X. Pivot bottom centre.",
  });
  const g = m.geo;
  const rng = m.rng.fork("dents");
  const C = { metal: "#67605A", metalTop: "#77706A", lid: "#5E5751", dark: "#3A3431", bottom: "#2A2522", grip: "#2A2422" };
  const prof: Vec2[] = [
    [0, 0],
    [0.104, 0],
    [0.117, 0.016],
    [0.12, 0.062],
    [0.106, 0.104],
    [0.068, 0.134],
    [0.072, 0.14],
    [0.064, 0.151],
    [0.034, 0.165],
    [0, 0.168],
  ];
  lathe(g, prof, {
    sides: 8,
    phase: 22.5,
    dent: (ring, side) => (ring >= 2 && ring <= 4 ? 1 + rng.jitter(0.03) - (ring === 3 && side === 5 ? 0.1 : 0) : 1),
    color: (band) =>
      band === 0 ? C.bottom : band === 1 ? mix(C.metal, C.bottom, 0.55) : band === 4 ? C.metalTop : band >= 5 ? C.lid : C.metal,
    vary: 0.07,
  });
  g.cylinder({ height: 0.02, radius: 0.011, sides: 6, at: [0, 0.176, 0], color: C.dark });
  g.cylinder({ height: 0.013, radiusBottom: 0.021, radiusTop: 0.015, sides: 6, at: [0, 0.19, 0], color: C.dark });
  g.tube(
    [
      [-0.09, 0.04, 0],
      [-0.14, 0.078, 0],
      [-0.176, 0.124, 0],
      [-0.192, 0.148, 0],
    ],
    { radius: [0.034, 0.022, 0.015, 0.0125], sides: 6, color: C.metal, parts: { cap: C.bottom }, vary: 0.06 },
  );
  g.tube(
    [
      [-0.08, 0.12, 0],
      [-0.08, 0.2, 0],
      [-0.05, 0.24, 0],
      [0.05, 0.24, 0],
      [0.08, 0.2, 0],
      [0.08, 0.12, 0],
    ],
    { radius: 0.011, sides: 5, color: C.dark, vary: 0.05 },
  );
  g.tube(
    [
      [-0.045, 0.241, 0],
      [0.045, 0.241, 0],
    ],
    { radius: 0.018, sides: 6, color: C.grip },
  );
  for (const s of [1, -1]) g.box({ size: [0.03, 0.022, 0.032], at: [s * 0.08, 0.125, 0], color: C.dark });
  m.anchor("handle", [0, 0.241, 0]);
  m.anchor("spout", [-0.192, 0.148, 0]);
  return m;
}

/* =========================================================================================
 * Noodle cup — white/red paper cup with chopsticks (04 catalog)
 * ========================================================================================= */

function buildNoodleCup(): Model {
  const m = new Model("tl_prop_noodle_cup_v01", {
    budget: 500,
    notes: "Instant-noodle paper cup, 0.11 m tall (0.25 m with chopsticks); red band + red label facing +Z / -X. Pivot bottom centre.",
  });
  const g = m.geo;
  const C = {
    paper: "#DDD4C4",
    red: "#B12E38",
    inner: "#CDBFA8",
    broth: "#C3843C",
    noodle: "#E3C47A",
    chop: "#9C6C43",
    bottom: "#B5AA97",
  };
  const prof: Vec2[] = [
    [0, 0],
    [0.036, 0],
    [0.039, 0.025],
    [0.044, 0.075],
    [0.046, 0.084],
    [0.048, 0.097],
    [0.049, 0.104],
    [0.053, 0.105],
    [0.053, 0.113],
    [0.047, 0.113],
    [0.0455, 0.093],
    [0, 0.093],
  ];
  lathe(g, prof, {
    sides: 10,
    color: (band, k) =>
      band === 0
        ? C.bottom
        : band === 4
          ? C.red
          : band === 2 && (k === 2 || k === 3)
            ? C.red
            : band === 9
              ? C.inner
              : band === 10
                ? C.broth
                : C.paper,
    vary: 0.035,
  });
  g.icosphere({ size: [0.05, 0.014, 0.04], at: [-0.008, 0.095, 0.008], color: C.noodle, vary: 0.08 });
  // Peeled paper lid standing up at the back (-Z, toward -X so it clears the chopsticks).
  const lid: Vec3[] = [
    [-0.048, 0.113, -0.018],
    [0.012, 0.113, -0.05],
    [0.0, 0.15, -0.075],
    [-0.035, 0.168, -0.072],
    [-0.062, 0.15, -0.05],
  ];
  face(g, lid, [0, 0.4, 1], { color: "#E0D7C4", mat: "cloth" });
  const ln = norm3(newell(lid));
  const lift = (p: Vec3) => add3(p, scl3(ln, dot3(ln, [0, 0.4, 1]) > 0 ? 0.0025 : -0.0025));
  const [A, B, Cc, , E] = lid;
  face(g, [lerp3(A, E, 0.55), lerp3(B, Cc, 0.55), lerp3(B, Cc, 0.8), lerp3(A, E, 0.8)].map(lift), [0, 0.4, 1], {
    color: C.red,
    mat: "cloth",
  });
  for (const [dx, dz] of [
    [0, 0],
    [0.013, -0.007],
  ] as const)
    g.tube(
      [
        [0.004 + dx, 0.07, -0.012 + dz],
        [0.068 + dx * 1.6, 0.25, -0.046 + dz * 2],
      ],
      { radius: [0.0055, 0.0038], sides: 4, color: C.chop, vary: 0.05 },
    );
  m.anchor("grip", [0, 0.06, 0]);
  return m;
}

/* =========================================================================================
 * Mugs — enamel camp mugs (03 tenure scene, 02 living corner)
 * ========================================================================================= */

function buildMug(variant: "white" | "red"): Model {
  const white = variant === "white";
  const m = new Model(`tl_prop_mug_${variant}_v01`, {
    budget: 500,
    notes: white
      ? "White enamel camp mug with dark rim, coffee inside; 0.095 m tall, handle on +X. Pivot bottom centre."
      : "Faded-red enamel camp mug with chipped white rim, tea inside; 0.095 m tall, handle on +X. Pivot bottom centre.",
  });
  const g = m.geo;
  const body = white ? "#D6D0C4" : "#8A2F36";
  const rim = white ? "#3A3E44" : "#D8CFBF";
  const inner = white ? "#CFC8BA" : "#D3C9B8";
  const drink = white ? "#3A2618" : "#6B4423";
  const prof: Vec2[] = [
    [0, 0],
    [0.038, 0],
    [0.041, 0.005],
    [0.043, 0.085],
    [0.044, 0.09],
    [0.044, 0.095],
    [0.039, 0.095],
    [0.0385, 0.085],
    [0.038, 0.072],
    [0, 0.072],
  ];
  lathe(g, prof, {
    sides: 10,
    phase: 18,
    color: (band) => (band === 0 ? shade(body, 0.7) : band <= 2 ? body : band <= 6 ? rim : band === 7 ? inner : drink),
    vary: 0.05,
  });
  g.tube(
    [
      [0.04, 0.075, 0],
      [0.064, 0.073, 0],
      [0.072, 0.052, 0],
      [0.066, 0.03, 0],
      [0.04, 0.026, 0],
    ],
    { radius: 0.0062, sides: 5, caps: false, color: body, vary: 0.05 },
  );
  if (!white) {
    // Enamel chips on the red mug.
    const rng = m.rng.fork("chips");
    for (const a of [40, 200, 300]) {
      const ar = a * DEG;
      const n: Vec3 = [Math.cos(ar), 0, Math.sin(ar)];
      decal(g, [0.0425 * n[0], rng.range(0.03, 0.07), 0.0425 * n[2]], n, 0.012, 0.009, { color: "#2B2522" }, rng, 0.3, 0.001);
    }
  }
  m.anchor("handle", [0.072, 0.052, 0]);
  return m;
}

/* =========================================================================================
 * Metal bed — rank 04 (03 tenure panel, 04 catalog)
 * ========================================================================================= */

function buildBed(): Model {
  const m = new Model("tl_veh_metal_bed_v01", {
    budget: 2000,
    notes:
      "Rank 04 metal bed 0.90 W x 0.65 H x 2.00 D: off-white square-tube frame with rust spots, mattress (top 0.41 m), pillow " +
      "at the headboard (-Z) and a patched faded-crimson blanket (node 'blanket', tl_cloth) draped over both sides. " +
      "Character lies on its back, head toward -Z, feet toward +Z (the bed's forward).",
  });
  const g = m.geo;
  const rng = m.rng.fork("bed");
  const C = {
    frame: "#ADA9A1",
    frameShade: "#99958E",
    foot: "#2A2624",
    mattress: "#B9B1A0",
    mattressSide: "#9C9282",
    pillow: "#CFC9BC",
    rust: ["#80492E", "#6E432F", "#93603F"],
  };
  const hw = 0.021; // post half width
  const px = 0.45 - hw;
  const pz = 1.0 - hw;
  const bars: Bar[] = [];
  const end = (z: number, top: number, cross: number) => {
    const rc = 0.07;
    const yc = top - hw - rc;
    const path: Vec3[] = [
      [-px, 0.022, z],
      ...arcPoints(rc, 180, 90, 3, "xy", [-px + rc, yc, z]),
      ...arcPoints(rc, 90, 0, 3, "xy", [px - rc, yc, z]),
      [px, 0.022, z],
    ];
    g.tube(path, { radius: sq(hw), sides: 4, phase: 45, color: C.frame, vary: 0.04 });
    bars.push({ a: [-px, 0.03, z], b: [-px, yc, z], hw }, { a: [px, 0.03, z], b: [px, yc, z], hw });
    bars.push({ a: [-px + rc, top - hw, z], b: [px - rc, top - hw, z], hw });
    const chw = 0.016;
    g.tube(
      [
        [-px, cross, z],
        [px, cross, z],
      ],
      { radius: sq(chw), sides: 4, phase: 45, color: C.frameShade, vary: 0.04 },
    );
    bars.push({ a: [-px, cross, z], b: [px, cross, z], hw: chw });
    for (const x of [-0.27, -0.09, 0.09, 0.27]) {
      g.tube(
        [
          [x, cross, z],
          [x, top - hw, z],
        ],
        { radius: sq(0.013), sides: 4, phase: 45, color: C.frame, vary: 0.05 },
      );
    }
    // Rubber feet.
    for (const x of [-px, px]) g.box({ size: [0.05, 0.022, 0.05], at: [x, 0.011, z], color: C.foot });
  };
  end(-pz, 0.65, 0.3);
  end(pz, 0.54, 0.3);
  // Side rails.
  const shw = 0.017;
  for (const s of [1, -1]) {
    g.tube(
      [
        [s * px, 0.27, -pz],
        [s * px, 0.27, pz],
      ],
      { radius: sq(shw), sides: 4, phase: 45, color: C.frameShade, vary: 0.04 },
    );
    bars.push({ a: [s * px, 0.27, -pz], b: [s * px, 0.27, pz], hw: shw });
  }
  barSpots(g, bars, 30, rng, C.rust);

  // Mattress + pillow.
  g.box({
    size: [0.84, 0.13, 1.9],
    at: [0, 0.345, 0],
    chamfer: 0.03,
    color: C.mattressSide,
    parts: { top: C.mattress, bevel: mix(C.mattress, C.mattressSide, 0.5) },
    vary: 0.04,
  });
  g.box({ size: [0.6, 0.12, 0.32], at: [0, 0.47, -0.76], rot: [16, 0, 0], chamfer: 0.045, color: C.pillow, vary: 0.05 });

  // Blanket: draped cross-section, bulged where the body lies, ragged hem, sewn patches.
  const bl = m.node("blanket");
  const cs: Vec2[] = [
    [-0.452, 0.31],
    [-0.446, 0.37],
    [-0.436, 0.417],
    [-0.34, 0.431],
    [-0.2, 0.453],
    [-0.07, 0.468],
    [0.07, 0.468],
    [0.2, 0.453],
    [0.34, 0.431],
    [0.436, 0.417],
    [0.448, 0.35],
    [0.457, 0.27],
    [0.463, 0.19],
  ];
  const nu = cs.length - 1;
  const nv = 9;
  const zA = -0.4;
  const zZ = 0.93;
  const flatY = 0.418;
  const brng = m.rng.fork("blanket");
  const jit = Array.from({ length: (nu + 1) * (nv + 1) }, () => [brng.jitter(0.007), brng.jitter(0.008)] as const);
  const pos = (u: number, v: number): Vec3 => {
    const i = Math.round(u * nu);
    const j = Math.round(v * nv);
    let [x, y] = cs[i];
    const top = Math.abs(x) < 0.437;
    if (top) {
      const bulge = smooth(0.0, 0.3, v) * (1 - smooth(0.72, 1.0, v));
      y = flatY + (y - flatY) * (0.25 + 0.75 * bulge);
    } else {
      const hang = 0.82 + 0.18 * Math.sin(v * 8.5 + (x > 0 ? 0.6 : 2.2));
      y = flatY - (flatY - y) * hang;
    }
    const [jx, jy] = jit[i * (nv + 1) + j];
    return top ? [x + jx * 0.4, y + Math.abs(jy) * 0.6, lerp(zA, zZ, v) + jx] : [x + Math.abs(jx) * 0.4, y + jy, lerp(zA, zZ, v)];
  };
  const crim = "#7A3B3E";
  const crimDark = "#633033";
  const tan = "#A3865F";
  const worn = "#BDB29C";
  const patches = new Map<string, Color>([
    ["10,4", tan],
    ["10,5", tan],
    ["11,4", tan],
    ["11,5", tan],
    ["4,6", worn],
    ["5,6", worn],
    ["7,2", tan],
  ]);
  const ragged = new Map<string, 0 | 1 | -1>();
  for (const i of [0, nu - 1])
    for (let j = 0; j < nv; j++) {
      const r = brng.next();
      if (r < 0.14) ragged.set(`${i},${j}`, -1);
      else if (r < 0.45) ragged.set(`${i},${j}`, brng.int(0, 1) as 0 | 1);
    }
  sheet(bl.geo, nu, nv, pos, {
    flip: true,
    vary: 0.05,
    color: (i, j) => (ragged.get(`${i},${j}`) === -1 ? null : (patches.get(`${i},${j}`) ?? (j === 0 ? crimDark : crim))),
    half: (i, j) => {
      const r = ragged.get(`${i},${j}`);
      return r === 0 || r === 1 ? r : undefined;
    },
  });
  // Stitches around the big tan patch on the hanging +X side (bilinear point on the sheet).
  const at = (u: number, v: number): Vec3 => {
    const fu = u * nu;
    const fv = v * nv;
    const i0 = Math.min(nu - 1, Math.floor(fu));
    const j0 = Math.min(nv - 1, Math.floor(fv));
    const tu = fu - i0;
    const tv = fv - j0;
    const p = (i: number, j: number) => pos(i / nu, j / nv);
    return lerp3(lerp3(p(i0, j0), p(i0 + 1, j0), tu), lerp3(p(i0, j0 + 1), p(i0 + 1, j0 + 1), tu), tv);
  };
  const thread = "#2E2320";
  for (const fv of [4.3, 5, 5.7]) decal(bl.geo, at(10 / nu, fv / nv), [1, 0, 0], 0.004, 0.032, { color: thread, mat: "cloth" }, undefined, 0, 0.007);
  for (const fv of [4, 6])
    for (const fu of [10.4, 11.2]) decal(bl.geo, at(fu / nu, fv / nv), [1, 0, 0], 0.03, 0.004, { color: thread, mat: "cloth" }, undefined, 0, 0.007);

  m.anchor("mattress_top", [0, 0.41, 0]);
  m.anchor("lie_head", [0, 0.53, -0.72]);
  m.anchor("lie_hips", [0, 0.44, -0.05]);
  m.collider = { type: "box", center: [0, 0.325, 0], size: [0.9, 0.65, 2.0] };
  return m;
}

/* =========================================================================================
 * Bed cover — rank 04 tucked in (03 tenure panel #04: patched crimson blanket up to the chest)
 * ========================================================================================= */

function buildBedCover(): Model {
  const m = new Model("tl_prop_bed_cover_v01", {
    budget: 900,
    notes:
      "ATTACHMENT for tl_veh_metal_bed_v01 (give it the bed's transform; hide the bed's own 'blanket' node): the patched " +
      "faded-crimson blanket draped over a character lying in the bed (pose lie_bed, head toward -Z), from the foot end to " +
      "mid-chest (z -0.46), over the body (~0.24 m above the mattress, a tent over the feet) and hanging down both sides, " +
      "with the worn-white sheet folded back over its top edge.",
  });
  const rng = m.rng.fork("cover");
  const mattress = 0.415;
  // Height of the cover's crest along the bed (z), from the lying fan's profile + 4 cm.
  const crest: Vec2[] = [
    [-0.46, 0.725],
    [-0.3, 0.7],
    [-0.12, 0.655],
    [0.1, 0.645],
    [0.4, 0.625],
    [0.6, 0.64],
    [0.74, 0.72],
    [0.86, 0.73],
    [0.95, 0.6],
  ];
  const crestAt = (z: number) => {
    if (z <= crest[0][0]) return crest[0][1];
    for (let i = 1; i < crest.length; i++)
      if (z <= crest[i][0]) return lerp(crest[i - 1][1], crest[i][1], smooth(crest[i - 1][0], crest[i][0], z));
    return crest[crest.length - 1][1];
  };
  // Cross-section: flat over the body and the arm lying at its side (|x| <= 0.41), then down
  // over the mattress edge and hanging along the frame.
  const xs = [-0.47, -0.466, -0.452, -0.41, -0.3, -0.15, 0, 0.15, 0.3, 0.41, 0.452, 0.466, 0.47];
  const nu = xs.length - 1;
  const nv = 12;
  const z0 = -0.46;
  const z1 = 0.95;
  const jit = Array.from({ length: (nu + 1) * (nv + 1) }, () => [rng.jitter(0.008), rng.jitter(0.01)] as const);
  const pos = (u: number, v: number): Vec3 => {
    const i = Math.round(u * nu);
    const j = Math.round(v * nv);
    const x = xs[i];
    const z = lerp(z0, z1, v);
    const top = crestAt(z);
    const ax = Math.abs(x);
    let y: number;
    if (ax <= 0.3) y = top;
    else if (ax <= 0.41) y = lerp(top, mattress + (top - mattress) * 0.82, (ax - 0.3) / 0.11);
    else if (ax <= 0.452) y = mattress + 0.03;
    else if (ax <= 0.466) y = mattress - 0.06;
    else y = mattress - 0.15 - 0.04 * Math.sin(v * 7.3 + (x > 0 ? 0.4 : 2.0));
    const [jx, jy] = jit[i * (nv + 1) + j];
    return [x + (ax > 0.45 ? Math.abs(jx) * Math.sign(x) * 0.5 : jx * 0.3), y + (ax <= 0.41 ? Math.abs(jy) * 0.5 : jy), z];
  };
  const crim = "#7A3B3E";
  const crimDark = "#633033";
  const tan = "#A3865F";
  const worn = "#BDB29C";
  const patches = new Map<string, Color>([
    ["7,7", tan],
    ["8,7", tan],
    ["7,8", tan],
    ["8,8", tan],
    ["3,4", worn],
    ["4,4", worn],
    ["10,9", tan],
    ["5,10", worn],
  ]);
  const ragged = new Map<string, 0 | 1 | -1>();
  for (const i of [0, nu - 1])
    for (let j = 0; j < nv; j++) {
      const r = rng.next();
      if (r < 0.12) ragged.set(`${i},${j}`, -1);
      else if (r < 0.4) ragged.set(`${i},${j}`, rng.int(0, 1) as 0 | 1);
    }
  const g = m.geo;
  sheet(g, nu, nv, pos, {
    flip: true,
    vary: 0.05,
    color: (i, j) => (ragged.get(`${i},${j}`) === -1 ? null : (patches.get(`${i},${j}`) ?? (i === 0 || i === nu - 1 ? crimDark : crim))),
    half: (i, j) => {
      const r = ragged.get(`${i},${j}`);
      return r === 0 || r === 1 ? r : undefined;
    },
  });
  // Folded-back sheet over the top edge (worn white band) and its turned edge.
  const band = (u: number, v: number): Vec3 => {
    const i = Math.round(u * nu);
    const x = xs[i];
    const z = lerp(z0 - 0.015, z0 + 0.13, v);
    const p = pos(u, (z - z0) / (z1 - z0));
    return [x * 1.004, p[1] + 0.014 + 0.01 * Math.sin(v * Math.PI), z];
  };
  sheet(g, nu, 2, band, { flip: true, vary: 0.04, color: (i) => (i === 0 || i === nu - 1 ? "#A99F8B" : "#C8BFAE") });
  // Stitches around the big tan patch.
  const thread = "#2E2320";
  const at = (u: number, v: number) => pos(u, v);
  for (const v of [7.2, 8.4]) decal(g, at(7 / nu, v / nv), [0, 1, 0], 0.035, 0.004, { color: thread, mat: "cloth" }, undefined, 0, 0.006);
  m.anchor("top_edge", [0, crest[0][1], z0]);
  return m;
}

/* =========================================================================================
 * Wheelchair — rank 02 (04 catalog look, patched like 03)
 * ========================================================================================= */

function buildWheelchair(): Model {
  const m = new Model("tl_veh_wheelchair_v01", {
    budget: 2000,
    notes:
      "Rank 02 patched wheelchair, 0.69 W x 0.96 H x 0.87 D: dark metal frame, crimson seat/back with worn patch, tape wraps, " +
      "spoked 0.60 m wheels (nodes wheel_l / wheel_r, pivot = axle, spin about local X) and 0.14 m casters (caster_l / " +
      "caster_r). Faces +Z. Rolling forward d metres: wheel rot X += d / 0.30 rad, casters d / 0.07 rad.",
  });
  const g = m.geo;
  const rng = m.rng.fork("wc");
  const C = {
    frame: "#4D4F52",
    frameDark: "#3A3C3F",
    seat: "#83282F",
    seatSide: "#661F26",
    back: "#82282F",
    patch: "#BFAE92",
    tyre: "#262322",
    rim: "#727476",
    spoke: "#86888A",
    hub: "#5E6062",
    grip: "#211F1E",
    padWood: "#86603F",
    padBlack: "#2A2726",
    tape: "#B79E75",
    plate: "#2E2C2B",
  };
  const fx = 0.215;
  const tr = 0.0125;
  const upright = (y: number): Vec3 => [fx, y, -0.155 - (0.04 * (y - 0.3)) / 0.62];
  g.mirrorX((b, s) => {
    const st = { radius: tr, sides: 6, color: C.frame, vary: 0.04 };
    // Rear upright bending back into the push handle.
    b.tube([upright(0.3), upright(0.92), [fx, 0.955, -0.235], [fx, 0.955, -0.262]], st);
    b.tube(
      [
        [fx, 0.955, -0.25],
        [fx, 0.952, -0.34],
      ],
      { radius: 0.018, sides: 6, color: C.grip },
    );
    // Seat rail down to the footrest hanger.
    b.tube(
      [
        [fx, 0.47, -0.17],
        [fx, 0.47, 0.2],
        [fx, 0.44, 0.245],
        [fx, 0.17, 0.37],
      ],
      st,
    );
    // Lower rail to the caster housing.
    b.tube(
      [
        [fx, 0.25, -0.155],
        [fx, 0.24, 0.24],
        [fx, 0.21, 0.3],
      ],
      st,
    );
    // Armrest loop + pad (one wooden replacement pad, one black).
    b.tube(
      [
        [fx, 0.47, -0.14],
        [fx, 0.66, -0.14],
        [fx, 0.66, 0.18],
        [fx, 0.47, 0.18],
      ],
      st,
    );
    b.box({ size: [0.05, 0.03, 0.31], at: [fx, 0.68, 0.02], chamfer: 0.008, color: s === 1 ? C.padWood : C.padBlack, vary: 0.05 });
    // Axle plate + stub.
    b.box({ size: [0.012, 0.1, 0.12], at: [fx + 0.008, 0.29, -0.11], color: C.frameDark });
    b.cylinder({ height: 0.07, radius: 0.012, sides: 6, rot: [0, 0, 90], at: [fx + 0.035, 0.3, -0.1], color: C.frameDark });
    // Caster housing + fork.
    b.cylinder({ height: 0.06, radius: 0.019, sides: 6, at: [fx, 0.205, 0.3], color: C.frameDark });
    b.box({ size: [0.012, 0.12, 0.026], at: [fx + 0.021, 0.125, 0.318], rot: [-10, 0, 0], color: C.frameDark });
    // Footrest plate.
    b.box({ size: [0.15, 0.016, 0.11], at: [fx - 0.078, 0.162, 0.425], rot: [4, 0, 0], color: C.plate, vary: 0.04 });
    // Tape wrap (patched): on the left upright and on the right seat rail.
    if (s === 1) b.tube([upright(0.56), upright(0.63)], { radius: tr * 1.5, sides: 6, color: C.tape, vary: 0.05 });
    else
      b.tube(
        [
          [fx, 0.47, 0.05],
          [fx, 0.47, 0.12],
        ],
        { radius: tr * 1.5, sides: 6, color: C.tape, vary: 0.05 },
      );
  });
  // Cross brace under the seat.
  for (const s of [1, -1])
    g.tube(
      [
        [s * fx, 0.46, -0.02],
        [-s * fx, 0.26, -0.02],
      ],
      { radius: 0.01, sides: 5, color: C.frameDark },
    );
  // Seat cushion + backrest sling with a worn patch.
  g.box({
    size: [0.43, 0.065, 0.4],
    at: [0, 0.505, 0.02],
    chamfer: 0.016,
    color: C.seatSide,
    parts: { top: C.seat, bevel: mix(C.seat, C.seatSide, 0.4) },
    vary: 0.04,
  });
  g.group({ at: [0, 0.715, -0.183], rot: [-3.7, 0, 0] }, (b) => {
    b.box({ size: [0.43, 0.37, 0.045], chamfer: 0.013, color: C.back, parts: { back: C.seatSide }, vary: 0.04 });
    decal(b, [0.1, 0.09, 0.0225], [0, 0, 1], 0.13, 0.1, { color: C.patch }, rng, 0.2);
    for (const [x, y, w, h] of [
      [0.035, 0.09, 0.022, 0.004],
      [0.165, 0.09, 0.022, 0.004],
      [0.1, 0.04, 0.004, 0.02],
      [0.1, 0.14, 0.004, 0.02],
      [0.06, 0.14, 0.004, 0.02],
    ] as const)
      decal(b, [x, y, 0.0225], [0, 0, 1], w, h, { color: "#2A1F1C" }, undefined, 0, 0.0035);
  });

  // Big wheels (separate nodes so the runtime can spin them about local X).
  const wheel = (name: string, s: 1 | -1) => {
    const w = m.node(name, { at: [s * 0.285, 0.3, -0.1] });
    const b = w.geo;
    // start angle puts a vertex at 270 deg (straight down) so the tyre touches y = 0.
    const t0 = 270 - 10 * (360 / 14);
    b.ring({ radius: 0.3, inner: 0.268, depth: 0.04, segments: 14, start: t0, end: t0 + 360, rot: [0, 90, 0], color: C.tyre, vary: 0.04 });
    b.ring({ radius: 0.268, inner: 0.25, depth: 0.024, segments: 14, start: t0, end: t0 + 360, rot: [0, 90, 0], color: C.rim, vary: 0.04 });
    b.ring({ radius: 0.262, inner: 0.249, depth: 0.012, segments: 12, rot: [0, 90, 0], at: [s * 0.036, 0, 0], color: C.rim });
    for (let i = 0; i < 4; i++) b.box({ size: [0.008, 0.5, 0.011], rot: [i * 45 + 22.5, 0, 0], color: C.spoke });
    b.cylinder({ height: 0.07, radius: 0.036, sides: 8, rot: [0, 0, 90], color: C.hub, parts: { top: C.rim, bottom: C.rim } });
    return w;
  };
  wheel("wheel_l", 1);
  wheel("wheel_r", -1);
  const caster = (name: string, s: 1 | -1) => {
    const c = m.node(name, { at: [s * fx, 0.07, 0.335] });
    c.geo.ring({ radius: 0.07, depth: 0.026, segments: 10, start: 18, end: 378, rot: [0, 90, 0], color: C.tyre, vary: 0.04 });
    c.geo.cylinder({ height: 0.032, radius: 0.026, sides: 6, rot: [0, 0, 90], color: C.rim });
  };
  caster("caster_l", 1);
  caster("caster_r", -1);

  m.anchor("seat", [0, 0.54, 0.02]);
  m.anchor("backrest", [0, 0.72, -0.16]);
  m.anchor("push_handles", [0, 0.955, -0.3]);
  m.anchor("footrest", [0, 0.17, 0.42]);
  m.collider = { type: "box", center: [0, 0.48, 0.05], size: [0.7, 0.96, 0.88] };
  m.pose("rolling", { wheel_l: [60, 0, 0], wheel_r: [60, 0, 0], caster_l: [150, 0, 0], caster_r: [150, 0, 0] });
  return m;
}

/* =========================================================================================
 * Oxygen cylinders — green (03 tenure) and white with red band (04 catalog) + hose
 * ========================================================================================= */

function buildOxygen(variant: "green" | "white"): Model {
  const green = variant === "green";
  const m = new Model(`tl_prop_oxygen_cylinder_${variant}_v01`, {
    budget: 500,
    notes: green
      ? "Rank 03 oxygen cylinder, faded green with a pale label band, 1.17 m tall, 0.18 m diameter; gauge faces +Z, hose outlet on +X (anchor hose_out). Pivot bottom centre."
      : "White oxygen cylinder with a crimson band (04 catalog), 1.17 m tall, 0.18 m diameter; gauge faces +Z, hose outlet on +X (anchor hose_out). Pivot bottom centre.",
  });
  const g = m.geo;
  const body = green ? "#718A72" : "#D0C9BD";
  const bodyDark = green ? "#5A6F5C" : "#B4AC9F";
  const band = green ? "#CEC4A8" : "#A12C36";
  const [b0, b1] = green ? [0.42, 0.6] : [0.64, 0.75];
  const prof: Vec2[] = [
    [0, 0],
    [0.082, 0],
    [0.09, 0.018],
    [0.09, 0.07],
    [0.09, b0],
    [0.09, b1],
    [0.09, 0.9],
    [0.084, 0.95],
    [0.066, 0.99],
    [0.04, 1.02],
    [0.026, 1.032],
    [0.026, 1.065],
    [0, 1.065],
  ];
  lathe(g, prof, {
    sides: 8,
    phase: 22.5,
    color: (bi) =>
      bi <= 2 ? bodyDark : bi === 4 ? band : bi >= 9 ? P.metalDark : bi >= 6 ? shade(body, 1.04) : body,
    vary: 0.05,
  });
  const metal = "#8A8B89";
  g.cylinder({ height: 0.075, radius: 0.03, sides: 6, at: [0, 1.1, 0], color: metal, vary: 0.05 });
  g.cylinder({ height: 0.03, radius: 0.008, sides: 4, at: [0, 1.15, 0], color: P.metalDark });
  g.cylinder({ height: 0.016, radius: 0.036, sides: 8, at: [0, 1.164, 0], color: "#3A3B3D", parts: { top: "#4A4B4D" } });
  // Outlet nozzle (+X) and gauge (+Z).
  g.tube(
    [
      [0.02, 1.1, 0],
      [0.07, 1.1, 0],
    ],
    { radius: 0.0095, sides: 6, color: metal },
  );
  g.cylinder({ height: 0.02, radius: 0.03, sides: 8, rot: [90, 0, 0], at: [0, 1.105, 0.038], color: "#2E3032" });
  g.poly(
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * 45 + 22.5) * DEG;
      return [Math.cos(a) * 0.024, 1.105 + Math.sin(a) * 0.024, 0.05] as Vec3;
    }),
    { color: "#E4DFD4" },
  );
  face(
    g,
    [
      [-0.002, 1.103, 0.0505],
      [0.017, 1.112, 0.0505],
      [0.016, 1.115, 0.0505],
      [-0.003, 1.107, 0.0505],
    ],
    [0, 0, 1],
    { color: "#9A2A2E" },
  );
  m.anchor("hose_out", [0.07, 1.1, 0]);
  m.anchor("top", [0, 1.172, 0]);
  m.collider = { type: "cylinder", center: [0, 0.586, 0], radius: 0.09, height: 1.172 };
  return m;
}

function buildHose(): Model {
  const m = new Model("tl_prop_oxygen_hose_v01", {
    budget: 500,
    notes:
      "Thin oxygen hose, ATTACHMENT (not a floor prop): authored in the oxygen cylinder's frame — give it the same transform " +
      "as tl_prop_oxygen_cylinder_*_v01. Starts at the cylinder's hose_out anchor (0.07, 1.10, 0) and sags to anchor " +
      "face_end (0.409, 1.215, 0.044), the right cheek of the rank-03 fan slouched in tl_prop_wooden_chair_v01 placed at " +
      "(0.50, 0, 0.05) relative to the cylinder (layout.ts rank 03 pose: sit_chair, hips slid forward, head back). " +
      "The nasal cannula loop belongs to the character.",
  });
  const ctrl: Vec3[] = [
    [0.07, 1.1, 0],
    [0.115, 1.075, 0.01],
    [0.19, 0.95, 0.035],
    [0.27, 0.885, 0.055],
    [0.35, 0.95, 0.06],
    [0.4, 1.1, 0.052],
    [0.409, 1.215, 0.044],
  ];
  m.geo.tube(catmull(ctrl, 3), { radius: 0.0055, sides: 5, color: "#D3D7D5", vary: 0.03 });
  m.anchor("start", [0.07, 1.1, 0]);
  m.anchor("face_end", [0.409, 1.215, 0.044]);
  return m;
}

/* =========================================================================================
 * Wooden chair — rank 03 old armchair (03 tenure panel)
 * ========================================================================================= */

function buildWoodenChair(): Model {
  const m = new Model("tl_prop_wooden_chair_v01", {
    budget: 500,
    notes: "Old wooden armchair for rank 03 (oxygen): seat 0.47 m, back 0.97 m leaning back ~9°, arms 0.69 m. Faces +Z. Pivot bottom centre.",
  });
  const g = m.geo;
  const C = { wood: "#664330", woodL: "#76503A", woodD: "#4A3122" };
  const backZ = (y: number) => -0.2 - (0.08 * (y - 0.45)) / 0.52;
  g.mirrorX((b) => {
    b.box({ size: [0.052, 0.66, 0.052], at: [0.205, 0.33, 0.19], color: C.woodD, vary: 0.06 });
    b.tube(
      [
        [0.205, 0, -0.19],
        [0.205, 0.45, -0.2],
        [0.205, 0.97, backZ(0.97)],
      ],
      { radius: sq(0.026), sides: 4, phase: 45, color: C.woodD, vary: 0.06 },
    );
    b.plank({ size: [0.52, 0.034, 0.078], at: [0.214, 0.676, -0.012], rot: [0, 90, 0], color: C.wood, vary: 0.05 });
    b.box({ size: [0.034, 0.04, 0.36], at: [0.205, 0.17, 0], color: C.woodD, vary: 0.05 });
  });
  for (let i = 0; i < 3; i++)
    g.plank({ size: [0.48, 0.038, 0.15], at: [0, 0.452, -0.152 + i * 0.152], color: i === 1 ? C.woodL : C.wood, vary: 0.05 });
  for (const [y, h, tilt] of [
    [0.6, 0.08, 0],
    [0.76, 0.08, 3.5],
    [0.915, 0.115, 0],
  ] as const)
    g.plank({
      size: [y > 0.9 ? 0.52 : 0.42, 0.03, h],
      at: [0, y, backZ(y)],
      rot: [81.3, 0, tilt],
      color: y > 0.9 ? C.woodL : C.wood,
      vary: 0.05,
    });
  for (const z of [0.19, -0.195]) g.box({ size: [0.37, 0.034, 0.034], at: [0, 0.15, z], color: C.woodD, vary: 0.05 });
  // Cloth-strip repair wrapped round the left front leg, with a loose tail.
  g.cylinder({ height: 0.026, radius: 0.04, sides: 6, at: [0.205, 0.29, 0.19], rot: [0, 0, 6], color: "#A88E6A", vary: 0.06 });
  g.cylinder({ height: 0.02, radius: 0.039, sides: 6, phase: 20, at: [0.205, 0.318, 0.19], rot: [0, 0, -5], color: "#9A8160", vary: 0.06 });
  g.box({ size: [0.016, 0.06, 0.003], at: [0.214, 0.258, 0.225], rot: [6, 0, 12], color: "#A88E6A" });
  m.anchor("seat", [0, 0.471, 0.02]);
  m.anchor("back", [0, 0.75, -0.24]);
  m.collider = { type: "box", center: [0, 0.485, -0.02], size: [0.5, 0.97, 0.5] };
  return m;
}

/* =========================================================================================
 * Folded blanket — patched crimson blanket stack (04 catalog blanket)
 * ========================================================================================= */

function buildBlanketFolded(): Model {
  const m = new Model("tl_prop_blanket_folded_v01", {
    budget: 500,
    notes: "Folded patched blanket, 0.50 x 0.15 x 0.40 m: crimson/worn-white layers, sewn patches, a ragged flap hanging over the +Z edge. Pivot bottom centre.",
  });
  const g = m.geo;
  const rng = m.rng.fork("fold");
  const crim = "#7A3B3E";
  const crimSide = "#5F2E30";
  const cream = "#BEB39D";
  const creamSide = "#A0957F";
  const tan = "#A0835F";
  const thread = "#2F2420";
  // Stack of soft folded layers (the blanket's crimson and cream halves showing on the open
  // sides) + a rounded fold roll along the -Z edge.
  const layers = [
    { c: crim, s: crimSide, t: 0.03 },
    { c: cream, s: creamSide, t: 0.022 },
    { c: crim, s: crimSide, t: 0.026 },
    { c: cream, s: creamSide, t: 0.02 },
    { c: crim, s: crimSide, t: 0.03 },
  ];
  let y = 0;
  let topY = 0;
  layers.forEach((L, i) => {
    const w = 0.47 - i * 0.008 + rng.jitter(0.012);
    const d = 0.33 - i * 0.004 + rng.jitter(0.01);
    g.box({
      size: [w, L.t, d],
      at: [rng.jitter(0.014), y + L.t / 2, 0.012 + rng.jitter(0.01)],
      rot: [0, rng.jitter(4), 0],
      chamfer: L.t * 0.4,
      color: L.s,
      parts: { top: L.c },
      vary: 0.05,
    });
    topY = y + L.t;
    y += L.t * 0.94;
  });
  // Soft, slightly domed top so the stack reads as fabric (not a slab).
  const rect = (w: number, d: number, yy: number): Vec3[] => [
    [-w / 2, yy, -d / 2],
    [w / 2, yy, -d / 2],
    [w / 2, yy, d / 2],
    [-w / 2, yy, d / 2],
  ];
  g.hull([...rect(0.43, 0.3, topY - 0.012), ...rect(0.41, 0.28, topY + 0.004), ...rect(0.31, 0.19, topY + 0.012)], {
    color: crim,
    parts: { side: crimSide },
    vary: 0.05,
  });
  topY += 0.012;
  g.cylinder({
    height: 0.43,
    radius: topY * 0.47,
    sides: 8,
    phase: 22.5,
    rot: [0, 0, 90],
    at: [0, topY * 0.49, -0.135],
    color: crimSide,
    parts: { top: crimSide, bottom: crimSide },
    vary: 0.05,
  });
  // The top layer's free end hangs over the +Z edge to the floor, ragged hem, cream stripe + patch.
  const prof: Vec2[] = [
    [0.035, topY + 0.0025],
    [0.115, topY + 0.0015],
    [0.17, topY - 0.009],
    [0.195, topY - 0.03],
    [0.206, topY - 0.07],
    [0.212, 0.012],
  ];
  const nu = 6;
  const nv = prof.length - 1;
  const rag = Array.from({ length: nu }, () => rng.next());
  const wob = Array.from({ length: (nu + 1) * (nv + 1) }, () => rng.jitter(0.004));
  sheet(
    g,
    nu,
    nv,
    (u, v) => {
      const i = Math.round(u * nu);
      const j = Math.round(v * nv);
      const [z, yy] = prof[j];
      // Uneven hem: the bottom row ends at a different height per column.
      const hem = j === nv ? 0.03 * Math.abs(wob[i * (nv + 1)] / 0.004) : 0;
      return [lerp(-0.19, 0.2, u), yy + hem, z + (j >= 2 ? Math.abs(wob[i * (nv + 1) + j]) : 0)];
    },
    {
      vary: 0.05,
      color: (i, j) =>
        j === nv - 1 && rag[i] < 0.2 ? null : i === 4 ? cream : i === 1 && j >= 2 && j <= 3 ? tan : crim,
      half: (i, j) => (j === nv - 1 && rag[i] >= 0.2 && rag[i] < 0.6 ? ((i % 2) as 0 | 1) : undefined),
    },
  );
  // Sewn patches on top with stitches across their edges (decal on +Y: 1st size along Z, 2nd along X).
  const patch = (x: number, z: number, w: number, d: number, c: Color) => {
    decal(g, [x, topY, z], [0, 1, 0], d, w, { color: c }, rng, 0.12);
    for (const sx of [-1, 1])
      for (let k = 0; k < 3; k++)
        decal(g, [x + (sx * w) / 2, topY, z - d / 3 + (k * d) / 3], [0, 1, 0], 0.0035, 0.018, { color: thread }, undefined, 0, 0.0035);
  };
  patch(-0.08, -0.035, 0.12, 0.1, tan);
  patch(0.09, -0.045, 0.09, 0.08, cream);
  m.anchor("top", [0, topY, 0]);
  return m;
}

/* =========================================================================================
 * Gamepad — minigame corner controller lying on a crate (02 minigame corner)
 * ========================================================================================= */

function buildGamepad(): Model {
  const m = new Model("tl_prop_gamepad_v01", {
    budget: 500,
    notes: "Wired gamepad lying flat (0.16 W x 0.04 H x 0.10 D + short cable toward -Z). Grips toward +Z (the player). Pivot bottom centre.",
  });
  const g = m.geo;
  const C = { body: "#3A3A3D", grip: "#333336", dpad: "#1E1E20", orange: "#D46E2C", red: "#B5323A", grey: "#77777A", cable: "#2A2A2C" };
  const ring = (cx: number, cz: number, r: number, n: number, y: number, ph = 0): Vec3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (ph + (i * 360) / n) * DEG;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r] as Vec3;
    });
  // Dog-bone body: a stadium (two lobes + bridge) with a soft bevel, plus two grips toward +Z.
  const stadium = (hx: number, r: number, y: number, n = 5): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (-90 + (180 * i) / n) * DEG;
      pts.push([hx + Math.cos(a) * r, y, Math.sin(a) * r]);
      pts.push([-hx - Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return pts;
  };
  g.hull([...stadium(0.046, 0.029, 0.0), ...stadium(0.046, 0.034, 0.012), ...stadium(0.045, 0.027, 0.028)], {
    color: C.body,
    parts: { top: shade(C.body, 1.15) },
    vary: 0.04,
  });
  for (const s of [1, -1])
    g.hull(
      [
        ...ring(s * 0.054, 0.04, 0.019, 7, 0.0),
        ...ring(s * 0.053, 0.032, 0.025, 7, 0.012),
        ...ring(s * 0.05, 0.018, 0.02, 7, 0.024),
      ],
      { color: C.grip, vary: 0.05 },
    );
  // D-pad (-X: left thumb of a player facing -Z) and face buttons (+X).
  g.box({ size: [0.026, 0.006, 0.0085], at: [-0.046, 0.03, -0.004], color: C.dpad });
  g.box({ size: [0.0085, 0.006, 0.026], at: [-0.046, 0.03, -0.004], color: C.dpad });
  (
    [
      [0.046, -0.015, C.orange],
      [0.057, -0.004, C.red],
      [0.046, 0.007, C.orange],
      [0.035, -0.004, C.red],
    ] as const
  ).forEach(([x, z, c]) => g.cylinder({ height: 0.006, radius: 0.0055, sides: 6, at: [x, 0.03, z], color: c }));
  for (const x of [-0.011, 0.011]) g.box({ size: [0.012, 0.003, 0.005], at: [x, 0.0285, 0.006], color: C.grey });
  // Cable.
  g.tube(
    catmull(
      [
        [0, 0.012, -0.036],
        [0.004, 0.007, -0.07],
        [-0.022, 0.004, -0.1],
        [-0.004, 0.004, -0.128],
        [0.034, 0.004, -0.134],
      ],
      2,
    ),
    { radius: 0.0038, sides: 4, color: C.cable },
  );
  m.anchor("grip", [0, 0.03, 0.01]);
  return m;
}

/* =========================================================================================
 * Phone — rank 04 hand-held phone
 * ========================================================================================= */

function buildPhone(): Model {
  const m = new Model("tl_prop_phone_v01", {
    budget: 500,
    notes:
      "Smartphone lying flat, screen up (+Y), top edge toward -Z: 0.072 x 0.009 x 0.148 m. Dim emissive screen (tl_glow). " +
      "To hold it upright facing the character, parent to the hand and rotate X +90 (screen toward -Z) or -90.",
  });
  const g = m.geo;
  g.box({ size: [0.072, 0.009, 0.148], at: [0, 0.0045, 0], chamfer: 0.0028, color: "#3A3F47", vary: 0.03 });
  face(
    g,
    [
      [-0.032, 0.0092, -0.066],
      [0.032, 0.0092, -0.066],
      [0.032, 0.0092, 0.066],
      [-0.032, 0.0092, 0.066],
    ],
    [0, 1, 0],
    { color: "#46576A", mat: "glow" },
  );
  // Camera bump on the back (top-left seen from behind).
  g.box({ size: [0.022, 0.0025, 0.03], at: [0.018, -0.00125 + 0.0003, -0.05], color: "#25282D" });
  m.anchor("grip", [0, 0.0045, 0.02]);
  m.anchor("screen", [0, 0.0095, 0]);
  return m;
}

/* =========================================================================================
 * Group entry
 * ========================================================================================= */

export default function build(): Model[] {
  return [
    buildTv(),
    buildKettle(),
    buildNoodleCup(),
    buildMug("white"),
    buildMug("red"),
    buildBed(),
    buildBedCover(),
    buildWheelchair(),
    buildOxygen("green"),
    buildOxygen("white"),
    buildHose(),
    buildWoodenChair(),
    buildBlanketFolded(),
    buildGamepad(),
    buildPhone(),
  ];
}
