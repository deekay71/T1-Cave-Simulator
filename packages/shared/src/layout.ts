/**
 * Bố cục "Hang trú thua" theo concept v3 (design/concepts/v3/01–04): bảng đặt mọi model GLB của
 * hub và collider tròn của chúng. Đây là nguồn sự thật duy nhất: client dựng cảnh từ
 * HUB_PLACEMENTS, còn server và client cùng suy ra HUB_LAYOUT.obstacles từ đó (packages/shared).
 * Chỉ có dữ liệu thuần và vài hàm nhỏ, không import PlayCanvas.
 *
 * Không gian hang: gốc = tâm lửa trại, mét, Y hướng lên. Người chơi xuất hiện quanh (0, 10) và
 * nhìn về -Z: cửa hang ở phía sau (-Z), bên trái màn hình là -X (nước, TV, bảng đố, vách ký ức),
 * bên phải là +X (góc thâm niên, góc sinh hoạt). Model nào cũng quay mặt về +Z; yaw θ (độ,
 * setLocalEulerAngles(0, θ, 0)) quay mặt model sang (sin θ, 0, cos θ).
 *
 * Collider là các hình tròn {dx, dz, r} trong mặt phẳng XZ cục bộ của model (trước khi xoay yaw),
 * đã cộng sẵn khoảng thân người chơi. Luật (scripts/movement.test.ts kiểm tra), để constrain() hội
 * tụ và không có khe hẹp cho người chơi lách qua giữa hai món đồ:
 * - hai vật cản bất kỳ hoặc chồng sâu (khoảng cách tâm² ≤ r1² + r2²), hoặc cách nhau ≥ MIN_GAP
 *   (một lối đi thật), trừ khi khe đó nằm trọn trong một vật cản thứ ba;
 * - mỗi vật cản hoặc nằm trong bán kính đi được và cách biên ≥ MIN_GAP, hoặc là "khối chặn sát
 *   vách": tâm ở ngoài biên đủ xa (khoảng cách tâm² ≥ HUB_RADIUS² + r²) để lấn vào vùng đi được
 *   mà góc tạo với biên vẫn tù. Khối chặn bịt kín lối men theo vách (ví dụ sau vách ký ức).
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
export type LandmarkId = "memory" | "rest" | "tv";
export interface Landmark {
  readonly id: LandmarkId;
  readonly name: string;
  /** Chỗ người chơi đứng nhìn đồ vật (bấm E khi cách < 3 m). */
  readonly x: number;
  readonly z: number;
}

/** Biên đi được: vách/gờ gần nhất (dưới 1,8 m) cách tâm 16,6 m (manifest floor walkBoundary). */
export const HUB_RADIUS = 16;
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
  tunnelFrame: "environment/tl_env_tunnel_frame_v01",
  puddle: "environment/tl_env_puddle_v01",
  rockA: "environment/tl_env_rock_cluster_a_v01",
  rockB: "environment/tl_env_rock_cluster_b_v01",
  rockC: "environment/tl_env_rock_cluster_c_v01",
  stalagmiteA: "environment/tl_env_stalagmite_a_v01",
  stalagmiteB: "environment/tl_env_stalagmite_b_v01",
} as const;
const fan = (variant: string) => `characters/tl_char_fan_${variant}_v01`;
/** Vỏ hang dựng sẵn trong không gian hang: đặt tại gốc, không xoay. */
export const CAVE_SHELL = [
  "environment/tl_env_cave_floor_v01",
  "environment/tl_env_cave_wall_00_v01",
  "environment/tl_env_cave_wall_01_v01",
  "environment/tl_env_cave_wall_02_v01",
  "environment/tl_env_cave_wall_03_v01",
  "environment/tl_env_cave_wall_04_v01",
  "environment/tl_env_cave_wall_05_v01",
  "environment/tl_env_cave_ceiling_v01",
] as const;

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

/* ---------------------------------------------------------------- TV trú thua (trái) */

