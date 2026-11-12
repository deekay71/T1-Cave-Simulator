/**
 * Rank gear and shop looks of a fan avatar, built from the GLBs of tools/models/groups/props.ts
 * (no primitives). Local preview only: nothing here is authoritative or networked.
 *
 *   preloadGear(app)                      // once; avatar.ts starts it with preloadAvatars
 *   const v = new ProgressionVisuals(app, rig, model, { cannula });
 *   v.set(rank, cosmeticId)               // any time: before / after the GLBs arrive, repeatedly
 *   v.rank                                // the rank whose gear is actually built (1 until loaded)
 *   v.sync(); v.setSeated(...); ...       // every frame, from avatar.ts (see the rank layers there)
 *   v.destroy()
 *
 * Ranks (packages/shared/src/progression.ts): 2 "Tê Thở" oxygen cylinder on a hand trolley pulled
 * by the left hand + flexible hose + nasal cannula; 3 "Tê Nạng" a pair of patched wooden
 * crutches; 4 "Tê Lăn" the wheelchair; 5 "Tê Liệt" the metal bed on swivel casters with the bed
 * cover and a phone. Shop looks: wearables are "fit_<joint>" nodes parented to the rig joints;
 * the keyboard is slung across the back on a rope, or lies on the lap (rank 4, 5).
 *
 * Everything lives under the avatar's entity, so it is hidden with it. Gear uses the SAME material
 * instances as the avatar's body (and its batch group), re-checked every frame: when main.ts swaps
 * the body to its shared batch material or to the dithered self-fade clone, the gear follows;
 * materials the body does not have (tl_cloth, the phone's tl_glow) get a clone that copies the
 * body's dither / opacity. Entities are destroyed with the avatar; container materials never are.
 */
import * as pc from "playcanvas";
import { angleDelta, pointVelocity, trailAngle, wheelSpin } from "./avatarRankMath.js";
import { instantiateModel, loadModelContainer } from "./models.js";

type V3 = [number, number, number];

/* ------------------------------------------------------------------ assets */

const GEAR_FILES = {
  trolley: "tl_veh_oxygen_trolley_v01",
  hose: "tl_prop_oxygen_hose_flex_v01",
  cannula: "tl_wear_cannula_v01",
  crutch: "tl_prop_crutch_v01",
  wheelchair: "tl_veh_wheelchair_v01",
  bed: "tl_veh_metal_bed_v01",
  bedCover: "tl_prop_bed_cover_v01",
  bedCasters: "tl_prop_bed_casters_v01",
  phone: "tl_prop_phone_v01",
  tshirt: "tl_wear_tshirt_v01",
  tankTop: "tl_wear_tank_top_v01",
  jersey: "tl_wear_jersey_v01",
  shorts: "tl_wear_shorts_v01",
  glasses: "tl_wear_glasses_v01",
  keyboard: "tl_prop_keyboard_v01",
} as const;
type GearKey = keyof typeof GEAR_FILES;

/** Shop style key (COSMETICS[].styleKey / id) -> wearable asset. Unknown ids show nothing. */
const COSMETIC_ASSET: Readonly<Record<string, GearKey>> = {
  "cave-glasses": "glasses",
  "cave-keyboard": "keyboard",
  "cave-ragged-shorts": "shorts",
  "cave-tshirt": "tshirt",
  "cave-tank-top": "tankTop",
  "cave-jersey": "jersey",
};
export const COSMETIC_IDS: readonly string[] = Object.freeze(Object.keys(COSMETIC_ASSET));

interface ManifestAsset {
  name: string;
  file: string;
  anchors?: Record<string, V3>;
  meta?: Record<string, unknown>;
}

/** Numbers the animation needs, from manifest.props.json (defaults = the generator's values). */
export interface GearDims {
  trolley: { axle: V3; handle: V3; hoseOut: V3; wheelR: number };
  crutch: { length: number; grip: number };
  casters: { lift: number; wheelR: number };
  /** wheelchair: big wheels and front casters (radius, lateral offset) */
  chair: { wheelR: number; wheelX: number; casterR: number; casterX: number };
  cannulaInlet: V3;
}
const DIMS: GearDims = {
  trolley: { axle: [0, 0.085, 0.03], handle: [0, 0.985, 0.1], hoseOut: [-0.0595, 0.982, -0.078], wheelR: 0.085 },
  crutch: { length: 1.27, grip: 0.82 },
  casters: { lift: 0.115, wheelR: 0.052 },
  chair: { wheelR: 0.3, wheelX: 0.285, casterR: 0.07, casterX: 0.215 },
  cannulaInlet: [0, -0.04, 0.094],
};
export const gearDims = (): GearDims => DIMS;

