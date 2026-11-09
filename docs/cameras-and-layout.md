# Camera và bố cục — Hang trú thua v3

Bản đang chạy dựng từ model GLB sinh bằng code (`tools/models`) và một bảng đặt model dùng chung
cho cả client lẫn server (`packages/shared/src/layout.ts`). Ảnh concept: `design/concepts/v3/01–04`.

## Toạ độ

- Gốc = tâm lửa trại, mét, Y hướng lên. Người chơi xuất hiện quanh (0, 10) (rải ±1,5 m, đĩa 2,5 m
  quanh đó luôn trống) và nhìn về −Z.
- Phía sau (−Z): cửa hầm. Miệng hầm ở z = −19,3 (rộng 3,5 m, cao 3,6 m, sâu 6,4 m, cụt), khung gỗ ở
  (0, −18,35), biển biểu tượng đứng trên xà khung (scale 1,8).
- Bên trái màn hình (−X): nước, TV, bảng đố, vách ký ức. Bên phải (+X): góc thâm niên, góc sinh hoạt.
- Vỏ hang: nền r = 21 (phẳng khi r < 14), vách r ≈ 19,4 ở chân nghiêng vào ≈ 16,4 m ở 13,6 m, trần
  cao nhất 14 m. Model nào cũng quay mặt về +Z; yaw θ quay mặt sang (sin θ, 0, cos θ).

## Các vùng

Mỗi vùng có một khung (gốc + yaw, mặt hướng vào sảnh) trong `HUB_ZONES`; đồ đạc đặt theo toạ độ của
khung nên xê dịch cả vùng chỉ cần sửa khung.

| Vùng | Khung (x, z, yaw) | Nội dung |
|---|---|---|
| Lửa trại | (0, 0, 0) | Vòng đá, than; 7 fan NPC quanh lửa: hạng 01 ôm trán trên thùng (trước-trái), bàn thấp có ấm/cốc/mì, hạng 02 xe lăn (sau-trái), cặp fan an ủi nhau (ngay sau lửa, quay về phía người mới vào), hạng 03 thở oxy ngả lưng (sau-phải), fan đeo kính cầm cốc (phải), fan mũ đỏ (trước-phải). Phía +Z để trống về chỗ xuất hiện. |
| TV trú thua | (−7,3, −2,55, 70,5) | TV DEFEAT (scale 1,7) trên thùng lớn, tay cầm, cốc, 2 ghế, đuốc ba chân. |
| Nước | (−11, −4,3, 68) | Vũng nước dọc vách (toàn bộ trên nền phẳng), mặt nước bóng + vệt phản chiếu đuốc, măng đá, đuốc bên kia mặt nước, phiến đá thấp. |
| Vách ký ức | (−6,294, −12,394, 27) | Tấm ván ký ức đóng vào khối đá lớn (scale 1,5), đuốc sát mép, ghế, thùng, fan đứng cầm cốc. |
| Cửa hang | (0, −18,35, 0) | Khung hầm, biển, hai đuốc ba chân ở (±2,4, −16,45) với dây chăng giữa (giới hạn đi được), đuốc mờ trong hầm. |
| Góc thâm niên | (9, −5,5, −58,5) | Bạt, giường sắt (hạng 04 nằm đắp chăn tới ngực, cầm điện thoại), thùng đầu giường có đèn bão + cốc, chồng thùng, xe lăn trống, bình oxy trắng, đèn treo móc bạt, đuốc ba chân. |
| Góc sinh hoạt | (10, 5, −116,5) | Bàn + 4 ghế + ấm, cốc, mì, đèn bão; bạt thứ hai; dây phơi sát vách; thảm; đuốc ngoài mép bạt; thùng. |
| Góc đố vui | (−10, 6, 95) | Bảng phấn, 6 ghế nửa vòng (bán kính 2,4 m), đuốc sát bảng, thùng. |

Thêm: 2 đuốc hai bên chỗ xuất hiện (±5,5, 12,5) kèm thùng + ghế, đá và măng đá sát vách, một tảng đá
lớn giữa cửa hầm và góc thâm niên, ~134 đá vụn (không va chạm). Tổng 11 đuốc, 3 đèn bão.

Điểm tương tác (phím E khi cách < 3 m), là chỗ đứng nhìn đồ vật:

| id | Tên | Vị trí |
|---|---|---|
| memory | Vách ký ức | (−5,229, −10,524) |
| rest | Góc thâm niên | (7,049, −4,187) |
| tv | TV trú thua | (−5,368, −1,866) |

