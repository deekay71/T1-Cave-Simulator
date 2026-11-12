# Vận hành kiểm duyệt cho bản chơi thử

## Phạm vi đã có

- Server kiểm tra tên khi xác thực vào phòng và nội dung trước khi phát chat. Bộ lọc từ khóa nhỏ trong `packages/security/src/moderation.ts` không phải mô hình hiểu ngữ cảnh và không bảo đảm chặn mọi cách lách.
- Bộ lọc xét từng từ nên từ tục không dấu vẫn bị chặn trong câu có dấu. Giữ dấu tiếng Việt để không đánh đồng “đủ”, “dù”, “đeo” với từ tục. Cho phép “Du” vì đây là tên và âm tiết thông thường; “đụ” vẫn bị chặn. Có kiểm tra một số ký tự ẩn, chữ full-width, leetspeak và chữ tách rời.
- Mỗi phòng giữ tối đa 50 tin gần nhất trong RAM để đối chiếu `messageId`. Report chỉ chấp nhận tin còn trong bộ đệm và của tài khoản khác, rồi lưu bản sao bằng chứng vào PostgreSQL `moderation_reports` nếu có `DATABASE_URL`. Không tự lưu toàn bộ lịch sử chat; bộ đệm mất khi phòng đóng.
- Report bị giới hạn tại phòng (burst 2, nạp lại trong 60 giây) và theo tài khoản (5 lần/giờ). Xem `apps/game/src/HubRoom.ts` để biết điều kiện chính xác.
- **Chưa có dashboard, hàng đợi thông báo cho moderator, tự động xử lý report, hoặc cơ chế đồng bộ SQL → Redis.** Bảng `sanctions` là nơi ghi quyết định/audit; chỉ chèn SQL vào bảng này **chưa chặn người chơi**.
- Kiểm tra hiệu lực hiện tại đọc khóa Redis theo `SECURITY_NAMESPACE` (mặc định `te-liet:dev`): `<namespace>:sanction:mute:<account_id>` hoặc `<namespace>:sanction:ban:<account_id>`. Local không có Redis dùng RAM trong từng tiến trình, không có đường quản trị chung và mất dữ liệu khi restart. Production yêu cầu Redis.

## Quy trình thủ công được hỗ trợ

Chỉ người vận hành được cấp quyền DB/Redis thực hiện. Dùng kết nối quản trị đã xác thực và đúng môi trường; không dán mật khẩu/connection URL vào chat, issue hay tài liệu. Các lệnh dưới đây là mẫu thao tác, không tự chạy cùng ứng dụng.

### 1. Xem report và bằng chứng

```sql
SELECT id, reporter_id, target_id, room_id, reason, evidence, created_at
FROM moderation_reports
WHERE status = 'open'
ORDER BY created_at ASC
LIMIT 50;
```

Đọc bằng chứng trong `evidence.message`, kiểm tra đúng tài khoản đích và ngữ cảnh. Không coi số lượng report là bằng chứng vi phạm. Bằng chứng có nội dung chat và định danh nội bộ: chỉ chia sẻ cho người xử lý có thẩm quyền, không đưa vào analytics hoặc log công khai.

### 2. Ghi nhận quyết định trong SQL

Ví dụ dưới dùng biến `psql` `report_id` và `operator_id` do người vận hành đặt thành UUID thật; `operator_id` phải là tài khoản đã tồn tại trong `accounts`. Mẫu tạo **mute 15 phút** sau khi đã xem xét, không phải chính sách phạt mặc định. Chỉ thay loại/thời hạn khi quyết định đã được duyệt.

```sql
BEGIN;
WITH target_report AS (
  SELECT id, target_id
  FROM moderation_reports
  WHERE id = :'report_id'::uuid AND status = 'open' AND target_id IS NOT NULL
  FOR UPDATE
), applied AS (
  INSERT INTO sanctions (id, account_id, kind, expires_at, reason, created_by)
  SELECT gen_random_uuid(), target_id, 'mute', now() + interval '15 minutes',
         'Reviewed report ' || id::text, :'operator_id'::uuid
  FROM target_report
  RETURNING id, account_id, kind, expires_at
)
UPDATE moderation_reports AS report
SET status = 'resolved', handled_by = :'operator_id'::uuid, handled_at = now()
FROM applied
WHERE report.id = :'report_id'::uuid
RETURNING applied.id AS sanction_id, applied.account_id, applied.kind, applied.expires_at;
COMMIT;
```