const MODELS_URL = `${import.meta.env.BASE_URL}models/`;
const containers = new Map<GearKey, pc.ContainerResource>();
let loading: Promise<boolean> | null = null;
let ready = false;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vec = (v: V3 | undefined, d: V3): V3 => (Array.isArray(v) && v.length === 3 ? v : d);

function readDims(assets: ManifestAsset[]) {
  const get = (k: GearKey) => assets.find((a) => a.name === GEAR_FILES[k]);
  const t = get("trolley");
  DIMS.trolley.axle = vec(t?.anchors?.axle, DIMS.trolley.axle);
  DIMS.trolley.handle = vec(t?.anchors?.handle, DIMS.trolley.handle);
  DIMS.trolley.hoseOut = vec(t?.anchors?.hose_out, DIMS.trolley.hoseOut);
  DIMS.trolley.wheelR = num(t?.meta?.wheelRadius, DIMS.trolley.wheelR);
  const c = get("crutch");
  DIMS.crutch.length = num(c?.meta?.length, DIMS.crutch.length);
  DIMS.crutch.grip = num(c?.meta?.gripHeight, DIMS.crutch.grip);
  const k = get("bedCasters");
  DIMS.casters.lift = num(k?.meta?.lift, DIMS.casters.lift);
  DIMS.casters.wheelR = num(k?.meta?.wheelRadius, DIMS.casters.wheelR);
  DIMS.cannulaInlet = vec(get("cannula")?.anchors?.inlet, DIMS.cannulaInlet);
}

/**
 * Load the gear manifest + GLBs once. Resolves true when everything is there; never rejects (a
 * failure resolves false and the next call retries what is missing). Avatars keep their plain
 * look until it resolved.
 */
export function preloadGear(app: pc.AppBase): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (!loading) {
    const attempt = (async () => {
      try {
        const r = await fetch(`${MODELS_URL}manifest.props.json`);
        if (!r.ok) throw new Error(`gear: manifest.props.json HTTP ${r.status}`);
        const assets = ((await r.json()) as { assets: ManifestAsset[] }).assets;
        const todo = (Object.keys(GEAR_FILES) as GearKey[]).filter((k) => !containers.has(k));
        await Promise.all(
          todo.map(async (k) => {
            const a = assets.find((x) => x.name === GEAR_FILES[k]);
            if (!a) throw new Error(`gear: ${GEAR_FILES[k]} missing from manifest.props.json`);
            containers.set(k, await loadModelContainer(app, MODELS_URL + a.file));
          }),
        );
        readDims(assets);
        ready = true;
        return true;
      } catch (err) {
        console.warn("[avatar] rank gear not loaded:", err);
        return false;
      }
    })();
    loading = attempt;
    void attempt.then((ok) => {
      if (!ok && loading === attempt) loading = null; // allow a retry
    });
  }
  return loading;
}
export const gearReady = (): boolean => ready;

/* ------------------------------------------------------------------ shared materials */

/** One instance per material name for gear worn by avatars that use the stock materials. */
const stock = new Map<string, pc.Material>();
/** Clones that follow a dithered (self-fade) body material: body material -> name -> clone. */
const faded = new WeakMap<pc.Material, Map<string, pc.StandardMaterial>>();

const dithered = (m: pc.Material): m is pc.StandardMaterial =>
  m instanceof pc.StandardMaterial && m.opacityDither !== pc.DITHER_NONE;

function gearMaterial(body: pc.Material, src: pc.Material): pc.Material {
  if (src.name === body.name) return body;
  if (!dithered(body) || !(src instanceof pc.StandardMaterial)) {
    const s = stock.get(src.name);
    if (s) return s;
    stock.set(src.name, src);
    return src;
  }
  let set = faded.get(body);
  if (!set) faded.set(body, (set = new Map()));
  let own = set.get(src.name);
  if (!own) {
    own = src.clone();
    own.opacityDither = body.opacityDither;
    own.opacityShadowDither = body.opacityShadowDither;
    own.opacity = body.opacity;
    own.update();
    set.set(src.name, own);
  }
  return own;
}

