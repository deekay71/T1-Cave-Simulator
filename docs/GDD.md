# GDD — Tê Liệt
## 1. Tầm nhìn
Một hang trú thua trận cho fan esports: vào hang sau trận, gặp bạn, ngồi quanh lửa trại, ôn lại lịch sử và chơi các hoạt động ngắn. Cảm xúc chủ đạo: mệt mỏi, tự trào hài đen, cùng nhau chịu trận và nhớ ngày huy hoàng. Không cổ vũ công kích tuyển thủ hoặc cộng đồng khác.

Desktop browser trước; mobile sau khi có touch controls và profiling. Người chơi chọn tên/avatar, vào public room 20–30 người; không cần hiểu lịch sử T1 để tham gia. Một phiên mục tiêu 5–15 phút, vào được hoạt động đầu trong 60 giây.

## 2. Trụ cột sản phẩm
- Gặp gỡ: avatar dễ nhận diện, chat/emote, ghế ngồi và điểm tụ họp.
- Ký ức: Hall of Fame có nguồn, đọc ngắn, khám phá cùng bạn.
- Chơi nhẹ: luật giải thích dưới 20 giây, trận 1–3 phút, không pay-to-win.
- Bản sắc riêng: hang đá nâu đất, áo fan đỏ–đen–trắng, hình khối low-poly và đồ vật gốc.

## 3. Vòng chơi
Vào hang → gặp người khác → chọn chat/khám phá/minigame → nhận dấu mốc hoặc vật phẩm trang trí → quay lại hub. Không buộc xem quảng cáo, trả tiền hay hoàn thành quiz mới được dùng chat. Progression đầu tiên là badge/đồ trang trí không có lợi thế thi đấu; chưa thiết kế tiền thật hoặc giao dịch giữa người chơi.

## 4. Không gian
| Khu | Vai trò | Quy mô thiết kế |
|---|---|---|
| Cửa hang | Spawn, hướng dẫn 3 bước, tìm bạn | 4×4 m, không chặn lối |
| Lửa trại | Điểm hội tụ, ghế, emote | bán kính 4 m, tối đa 8 ghế |
| Sinh hoạt | Bàn dài, lều, beanbag, bảng meme | khoảng 8×6 m |
| Minigame | Arcade và cổng sang room riêng | khoảng 8×6 m |
| Vách ký ức | Timeline, memory wall gallery, xem nguồn | hốc bên 8×4 m; không cần hầm bảo tàng riêng |
| Góc quiz | Hoạt động nhóm nhỏ | 2–8 ghế, room riêng khi chơi |

Hub chính đường kính 30 m, trần cao 10–14 m, lối chính ≥2 m; Vách ký ức nằm ở hốc bên. Gameplay map thực tế cần collision/navmesh và camera blockers, khác với greybox phẳng ban đầu. Giữ ít nhất một lối quay về hub từ mỗi khu, không dùng hốc cụt bắt người chơi reset.

## 5. Điều khiển và tương tác
WASD đi; chuột điều khiển camera trong bản đích; E tương tác trong khoảng 2 m; Esc đóng panel; Enter chat; nút emote luôn truy cập được. Mobile: joystick trái, xoay camera phải, nút tương tác lớn ≥44 px. UI timeline có chế độ danh sách 2D tương đương cho người khó di chuyển 3D. Rebind phím, giảm chuyển động, tắt bloom, chỉnh nhạc và cỡ chữ là tiêu chí release.

Các trạng thái tương tác: ngoài tầm → focus → prompt → requested → accepted/denied → active → exit. Server quyết định ghế có trống và pickup có hợp lệ; client chỉ hiển thị yêu cầu. Người mất kết nối không giữ ghế vô hạn.

## 6. Hoạt động
**Chat/emote:** chat room, không global mặc định; mute/report/block, giới hạn spam; emote wave/cheer/laugh, không animation xúc phạm nhắm đích.

**Nhặt tinh thể:** 2–8 người, countdown 3 s, chơi 60 s, kết quả 10 s; server spawn và xác thực nhặt, không tin điểm client. Không va chạm đẩy người khác ở MVP.

**Quiz ký ức:** 2–8 người, 5 câu ×15 s, giải thích 5 s sau mỗi câu. 100 điểm/câu đúng, không cộng tốc độ để giảm lợi thế mạng. Server giữ đáp án; mỗi user một câu trả lời. Câu bị phát hiện sai được rút khỏi pool bằng content version.

**Memory wall:** chia sẻ tối đa 280 ký tự; mặc định pending review, chỉ approved được hiển thị. Không ảnh upload ở bản đầu. Có report, audit, xóa/anonymize theo quy trình.

## 7. Phạm vi phát hành
P0: guest/account, hub, movement, chat/emote, moderation, Vách ký ức đọc timeline, metrics/recovery.
P1: minigame tinh thể, quiz, cosmetics, invite/private rooms.
P2: ký ức cộng đồng, event calendar, trang trí hang, nội dung theo mùa.
Không MVP: voice, open UGC assets, trading, seamless world 10k người trong một scene.

## 8. Nội dung và vận hành
Lịch sử được quản lý như dữ liệu có phiên bản, nguồn, reviewer, quyền media và thời điểm xác minh. Không cập nhật thành tích bằng suy đoán. Badge khám phá ghi completion sau tương tác hợp lệ, không thưởng vô hạn khi mở/đóng cùng plaque. Không đặt tên vật phẩm bằng tên tuyển thủ khi chưa có quyết định sử dụng phù hợp.

## 9. Đo lường và nghiệm thu
Theo dõi first meaningful interaction, join success, session duration, tỷ lệ quay lại, người dùng report/mute, tỉ lệ đọc timeline/quiz completion; tránh lưu chat text trong analytics. Event có user pseudonymous, consent/retention theo chính sách sản phẩm.

Acceptance P0: 31 người được chia instance, vào/rời/reconnect không nhân avatar; chat hiển thị an toàn; report đến moderation; 6 mốc lịch sử có nguồn; memory wall gallery không tự bật âm thanh; panel đọc được bằng bàn phím; không khóa người chơi khi nguồn ngoài lỗi. Performance/SLO và test 10k theo architecture/roadmap, không suy ra từ số người tối đa của một room.

## Hạng thâm niên và tông hài v3
Đọc tenure-ranks.md: ngày hoạt động hợp lệ do server ghi nhận; mốc 0/7/30/90 ngày là đề xuất cân bằng, không phải số liệu lịch sử fan. Bốn hạng chỉ mở cosmetics/đạo cụ. Không dùng số trận thua thực tế làm điều kiện mở khóa; không khuyến khích treo máy hay phải online nhiều giờ. Người chơi chọn bất kỳ bộ đã mở, có thể dùng avatar đứng bình thường. Cốt truyện thâm niên không khẳng định khuyết tật là thất bại; trò đùa nằm ở phản ứng quá mức với kết quả esports.

## Ưu tiên triển khai trong repo
Phần hình ảnh theo concept v3. Quyết định backend theo tech-decisions.md: Colyseus 0.18, React UI, quiz/minigame là activity trong cùng room hub; nội dung alpha là file versioned trong repo. Bản chơi thử hiện tại theo playtest.md, chưa triển khai toàn bộ GDD.