Phải có đúng một dòng trả về; nếu không, kiểm tra lại report/trạng thái, không tự chọn tài khoản khác. Thay reason bằng giải thích quyết định phù hợp trong thao tác thực tế. Trường hợp không có vi phạm: cập nhật report thành `dismissed`, cùng `handled_by`/`handled_at`, không tạo sanction.

### 3. Áp dụng hiệu lực Redis và xác minh

SQL và Redis không nằm trong cùng một transaction. Sau khi ghi SQL, tổng hợp **mọi sanction còn hiệu lực** cho tài khoản và từng loại để không rút ngắn một lệnh phạt cũ. Dùng biến `account_id` là UUID đích đã xác minh:

```sql
SELECT kind, count(*) AS active_count,
       bool_or(expires_at IS NULL) AS indefinite,
       ceil(extract(epoch FROM max(expires_at)))::bigint AS expires_epoch
FROM sanctions
WHERE account_id = :'account_id'::uuid
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
GROUP BY kind;
```

Trong phiên Redis CLI quản trị của **cùng môi trường/namespace**, thay các placeholder bằng giá trị đã kiểm tra:

```text
SET <namespace>:sanction:<kind>:<account_id> 1 EXAT <expires_epoch>
GET <namespace>:sanction:<kind>:<account_id>
TTL <namespace>:sanction:<kind>:<account_id>
```

Nếu `indefinite` là true, dùng `SET <key> 1` không TTL. Nếu loại đó không còn sanction hiệu lực, dùng `DEL <key>` sau khi đã xác nhận; không xóa chỉ vì một sanction riêng lẻ hết hạn. Dùng timestamp tuyệt đối từ SQL, không đặt lại nguyên thời lượng sau mỗi lần retry. `GET` phải trả về `1`, TTL dương cho lệnh có thời hạn hoặc `-1` cho vô thời hạn. Nếu Redis không hỗ trợ `EXAT`, không tự bỏ thời hạn; dùng công cụ quản trị tương thích hoặc báo blocker.

Mute được kiểm tra trước khi gửi chat; ban được kiểm tra khi vào phòng, khi chat và trong vòng kiểm tra khoảng 3 giây của phòng. Xác minh bằng tài khoản test khi phù hợp. Redis lỗi hoặc không đúng namespace là **chưa áp dụng xong**, kể cả report đã chuyển `resolved`: ghi lại bước lỗi và hoàn tất đồng bộ thủ công. Không coi trạng thái report là bằng chứng lệnh phạt đã hoạt động.

### 4. Thu hồi hoặc xử lý sự cố

- Thu hồi: đặt `revoked_at = now()` trên đúng sanction trong SQL, giữ lại audit. Tính lại tập hiệu lực theo bước 3 rồi cập nhật/xóa khóa Redis; không xóa một khóa còn được sanction khác yêu cầu.
- Redis restart/mất dữ liệu: các sanction SQL không tự khôi phục vào Redis. Đối chiếu các dòng chưa thu hồi/chưa hết hạn và khôi phục khóa trước khi coi kiểm duyệt đã sẵn sàng.
- SQL thành công nhưng Redis thất bại: retry bước đồng bộ sau khi kiểm tra kết quả hiện tại, không chèn thêm sanction trùng chỉ để thử lại.
- Chưa có job tự xóa bằng chứng, quy trình kháng nghị hoặc chính sách retention đã thực thi. Không hứa đã xóa dữ liệu chỉ vì thời hạn phạt đã hết.

## Kiểm tra trước buổi chơi thử

- Chạy `node --import tsx --test scripts/moderation.test.ts` và `npm run check`.
- Có người theo dõi report qua SQL và có quyền Redis phù hợp trong thời gian test. Không coi việc có nút report là có người đang trực xử lý.
- Kiểm tra lưu report bằng hai tài khoản test khi DB có sẵn, rồi thử mute/ban/thu hồi trên tài khoản test và xác nhận kết quả thực tế.
- Khi phiên khách bền vững chưa bật (mặc định), mỗi lần xin vé tạo một guest mới. Ngay cả khi bật tính năng này, xóa cookie vẫn có thể tạo guest khác. Sanction theo UUID không chống được việc đổi tài khoản; close-test code không thay thế quản lý danh tính. Chưa dùng baseline này làm bằng chứng đủ an toàn để mở public.
