# Bản chơi thử Hang trú thua v0.2

## Chạy local
Node 26, `npm ci`. Ba terminal từ gốc repo: `npm run dev:api`, `npm run dev:game`, `npm run dev:web`. Mở http://localhost:5173 trong hai tab, đặt hai tên. Dev keys tự tạo trong `.dev-keys/` (gitignored). Không đặt DATABASE_URL/REDIS_URL nếu chỉ thử RAM. Dữ liệu guest và tiến trình không bền vững.

## Có thể thử
- Vào room tối đa 30 người; thấy người chơi khác và vị trí đồng bộ.
- WASD/mũi tên hoặc nút hướng trên màn hình. Camera theo avatar.
- Chat 3 tin/10s với guest, nút chào đồng cảnh và animation cánh tay đơn giản.
- Đi gần Vách ký ức/giường/TV rồi E; hoặc mở panel ký ức/thâm niên bằng toolbar. Escape đóng panel.
- Bối cảnh low-poly: đá cao, đất/đá vụn, lửa/đuốc, ghế, bạt, giường, bình oxy, TV DEFEAT.
- Rời hang và vào lại, test hai tab nhận cùng tin nhắn.

## Chưa có
Minigame/quiz thực thi, ngồi ghế có reservation, cosmetics xe lăn/giường có thể chọn, điểm thâm niên, OAuth/Better Auth, moderation/report UI, model GLB, logo asset được cấp quyền, camera collision đầy đủ và art polish. Góc thâm niên nói rõ đây là thiết kế chưa mở khóa. Vách ký ức là nội dung đọc thử với link nguồn, không CMS.

## Kiểm chứng
Build TypeScript/Vite/server và 14 unit tests. Bot 31 client/10 giây: room 30+1, 0 lỗi, rate limit đúng, replacement tuần tự qua. Hai browser tabs đã vào cùng room, nhận chat/emote và di chuyển. Xem reports/spike.json khi chạy lại. Docker/multi-worker/WAN/mobile thật chưa kiểm chứng.

## Phạm vi phát hành
Bản local để review gameplay và bố cục, chưa deploy public. Trước public cần xử lý P1 trong review-2026-11-09.md. Mục tiêu tiếp: hoạt động nhặt tinh thể trong cùng hub, test room lifecycle và persistence/abuse prevention.
