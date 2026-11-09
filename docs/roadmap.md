# Milestones và technical spike

Ước lượng để lập kế hoạch, không phải cam kết lịch; giả định một lập trình viên full-stack cùng hỗ trợ art/QA. Tiến theo acceptance gates thay vì chỉ theo tuần.

| Mốc | Phạm vi | Acceptance | Ước lượng |
|---|---|---|---|
| M0 foundation | Repo, greybox, room/input/chat, schema, Docker, spike | Build + unit + bot 31 client; container CI được xác minh | 2–4 ngày; phần local đã làm |
| M1 private alpha | Identity lâu dài, reconnect UI, moderation, collision, metrics, two-worker routing, drain | 100–500 CCU; mất mạng/crash có UX rõ; DB restore; không mất reward | 1–2 tuần |
| M2 vòng chơi | Nhặt tinh thể, hub→game→hub, results/inventory/reward transaction | replay kết quả không nhân thưởng; 2–8 người cùng chơi | 1–2 tuần |
| M3 chất lượng | Mobile controls, avatar/assets gốc, friend invite, rooms riêng, accessibility | FPS/load budget trên thiết bị mục tiêu; private-room ACL test | 1–2 tuần |
| M4 capacity | Admission queue, fleet autoscale, soak và chaos | 1k, 3k, 10k CCU đạt SLO và có báo cáo tái lập | Theo kết quả đo |

## Spike A đã có: kiểm chứng transport + authoritative movement

Chạy `npm run spike` với 31 bots: JWT sai bị từ chối, room không quá 30 ghế, xuất hiện room thứ hai, input vượt biên bị từ chối, chat được broadcast, input 20 Hz, ping RTT, avatar nằm trong biên. Báo cáo JSON trong reports/spike.json. Số lượng BOT và duration cấu hình qua env, nhưng tăng BOTS lên 10000 trên laptop không tương đương distributed load test.

## Spike B cần làm: mạng và lifecycle

2 browser clients + 30 bots, network impairment 50/150/300 ms, mất gói mô phỏng bằng ngắt WS, offline 5/20 giây; đo reconnect success/seat expiry, duplicate avatar, stale input. Đo smoothing; quyết định có thêm snapshot buffer/prediction. Hai worker dùng Redis chung, route riêng: join bất kỳ matchmaker nhưng WS phải tới owner; kill owner, verify recovery UX và không reward double. Test drain trong 120 giây.

## Spike C: chương trình chứng minh 10k CCU

1. Dedicated staging cùng topology production, không chạy load generator chung máy game. Ghi commit, dependency lock, image digest, region, instance CPU/RAM/network, replica count, DB/Redis size.
2. Workload đại diện: 70% di chuyển 20 Hz, 20% idle vẫn connected, 10% minigame; chat trung bình 1/30s/client, emote 1/20s, churn 2%/phút, reconnect burst 10%. Đây là test profile cần điều chỉnh theo telemetry alpha.
3. Ramp 100→500→1k→3k→10k; giữ mỗi bậc 15 phút, 10k 60 phút, soak 6 giờ ở tải định mức; spike 1,5× admission trong 5 phút. Không tiếp tục tăng tải nếu SLO fail.
4. Thu Prometheus histograms cho join/tick/event-loop, connection/byte counters, CPU/RSS/GC, network, Redis latency, DB pool/lock, outbox lag. SDK ping là app RTT, không thay cho server tick histogram. Load generator phải dưới 60% CPU để tránh tạo bottleneck giả.
5. Kill một worker, Redis failover, DB restart, rolling deploy và rollback. Đo số session mất, thời gian hồi phục, reward invariant và số room orphan.
6. Gate: 10k đồng thời thực tế suốt plateau, join ≥99,5%, p95 join <2s, p95 app RTT <150ms ở mạng đại diện, tick p99 <25ms, không OOM/reward trùng; báo cả chi phí theo giờ và bytes/client/s. Báo cáo phải có raw metrics, không chỉ screenshot CCU.

Deliverable M4: scripts distributed runners, dashboard export, results CSV/JSON, báo cáo bottleneck, capacity/worker, quy tắc autoscale và chi phí ước lượng dựa trên cấu hình đã đo. Foundation hiện chưa tạo những số liệu này.

## Việc tiếp theo cụ thể

Ưu tiên chạy CI Docker → thêm reconnect/lifecycle integration tests → metrics/readiness/drain → two-worker routing spike → guest upgrade/login + moderation → minigame. Chưa cần shopping/economy phức tạp hoặc cross-region world.