/* ------------------------------------------------------------------ visuals */

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const HOSE_SAMPLES = 13;
/** trolley: where the left hand holds the handle (model space), standing and pulling */
const TROLLEY_X = 0.41;
const TROLLEY_Z_IDLE = -0.03;
const TROLLEY_Z_PULL = -0.2;
const TROLLEY_TILT = 31 / DEG;

interface Wearable {
  /** every entity to destroy */
  parts: pc.Entity[];
  keyboard: pc.Entity | null;
}

export class ProgressionVisuals {
  /** Rank whose gear is built and attached: what the avatar should pose for. */
  rank = 1;
  /** Model-space point of the trolley's handle the left hand holds (rank 2), refreshed by trolley(). */
  readonly grip = new pc.Vec3();
  /** The two crutches (rank 3): [left, right], children of the rig, pivot at the tip. */
  readonly crutches: pc.Entity[] = [];
  /** Phone in the right hand (rank 5); avatar.ts aims it at the eyes once the pose is applied. */
  phone: pc.Entity | null = null;
  phoneAimed = false;

  private wantRank = 1;
  private wantCosmetic: string | null = null;
  private builtCosmetic: string | null = null;
  private builtCosmeticRank = 0;
  private dead = false;
  private seated = false;
  private waiting = false;

  /** rank gear entities (some are parented to joints) */
  private rankParts: pc.Entity[] = [];
  private wear: Wearable | null = null;
  /** every render component of the gear, for material / batch adoption */
  private renders: pc.RenderComponent[] = [];
  private originals = new Map<pc.MeshInstance, pc.Material>();
  private readonly bodyRender: pc.RenderComponent | null;
  private seenMaterial: pc.Material | null = null;
  private seenGroup = -2;
  private seenOpacity = -1;

  // rank 2
  private cart: pc.Entity | null = null;
  private trolleyWheels: pc.GraphNode[] = [];
  private hoseSegs: pc.GraphNode[] = [];
  private heading = 0;
  private headingSet = false;
  private pull = 0;
  private spin = 0;
  private lastAxleZ = 0;
  private readonly hoseStart = new pc.Vec3();
  private readonly hosePts: pc.Vec3[] = Array.from({ length: 4 }, () => new pc.Vec3());
  private readonly samples: pc.Vec3[] = Array.from({ length: HOSE_SAMPLES }, () => new pc.Vec3());
  // rank 4
  private chairWheels: pc.GraphNode[] = [];
  private chairCasters: pc.GraphNode[] = [];
  private wheelL = 0;
  private wheelR = 0;
  private casterSpin = 0;
  // rank 5
  private cover: pc.Entity | null = null;
  private casters: { swivel: pc.GraphNode; wheel: pc.GraphNode; x: number; z: number; yaw: number; spin: number }[] = [];

  private readonly tq = new pc.Quat();
  private readonly tq2 = new pc.Quat();
  private readonly tv = new pc.Vec3();
  private readonly pv = { x: 0, z: 0 };

  constructor(
    private readonly app: pc.AppBase,
    /** parent of the character model: gear in "model space" goes here */
    private readonly rig: pc.Entity,
    private readonly model: pc.Entity,
    private readonly opts: { cannula: boolean },
  ) {
    this.bodyRender = (model.findComponent("render") as pc.RenderComponent | null) ?? null;
  }

  /** Ask for a look. Builds at once when the GLBs are loaded, otherwise as soon as they are. */
  set(rank: number, cosmetic: string | null): void {
    if (this.dead) return;
    this.wantRank = rank;
    this.wantCosmetic = cosmetic && COSMETIC_ASSET[cosmetic] ? cosmetic : null;
    if (this.wantRank === this.rank && this.wantCosmetic === this.builtCosmetic && this.builtCosmeticRank === this.rank) return;
    if (ready) {
      this.build();
      return;
    }
    if (this.wantRank <= 1 && !this.wantCosmetic) {
      this.build(); // nothing to load for the plain look
      return;
    }
    if (this.waiting) return;
    this.waiting = true;
    void preloadGear(this.app).then((ok) => {
      this.waiting = false;
      if (ok && !this.dead) this.build();
    });
  }

