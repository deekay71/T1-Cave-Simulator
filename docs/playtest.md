# Bản chơi thử Hang trú thua v0.3

## Chạy local
Node 26, `npm ci`. Ba terminal từ gốc repo: `npm run dev:api` (cổng 3000), `npm run dev:game` (cổng 2567), `npm run dev:web` (http://localhost:5173). Mở hai tab, đặt hai tên. Dev keys tự tạo trong `.dev-keys/` (gitignored). Không đặt DATABASE_URL/REDIS_URL nếu chỉ thử RAM. Dữ liệu guest và tiến trình không bền vững. Cổng khác: `GAME_PORT` / `API_PORT` cho server, `VITE_API_URL` / `VITE_GAME_URL` cho web.

## Trong hang
Gốc toạ độ ở tâm lửa trại, mét, nhìn từ chỗ xuất hiện (0, 10) về phía cửa hang (-Z). Trái màn hình là -X: TV trú thua, vũng nước, bảng đố vui, Vách ký ức (sau-trái). Phải là +X: góc thâm niên dưới tấm bạt, góc sinh hoạt (trước-phải). Cửa hang có biển treo ở sau cùng. Đi được trong bán kính 16 m. Bảng đặt model và collider dùng chung client/server: `packages/shared/src/layout.ts` (chi tiết ở [camera và bố cục](cameras-and-layout.md)).

Điểm bấm E (cách < 3 m, `HUB_LANDMARKS`): Vách ký ức (-5,23; -10,52), TV trú thua (-5,37; -1,87), Góc thâm niên (7,05; -4,19).

## Điều khiển
- **Bàn phím:** WASD hoặc mũi tên đi theo hướng camera (theo vị trí phím, bàn phím AZERTY/tiếng Việt vẫn đúng). E xem điểm tương tác ở gần (hoặc bấm nút "E · Xem …"), Escape đóng bảng. 1/2/3: Chào / Cười trừ / Cổ vũ.
- **Chat:** Enter mở ô chat, Enter gửi rồi quay lại đi lại, Escape thoát ô chat (chữ đang gõ được giữ). Khách gửi tối đa 3 tin mỗi 10 giây; quá giới hạn thì chữ vẫn nằm trong ô kèm lời nhắc "Nói chậm lại chút…".
- **Chuột:** kéo chuột trái hoặc phải để xoay camera, cuộn (hoặc chụm trên trackpad) để zoom 2,5–8 m.
- **Cảm ứng:** nút W A S D, vuốt một ngón để xoay, chụm hai ngón để zoom, chạm nút sáng để xem; cảm xúc bằng nút. Bàn phím ảo chỉ hiện trên máy cảm ứng.
- **Rời hang:** nút cạnh số cư dân, bấm hai lần trong 3 giây.

## Camera
- Góc ba sau vai: tâm xoay cao 1,3 m trên chân, lệch 0,45 m sang phải camera (nhân vật đứng hơi trái tâm màn hình, không che thứ mình đi tới), nhìn xuống 18°, cần 5,5 m. FOV dọc 50°; màn dọc được nới (tối đa 75°) để luôn thấy ít nhất 60° chiều ngang.
- Đứng yên 0,4 s gần điểm bấm E: camera lùi sang vai 0,75 m và nhìn xuống thêm 6° (0,35 s), đi tiếp thì trở lại.
- Camera không ra khỏi hang (trụ 16,8 m, cao 0,6–9 m: rút cần ngay) và không nằm trong đồ cao (đuốc, bảng, đá, cột bạt) hay thân NPC: rút cần nhanh trong ~0,1 s, không lùi xuyên qua đồ vật. Đuốc sát camera thì ngọn lửa thụt xuống.
- Lưng sát vách (cần < 1,8 m): avatar của mình mờ dần (dither) và ẩn hẳn dưới 1 m; cần < 2,2 m thì tâm xoay nâng dần tới 0,45 m để nhìn qua đầu.
- Bảng tên: của mình hiện 4 giây sau khi vào rồi mờ đi; của người khác mờ dần theo khoảng cách (ẩn quá 18 m), luôn nằm trong màn hình, chồng nhau thì người xa được đẩy lên trên.

## Có thể thử
- Vào room tối đa 30 người; thấy người khác đi lại (dự đoán ở client bằng cùng `applyInput()` với server, 20 Hz).
- Bảy bộ đồ fan (chọn theo session), animation đi bộ, đứng thở, ba cảm xúc. Dòng chat cảm xúc tối đa một dòng mỗi 8 giây mỗi người.
- Chat thu gọn: 4 dòng mới nhất, tự mờ sau 12 giây; gõ hoặc rê chuột vào để xem lại 40 dòng.
- Chín NPC theo concept 03: bốn hạng thâm niên quanh lửa và trên giường, fan ở Vách ký ức và góc sinh hoạt.
- Mất mạng: tự nối lại vào đúng chỗ (kể cả khi vừa vào hang được 1 giây), server giữ ghế 15 giây.
- Thiếu file nhân vật: dùng tạm bộ đồ khác và tải lại sau; không tải được bộ nào thì vẫn đi lại và chat, bảng tên vẫn hiện.

## Bot
`npm run bots` thả fan bot (tên "Tèo (bot)"…) đi quanh lửa trại, ba điểm bấm E (đứng trên vành 0,9–1,6 m quanh điểm, không chiếm đúng chỗ), bảng đố vui, góc sinh hoạt, vũng nước, cửa hang; không đứng đè lên người khác; thỉnh thoảng cảm xúc, 2–5 phút mới chat một câu. Bot tự ký vé bằng dev key (`.dev-keys/` hoặc `TICKET_PRIVATE_JWK`), không gọi API. Biến môi trường: `BOTS` (1–60, mặc định 8), `GAME_URL` (mặc định `ws://127.0.0.1:2800`; với `npm run dev:game` mặc định dùng `ws://localhost:2567`), `DURATION_SECONDS` (0 = chạy tới Ctrl+C), `ALLOW_REMOTE=1` mới cho chạy vào máy không phải local. Ví dụ: `BOTS=4 DURATION_SECONDS=300 GAME_URL=ws://localhost:2567 npm run bots`.

## Trang dev
`/gallery.html` (từng model GLB), `/preview.html?view=concept` (cả hang theo preset), `/avatar-lab.html` (avatar + camera), và game với `?view=<preset>`, `?autojoin=<tên>`, `?stats=1`, `?batch=0`. Chỉ có ở `npm run dev:web`; bản build chỉ có trang game. Sinh lại model: `npx tsx tools/models/build.ts <nhóm|all>`. Ảnh headless: `node tools/models/render.mjs --url "<url>" --out .renders/<tên>.png`.

## Chưa có
Minigame/quiz thực thi, ngồi ghế có reservation, cosmetics xe lăn/giường có thể chọn, điểm thâm niên, OAuth/Better Auth, moderation/report UI, logo asset được cấp quyền. Camera chỉ tránh đồ cao và thân NPC: đồ thấp, tấm bạt hoặc vật nằm giữa camera và nhân vật vẫn có thể che. Bảng tên không bị vật che khuất. Bộ đồ đổi theo session nên vào lại sẽ khác. Góc thâm niên nói rõ đây là thiết kế chưa mở khóa. Vách ký ức là nội dung đọc thử với link nguồn, không CMS.

## Kiểm chứng
`npm run check`, `npm test` và `npm run build` xanh (unit test gồm di chuyển/va chạm dùng chung, camera, giới hạn chat client so với server, auth, rate limit, avatar). Chrome headless (CDP, WebGL2 thật) đã thử: Enter/Escape trong ô chat, giới hạn chat, nhả chuột trên UI rồi rê chuột, camera đi ngang đuốc, lưng sát vách, mất mạng 1,5 s sau khi vào, file nhân vật 404, màn dọc 390×844 cảm ứng, bảng tên với 4 bot. Docker/multi-worker/WAN/mobile thật chưa kiểm chứng.

## Phạm vi phát hành
Bản local để review gameplay và bố cục, chưa deploy public. Trước public cần xử lý P1 trong review-2026-11-09.md. Mục tiêu tiếp: hoạt động nhặt tinh thể trong cùng hub, test room lifecycle và persistence/abuse prevention.
