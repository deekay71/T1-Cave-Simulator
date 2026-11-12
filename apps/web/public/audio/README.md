# Audio của điện thờ

Đặt tệp `shrine-entry.mp3` vào thư mục này (hoặc đặt biến `VITE_SHRINE_AUDIO_URL` lúc build) để người chơi nghe một đoạn audio khi bước vào điện thờ Faker. Chỉ người vừa bước vào nghe thấy; có nút tắt/bật ngay trong điện thờ.

Tệp audio **không nằm trong repo** (thư mục này được gitignore, trừ file README): bình luận trận đấu là nội dung có bản quyền của đơn vị phát sóng, nên người host tự chịu trách nhiệm về tệp mình dùng. Không có tệp thì tính năng tự tắt.

Gợi ý: MP3 mono 96–128 kbps, 10–25 giây, đã cân âm lượng; client phát ở 80 % âm lượng và tự làm mờ dần lúc vào/ra.
