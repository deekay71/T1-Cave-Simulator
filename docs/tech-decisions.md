> Cập nhật bản chơi thử 09/11/2026: art direction theo concept v3 và docs/art-direction.md; GDD v3 thay phần hình ảnh v1. React overlay đã thêm. Repo đã có commit nền tảng và remote; các ghi chú “chưa commit” bên dưới là lịch sử M0. Các quyết định kỹ thuật T1–T19 vẫn áp dụng; package-lock.json là phiên bản thực tế, bảng version cuối tài liệu là snapshot cũ.

# Tê Liệt — Phương án kỹ thuật đã chốt

Ngày chốt: 09/11/2026 · Áp dụng từ M0

**Phạm vi.** Yêu cầu sản phẩm giữ nguyên theo GDD và các tài liệu trong *Te-Liet Project Design & Concept Pack v1*. Tài liệu này chốt phương án kỹ thuật chung, gộp từ ba nguồn:
- pack đó;
- bản thiết kế "T1 Hang";
- kết quả review scaffold ngày 09/11/2026.

Chỗ nào khác với `architecture.md`, `networking.md`, `data.md`, `deployment.md` hoặc `hall-integration.md` thì theo tài liệu này, cho đến khi các file đó được cập nhật (mục 4).

## 1. Bảng quyết định

| # | Hạng mục | Chốt | So với hiện tại |
|---|---|---|---|
| T1 | Engine 3D | PlayCanvas engine qua npm + TypeScript, không dùng PlayCanvas Editor | Giữ |
| T2 | UI | React cho lớp UI DOM phủ trên canvas (chat, panel Hall of Fame, cài đặt, báo cáo). Không dùng React để render 3D | Mới: scaffold đang dùng DOM thuần |
| T3 | Realtime | Colyseus **0.18**, `@colyseus/schema` 5, `@colyseus/sdk` 0.18 | Nâng từ 0.17 ngay ở M0 |
| T4 | Di chuyển | Server quyết định vị trí. Dùng bộ netcode có sẵn của 0.18: `defineInput` + `setFixedTimestep` ở server; `room.input()` + `Predict` + `room.clock` ở client | Thay vòng "lấy input mới nhất mỗi tick" và lerp hiện tại |
| T5 | Room | `hub_v1` tối đa 30 người (cập nhật 2026-11-10: nâng lên 60 cho close test, đo bằng bot). Minigame và quiz chạy **trong room hub** dưới dạng activity. Phòng riêng (mời bạn) là room riêng | Khác `networking.md` (đang tách room cho minigame/quiz) |
| T6 | API | Fastify 5, bật `trustProxy` theo hạ tầng thật | Giữ, sửa cấu hình proxy |
| T7 | Tài khoản | Better Auth chạy trên Fastify: guest (plugin anonymous), Google, Discord, liên kết tài khoản giữ tiến trình | Mới: thay kế hoạch tự viết refresh rotation |
| T8 | Vé vào game | JWT EdDSA hạn 60 s; API ký bằng khóa riêng, game chỉ giữ khóa công khai. Mỗi tài khoản một chỗ | Thay HS256 dùng chung, hạn 15 phút, dùng lại được |
| T9 | Database | PostgreSQL, SQL thuần + `pg`; migrator chạy lần lượt `db/NNN_*.sql` | Giữ SQL; viết lại migrator, sửa schema (2.4) |
| T10 | Redis | Presence/driver của Colyseus, rate limit dùng chung, ban/mute, chỗ ngồi theo tài khoản | Giữ, thêm khóa mới |
| T11 | Nội dung lịch sử và quiz | Alpha: JSON trong repo, duyệt qua PR, CI xuất snapshot lên CDN. Bảng `history_*` trong DB làm sau, khi có người biên tập không dùng Git | Khác `hall-integration.md` (đang làm CMS trong DB từ M1) |
| T12 | Asset | Blender → GLB nén **Draco**, texture **KTX2 (Basis)**. Dữ liệu màn chơi lấy từ custom properties của Blender ra `level.json`, dùng chung client và server. Chưa cần navmesh | Mới. Không dùng Meshopt vì PlayCanvas 2.23 không đọc được |
| T13 | Hạ tầng | Cloudflare phía trước (CDN, TLS, WAF, Turnstile, proxy WebSocket); mỗi game worker một hostname; Postgres và Redis managed; region Singapore | Gộp hai bản thiết kế |
| T14 | Runtime, build | Node **26 LTS** cho máy dev, CI và Docker. Image production chạy JS đã build, không kèm devDependencies. Package nội bộ import qua tên workspace | Sửa: Docker/CI đang Node 22, máy dev Node 26 |
| T15 | Kiểm duyệt | `packages/moderation` lọc tên và chat ở server (2.6); bộ đệm 50 tin mỗi room làm bằng chứng báo cáo; ban/mute qua Redis | Mới: scaffold chưa có |
| T16 | Kiểm thử | `node:test` cho unit; `@colyseus/testing` cho room; giữ bot spike; Playwright smoke 2 trình duyệt | Thêm test room |
| T17 | Quan sát | pino cho API và game, Prometheus metrics, Sentry cho client | Thêm cho game (đang dùng `console.log`) |
| T18 | Quy mô | Alpha mục tiêu 500 CCU. Chương trình chứng minh 10k CCU chỉ chạy khi alpha cho thấy có nhu cầu | Hoãn Spike C |
| T19 | Không làm ở MVP | Voice, livestream, giao dịch giữa người chơi, tiền thật | Giữ |

