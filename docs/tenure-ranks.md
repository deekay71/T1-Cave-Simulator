# Hạng thâm niên — Cư dân hang
## Thiết kế
| Hạng | Mốc đề xuất | Ngoại hình/đạo cụ | Emote |
|---|---|---|---|
| 01 Rách rưới | bắt đầu | áo vá, dép, ngồi thùng | ôm đầu / thở dài |
| 02 Xe lăn | 7 ngày hoạt động | xe lăn chắp vá, khăn cổ cũ | lăn tới chỗ bạn / vẫy |
| 03 Thở oxy | 30 ngày hoạt động | ghế cũ, bình oxy, ống nhỏ | nhìn TV rồi tựa lưng |
| 04 Liệt giường | 90 ngày hoạt động | giường sắt, chăn vá, tay giữ điện thoại | kéo chăn / giơ tay chào |

Mốc là đề xuất để thử nghiệm, chưa được chốt cân bằng. Một ngày tính khi có phiên ≥5 phút và tương tác hợp lệ; tối đa một ngày/UTC date, thông báo giờ reset rõ. Server quyết định, không dựa clock client. Không yêu cầu chuỗi ngày liên tục, không mất hạng vì nghỉ. Không tăng tiến độ bằng spam hoặc thanh toán.

## Bình đẳng gameplay
Mọi hạng có tốc độ, hit/collision capsule, quyền vào phòng và minigame bằng nhau. Hạng mở skin/đạo cụ, không ép người chơi dùng. Có chế độ avatar đứng cơ bản cho mọi người. Xe lăn có chuyển động bánh cosmetic; oxygen prop gắn vào phương tiện; giường là skin phương tiện di chuyển phóng đại trong hub. Khi vào minigame dùng avatar gameplay tiêu chuẩn, giữ badge/hạng và lựa chọn cosmetic hỗ trợ. Không để giường rộng khóa đường đi.

## Authority và dữ liệu
API/game gửi activity events đã xác thực; backend dedupe account/date, tăng active_days trong transaction; rank là hàm của active_days và rank_rules_version. Grant cosmetic theo UNIQUE(account_id,reward_key), dùng ledger hoặc bảng entitlement riêng. Client chỉ nhận rank/cosmetic IDs; không gửi “tôi đã ở hang 90 ngày”. Foundation chưa implement.

## UX / nội dung
Hạng là câu chuyện hư cấu về fan phản ứng thái quá sau trận, không phải chẩn đoán hoặc thứ bậc giá trị con người. Không áp hạng dựa tình trạng sức khỏe thật; không thu dữ liệu sức khỏe. Có tùy chọn ẩn đạo cụ y tế của bản thân bằng avatar cơ bản. Chat vẫn chịu moderation để tránh dùng hạng công kích người thật.

## Acceptance
Không double-credit khi retry; reconnect không nhân active day; thay rules có version; không khóa skin đã mở khi nghỉ; admin chỉ grant/revoke có audit; mọi skin đi cùng tuyến và tham gia minigame; 30 người dùng giường không gây tắc collision; mobile UI vẫn nhìn được prompt.

## Ưu tiên triển khai trong repo
Phần hình ảnh theo concept v3. Quyết định backend theo tech-decisions.md: Colyseus 0.18, React UI, quiz/minigame là activity trong cùng room hub; nội dung alpha là file versioned trong repo. Bản chơi thử hiện tại theo playtest.md, chưa triển khai toàn bộ GDD.
