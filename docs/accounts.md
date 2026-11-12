# Tài khoản và đăng nhập

Màn đăng nhập của game có ba cách vào:

| Nút | Là gì | Lưu gì |
|---|---|---|
| **Google** | Nút chính thức của Google. Lần đầu tạo tài khoản, các lần sau vào lại đúng tài khoản đó. | Mã người dùng Google (`sub`), tên hiển thị, email (khi Google xác nhận). |
| **Tài khoản** | Đăng nhập hoặc tạo nhanh bằng tên đăng nhập + mật khẩu (≥ 8 ký tự). Tên trong hang tùy chọn. | Tên đăng nhập, chuỗi băm scrypt của mật khẩu, tên hiển thị. |
| **Chơi thử** | Khách như trước, chỉ cần tên. | Không có tài khoản. |

Đăng nhập xong là vào hang luôn. Phiên giữ 30 ngày bằng cookie `tl_session` (HttpOnly, SameSite=Lax, Secure khi chạy https); tải lại trang vẫn còn đăng nhập. Rời hang thì màn đăng nhập hiện "Chào …", "Vào hang" và "Đăng xuất".

Khi close test có `INVITE_CODE`, mã mời chỉ cần lúc **tạo** tài khoản (kể cả lần đầu bấm Google); tài khoản đã có thì đăng nhập không cần mã.

Trong game, người có tài khoản được giới hạn chat của thành viên (`LIMITS.chat.member`), và mỗi tài khoản chỉ ở một chỗ: vào ở tab khác thì tab cũ thoát.

## Bật đăng nhập Google

Cần một **OAuth client ID** loại Web application (không cần client secret, không có trang callback):

1. Vào [Google Cloud Console](https://console.cloud.google.com/), tạo hoặc chọn một project.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding): tên app, email hỗ trợ. Audience: External. Khi app còn ở chế độ Testing thì chỉ những email được thêm vào "Test users" mới đăng nhập được; bấm **Publish app** để ai cũng đăng nhập được (chỉ xin scope cơ bản `openid email profile` nên không cần Google duyệt).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized JavaScript origins**: thêm đúng từng origin người chơi mở game, không có dấu `/` cuối:
   - `https://<tên-miền-của-game>`
   - link tunnel đang dùng, vd. `https://xxxx.trycloudflare.com`
   - khi dev: `http://localhost` và `http://localhost:5190`

   Google không nhận địa chỉ IP LAN (`http://192.168…`): người chơi qua LAN vẫn dùng được Tài khoản và Chơi thử, chỉ nút Google báo lỗi.
5. Copy **Client ID** (dạng `123…-abc….apps.googleusercontent.com`) vào biến `GOOGLE_CLIENT_ID` của **API** rồi khởi động lại API. Client ID là thông tin công khai (trình duyệt nào cũng thấy), không phải bí mật.

Không đặt `GOOGLE_CLIENT_ID` thì nút Google hiện "Chưa bật".

**Tunnel nhanh của Cloudflare đổi link mỗi lần khởi động lại.** Mỗi lần đổi phải thêm link mới vào Authorized JavaScript origins (có hiệu lực sau vài phút). Muốn cố định thì dùng tên miền riêng hoặc named tunnel.

Cách xác minh: trình duyệt nhận một ID token từ Google rồi gửi lên `POST /v1/auth/google`; API kiểm tra chữ ký bằng khóa công khai của Google (`googleapis.com/oauth2/v3/certs`, có cache), issuer `accounts.google.com`, audience là đúng `GOOGLE_CLIENT_ID`, và hạn dùng (`apps/api/src/accounts/google.ts`).

## Tài khoản quản trị

Web không có cách nào tự nâng quyền. Tạo trên máy chạy API:

```bash
npm run admin:account -- admin
```

- Tạo tài khoản `admin` có quyền quản trị (hoặc, nếu tên đã có, cấp quyền quản trị, đặt mật khẩu mới và đăng xuất mọi phiên cũ của nó).
- Mật khẩu ngẫu nhiên **không in ra màn hình**: chỉ ghi vào `.data/admin-login.txt` (đổi bằng `--out <tệp>`), quyền 0600. Đăng nhập ở `/admin.html`, đổi mật khẩu ở tab **Tài khoản**, rồi xóa tệp.
- Tự đặt mật khẩu: `printf '%s' 'mat-khau' | npm run admin:account -- admin --password-stdin`.
- `--name "Tên"` đặt tên hiển thị.
- Có `DATABASE_URL` thì ghi vào Postgres; không thì vào `ACCOUNTS_FILE`. API đang chạy tự đọc lại tệp, không cần khởi động lại.

Đăng nhập bằng `ADMIN_TOKEN` vẫn còn (mục "Dùng mã quản trị" ở trang đăng nhập) cho script và lúc khẩn cấp.

## Lưu ở đâu

| | Có `DATABASE_URL` | Không có (chơi thử trên máy cá nhân) |
|---|---|---|
| Tài khoản | `accounts` (`kind = 'member'`, `role`, `email`, `last_login_at`), `account_passwords` | Tệp `ACCOUNTS_FILE` (mặc định `.data/accounts.json`, quyền 0600, đã gitignore) |
| Phiên | `account_sessions` (chỉ SHA-256 của token) | Cùng tệp |

Migration: `db/006_accounts.sql` (`npm run db:migrate`). Không bao giờ lưu mật khẩu hay token gốc.

## Bảo vệ

- Mật khẩu: scrypt (N = 2^15, r = 8, p = 1) với muối riêng; so sánh theo thời gian hằng. Tên đăng nhập không tồn tại vẫn tốn một lần băm, nên thời gian phản hồi không lộ ai có tài khoản.
- Đăng ký, đăng nhập, Google, đổi mật khẩu: tối đa 10 lần mỗi phút cho một IP.
- Mọi request đổi trạng thái (kể cả ghi ở trang quản trị bằng cookie) phải có header `X-T1-Request: 1` và Origin là `WEB_ORIGIN` hoặc chính host đang phục vụ game (`apps/api/src/accounts/session.ts`).
- Đổi mật khẩu đăng xuất mọi phiên khác của tài khoản đó.

## API

| Route | |
|---|---|
| `GET /v1/auth/me` | `{ account \| null, google: clientId \| null, inviteRequired }` |
| `POST /v1/auth/signup` | `{ username, password, name?, invite? }` |
| `POST /v1/auth/login` | `{ username, password }` |
| `POST /v1/auth/google` | `{ credential, invite? }` → `{ account, created }` |
| `POST /v1/auth/logout` | |
| `POST /v1/auth/password` | `{ current, next }` |
| `POST /v1/auth/ticket` | vé vào game cho tài khoản đang đăng nhập (`trust: 1`) |
| `GET /v1/admin/accounts` | danh sách tài khoản (chỉ quản trị; không có chuỗi băm) |