## 2. Chi tiết

### 2.1 Colyseus 0.18 và di chuyển (T3, T4)

0.18 phát hành 22/05/2026, hiện ở 0.18.12. Các breaking change không đụng tới scaffold:
- giới hạn 63 field mỗi Schema;
- `setMetadata()` thay thế thay vì gộp;
- bỏ `client.id` và fossil-delta;
- playground bị khóa ở production;
- `setSimulationInterval` đổi tên thành `setTimestep` (tên cũ vẫn chạy).

Lý do nâng ngay: 0.18 có sẵn đúng những phần scaffold còn thiếu và tài liệu đang để "spike sau":
- input buffering theo từng client;
- vòng lặp fixed timestep;
- client prediction và reconciliation;
- đồng hồ server đồng bộ;
- nội suy cho avatar người khác.

Mô hình:
- Input là hướng đi trên mặt phẳng XZ, không gửi tọa độ.
- Server áp mỗi input đúng một bước cố định 50 ms (20 Hz); patch 20 Hz (mỗi patch đúng một bước mô phỏng; client nội suy người khác trễ 100 ms = 2 patch, có lò xo đầu ra 25 ms. Patch 10 Hz với độ trễ nội suy 100 ms từng làm nhân vật người khác khựng rồi vọt: bộ đệm nội suy cạn mỗi khi một patch tới muộn).
- Một hàm thuần `step(state, input, dt, colliders)` đặt trong `packages/shared`, chạy giống nhau ở client (dự đoán) và server (quyết định).
- Client không gửi input khi đứng yên.
- Avatar người khác nội suy theo `room.clock`.

Nghiệm thu:
- Ở RTT giả lập 150 ms, nhân vật của mình phản hồi ngay khi bấm phím.
- Sai lệch sau reconcile ≤ 0,1 m khi mạng bình thường.

### 2.2 Activity trong room hub (T5)

- Minigame "Nhặt tinh thể" diễn ra ở khu arena trong hub, quiz ở góc quiz. Người không tham gia vẫn đứng xem được.
- Lý do: nếu tách room, người chơi phải rời hub; lúc quay về mà hub đã đầy thì nhóm bạn bị chia sang hub khác.
- State nằm trong `activities` của `HubState`: phase, deadline, người tham gia, tinh thể.
- Luật chơi và vòng đời giữ nguyên spec trong `networking.md` và `hall-integration.md`; chỉ đổi nơi chạy. `minigame_runs.room_id` là id của room hub.
- Mỗi activity là một module riêng trong `apps/game/src/activities/`, để sau này tách ra room riêng được nếu cần.

### 2.3 Tài khoản và vé vào game (T7, T8)

**Tài khoản**
- Better Auth quản lý user, session, OAuth (Google, Discord) và guest. Guest liên kết tài khoản thì giữ nguyên tiến trình.
- Bảng `accounts` trở thành hồ sơ người chơi, khóa theo id user của Better Auth; bỏ bảng `sessions` tự viết. SQL schema của Better Auth được commit thành migration như mọi migration khác.

