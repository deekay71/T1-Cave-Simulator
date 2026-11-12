# Bàn giao cho Opus: tối ưu visual Tê Liệt / T1 Cave Simulator

Ngày chốt: 2026-11-10. Repository: https://github.com/deekay71/T1-Cave-Simulator. Nhánh bàn giao: `feat/t1-match-feed`, bắt đầu từ `develop` tại `9f2a1c81f2a029e254457c2276d4c8d786052c94`.

## 1. Yêu cầu và thứ tự ưu tiên

Người dùng muốn đẩy toàn bộ code kèm context để Opus tối ưu lại visual, đồng thời chuẩn bị phương án close test với bạn bè. Lần bàn giao này gom các thay đổi đã có, không thay gameplay, không merge và không deploy.

Mục tiêu tiếp theo là làm hang, nhân vật, sạp, điện thờ và UI đẹp, rõ, nhất quán hơn mà giữ nguyên hành vi đã kiểm thử. Các ưu tiên visual bên dưới là đề xuất kỹ thuật, không phải yêu cầu đổi sản phẩm.

Đọc theo thứ tự:
1. Tài liệu này: trạng thái và giới hạn hiện tại.
2. `docs/art-direction.md`, `design/README.md`, `design/concepts/v3/`: hướng mỹ thuật và concept đã có.
3. `docs/cave-stalls-update.md`: vòng chơi mới nhất; `docs/shrine-update.md`: điện thờ; `docs/match-zone.md`: giao diện trận đấu.
4. `docs/t1-match-feed.md`, `docs/moderation-operations.md`: dữ liệu thật và vận hành.
5. `docs/tech-decisions.md`, `docs/architecture.md`, `docs/networking.md`: nền tảng. Một số đoạn là kế hoạch/lịch sử; luôn đối chiếu source hiện tại.

## 2. Hiện trạng thật

- Stack: TypeScript, PlayCanvas 2.23.3, React 19, Vite 8, Colyseus 0.18, Fastify, PostgreSQL và Redis tùy tính năng. Node >=26, npm workspaces; dùng `package-lock.json` hiện có.
- Hang multiplayer tối đa 60 người/phòng, WASD/touch, camera góc ba, chat, cảm xúc, invite vào đúng room, báo cáo tin nhắn và ẩn người gửi trong phiên. 60 là giới hạn cấu hình, không phải tuyên bố đã soak test 60 người thật.
- Năm sạp vật lý: Oner điểm danh, Peyz trang phục, Keria quiz, Doran trận T1, Người giữ ký ức gallery. Đi vào vùng tương tác 2.5 m trước khi mở; menu ở xa chỉ dẫn đường/khoảng cách.
- Điện thờ riêng trên một đảo cùng room, tâm (48, 0), 20 ghế đá, cầu nguyện/cúi lạy đồng bộ. **Cửa hiện tại ở vách sau hang (0, -15.8)**. Vòng tương tác cũ gần lửa (4, 4) không còn là luồng UI hiện tại. Cùng room nên vẫn dùng chung chat.
- Match feed từ cache server PandaScore, không gọi provider từ trình duyệt. Trận đang đấu/sắp tới/kết quả, nguồn và độ mới dữ liệu, giấu spoiler mặc định mỗi lần mở. Không hứa live từng giây; khả năng điểm số trận đang diễn ra vẫn tắt/chưa xác minh.
- Video chính thức tùy chọn nhưng mặc định tắt, chưa cấu hình kênh. Không đoán stream; cần xác minh nguồn/quyền và click Play trước khi tải player bên thứ ba.
- Progression backend, check-in, XP, quiz, ví Xu, catalog/inventory có code nhưng `PROGRESSION_ENABLED=false` mặc định. Không tự bật trong công việc visual.
- **Dev preview và production khác nhau:** chỉ `import.meta.env.DEV` cho phép preview progression trong RAM của tab khi backend trả `enabled=false`. Reload mất XP/Xu/inventory. Trong production build với progression tắt, thao tác điểm danh/thưởng/quiz/mua đồ bị khóa; không được hứa đó là demo đầy đủ chỉ mất dữ liệu sau reload. Xem `apps/web/src/stalls/client.ts`.
- Gallery chỉ có poster minh họa gốc và preview ảnh do người chơi chọn bằng object URL trong tab; không upload/chia sẻ/publish. Rank/style xem thử chưa đồng bộ mạng đầy đủ. Model chủ sạp/Faker là homage low-poly thô, không phải model chính thức hay likeness được cấp quyền.
- Không có tài khoản bền vững, thanh toán thật, loot box, gallery cộng đồng, nội dung moderation hoàn chỉnh hay vận hành production hoàn thiện được bật bởi handoff này.

