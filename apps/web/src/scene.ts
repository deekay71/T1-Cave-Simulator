import * as pc from "playcanvas";
export const landmarks = [
  { id: "memory", name: "Vách ký ức", x: -9, z: -5 },
  { id: "rest", name: "Góc thâm niên", x: 9, z: -5 },
  { id: "tv", name: "TV trú thua", x: 7, z: 4 },
] as const;
type Primitive = "box" | "sphere" | "cylinder" | "cone";
export function createCave(app: pc.Application) {
  const materials = new Map<string, pc.StandardMaterial>();
  function material(color: string, glow = false) {
    const key = color + glow;
    let m = materials.get(key);
    if (!m) {
      m = new pc.StandardMaterial();
      m.diffuse = new pc.Color().fromString(color);
      m.shininess = 0;
      if (glow) m.emissive = new pc.Color().fromString(color);
      m.update();
      materials.set(key, m);
    }
    return m;
  }
  function box(
    name: string,
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    parent = app.root,
    type: Primitive = "box",
    glow = false,
  ) {
    const e = new pc.Entity(name);
    e.addComponent("render", { type, material: material(color, glow) });
    e.setLocalPosition(x, y, z);
    e.setLocalScale(sx, sy, sz);
    parent.addChild(e);
    return e;
  }
  // Flat triangle normals keep the rock silhouette visibly low-poly.
  function rock(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color = "#654736",
    n = 5,
    pointed = false,
  ) {
    const vertices: number[] = [];
    const tri = (a: number[], b: number[], c: number[]) =>
      vertices.push(...a, ...b, ...c);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2,
        b = ((i + 1) / n) * Math.PI * 2;
      const p = [Math.cos(a) * r, 0, Math.sin(a) * r],
        q = [Math.cos(b) * r, 0, Math.sin(b) * r],
        u = [
          Math.cos(a + 0.15) * r * 0.65,
          pointed ? h * 0.55 : h,
          Math.sin(a + 0.15) * r * 0.65,
        ],
        v = [
          Math.cos(b + 0.15) * r * 0.65,
          pointed ? h * 0.55 : h,
          Math.sin(b + 0.15) * r * 0.65,
        ];
      tri(p, u, q);
      tri(q, u, v);
      tri(u, [r * 0.15, h, 0], v);
    }
    const indices = Array.from({ length: vertices.length / 3 }, (_, i) => i);
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(vertices);
    mesh.setNormals(pc.calculateNormals(vertices, indices));
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const e = new pc.Entity("faceted-rock");
    e.addComponent("render", {
      meshInstances: [new pc.MeshInstance(mesh, material(color))],
    });
    e.setPosition(x, y, z);
    app.root.addChild(e);
    return e;
  }
  app.scene.ambientLight = new pc.Color(0.34, 0.27, 0.23);
  const sun = new pc.Entity("cave-fill");
  sun.addComponent("light", {
    type: "directional",
    color: new pc.Color(1, 0.78, 0.5),
    intensity: 1.15,
  });
  sun.setEulerAngles(48, -25, 0);
  app.root.addChild(sun);
  box("earth", "#443326", 0, -0.25, 0, 34, 0.5, 34);
  for (let i = 0; i < 23; i++) {
    const a = Math.PI * 0.09 + (i / 22) * Math.PI * 1.82;
    const x = Math.cos(a) * 16,
      z = Math.sin(a) * 16;
    if (z > 10) continue;
    rock(x, -0.1, z, 2.8, 9 + (i % 4) * 1.8, i % 2 ? "#63432f" : "#755139");
    rock(x * 0.92, 0, z * 0.92, 1.1, 2 + (i % 3), "#5a4030");
  }
  for (let i = 0; i < 68; i++) {
    const x = Math.sin(i * 19.7) * 13,
      z = Math.cos(i * 11.3) * 13;
    if (Math.hypot(x, z) < 2) continue;
    rock(x, 0, z, 0.12 + (i % 4) * 0.07, 0.12 + (i % 3) * 0.12, "#79614b", 5);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    rock(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2, 0.38, 0.4, "#8f8170");
  }
  box("log", "#38271e", 0, 0.2, 0, 1.8, 0.2, 0.35).setEulerAngles(0, 25, 0);
  box("log", "#38271e", 0, 0.2, 0, 1.8, 0.2, 0.35).setEulerAngles(0, -55, 0);
  const flames = [
    rock(-0.35, 0.25, 0, 0.42, 1.5, "#ff8c25", 5, true),
    rock(0.25, 0.25, 0.1, 0.38, 1.1, "#ffb93f", 5, true),
    rock(0, 0.25, -0.3, 0.35, 1.7, "#ffe69b", 5, true),
  ];
  const fire = new pc.Entity("fire-light");
  fire.addComponent("light", {
    type: "omni",
    color: new pc.Color(1, 0.45, 0.12),
    range: 18,
    intensity: 3,
  });
  fire.setPosition(0, 2, 0);
  app.root.addChild(fire);
  function stool(x: number, z: number) {
    box("seat", "#795035", x, 0.55, z, 0.65, 0.16, 0.65);
    for (const dx of [-0.22, 0.22])
      for (const dz of [-0.22, 0.22])
        box("leg", "#473021", x + dx, 0.25, z + dz, 0.1, 0.5, 0.1);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    stool(Math.cos(a) * 3, Math.sin(a) * 3);
  }
  for (const [x, z] of [
    [-11, -7],
    [11, -7],
    [-12, 4],
    [12, 4],
  ]) {
    box("torch", "#443021", x, 1.6, z, 0.12, 3.2, 0.12);
    rock(x, 3.1, z, 0.24, 0.65, "#ffbf55");
    const l = new pc.Entity("torchlight");
    l.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.55, 0.2),
      range: 9,
      intensity: 1.3,
    });
    l.setPosition(x, 3.3, z);
    app.root.addChild(l);
  }
  function sign(
    text: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#241b17";
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = "#ad6c40";
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.fillStyle = "#eee0bd";
    ctx.font = "bold 46px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 145);
    const tex = new pc.Texture(app.graphicsDevice, { width: 512, height: 256 });
    tex.setSource(c);
    const mat = new pc.StandardMaterial();
    mat.diffuseMap = tex;
    mat.emissiveMap = tex;
    mat.emissive = new pc.Color(0.45, 0.4, 0.32);
    mat.update();
    const e = box("sign", "#ddd", x, y, z, width, height, 0.08);
    e.render!.meshInstances[0].material = mat;
    return e;
  }
  box("memory-board", "#513724", -9, 2, -5, 4, 2.6, 0.25);
  for (let i = 0; i < 6; i++) {
    const e = box(
      "old-card",
      i % 2 ? "#b6a181" : "#d0ba91",
      -10.4 + (i % 3) * 1.4,
      1.4 + Math.floor(i / 3) * 1.1,
      -4.8,
      0.95,
      0.7,
      0.03,
    );
    e.setEulerAngles(0, 0, i % 2 ? 7 : -6);
  }
  sign("VÁCH KÝ ỨC", -9, 3.65, -4.7, 3.8, 0.7);
  for (const x of [7, 11])
    box("tarp-pole", "#62442b", x, 1.6, -5, 0.12, 3.2, 0.12);
  box("patched-tarp", "#762f2c", 9, 3.15, -5, 4.5, 0.1, 4).setEulerAngles(
    0,
    0,
    -8,
  );
  box("patch", "#b2a58b", 8.3, 3.3, -4, 1, 0.12, 0.9).setEulerAngles(0, 0, -8);
  box("bed-frame", "#4b4540", 9, 0.55, -5, 1.8, 0.15, 3);
  box("blanket", "#83463c", 9, 0.8, -5, 1.65, 0.3, 2.5);
  box("pillow", "#b6aa8d", 9, 1, -6, 1.3, 0.25, 0.6);
  box("oxygen", "#60705a", 11, 1, -5, 0.5, 1.8, 0.5, app.root, "cylinder");
  box("oxygen-valve", "#bab19c", 11, 2, -5, 0.35, 0.12, 0.12);
  box("crate", "#68492f", 7, 0.6, 4, 1.5, 1.2, 1);
  box("television", "#252323", 7, 1.7, 4, 1.6, 1.1, 0.7);
  sign("DEFEAT", 7, 1.75, 4.38, 1.3, 0.8);
  sign("HANG TRÚ THUA", 0, 4, -13, 4, 0.8);
  const camera = new pc.Entity("camera");
  camera.addComponent("camera", {
    clearColor: new pc.Color(0.1, 0.075, 0.055),
    fov: 62,
    farClip: 100,
  });
  camera.setPosition(0, 9, 18);
  camera.lookAt(0, 1, -3);
  app.root.addChild(camera);
  let time = 0;
  app.on("update", (dt: number) => {
    time += dt;
    flames.forEach((e, i) =>
      e.setLocalScale(1, 1 + Math.sin(time * 5 + i) * 0.09, 1),
    );
    fire.light!.intensity = 2.7 + Math.sin(time * 9) * 0.2;
  });
  function avatar(self: boolean) {
    const root = new pc.Entity("fan");
    app.root.addChild(root);
    const red = self ? "#a62b34" : "#71534b";
    box("torso", red, 0, 1.05, 0, 0.55, 0.65, 0.32, root);
    box("head", "#c59b74", 0, 1.63, 0, 0.42, 0.45, 0.4, root);
    box("hair", "#292321", 0, 1.86, -0.02, 0.45, 0.16, 0.43, root);
    box("left-arm", red, -0.37, 1, 0, 0.18, 0.65, 0.23, root);
    box("right-arm", red, 0.37, 1, 0, 0.18, 0.65, 0.23, root);
    for (const x of [-0.16, 0.16]) {
      box("leg", "#2c2926", x, 0.45, 0, 0.22, 0.65, 0.25, root);
      box("shoe", "#b2a997", x, 0.12, 0.08, 0.25, 0.18, 0.4, root);
    }
    box("patch", "#b6aa93", 0.12, 1.14, 0.17, 0.18, 0.18, 0.02, root);
    return root;
  }
  return { camera, avatar };
}