**Vé vào game**
- JWT EdDSA, gồm các claim `sub`, `name`, `trust`, hạn 60 s, có `kid` để xoay khóa. Game chỉ giữ khóa công khai.
- Code ký và xác minh vé chuyển sang `packages/auth`; API không import từ `apps/game` nữa.
- Mỗi tài khoản một chỗ: khi vào room, server ghi `seat:{accountId}` vào Redis. Nếu tài khoản đang có chỗ ở phiên khác thì kick phiên cũ (mở tab mới thì tab cũ thoát).

**Chống lạm dụng**
- Tạo guest phải qua Turnstile.
- Tên hiển thị qua bộ lọc (2.6) và danh sách tên cấm (tuyển thủ, staff).

### 2.4 Dữ liệu và migration (T9)

**Migrator**
- Chạy lần lượt `db/NNN_*.sql`, mỗi file một transaction, lưu version và checksum. Từ chối chạy nếu một file đã áp dụng bị sửa. Giữ advisory lock.
- `001_initial.sql` chưa từng chạy ở môi trường nào, nên được sửa thẳng một lần trước khi dựng môi trường đầu tiên. Từ đó về sau, mọi thay đổi là migration mới.

**Sửa schema**
- `reward_ledger`: thay `run_id NOT NULL` bằng `source_type` + `source_id`, khóa duy nhất `(account_id, source_type, source_id, reward_key)`. Nhờ vậy ghi được thưởng từ quiz, badge khám phá và sự kiện, không chỉ từ minigame.
- `friendships`: một dòng cho mỗi cặp (`user_low < user_high`, `requested_by`, `status`), để A–B và B–A không cùng tồn tại.
- `sanctions` thêm `created_by`, `revoked_at`; `moderation_reports` thêm `handled_by`.

### 2.5 Nội dung lịch sử và quiz (T11)

- Nội dung nằm ở `content/history/*.json` và `content/quiz/*.json`. CI kiểm tra bằng zod; mỗi thay đổi review qua PR, người duyệt là reviewer biên tập.
- CI xuất hai bản:
  - snapshot công khai cho client, đẩy lên CDN, tên file có hash;
  - bản quiz đầy đủ đáp án, chỉ game server đọc. Đáp án không bao giờ nằm trong bundle hay snapshot của client.
- Memory wall là nội dung người dùng tạo, nên vẫn lưu trong Postgres như thiết kế (P2).

### 2.6 Kiểm duyệt (T15)

**Chuẩn hóa văn bản trước khi so khớp**
- Chữ thường, NFC.
- Bỏ ký tự chèn giữa các chữ.
- Đổi leetspeak, gộp chữ lặp.
- Tạo thêm một bản bỏ dấu.

**So khớp hai tầng**
- Danh sách có dấu áp cho bản gốc.
- Danh sách không dấu chỉ áp khi cả câu viết không dấu, và luôn kèm danh sách cho phép. Lý do: bỏ dấu tạo trùng nghĩa trong tiếng Việt, ví dụ "đeo kính" bỏ dấu trùng dạng không dấu của một từ chửi phổ biến.

**Giới hạn và chặn**
- Chặn link và số điện thoại.
- Chat 5 tin/10 s (guest 3 tin/10 s). Rate limit kiểm tra **trước** khi parse payload.

**Bằng chứng báo cáo**
- Lấy từ bộ đệm chat trong RAM của room, không lấy từ dữ liệu client gửi lên. Không lưu toàn bộ chat (giữ nguyên nguyên tắc của `data.md`).

### 2.7 Asset và dữ liệu màn chơi (T12)

- Đã kiểm tra bản build `playcanvas` 2.23.3: có xử lý `KHR_draco_mesh_compression` và `KHR_texture_basisu`, không có `EXT_meshopt_compression`. Vì vậy mesh nén bằng Draco, texture dùng KTX2/Basis.
- Trong Blender, custom properties (xuất vào `extras` của glTF) đánh dấu spawn, chỗ ngồi, điểm tương tác, collider và khu. Script build tách chúng ra `level.json`, dùng cho cả client và server.
- Collider là hình 2D trên mặt phẳng XZ (tròn, hộp, đa giác), cộng một đa giác biên cho vùng đi được. Thay cho biên vuông ±14 m hiện tại, vì hang là hình tròn bán kính 15 m và hầm kéo dài tới Z ≈ 32 m.
- Chưa cần navmesh vì điều khiển là WASD, không có click-to-move.

