# Trang quản trị

`/admin.html` (cùng site với game). Đăng nhập bằng `ADMIN_TOKEN` của API; mã chỉ được nhớ trong tab đó.

## Bật

- Đặt `ADMIN_TOKEN` cho API (chuỗi ngẫu nhiên ≥ 16 ký tự). Không đặt thì `/v1/admin/*` trả 503 và trang quản trị không đăng nhập được.
- `GAME_ADMIN_URL`: cổng quản trị nội bộ của server game (Compose: `http://game:9100`). Cổng này không được public ra Internet.
- Nơi lưu: bảng `content_docs` (`db/005_content.sql`) khi có `DATABASE_URL`; không thì tệp `CONTENT_FILE` (mặc định `.data/content.json`, đã gitignore).

## Các mục

| Mục | Làm được gì |
|---|---|
| Tổng quan | Số người online, cao nhất và số lượt vào từ lúc server game chạy, người chơi theo khu vực (hang lớn, từng hang nhỏ, đường hầm, điện thờ), danh sách đang online (tên, khu vực, đang ngồi hay đi, thời gian), 12 lượt vào gần nhất. Tự làm mới mỗi 5 giây. Không có IP hay tài khoản; số liệu mất khi server game khởi động lại. |
| Video màn hình | Danh sách clip cho 3/4 bên trái màn hình lớn: tiêu đề, loại (đăng quang / highlight / khoảnh khắc buồn / khác), năm, tệp, thời lượng, bật/tắt, thứ tự. "Tải thử và đo thời lượng" kiểm tra tệp tải được (kể cả CORS) và tự điền thời lượng. |
| Quest T1 | Bộ quest của Hang Quest: tên, mô tả, 1–5 câu mỗi quest, 4 đáp án, đáp án đúng, giải thích. Bật/tắt, đổi thứ tự, thêm/xóa. Không sửa được id của quest đã có (đổi id làm mất tiến độ của người chơi). |

"Về mặc định" bỏ bản đã lưu của mục đó. Người chơi nhận nội dung mới trong vòng 3 phút (hoặc khi tải lại trang).

## Video

Mỗi clip là **một link YouTube** hoặc **một tệp video**.

**Link YouTube** (`youtube.com/watch?v=…`, `youtu.be/…`, `shorts/…`):
- Phát bằng trình phát nhúng chính thức của YouTube. Trình duyệt không cho game đọc hình của trình phát này, nên game đặt trình phát nằm sau khung hình 3D, bẻ phối cảnh cho khớp ô video của màn hình, và để ô đó trong suốt (`world/youtubeScreen.ts`). Người hay vật đứng trước màn hình vẫn che được video.
- Chỉ hiện khi ô video trên màn hình của người chơi rộng và cao ít nhất 200 px (mức tối thiểu YouTube yêu cầu cho trình phát nhúng): đứng xa thì màn hình chỉ hiện tiêu đề và dòng "Lại gần màn hình để xem clip".
- Video phải cho phép nhúng. Nút "Kiểm tra YouTube và đo thời lượng" hỏi YouTube rồi phát thử ngay trong trang quản trị và tự điền thời lượng. Một số kênh (ví dụ LoL Esports) chặn phát nhúng trên địa chỉ http hoặc IP nội bộ (lỗi 150) nhưng cho phép qua https: hãy kiểm tra qua link https của game.
- Không có cách vẽ video YouTube thành texture, và tải video về từ YouTube trái điều khoản của YouTube.

**Tệp video** (mp4 H.264 hoặc webm, nên 1280×720):
- Vẽ thẳng lên màn hình như một texture, thấy được từ mọi khoảng cách.
- Đặt tệp vào `apps/web/public/videos/` rồi điền `/videos/ten-tep.mp4`. Bản chơi thử chạy bằng `scripts/local-host.mjs` đọc thẳng thư mục này (không cần build lại); bản Docker gắn thư mục này vào Nginx qua `compose.public.yaml`. Hoặc dán link https tới tệp trên máy chủ cho phép CORS.

**Chung:**
- Clip tự phát không tiếng. Người chơi bật tiếng bằng nút "Tiếng màn hình" (chỉ mình nghe, nhỏ dần khi đi xa, tắt khi rời hang lớn).
- Khi mọi clip đang chiếu đều có thời lượng, danh sách chạy theo đồng hồ nên mọi người xem cùng một khoảnh khắc (lệch vài giây khi mạng chậm); thiếu thời lượng thì mỗi máy tự phát lần lượt.
- Twitch / Facebook / TikTok không dùng được.
- Clip phát sóng thuộc bản quyền của đơn vị tổ chức / phát sóng: thư mục `videos/` được gitignore, người host tự chịu trách nhiệm về tệp mình dùng.
