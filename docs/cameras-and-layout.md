# Camera và bố cục — Hang trú thua v3 (năm hang)

Bản đang chạy dựng từ model GLB sinh bằng code (`tools/models`) và một bảng đặt model dùng chung
cho cả client lẫn server (`packages/shared/src/layout.ts`). Ảnh concept: `design/concepts/v3/01–04`.
Từ 2026-11-11 thế giới gồm **một hang lớn sinh hoạt chung và bốn hang nhỏ** nối bằng đường hầm đi bộ
(vỏ: nhóm model `caves`, `tools/models/groups/caves.ts`).

## Toạ độ

- Gốc = tâm lửa trại, mét, Y hướng lên. Người chơi xuất hiện quanh (0, 10) (rải ±1,5 m, đĩa 2,5 m
  quanh đó luôn trống) và nhìn về −Z.
- Phía sau (−Z): cửa hầm = cửa điện thờ. Miệng hầm ở z = −23,4 (rộng 3,5 m, cao 3,6 m, sâu 6,4 m,
  cụt), khung gỗ ở (0, −22,45) (trước miệng hầm 0,95 m), biển biểu tượng trên xà khung (scale 1,8).
- Bên trái màn hình (−X): góc thùng, vũng nước, màn hình lớn bắt vào vách sau-trái. Bên phải (+X): góc sinh hoạt, góc thâm niên
  (sau-phải). Bốn miệng hầm sang hang nhỏ ở các hướng 60°, 120°, 240°, 300° (tính từ +Z về +X).
- Vỏ hang lớn: nền r = 25,2 (phẳng khi r < 21), vách r ≈ 23,4 ở chân (gần nhất 22,76) nghiêng vào
  ≈ 20 m ở 14,8 m, trần cao nhất 16,5 m. Hang nhỏ: vách ≈ 8,6 m ở chân (gần nhất 7,75 m), trần đá
  5,1–7,2 m. Model nào cũng quay mặt về +Z; yaw θ quay mặt sang (sin θ, 0, cos θ).

## Năm hang và các phòng đi được

Vùng đi được là hợp các hình tròn `HUB_ROOMS` (`packages/shared/src/rooms.ts`): hang lớn (0, 0)
r 20; bốn hang nhỏ r 7; mỗi đường hầm là chuỗi 15 hình tròn r 1,7 (tâm cách nhau 0,77 m) từ
u · 19,6 m tới u · 30,4 m, với u là hướng đơn vị từ gốc tới tâm hang nhỏ. Tổng 65 phòng.

| id (`HUB_CAVES`) | Tên | Tâm (x, z) | yaw vỏ | Vỏ | Vỏ hầm ở | Sạp |
|---|---|---|---|---|---|---|
| ne_back | Hang Quest | (32, −18,5) | −59,9667 | a | (22,4064; −12,9537) | BẢNG QUEST · Doran |
| nw_back | Hang ký ức | (−32, −18,5) | 59,9667 | b | (−22,4064; −12,9537) | KÝ ỨC HUY HOÀNG · người giữ ký ức |
| nw_front | Hang đố vui | (−32, 18,5) | 120,0333 | a | (−22,4064; 12,9537) | ĐỐ VUI T1 · Keria |
| ne_front | Hang chợ | (32, 18,5) | −120,0333 | b | (22,4064; 12,9537) | QUẦY TRANG PHỤC · Peyz |

Công thức đặt vỏ (cũng ghi trong `manifest.caves.json`, `tl_cave_main_floor` `meta.layout`): yaw =
atan2(−u.x, −u.z); hang nhỏ đặt ở tâm; vỏ hầm ở u · 25,8814 m. Vỏ kiểu b có hốc đá lệch 38° so với
trục hầm (`nicheYaw` = yaw + 38). `CAVE_SHELL_PIECES` liệt kê 16 mảnh vỏ (8 của hang lớn, 4 hầm, 4
hang nhỏ) kèm node trần / vòm hầm để ẩn khi nhìn từ trên xuống.

Trong mỗi hang nhỏ, đồ chính của sạp đứng ở tiêu điểm trước hốc đá (cách tâm 7,2 m; quầy trang phục
6,7 m), quay mặt vào tâm hang nên người vừa qua hầm thấy mặt trước và biển. Chỗ đứng bấm E
(`stallApproach`, trước sạp 1,8 m) cách lối hầm > 7 m: vào hẳn trong hang mới hiện nút.

## Các vùng trong hang lớn

