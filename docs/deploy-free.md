# Deploy miễn phí cho bản chơi thử

Tra cứu ngày 2026-11-10. Gói free thay đổi thường xuyên, nên kiểm tra lại trang chính thức trước khi làm.

Mục tiêu: một bản chơi thử công khai cho 10–50 người cùng lúc, đa số ở Việt Nam, chi phí 0 đồng. Đây không phải môi trường production; các release gate trong `deployment.md` vẫn áp dụng trước khi phát hành thật.

## Phương án chọn: Oracle Cloud Always Free, 1 máy ARM ở Singapore

Chạy nguyên `compose.yaml` hiện có (Postgres, Redis, migrate, API, game, web) trên một máy ảo Ampere A1, rồi đặt Caddy phía trước để có HTTPS với tên miền free `<ip>.sslip.io`.

Lý do chọn:
- **Free vĩnh viễn, máy không ngủ.** Đây là lựa chọn duy nhất đáp ứng cả hai điều đó mà vẫn gần Việt Nam (Singapore, khoảng 30–50 ms).
- **Đủ chạy cả stack và build trên máy.** Hạn mức A1 hiện là **2 OCPU + 12 GB RAM** (1.500 OCPU-giờ + 9.000 GB-giờ mỗi tháng; giữa năm 2026 đã giảm từ 4/24). Kèm 200 GB ổ đĩa và 10 TB băng thông ra mỗi tháng.
- **Không phải sửa code.** Postgres và Redis chạy ngay trên máy, không phụ thuộc dịch vụ ngoài. Không dùng Upstash free được: riêng việc kiểm tra định kỳ của Colyseus 0.18 đã tốn khoảng 518 nghìn lệnh/tháng, vượt hạn 500 nghìn.
- **Chạy được trên ARM.** Các image `node:26-bookworm-slim`, `postgres:17`, `redis:7.4`, `nginx:1.28-alpine` đều có bản arm64. `package-lock.json` đã có sẵn binary arm64 cho esbuild, rolldown, TypeScript và lightningcss.

Rủi ro cần biết:
- **Cần thẻ tín dụng và số điện thoại khi đăng ký.** Oracle nói không trừ tiền nếu không nâng cấp. Một số thẻ ảo hoặc trả trước có thể bị từ chối.
- **Home region chọn lúc đăng ký và gần như không đổi được.** Máy free chỉ tạo được ở home region, nên chọn **Singapore (ap-singapore-1)**. Nếu Singapore không được thì chọn Tokyo, Osaka hoặc Seoul.
- **Có thể gặp lỗi "Out of host capacity".** Đây là tình trạng Oracle tạm hết máy A1. Region châu Á chỉ có 1 availability domain, nên cách duy nhất là thử lại sau.
- **Máy rảnh có thể bị thu hồi.** Điều kiện là trong 7 ngày, phân vị 95 của CPU, mạng **và** RAM (riêng A1) đều dưới 20%. Cần theo dõi RAM (20% của 12 GB là khoảng 2,4 GB) và luôn sao lưu Postgres ra ngoài máy.
- **Không được vượt hạn mức A1.** Tổng tài nguyên A1 phải giữ trong 2 OCPU / 12 GB; vượt là **tất cả** máy A1 bị tắt, sau 30 ngày thì bị xóa.

## Các bước

1. **Đăng ký Oracle Cloud Free Tier,** chọn home region Singapore. Tạo budget alert 1 USD cho chắc.
2. **Tạo máy:** shape `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu 24.04 arm64, boot volume khoảng 100 GB, gắn khóa SSH.
   - Nếu báo hết máy thì thử lại vào lúc khác.
   - Nếu vẫn không tạo được, dùng phương án dự phòng 1 ở dưới.
3. **Mở cổng 80/443 ở cả hai nơi:** security list của VCN, và firewall iptables của Ubuntu (image Oracle chặn sẵn ngoài cổng 22).
4. **Cài Docker và Docker Compose plugin,** sau đó clone repo:
   - nhánh `feat/concept-models`, hoặc
   - nhánh đã gộp xong phần bảo mật đang làm ở thư mục chính (nếu đã gộp).
5. **Chuẩn bị `.env`** (xem `.env.example`):
   - Tạo khóa vé trên máy cá nhân bằng `npm run -s keys`, chép hai dòng `TICKET_PRIVATE_JWK`, `TICKET_PUBLIC_JWKS` vào `.env` trên server.
   - `SITE_HOST=<ip-có-dấu-gạch>.sslip.io` (ví dụ `203-0-113-7.sslip.io`), hoặc subdomain DuckDNS.
   - `POSTGRES_PASSWORD=<mật khẩu dài ngẫu nhiên>`. Chỉ có hiệu lực khi volume Postgres được tạo lần đầu.
   - Close test: `INVITE_CODE=<mã mời>`, `GUEST_RATE_LIMIT=120`.
6. **File cho môi trường public đã có sẵn:**
   - `compose.public.yaml` thêm Caddy (HTTPS Let's Encrypt tự động, cổng 80/443), đổi mật khẩu Postgres, đặt `WEB_ORIGIN`, `TRUST_PROXY=2` (Caddy → Nginx), mã mời, giới hạn vé và `restart: unless-stopped`.
   - `infra/Caddyfile` chuyển tiếp sang Nginx; Nginx nén JS/GLB và cache file tĩnh.
   - Không cần đổi client: bản build production gọi `/v1/guest` và WebSocket `wss://<cùng host>`.