  /** Shrine seat: rank gear and the keyboard are put away, wearables stay on. */
  setSeated(seated: boolean): void {
    if (seated === this.seated) return;
    this.seated = seated;
    for (const e of this.rankParts) e.enabled = !seated;
    if (this.wear?.keyboard) this.wear.keyboard.enabled = !seated;
  }

  destroy(): void {
    this.dead = true;
    this.clearRank();
    this.clearWear();
  }

  /* ---------------- building */

  private build() {
    const rank = ready ? this.wantRank : 1;
    const cosmetic = ready ? this.wantCosmetic : null;
    if (rank !== this.rank) {
      this.clearRank();
      this.rank = rank;
      if (rank === 2) this.buildOxygen();
      else if (rank === 3) this.buildCrutches();
      else if (rank === 4) this.buildChair();
      else if (rank === 5) this.buildBed();
      for (const e of this.rankParts) e.enabled = !this.seated;
    }
    if (cosmetic !== this.builtCosmetic || this.builtCosmeticRank !== this.rank) {
      this.clearWear();
      this.builtCosmetic = cosmetic;
      this.builtCosmeticRank = this.rank;
      if (cosmetic) this.buildWear(COSMETIC_ASSET[cosmetic]);
    }
    this.collect();
    this.adopt();
  }

  private make(key: GearKey): pc.Entity {
    const res = containers.get(key);
    if (!res) throw new Error(`gear ${key} not loaded`);
    return instantiateModel(res);
  }
  private joint(name: string): pc.GraphNode {
    return this.model.findByName(name) ?? this.model;
  }
  /** Move every "fit_<joint>" node of an instance under its joint; returns them. */
  private fit(inst: pc.Entity): pc.Entity[] {
    const nodes = inst.find((n) => n.name.startsWith("fit_")) as pc.Entity[];
    for (const n of nodes) {
      n.reparent(this.joint(n.name.slice(4)));
      n.setLocalPosition(0, 0, 0);
      n.setLocalEulerAngles(0, 0, 0);
    }
    inst.destroy();
    return nodes;
  }

  private clearRank() {
    for (const e of this.rankParts) e.destroy();
    this.rankParts = [];
    this.crutches.length = 0;
    this.cart = null;
    this.trolleyWheels = [];
    this.hoseSegs = [];
    this.chairWheels = [];
    this.chairCasters = [];
    this.cover = null;
    this.casters = [];
    this.phone = null;
    this.phoneAimed = false;
    this.headingSet = false;
    this.pull = 0;
  }
  private clearWear() {
    if (this.wear) for (const e of this.wear.parts) e.destroy();
    this.wear = null;
  }

  private buildOxygen() {
    const d = DIMS.trolley;
    // pivot on the axle line so the trolley tilts about it
    const pivot = new pc.Entity("gear-trolley");
    const body = this.make("trolley");
    body.setLocalPosition(-d.axle[0], -d.axle[1], -d.axle[2]);
    pivot.addChild(body);
    this.rig.addChild(pivot);
    this.cart = pivot;
    this.trolleyWheels = ["wheel_l", "wheel_r"].map((n) => body.findByName(n)).filter((n): n is pc.GraphNode => !!n);
    const hose = this.make("hose");
    hose.name = "gear-hose";
    this.rig.addChild(hose);
    this.hoseSegs = (hose.find((n) => n.name.startsWith("seg_")) as pc.GraphNode[]).sort((a, b) => (a.name < b.name ? -1 : 1));
    this.rankParts.push(pivot, hose);
    if (!this.opts.cannula) this.rankParts.push(...this.fit(this.make("cannula")));
    pivot.setLocalPosition(TROLLEY_X, d.axle[1], TROLLEY_Z_IDLE - d.handle[2] + d.axle[2]);
  }

  private buildCrutches() {
    for (let i = 0; i < 2; i++) {
      const c = this.make("crutch");
      c.name = i ? "gear-crutch-r" : "gear-crutch-l";
      this.rig.addChild(c);
      c.setLocalPosition(i ? -0.34 : 0.34, 0, 0.12);
      this.crutches.push(c);
      this.rankParts.push(c);
    }
  }