## 3. Chạy lại từ checkout sạch

```sh
npm ci
npm run dev:api     # mặc định 3000
npm run dev:game    # mặc định 2567
npm run dev:web     # mặc định 5173
```

Mở http://localhost:5173. Ba lệnh chạy ở ba terminal, dùng cùng checkout. Nếu cổng đã bận, chọn cổng trống cho API/game và truyền `VITE_API_URL=http://localhost:<api>/v1/guest`, `VITE_GAME_URL=ws://localhost:<game>` khi chạy Vite. Không dừng các process khác chỉ để lấy cổng.

Không cần credential/DB/Redis để review visual cơ bản. Không đặt `DATABASE_URL`/`REDIS_URL`, để match/progression tắt. Dev keys được tạo trong `.dev-keys/` và phải luôn ở ngoài git. Model GLB và manifest đã được version control, checkout có thể chạy mà không sinh lại tất cả model.

Không tự load `.env.pandascore`, bật poller, đổi cấu hình cookie, áp migration lên DB thật hoặc thay process local hiện có để làm visual. Match panel vẫn có các trạng thái disabled/empty/error để review. Nếu cần dữ liệu thử, dùng fixture có nhãn trong test harness, không trình bày kết quả giả là dữ liệu thật.

Các trang chỉ có ở dev: `/gallery.html?model=fire/tl_fx_campfire_v01`, `/preview.html?view=concept`, `/avatar-lab.html`. Game có `?view=overview`, `?autojoin=Reviewer`, `?stats=1` và `?batch=0`. Production bỏ qua các query debug. Xem phần đầu `apps/web/src/main.ts`.

```sh
npm run check
npm test
npm run build
# Khi chủ động sửa generator, chỉ sinh nhóm cần thay:
npx tsx tools/models/build.ts <environment|fire|furniture|props|characters|all>
# Render QA local (cần Chrome/WebGL tương thích):
node tools/models/render.mjs --url 'http://localhost:5173/?autojoin=Reviewer' --out .renders/review.png
```

Không có script lint riêng. `npm run check` là typecheck; build cũng chạy TypeScript. Không chạy load test/bot lên host bên ngoài khi chưa được phép.

## 4. Bản đồ code cho visual

| Hạng mục | Nguồn |
| --- | --- |
| Ánh sáng, fog, màu, chất lượng, batching, tạo world | `apps/web/src/scene.ts` |
| Asset GLB, manifest, loader | `apps/web/public/models/`, `apps/web/src/models.ts`, `apps/web/src/world/manifest.ts` |
| Generator model/rig | `tools/models/build.ts`, `tools/models/lib.ts` |
| Bố cục, collider hang, landmark | `packages/shared/src/layout.ts` |
| Camera, math, blockers, preset | `apps/web/src/camera.ts`, `cameraMath.ts`, `blockers.ts`, `world/views.ts` |
| Avatar, animation, rank/đồ thử | `apps/web/src/avatar.ts`, `avatarProgression.ts` |
| Sạp, host, bảng hiệu, vùng tiếp cận | `apps/web/src/world/stalls.ts`, `packages/shared/src/stalls.ts` |
| UI sạp, shop/quiz/gallery/check-in | `apps/web/src/stalls/StallPanel.tsx`, `stalls.css`, `client.ts` |
| Điện thờ: hình học/UI/geometry dùng chung | `apps/web/src/world/shrine.ts`, `activities/ShrinePanel.tsx`, `packages/shared/src/shrine.ts` |
| Ghế, gesture, authority server | `apps/game/src/shrine.ts`, `HubRoom.ts` |
| UI chính, phím, touch, focus, routing | `apps/web/src/ui.tsx`, `style.css`, `main.ts` |
| Panel trận đấu/video | `apps/web/src/matches/` |
| Feed upstream/cache/API | `apps/api/src/matches/` |
| Progression backend và quiz có đáp án | `apps/api/src/progression/`; không đưa đáp án server vào bundle client |