**Cập nhật 2026-11-10 (bản chơi thử theo concept v3):** asset alpha được sinh bằng code thay vì Blender: `tools/models` dùng `@gltf-transform/core` (chỉ là devDependency), cho ra GLB flat-shaded tô màu theo đỉnh, không có texture, khoảng 3,5 MB cho 63 model. Vì không có texture và file nhỏ nên chưa cần KTX2/Draco; nén gzip hoặc brotli khi host là đủ. Dữ liệu màn chơi là `packages/shared/src/layout.ts`: bảng đặt model kèm collider tròn, dùng chung cho client và server, thay cho `level.json`. Biên đi được là vòng tròn bán kính 16 m. Khi có asset vẽ tay thì quay lại phương án Blender → Draco/KTX2 ở trên.

### 2.8 Hạ tầng (T13)

- Cloudflare:
  - CDN cho web và asset, TLS, WAF, Turnstile;
  - proxy WebSocket tới game worker theo hostname `g-<worker>.game.<domain>` (`PUBLIC_ADDRESS`).
- Fastify bật `trustProxy` và đọc IP thật của người dùng từ header do proxy gửi (`CF-Connecting-IP` hoặc `X-Forwarded-For`). Nếu không, mọi request qua proxy mang IP của proxy, và rate limit 20 request/phút bị áp chung cho cả site.
- Postgres và Redis managed, cùng region Singapore với game worker.
- Docker Compose giữ cho local và CI.

## 3. Việc cần làm trong scaffold (M0)

Kết quả review ngày 09/11/2026 đã xác nhận:
- typecheck bằng TypeScript 7.0.2 qua;
- 3 unit test qua;
- build web qua: một chunk 2,1 MB, 544 KB gzip, phần lớn là engine;
- bot spike 31 client chia thành room 30 + room 1, 0 lỗi.

| # | Việc | Căn cứ |
|---|---|---|
| 1 | Tạo commit đầu tiên và remote để CI thực sự chạy | Repo chưa có commit nào. Máy hiện tại không có Docker nên Compose chưa từng chạy |
| 2 | Nâng Colyseus 0.18 (T3) | |
| 3 | Mỗi tài khoản một chỗ (T8) | Thử thực tế: một token vào được 3 chỗ trong cùng một room |
| 4 | Bật `trustProxy`; Nginx gửi `X-Forwarded-For` | Đọc code: sau Nginx, mọi người dùng chung một bucket rate limit |
| 5 | Vé EdDSA 60 s, tách `packages/auth` (T8) | `apps/api` đang import `apps/game/src/auth.ts`; cả hai giữ cùng một secret ký |
| 6 | Rate limit trước khi parse cho chat và emote; giới hạn chat theo 2.6 | Hiện parse trước nên payload sai không bị tính; 2 tin/giây quá rộng |
| 7 | Di chuyển theo T4; client ngừng gửi input khi đứng yên | Server đang lấy input mới nhất mỗi tick nên client không dự đoán chính xác được. Client gửi 20 input/giây kể cả khi đứng yên |
| 8 | Migrator nhiều file, sửa schema (2.4) | Migrator hiện báo lỗi với mọi version khác 1 |
| 9 | Docker và CI chuyển sang Node 26; image chạy JS đã build | Docker/CI đang Node 22; image chạy TypeScript qua `tsx` |
| 10 | Game có readiness endpoint, log pino, metrics | Game chỉ có `console.log` |
| 11 | Đưa điểm spawn ra khỏi tâm lửa trại | Người chơi xuất hiện ở (0, 0), trùng vị trí lửa |

### Trạng thái M0 (cập nhật 09/11/2026)

**Đã làm:** việc 2–11 trong bảng trên. Cụ thể:
- Colyseus 0.18 với `defineInput` + `setFixedTimestep`; client dùng `Predict`. State chuyển sang `schema()` (vì `defineTypes` đã deprecated).
- Vé EdDSA 60 s trong `packages/auth`.
- Mỗi tài khoản một chỗ.
- `trustProxy`.
- Rate limit trước khi parse.
- Migrator nhiều file và sửa schema.
- Health, log pino, metrics cho game.
- Node 26 và image chạy JS đã build.
- Spawn ở cửa hang.