  private buildChair() {
    const chair = this.make("wheelchair");
    chair.name = "gear-wheelchair";
    this.rig.addChild(chair);
    const pick = (n: string) => chair.findByName(n);
    this.chairWheels = [pick("wheel_l"), pick("wheel_r")].filter((n): n is pc.GraphNode => !!n);
    this.chairCasters = [pick("caster_l"), pick("caster_r")].filter((n): n is pc.GraphNode => !!n);
    this.rankParts.push(chair);
  }

  private buildBed() {
    const lift = DIMS.casters.lift;
    const bed = this.make("bed");
    bed.name = "gear-bed";
    bed.setLocalPosition(0, lift, 0);
    const blanket = bed.findByName("blanket");
    if (blanket) blanket.enabled = false; // the cover lies over the fan instead
    const cover = this.make("bedCover");
    cover.name = "gear-bed-cover";
    cover.setLocalPosition(0, lift, 0);
    const casters = this.make("bedCasters");
    casters.name = "gear-bed-casters";
    this.rig.addChild(bed);
    this.rig.addChild(cover);
    this.rig.addChild(casters);
    this.cover = cover;
    for (const n of ["caster_fl", "caster_fr", "caster_rl", "caster_rr"]) {
      const swivel = casters.findByName(n);
      const wheel = casters.findByName(`${n}_wheel`);
      if (!swivel || !wheel) continue;
      const p = swivel.getLocalPosition();
      this.casters.push({ swivel, wheel, x: p.x, z: p.z, yaw: 0, spin: 0 });
    }
    const phone = this.make("phone");
    phone.name = "gear-phone";
    this.joint("arm_lower_r").addChild(phone);
    phone.setLocalPosition(-0.02, -0.35, 0.02);
    this.phone = phone;
    this.rankParts.push(bed, cover, casters, phone);
  }

  private buildWear(key: GearKey) {
    const inst = this.make(key);
    if (key !== "keyboard") {
      this.wear = { parts: this.fit(inst), keyboard: null };
      return;
    }
    // keyboard: slung across the back on a rope (free hands for the trolley / crutches / emotes,
    // and the follow camera sees it); in the wheelchair and the bed it lies on the lap
    inst.name = "gear-keyboard";
    const sling = inst.findByName("sling") as pc.Entity | null;
    const parts: pc.Entity[] = [inst];
    if (this.rank === 4) {
      if (sling) sling.enabled = false;
      this.joint("hips").addChild(inst);
      inst.setLocalPosition(0, 0.04, 0.175);
      inst.setLocalEulerAngles(-10, 0, 0);
    } else if (this.rank === 5) {
      if (sling) sling.enabled = false;
      this.rig.addChild(inst);
      inst.setLocalPosition(0.03, DIMS.casters.lift + 0.652, 0.27);
      inst.setLocalEulerAngles(2, 172, 0);
    } else {
      const spine = this.joint("spine");
      spine.addChild(inst);
      inst.setLocalPosition(0.012, 0.085, -0.153);
      inst.setLocalEulerAngles(-90, 0, 35);
      if (sling) {
        sling.reparent(spine);
        sling.setLocalPosition(0, 0, 0);
        sling.setLocalEulerAngles(0, 0, 0);
        parts.push(sling);
      }
    }
    inst.enabled = !this.seated;
    this.wear = { parts, keyboard: inst };
  }

  /* ---------------- materials + batching follow the body */

  private collect() {
    this.renders = [];
    this.originals.clear();
    const add = (e: pc.Entity) => {
      for (const r of e.findComponents("render") as pc.RenderComponent[]) {
        this.renders.push(r);
        for (const mi of r.meshInstances) if (mi.material) this.originals.set(mi, mi.material);
      }
    };
    for (const e of this.rankParts) add(e);
    if (this.wear) for (const e of this.wear.parts) add(e);
    this.seenMaterial = null;
  }

