import { CAVE_STALLS, CAVE_SHRINE_GATE, stallApproach, type CaveStall, type CaveStallId } from "./stalls.js";
import { tunnelRooms, type Room } from "./rooms.js";
/**
 * Bố cục "Hang trú thua" theo concept v3 (design/concepts/v3/01–04): bảng đặt mọi model GLB của
 * hub và collider tròn của chúng. Đây là nguồn sự thật duy nhất: client dựng cảnh từ
 * HUB_PLACEMENTS, còn server và client cùng suy ra HUB_LAYOUT.obstacles từ đó (packages/shared).
 * Chỉ có dữ liệu thuần và vài hàm nhỏ, không import PlayCanvas.
 *
 * Thế giới gồm năm hang (vỏ: nhóm model "caves", tools/models/groups/caves.ts): một hang lớn sinh
 * hoạt chung quanh lửa trại và bốn hang nhỏ nối bằng đường hầm đi bộ, mỗi hang nhỏ một sạp
 * (HUB_CAVES). Vùng đi được là hợp các hình tròn HUB_ROOMS (rooms.ts): hang lớn r 20 m, hang nhỏ
 * r 7 m, đường hầm rộng 3,4 m.
 *
 * Không gian hang: gốc = tâm lửa trại, mét, Y hướng lên. Người chơi xuất hiện quanh (0, 10) và
 * nhìn về -Z: cửa hang (cửa điện thờ) ở phía sau (-Z), bên trái màn hình là -X (góc thùng, nước, màn
 * hình lớn bắt vào vách sau-trái), bên phải là +X (góc sinh hoạt, góc thâm niên). Bốn miệng hầm ở các hướng 60°, 120°, 240°, 300° tính
 * từ +Z theo chiều +X. Model nào cũng quay mặt về +Z; yaw θ (độ, setLocalEulerAngles(0, θ, 0)) quay
 * mặt model sang (sin θ, 0, cos θ).
 *
 * Collider là các hình tròn {dx, dz, r} trong mặt phẳng XZ cục bộ của model (trước khi xoay yaw),
 * đã cộng sẵn khoảng thân người chơi. Luật (scripts/movement.test.ts kiểm tra), để constrain() hội
 * tụ và không có khe hẹp cho người chơi lách qua giữa hai món đồ:
 * - hai vật cản bất kỳ hoặc chồng sâu (khoảng cách tâm² ≤ r1² + r2²), hoặc cách nhau ≥ MIN_GAP
 *   (một lối đi thật), trừ khi khe đó nằm trọn trong một vật cản thứ ba;
 * - mỗi vật cản hoặc nằm trọn trong một phòng và cách biên phòng đó ≥ MIN_GAP, hoặc là "khối chặn
 *   sát vách": tâm ở ngoài biên phòng đủ xa (khoảng cách tâm² ≥ R² + r², R = bán kính phòng) để lấn
 *   vào vùng đi được mà góc tạo với biên vẫn tù. Khối chặn bịt kín lối men theo vách (vách ký ức,
 *   bảng đố, kệ thùng trước màn hình và quầy trang phục trước hốc đá của các hang nhỏ).
 */

export type Vec3 = readonly [number, number, number];
/** Hình tròn va chạm trong hệ trục cục bộ của model (m). */
export interface Circle {
  readonly dx: number;
  readonly dz: number;
  readonly r: number;
}
/** Vật cản tròn trong không gian hang (đã xoay theo yaw, làm tròn 1 mm). */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}
/** Giá trị một khớp trong pose: góc Euler tuyệt đối (độ) hoặc {rot, at} như manifest.characters.json. */
export type PoseJoint = Vec3 | { readonly rot?: Vec3; readonly at?: Vec3 };
/** Đồ vật NPC cầm: gắn vào một khớp nên đi theo nhịp thở. */
export interface HeldProp {
  /** "<group>/<name>" của GLB. */
  readonly asset: string;
  /** Khớp cầm, ví dụ "arm_lower_r". */
  readonly node: string;
  /** Vị trí trong hệ trục cục bộ của khớp (m). */
  readonly at: Vec3;
  /** Hướng của đồ vật so với hệ trục của NPC (Euler độ), chốt lúc đặt; mặc định đứng thẳng. */
  readonly rot?: Vec3;
  /** Quay mặt +Y của đồ vật (màn hình điện thoại) về điểm `at` trong hệ trục khớp `node`; thay cho rot. */
  readonly aim?: { readonly node: string; readonly at: Vec3 };
}
/** Fan NPC tĩnh (chỉ client, không đồng bộ mạng). */
export interface NpcSpec {
  /** Tên pose trong manifest.characters.json. */
  readonly pose: string;
  /** Ghi đè từng khớp sau pose (cùng định dạng với manifest). */
  readonly tweak?: Readonly<Record<string, PoseJoint>>;
  readonly hold?: HeldProp;
}
/** Một model đặt trong hang. */
export interface Placement {
  /** "<group>/<name>": /models/<group>/<name>.glb, mô tả trong /models/manifest.<group>.json. */
  readonly asset: string;
  readonly x: number;
  readonly z: number;
  /** Độ; 0 = model nhìn về +Z. */
  readonly yaw: number;
  /** Độ cao pivot (đồ chồng lên nhau), mặc định 0. */
  readonly y?: number;
  /** Tỉ lệ đều, mặc định 1. */
  readonly scale?: number;
  /** Phần đặc của model; không có = đi xuyên được (đá vụn, thảm, vũng nước, đồ trên bàn). */
  readonly colliders?: readonly Circle[];
  /** Có mặt = fan NPC ngồi/nằm/đứng theo pose. */
  readonly npc?: NpcSpec;
  /** Hệ số cường độ cho đèn khai báo trong manifest của model (0 = tắt), mặc định 1. */
  readonly light?: number;
  /** Tên node con của GLB cần ẩn (ví dụ "blanket" của giường khi đắp chăn khác lên). */
  readonly hide?: readonly string[];
}
export type LandmarkId = CaveStallId | "rest" | "altar" | "screen";
export interface Landmark {
  readonly id: LandmarkId;
  readonly name: string;
  /** Chỗ người chơi đứng nhìn đồ vật (bấm E khi cách < 3 m). */
  readonly x: number;
  readonly z: number;
}

/**
 * Biên đi được của hang lớn: nền phẳng tới r = 21 m, vách gần nhất cách tâm 22,76 m
 * (manifest.caves.json, tl_cave_main_floor meta.walk).
 */
export const HUB_RADIUS = 20;
/** Bán kính đi được của mỗi hang nhỏ (vách gần nhất 7,75 m) và nửa bề rộng lối đi trong hầm. */
export const SIDE_CAVE_RADIUS = 7;
export const TUNNEL_RADIUS = 1.7;
/** Trần cho camera (m) theo loại phòng: dưới đó không có đá trong vùng đi được nới 0,75 m. */
export const CAVE_CAMERA_TOP = { main: 9, tunnel: 2.6, side: 3.2 } as const;
/** Camera được ra ngoài hợp các phòng tối đa chừng này (m). */
export const CAVE_CAMERA_MARGIN = 0.6;
/** Người chơi xuất hiện quanh điểm này, nhìn về lửa trại và cửa hang (-Z). */
export const HUB_SPAWN = { x: 0, z: 10, spread: 1.5 } as const;
/** Đĩa quanh điểm xuất hiện luôn trống. */
export const SPAWN_CLEAR_RADIUS = 2.5;
/** Khe hẹp nhất được phép giữa hai vật cản, hoặc giữa vật cản và biên (m); nhỏ hơn thì phải bịt kín. */
export const MIN_GAP = 0.4;

