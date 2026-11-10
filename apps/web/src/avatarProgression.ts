/** Original procedural preview props. No persistence or authoritative gameplay changes. */
import * as pc from "playcanvas";

type V3 = [number, number, number];
export class ProgressionVisuals {
  readonly equipment = new pc.Entity("progression-equipment");
  private cosmeticRoot = new pc.Entity("progression-cosmetic");
  private materials: pc.StandardMaterial[] = [];
  private rank = 0;
  private cosmetic: string | null = null;
  constructor(private root: pc.Entity, private model: pc.Entity) {
    root.addChild(this.equipment);
    root.addChild(this.cosmeticRoot);
  }
  private part(parent: pc.GraphNode, name: string, at: V3, scale: V3, color: string, type: "box" | "cylinder" = "box") {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color().fromString(color);
    material.gloss = 0.3;
    material.update();
    this.materials.push(material);
    const entity = new pc.Entity(name);
    entity.addComponent("render", { type, material });
    entity.setLocalPosition(...at);
    entity.setLocalScale(...scale);
    parent.addChild(entity);
    return entity;
  }
  setShrineSeated(seated: boolean) {
    // Hand-held keyboard would collide with the ritual hand poses.
    this.cosmeticRoot.enabled = !(seated && this.cosmetic === "cave-keyboard");
  }
  set(rank: number, cosmetic: string | null) {
    if (rank === this.rank && cosmetic === this.cosmetic) return;
    this.rank = rank; this.cosmetic = cosmetic;
    for (const child of [...this.equipment.children]) child.destroy();
    this.cosmeticRoot.destroy();
    for (const material of this.materials) material.destroy();
    this.materials = [];
    this.cosmeticRoot = new pc.Entity("progression-cosmetic");
    this.root.addChild(this.cosmeticRoot);
    const p = (name: string, at: V3, scale: V3, color = "#88949a", type: "box" | "cylinder" = "box") =>
      this.part(this.equipment, name, at, scale, color, type);
    const wheel = (x: number, y: number, z: number, size: number) => {
      const w = p("wheel", [x,y,z], [size,0.07,size], "#252c32", "cylinder");
      w.setLocalEulerAngles(0,0,90);
    };
    if (rank === 2) {
      p("oxygen-tank", [-0.48,0.48,-0.56], [0.25,0.8,0.25], "#71a899", "cylinder");
      p("oxygen-valve", [-0.48,0.94,-0.56], [0.13,0.12,0.1], "#dbc89c");
      p("tank-trolley", [-0.48,0.12,-0.56], [0.4,0.08,0.4]);
      p("trolley-handle", [-0.48,0.7,-0.77], [0.05,1.1,0.05]);
      const hose = p("oxygen-hose", [-0.29,1.1,-0.27], [0.035,0.7,0.035], "#c3d6cb");
      hose.setLocalEulerAngles(35,0,-35);
      wheel(-0.68,0.12,-0.65,0.2); wheel(-0.28,0.12,-0.65,0.2);
    } else if (rank === 3) {
      for (const x of [-0.43,0.43]) {
        for (const z of [0.3,0.78]) p("walker-leg", [x,0.44,z], [0.045,0.85,0.045]);
        p("walker-grip", [x,0.86,0.54], [0.08,0.07,0.58], "#343e48");
      }
      p("walker-crossbar", [0,0.65,0.78], [0.88,0.045,0.045]);
    } else if (rank === 4) {
      p("chair-seat", [0,0.46,-0.02], [0.57,0.08,0.55], "#b22e42");
      p("chair-back", [0,0.83,-0.29], [0.57,0.64,0.08], "#b22e42");
      p("chair-footrest", [0,0.12,0.54], [0.6,0.06,0.25]);
      for (const x of [-0.38,0.38]) {
        wheel(x,0.35,-0.14,0.65); wheel(x,0.12,0.43,0.22);
        p("chair-arm", [x,0.72,0], [0.08,0.06,0.65], "#343e48");
      }
    } else if (rank === 5) {
      p("bed-frame", [0,0.57,0], [0.92,0.1,2.15]);
      p("bed-mattress", [0,0.67,0], [0.85,0.15,2.05], "#a9bcc3");
      p("bed-pillow", [0,0.78,0.76], [0.65,0.16,0.43], "#e8e1d1");
      for (const x of [-0.43,0.43]) for (const z of [-0.85,0.85]) {
        p("bed-leg", [x,0.34,z], [0.06,0.5,0.06]); wheel(x,0.1,z,0.17);
      }
    }
    const joint = (name: string) => this.model.findByName(name) ?? this.root;
    const attach = (name: string) => { this.cosmeticRoot.reparent(joint(name)); return this.cosmeticRoot; };
    const c = (parent: pc.GraphNode, name: string, at: V3, scale: V3, color: string) => this.part(parent,name,at,scale,color);
    if (cosmetic === "cave-glasses") {
      const parent = attach("head");
      for (const x of [-0.085,0.085]) c(parent,"glasses-lens",[x,0.11,0.16],[0.14,0.065,0.025],"#202735");
      c(parent,"glasses-bridge",[0,0.11,0.17],[0.04,0.02,0.025],"#d9bf79");
    } else if (cosmetic === "cave-keyboard") {
      const parent = attach("arm_lower_r");
      c(parent,"keyboard",[0,-0.3,0.11],[0.4,0.045,0.16],"#202735");
      for(let row=0;row<3;row++) for(let col=0;col<9;col++)
        c(parent,"key",[-0.16+col*0.04,-0.273,0.06+row*0.045],[0.028,0.012,0.028],"#c7ced4");
    } else if (cosmetic === "cave-ragged-shorts") {
      const parent = attach("hips");
      for (const x of [-0.11,0.11]) c(parent,"rough-shorts",[x,-0.12,0],[0.23,0.26,0.27],"#63534a");
      c(parent,"shorts-patch",[-0.11,-0.15,0.14],[0.1,0.11,0.015],"#b3a17c");
    } else if (["cave-tshirt","cave-tank-top","cave-jersey"].includes(cosmetic ?? "")) {
      const parent = attach("spine");
      const color = cosmetic === "cave-jersey" ? "#b52d43" : cosmetic === "cave-tank-top" ? "#708b8c" : "#d7d2c4";
      c(parent,"shirt",[0,0.11,0],[0.46,0.45,0.29],color);
      if (cosmetic === "cave-jersey") {
        c(parent,"jersey-stripe",[0,0.1,0.15],[0.08,0.37,0.012],"#f2e6d1");
      }
    }
  }
  destroy() { this.cosmeticRoot.destroy(); this.equipment.destroy(); for (const material of this.materials) material.destroy(); }
}