  private adopt() {
    const br = this.bodyRender;
    const body = br?.meshInstances[0]?.material;
    if (!br || !body) return;
    for (const r of this.renders) {
      for (const mi of r.meshInstances) {
        const src = this.originals.get(mi) ?? mi.material;
        if (!src) continue;
        const m = gearMaterial(body, src);
        if (mi.material !== m) mi.material = m;
      }
      if (r.batchGroupId !== br.batchGroupId) r.batchGroupId = br.batchGroupId;
    }
    this.seenMaterial = body;
    this.seenGroup = br.batchGroupId;
    this.syncOpacity(body);
  }

  private syncOpacity(body: pc.Material) {
    const o = body instanceof pc.StandardMaterial ? body.opacity : 1;
    this.seenOpacity = o;
    const set = faded.get(body);
    if (!set) return;
    for (const m of set.values())
      if (m.opacity !== o) {
        m.opacity = o;
        m.update();
      }
  }

  /** Every frame: keep the gear on the body's material instance, batch group and fade. */
  sync(): void {
    const br = this.bodyRender;
    if (!br || !this.renders.length) return;
    const body = br.meshInstances[0]?.material;
    if (!body) return;
    if (body !== this.seenMaterial || br.batchGroupId !== this.seenGroup) this.adopt();
    else if (body instanceof pc.StandardMaterial && body.opacity !== this.seenOpacity) this.syncOpacity(body);
  }

  /* ---------------- rank 2: trolley + hose */

  /**
   * Trolley pulled by the left hand. moving 0..1 (the avatar's walk weight), dist = metres moved
   * this frame, yaw = the avatar's world yaw (rad). The trolley trails the turn like a trailer,
   * tilts toward the hand while pulled and stands up beside the fan at rest. Updates `grip`.
   */
  trolley(dt: number, moving: number, dist: number, yaw: number): void {
    const t = this.cart;
    if (!t) return;
    const d = DIMS.trolley;
    if (!this.headingSet) {
      this.heading = yaw;
      this.headingSet = true;
      this.pull = moving;
    }
    this.heading = trailAngle(this.heading, yaw, dt, 0.16, 9);
    let rel = angleDelta(this.heading, yaw);
    // never swing through the fan (turning right) nor fold forward (turning left)
    if (rel > 0.55) rel = 0.55;
    else if (rel < -1.0) rel = -1.0;
    this.heading = yaw + rel;
    this.pull += (moving - this.pull) * (1 - Math.exp(-dt / 0.16));
    const pull = this.pull;
    const tilt = pull * TROLLEY_TILT;
    const hy = d.handle[1] - d.axle[1],
      hz = d.handle[2] - d.axle[2];
    const ct = Math.cos(tilt),
      st = Math.sin(tilt);
    const back = hy * st + hz * ct;
    const gz = TROLLEY_Z_IDLE + (TROLLEY_Z_PULL - TROLLEY_Z_IDLE) * pull;
    this.grip.set(TROLLEY_X, d.axle[1] + hy * ct - hz * st, gz);
    const sr = Math.sin(rel),
      cr = Math.cos(rel);
    const ax = TROLLEY_X - back * sr,
      az = gz - back * cr;
    t.setLocalPosition(ax, d.axle[1], az);
    const q = this.tq.setFromEulerAngles(0, rel * DEG, 0).mul(this.tq2.setFromEulerAngles(tilt * DEG, 0, 0));
    t.setLocalRotation(q);
    // wheels: the fan's travel plus the axle's own slide when it parks / falls back
    this.spin += (dist * cr + (az - this.lastAxleZ)) / d.wheelR;
    this.lastAxleZ = az;
    const deg = ((this.spin % TAU) * DEG);
    for (const w of this.trolleyWheels) w.setLocalEulerAngles(deg, 0, 0);
    // hose start (model space)
    this.tv.set(d.hoseOut[0] - d.axle[0], d.hoseOut[1] - d.axle[1], d.hoseOut[2] - d.axle[2]);
    q.transformVector(this.tv, this.hoseStart);
    this.hoseStart.x += ax;
    this.hoseStart.y += d.axle[1];
    this.hoseStart.z += az;
  }