const DEG = Math.PI / 180;
/** Làm tròn 1 mm để mọi engine JS ra cùng một số. */
const mm = (v: number) => Math.round(v * 1000) / 1000 + 0;
const wrapYaw = (deg: number) => {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

/** Yaw (độ, bước 0,5°) để model ở (x, z) quay mặt về (tx, tz), mặc định về lửa trại. */
export function yawToward(x: number, z: number, tx = 0, tz = 0): number {
  return Math.round((Math.atan2(tx - x, tz - z) / DEG) * 2) / 2 + 0;
}

interface Frame {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}
/** Điểm (lx, lz) trong hệ trục của frame → không gian hang (làm tròn 1 mm). */
export function frameToCave(
  frame: Frame,
  lx: number,
  lz: number,
): { x: number; z: number } {
  const c = Math.cos(frame.yaw * DEG),
    s = Math.sin(frame.yaw * DEG);
  return { x: mm(frame.x + lx * c + lz * s), z: mm(frame.z - lx * s + lz * c) };
}

/** Vật cản của một model: xoay collider theo yaw (và scale), làm tròn 1 mm. */
export function placementObstacles(p: Placement): Obstacle[] {
  const s = p.scale ?? 1;
  return (p.colliders ?? []).map((c) => ({
    ...frameToCave(p, c.dx * s, c.dz * s),
    r: mm(c.r * s),
  }));
}

type Item = Omit<Placement, "x" | "z" | "yaw"> & {
  /** Vị trí trong hệ trục của vùng. */
  readonly at: readonly [number, number];
  /** Yaw so với vùng, mặc định 0. */
  readonly yaw?: number;
};
/** Một nhóm đồ đặt theo hệ trục riêng (gốc + yaw của vùng): xê dịch cả vùng chỉ cần sửa frame. */
function zone(frame: Frame, items: readonly Item[]): Placement[] {
  return items.map(({ at, yaw = 0, ...rest }) => ({
    ...rest,
    ...frameToCave(frame, at[0], at[1]),
    yaw: wrapYaw(frame.yaw + yaw),
  }));
}
/** Vị trí quanh lửa trại: bearing 0 = +Z (phía người chơi), 90 = +X, 180 = cửa hang; quay mặt vào lửa. */
function ring(bearing: number, r: number): Frame {
  return {
    x: mm(r * Math.sin(bearing * DEG)),
    z: mm(r * Math.cos(bearing * DEG)),
    yaw: wrapYaw(bearing + 180),
  };
}
/** Đồ trang trí sát vách (ngoài tầm đi), quay mặt vào lửa. */
function wall(
  asset: string,
  bearing: number,
  r: number,
  extra: Partial<Placement> = {},
): Placement {
  return { asset, ...ring(bearing, r), ...extra };
}

/* ---------------------------------------------------------------- tên model */

const M = {
  campfire: "fire/tl_fx_campfire_v01",
  embers: "fire/tl_fx_embers_ring_v01",
  torchPole: "fire/tl_fx_torch_pole_v01",
  torchTripod: "fire/tl_fx_torch_tripod_v01",
  lantern: "fire/tl_fx_lantern_v01",
  stool: "furniture/tl_furn_stool_v01",
  stoolSquare: "furniture/tl_furn_stool_square_v01",
  table: "furniture/tl_furn_table_v01",
  tableLow: "furniture/tl_furn_table_low_v01",
  crateSmall: "furniture/tl_furn_crate_small_v01",
  crateLarge: "furniture/tl_furn_crate_large_v01",
  pallet: "furniture/tl_furn_pallet_v01",
  memoryBoard: "furniture/tl_furn_memory_board_v01",
  quizBoard: "furniture/tl_furn_quiz_board_v01",
  sign: "furniture/tl_sign_entrance_v01",
  signStall: "furniture/tl_sign_stall_v01",
  signStallWide: "furniture/tl_sign_stall_wide_v01",
  stallCheckin: "furniture/tl_furn_stall_checkin_v01",
  stallApparel: "furniture/tl_furn_stall_apparel_v01",
  cordon: "furniture/tl_furn_rope_cordon_v01",
  tarp: "furniture/tl_furn_tarp_shelter_v01",
  clothesline: "furniture/tl_furn_clothesline_v01",
  rug: "furniture/tl_furn_rug_worn_v01",
  tv: "props/tl_prop_tv_crt_v01",
  kettle: "props/tl_prop_kettle_v01",
  noodle: "props/tl_prop_noodle_cup_v01",
  mugWhite: "props/tl_prop_mug_white_v01",
  mugRed: "props/tl_prop_mug_red_v01",
  bed: "props/tl_veh_metal_bed_v01",
  bedCover: "props/tl_prop_bed_cover_v01",
  wheelchair: "props/tl_veh_wheelchair_v01",
  oxygenGreen: "props/tl_prop_oxygen_cylinder_green_v01",
  oxygenWhite: "props/tl_prop_oxygen_cylinder_white_v01",
  hose: "props/tl_prop_oxygen_hose_v01",
  chair: "props/tl_prop_wooden_chair_v01",
  blanket: "props/tl_prop_blanket_folded_v01",
  gamepad: "props/tl_prop_gamepad_v01",
  phone: "props/tl_prop_phone_v01",
  candles: "environment/tl_env_shrine_candles_v01",
  tunnelFrame: "environment/tl_env_tunnel_frame_v01",
  caveGate: "furniture/tl_sign_cave_gate_v01",
  wallScreen: "furniture/tl_furn_wall_screen_v01",
  questBoard: "furniture/tl_furn_quest_board_v01",
  puddle: "environment/tl_env_puddle_v01",
  rockA: "environment/tl_env_rock_cluster_a_v01",
  rockB: "environment/tl_env_rock_cluster_b_v01",
  rockC: "environment/tl_env_rock_cluster_c_v01",
  stalagmiteA: "environment/tl_env_stalagmite_a_v01",
  stalagmiteB: "environment/tl_env_stalagmite_b_v01",
} as const;
const fan = (variant: string) => `characters/tl_char_fan_${variant}_v01`;
/** Chủ sạp (NPC riêng, không bao giờ là trang phục người chơi). */
const host = (who: string) => `characters/tl_char_host_${who}_v01`;
const STALL = Object.fromEntries(CAVE_STALLS.map((s) => [s.id, s])) as Record<CaveStallId, CaveStall>;
/** Hai cột của biển sạp (manifest meta.postColliders): bảng rộng 2,3 m → cột ở ±1,31 m; bảng 3,0 m → ±1,66 m. */
const signPosts = (half: number): Circle[] => [
  { dx: -half, dz: 0, r: 0.2 },
  { dx: half, dz: 0, r: 0.2 },
];

/* ---------------------------------------------------------------- vỏ hang, hang nhỏ, phòng */

export type SideCaveId = "ne_back" | "nw_back" | "nw_front" | "ne_front";
/** Một hang nhỏ nối với hang lớn bằng đường hầm. */
export interface SideCave {
  readonly id: SideCaveId;
  /** Tên hiển thị. */
  readonly name: string;
  /** Sạp nằm trong hang này. */
  readonly stall: CaveStallId;
  /** Tâm hang (m). */
  readonly x: number;
  readonly z: number;
  /** Yaw (độ) của vỏ hang nhỏ và vỏ đường hầm: +Z cục bộ hướng về gốc (hang lớn). */
  readonly yaw: number;
  /** Kiểu vỏ: tl_cave_side_<variant>_v01 + tl_cave_tunnel_<variant>_v01. */
  readonly variant: "a" | "b";
  /** Vị trí vỏ đường hầm (trung điểm hai mặt phẳng miệng hầm). */
  readonly tunnel: { readonly x: number; readonly z: number };
  /** Yaw (độ) của "khung hốc": gốc ở tâm hang, -Z hướng vào hốc đá cuối hang, +Z về tâm hang. */
  readonly nicheYaw: number;
}
/** Hốc đá của vỏ kiểu b lệch 38° so với trục hầm (manifest: nicheRotY). */
const NICHE_TURN = { a: 0, b: 38 } as const;
const sideCave = (
  id: SideCaveId,
  name: string,
  stall: CaveStallId,
  x: number,
  z: number,
  yaw: number,
  variant: "a" | "b",
): SideCave => ({
  id,
  name,
  stall,
  x,
  z,
  yaw,
  variant,
  tunnel: { x: Math.sign(x) * 22.4064, z: Math.sign(z) * 12.9537 },
  nicheYaw: wrapYaw(Math.round((yaw + NICHE_TURN[variant]) * 1e4) / 1e4),
});
/**
 * Bốn hang nhỏ (công thức đặt trong manifest.caves.json, tl_cave_main_floor meta.layout): tâm cách
 * gốc 36,96 m theo hướng u, yaw = atan2(-u.x, -u.z), vỏ đường hầm ở u · 25,8814 m.
 */
export const HUB_CAVES: readonly SideCave[] = [
  sideCave("ne_back", "Hang Quest", "quest", 32, -18.5, -59.9667, "a"),
  sideCave("nw_back", "Hang ký ức", "memory", -32, -18.5, 59.9667, "b"),
  sideCave("nw_front", "Hang đố vui", "quiz", -32, 18.5, 120.0333, "a"),
  sideCave("ne_front", "Hang chợ", "shop", 32, 18.5, -120.0333, "b"),
];
const CAVE = Object.fromEntries(HUB_CAVES.map((c) => [c.id, c])) as Record<SideCaveId, SideCave>;
/** Tiêu điểm trước hốc đá (anchor 'focal' của vỏ hang nhỏ) cách tâm hang chừng này (m). */
export const SIDE_FOCAL_DISTANCE = 7.2;
/**
 * Anchor đuốc của vỏ hang nhỏ, trong hệ trục cục bộ của vỏ (manifest.caves.json): hai bên miệng
 * hang (torch_mouth_a/b) và hai bên hốc đá (torch_niche_a/b, khác nhau theo kiểu vỏ).
 */
const SIDE_TORCH_MOUTH: readonly (readonly [number, number])[] = [
  [4, 6],
  [-4, 6],
];
const SIDE_TORCH_NICHE: Readonly<Record<"a" | "b", readonly (readonly [number, number])[]>> = {
  a: [
    [-3.89, -6.7377],
    [3.89, -6.7377],
  ],
  b: [
    [-7.2135, -2.9144],
    [-1.0828, -7.7043],
  ],
};

/** Lối đi trong hầm: chuỗi hình tròn từ u · 19,6 m (trong hang lớn) tới u · 30,4 m (trong hang nhỏ). */
const TUNNEL_FROM = 19.6;
const TUNNEL_TO = 30.4;
/**
 * Vùng đi được: hợp các phòng tròn. Hang lớn đứng đầu (điểm trong hang lớn trả lời ngay), rồi bốn
 * hang nhỏ, rồi các đường hầm. `top` là trần cho camera của từng phòng. Tâm làm tròn 1 mm.
 */
export const HUB_ROOMS: readonly Room[] = [
  { x: 0, z: 0, r: HUB_RADIUS, top: CAVE_CAMERA_TOP.main, id: "main" },
  ...HUB_CAVES.map((c) => ({
    x: c.x,
    z: c.z,
    r: SIDE_CAVE_RADIUS,
    top: CAVE_CAMERA_TOP.side,
    id: c.id,
  })),
  ...HUB_CAVES.flatMap((c) => {
    const d = Math.sqrt(c.x * c.x + c.z * c.z),
      ux = c.x / d,
      uz = c.z / d;
    return tunnelRooms(
      { x: ux * TUNNEL_FROM, z: uz * TUNNEL_FROM },
      { x: ux * TUNNEL_TO, z: uz * TUNNEL_TO },
      TUNNEL_RADIUS,
      { top: CAVE_CAMERA_TOP.tunnel, id: `tunnel_${c.id}` },
    );
  }),
];

/** Một mảnh vỏ hang (nền, vách, trần, đường hầm, hang nhỏ): không va chạm, không đổ bóng. */
export interface ShellPiece {
  /** "<group>/<name>" của GLB. */
  readonly asset: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /**
   * Phần trần: cả model (`true`) hoặc tên node con chứa trần / vòm. Ẩn cùng nhau khi nhìn từ trên
   * xuống (preset "overview", ceiling: false).
   */
  readonly overhead?: true | string;
}
/** Vỏ hang lớn dựng sẵn trong không gian hang: đặt tại gốc, không xoay. */
export const CAVE_SHELL = [
  "caves/tl_cave_main_floor_v01",
  "caves/tl_cave_main_wall_00_v01",
  "caves/tl_cave_main_wall_01_v01",
  "caves/tl_cave_main_wall_02_v01",
  "caves/tl_cave_main_wall_03_v01",
  "caves/tl_cave_main_wall_04_v01",
  "caves/tl_cave_main_wall_05_v01",
  "caves/tl_cave_main_ceiling_v01",
] as const;
/** Toàn bộ vỏ: hang lớn + bốn đường hầm + bốn hang nhỏ (đặt theo HUB_CAVES). */
export const CAVE_SHELL_PIECES: readonly ShellPiece[] = [
  ...CAVE_SHELL.map(
    (asset): ShellPiece => ({
      asset,
      x: 0,
      z: 0,
      yaw: 0,
      ...(asset.endsWith("_ceiling_v01") ? { overhead: true as const } : {}),
    }),
  ),
  ...HUB_CAVES.flatMap((c): ShellPiece[] => [
    {
      asset: `caves/tl_cave_tunnel_${c.variant}_v01`,
      x: c.tunnel.x,
      z: c.tunnel.z,
      yaw: c.yaw,
      overhead: `tl_cave_tunnel_${c.variant}_roof`,
    },
    {
      asset: `caves/tl_cave_side_${c.variant}_v01`,
      x: c.x,
      z: c.z,
      yaw: c.yaw,
      overhead: `tl_cave_side_${c.variant}_ceiling`,
    },
  ]),
];

/* ---------------------------------------------------------------- pose chung */

/** Ghế đẩu tròn (mặt 0,42 m): hông và chân theo pose sit_stool của manifest. */
const STOOL_SEAT: Readonly<Record<string, PoseJoint>> = {
  hips: { at: [0, 0.6148, -0.05], rot: [0, 0, 0] },
  leg_upper_l: [-91, 0, 0],
  leg_lower_l: [91, 0, 0],
  leg_upper_r: [-91, 0, 0],
  leg_lower_r: [91, 0, 0],
};
/** Cốc cầm tay phải, đứng thẳng (vị trí trong hệ trục cẳng tay, bàn tay ở ~0,27 m). */
const mugInRight = (asset: string): HeldProp => ({
  asset,
  node: "arm_lower_r",
  at: [0.035, -0.27, 0.05],
  rot: [0, 90, 0],
});

/* ---------------------------------------------------------------- lửa trại */

const fire: Placement[] = [
  // Phải đứng đầu: HUB_LAYOUT.obstacles[0] là vòng đá lửa trại.
  {
    asset: M.campfire,
    x: 0,
    z: 0,
    yaw: 0,
    colliders: [{ dx: 0, dz: 0, r: 1.6 }],
  },
  // Nhấc 2 cm: nền phẳng nhấp nhô 1–3,5 cm, đặt ở 0 thì than chìm dưới nền.
  { asset: M.embers, x: 0, z: 0, yaw: 0, y: 0.02 },
];

/**
 * Hạng 01 "Rách rưới" (concept 03 #01): ngồi trên thùng gỗ thấp (thùng nhỏ thu 0,78 → mặt 0,47 m),
 * một tay ôm trán, cẳng tay kia tì lên đầu gối, hai gối hơi dạng. Trước-trái lửa, gần camera concept.
 */
const RANK01 = ring(312, 2.9);
const rank01: Placement[] = zone(RANK01, [
  { asset: M.crateSmall, at: [0, 0], yaw: 4, scale: 0.78 },
  {
    asset: fan("torn_jersey"),
    at: [0, 0.08],
    colliders: [{ dx: 0, dz: 0.12, r: 0.55 }],
    npc: {
      pose: "head_in_hands",
      tweak: {
        hips: { at: [0, 0.663, -0.05], rot: [0, 0, 0] },
        spine: [40, 0, 0],
        neck: [6, 0, 0],
        head: [22, 0, 0],
        arm_upper_l: [-30, -10, -10],
        arm_lower_l: [-70, 0, 0],
        leg_upper_l: [-86, 10, 0],
        leg_lower_l: [86, 0, 0],
        leg_upper_r: [-86, -10, 0],
        leg_lower_r: [86, 0, 0],
      },
    },
  },
]);

/** Bàn thấp cạnh vòng lửa: ấm, cốc, mì. */
const LOW_TABLE = ring(258, 2.65);
const lowTable: Placement[] = zone(LOW_TABLE, [
  { asset: M.tableLow, at: [0, 0], colliders: [{ dx: 0, dz: 0, r: 0.6 }] },
  { asset: M.kettle, at: [-0.3, 0.02], y: 0.46, yaw: 150 },
  { asset: M.noodle, at: [0.12, 0.08], y: 0.46, yaw: 20 },
  { asset: M.mugRed, at: [0.36, -0.1], y: 0.46, yaw: -40 },
  { asset: M.mugWhite, at: [-0.02, -0.14], y: 0.46, yaw: 70 },
]);

/** Hạng 02 "Xe lăn" (sau-trái lửa). */
const RANK02 = ring(228, 3.4);
const rank02: Placement[] = zone(RANK02, [
  { asset: M.wheelchair, at: [0, 0], colliders: [{ dx: 0, dz: 0.05, r: 0.6 }] },
  {
    asset: fan("headband"),
    at: [0, 0],
    // Concept 03 #02: gục người, đầu tựa vào bàn tay phải.
    npc: {
      pose: "sit_wheelchair",
      tweak: {
        spine: [24, 0, 0],
        neck: [6, 0, 0],
        head: [15, 0, -8],
        arm_upper_r: [-48, 20, 44],
        arm_lower_r: [-87, 39, 19],
      },
    },
  },
]);

/** Fan ghế đẩu bên phải lửa: đeo kính, cầm cốc. */
const STOOL_MUG = ring(98, 2.8);
const mugStool: Placement[] = zone(STOOL_MUG, [
  { asset: M.stool, at: [0, 0] },
  {
    asset: fan("glasses"),
    at: [0, 0],
    colliders: [{ dx: 0, dz: 0.12, r: 0.42 }],
    npc: {
      pose: "sit_stool",
      tweak: {
        spine: [14, 0, 0],
        head: [16, 0, 0],
        arm_upper_r: [-18, 0, 22],
        arm_lower_r: [-78, 0, 0],
      },
      hold: mugInRight(M.mugWhite),
    },
  },
]);

/**
 * Hạng 03 "Thở oxy" (sau-phải lửa, concept 03 #03): ngả lưng trên ghế gỗ, hông trượt ra trước, đầu
 * ngửa ra sau, chân duỗi; bình oxy xanh + ống thở. Manifest: ống thở vẽ trong hệ trục bình, ghế ở
 * (0,50; 0,05) so với bình, cùng yaw; đầu ống (face_end) khớp má phải của đúng tư thế này.
 */
const RANK03 = ring(132, 3.6);
const RANK03_TANK = frameToCave(RANK03, -0.5, -0.05);
const rank03: Placement[] = [
  ...zone(RANK03, [
    {
      asset: M.chair,
      at: [0, 0],
      colliders: [{ dx: -0.2, dz: 0.08, r: 0.62 }],
    },
    {
      asset: fan("oxygen"),
      at: [0, 0],
      npc: {
        pose: "sit_chair",
        tweak: {
          hips: { at: [0, 0.625, 0.02], rot: [0, 0, 0] },
          spine: [-18, 0, 0],
          neck: [-4, 0, 0],
          head: [-18, 0, 5],
          leg_upper_l: [-66, 0, -3],
          leg_lower_l: [48, 0, 0],
          leg_upper_r: [-66, 0, 3],
          leg_lower_r: [48, 0, 0],
          arm_lower_l: [-75, 15, 0],
          arm_lower_r: [-75, -15, 0],
        },
      },
    },
  ]),
  { asset: M.oxygenGreen, ...RANK03_TANK, yaw: RANK03.yaw },
  { asset: M.hose, ...RANK03_TANK, yaw: RANK03.yaw },
];

/** Ghế đẩu phía trước-phải: mũ đỏ ngồi gục (tiền cảnh khung concept 01). */
const STOOL_CAP = ring(52, 2.8);
const frontStools: Placement[] = zone(STOOL_CAP, [
  { asset: M.stool, at: [0, 0] },
  {
    asset: fan("cap_red"),
    at: [0, 0],
    colliders: [{ dx: 0, dz: 0.12, r: 0.42 }],
    npc: {
      pose: "sit_stool",
      tweak: { spine: [24, 0, 0], neck: [8, 0, 0], head: [22, 0, 0] },
    },
  },
]);

/**
 * Cặp fan an ủi nhau (concept 01, 02 và 04): sau lửa, quay mặt về phía camera concept / người chơi
 * mới vào. Fan hoodie đen ôm đầu, fan hoodie trắng ngồi sát bên, quay đầu sang và vòng tay trái qua
 * vai bạn.
 */
const PAIR_HURT = ring(173, 2.9);
const PAIR_HUG = ring(187, 2.9);
const pair: Placement[] = [
  ...zone(PAIR_HURT, [
    { asset: M.stool, at: [0, 0] },
    {
      asset: fan("hoodie_black"),
      at: [0, 0],
      colliders: [{ dx: 0, dz: 0.12, r: 0.53 }],
      npc: {
        pose: "head_in_hands",
        tweak: { ...STOOL_SEAT, spine: [52, 0, 6] },
      },
    },
  ]),
  ...zone(PAIR_HUG, [
    { asset: M.stool, at: [0, 0] },
    {
      asset: fan("hoodie_white"),
      at: [0, 0],
      colliders: [{ dx: 0, dz: 0.12, r: 0.53 }],
      npc: {
        pose: "sit_stool",
        tweak: {
          spine: [14, 0, -6],
          neck: [4, 0, 0],
          head: [12, 18, -4],
          arm_upper_l: [-35, 10, 95],
          arm_lower_l: [-45, 0, 20],
        },
      },
    },
  ]),
];

/* ---------------------------------------------------------------- góc thùng (trái lửa, chỉ trang trí) */

/**
 * Góc thùng bên trái lửa trại: chỗ TV "DEFEAT" của concept 01 từng đứng. TV đã nhường chỗ cho màn
 * hình lớn trên vách sau-trái (HUB_SCREEN); thùng lớn giờ là bàn ăn mì, hai thùng nhỏ và hai ghế
 * đẩu quanh nó. Lịch đấu xem ở màn hình lớn (điểm tương tác "screen"); hang ne_back giờ là Hang Quest.
 */
const CRATE_CORNER = ring(262, 7.8);
const crateCorner: Placement[] = zone(CRATE_CORNER, [
  { asset: M.crateLarge, at: [0, 0], colliders: [{ dx: 0, dz: 0, r: 0.72 }] },
  { asset: M.kettle, at: [-0.12, -0.06], y: 0.8, yaw: 205 },
  { asset: M.noodle, at: [0.2, 0.12], y: 0.8, yaw: 40 },
  {
    asset: M.crateSmall,
    at: [-0.85, 0.08],
    yaw: 8,
    colliders: [{ dx: 0, dz: 0, r: 0.5 }],
  },
  { asset: M.gamepad, at: [-0.83, 0.14], y: 0.6, yaw: -12 },
  {
    asset: M.crateSmall,
    at: [0.82, 0.15],
    yaw: -6,
    colliders: [{ dx: 0, dz: 0, r: 0.5 }],
  },
  { asset: M.mugWhite, at: [0.9, 0.22], y: 0.6, yaw: 200 },
  {
    asset: M.stool,
    at: [-0.75, 1.6],
    yaw: 180,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
  {
    asset: M.stoolSquare,
    at: [0.8, 1.55],
    yaw: 172,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  {
    asset: M.torchTripod,
    at: [-2, -0.75],
    colliders: [{ dx: 0, dz: 0, r: 0.42 }],
  },
]);

/* ---------------------------------------------------------------- nước (trái) */

/**
 * Vũng nước bên trái, trục dài chạy dọc vách như con suối concept 01; nằm giữa hai lối ra hầm
 * nw_back / nw_front, toàn bộ mặt nước trên nền phẳng. Trục +Z của vũng hướng vào sảnh (+X).
 */
const PUDDLE = { x: -14, z: 0.4, yaw: 90 };
const water: Placement[] = [
  // Vũng nông 5 cm: đi qua được (không collider).
  { asset: M.puddle, ...PUDDLE },
  // Măng đá sau vũng nước (trong vùng đi được: có collider, đứng riêng).
  {
    asset: M.stalagmiteB,
    x: -18,
    z: -0.6,
    yaw: 40,
    colliders: [{ dx: 0, dz: 0, r: 0.75 }],
  },
  {
    asset: M.stalagmiteA,
    x: -17.9,
    z: 2.6,
    yaw: 0,
    colliders: [{ dx: 0, dz: 0, r: 0.45 }],
  },
  {
    asset: M.stalagmiteA,
    x: -16.9,
    z: 4.3,
    yaw: 120,
    scale: 0.8,
    colliders: [{ dx: 0, dz: 0, r: 0.4 }],
  },
  // Đuốc bên kia mặt nước: lửa soi xuống nước như concept 01 (vệt sáng: apps/web/src/world/water.ts).
  {
    asset: M.torchPole,
    ...frameToCave(PUDDLE, -0.8, -2.9),
    yaw: 60,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  // Phiến đá thấp bên mép nước (ngồi được), 3 vòng chồng sâu.
  {
    asset: M.rockC,
    x: -16.2,
    z: -4.2,
    yaw: yawToward(-16.2, -4.2),
    colliders: [
      { dx: -1.2, dz: 0, r: 0.9 },
      { dx: 0, dz: 0, r: 0.9 },
      { dx: 1.2, dz: 0, r: 0.9 },
    ],
  },
  // Hai ghế đẩu bên mép nước phía lửa trại.
  {
    asset: M.stool,
    x: -10.6,
    z: 2.3,
    yaw: 80,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
  {
    asset: M.stoolSquare,
    x: -10.9,
    z: 3.5,
    yaw: 110,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
];

/* ---------------------------------------------------------------- cửa hang (sau) */

/** Mặt phẳng miệng hầm cửa hang (manifest.caves.json: wall_01 anchor 'tunnel_mouth'). */
const EXIT_MOUTH_Z = -23.4;
/** Khung gỗ đứng trước miệng hầm 0,95 m (anchor 'tunnel_frame'): cửa điện thờ lấy vị trí từ đây. */
const EXIT = { x: 0, z: mm(EXIT_MOUTH_Z + 0.95), yaw: 0 };
/** Biển đứng trên xà khung hầm (anchor 'sign' của khung), thu 1,8 (rộng ~3 m): tiêu điểm phía sau. */
const SIGN_SCALE = 1.8;
const exit: Placement[] = [
  // Khung gỗ cửa hầm (anchor 'tunnel_frame' của wall_01).
  { asset: M.tunnelFrame, ...EXIT },
  { asset: M.sign, x: 0, z: mm(EXIT.z + 0.35), yaw: 0, y: 3.13, scale: SIGN_SCALE },
  // Hai đuốc ba chân hai bên miệng hầm, ngay ngoài biên đi được; dây chăng giữa hai đuốc đánh dấu
  // chỗ người chơi phải dừng (thay cho bức tường vô hình), mép trong dây ~20,4 m.
  { asset: M.torchTripod, x: -2.4, z: mm(EXIT.z + 1.9), yaw: 10 },
  { asset: M.torchTripod, x: 2.4, z: mm(EXIT.z + 1.9), yaw: -10 },
  {
    asset: M.cordon,
    x: 0,
    z: mm(EXIT.z + 1.9),
    yaw: 0,
    // Chỉ hai nút buộc ở đuốc (ngoài vùng đi được): camera coi dây như hai điểm, không như một đĩa
    // rộng bằng cả sợi dây (blockers.ts lấy footprint khi model không có collider).
    colliders: [
      { dx: -2.4, dz: 0, r: 0.12 },
      { dx: 2.4, dz: 0, r: 0.12 },
    ],
  },
  // Đuốc mờ trong hầm (anchor 'tunnel_torch' của wall_01).
  { asset: M.torchPole, x: 0.6, z: -27.6, yaw: 0, scale: 0.8, light: 0.45 },
];

/* ---------------------------------------------------------------- góc thâm niên (sau-phải) */

/**
 * Góc thâm niên (concept 01 rest corner): bạt, giường sắt có hạng 04 nằm đắp chăn tới ngực cầm
 * điện thoại, thùng đầu giường có đèn bão và cốc, chồng thùng, xe lăn trống và bình oxy trắng.
 * Giường + thùng đầu giường + chồng thùng là một khối liền (collider chồng sâu thành chuỗi); xe lăn,
 * đuốc và cột bạt cách khối đó ≥ MIN_GAP. Nằm giữa lối ra cửa hang (180°) và lối sang Hang xem
 * trận (120°).
 */
const REST = ring(150, 12.4);
/** Giường nằm ngang dưới bạt, đầu giường (-Z của giường) về +X của vùng. */
const BED: Item = { asset: M.bed, at: [0.25, -0.75], yaw: -90 };
const rest: Placement[] = zone(REST, [
  {
    asset: M.tarp,
    at: [0, 0],
    // Chỉ cột chống va chạm (meta.poleColliders); vải, dây và cọc là trang trí.
    colliders: [
      { dx: 1.72, dz: 1.52, r: 0.22 },
      { dx: -1.72, dz: -1.47, r: 0.22 },
      { dx: -1.71, dz: 1.5, r: 0.22 },
      { dx: 1.84, dz: 0.42, r: 0.22 },
    ],
  },
  {
    ...BED,
    // Chăn gấp của giường ẩn đi: tl_prop_bed_cover_v01 phủ lên người nằm.
    hide: ["blanket"],
    colliders: [
      { dx: 0, dz: -0.6, r: 0.55 },
      { dx: 0, dz: 0, r: 0.55 },
      { dx: 0, dz: 0.6, r: 0.55 },
    ],
  },
  { ...BED, asset: M.bedCover },
  {
    ...BED,
    asset: fan("glasses"),
    npc: {
      pose: "lie_bed",
      // Màn hình hướng về mắt (mắt = (0; 0,14; 0,155) trong hệ trục khớp đầu).
      hold: {
        asset: M.phone,
        node: "arm_lower_r",
        at: [-0.02, -0.35, 0.02],
        aim: { node: "head", at: [0, 0.14, 0.155] },
      },
    },
  },
  // Đèn bão treo ở móc 'lantern_hook' (-1,61; 1,93; -1,34) trừ anchor 'hang' (0,3445); đèn dịu hơn
  // vì đèn chính của góc là đèn trên thùng đầu giường.
  { asset: M.lantern, at: [-1.61, -1.34], y: 1.5855, light: 0.6 },
  {
    asset: M.wheelchair,
    at: [-1.115, 0.515],
    yaw: 25,
    colliders: [{ dx: 0, dz: 0, r: 0.5 }],
  },
  {
    asset: M.oxygenWhite,
    at: [-0.9, -0.95],
    yaw: 30,
    colliders: [{ dx: 0, dz: 0, r: 0.2 }],
  },
  // Thùng đầu giường (chuỗi với giường): đèn bão + cốc.
  {
    asset: M.crateSmall,
    at: [1.55, -0.75],
    yaw: 6,
    colliders: [{ dx: 0, dz: 0, r: 0.55 }],
  },
  { asset: M.lantern, at: [1.48, -0.86], y: 0.6, yaw: 20 },
  { asset: M.mugRed, at: [1.66, -0.6], y: 0.6, yaw: 160 },
  {
    asset: M.crateLarge,
    at: [2.3, -1],
    yaw: -8,
    colliders: [{ dx: 0, dz: 0, r: 0.6 }],
  },
  { asset: M.crateSmall, at: [2.32, -1.05], y: 0.8, yaw: 14 },
  { asset: M.blanket, at: [2.3, -1.02], y: 1.4, yaw: 80 },
  {
    asset: M.torchTripod,
    at: [3.25, 0.35],
    colliders: [{ dx: 0, dz: 0, r: 0.42 }],
  },
]);

/* ---------------------------------------------------------------- góc sinh hoạt (phải) */

/**
 * Góc sinh hoạt (concept 02 living corner): bàn, 4 ghế đẩu, ấm, cốc, mì, đèn bão trên bàn, bạt che,
 * dây phơi phía vách, thảm. Cả bộ bàn ghế là một vòng va chạm (không lách vào giữa ghế); đuốc đứng
 * ngoài mép bạt (lửa không cháy trong tua bạt). Nằm giữa hai lối sang Hang chợ (60°) và Hang xem
 * trận (120°).
 */
const LIVING = ring(88, 12.6);
const living: Placement[] = zone(LIVING, [
  { asset: M.table, at: [0, 0], colliders: [{ dx: 0.2, dz: 0.08, r: 1.3 }] },
  { asset: M.kettle, at: [-0.45, 0.06], y: 0.75, yaw: 30 },
  { asset: M.mugWhite, at: [0.08, 0.16], y: 0.75, yaw: -20 },
  { asset: M.mugRed, at: [0.32, -0.12], y: 0.75, yaw: 110 },
  { asset: M.noodle, at: [0.58, 0.12], y: 0.75, yaw: 10 },
  { asset: M.noodle, at: [-0.15, -0.16], y: 0.75, yaw: 200 },
  { asset: M.lantern, at: [0.56, -0.17], y: 0.75, yaw: 15 },
  { asset: M.stool, at: [-0.5, 0.95], yaw: 180 },
  { asset: M.stoolSquare, at: [0.45, 0.98], yaw: 172 },
  { asset: M.stool, at: [1.32, 0.05], yaw: 270 },
  { asset: M.stool, at: [-0.05, -0.95] },
  {
    asset: fan("cap_red"),
    at: [-0.05, -0.95],
    npc: { pose: "head_in_hands", tweak: STOOL_SEAT },
  },
  {
    asset: M.clothesline,
    at: [-0.2, -2.6],
    colliders: [
      { dx: -1.25, dz: 0, r: 0.15 },
      { dx: 1.25, dz: 0, r: 0.15 },
    ],
  },
  // Nhấc 3 cm: thảm mỏng 6 mm, nền phẳng nhấp nhô 1–3,5 cm.
  { asset: M.rug, at: [0.25, 1.75], yaw: 8, y: 0.03 },
  // Bạt che bàn (concept 02 LIVING CORNER), xoay 90° cho khác bạt góc thâm niên.
  {
    asset: M.tarp,
    at: [0, 0],
    yaw: 90,
    colliders: [
      { dx: 1.72, dz: 1.52, r: 0.22 },
      { dx: -1.72, dz: -1.47, r: 0.22 },
      { dx: -1.71, dz: 1.5, r: 0.22 },
      { dx: 1.84, dz: 0.42, r: 0.22 },
    ],
  },
  {
    asset: M.torchPole,
    at: [-2.9, -1.6],
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  {
    asset: M.crateLarge,
    at: [2.5, -0.5],
    yaw: 12,
    colliders: [{ dx: 0, dz: 0, r: 0.62 }],
  },
  { asset: M.crateSmall, at: [2.45, -0.55], y: 0.8, yaw: -10 },
]);

/* ---------------------------------------------------------------- sạp điểm danh (cạnh chỗ xuất hiện) */

/**
 * Va chạm của hai sạp có quầy: một khối lồi (ba vòng lớn chồng sâu thành hình viên thuốc) trùm quầy,
 * chỗ chủ sạp đứng, cột biển và đồ hai đầu quầy. Khối lồi để người chơi đi thẳng từ chỗ xuất hiện
 * sang điểm khác trượt vòng qua sạp, không kẹt vào hốc giữa quầy, chủ sạp và cột. Khối này gắn vào
 * NPC chủ sạp (đứng sau quầy 0,6 m), còn model sạp chỉ khai hai cột biển: camera chỉ tránh hai cột
 * mảnh (blockers.ts lấy collider của model cao), phần biển + mái treo cao do STALL_CAMERA_BLOCKERS lo.
 */
const stallBody = (half: number, r: number, hostZ: number): Circle[] =>
  [-half, 0, half].map((dx) => ({ dx, dz: -0.4 - hostZ, r }));
/** Sạp điểm danh (trước-phải chỗ xuất hiện, quay mặt về lửa trại): quầy + mái bạt + biển, Oner chào. */
const checkinStall: Placement[] = zone(STALL.checkin, [
  {
    asset: M.stallCheckin,
    at: [0, 0],
    colliders: [
      { dx: -1.34, dz: -1.05, r: 0.2 },
      { dx: 1.34, dz: -1.05, r: 0.2 },
    ],
  },
  {
    asset: host("oner"),
    at: [0, -0.62],
    colliders: stallBody(0.7, 1.05, -0.62),
    npc: { pose: "host_greet" },
  },
  // Đèn bão trên mặt quầy (anchor 'lantern'): soi sổ điểm danh và mặt Oner.
  { asset: M.lantern, at: [-0.74, 0.14], y: 0.9, yaw: 25, light: 0.75 },
]);

/* ---------------------------------------------------------------- chỗ ngồi chung trong hang lớn */

/**
 * Ba nhóm ngồi nhỏ giữa lửa trại và vách, ở các khoảng trống giữa những lối đi ra miệng hầm: bàn trà
 * (trước-trái), vòng thùng gỗ quanh đèn bão (sau-trái), thảm + ghế (trước-phải, sau sạp điểm danh).
 */
const TEA = ring(326, 11.2);
const teaGroup: Placement[] = zone(TEA, [
  // Cả bộ bàn ghế là một vòng va chạm (không lách vào giữa ghế).
  { asset: M.tableLow, at: [0, 0], colliders: [{ dx: 0, dz: 0.1, r: 1.75 }] },
  { asset: M.kettle, at: [-0.22, 0.03], y: 0.46, yaw: 40 },
  { asset: M.mugRed, at: [0.2, 0.1], y: 0.46, yaw: 100 },
  { asset: M.mugWhite, at: [0.32, -0.1], y: 0.46, yaw: -30 },
  { asset: M.lantern, at: [0.02, -0.12], y: 0.46, yaw: 10, light: 0.7 },
  { asset: M.rug, at: [0.1, 0.2], yaw: 12, y: 0.03, scale: 2.2 },
  { asset: M.stool, at: [-1.25, 0.25], yaw: 90 },
  {
    asset: fan("headband"),
    at: [-1.25, 0.25],
    yaw: 100,
    npc: {
      pose: "sit_stool",
      tweak: { spine: [16, 0, 0], head: [10, -18, 0], arm_upper_r: [-18, 0, 22], arm_lower_r: [-78, 0, 0] },
      hold: mugInRight(M.mugRed),
    },
  },
  { asset: M.stoolSquare, at: [1.3, 0.1], yaw: -80 },
  { asset: M.stool, at: [0.15, 1.3], yaw: 180 },
  {
    asset: M.crateSmall,
    at: [2.6, -0.6],
    yaw: 20,
    colliders: [{ dx: 0, dz: 0, r: 0.45 }],
  },
  { asset: M.blanket, at: [2.6, -0.6], y: 0.6, yaw: 70 },
]);

const CRATES = ring(206, 11.4);
const crateGroup: Placement[] = zone(CRATES, [
  // Pallet làm bàn, thùng và ghế quanh nó: một vòng va chạm.
  { asset: M.pallet, at: [0, 0], yaw: 10, colliders: [{ dx: 0, dz: 0, r: 1.9 }] },
  { asset: M.lantern, at: [0.05, 0], y: 0.14, yaw: 30 },
  { asset: M.noodle, at: [-0.3, 0.2], y: 0.14, yaw: 80 },
  { asset: M.mugWhite, at: [0.3, -0.22], y: 0.14, yaw: 200 },
  { asset: M.crateSmall, at: [-1.4, 0.3], yaw: 12 },
  { asset: M.crateSmall, at: [1.4, -0.35], yaw: -20, scale: 0.78 },
  {
    asset: fan("hoodie_white"),
    at: [1.4, -0.27],
    yaw: -95,
    npc: {
      pose: "head_in_hands",
      tweak: {
        hips: { at: [0, 0.663, -0.05], rot: [0, 0, 0] },
        spine: [34, 0, 0],
        leg_upper_l: [-86, 10, 0],
        leg_lower_l: [86, 0, 0],
        leg_upper_r: [-86, -10, 0],
        leg_lower_r: [86, 0, 0],
      },
    },
  },
  { asset: M.stool, at: [0.2, 1.45], yaw: 180 },
  {
    asset: M.crateLarge,
    at: [-0.4, -1.75],
    yaw: -8,
    colliders: [{ dx: 0, dz: 0, r: 0.6 }],
  },
  { asset: M.blanket, at: [-0.4, -1.75], y: 0.8, yaw: 40 },
  {
    asset: M.torchPole,
    at: [-2.6, -1.3],
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
]);

const RUG_SEATS = ring(40, 14.2);
const rugGroup: Placement[] = zone(RUG_SEATS, [
  { asset: M.rug, at: [0, 0], yaw: -15, y: 0.03, scale: 2.4 },
  { asset: M.crateSmall, at: [0, 0], yaw: 30, colliders: [{ dx: 0, dz: 0, r: 0.45 }] },
  { asset: M.mugWhite, at: [0.1, 0.05], y: 0.6, yaw: 60 },
  { asset: M.noodle, at: [-0.12, -0.08], y: 0.6, yaw: 150 },
  {
    asset: M.stool,
    at: [-1.2, 0.35],
    yaw: 100,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
  {
    asset: M.stool,
    at: [1.15, 0.5],
    yaw: -110,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
  {
    asset: M.stoolSquare,
    at: [0.1, -1.25],
    yaw: 5,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
]);

/**
 * Ba cụm ghế nhỏ ở vòng giữa (r ≈ 7,5 m), xen giữa các lối đi ra miệng hầm: chỗ ngồi nghỉ chân giữa
 * lửa trại và các góc, để khoảng sàn rộng của hang lớn không trống.
 */
const midSeats: Placement[] = [
  // phải (giữa lửa và góc sinh hoạt): thảm, thùng nhỏ có cốc, hai ghế
  ...zone(ring(90, 7.5), [
    { asset: M.rug, at: [0, 0], yaw: 25, y: 0.03, scale: 1.9 },
    { asset: M.crateSmall, at: [0, 0], yaw: 15, colliders: [{ dx: 0, dz: 0, r: 0.45 }] },
    { asset: M.mugRed, at: [0.08, 0.06], y: 0.6, yaw: 40 },
    { asset: M.noodle, at: [-0.12, -0.05], y: 0.6, yaw: 130 },
    {
      asset: M.stool,
      at: [-1.2, 0.25],
      yaw: 95,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
    {
      asset: M.stoolSquare,
      at: [1.2, -0.2],
      yaw: -85,
      colliders: [{ dx: 0, dz: 0, r: 0.3 }],
    },
  ]),
  // sau-phải (giữa lửa và góc thâm niên): hai ghế quanh thùng có đèn bão
  ...zone(ring(150, 7.6), [
    { asset: M.crateSmall, at: [0, 0], yaw: -20, colliders: [{ dx: 0, dz: 0, r: 0.45 }] },
    { asset: M.lantern, at: [0.02, 0], y: 0.6, yaw: 10, light: 0.6 },
    {
      asset: M.stool,
      at: [-1.15, -0.35],
      yaw: 70,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
    {
      asset: M.stool,
      at: [1.05, 0.6],
      yaw: -120,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
  ]),
  // sau-trái (giữa lửa và vòng thùng gỗ): thùng lớn có chăn gấp, một ghế, một thùng nhỏ
  ...zone(ring(212, 7.8), [
    { asset: M.crateLarge, at: [0, 0], yaw: 12, colliders: [{ dx: 0, dz: 0, r: 0.6 }] },
    { asset: M.blanket, at: [0.02, 0], y: 0.8, yaw: 65 },
    {
      asset: M.stoolSquare,
      at: [-1.35, 0.4],
      yaw: 100,
      colliders: [{ dx: 0, dz: 0, r: 0.3 }],
    },
    {
      asset: M.crateSmall,
      at: [1.5, -0.3],
      yaw: -30,
      scale: 0.78,
      colliders: [{ dx: 0, dz: 0, r: 0.36 }],
    },
    { asset: M.mugWhite, at: [1.5, -0.3], y: 0.47, yaw: 20 },
  ]),
];

/* ---------------------------------------------------------------- đuốc lối vào + đá */

/** Hai đuốc hai bên chỗ xuất hiện, mỗi bên một thùng lớn và một ghế đẩu phía sau. */
const spawnTorches: Placement[] = [-1, 1].flatMap((side): Placement[] => [
  {
    asset: M.torchPole,
    x: side * 5.5,
    z: 12.5,
    yaw: side * -160,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  {
    asset: M.crateLarge,
    x: side * 6.75,
    z: 13.2,
    yaw: side * -25,
    colliders: [{ dx: 0, dz: 0, r: 0.6 }],
  },
  {
    asset: M.stool,
    x: side * 7.7,
    z: 12.3,
    yaw: side * 40,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
]);

/**
 * Đuốc ở các anchor đuốc của vỏ hang lớn (manifest.caves.json, tl_cave_main_floor meta.torches, phòng
 * "main"): hai đuốc ba chân hai bên mỗi miệng hầm sang hang nhỏ (dẫn đường) và bốn đuốc cột dọc
 * vách. Tất cả ở chân vách (r > 21,7 m), ngoài vùng đi được: không cần collider.
 */
const MAIN_TORCH_SPOTS: readonly (readonly [number, number, number])[] = [
  [16.5247, -14.1737, -49.3794],
  [20.5287, -7.2478, -70.554],
  [22.9396, 0, -90],
  [-20.5287, -7.2478, 70.554],
  [-16.5247, -14.1737, 49.3794],
  [-16.5247, 14.1737, 130.6206],
  [-20.5287, 7.2478, 109.446],
  [-22.1313, 0, 90],
  [-7.3853, 21.4485, 161],
  [7.2127, 20.9472, -161],
  [20.5287, 7.2478, -109.446],
  [16.5247, 14.1737, -130.6206],
];
/** Nền dốc lên chân vách ngoài r = 21 m (~0,5 m ở r = 25,2): độ cao gần đúng để đồ không chìm. */
const rimHeight = (x: number, z: number) => {
  const k = (Math.sqrt(x * x + z * z) - 21) / 4.2;
  return k > 0 ? mm(0.5 * k * k) : 0;
};
const mainTorches: Placement[] = MAIN_TORCH_SPOTS.map(([x, z, yaw]) => {
  const mouth = z !== 0 && Math.abs(x) > 10;
  return {
    asset: mouth ? M.torchTripod : M.torchPole,
    x,
    z,
    yaw,
    y: rimHeight(x, z),
    ...(mouth ? {} : { light: 0.8 }),
  };
});

/**
 * Đá sát vách (tâm ở r ≈ 21,4–23 m): mép trong của từng khối ở ngoài r = 20,8 m, tức ngoài cả bán
 * kính đi được (20 m) lẫn vùng camera (20,6 m), nên không cần collider.
 */
const wallRock = (asset: string, bearing: number, r: number, scale = 1): Placement => {
  const p = wall(asset, bearing, r);
  return { ...p, y: rimHeight(p.x, p.z) - 0.02, ...(scale === 1 ? {} : { scale }) };
};
const wallRocks: Placement[] = [
  // sau chỗ xuất hiện (312°..48°)
  wallRock(M.rockA, 2, 22.6),
  wallRock(M.stalagmiteB, 11, 21.6),
  wallRock(M.rockB, 28, 21.8),
  wallRock(M.rockC, 37, 22),
  wallRock(M.stalagmiteA, 44, 21.4),
  wallRock(M.rockC, 351, 22),
  wallRock(M.rockB, 331, 21.8),
  wallRock(M.stalagmiteA, 325, 21.4),
  wallRock(M.rockA, 318, 22.6),
  // phải (71°..109°)
  wallRock(M.rockB, 77, 21.8),
  wallRock(M.stalagmiteB, 84, 21.6),
  wallRock(M.rockA, 98, 22.6),
  wallRock(M.stalagmiteA, 105, 21.4),
  // sau-phải (131°..172°)
  wallRock(M.rockC, 137, 22),
  wallRock(M.stalagmiteB, 145, 21.6),
  wallRock(M.rockA, 154, 23, 1.2),
  wallRock(M.rockB, 164, 21.8),
  wallRock(M.stalagmiteA, 170, 21.4),
  // sau-trái (188°..229°)
  wallRock(M.stalagmiteA, 190, 21.4),
  wallRock(M.rockB, 197, 21.8),
  // dưới màn hình lớn (HUB_SCREEN, mép dưới 2 m, từ 196° tới 222°) chỉ để đá thấp trước chân vách
  wallRock(M.rockC, 205, 21.9),
  wallRock(M.rockC, 214, 21.8),
  wallRock(M.stalagmiteB, 225, 21.6),
  wallRock(M.rockA, 229, 23.4, 1.2),
  // trái (251°..289°)
  wallRock(M.rockB, 256, 21.8),
  wallRock(M.stalagmiteB, 263, 21.6),
  wallRock(M.stalagmiteA, 274, 21.3),
  wallRock(M.rockA, 281, 22.6),
];
/**
 * Tảng đá lớn trong lòng hang (sau-trái, giữa lối ra cửa hang và lối sang Hang ký ức): ba vòng dọc
 * trục dài phủ cả mấy hòn đá nhỏ quanh tảng chính (footprint 4,1 x 3,3 m). Thêm một cụm đá thấp và
 * măng đá ở sau-phải, sau góc thâm niên.
 */
const boulders: Placement[] = [
  {
    asset: M.rockA,
    x: -9.2,
    z: -14,
    yaw: yawToward(-9.2, -14),
    colliders: [
      { dx: -1, dz: 0, r: 1.55 },
      { dx: 0, dz: 0, r: 1.75 },
      { dx: 1, dz: 0, r: 1.55 },
    ],
  },
  {
    asset: M.rockB,
    x: 9.6,
    z: -15.2,
    yaw: yawToward(9.6, -15.2) + 20,
    colliders: [
      { dx: -0.65, dz: 0, r: 0.95 },
      { dx: 0.65, dz: 0, r: 0.95 },
    ],
  },
  {
    asset: M.stalagmiteB,
    x: 12.2,
    z: -13.4,
    yaw: 70,
    colliders: [{ dx: 0, dz: 0, r: 0.75 }],
  },
  {
    asset: M.stalagmiteA,
    x: -9.9,
    z: 15.3,
    yaw: 30,
    colliders: [{ dx: 0, dz: 0, r: 0.45 }],
  },
  {
    asset: M.rockB,
    x: -12,
    z: 13.6,
    yaw: yawToward(-12, 13.6) - 30,
    scale: 0.9,
    colliders: [
      { dx: -0.6, dz: 0, r: 0.86 },
      { dx: 0.6, dz: 0, r: 0.86 },
    ],
  },
];

/**
 * Đá phiến nhạt rải tay ở tiền cảnh khung concept / chỗ xuất hiện (concept 01: tiền cảnh nhiều phiến
 * đá nhạt); lối giữa chỉ có sỏi nhỏ. Không collider.
 */
const foregroundStones: Placement[] = (
  [
    ["a", -3.2, 4.6, 20, 1.8],
    ["d", -1.9, 5.8, -40, 1.6],
    ["b", -2.6, 3.4, 70, 1.2],
    ["c", -0.6, 4.2, 10, 1.3],
    ["a", 3.6, 5.2, -15, 2],
    ["b", 2.4, 4.1, 30, 1.4],
    ["d", 4.6, 3.6, 80, 1.4],
    ["c", 1.2, 6.4, -60, 1.2],
    ["a", 5.4, 6.8, 45, 1.5],
    ["b", 0.7, 3.4, 15, 1],
    ["d", -4.6, 6.6, 100, 1.8],
    ["a", -5.2, 2.6, -70, 1.6],
    ["c", 2.9, 7.4, 0, 1],
    ["b", -0.9, 7.2, 55, 1.3],
  ] as const
).map(([kind, x, z, yaw, scale]) => ({
  asset: `environment/tl_env_stone_small_${kind}_v01`,
  x,
  z,
  yaw,
  scale,
}));

/* ---------------------------------------------------------------- bốn hang nhỏ */

/**
 * Mỗi hang nhỏ dựng theo "khung hốc": gốc ở tâm hang, -Z hướng vào hốc đá cuối hang (anchor
 * 'niche'), +Z hướng ra giữa hang. Đồ chính của sạp đứng ở tiêu điểm trước hốc (anchor 'focal',
 * cách tâm 7,2 m, ngay ngoài biên đi được 7 m) và quay mặt vào tâm hang, nên người vừa qua hầm thấy
 * mặt trước và biển. Collider của chúng là khối chặn sát vách (tâm ngoài biên, góc với biên tù).
 */
const nicheFrame = (c: SideCave): Frame => ({ x: c.x, z: c.z, yaw: c.nicheYaw });
/** Hệ trục của vỏ hang nhỏ: +Z hướng về miệng hang (và hang lớn). */
const shellFrame = (c: SideCave): Frame => ({ x: c.x, z: c.z, yaw: c.yaw });

/**
 * Đuốc ở bốn anchor đuốc của vỏ hang nhỏ: hai đuốc ba chân hai bên miệng hang (phía trong) và hai
 * đuốc cột hai bên hốc đá.
 */
function caveTorches(c: SideCave): Placement[] {
  const s = shellFrame(c);
  return [
    ...SIDE_TORCH_MOUTH.map(([mx, mz]): Placement => {
      const mouth = frameToCave(s, mx, mz);
      return {
        asset: M.torchTripod,
        ...mouth,
        yaw: yawToward(mouth.x, mouth.z, c.x, c.z),
        // Khối chặn sát vách: tâm cách tâm hang 7,21 m (> sqrt(7² + 0,3²)).
        colliders: [{ dx: 0, dz: 0, r: 0.3 }],
      };
    }),
    ...SIDE_TORCH_NICHE[c.variant].map(([lx, lz]): Placement => {
      const p = frameToCave(s, lx, lz);
      return { asset: M.torchPole, ...p, yaw: yawToward(p.x, p.z, c.x, c.z) };
    }),
  ];
}

/** Đèn bão đặt sát vách giữa mỗi đường hầm (ngoài lối đi 1,7 m): hầm không bao giờ tối đen. */
const tunnelLanterns: Placement[] = HUB_CAVES.map((c, i) => {
  const d = Math.sqrt(c.x * c.x + c.z * c.z),
    ux = c.x / d,
    uz = c.z / d,
    side = i % 2 ? 2.15 : -2.15;
  return {
    asset: M.lantern,
    x: mm(ux * 25.9 - uz * side),
    z: mm(uz * 25.9 + ux * side),
    yaw: 30 * i,
    y: 0.06,
    light: 0.8,
  };
});

/* ---- Hang ký ức (nw_back) */

/**
 * Vách ký ức (concept 02) đứng trước hốc đá, hai đuốc của hốc ở hai bên. Biển rộng nhô lên trên vách
 * (cột giấu sau tấm ván, nhấc 0,68 m cho bảng cao hơn mép ván); người giữ ký ức xách đèn bão đứng ở
 * đầu phải vách (chồng sâu với collider tấm ván và là khối chặn sát vách). Nến, thùng, ghế.
 */
const memoryCave: Placement[] = [
  ...zone(STALL.memory, [
    {
      asset: M.memoryBoard,
      at: [0, 0],
      colliders: [
        { dx: -1.35, dz: -0.65, r: 1.35 },
        { dx: 0, dz: -0.65, r: 1.35 },
        { dx: 1.35, dz: -0.65, r: 1.35 },
      ],
    },
    { asset: M.signStallWide, at: [0, -0.3], y: 0.68, colliders: signPosts(1.69) },
    {
      asset: host("keeper"),
      at: [2, 0.42],
      yaw: -30,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: {
        pose: "host_keeper",
        hold: { asset: M.lantern, node: "arm_lower_l", at: [0, -0.6, 0.03] },
      },
    },
    // Nến dưới chân vách (trong collider của tấm ván: không ai giẫm lên).
    { asset: M.candles, at: [-0.95, 0.58], yaw: -10 },
    { asset: M.candles, at: [0.75, 0.6], yaw: 30, light: 0 },
    {
      asset: M.stool,
      at: [0.85, 1.55],
      yaw: 200,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
    {
      asset: M.crateSmall,
      at: [-2.5, 1.7],
      yaw: 15,
      colliders: [{ dx: 0, dz: 0, r: 0.45 }],
    },
    { asset: M.candles, at: [-2.5, 1.7], y: 0.6, yaw: 60, light: 0 },
    {
      asset: M.crateLarge,
      at: [2.6, 1.9],
      yaw: -10,
      colliders: [{ dx: 0, dz: 0, r: 0.6 }],
    },
    { asset: M.crateSmall, at: [2.56, 1.88], y: 0.8, yaw: 8 },
    {
      asset: fan("hoodie_black"),
      at: [-1.7, 2.6],
      yaw: 160,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: {
        pose: "slump",
        tweak: { head: [26, 0, 0] },
        hold: mugInRight(M.mugRed),
      },
    },
    { asset: M.rug, at: [0.3, 3.7], yaw: 6, y: 0.04, scale: 2 },
    {
      asset: M.stoolSquare,
      at: [2.9, 5],
      yaw: 150,
      colliders: [{ dx: 0, dz: 0, r: 0.3 }],
    },
    {
      asset: M.stool,
      at: [1.7, 4.2],
      yaw: 210,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
  ]),
  ...caveTorches(CAVE.nw_back),
];

/* ---- Hang đố vui (nw_front) */

/**
 * Nửa vòng 6 ghế đẩu trước bảng (bán kính 2,4 m: giữa hai ghế cạnh nhau còn lối ≥ MIN_GAP), chừa lối
 * giữa rộng ~0,9 m từ miệng hang thẳng tới chỗ đứng trước bảng.
 */
const quizStools: Item[] = [-66, -42, -18, 18, 42, 66].map((a, i) => ({
  asset: i % 3 === 1 ? M.stoolSquare : M.stool,
  at: [
    mm(2.4 * Math.sin(a * DEG)),
    mm(0.35 + 2.4 * Math.cos(a * DEG)),
  ] as const,
  yaw: a + 180,
  colliders: [{ dx: 0, dz: 0, r: 0.28 }],
}));
/**
 * Bảng phấn đố vui trước hốc đá, nửa vòng ghế đẩu, biển "ĐỐ VUI T1" sau bảng; Keria đứng ở mép trái
 * bảng (chồng sâu với collider bảng, khối chặn sát vách), tay chỉ về phía bảng.
 */
const quizCave: Placement[] = [
  ...zone(STALL.quiz, [
    {
      asset: M.quizBoard,
      at: [0, 0],
      colliders: [
        { dx: -0.75, dz: -0.05, r: 0.55 },
        { dx: 0, dz: -0.05, r: 0.55 },
        { dx: 0.75, dz: -0.05, r: 0.55 },
      ],
    },
    ...quizStools,
    { asset: M.signStall, at: [0, -0.6], colliders: signPosts(1.34) },
    {
      asset: host("keria"),
      at: [-1.3, 0.25],
      yaw: 6,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: { pose: "host_present", tweak: { head: [-3, -14, 0] } },
    },
    // Thùng phấn + cốc cạnh bảng (ngoài biên đi được).
    { asset: M.crateSmall, at: [2.2, 0.05], yaw: 20 },
    { asset: M.mugWhite, at: [2.15, 0.1], y: 0.6, yaw: 40 },
    // Hai khán giả đứng xem sau hàng ghế.
    {
      asset: fan("torn_jersey"),
      at: [1.9, 4.3],
      yaw: 200,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: { pose: "slump", tweak: { head: [8, 10, 0], spine: [6, 0, 0] } },
    },
    {
      asset: M.crateLarge,
      at: [-2.7, 4.2],
      yaw: 25,
      colliders: [{ dx: 0, dz: 0, r: 0.6 }],
    },
    { asset: M.lantern, at: [-2.72, 4.18], y: 0.8, yaw: 10, light: 0.7 },
    { asset: M.noodle, at: [-2.5, 4.35], y: 0.8, yaw: 120 },
  ]),
  ...caveTorches(CAVE.nw_front),
];

/* ---- Hang Quest (ne_back) */

/**
 * Hang Quest: trước là Hang xem trận; màn hình lớn ở hang lớn đã thay phòng xem nên hốc đá giờ treo
 * bảng quest (ván gỗ ghim giấy, 2,2 x 1,3 m) trên vách trong cùng của hốc (vách phẳng, sâu hơn tiêu
 * điểm 2,88 m, rộng 2,6 m; mép dưới bảng 0,95 m, ngay trên bậc đá của hốc). Trước hốc là ba thùng lớn
 * xếp hàng làm kệ (một khối chặn sát vách), biển "BẢNG QUEST" treo phía trên; nhìn từ ghế, bảng hiện
 * giữa hai cột biển, dưới tấm biển. Doran đứng cạnh thùng phải, cầm cốc. Trước đó là mấy hàng ghế đẩu
 * và thùng cho người ngồi chờ nhận việc, chừa lối giữa. Collider của bảng trùng đúng hai cột biển: chỉ
 * để camera không coi nó là một đĩa rộng (blockers.ts), không thêm vật cản mới.
 */
const questCave: Placement[] = [
  ...zone(STALL.quest, [
    ...[-1, 0, 1].map(
      (k): Item => ({
        asset: M.crateLarge,
        at: [k, -0.15],
        yaw: k * 7,
        colliders: [{ dx: 0, dz: 0, r: 0.72 }],
      }),
    ),
    {
      asset: M.questBoard,
      at: [0, -2.88],
      colliders: signPosts(1.34).map((c) => ({ ...c, dz: 1.98 })),
    },
    { asset: M.noodle, at: [-1.05, -0.05], y: 0.8, yaw: 60 },
    { asset: M.kettle, at: [-0.72, -0.3], y: 0.8, yaw: 140 },
    { asset: M.mugRed, at: [1.02, -0.12], y: 0.8, yaw: 250 },
    { asset: M.gamepad, at: [0.55, 0.12], y: 0.8, yaw: 30 },
    { asset: M.signStall, at: [0, -0.9], y: 0.3, colliders: signPosts(1.34) },
    {
      asset: host("doran"),
      at: [1.72, 0.1],
      yaw: -28,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: {
        pose: "host_hold",
        tweak: { head: [0, 14, 0] },
        hold: mugInRight(M.mugWhite),
      },
    },
    // Hàng 1: bốn ghế đẩu, hai fan ngồi ở hai ghế ngoài.
    { asset: M.stool, at: [-2.25, 3.7], yaw: 180 },
    {
      asset: fan("cap_red"),
      at: [-2.25, 3.7],
      yaw: 172,
      colliders: [{ dx: 0, dz: 0.12, r: 0.42 }],
      npc: {
        pose: "sit_stool",
        tweak: { spine: [10, 0, 0], head: [-6, 0, 0] },
      },
    },
    {
      asset: M.stool,
      at: [-1.05, 3.8],
      yaw: 180,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
    {
      asset: M.stoolSquare,
      at: [1.05, 3.8],
      yaw: 180,
      colliders: [{ dx: 0, dz: 0, r: 0.3 }],
    },
    { asset: M.stool, at: [2.25, 3.7], yaw: 180 },
    {
      asset: fan("glasses"),
      at: [2.25, 3.7],
      yaw: 190,
      colliders: [{ dx: 0, dz: 0.12, r: 0.42 }],
      npc: {
        pose: "head_in_hands",
        tweak: { ...STOOL_SEAT, spine: [44, 0, 0] },
      },
    },
    // Hàng 2: thùng gỗ làm ghế.
    ...[-2.5, -1.15, 1.15, 2.5].map(
      (x, i): Item => ({
        asset: M.crateSmall,
        at: [x, 5.2],
        yaw: 180 + (i * 37) % 30 - 15,
        colliders: [{ dx: 0, dz: 0, r: 0.45 }],
      }),
    ),
    { asset: M.noodle, at: [-2.42, 5.25], y: 0.6, yaw: 70 },
    { asset: M.mugRed, at: [1.2, 5.15], y: 0.6, yaw: 200 },
    // Hàng 3: ghế đẩu thưa.
    ...[-1.7, 1.7].map(
      (x, i): Item => ({
        asset: i ? M.stool : M.stoolSquare,
        at: [x, 6.6],
        yaw: 180,
        colliders: [{ dx: 0, dz: 0, r: 0.3 }],
      }),
    ),
    { asset: M.rug, at: [0, 2.2], yaw: 90, y: 0.04, scale: 1.8 },
  ]),
  ...caveTorches(CAVE.ne_back),
];

/* ---- Hang chợ (ne_front) */

/**
 * Quầy trang phục của Peyz đứng trước hốc đá (khối lồi quầy + chủ sạp là khối chặn sát vách). Quanh
 * đó là đồ chợ: dây phơi sát vách, chồng thùng hàng, pallet với chăn gấp và thảm: chỗ trống bên trái
 * để dành cho sạp sau này.
 */
const marketCave: Placement[] = [
  ...zone(STALL.shop, [
    {
      asset: M.stallApparel,
      at: [0, 0],
      colliders: [
        { dx: -1.34, dz: -1.15, r: 0.2 },
        { dx: 1.34, dz: -1.15, r: 0.2 },
      ],
    },
    {
      asset: host("peyz"),
      at: [0, -0.6],
      colliders: stallBody(0.85, 1.1, -0.6),
      npc: { pose: "host_counter" },
    },
    { asset: M.rug, at: [0, 1.9], yaw: 4, y: 0.04, scale: 2.2 },
    // Thùng hàng bên phải quầy.
    {
      asset: M.crateLarge,
      at: [3.1, 1.6],
      yaw: -18,
      colliders: [{ dx: 0, dz: 0, r: 0.6 }],
    },
    { asset: M.crateSmall, at: [3.06, 1.58], y: 0.8, yaw: 12 },
    { asset: M.blanket, at: [3.08, 1.6], y: 1.4, yaw: 50 },
    {
      asset: M.crateSmall,
      at: [3.9, 2.9],
      yaw: 30,
      colliders: [{ dx: 0, dz: 0, r: 0.45 }],
    },
    { asset: M.lantern, at: [3.9, 2.9], y: 0.6, yaw: 0, light: 0.7 },
    // Dây phơi sát vách bên phải (ngoài biên đi được, chỉ hai cột là vật chắn camera).
    {
      asset: M.clothesline,
      at: [5.35, 1.35],
      yaw: -45,
      colliders: [
        { dx: -1.25, dz: 0, r: 0.15 },
        { dx: 1.25, dz: 0, r: 0.15 },
      ],
    },
    // Chỗ dành cho sạp sau (bên phải, xa miệng hang): pallet + thùng + chăn, thảm, hai ghế.
    {
      asset: M.pallet,
      at: [4.7, 7.3],
      yaw: 35,
      colliders: [{ dx: 0, dz: 0, r: 0.75 }],
    },
    { asset: M.crateSmall, at: [4.75, 7.25], y: 0.14, yaw: 50 },
    { asset: M.blanket, at: [4.7, 7.3], y: 0.74, yaw: 10 },
    { asset: M.rug, at: [3.1, 7.6], yaw: 40, y: 0.04, scale: 1.6 },
    {
      asset: M.stool,
      at: [3.3, 5.8],
      yaw: 120,
      colliders: [{ dx: 0, dz: 0, r: 0.28 }],
    },
    {
      asset: M.stoolSquare,
      at: [4.7, 9.1],
      yaw: 160,
      colliders: [{ dx: 0, dz: 0, r: 0.3 }],
    },
    // Thùng hàng bên trái, sau lối vào.
    {
      asset: M.crateLarge,
      at: [-4.5, 4.1],
      yaw: 22,
      colliders: [{ dx: 0, dz: 0, r: 0.6 }],
    },
    { asset: M.crateSmall, at: [-4.46, 4.12], y: 0.8, yaw: -15 },
    // Khách xem hàng.
    {
      asset: fan("oxygen"),
      at: [-1.3, 3.1],
      yaw: 160,
      colliders: [{ dx: 0, dz: 0, r: 0.35 }],
      npc: { pose: "slump", tweak: { head: [12, -8, 0] } },
    },
  ]),
  ...caveTorches(CAVE.ne_front),
];

/** Chỗ đứng của các điểm tương tác: đá vụn tránh ra. */
const REST_SPOT = frameToCave(REST, 0.1, 2.35);
const LANDMARK_SPOTS = [
  REST_SPOT,
  { x: CAVE_SHRINE_GATE.x, z: CAVE_SHRINE_GATE.z },
  ...CAVE_STALLS.map((s) => stallApproach(s)),
] as const;

/* ---------------------------------------------------------------- cổng biển tên, màn hình lớn */

/** Cột cổng biển cách trục hầm chừng này (m): manifest tl_sign_cave_gate meta.gate.postHalf. */
const GATE_POST = 2.85;
/**
 * Cổng gỗ treo biển tên trước từng miệng hầm, cách gốc 21,2 m trên trục hầm (miệng hầm ở 23,4 m):
 * mặt trước (+Z) quay về lửa trại ghi tên hang nhỏ, mặt sau ghi "HANG LỚN" cho người đi ra. Hai cột
 * đứng ngoài vùng đi được (hang lớn r 20 m, lối hầm rộng 3,4 m) nên collider chỉ để camera coi cổng
 * là hai cột chứ không phải một đĩa rộng bằng cả cổng (blockers.ts). Bảng treo 3,2–3,98 m, cao hơn
 * trần camera của hầm.
 */
const caveGates: Placement[] = HUB_CAVES.map((c) => {
  const d = Math.sqrt(c.x * c.x + c.z * c.z);
  return {
    asset: M.caveGate,
    x: mm((c.x / d) * 21.2),
    z: mm((c.z / d) * 21.2),
    yaw: c.yaw,
    colliders: [
      { dx: -GATE_POST, dz: 0, r: 0.2 },
      { dx: GATE_POST, dz: 0, r: 0.2 },
    ],
  };
});
/** Cổng biển tên của từng hang nhỏ (client vẽ chữ lên bảng: apps/web/src/world/stalls.ts). */
export const HUB_CAVE_GATES: Readonly<Record<SideCaveId, Placement>> = Object.fromEntries(
  HUB_CAVES.map((c, i) => [c.id, caveGates[i]]),
) as Record<SideCaveId, Placement>;

/**
 * Mặt đá phẳng của vách sau-trái hang lớn, giữa cửa điện thờ và miệng hầm sang Hang ký ức (model
 * vách: tools/models/groups/caves.ts SCREEN_WALL; manifest tl_cave_main_floor meta.screenWall): một
 * mặt phẳng quay về lửa trại ở hướng `bearing`, cách tâm `r0` m ở nền, nghiêng vào lòng hang `slope`
 * m mỗi mét cao (10,2°), rộng 10,6 m, phẳng từ nền lên ~9,6 m. scripts/stalls.test.ts so với manifest.
 */
export const SCREEN_WALL = { bearing: 208.78, r0: 23, slope: 0.18, halfWidth: 5.3 } as const;
/** Mép dưới vỏ màn hình lớn cách nền chừng này (m): manifest tl_furn_wall_screen meta.mount.lift. */
const SCREEN_LIFT = 2;
/**
 * Màn hình lớn của hang lớn (9,6 x 5,4 m, mép dưới cao 2 m) bắt thẳng lên mặt đá phẳng SCREEN_WALL,
 * quay mặt về lửa trại; từ chỗ xuất hiện thấy nó bên trái cửa điện thờ. Không có khung hay chân: lưng
 * màn hình nằm trên mặt đá (chìm 2 cm), nghiêng theo mặt đá. Gốc model là điểm trên nền dưới mép dưới
 * lưng màn hình, ở r ≈ 22,7 m: ngoài vùng đi được và vùng camera. Hai collider ở hai đầu màn hình chỉ
 * để camera không coi cả màn hình là một đĩa rộng (blockers.ts). Client vẽ lịch đấu lên mặt kính
 * (apps/web/src/world/bigScreen.ts, manifest meta.screen).
 */
export const HUB_SCREEN: Placement = {
  ...wall(M.wallScreen, SCREEN_WALL.bearing, SCREEN_WALL.r0 - SCREEN_WALL.slope * SCREEN_LIFT + 0.02),
  yaw: Math.round((SCREEN_WALL.bearing - 180) * 100) / 100,
  colliders: [
    { dx: -4.9, dz: 0, r: 0.3 },
    { dx: 4.9, dz: 0, r: 0.3 },
  ],
};

/** Bảng quest trên vách hốc đá của Hang Quest. */
export const HUB_QUEST_BOARD: Placement = (() => {
  const p = questCave.find((q) => q.asset === M.questBoard);
  if (!p) throw new Error("layout: bảng quest chưa được đặt");
  return p;
})();
/** Mọi màn hình hiện lịch đấu: client phủ cùng một hình lên từng cái (hiện chỉ còn màn hình lớn). */
export const HUB_SCREENS: readonly Placement[] = [HUB_SCREEN];
/**
 * Chỗ đứng xem màn hình lớn (E mở lịch đấu): 3,4 m trước mặt màn hình, lệch 3 m về phía cửa điện thờ
 * (vẫn trước nửa phải màn hình) để tránh tảng đá đứng trên trục màn hình và có lối thẳng từ lối ra cửa.
 */
export const SCREEN_SPOT = (() => {
  const b = SCREEN_WALL.bearing * DEG,
    r = 19.3,
    lat = -3;
  return { x: mm(r * Math.sin(b) + lat * Math.cos(b)), z: mm(r * Math.cos(b) - lat * Math.sin(b)) };
})();

/* ---------------------------------------------------------------- đá vụn rải nền */

const SOLID: Placement[] = [
  ...fire,
  ...checkinStall,
  ...rank01,
  ...lowTable,
  ...rank02,
  ...mugStool,
  ...rank03,
  ...frontStools,
  ...pair,
  ...crateCorner,
  ...water,
  ...exit,
  ...rest,
  ...living,
  ...teaGroup,
  ...crateGroup,
  ...rugGroup,
  ...midSeats,
  ...spawnTorches,
  ...mainTorches,
  ...wallRocks,
  ...boulders,
  ...memoryCave,
  ...quizCave,
  ...questCave,
  ...marketCave,
  ...tunnelLanterns,
  ...caveGates,
  HUB_SCREEN,
];

/** Dải trước mỗi miệng hầm (5 miệng: cửa hang + 4 hang nhỏ): đá vụn chân vách tránh ra. */
const MOUTH_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  ...HUB_CAVES.map((c) => {
    const d = Math.sqrt(c.x * c.x + c.z * c.z);
    return [c.x / d, c.z / d] as const;
  }),
];

/**
 * Đá nhỏ rải tất định (LCG), không collider, tránh đồ đạc, vũng nước, điểm xuất hiện, chỗ đứng xem
 * (điểm tương tác) và lối vào các hầm. Trong hang lớn: 2/5 rải đều trên nền (cỡ vừa), 2/5 quây quanh
 * đồ đạc cách 0,8–2,5 m và 1/5 dọc chân vách (18,5–21 m) với phiến lớn: nền bớt phẳng như concept 01.
 * Mỗi hang nhỏ thêm `perCave` viên rải đều trong lòng hang.
 */
function scatterStones(count: number, perCave: number): Placement[] {
  const keepOut = SOLID.flatMap(placementObstacles);
  const anchors = keepOut.filter(
    (o) => (o.r < 1.6 || o.x !== 0 || o.z !== 0) && Math.hypot(o.x, o.z) < 19,
  );
  let seed = 20261111;
  const rnd = () =>
    (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const out: Placement[] = [];
  const stone = (x: number, z: number, big: boolean): boolean => {
    const kind = ["a", "b", "c", "d"][Math.floor(rnd() * 4)];
    const slab = kind === "a" || kind === "d";
    const k = slab
      ? big
        ? 1.2 + rnd() * 1.0
        : 1 + rnd() * 0.5
      : 0.9 + rnd() * (big ? 0.7 : 0.5);
    const scale = Math.round(k * 100) / 100;
    const yaw = Math.round(rnd() * 360) - 180;
    if (keepOut.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.25))
      return false;
    if (Math.hypot(x - HUB_SPAWN.x, z - HUB_SPAWN.z) < 1.6) return false;
    if (LANDMARK_SPOTS.some((l) => Math.hypot(x - l.x, z - l.z) < 0.9))
      return false;
    if (Math.hypot(x - SCREEN_SPOT.x, z - SCREEN_SPOT.z) < 0.9) return false;
    out.push({
      asset: `environment/tl_env_stone_small_${kind}_v01`,
      x,
      z,
      yaw,
      scale,
    });
    return true;
  };
  for (let tries = 0; out.length < count && tries < 12000; tries++) {
    const mode = out.length % 5;
    let x: number, z: number;
    if (mode >= 2 && mode <= 3) {
      const o = anchors[Math.floor(rnd() * anchors.length)];
      const a = rnd() * Math.PI * 2,
        d = o.r + 0.8 + rnd() * 1.7;
      x = mm(o.x + d * Math.cos(a));
      z = mm(o.z + d * Math.sin(a));
    } else {
      const a = rnd() * Math.PI * 2;
      const r = mode === 4 ? 18.5 + rnd() * 2.5 : 2.2 + Math.sqrt(rnd()) * 17.3;
      x = mm(r * Math.cos(a));
      z = mm(r * Math.sin(a));
    }
    const r = Math.hypot(x, z);
    if (r > 21) continue;
    // Lối vào hầm: dải rộng 6 m quanh trục mỗi miệng hầm, từ r = 17,5 m trở ra.
    if (
      r > 17.5 &&
      MOUTH_DIRS.some(
        ([ux, uz]) => x * ux + z * uz > 0 && Math.abs(x * uz - z * ux) < 3,
      )
    )
      continue;
    // Mặt nước: elip ~6,6 x 4,4 m quanh vũng (xoay ngược yaw của vũng).
    const px = x - PUDDLE.x,
      pz = z - PUDDLE.z,
      c = Math.cos(PUDDLE.yaw * DEG),
      s = Math.sin(PUDDLE.yaw * DEG);
    if (Math.hypot((px * c - pz * s) / 3.3, (px * s + pz * c) / 2.2) < 1)
      continue;
    stone(x, z, mode >= 2);
  }
  for (const cave of HUB_CAVES) {
    const s = shellFrame(cave);
    let placed = 0;
    for (let tries = 0; placed < perCave && tries < 400; tries++) {
      const a = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * 7.4;
      const lx = r * Math.cos(a),
        lz = r * Math.sin(a);
      // Lối từ miệng hang vào: dải rộng 4 m quanh trục hầm.
      if (lz > 3.5 && Math.abs(lx) < 2) continue;
      const p = frameToCave(s, lx, lz);
      if (stone(p.x, p.z, placed % 3 === 0)) placed++;
    }
  }
  return out;
}

/** Mọi model của hub (trừ vỏ hang CAVE_SHELL_PIECES). */
export const HUB_PLACEMENTS: readonly Placement[] = [
  ...SOLID,
  ...foregroundStones,
  ...scatterStones(190, 14),
];

const placed = (list: readonly Placement[], asset: string): Placement => {
  const p = list.find((q) => q.asset === asset);
  if (!p) throw new Error(`layout: ${asset} chưa được đặt`);
  return p;
};
/**
 * Model mang bảng hiệu của từng sạp (manifest meta.sign.faces cho biết mặt phẳng để vẽ chữ): client
 * (apps/web/src/world/stalls.ts) dán texture tên sạp lên đó.
 */
export const HUB_STALL_SIGNS: Readonly<Record<CaveStallId, Placement>> = {
  checkin: placed(checkinStall, M.stallCheckin),
  shop: placed(marketCave, M.stallApparel),
  quiz: placed(quizCave, M.signStall),
  quest: placed(questCave, M.signStall),
  memory: placed(memoryCave, M.signStallWide),
};
/**
 * Bảng hiệu nằm ở đâu trong hệ trục của model mang nó: mặt phẳng z, nửa bề rộng bảng (m), mép trước
 * mái bạt nếu có. Khớp generator (tools/models/groups/furniture.ts, scripts/stalls.test.ts so với
 * manifest); client dùng để đặt vùng chặn camera trên cao và làm số dự phòng khi thiếu manifest.
 */
export const STALL_SIGN_BOARD = { bottom: 2.24, height: 0.78 } as const;
export const STALL_SIGN_BOARDS: Readonly<Record<string, { readonly z: number; readonly half: number; readonly awning?: number }>> = {
  [M.signStall]: { z: 0, half: 1.15 },
  [M.signStallWide]: { z: 0, half: 1.5 },
  [M.stallCheckin]: { z: -1.05, half: 1.15, awning: 0.2 },
  [M.stallApparel]: { z: -1.15, half: 1.15 },
};
/** Chủ sạp (NPC) của từng sạp. */
export const HUB_STALL_HOSTS: Readonly<Record<CaveStallId, Placement>> = {
  checkin: placed(checkinStall, host("oner")),
  shop: placed(marketCave, host("peyz")),
  quiz: placed(quizCave, host("keria")),
  quest: placed(questCave, host("doran")),
  memory: placed(memoryCave, host("keeper")),
};

/** Điểm tương tác (E): chỗ đứng nhìn đồ vật, ~1,5–2 m trước mặt nó. */
export const HUB_LANDMARKS: readonly Landmark[] = [
  ...CAVE_STALLS.map(s => ({ id: s.id, name: s.name, ...stallApproach(s) })),
  { id: "rest", name: "Góc thâm niên", ...REST_SPOT },
  { id: "screen", name: "Lịch đấu T1", x: SCREEN_SPOT.x, z: SCREEN_SPOT.z },
  { id: "altar", name: "Cửa điện thờ Faker", x: CAVE_SHRINE_GATE.x, z: CAVE_SHRINE_GATE.z },
];

/** Gốc + hướng nhìn (yaw) của từng vùng: camera xem trước, debug, bot. */
export const HUB_ZONES = {
  campfire: { x: 0, z: 0, yaw: 0 },
  checkin: STALL.checkin,
  shop: STALL.shop,
  quiz: STALL.quiz,
  quest: STALL.quest,
  memory: STALL.memory,
  altar: CAVE_SHRINE_GATE,
  crateCorner: CRATE_CORNER,
  water: PUDDLE,
  exit: EXIT,
  rest: REST,
  living: LIVING,
  tea: TEA,
  crates: CRATES,
  rug: RUG_SEATS,
} as const satisfies Record<string, Frame>;

/**
 * Lối đi phải luôn thông (scripts/movement.test.ts): từ vòng quanh lửa trại (r = 5,5 m) ra từng
 * miệng hầm, ra chỗ xuất hiện và ra cửa điện thờ, rộng ≥ WALKWAY_WIDTH.
 */
export const WALKWAY_WIDTH = 2.5;
export const HUB_WALKWAYS: readonly { readonly id: string; readonly to: { readonly x: number; readonly z: number } }[] = [
  { id: "spawn", to: { x: HUB_SPAWN.x, z: HUB_SPAWN.z } },
  { id: "altar", to: { x: CAVE_SHRINE_GATE.x, z: CAVE_SHRINE_GATE.z } },
  ...HUB_CAVES.map((c) => {
    const d = Math.sqrt(c.x * c.x + c.z * c.z);
    return { id: c.id, to: { x: mm((c.x / d) * HUB_RADIUS), z: mm((c.z / d) * HUB_RADIUS) } };
  }),
];

/** Vật cản của cả bảng, theo thứ tự bảng (vòng lửa trại đứng đầu). */
export function hubObstacles(
  placements: readonly Placement[] = HUB_PLACEMENTS,
): Obstacle[] {
  return placements.flatMap(placementObstacles);
}
