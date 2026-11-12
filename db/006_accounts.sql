-- 006: tài khoản thành viên (đăng ký nhanh bằng mật khẩu, đăng nhập Google) và phiên đăng nhập.
-- Thành viên là accounts.kind = 'member'. Google: accounts.auth_subject = 'google:<sub>' (đã UNIQUE).
-- Phiên chỉ lưu SHA-256 của token; token nằm trong cookie HttpOnly của trình duyệt.
ALTER TABLE accounts ADD COLUMN role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'));
ALTER TABLE accounts ADD COLUMN email text;
ALTER TABLE accounts ADD COLUMN last_login_at timestamptz;

CREATE TABLE account_passwords (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  username varchar(24) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,23}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%')
);

CREATE TABLE account_sessions (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX account_sessions_account_idx ON account_sessions(account_id);
CREATE INDEX account_sessions_expiry_idx ON account_sessions(expires_at);