## Va chạm

- Server quyết định vị trí ở 20 Hz; client dự đoán bằng cùng `applyInput()` / `constrain()`
  (`packages/shared/src/index.ts`). Vùng đi được: bán kính 16 m (vách gần nhất 16,6 m) trừ các vật
  cản tròn. `HUB_LAYOUT.obstacles` (74 vòng, `obstacles[0]` = vòng đá lửa trại r 1,6) suy ra từ
  collider trong bảng đặt, làm tròn 1 mm; `HUB_LAYOUT_HASH` là dấu vân tay của bố cục.
- Luật (có test trong `scripts/movement.test.ts`): hai vật cản hoặc chồng sâu (khoảng cách tâm² ≤
  r1² + r2²) hoặc cách nhau ≥ `MIN_GAP` = 0,4 m, trừ khi khe nằm trọn trong vật cản thứ ba; mỗi vật cản
  cách biên ≥ 0,4 m hoặc là "khối chặn sát vách" (tâm ngoài biên, khoảng cách² ≥ 16² + r²). Khối chặn
  bịt lối men theo vách (sau vách ký ức, măng đá sau vũng nước).
- Collider đã gồm khoảng thân người; đá vụn, thảm, vũng nước, đồ trên bàn không có collider. Dây chăng
  cửa hầm chỉ có hai vòng nhỏ ở nút buộc (ngoài vùng đi được). Người chơi dừng ở r = 16 trước miệng
  hầm, ngay trước dây chăng.

## Ánh sáng và chất lượng

- Camera: ACES + sRGB, sương mù tuyến tính #2A1A12 từ 16 đến 70 m. Ambient (0,27; 0,27; 0,30),
  đèn định hướng mát yếu, đèn hắt ấm phía trên sảnh, 7 đèn ấm cao gần vách (2 đèn cho góc sau), một
  đèn rọi biển cửa hầm.
- Lửa trại: một đèn đổ bóng (tầm 6,5 m, nâng 1,4 m lên trên các fan đang ngồi nên bóng ngắn) và một đèn
  rộng không bóng (tầm 12 m). Đây là đèn đổ bóng duy nhất. Đuốc, đèn bão, TV có đèn omni riêng.
- Ngọn lửa nhấp nháy theo scale riêng từng cây đuốc; vật liệu phát sáng khác (than, kính đèn, màn
  CRT) cập nhật 8 lần/giây.
- `createWorld(app, { quality })`: mặc định "auto" — "high" (post-processing: HDR, MSAA 4x, bloom,
  vignette; bóng PCF5, atlas 2048) trên máy chuột, "low" (không post, PCF3, atlas 1024) trên thiết bị
  cảm ứng, và tự hạ xuống "low" khi khung hình trung bình chậm hơn 25 ms trong hai cửa sổ 4 s.

## Camera preset (`apps/web/src/world/views.ts`)

| Tên | Vị trí | Nhìn tới | FOV | Dùng cho |
|---|---|---|---|---|
| concept | (−0,9; 2,0; 8,0) | (0,4; 1,45; −8) | 60° | Khung chính concept 01, màn chào trước khi vào hang |
| spawn | (0; 2,6; 15,5) | (0; 1,2; 0) | 50° | Cảnh ngay sau khi xuất hiện |
| campfire | (2,9; 1,9; 5,9) | (−1,3; 0,85; −1,4) | 54° | Nhóm fan quanh lửa |
| memory | (−3,58; 1,7; −7,94) | (−6,11; 1,35; −12,04) | 52° | Vách ký ức |
| tv | (−3,08; 1,6; −1,59) | (−7,02; 0,9; −2,45) | 50° | Góc minigame |
| rest | (5,36; 1,55; −3,97) | (9,45; 0,8; −5,54) | 55° | Góc thâm niên (cận) |
| living | (6,06; 1,6; 3,48) | (10,27; 0,9; 5,13) | 55° | Góc sinh hoạt (cận) |
| quiz | (−4,42; 1,75; 5,51) | (−9,4; 0,95; 5,95) | 50° | Góc đố vui |
| exit | (0,9; 2,0; −8,5) | (0; 2,3; −18,6) | 50° | Cửa hầm + biển |
| overview | (0; 30; 21) | (0; 0; −1,8) | 46° | Nhìn zoning từ trên, ẩn trần |

Preset theo vùng tính từ khung của vùng, nên đi theo khi bố cục xê dịch.

