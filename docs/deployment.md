# Deployment và scale

## Mức 0: local/integration

`compose.yaml` là topology một game process, một API, Nginx và hai data service. Nginx chuyển `/matchmake/` và đường WebSocket `/{processId}/{roomId}` đến game. Web/API/game cùng origin ở localhost:8080. Không `docker compose --scale game=N` với proxy này: request có thể đến process không giữ room.

Docker chưa có trên máy tác giả nên cần CI hoặc máy có Docker chạy đủ pipeline trước khi công bố deployment đã đạt. Images pin minor cho Node/Postgres/Redis/Nginx; production phải pin digest sau security scan. Backend hiện dùng tsx từ dependency tree để chạy TS; chuyển sang compiled server bundle và production-only dependencies ở M1 để thu nhỏ image.

## Mức 1: private alpha 100–500 CCU

CDN + TLS ingress; API replicas stateless; managed PostgreSQL và Redis cùng region/private network. Game process có identity và địa chỉ route riêng. Colyseus `PUBLIC_ADDRESS` quảng bá endpoint đúng worker; ingress phải map endpoint đó đến đúng worker (ví dụ g-<worker>.game.example.com), có TLS wildcard và không round-robin nó sang worker khác. Shared RedisPresence/RedisDriver cho tất cả game workers; không dùng sticky cookie như giải pháp ownership.

Dùng start-up probe kiểm tra Redis, game liveness, readiness phân biệt RUNNING/DRAINING. Scaffold game chưa có readiness API; cần thêm trước orchestration. API đã có live/ready với DB probe. Ingress phải rate-limit matchmaking trước allocate room. Keepalive/ping nhỏ hơn LB idle timeout; đo idle connection bị cắt trên môi trường thật.

Secrets trong secret manager, database credentials riêng, TLS edge, private ingress tới backend. Restrict Origin cho matchmaking/WS; xác thực luôn bắt buộc. Thêm WAF/admission queue, distributed rate limit và moderation trước link public. Bundle/assets compression Brotli, immutable cache, budget tải đầu <5 MB compressed, mục tiêu 60 FPS desktop/30 FPS mobile trung bình; cần đo thiết bị thật.

## Mức 2: 1k → 3k → 10k CCU

Scale theo available seats, room count, event-loop lag, RSS và network egress; không chỉ CPU. Prewarm trước event. Allocation: chỉ nhận process RUNNING dưới capacity đã đo; room full không chuyển sang process khác. Scale-in chỉ drain worker, không kill room tùy ý. Maintain 30% reserve; scale-out có cooldown, không tạo room trên worker đang terminate.

Mỗi wave rollout tăng capacity mới trước, smoke join/game/reward, canary 5% new rooms, theo dõi error/latency; giữ version cũ đến khi drain. Rollback route new rooms về version trước; không load state schema mới vào binary cũ. Stop rollout nếu join error >0,5%, tick p99 >25 ms kéo dài 5 phút hoặc disconnect bất thường tăng.

## Sự cố

- Redis lỗi: ngừng new admission, existing room tiếp tục simulation nếu không cần registry; báo degrade. Sau restore cần reconcile live process/room và stale registry, tránh đăng ký hai owner.
- PostgreSQL lỗi: health ready API fail; không cấp guest persisted/reward; không thông báo thưởng thành công trước commit. Hub có thể giữ room hiện tại, disable progression.
- Worker chết: reconnect có hạn rồi trả lobby/new room. Không kỳ vọng state RAM phục hồi. Xử lý run pending qua reconcile.
- DB restore: restore vào instance mới, verify ledger/inventory/count, chuyển endpoint, kiểm tra outbox replay dedupe. Không restore thẳng đè lên DB đang chạy.

## Release gates

CI build/unit + bot + Docker integration; dependency/license scan; schema dry-run trên backup staging; restore drill; test 2 workers đúng route; reconnect/drain/kill; dashboard/alerts; moderation + privacy policy; assets có nguồn quyền sử dụng; load test 10k với raw results và cấu hình tài nguyên. Thiếu gate nào thì ghi rõ private alpha, không gọi production-ready release.