Mỗi vùng có một khung (gốc + yaw, mặt hướng vào lửa trại) trong `HUB_ZONES`; đồ đạc đặt theo toạ độ
của khung nên xê dịch cả vùng chỉ cần sửa khung.

| Vùng | Khung (x, z, yaw) | Nội dung |
|---|---|---|
| Lửa trại | (0, 0, 0) | Vòng đá, than; 7 fan NPC quanh lửa (hạng 01 ôm trán trên thùng, bàn thấp có ấm/cốc/mì, hạng 02 xe lăn, cặp fan an ủi nhau, hạng 03 thở oxy, fan đeo kính cầm cốc, fan mũ đỏ). Phía +Z để trống về chỗ xuất hiện. |
| Sạp điểm danh | (4, 8, −153) | Quầy + mái bạt + biển "ĐIỂM DANH", Oner, đèn bão trên quầy. Sạp duy nhất còn ở hang lớn. |
| Góc thùng | (−7,724; −1,086; 82) | Thùng lớn làm bàn (ấm, cốc mì), 2 thùng nhỏ, tay cầm, cốc, 2 ghế, đuốc ba chân. Chỉ trang trí. TV DEFEAT cũ đã bỏ. |
| Màn hình lớn | (−10,588; −19,585; 28,4) | `HUB_SCREEN`: màn 12,8 × 7,2 m bắt thẳng lên mặt đá phẳng của vách sau-trái (`SCREEN_WALL`: model vách có một mặt phẳng rộng 15,6 m, cao 12,2 m, nghiêng 10,2°, giữa cửa điện thờ và miệng hầm sang Hang ký ức); mép dưới 4,2 m (cao hẳn trên đầu người chơi), viền gờ đá, không khung không chân (ngoài vùng đi và vùng camera). Hiện lịch đấu T1: trận sắp tới + đếm ngược, hoặc "ĐANG THI ĐẤU", hoặc DEFEAT khi chưa có lịch. Không bao giờ hiện tỉ số. |
| Bảng quest Hang Quest | trong hốc đá, sâu hơn sạp `quest` 2,88 m | `HUB_QUEST_BOARD`: bảng gỗ ghim giấy 2,2 × 1,3 m bắt vào vách trong cùng của hốc, mép dưới 0,95 m. Thay màn hình nhỏ (và 3 TV CRT trước đó): phòng xem trận đã bỏ. |
| Chỗ xem màn hình lớn | (−6,663; −18,36) | `SCREEN_SPOT`, điểm tương tác `screen` (≤ 3 m): E mở bảng lịch đấu/kết quả (có công tắc ẩn tỉ số). Lệch 3 m về phía cửa điện thờ để tránh tảng đá trên trục màn hình. |
| Cổng biển tên (×4) | trên trục mỗi hầm, cách gốc 21,2 m; yaw = yaw của hang | `HUB_CAVE_GATES`: hai cột cách trục 2,85 m, bảng 3,2 × 0,78 m treo cao 3,2–3,98 m. Mặt quay về lửa trại ghi tên hang nhỏ, mặt sau ghi "HANG LỚN". |
| Nước | (−14; 0,4; 90) | Vũng nước dọc vách trái, mặt nước bóng + vệt phản chiếu đuốc, 3 măng đá, đuốc bên kia mặt nước, phiến đá thấp, 2 ghế bên mép nước. |
| Cửa hang | (0, −22,45, 0) | Khung hầm, biển, cửa điện thờ; hai đuốc ba chân ở (±2,4; −20,55) với dây chăng giữa; đuốc mờ trong hầm. |
| Góc thâm niên | (6,2; −10,739; −30) | Bạt, giường sắt (hạng 04 nằm đắp chăn, cầm điện thoại), thùng đầu giường có đèn bão + cốc, chồng thùng, xe lăn trống, bình oxy trắng, đèn treo móc bạt, đuốc ba chân. |
| Góc sinh hoạt | (12,592; 0,44; −92) | Bàn + 4 ghế + ấm, cốc, mì, đèn bão; bạt thứ hai; dây phơi; thảm; đuốc ngoài mép bạt; thùng. |
| Bàn trà | (−6,263; 9,285; 146) | Bàn thấp, ấm, cốc, đèn bão, thảm, 3 ghế, fan ngồi cầm cốc, thùng có chăn. |
| Vòng thùng gỗ | (−4,997; −10,246; 26) | Pallet làm bàn có đèn bão + mì, thùng làm ghế, fan ngồi ôm đầu, thùng lớn, đuốc. |
| Thảm + ghế | (9,128; 10,878; −140) | Thảm, thùng nhỏ có cốc + mì, 3 ghế (sau sạp điểm danh). |