`packages/shared` dùng cho cả collision server và prediction client. Khi dời sạp/cửa/đồ lớn, cập nhật geometry dùng chung, camera blockers và test, không chỉ dời mesh. Giữ rig node names/pivot nếu muốn animation và props vẫn gắn đúng.

## 5. Hướng visual và các ranh giới cần giữ

- Hang trú thua low-poly, đá/màu đất matte, ánh lửa ấm, crimson phai ở đồ fan. Không biến thành sảnh cúp, marble, neon hay diorama bóng bẩy. Concept v3 và art bible là mốc tham khảo.
- Tăng rõ silhouette/mặt/áo của host; vật liệu, tỷ lệ và animation nhất quán giữa GLB và hình học procedural. Đừng giả là likeness chính thức.
- Cải thiện hierarchy, biển chỉ đường, tương phản chữ và prompt, UI shop/quiz/gallery, cảm giác điện thờ, chân/ghế và clipping khi cúi lạy. Giữ mood tối nhưng không giấu đường đi hay nút bấm.
- Ưu tiên màn hình 390×844 và desktop 1440×900; chừa chỗ cho bàn phím ảo, chat, joystick và ngón tay. Đừng hy sinh keyboard/focus/Escape hoặc ẩn cảnh báo dữ liệu/demo để màn hình trông gọn.
- Đo hiệu năng trước/sau: fps/frame time, draw calls, triangles, tải asset, nhiều avatar; giữ static/dynamic batching, low-quality fallback, material reuse. Budget trong art bible là mục tiêu, chưa phải benchmark thực tế.
- Giữ authority server, invite/room gating, mặc định giấu spoiler, freshness/error states, opt-in video, cảnh báo progression/demo, ownership và quota/idempotency. Không sửa behavior bảo mật chỉ để làm preview dễ hơn.
- Tránh đổi framework/engine hoặc rewrite backend cho nhiệm vụ visual. Thực hiện từng commit nhỏ, có screenshot trước/sau và ghi rõ thay đổi.

## 6. Kiểm thử sau mỗi vòng visual

1. `npm run check`, `npm test`, `npm run build`, `git diff --check`.
2. Join, đi qua cửa/sạp, xoay/zoom camera sát vách/đồ, chat rồi quay lại movement; kiểm tra mobile portrait.
3. Mở/đóng/Escape/reopen từng panel, focus wrap, double click, back/return; không để input xuyên modal.
4. Điện thờ: enter, race cùng ghế bằng hai client, pray/bow, đứng dậy, disconnect/reconnect, về hang; người khác thấy pose và ghế được release đúng.
5. Match: disabled, empty, stale/offline, toggle spoiler, close/reopen phải lại giấu điểm; không phát media trước Play.
6. Dev preview: check-in một lần/ngày, quiz tối đa ba lượt, purchase/equip, reload reset có thông báo. Production progression-off phải thông báo khóa, không lừa người test rằng phần thưởng đã lưu.
7. Capture ảnh cùng viewport/camera; ghi thiết bị/cấu hình và trạng thái kiểm chứng. Đừng ghi 60-player QA hoặc live provider latency nếu chưa chạy thật.

## 7. Trước khi close test từ Internet