**Đã kiểm chứng:**
- Typecheck và 13 unit test qua.
- Bot spike 31 client qua đủ: vé sai, chia room, rate limit chat, tốc độ và biên di chuyển, một tài khoản một chỗ.
- Spike cũng chạy với bản JS đã build và khóa lấy từ biến môi trường.
- Migrator chạy trên Postgres thật (PGlite): chạy lần đầu, chạy lại, thêm file mới, phát hiện file cũ bị sửa.
- Rate limit tách theo IP sau proxy.
- Client trên trình duyệt: vào hang, di chuyển, chat; avatar người khác hiện ở tab thứ hai.

**Còn lại:**
- Việc 1: commit đầu tiên và remote, để CI và Compose thực sự chạy. Máy hiện tại không có Docker.
- Các mục ngoài M0: Better Auth (T7), UI React (T2), nội dung dạng file (T11), pipeline asset và `level.json` (T12), bộ lọc chat (T15), test room bằng `@colyseus/testing` (T16), Sentry (T17).

Ghi chú: TypeScript 7 chỉ dùng để typecheck. Khi thêm công cụ dựa trên API của TypeScript (ví dụ ESLint có rule cần type), phải kiểm tra tương thích trước.

## 4. Tài liệu cần cập nhật theo bản chốt

- Đưa toàn bộ docs của Design Concept Pack v1 vào `docs/`, để repo là nguồn duy nhất. Hiện repo chỉ có 5 file docs bản cũ.
- `architecture.md`: Colyseus 0.18, Better Auth, vé EdDSA, Cloudflare.
- `networking.md`: input và prediction của 0.18, activity chạy trong hub, mỗi tài khoản một chỗ.
- `data.md`: migrator mới, bảng của Better Auth, `reward_ledger`, `friendships`.
- `hall-integration.md`: nội dung dạng file trong repo ở giai đoạn alpha.
- `deployment.md`: `trustProxy`, Node 26, image build sẵn.
- `art-direction.md`, `modeling-brief.md`: thêm bước nén Draco + KTX2 và custom properties cho `level.json`.
- `roadmap.md`: ước lượng lại, khoảng 4–5 tháng tới public beta với 1 dev và 1 người làm 3D bán thời gian.

## 5. Đã cân nhắc nhưng không chọn

| Phương án | Lý do không chọn |
|---|---|
| React Three Fiber thay PlayCanvas | Scaffold đã dùng PlayCanvas; đổi không đem lại lợi ích đủ lớn |
| Hono thay Fastify | Như trên |
| Client tự quyết vị trí, server chỉ kiểm tra | Minigame nhặt tinh thể cần công bằng; 0.18 đã có sẵn prediction nên để server quyết vị trí không còn tốn công |
| Tự viết prediction và reconciliation | 0.18 có sẵn |
| Tự viết OAuth và refresh rotation | Mã bảo mật nên dùng thư viện đã được kiểm chứng |
| Drizzle ORM | Giữ SQL thuần cho schema; số lượng query còn ít |
| `@colyseus/database`, `@colyseus/auth`, `@colyseus/admin` (mới trong 0.18) | Kéo theo đổi cả tầng DB và auth sang của Colyseus. Xem lại admin console khi cần công cụ vận hành |
| Meshopt | PlayCanvas 2.23 không hỗ trợ |
| Navmesh | Chưa có click-to-move |
| Chứng minh 10k CCU trước alpha | Tốn vài tuần và tiền hạ tầng, chưa có dữ liệu nhu cầu |

## 6. Phiên bản đã kiểm tra (09/11/2026)

| Gói | Bản mới nhất | Scaffold đang dùng |
|---|---|---|
| `colyseus` / `@colyseus/core` | 0.18.12 / 0.18.27 | core 0.17.56 |
| `@colyseus/schema` | 5.0.45 | 4.0.31 |
| `@colyseus/sdk` | 0.18.9 | 0.17.43 |
| `playcanvas` | 2.23.3 | 2.23.3 |
| `better-auth` | 1.7.18 | chưa dùng |
| Node.js LTS | 26.13.0 (Lithium) | Docker/CI 22, máy dev 26.11.1 |

Nguồn: npm registry; hướng dẫn nâng cấp Colyseus tại https://docs.colyseus.io/migrating/0.18; lịch phát hành Node tại https://nodejs.org/dist/index.json.