Thêm: 3 cụm ghế nhỏ ở vòng giữa (r ≈ 7,5 m, hướng 90°, 150°, 212°); 2 đuốc hai bên chỗ xuất hiện
(±5,5; 12,5) kèm thùng + ghế; 12 đuốc ở anchor đuốc của vỏ (2 đuốc ba chân hai bên mỗi miệng hầm, 4
đuốc cột dọc vách); 27 khối đá / măng đá sát vách (r 21,4–23); một tảng đá lớn sau-trái
(−9,2; −14) và vài cụm đá, măng đá có va chạm; ~200 đá vụn trong hang lớn + 14 viên mỗi hang nhỏ
(không va chạm). Mỗi hang nhỏ: 4 đuốc ở anchor của vỏ (2 bên miệng hang, 2 bên hốc đá); mỗi đường
hầm một đèn bão sát vách.

Lối đi luôn thông (`HUB_WALKWAYS`, có test): từ vòng quanh lửa trại (r 5,5 m) ra từng miệng hầm, ra
chỗ xuất hiện và ra cửa điện thờ, rộng ≥ 2,5 m.

Điểm tương tác (phím E), là chỗ đứng nhìn đồ vật. Sạp: cách ≤ 2,5 m; góc thâm niên và cửa điện thờ:
≤ 3 m.

| id | Tên | Vị trí | Ở đâu |
|---|---|---|---|
| checkin | ĐIỂM DANH | (3,183; 6,396) | hang lớn |
| quest | BẢNG QUEST | (36,675; −21,203) | Hang Quest |
| memory | KÝ ỨC HUY HOÀNG | (−37,348; −17,751) | Hang ký ức |
| quiz | ĐỐ VUI T1 | (−36,675; 21,203) | Hang đố vui |
| shop | QUẦY TRANG PHỤC | (36,852; 17,82) | Hang chợ |
| rest | Góc thâm niên | (5,112; −8,654) | hang lớn |
| altar | Cửa điện thờ Faker | (0; −19,9) | hang lớn, trước cửa hầm |

Điện thờ là một đảo riêng trong cùng room, tâm (120, 0), đi được r 8; `isInShrine` = x > 80. Vào ở
(120; 6,8); về hang ở (0; −17,7) (trước cửa 2,2 m).

## Va chạm

- Server quyết định vị trí ở 20 Hz; client dự đoán bằng cùng `applyInput()` / `constrain()`
  (`packages/shared/src/index.ts`). Vùng đi được: hợp các phòng `HUB_LAYOUT.rooms` trừ các vật cản
  tròn. `HUB_LAYOUT.obstacles` (161 vòng, `obstacles[0]` = vòng đá lửa trại r 1,6) suy ra từ collider
  trong bảng đặt, làm tròn 1 mm; `HUB_LAYOUT_HASH` là dấu vân tay của bố cục (gồm cả các phòng).
- `constrain()`: đẩy ra khỏi vật cản, kẹp về điểm gần nhất của hợp các phòng (`clampToRooms`), chưa
  hợp lệ thì lấy điểm trống gần nhất (xét biên từng phòng ở gần và giao điểm của nó với vật cản).
  Chỉ dùng + − × ÷ và sqrt. Bố cục không có `rooms` (đảo điện thờ, test) vẫn là một đĩa quanh gốc
  và cho kết quả trùng từng bit với trước đây.
- Luật (có test trong `scripts/movement.test.ts`): hai vật cản hoặc chồng sâu (khoảng cách tâm² ≤
  r1² + r2²) hoặc cách nhau ≥ `MIN_GAP` = 0,4 m, trừ khi khe nằm trọn trong vật cản thứ ba; mỗi vật cản
  hoặc nằm trọn trong một phòng và cách biên phòng đó ≥ 0,4 m, hoặc là "khối chặn sát vách" (tâm ngoài
  biên phòng, khoảng cách² ≥ R² + r²). Vách ký ức, bảng đố, kệ thùng trước màn hình, quầy trang phục và chủ sạp của
  chúng là khối chặn ở hốc đá của hang nhỏ; đuốc hai bên miệng hang nhỏ cũng vậy. Trong hầm không có
  vật cản.
- Collider đã gồm khoảng thân người; đá vụn, thảm, vũng nước, đồ trên bàn không có collider. Người chơi
  dừng ở r = 20 trước cửa điện thờ, ngay trước dây chăng.