  /**
   * Lay the flexible hose from the trolley's outlet over the left shoulder (model-space point
   * `over`) to the cannula inlet at the jaw (`inlet`), hanging in a loop in between.
   */
  hose(over: pc.Vec3, inlet: pc.Vec3): void {
    const segs = this.hoseSegs;
    if (!segs.length) return;
    const [p0, p1, p2, p3] = this.hosePts;
    p0.copy(this.hoseStart);
    // the slack hangs outside the arm, below the straight line
    p1.lerp(p0, over, 0.42);
    p1.x += 0.07;
    p1.y -= 0.1 + 0.05 * this.pull;
    p1.z -= 0.05;
    p2.copy(over);
    p3.copy(inlet);
    const pts = this.hosePts;
    const S = this.samples;
    const n = S.length - 1;
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * 3;
      const k = Math.min(2, Math.floor(f));
      const u = f - k;
      const a = pts[Math.max(0, k - 1)],
        b = pts[k],
        c = pts[k + 1],
        e = pts[Math.min(3, k + 2)];
      const u2 = u * u,
        u3 = u2 * u;
      const w0 = -u + 2 * u2 - u3,
        w1 = 2 - 5 * u2 + 3 * u3,
        w2 = u + 4 * u2 - 3 * u3,
        w3 = -u2 + u3;
      S[i].set(
        0.5 * (w0 * a.x + w1 * b.x + w2 * c.x + w3 * e.x),
        0.5 * (w0 * a.y + w1 * b.y + w2 * c.y + w3 * e.y),
        0.5 * (w0 * a.z + w1 * b.z + w2 * c.z + w3 * e.z),
      );
    }
    const m = Math.min(n, segs.length);
    for (let i = 0; i < m; i++) {
      const a = S[i],
        b = S[i + 1];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      // shortest arc +Y -> segment direction
      const w = 1 + dy / len;
      const q = this.tq;
      if (w < 1e-6) q.set(1, 0, 0, 0);
      else {
        const qx = dz / len,
          qz = -dx / len;
        const l = 1 / Math.sqrt(qx * qx + qz * qz + w * w);
        q.set(qx * l, 0, qz * l, w * l);
      }
      const s = segs[i];
      s.setLocalPosition(a.x, a.y, a.z);
      s.setLocalRotation(q);
      s.setLocalScale(1, len * 1.04, 1);
    }
  }

  /* ---------------- rank 4: wheelchair */

  /** Spin the big wheels and the casters: forward metres and yaw change (rad, + = left) this frame. */
  rollChair(forward: number, dYaw: number): void {
    const c = DIMS.chair;
    this.wheelL = (this.wheelL + wheelSpin(forward, dYaw, c.wheelX, c.wheelR)) % TAU;
    this.wheelR = (this.wheelR + wheelSpin(forward, dYaw, -c.wheelX, c.wheelR)) % TAU;
    this.casterSpin = (this.casterSpin + forward / c.casterR) % TAU;
    this.chairWheels[0]?.setLocalEulerAngles(this.wheelL * DEG, 0, 0);
    this.chairWheels[1]?.setLocalEulerAngles(this.wheelR * DEG, 0, 0);
    for (const k of this.chairCasters) k.setLocalEulerAngles(this.casterSpin * DEG, 0, 0);
  }

  /* ---------------- rank 5: bed */

  /**
   * Bed casters: (vx, vz) = the bed's velocity in its own frame (m/s), yawRate rad/s (+ = left).
   * Each caster swivels to trail the motion under its post and spins by its travel.
   */
  rollBed(dt: number, vx: number, vz: number, yawRate: number): void {
    const r = DIMS.casters.wheelR;
    for (const c of this.casters) {
      const v = pointVelocity(vx, vz, yawRate, c.x, c.z, this.pv);
      const sp = Math.sqrt(v.x * v.x + v.z * v.z);
      if (sp > 0.04) {
        c.yaw = trailAngle(c.yaw, Math.atan2(v.x, v.z), dt, 0.07, 16);
        c.spin = (c.spin + (sp * dt) / r) % TAU;
        c.swivel.setLocalEulerAngles(0, c.yaw * DEG, 0);
        c.wheel.setLocalEulerAngles(c.spin * DEG, 0, 0);
      }
    }
  }
  /** Breathing under the cover: b in -1..1. */
  breathe(b: number): void {
    this.cover?.setLocalScale(1, 1 + 0.012 * b, 1);
  }
}