## Camera chơi game và điều khiển

- Camera bám sau lưng (`apps/web/src/camera.ts`): mặc định yaw 180 (nhìn về cửa hầm), pitch 18°, cách
  5,5 m (zoom 2,5–8 m, pitch −5..60°), tâm nhìn cao 1,3 m và lệch 0,45 m sang phải (qua vai, tối đa
  0,15 × cần), FOV dọc 50° nhưng luôn giữ ngang ≥ 60° (màn dọc tới 75°, `cameraMath.fitFov`).
- Camera không ra ngoài hình trụ 16,8 m, cao 0,6–9 m (chạm vách thì rút cần ngay). Đồ cao từ 1,5 m
  (đuốc, bảng, đá, cột bạt) và thân NPC là vật chắn: cần rút vào trong ~0,1 s và không duỗi xuyên qua.
- Đứng yên 0,4 s trong vòng 3 m của điểm tương tác thì camera "nhìn kỹ": lệch vai 0,75 m, pitch +6°,
  chuyển trong 0,35 s; đi tiếp thì trả lại. Avatar của mình mờ dần khi cần ngắn hơn 1,8 m.
- WASD / mũi tên đi theo hướng camera; kéo chuột (trái hoặc phải) hoặc một ngón để xoay; lăn chuột /
  véo để zoom; E xem điểm tương tác (< 3 m), Esc đóng; 1/2/3 = chào / cười trừ / cổ vũ; Enter để chat.
  Trên điện thoại có nút W/A/S/D.

## Dữ liệu nằm ở đâu

- `packages/shared/src/layout.ts`: `HUB_PLACEMENTS` (mọi model, yaw, scale, collider, NPC + tư thế, đồ
  cầm, đèn, node ẩn), `HUB_LANDMARKS`, `HUB_ZONES`, `CAVE_SHELL`, `MIN_GAP`. Sửa ở đây là đổi cả hình lẫn
  va chạm (server tự khởi động lại khi `packages/shared` đổi).
- `apps/web/src/scene.ts`: `createWorld()` — camera, ánh sáng, tải GLB (đặt từng model ngay khi tải
  xong), NPC, mặt nước, batch tĩnh. `apps/web/src/world/`: manifest, NPC, preset camera, vệt sáng nước.

## Pipeline model

- Mã sinh model: `tools/models/lib.ts` + `tools/models/groups/<nhóm>.ts` (environment, fire,
  furniture, props, characters). Dựng: `npx tsx tools/models/build.ts <nhóm|all>`. Kết quả tất định.
- Đầu ra: `apps/web/public/models/<nhóm>/<tên>.glb` và `manifest.<nhóm>.json` (tam giác, bounds,
  anchor, đèn, pose, collider, ghi chú đặt). Luôn tải GLB qua `apps/web/src/models.ts`.
- Kiểm tra kiểu cho mã sinh model: `npx tsc --noEmit -p tools/models`.

## Trang dev (chỉ dev, không vào bản build)

- `/gallery.html`: xem từng GLB (`?model=nhóm/tên`, `yaw`, `pitch`, `zoom`, `pose`, `ref=1`…; xem đầu
  `apps/web/src/gallery.ts`).
- `/preview.html`: dựng cả hang. Tham số: `view=<preset>`, `cam=x,y,z&look=x,y,z&fov=`, `npcs=0`,
  `post=0`, `quality=high|low|auto`, `time=<s>` (đóng băng nhấp nháy để chụp), `stats=1`, `fans=<n>`,
  `debug=1` (vẽ vòng va chạm, bán kính đi được, đĩa xuất hiện, vòng 3 m của điểm tương tác),
  `bench=<n>`, `patch={"<i>":{…}}` và `add=[…]` (thử vị trí/tư thế mà không phải sửa `layout.ts`).
- Chụp headless: `node tools/models/render.mjs --url "<url>" --out .renders/<thư mục>/<tên>.png`.
- Trang game có tham số dev `?view=`, `?autojoin=<tên>`, `?stats=1`, `?batch=0` (xem `docs/playtest.md`).

## Bot và kiểm tra

- Bot: `BOTS=4 DURATION_SECONDS=300 npm run bots` (mặc định 8 bot, `GAME_URL` mặc định
  ws://127.0.0.1:2800; Ctrl+C để rời).
- `npm run check` (tsc), `npm test` (node:test trên `scripts/*.test.ts`), `npm run build`.