## Ánh sáng và chất lượng

- Camera: ACES + sRGB, sương mù tuyến tính #2A1A12 từ 20 đến 88 m (preset `overview` tắt sương).
  Ambient (0,27; 0,27; 0,30), đèn định hướng mát yếu, đèn hắt ấm phía trên sảnh (tầm 34 m), 7 đèn ấm
  cao trước vách hang lớn, một đèn rọi biển cửa hầm. Mỗi hang nhỏ: một đèn hắt ấm dưới trần giữa hang
  và một đèn rọi trước hốc đá (lên sạp).
- Lửa trại: một đèn đổ bóng (tầm 6,5 m, nâng 1,4 m lên trên các fan đang ngồi nên bóng ngắn) và một đèn
  rộng không bóng (tầm 12 m). Đây là đèn đổ bóng duy nhất. Đuốc (38), đèn bão (13), TV (2 trong 4),
  nến (1) có đèn omni riêng, không bóng. Tổng ~76 đèn; đo ở mục "Kiểm chứng" của `docs/playtest.md`.
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
| overview | (0; 76; 14) | (0; 0; 0,6) | 46° | Cả năm hang + bốn hầm từ trên, ẩn trần / vòm hầm, tắt sương |
| exit | (0,9; 2,0; −12,6) | (0; 2,3; −22,7) | 50° | Cửa hầm + biển + cửa điện thờ |
| checkin, crateCorner, water, rest, living, tea, crates, rug | theo khung vùng | | 50–55° | Các vùng của hang lớn |
| screen | trước màn hình lớn 13 m | tâm màn hình | 54° | Màn hình lớn trên vách sau-trái (`?screen=idle\|upcoming\|running` để xem ảnh mẫu) |
| tv, memory, quiz, shop | trước sạp ~5 m | sạp | 50–52° | Bốn sạp trong hang nhỏ (chỗ khách đứng) |
| mouth_<id> | trên lối đi, r 9 | miệng hầm | 50° | Miệng hầm nhìn từ hang lớn |
| tunnel_<id>, tunnel_<id>_back | trong hầm | hang nhỏ / hang lớn | 62° | Trong đường hầm, hai chiều |
| cave_<id> | miệng hang nhỏ | hốc đá | 68° | Hang nhỏ nhìn từ miệng hang |

`<id>` = ne_back, nw_back, nw_front, ne_front. Preset theo vùng tính từ khung của vùng, nên đi theo
khi bố cục xê dịch.

## Camera chơi game và điều khiển

- Camera bám sau lưng (`apps/web/src/camera.ts`): mặc định yaw 180 (nhìn về cửa hầm), pitch 18°, cách
  5,5 m (zoom 2,5–8 m, pitch −5..60°), tâm nhìn cao 1,3 m và lệch 0,45 m sang phải (qua vai, tối đa
  0,15 × cần), FOV dọc 50° nhưng luôn giữ ngang ≥ 60° (màn dọc tới 75°, `cameraMath.fitFov`).
- Trong hang, camera ở trong hợp các phòng đi được nới thêm 0,6 m (`CAVE_BOUNDS.rooms`,
  `boomInRooms`), cao từ 0,6 m tới trần riêng của phòng: 9 m hang lớn, 2,6 m trong hầm, 3,2 m hang
  nhỏ. Cần được dò dọc tia từ tâm nhìn qua từng phòng nối nhau, nên camera lùi được từ hầm ra hang
  nhưng không bao giờ nhảy qua khối đá giữa hầm và hang; chạm vách thì rút cần ngay. Trên đảo điện
  thờ vẫn là hình trụ (tâm (120, 0), r 14) qua `setBoundsCenter()`; về hang thì `useRooms()`.
- Đồ cao từ 1,5 m (đuốc, bảng, đá, cột bạt, kể cả đồ trong hang nhỏ) và thân NPC là vật chắn: cần rút
  vào trong ~0,1 s và không duỗi xuyên qua. Cần ngắn thì tâm nhìn nâng tới 0,45 m, nhưng không vượt
  trần phòng và không chui vào biển / mái bạt treo phía trên.
- Bảng tên không hiện xuyên vách: người ở hang khác hoặc trong hầm chỉ có bảng tên khi đường thẳng từ
  camera tới họ nằm trong các phòng (`cameraMath.clearLine`).