const TV = { x: -7.3, z: -2.55, yaw: yawToward(-7.3, -2.55) };
const tvCorner: Placement[] = zone(TV, [
  { asset: M.crateLarge, at: [0, 0], colliders: [{ dx: 0, dz: 0, r: 0.72 }] },
  // Thu 1,7: đọc được chữ DEFEAT từ quanh lửa trại.
  { asset: M.tv, at: [0, -0.04], y: 0.8, scale: 1.7 },
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

/* ---------------------------------------------------------------- nước (trái xa) */

/**
 * Vũng nước trái xa, trục dài chạy dọc vách như con suối concept 01; toàn bộ mặt nước nằm trên nền
 * phẳng (cách tâm < 14 m, manifest). Trục +Z của vũng hướng vào sảnh.
 */
const PUDDLE = { x: -11, z: -4.3, yaw: 68 };
const water: Placement[] = [
  // Vũng nông 5 cm: đi qua được (không collider).
  { asset: M.puddle, ...PUDDLE },
  // Khối chặn sát vách: măng đá lớn bịt lối men theo vách phía sau vũng.
  {
    asset: M.stalagmiteB,
    x: -16.1,
    z: -2.87,
    yaw: 40,
    colliders: [{ dx: 0, dz: 0, r: 0.75 }],
  },
  { asset: M.stalagmiteA, x: -16.2, z: -8.5, yaw: 0 },
  // Đuốc bên kia mặt nước: lửa soi xuống nước như concept 01 (vệt sáng: apps/web/src/world/water.ts).
  {
    asset: M.torchPole,
    ...frameToCave(PUDDLE, -0.8, -2.7),
    yaw: 30,
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  { asset: M.stalagmiteA, x: -14.6, z: -9.9, yaw: 120, scale: 0.8 },
  // Phiến đá thấp bên mép nước (ngồi được), 3 vòng chồng sâu.
  {
    asset: M.rockC,
    x: -11.3,
    z: -8.7,
    yaw: yawToward(-11.3, -8.7),
    colliders: [
      { dx: -1.2, dz: 0, r: 0.9 },
      { dx: 0, dz: 0, r: 0.9 },
      { dx: 1.2, dz: 0, r: 0.9 },
    ],
  },
];

/* ---------------------------------------------------------------- vách ký ức (sau-trái) */

/**
 * Vách ký ức (concept 02): tấm ván đóng vào khối đá lớn sau lưng (đá nhô cao hơn tấm ván). Collider
 * của khối đá là khối chặn sát vách, chồng sâu với collider tấm ván: không còn khe men theo vách
 * chui ra sau tấm ván. Đuốc áp sát mép trái tấm ván (chồng sâu); thùng, ghế và fan đứng cách ≥ MIN_GAP.
 */
const MEMORY = { x: -6.294, z: -12.394, yaw: 27 };
const memoryWall: Placement[] = zone(MEMORY, [
  {
    asset: M.memoryBoard,
    at: [0, 0],
    colliders: [
      { dx: -1.35, dz: -0.65, r: 1.35 },
      { dx: 0, dz: -0.65, r: 1.35 },
      { dx: 1.35, dz: -0.65, r: 1.35 },
    ],
  },
  {
    asset: M.rockA,
    at: [0, -2.2],
    yaw: 180,
    scale: 1.5,
    colliders: [
      { dx: -1.2, dz: 0, r: 0.933 },
      { dx: 0, dz: 0, r: 1.067 },
      { dx: 1.2, dz: 0, r: 0.933 },
    ],
  },
  {
    asset: M.torchPole,
    at: [-2.45, 0.1],
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  {
    asset: M.stool,
    at: [0.85, 1.55],
    yaw: 200,
    colliders: [{ dx: 0, dz: 0, r: 0.28 }],
  },
  {
    asset: M.crateSmall,
    at: [2.35, 1.7],
    yaw: 15,
    colliders: [{ dx: 0, dz: 0, r: 0.45 }],
  },
  {
    asset: M.crateLarge,
    at: [3.45, 0.55],
    yaw: -10,
    colliders: [{ dx: 0, dz: 0, r: 0.6 }],
  },
  { asset: M.crateSmall, at: [3.4, 0.53], y: 0.8, yaw: 8 },
  {
    asset: fan("hoodie_black"),
    at: [-2, 1.4],
    yaw: 160,
    colliders: [{ dx: 0, dz: 0, r: 0.35 }],
    npc: {
      pose: "slump",
      tweak: { head: [26, 0, 0] },
      hold: mugInRight(M.mugRed),
    },
  },
]);

/* ---------------------------------------------------------------- cửa hang (sau) */

/** Biển đứng trên xà khung hầm (anchor 'sign' của khung), thu 1,8 (rộng ~3 m): tiêu điểm phía sau. */
const SIGN_SCALE = 1.8;
const exit: Placement[] = [
  // Khung gỗ cửa hầm (anchor 'tunnel_frame' của wall_01).
  { asset: M.tunnelFrame, x: 0, z: -18.35, yaw: 0 },
  { asset: M.sign, x: 0, z: -18, yaw: 0, y: 3.13, scale: SIGN_SCALE },
  // Hai đuốc ba chân hai bên miệng hầm, ngay ngoài biên đi được; dây chăng giữa hai đuốc đánh dấu
  // chỗ người chơi phải dừng (thay cho bức tường vô hình), mép trong dây ~16,4 m.
  { asset: M.torchTripod, x: -2.4, z: -16.45, yaw: 10 },
  { asset: M.torchTripod, x: 2.4, z: -16.45, yaw: -10 },
  {
    asset: M.cordon,
    x: 0,
    z: -16.45,
    yaw: 0,
    // Chỉ hai nút buộc ở đuốc (ngoài vùng đi được): camera coi dây như hai điểm, không như một đĩa
    // rộng bằng cả sợi dây (blockers.ts lấy footprint khi model không có collider).
    colliders: [
      { dx: -2.4, dz: 0, r: 0.12 },
      { dx: 2.4, dz: 0, r: 0.12 },
    ],
  },
  // Đuốc mờ trong hầm (anchor 'tunnel_torch' của wall_01).
  { asset: M.torchPole, x: 0.6, z: -23.5, yaw: 0, scale: 0.8, light: 0.45 },
];

/* ---------------------------------------------------------------- góc thâm niên (phải) */

/**
 * Góc thâm niên (concept 01 rest corner): bạt, giường sắt có hạng 04 nằm đắp chăn tới ngực cầm
 * điện thoại, thùng đầu giường có đèn bão và cốc, chồng thùng, xe lăn trống và bình oxy trắng.
 * Giường + thùng đầu giường + chồng thùng là một khối liền (collider chồng sâu thành chuỗi); xe lăn,
 * đuốc và cột bạt cách khối đó ≥ MIN_GAP.
 */
const REST = { x: 9, z: -5.5, yaw: yawToward(9, -5.5) };
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

/* ---------------------------------------------------------------- góc sinh hoạt (trước-phải) */

/**
 * Góc sinh hoạt (concept 02 living corner): bàn, 4 ghế đẩu, ấm, cốc, mì, đèn bão trên bàn, bạt che,
 * dây phơi sát vách, thảm. Cả bộ bàn ghế là một vòng va chạm (không lách vào giữa ghế); đuốc đứng
 * ngoài mép bạt (lửa không cháy trong tua bạt).
 */
const LIVING = { x: 10, z: 5, yaw: yawToward(10, 5) };
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

/* ---------------------------------------------------------------- góc đố vui (trước-trái) */

const QUIZ = { x: -10, z: 6, yaw: 95 };
/** Nửa vòng 6 ghế đẩu trước bảng (bán kính 2,4 m: giữa hai ghế cạnh nhau còn lối ≥ MIN_GAP). */
const quizStools: Item[] = [-60, -36, -12, 12, 36, 60].map((a, i) => ({
  asset: i % 3 === 1 ? M.stoolSquare : M.stool,
  at: [
    mm(2.4 * Math.sin(a * DEG)),
    mm(0.35 + 2.4 * Math.cos(a * DEG)),
  ] as const,
  yaw: a + 180,
  colliders: [{ dx: 0, dz: 0, r: 0.28 }],
}));
const quiz: Placement[] = zone(QUIZ, [
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
  // Đuốc áp sát mép bảng (chồng sâu với collider bảng), thùng gỗ đứng riêng.
  {
    asset: M.torchPole,
    at: [1.3, -0.25],
    colliders: [{ dx: 0, dz: 0, r: 0.3 }],
  },
  {
    asset: M.crateSmall,
    at: [2.5, -0.6],
    yaw: 20,
    colliders: [{ dx: 0, dz: 0, r: 0.45 }],
  },
]);

/* ---------------------------------------------------------------- đuốc lối vào + đá */

/** Hai đuốc hai bên chỗ xuất hiện, mỗi bên một thùng lớn và một ghế đẩu sát vách phía sau. */
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

/** Đá sát vách: mép trong ở ngoài bán kính đi được nên không cần collider. */
const wallRocks: Placement[] = [
  wall(M.rockA, 148, 18.2),
  wall(M.rockB, 122, 17.4),
  wall(M.stalagmiteB, 100, 17.2),
  wall(M.rockC, 80, 17.6),
  wall(M.stalagmiteA, 62, 17.0),
  wall(M.rockB, 38, 17.4),
  wall(M.rockB, 24, 17.6),
  wall(M.rockA, 8, 18.2),
  wall(M.stalagmiteB, 352, 17.2),
  wall(M.rockA, 342, 18.2),
  wall(M.stalagmiteB, 318, 17.2),
  wall(M.rockC, 290, 17.6),
  wall(M.rockB, 262, 17.4),
  wall(M.rockA, 222, 18.2),
  wall(M.rockB, 160, 17.4),
  wall(M.rockC, 200, 17.6),
];
/**
 * Tảng đá lớn trong lòng hang (giữa cửa hang và góc thâm niên): ba vòng dọc trục dài phủ cả mấy
 * hòn đá nhỏ quanh tảng chính (footprint 4,1 x 3,3 m).
 */
const boulders: Placement[] = [
  {
    asset: M.rockA,
    x: 6.2,
    z: -12.2,
    yaw: yawToward(6.2, -12.2),
    colliders: [
      { dx: -1, dz: 0, r: 1.55 },
      { dx: 0, dz: 0, r: 1.75 },
      { dx: 1, dz: 0, r: 1.55 },
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

/** Chỗ đứng của ba điểm tương tác (memory, rest, tv): đá vụn tránh ra. */
const LANDMARK_SPOTS = [
  frameToCave(MEMORY, 0.1, 2.15),
  frameToCave(REST, 0.1, 2.35),
  frameToCave(TV, 0, 2.05),
] as const;

/* ---------------------------------------------------------------- đá vụn rải nền */

const SOLID: Placement[] = [
  ...fire,
  ...rank01,
  ...lowTable,
  ...rank02,
  ...mugStool,
  ...rank03,
  ...frontStools,
  ...pair,
  ...tvCorner,
  ...water,
  ...memoryWall,
  ...exit,
  ...rest,
  ...living,
  ...quiz,
  ...spawnTorches,
  ...wallRocks,
  ...boulders,
];

/**
 * Đá nhỏ rải tất định (LCG), không collider, tránh đồ đạc, vũng nước, điểm xuất hiện và chỗ đứng
 * xem (điểm tương tác). 2/5 rải đều trên nền (cỡ vừa), 2/5 quây quanh đồ đạc cách 0,8–2,5 m và 1/5
 * dọc chân vách (13–15,5 m) với phiến lớn: nền bớt phẳng như concept 01.
 */
function scatterStones(count: number): Placement[] {
  const keepOut = SOLID.flatMap(placementObstacles);
  const anchors = keepOut.filter((o) => o.r < 1.6 || o.x !== 0 || o.z !== 0);
  let seed = 20261109;
  const rnd = () =>
    (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const out: Placement[] = [];
  for (let tries = 0; out.length < count && tries < 8000; tries++) {
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
      const r = mode === 4 ? 13 + rnd() * 2.5 : 2.2 + Math.sqrt(rnd()) * 13.3;
      x = mm(r * Math.cos(a));
      z = mm(r * Math.sin(a));
    }
    const kind = ["a", "b", "c", "d"][Math.floor(rnd() * 4)];
    const big = mode >= 2;
    const slab = kind === "a" || kind === "d";
    const k = slab
      ? big
        ? 1.2 + rnd() * 1.0
        : 1 + rnd() * 0.5
      : 0.9 + rnd() * (big ? 0.7 : 0.5);
    const scale = Math.round(k * 100) / 100;
    const yaw = Math.round(rnd() * 360) - 180;
    if (Math.hypot(x, z) > 15.5) continue;
    if (keepOut.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.25))
      continue;
    if (Math.hypot(x - HUB_SPAWN.x, z - HUB_SPAWN.z) < 1.6) continue;
    if (LANDMARK_SPOTS.some((l) => Math.hypot(x - l.x, z - l.z) < 0.9))
      continue;
    // Mặt nước: elip ~6,6 x 4,4 m quanh vũng (xoay ngược yaw của vũng).
    const px = x - PUDDLE.x,
      pz = z - PUDDLE.z,
      c = Math.cos(PUDDLE.yaw * DEG),
      s = Math.sin(PUDDLE.yaw * DEG);
    if (Math.hypot((px * c - pz * s) / 3.3, (px * s + pz * c) / 2.2) < 1)
      continue;
    out.push({
      asset: `environment/tl_env_stone_small_${kind}_v01`,
      x,
      z,
      yaw,
      scale,
    });
  }
  return out;
}

/** Mọi model của hub (trừ vỏ hang CAVE_SHELL). */
export const HUB_PLACEMENTS: readonly Placement[] = [
  ...SOLID,
  ...foregroundStones,
  ...scatterStones(120),
];

/** Điểm tương tác (E): chỗ đứng nhìn đồ vật, ~1,5–2 m trước mặt nó. */
export const HUB_LANDMARKS: readonly Landmark[] = [
  { id: "memory", name: "Vách ký ức", ...LANDMARK_SPOTS[0] },
  { id: "rest", name: "Góc thâm niên", ...LANDMARK_SPOTS[1] },
  { id: "tv", name: "TV trú thua", ...LANDMARK_SPOTS[2] },
];

/** Gốc + hướng nhìn (yaw) của từng vùng: camera xem trước, debug. */
export const HUB_ZONES = {
  campfire: { x: 0, z: 0, yaw: 0 },
  tv: TV,
  water: PUDDLE,
  memory: MEMORY,
  exit: { x: 0, z: -18.35, yaw: 0 },
  rest: REST,
  living: LIVING,
  quiz: QUIZ,
} as const satisfies Record<string, Frame>;

/** Vật cản của cả bảng, theo thứ tự bảng (vòng lửa trại đứng đầu). */
export function hubObstacles(
  placements: readonly Placement[] = HUB_PLACEMENTS,
): Obstacle[] {
  return placements.flatMap(placementObstacles);
}
