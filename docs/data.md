# PostgreSQL và quyền sở hữu dữ liệu

Migration `db/001_initial.sql` có transaction, chạy qua advisory-lock migrator. Schema v1 chỉ khởi tạo lần đầu, không sửa migration đã phát hành; bổ sung migration v2 về sau. Compose chờ migration thành công rồi mới chạy API.

| Nhóm bảng | Vai trò | Đã nối runtime? |
|---|---|---|
| accounts | guest/member identity, display name | Guest insert khi DATABASE_URL được đặt |
| profiles, sessions | avatar/settings, refresh hash/revoke | Chưa |
| room_templates, room_instances | cấu hình và lịch sử instance | Chưa; Redis là live registry |
| friendships, blocks | social graph/ẩn tương tác | Chưa |
| catalog_items, inventory | vật phẩm và quantity | Chưa |
| minigame_runs/results | kết quả authoritative, mỗi user/run duy nhất | Chưa |
| reward_ledger, outbox | idempotency và dispatch sau commit | Chưa |
| leaderboard | view tổng hợp theo season/game | Chưa |
| moderation_reports, sanctions | report evidence/mute/ban | Chưa |

UUID do backend sinh, FK và CHECK ở DB bảo vệ dữ liệu. Room ID runtime dạng text vì Colyseus không dùng UUID. Không ghi vị trí avatar từng tick vào PostgreSQL. Redis keys phải namespace theo env/region/build khi triển khai nhiều fleet. Redis registry có thể tái tạo; account/inventory không được chỉ đặt trong Redis.

Reward transaction dự kiến: insert result; insert reward_ledger với UNIQUE(run_id,account_id,reward_key); chỉ khi insert mới thành công mới upsert inventory tăng lượng, cập nhật leaderboard và insert outbox. Cả chuỗi trong một transaction; rollback nếu bất kỳ bước nào lỗi. Worker outbox dùng `FOR UPDATE SKIP LOCKED`, delivery at-least-once; consumer dedupe theo outbox id. Reconcile run treo khi worker chết, không tự thưởng cho run chưa hoàn thành.

Tách DB role migrator và runtime; runtime không có DDL trong production. Pool khởi đầu 10 connections/API process; dùng PgBouncer và tổng budget theo replica. Backup managed PostgreSQL với PITR, thử restore hàng tháng. RPO/RTO đề xuất 5 phút/60 phút phải được xác nhận bằng diễn tập. Expand/contract schema để rollback code không cần down migration phá dữ liệu.

Retention cần chốt trước public: guest bỏ hoang 30 ngày; room audit 30 ngày; report evidence 30–90 ngày theo quy trình support; ledger giữ theo yêu cầu sản phẩm. Đây là đề xuất, chưa có scheduled cleanup. Không hard-delete account có FK/ledger trước khi thiết kế anonymization. Không có bảng lưu toàn bộ chat mặc định nhằm tránh thu thập dư thừa.