- Đứng yên 0,4 s gần điểm tương tác thì camera "nhìn kỹ": lệch vai 0,75 m, pitch +6°, chuyển trong
  0,35 s; đi tiếp thì trả lại. Avatar của mình mờ dần khi cần ngắn hơn 1,8 m.
- WASD / mũi tên đi theo hướng camera; kéo chuột (trái hoặc phải) hoặc một ngón để xoay; lăn chuột /
  véo để zoom; E xem điểm tương tác, Esc đóng; 1/2/3 = chào / cười trừ / cổ vũ; Enter để chat. Trên
  điện thoại có nút W/A/S/D.

## Dữ liệu nằm ở đâu

- `packages/shared/src/layout.ts`: `HUB_PLACEMENTS` (mọi model, yaw, scale, collider, NPC + tư thế, đồ
  cầm, đèn, node ẩn), `HUB_CAVES`, `HUB_ROOMS`, `CAVE_SHELL_PIECES`, `HUB_LANDMARKS`, `HUB_ZONES`,
  `HUB_WALKWAYS`, `MIN_GAP`. Sửa ở đây là đổi cả hình lẫn va chạm (server tự khởi động lại khi
  `packages/shared` đổi). `packages/shared/src/rooms.ts`: phép toán trên hợp các phòng (trong / kẹp /
  chuỗi hầm / cần camera). `stalls.ts`: vị trí 5 sạp + cửa điện thờ. `shrine.ts`: đảo điện thờ.
- `apps/web/src/scene.ts`: `createWorld()` — camera, ánh sáng, tải GLB (đặt từng model ngay khi tải
  xong), NPC, mặt nước, batch tĩnh. `apps/web/src/world/`: manifest, NPC, preset camera, vệt sáng nước.

## Pipeline model

- Mã sinh model: `tools/models/lib.ts` + `tools/models/groups/<nhóm>.ts` (caves, environment, fire,
  furniture, props, characters, login). Dựng: `npx tsx tools/models/build.ts <nhóm|all>`. Kết quả tất
  định. Vỏ hang cũ (`environment/tl_env_cave_*`) vẫn phải có: hang điện thờ dùng lại nó.
- Đầu ra: `apps/web/public/models/<nhóm>/<tên>.glb` và `manifest.<nhóm>.json` (tam giác, bounds,
  anchor, đèn, pose, collider, ghi chú đặt). Luôn tải GLB qua `apps/web/src/models.ts`.
- Kiểm tra kiểu cho mã sinh model: `npx tsc --noEmit -p tools/models`.

## Trang dev (chỉ dev, không vào bản build)

- `/gallery.html`: xem từng GLB (`?model=nhóm/tên`, `yaw`, `pitch`, `zoom`, `pose`, `ref=1`…; xem đầu
  `apps/web/src/gallery.ts`).
- `/preview.html`: dựng cả hang. Tham số: `view=<preset>`, `cam=x,y,z&look=x,y,z&fov=`, `npcs=0`,
  `post=0`, `quality=high|low|auto`, `time=<s>` (đóng băng nhấp nháy để chụp), `stats=1`, `fans=<n>`,
  `debug=1` (vẽ vòng va chạm, các phòng đi được, giới hạn camera, đĩa xuất hiện, vòng 3 m của điểm
  tương tác), `bench=<n>`, `patch={"<i>":{…}}` và `add=[…]` (thử vị trí/tư thế mà không phải sửa
  `layout.ts`), `sweep=1` (quét camera bám theo thật ở mọi chỗ đứng × yaw × pitch × zoom với nền
  magenta, đếm điểm ảnh lộ khoảng trống; `window.__info.sweep`).
- `/caves-lab.html`: chỉ vỏ năm hang (`view=…`, `holes=1` quét lỗ hổng của vỏ).
- Chụp headless: `node tools/models/render.mjs --url "<url>" --out .renders/<thư mục>/<tên>.png`.
- Trang game có tham số dev `?view=`, `?autojoin=<tên>`, `?stats=1`, `?batch=0` (xem `docs/playtest.md`).

## Bot và kiểm tra

- Bot: `BOTS=4 DURATION_SECONDS=300 npm run bots` (mặc định 8 bot, `GAME_URL` mặc định
  ws://127.0.0.1:2800; Ctrl+C để rời). Bot đi khắp năm hang theo đồ thị điểm mốc hang lớn ↔ hầm ↔
  hang nhỏ; khi dừng in số lượt ghé từng hang và số lần kẹt.
- `npm run check` (tsc), `npm test` (node:test trên `scripts/*.test.ts`), `npm run build`.
