import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MeshBuilder,
  Model,
  Rng,
  eulerToQuat,
  exportGlb,
  hexToLinear,
  linearToHex,
  measureText,
  rotatePoint,
  writeAssets,
  type Vec3,
} from "../tools/models/lib.js";

type Tri = { p: Vec3[]; n: Vec3 };
function tris(b: MeshBuilder): Tri[] {
  const out: Tri[] = [];
  for (const k of b._buckets())
    for (let i = 0; i < k.pos.length; i += 9) {
      const p: Vec3[] = [0, 3, 6].map((o) => [k.pos[i + o], k.pos[i + o + 1], k.pos[i + o + 2]] as Vec3);
      out.push({ p, n: [k.nrm[i], k.nrm[i + 1], k.nrm[i + 2]] });
    }
  return out;
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const center = (t: Tri): Vec3 => [0, 1, 2].map((k) => (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3) as Vec3;

/** Every triangle: stored normal = winding normal, and points away from `inside`. */
function assertFlatOutward(b: MeshBuilder, inside: Vec3, label: string) {
  const all = tris(b);
  assert.ok(all.length > 0, `${label}: has triangles`);
  for (const t of all) {
    const g = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
    assert.ok(dot(g, t.n) > 0, `${label}: normal matches winding`);
    assert.ok(dot(t.n, sub(center(t), inside)) > -1e-9, `${label}: faces outward`);
  }
}
function glbJson(glb: Uint8Array): any {
  const buf = Buffer.from(glb);
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString("utf8", 20, 20 + len));
}

test("models: colour conversion sRGB <-> linear", () => {
  const [r] = hexToLinear("#808080");
  assert.ok(Math.abs(r - 0.2158605) < 1e-6);
  for (const c of ["#493325", "#72513A", "#211C19", "#AD2936", "#CEC5B2", "#FFB24C"])
    assert.equal(linearToHex(hexToLinear(c)), c);
});

test("models: euler convention matches quaternion (PlayCanvas order)", () => {
  const rot: Vec3 = [30, -50, 70];
  const [x, y, z, w] = eulerToQuat(rot);
  const v: Vec3 = [0.3, -1.2, 2];
  // q * v * q^-1
  const t = cross([x, y, z], v).map((c) => 2 * c) as Vec3;
  const q: Vec3 = [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
  const m = rotatePoint(v, rot);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(q[k] - m[k]) < 1e-9);
});

test("models: primitives are flat-shaded with outward normals", () => {
  const cases: [string, (b: MeshBuilder) => void, number?][] = [
    ["box", (b) => b.box({ size: [1, 0.5, 0.3] }), 12],
    ["chamfer", (b) => b.box({ size: 1, chamfer: 0.1 }), 44],
    ["cylinder", (b) => b.cylinder({ radius: 0.4, height: 1, sides: 8 }), 28],
    ["cone", (b) => b.cone({ radius: 0.4, height: 1, sides: 6, lean: [0.2, 0] })],
    ["wedge", (b) => b.wedge({ size: [1, 0.6, 0.8] })],
    ["icosphere", (b) => b.icosphere({ radius: 0.5, detail: 1, jitter: 0.1 }), 80],
    ["rock", (b) => b.rock({ size: [1, 0.6, 0.8], points: 16, flat: 0.2 })],
    ["plank", (b) => b.plank({ size: [1.2, 0.05, 0.2] })],
    ["mirrored", (b) => b.mirrorX((m) => m.box({ size: 0.4 }))],
  ];
  for (const [label, fn, count] of cases) {
    const b = new MeshBuilder(label);
    fn(b);
    if (count !== undefined) assert.equal(b.triangleCount, count, `${label} tri count`);
    if (label !== "mirrored") assertFlatOutward(b, [0, label === "wedge" ? -0.1 : 0, label === "wedge" ? -0.13 : 0], label);
  }
  const m = new MeshBuilder(1);
  m.mirrorX((b) => b.box({ size: 0.4, at: [1, 0, 0] }));
  for (const t of tris(m)) {
    const side: Vec3 = [Math.sign(center(t)[0]), 0, 0];
    assert.ok(dot(t.n, sub(center(t), side)) > -1e-9, "mirrored box faces outward");
  }
});

test("models: tube, ring, extrude and text orientation", () => {
  const b = new MeshBuilder(2);
  b.tube(
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    { radius: 0.05, sides: 4, caps: false },
  );
  for (const t of tris(b)) {
    const c = center(t);
    const axis: Vec3 = c[1] < 0.95 ? [0, c[1], 0] : [c[0], 1, 0];
    if (c[1] > 0.9 && c[0] < 0.1) continue; // mitred corner
    assert.ok(dot(t.n, sub(c, axis)) > 0, "tube side faces outward");
  }
  const r = new MeshBuilder(3);
  r.ring({ radius: 0.5, inner: 0.4, depth: 0.1, start: 0, end: 270 });
  assert.ok(r.triangleCount > 0);
  const e = new MeshBuilder(4);
  e.extrude(
    [
      [0, 0],
      [1, 0],
      [1, 0.2],
      [0.2, 0.2],
      [0.2, 1],
      [0, 1],
    ],
    { depth: 0.1 },
  );
  const front = tris(e).filter((t) => t.p.every((p) => Math.abs(p[2] - 0.1) < 1e-9));
  const back = tris(e).filter((t) => t.p.every((p) => Math.abs(p[2]) < 1e-9));
  assert.equal(front.length, 4);
  assert.equal(back.length, 4);
  assert.ok(front.every((t) => t.n[2] > 0.99) && back.every((t) => t.n[2] < -0.99));
  const txt = new MeshBuilder(5);
  txt.text("DEFEAT?", { pixel: 0.01 });
  assert.ok(txt.triangleCount > 20 && tris(txt).every((t) => t.n[2] > 0.99));
  const mt = measureText("DEFEAT", { pixel: 0.01 });
  assert.equal(mt.cols, 35);
  assert.equal(mt.rows, 7);
  assert.ok(Math.abs(mt.width - 0.35) < 1e-9 && Math.abs(mt.height - 0.07) < 1e-9);
});

test("models: deterministic GLB, glow/cloth materials, manifest", async () => {
  const make = () => {
    const m = new Model("tl_prop_unittest_v01", { notes: "unit test", budget: 400 });
    m.geo.rock({ size: 0.5, align: "bottom", vary: 0.1, color: "#72513A" });
    m.geo.cone({ radius: 0.1, height: 0.3, at: [0, 0.6, 0], mat: "glow", glow: 1.5, color: "#FFB24C" });
    m.geo.cloth({ size: [0.6, 0.6], at: [0, 0.4, 0], sag: 0.05, tear: 0.5, holes: 1 });
    const arm = m.node("arm_upper_l", { at: [0.2, 0.5, 0] });
    arm.geo.box({ size: [0.05, 0.2, 0.05], at: [0, -0.1, 0] });
    m.pose("raise", { arm_upper_l: [0, 0, 120] });
    m.anchor("top", [0, 0.75, 0]);
    return m;
  };
  const a = await exportGlb(make());
  const b = await exportGlb(make());
  assert.deepEqual(Buffer.from(a.glb), Buffer.from(b.glb));
  const json = glbJson(a.glb);
  const glow = json.materials.find((m: any) => m.name === "tl_glow_1.5");
  assert.deepEqual(glow.extensions.KHR_materials_unlit, {});
  assert.equal(glow.extensions.KHR_materials_emissive_strength.emissiveStrength, 1.5);
  assert.equal(json.materials.find((m: any) => m.name === "tl_cloth").doubleSided, true);
  assert.ok(json.meshes[0].primitives.every((p: any) => p.attributes.COLOR_0 !== undefined));

  const dir = mkdtempSync(path.join(tmpdir(), "tl-models-test-"));
  try {
    writeFileSync(path.join(dir, "stale.glb"), "x");
    const groupDir = path.join(dir, "unit");
    const man = await writeAssets("unit", [make()], { outDir: dir, quiet: true });
    writeFileSync(path.join(groupDir, "tl_prop_old_v01.glb"), "x");
    await writeAssets("unit", [make()], { outDir: dir, quiet: true });
    assert.ok(!existsSync(path.join(groupDir, "tl_prop_old_v01.glb")), "stale GLB removed");
    const disk = JSON.parse(readFileSync(path.join(dir, "manifest.unit.json"), "utf8"));
    assert.deepEqual(disk, man);
    const e = man.assets[0];
    assert.equal(e.file, "unit/tl_prop_unittest_v01.glb");
    assert.deepEqual(e.nodes, ["tl_prop_unittest_v01", "arm_upper_l"]);
    assert.equal(e.emissive[0].material, "tl_glow_1.5");
    assert.ok(e.triangles > 0 && e.bounds.min[1] >= -1e-6);
    assert.deepEqual(e.poses.raise, { arm_upper_l: [0, 0, 120] });
    assert.ok(existsSync(path.join(groupDir, "tl_prop_unittest_v01.glb")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("models: validation", () => {
  assert.throws(() => new Model("crate"));
  const m = new Model("tl_char_test_v01");
  m.node("hips");
  assert.throws(() => m.node("hips"), /duplicate/);
  assert.throws(() => m.pose("x", { nope: [0, 0, 0] }), /unknown node/);
  assert.equal(new Rng("a").next(), new Rng("a").next());
  assert.notEqual(new Rng("a").next(), new Rng("b").next());
});