7. **Khởi động:** `docker compose -f compose.yaml -f compose.public.yaml up -d --build`.
   - Build ngay trên máy được: 12 GB RAM là đủ.
   - Kiểm tra `https://<host>/health/ready`, rồi mở game bằng 2 trình duyệt.
   - Gửi tester link `https://<host>/?invite=<mã mời>`: mã tự điền vào form và được nhớ cho lần sau. Không có mã thì form hiện ô "Mã mời".
8. **Kiểm tra tải:** chạy bot từ máy cá nhân, ví dụ `GAME_URL=wss://<host> BOTS=100 ALLOW_REMOTE=1 npm run bots`, và theo dõi CPU/RAM bằng `docker stats`. Đo trên máy dev (Apple M4) ngày 2026-11-10: 100 bot ở 2 hang dùng khoảng 5% một nhân CPU, RAM tiến trình game 115 MB; máy ARM của Oracle chậm hơn nhưng vẫn dư nhiều.
9. **Vận hành:**
   - Cron `pg_dump` hằng ngày, đẩy bản sao lưu ra ngoài máy.
   - Bật `restart: unless-stopped` cho các service.
   - Cập nhật bằng `git pull && docker compose ... up -d --build`. Người chơi sẽ bị ngắt kết nối vài giây; client đã có cơ chế tự kết nối lại.

## Dự phòng

1. **Không tạo được A1:** dùng 2 máy Oracle AMD Micro free, mỗi máy 1 GB RAM và 50 Mbps.
   - Máy thứ nhất chạy Postgres và Redis, máy thứ hai chạy API, game và Caddy; hai máy nói chuyện qua mạng nội bộ.
   - Build image ở nơi khác (CI hoặc `docker buildx` cho amd64) rồi pull về, vì build trên máy 1 GB sẽ hết RAM. Bật swap.
   - Chạy thử 50 bot trước khi mời người chơi.
2. **Không có thẻ hoặc bị Oracle từ chối:** dùng Render free ở Singapore, chỉ hợp với buổi chơi thử có hẹn giờ.
   - **Thành phần:** client là static site; API và game là 2 web service Docker (0,1 CPU / 512 MB mỗi cái); Redis dùng Key Value free; Postgres dùng Neon free ở Singapore, không dùng Postgres của Render vì hết hạn sau 30 ngày.
   - **Hạn chế:** service ngủ sau 15 phút không có traffic và mất khoảng 1 phút để thức. 750 giờ/tháng là dùng chung cho cả workspace, nên không chạy cả hai service 24/7 được. Không ping để giữ thức, Render coi đó là lạm dụng.
   - **Chưa chắc:** 0,1 CPU có kịp vòng mô phỏng 20 Hz hay không, cần đo thử.
3. **Chơi thử vài tháng:** AWS Free plan cho tài khoản mới (100 USD + tối đa 100 USD credit, tối đa 6 tháng).
   - Dùng máy `t4g.small` ở Singapore, chạy y nguyên Compose.
   - Hết hạn thì tài khoản bị đóng nếu không nâng cấp.

## Không nên dùng

| Dịch vụ | Lý do |
|---|---|
| Upstash Redis free | Hết hạn mức lệnh mỗi tháng vì Colyseus |
| Koyeb free | Chỉ có server ở Frankfurt và Mỹ |
| Google Cloud e2-micro | Chỉ có ở Mỹ, 1 GB băng thông ra mỗi tháng |
| Railway, Fly.io | Không còn free lâu dài |
| Northflank | Tài liệu yêu cầu thẻ, mâu thuẫn với trang giá |
| Vercel Hobby | Cấm dùng thương mại |
| Cloudflare Durable Objects | Phải viết lại server, bỏ Colyseus |
| Cloudflare quick tunnel | Mỗi lần chạy ra URL mới, không cam kết uptime; chỉ hợp cho vài giờ thử nhanh từ máy cá nhân |

Nếu sau này có tên miền riêng và đưa qua Cloudflare proxy, cần thêm heartbeat WebSocket dưới 100 giây, vì Cloudflare đóng kết nối WebSocket không có dữ liệu sau một khoảng thời gian không công bố.

## Nguồn chính

- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle Free Tier (đăng ký, home region): https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm
- Render free: https://render.com/docs/free
- Neon pricing: https://neon.com/pricing
- Upstash pricing: https://upstash.com/pricing/redis
- sslip.io: https://sslip.io
- AWS Free Tier: https://aws.amazon.com/free/
