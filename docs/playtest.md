# Bản chơi thử Hang trú thua v0.3

## Chạy local
Node 26, `npm ci`. Ba terminal từ gốc repo: `npm run dev:api` (cổng 3000), `npm run dev:game` (cổng 2567), `npm run dev:web` (http://localhost:5173). Mở hai tab, đặt hai tên. Dev keys tự tạo trong `.dev-keys/` (gitignored). Không đặt DATABASE_URL/REDIS_URL nếu chỉ thử RAM. Dữ liệu guest và tiến trình không bền vững. Cổng khác: `GAME_PORT` / `API_PORT` cho server, `VITE_API_URL` / `VITE_GAME_URL` cho web.

## Trong hang
Từ 2026-11-11 có **năm hang**: một hang lớn sinh hoạt chung và bốn hang nhỏ nối bằng đường hầm đi bộ. Gốc toạ độ ở tâm lửa trại, mét, nhìn từ chỗ xuất hiện (0, 10) về phía cửa hang (-Z).

- **Hang lớn** (đi được r 20 m): lửa trại + vòng ghế + các fan thâm niên; sạp ĐIỂM DANH (Oner) ngay trước-phải chỗ xuất hiện; góc thùng và vũng nước bên trái; màn hình lớn bắt vào vách sau-trái (lịch đấu T1, không hiện tỉ số); cổng gỗ treo biển tên trước 4 cửa hầm; góc sinh hoạt bên phải; góc thâm niên dưới bạt ở sau-phải; bàn trà (trước-trái), vòng thùng gỗ (sau-trái), thảm + ghế (trước-phải) và ba cụm ghế nhỏ quanh lửa; cửa điện thờ trong hầm cửa hang phía sau (-Z).
- **Bốn hang nhỏ** (đi được r 7 m), vào qua miệng hầm có hai đuốc ba chân: sau-phải **Hang Quest** (bảng quest ghim giấy trong hốc đá, Doran), sau-trái **Hang ký ức** (vách ký ức, người giữ ký ức), trước-trái **Hang đố vui** (bảng phấn, Keria), trước-phải **Hang chợ** (quầy trang phục, Peyz). Sạp đứng ở hốc đá cuối hang, quay mặt về miệng hang.

Bảng đặt model, các phòng đi được và collider dùng chung client/server: `packages/shared/src/layout.ts` (chi tiết và bảng toạ độ ở [camera và bố cục](cameras-and-layout.md)).

Điểm bấm E (`HUB_LANDMARKS`; sạp ≤ 2,5 m, còn lại ≤ 3 m): ĐIỂM DANH (3,18; 6,40), BẢNG QUEST (36,68; -21,20), KÝ ỨC HUY HOÀNG (-37,35; -17,75), ĐỐ VUI T1 (-36,68; 21,20), QUẦY TRANG PHỤC (36,85; 17,82), Góc thâm niên (5,11; -8,65), Cửa điện thờ (0; -19,9), Lịch đấu T1 trước màn hình lớn (-6,66; -18,36). Nút "Các sạp trong hang" hiện khoảng cách đường chim bay tới từng sạp.

### Nên thử
1. Từ chỗ xuất hiện đi vòng lửa trại, theo lối giữa hai đuốc ba chân vào một đường hầm, sang hang nhỏ; tới trước sạp mới thấy nút E (đứng ở cửa hầm thì chưa). Bấm E, Escape, quay ra.
2. Trong hầm và ở miệng hầm: xoay camera đủ vòng, zoom xa/gần, ngước lên/chúc xuống. Không được thấy khoảng đen ngoài vách hay nhìn xuyên đá; trần hầm thấp (camera ≤ 2,6 m) nên cần tự rút ngắn.
3. Men theo vách hang lớn về phía miệng hầm rồi đi tiếp vào hầm: phải trượt vào êm, không khựng, không bị kéo giật lại (dự đoán client trùng server).
4. Đứng trong hang lớn nhìn về hang nhỏ: bảng tên người đứng sau vách đá không hiện; nhìn thẳng dọc hầm thì hiện.
5. Ra cửa hang phía sau (dây chăng giữa hai đuốc), bấm E → Vào điện thờ → ngồi → cầu nguyện → Đứng dậy → Về hang: trở lại trước cửa (0; -17,7).
6. Thả bot (`npm run bots`) rồi xem chúng tự đi qua hầm sang cả bốn hang nhỏ.

## Điều khiển
- **Bàn phím:** WASD hoặc mũi tên đi theo hướng camera (theo vị trí phím, bàn phím AZERTY/tiếng Việt vẫn đúng). E xem điểm tương tác ở gần (hoặc bấm nút "E · Xem …"), Escape đóng bảng. 1/2/3: Chào / Cười trừ / Cổ vũ.
- **Chat:** Enter mở ô chat, Enter gửi rồi quay lại đi lại, Escape thoát ô chat (chữ đang gõ được giữ). Khách gửi tối đa 3 tin mỗi 10 giây; quá giới hạn thì chữ vẫn nằm trong ô kèm lời nhắc "Nói chậm lại chút…".
- **Chuột:** kéo chuột trái hoặc phải để xoay camera, cuộn (hoặc chụm trên trackpad) để zoom 2,5–8 m.
- **Cảm ứng:** nút W A S D, vuốt một ngón để xoay, chụm hai ngón để zoom, chạm nút sáng để xem; cảm xúc bằng nút. Bàn phím ảo chỉ hiện trên máy cảm ứng.
- **Rời hang:** nút cạnh số cư dân, bấm hai lần trong 3 giây.

## Camera
- Góc ba sau vai: tâm xoay cao 1,3 m trên chân, lệch 0,45 m sang phải camera (nhân vật đứng hơi trái tâm màn hình, không che thứ mình đi tới), nhìn xuống 18°, cần 5,5 m. FOV dọc 50°; màn dọc được nới (tối đa 75°) để luôn thấy ít nhất 60° chiều ngang.
- Đứng yên 0,4 s gần điểm bấm E: camera lùi sang vai 0,75 m và nhìn xuống thêm 6° (0,35 s), đi tiếp thì trở lại.
- Camera không ra khỏi hang: nó ở trong các phòng đi được nới 0,6 m (hang lớn, hầm, hang nhỏ), cao 0,6 m tới trần từng phòng (9 m hang lớn, 2,6 m hầm, 3,2 m hang nhỏ), rút cần ngay khi chạm vách và không nhảy qua khối đá giữa hầm và hang. Nó cũng không nằm trong đồ cao (đuốc, bảng, đá, cột bạt) hay thân NPC: rút cần nhanh trong ~0,1 s, không lùi xuyên qua đồ vật. Đuốc sát camera thì ngọn lửa thụt xuống.
- Lưng sát vách (cần < 1,8 m): avatar của mình mờ dần (dither) và ẩn hẳn dưới 1 m; cần < 2,2 m thì tâm xoay nâng dần tới 0,45 m để nhìn qua đầu.
- Bảng tên: của mình hiện 4 giây sau khi vào rồi mờ đi; của người khác mờ dần theo khoảng cách (ẩn quá 18 m), luôn nằm trong màn hình, chồng nhau thì người xa được đẩy lên trên. Người đứng sau vách đá (hang khác, khuất trong hầm) không có bảng tên.

## Có thể thử
- Vào room tối đa 60 người (`ROOM_CAPACITY`), người thứ 61 sang hang mới; thấy người khác đi lại (dự đoán ở client bằng cùng `applyInput()` với server, 20 Hz).
- Bảy bộ đồ fan (chọn theo session), animation đi bộ, đứng thở, ba cảm xúc. Dòng chat cảm xúc tối đa một dòng mỗi 8 giây mỗi người.
- Chat thu gọn: 4 dòng mới nhất, tự mờ sau 12 giây; gõ hoặc rê chuột vào để xem lại 40 dòng.
- 21 NPC: bốn hạng thâm niên quanh lửa và trên giường (concept 03), fan ở góc sinh hoạt, bàn trà, vòng thùng gỗ; năm chủ sạp (Oner ở hang lớn, bốn người còn lại ở hang nhỏ) và vài fan đứng xem trong các hang nhỏ.
- Mất mạng: tự nối lại vào đúng chỗ (kể cả khi vừa vào hang được 1 giây), server giữ ghế 15 giây.
- Thiếu file nhân vật: dùng tạm bộ đồ khác và tải lại sau; không tải được bộ nào thì vẫn đi lại và chat, bảng tên vẫn hiện.

## Bot
`npm run bots` thả fan bot (tên "Tèo (bot)"…) đi khắp năm hang: quanh lửa trại, các góc của hang lớn, và qua đường hầm sang từng hang nhỏ (đứng trên vành 0,8–1,7 m quanh chỗ bấm E của sạp, không chiếm đúng chỗ). Đường đi tính trên đồ thị điểm mốc hang lớn ↔ hầm ↔ hang nhỏ, nên bot không đi thẳng vào vách; không đứng đè lên người khác; thỉnh thoảng cảm xúc, 2–5 phút mới chat một câu. Khi dừng, bot in `visits` (số lượt tới đích trong từng hang), `seconds` (thời gian có mặt) và `stuck` (số lần 1,8 s không tiến được). Bot tự ký vé bằng dev key (`.dev-keys/` hoặc `TICKET_PRIVATE_JWK`), không gọi API. Biến môi trường: `BOTS` (1–120, mặc định 8), `GAME_URL` (mặc định `ws://127.0.0.1:2800`; với `npm run dev:game` mặc định dùng `ws://localhost:2567`), `DURATION_SECONDS` (0 = chạy tới Ctrl+C), `ALLOW_REMOTE=1` mới cho chạy vào máy không phải local. Ví dụ: `BOTS=20 DURATION_SECONDS=180 GAME_URL=ws://localhost:2567 npm run bots`.

## Trang dev
`/gallery.html` (từng model GLB), `/preview.html?view=concept` (cả năm hang theo preset: `overview`, `cave_<id>`, `tunnel_<id>`, `mouth_<id>`, `quest`, `screen`, `memory`, `quiz`, `shop`…; `debug=1` vẽ các phòng đi được; `sweep=1` quét camera), `/caves-lab.html` (riêng vỏ hang), `/avatar-lab.html` (avatar + camera), và game với `?view=<preset>`, `?autojoin=<tên>`, `?stats=1`, `?batch=0`. Chỉ có ở `npm run dev:web`; bản build chỉ có trang game. Sinh lại model: `npx tsx tools/models/build.ts <nhóm|all>`. Ảnh headless: `node tools/models/render.mjs --url "<url>" --out .renders/<tên>.png`.

## Chưa có
Minigame/quiz thực thi, ngồi ghế có reservation, cosmetics xe lăn/giường có thể chọn, điểm thâm niên, OAuth/Better Auth, moderation/report UI, logo asset được cấp quyền. Camera chỉ tránh đồ cao và thân NPC: đồ thấp, tấm bạt hoặc vật nằm giữa camera và nhân vật vẫn có thể che. Bảng tên không bị vật che khuất. Bộ đồ đổi theo session nên vào lại sẽ khác. Góc thâm niên nói rõ đây là thiết kế chưa mở khóa. Vách ký ức là nội dung đọc thử với link nguồn, không CMS.

## Kiểm chứng
`npm run check`, `npm test` và `npm run build` xanh (unit test gồm di chuyển/va chạm dùng chung, camera, giới hạn chat client so với server, auth, rate limit, avatar). Chrome headless (CDP, WebGL2 thật) đã thử: Enter/Escape trong ô chat, giới hạn chat, nhả chuột trên UI rồi rê chuột, camera đi ngang đuốc, lưng sát vách, mất mạng 1,5 s sau khi vào, file nhân vật 404, màn dọc 390×844 cảm ứng, bảng tên với 4 bot. Docker/multi-worker/WAN/mobile thật chưa kiểm chứng.

### Năm hang (2026-11-11, máy dev, Chrome headless WebGL2, 1280×720)
- `npm run check`, `npm test` (217 test), `npm run build` xanh; `npx tsx tools/models/build.ts all` cho ra đúng từng byte các GLB/manifest đang có (không thêm model).
- `npm run spike`: 61 bot, 2 room (60 + 1), 0 lỗi, mọi bot ở trong vùng đi được và ngoài vật cản. `BOTS=20 DURATION_SECONDS=185 npm run bots`: 0 lần kẹt; lượt tới đích: hang lớn 129, Hang Quest 27, Hang ký ức 32, Hang đố vui 24, Hang chợ 33.
- Client thật (`.renders/visual-polish/world/qa-world.mjs`): chỗ xuất hiện → từng hang nhỏ qua hầm → chỗ đứng của sạp (nút E chỉ hiện khi tới nơi) → E mở đúng bảng → về lửa trại → cửa điện thờ → E → vào → ngồi → cầu nguyện → đứng dậy → về hang ở (0; −17,7). `window.__errors` rỗng; đứng yên thì vị trí dự đoán trùng vị trí server, không có bước lùi nào ở miệng hầm. Màn đăng nhập → Vào hang → Rời hang → màn đăng nhập cũng chạy đúng (sương và far plane của hang được trả lại).
- Quét camera (`/preview.html?sweep=1`): 713 chỗ đứng × 12 yaw × 3 pitch × 2 zoom = 51 336 khung qua camera bám theo thật, nền magenta: 0 điểm ảnh lộ khoảng trống, 0 lần camera ra ngoài phòng / trên trần / trong vật chắn.
- Hiệu năng với 20 bot + 1 client: 60 fps (giới hạn vsync) ở chỗ xuất hiện (147 draw call, ~510 nghìn tam giác kể cả lượt vẽ bóng) và trong Hang Quest (30 draw call, ~79 nghìn tam giác); 76 đèn đang bật, chỉ lửa trại đổ bóng. Ở 2560×1440 cảnh chỗ xuất hiện với 20 fan vẫn 60 fps (CPU ~3 ms/khung). Chưa đo trên điện thoại thật.

## Phạm vi phát hành
Bản local để review gameplay và bố cục, chưa deploy public. Trước public cần xử lý P1 trong review-2026-11-09.md. Mục tiêu tiếp: hoạt động nhặt tinh thể trong cùng hub, test room lifecycle và persistence/abuse prevention.

## Close test có mã mời
- API đặt `INVITE_CODE` thì `/v1/guest` chỉ cấp vé khi có đúng mã (bỏ khoảng trắng, không phân biệt hoa thường); thiếu hay sai mã thì form hiện ô "Mã mời".
- Link mời: `https://<host>/?invite=<mã>`. Mã được nhớ trong trình duyệt; mã sai thì bị xóa để nhập lại.
- `GUEST_RATE_LIMIT` (mặc định 20 request/phút/IP) nên đặt 120 cho close test vì nhiều người có thể chung một mạng.
- Deploy máy public: `docs/deploy-free.md` và `compose.public.yaml`.

## Cập nhật 2026-11-12 (chiều)

- **Hang tối.** Trong game (`World.setMood("cave")`) đèn nền của hang giảm còn 18–40 %, sương đổi sang đen và khép lại (tầm nhìn hết ở ~27 m tính từ camera); người chơi mang một đèn lồng lập lòe (tầm 10,5 m). Lửa trại, đuốc, đèn bão, màn hình lớn và mũi tên chỉ điểm vẫn sáng nên thành mốc định hướng. Màn hình đăng nhập và các trang xem trước giữ kiểu sáng cũ (`mood` mặc định `day`); điện thờ dùng `shrine`.
- **Chỉ đường = tự đi.** Bấm một điểm trong "Các sạp trong hang", box "Gần đây" hoặc nút "Chỉ đường": nhân vật tự đi theo đường tìm trên đồ thị điểm mốc (`packages/shared/src/nav.ts`, dùng chung với bot), camera xoay theo hướng đi. Bấm phím di chuyển, mở bảng hoặc ✕ là dừng. Mỗi điểm tương tác có vòng sáng trên nền và mũi tên nhấp nhô (`apps/web/src/world/markers.ts`); điểm đang được chỉ đường to và sáng hơn.
- **Box "Gần đây"** dưới thẻ cư dân: đích hiện tại, ba điểm gần nhất kèm khoảng cách, tiến độ quest T1.
- **Ngồi và nhảy.** F ngồi xuống ghế đẩu / thùng / đá thấp gần nhất (68 chỗ, `packages/shared/src/seats.ts`; server giữ chỗ, một ghế một người), F hoặc phím di chuyển để đứng dậy về chỗ cũ. Phím 4 hoặc Space: nhảy (emote `jump`, mọi người đều thấy). Fan NPC trong 3,4 m nhún đáp lại mỗi emote.
- **Hang Quest** giờ là 7 quest về T1, mỗi quest ba câu, đúng cả ba là xong (`apps/web/src/stalls/quests.ts`); tiến độ lưu ở trình duyệt, chưa cộng xu/XP.
- **Hang ký ức** hiện đủ sáu chức vô địch thế giới (2013, 2015, 2016, 2023, 2024, 2025) với ảnh thật từ Wikimedia Commons, ghi công từng ảnh (`apps/web/public/memories/CREDITS.md`). Năm 2016 và 2025 chưa có ảnh nâng cúp mang giấy phép tự do nên dùng ảnh sự kiện của đúng giải.

## Cập nhật 2026-11-12 (tối)

- **Hang tối thật sự.** Màn đăng nhập từng trả ánh sáng "ban ngày" lại đúng lúc vào hang, đè lên chế độ tối; giờ `World.setMood` giữ sương và ánh sáng nền mỗi khung hình. Sương khép lại còn ~4–10 m quanh người chơi, lửa và đuốc còn 30 % và lập lòe mạnh hơn.
- **Điện thờ:** ngồi xuống là cùng cả điện thờ cúi lạy một lần rồi giơ tay cầu nguyện, lặp lại liên tục, theo đồng hồ server (`shrineLoopAt`); bỏ hai nút cử chỉ thủ công.
- **Màn hình lớn chia 3/4 + 1/4:** bên trái chiếu playlist clip do admin đặt (không tiếng, mọi người xem cùng lúc khi đủ thời lượng), bên phải lịch đấu T1. Không có clip thì hiện màn hình chờ.
- **Trang quản trị `/admin.html`:** xem `docs/admin.md`.