- Chốt thử visual/xã hội trước hay thử progression bền vững. Đề xuất đợt đầu 5–8 người, 30–45 phút, desktop + mobile, có một người điều phối và form phản hồi ngắn. Đây là kế hoạch đề xuất, chưa phải lịch hẹn hay phát hành.
- Build production hiện tại không có progression RAM của dev. Muốn test đầy đủ loop cần một thiết kế demo rõ ràng được duyệt, hoặc duyệt bật persistent guest + migration 003/004 và QA database thật. Không dùng dev server public như giải pháp mặc định.
- **Blocker config đã xác nhận:** `compose.yaml` thêm `game.environment.DATABASE_URL` dùng password local; `compose.public.yaml` override API/migrate/matches nhưng chưa override game. Khi dùng public password khác, game còn dùng password local, report persistence không đáng tin. Sửa và kiểm tra merged config trước deploy; handoff này ghi lại, chưa triển khai sửa config vận hành đó. Readiness hiện chưa chứng minh kết nối DB của game hoạt động.
- Docker không có trên máy kiểm tra handoff; chưa chạy Compose/Docker. Pipeline có Compose integration, cần chờ kết quả đúng commit. Khởi động stack sẽ tự chạy migrator, vì vậy phải review target DB/backup/migrations trước.
- Cần hostname/HTTPS/WebSocket, host và ngân sách được duyệt; cấu hình invite, key server, secret storage, DB/Redis, health/logging, backup và rollback. Không commit secret hoặc đưa token vào `VITE_*`.
- Nếu dùng progression: xác nhận rõ cookie HttpOnly 30 ngày, chính sách lưu/xóa dữ liệu, đúng WEB_ORIGIN và flag API/game, contention nhiều connection Postgres, durable browser flows. Compose hiện chưa pass cờ progression, không chỉ sửa `.env` rồi cho rằng tính năng đã bật.
- Nếu dùng feed/video: token chỉ backend, kiểm tra quyền provider/source, thông báo stale và mất upstream, nguồn video chính thức/quyền nhúng. Không cần video cho vòng test đầu.
- Kiểm tra mã mời, exact-room invite, đầy phòng, reconnect, report/mute, rate limiting, mạng yếu và ngân sách tài nguyên. Không có dashboard moderation hoàn chỉnh, cần người nhận báo lỗi và biết cách dừng test.

## 8. Những gì có và không có trong git

Có toàn bộ source, migrations, test, tài liệu, dependency manifests và model/concept đã được tracking. Không kèm `.env.pandascore`, `.env` khác ngoài template, khóa dev, DB/socket/log runtime, `node_modules`, build output, reports hay screenshot QA tạm. Không có secret được chuyển giao cho Opus. Cần tự cung cấp cấu hình qua secret storage đúng môi trường khi có phê duyệt riêng.

Các báo cáo `community-update`, `shrine-update`, `cave-stalls-update`, `t1-match-feed` là lịch sử công việc; số test/trạng thái runtime cũ không phải bằng chứng service vẫn đang chạy. Việc publish nhánh không đồng nghĩa production-ready.

## 9. Kiểm chứng lần bàn giao

Đã chạy lại trên Node 26.11.1 / npm 11.20.0:
- `npm run check`: pass.
- `npm test`: 173/173 pass, không skip.
- `npm run build`: pass TypeScript, Vite và bốn server bundle.
- `git diff --check`: pass trước staging; staged diff cũng được kiểm tra trước commit.
- Bundle chính: 2,799.87 kB, gzip 754.54 kB. Vite vẫn cảnh báo chunk >500 kB; chưa tối ưu trong lần đóng gói.
- Audit source để chuẩn bị push: không phát hiện credential thật hoặc đường dẫn định danh máy trong nội dung mới. Các chuỗi token/URL credential được đánh dấu trong test là fixture giả. `.env.*`, khóa dev, reports, renders và log vẫn bị loại khỏi git; Docker context cũng được bổ sung các loại trừ tương ứng.

Không chạy lại browser visual QA, live provider, migration lên DB thật hay Docker trong lần đóng gói này; những kết quả trước đó trong tài liệu vẫn giữ nguyên phạm vi/giới hạn lịch sử. GitHub CI phải được kiểm tra theo đúng commit sau khi push; local pass không thay cho Compose CI.
