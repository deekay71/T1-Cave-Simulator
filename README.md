# Tê Liệt

Social hub 3D nhiều người: vào hang, trò chuyện, biểu cảm và minigame. Repo kỹ thuật giữ URL `deekay71/T1-Cave-Simulator`; tên sản phẩm trong giao diện là **Tê Liệt**.

## Trạng thái

Foundation + technical spike, chưa phải dịch vụ sẵn sàng mở public. Có:
- client PlayCanvas;
- server Colyseus 0.18, quyết định vị trí và có client prediction;
- guest API Fastify cấp vé EdDSA;
- SQL migration, Redis adapter, Docker Compose và CI.

Mục tiêu 10.000 CCU **chưa được chứng minh**. Phương án kỹ thuật đã chốt và việc còn lại: [docs/tech-decisions.md](docs/tech-decisions.md).

## Chạy nhanh không cần Docker

Node 26 LTS, npm. Từ gốc repo:

```sh
npm ci
npm run dev:api
```

Ở hai terminal khác chạy `npm run dev:game` và `npm run dev:web`, rồi mở http://localhost:5173 trong hai tab. Nhập tên, dùng WASD hoặc phím mũi tên, chat, bấm nút chào.
- Không cần cấu hình khóa: ngoài production, API, game và bot dùng chung khóa dev tự sinh trong `.dev-keys/` (đã gitignore).
- Không có `DATABASE_URL`/`REDIS_URL` thì chạy trong RAM, không có tài khoản bền vững.
- Client hiện ưu tiên desktop, chưa có điều khiển cảm ứng.

```sh
npm run build        # typecheck + build web + đóng gói server ra dist/server/*.mjs
npm test             # unit test: di chuyển, vé, rate limit
# Khi game server đang chạy:
BOTS=31 DURATION_SECONDS=10 npm run spike
```

Spike kiểm tra:
- vé sai bị từ chối;
- chia room 30 + 1;
- rate limit chat;
- di chuyển qua kênh input (đúng tốc độ, trong biên hang);
- mỗi tài khoản một chỗ.

Bot tự ký vé bằng khóa dev để chỉ đo game server, không đo guest API. Không cấp khóa ký production cho máy tạo tải ngoài môi trường kiểm soát.

Game mở thêm cổng quản trị nội bộ `ADMIN_PORT` (mặc định 9100): `/health/live`, `/health/ready` (trả 503 khi đang drain), `/metrics` (Prometheus). Không public cổng này.

## Docker trên máy có Docker Engine / Compose

```sh
npm run -s keys > .env    # tạo khóa vé; Compose tự đọc .env
docker compose up --build -d
```

Mở http://localhost:8080. Compose khởi động PostgreSQL, Redis, migration một lần, API, game và Nginx; image backend chạy JS đã build bằng Node 26, không kèm devDependencies.
- Dữ liệu PostgreSQL nằm ở named volume. `docker compose down` giữ dữ liệu; `down -v` thì xóa.
- Mật khẩu `local_only` chỉ dùng local. Compose không expose database ra host và chỉ bind web vào loopback. Không dùng nguyên cấu hình này để public Internet.

Biến môi trường chính (xem `.env.example`):
- `TICKET_PRIVATE_JWK`: API dùng để ký vé.
- `TICKET_PUBLIC_JWKS`: game dùng để xác minh vé.
- `TRUST_PROXY`: số proxy đứng trước API, để rate limit tính theo IP thật của người dùng.

## Cấu trúc

- `apps/web`: PlayCanvas/Vite, hang greybox, avatar, chat/emote; tự di chuyển nhân vật của mình bằng `Predict` của Colyseus.
- `apps/game`: Colyseus `hub_v1`, 30 ghế, fixed timestep 20 Hz, patch 10 Hz, mỗi tài khoản một chỗ, health/metrics.
- `apps/api`: Fastify guest ticket, liveness/readiness.
- `packages/shared`: luật di chuyển dùng chung client/server, input schema, giới hạn tần suất.
- `packages/auth`: ký và xác minh vé EdDSA, nạp khóa.
- `db`: migration `NNN_*.sql`. `scripts`: migrator, unit test, bot spike, build server, tạo khóa.
- `infra`, `compose.yaml`: ảnh container, reverse proxy, local stack.

Đọc thêm: [phương án kỹ thuật đã chốt](docs/tech-decisions.md), [kiến trúc](docs/architecture.md), [room/networking](docs/networking.md), [dữ liệu](docs/data.md), [deployment](docs/deployment.md), [milestones/spike](docs/roadmap.md). Các file docs ngoài `tech-decisions.md` còn là bản cũ, chưa cập nhật theo bản chốt.

## Giới hạn hiện tại

Chưa có:
- login lâu dài (Better Auth), refresh token;
- bộ lọc chat và moderation/report UI;
- minigame, inventory API;
- drain có chuyển người chơi sang worker mới;
- kiểm thử trên thiết bị thật.

Các bảng tương ứng là contract cho giai đoạn tiếp theo, không đồng nghĩa tính năng đã hoạt động.

Không nhúng logo, ảnh tuyển thủ hoặc tài sản thương hiệu T1. Việc đổi tên không thay thế việc kiểm tra quyền sử dụng tài sản trước phát hành.
