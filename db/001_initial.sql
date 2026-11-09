-- 001: schema khởi tạo. Migrator (scripts/migrate.ts) bọc mỗi file trong một transaction,
-- nên file không tự BEGIN/COMMIT và không tự tạo schema_migrations.
-- File này chưa chạy ở môi trường nào nên được sửa thẳng một lần (docs/tech-decisions.md, 2.4).
-- Bảng session/OAuth sẽ do Better Auth tạo ở migration sau (T7), nên không còn bảng sessions tự viết.

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  display_name varchar(24) NOT NULL CHECK (length(trim(display_name)) > 0),
  kind text NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest', 'member')),
  auth_subject text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  avatar_key text NOT NULL DEFAULT 'default',
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE room_templates (
  id text PRIMARY KEY,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 30),
  map_version text NOT NULL
);
INSERT INTO room_templates VALUES ('hub_v1', 30, 'cave-greybox-v1');

CREATE TABLE room_instances (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES room_templates(id),
  region text NOT NULL,
  process_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text
);
CREATE INDEX room_started_idx ON room_instances(started_at);

-- Một dòng cho mỗi cặp bạn (user_low < user_high), để A–B và B–A không cùng tồn tại.
CREATE TABLE friendships (
  user_low uuid NOT NULL REFERENCES accounts(id),
  user_high uuid NOT NULL REFERENCES accounts(id),
  requested_by uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high),
  CHECK (requested_by IN (user_low, user_high))
);
CREATE INDEX friendships_high_idx ON friendships(user_high);

CREATE TABLE blocks (
  account_id uuid REFERENCES accounts(id),
  blocked_id uuid REFERENCES accounts(id),
  PRIMARY KEY (account_id, blocked_id),
  CHECK (account_id <> blocked_id)
);

CREATE TABLE catalog_items (
  id text PRIMARY KEY,
  category text NOT NULL,
  asset_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE inventory (
  account_id uuid REFERENCES accounts(id),
  item_id text REFERENCES catalog_items(id),
  quantity integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (account_id, item_id)
);

CREATE TABLE minigame_runs (
  id uuid PRIMARY KEY,
  room_id text,
  game_key text NOT NULL,
  rules_version integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'aborted'))
);

CREATE TABLE minigame_results (
  run_id uuid REFERENCES minigame_runs(id),
  account_id uuid REFERENCES accounts(id),
  score bigint NOT NULL CHECK (score >= 0),
  PRIMARY KEY (run_id, account_id)
);

-- Sổ thưởng cho mọi nguồn (minigame, quiz, badge khám phá, sự kiện, admin).
-- Khóa duy nhất chống cấp trùng khi retry; source_id là id của run/câu hỏi/sự kiện tương ứng.
CREATE TABLE reward_ledger (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  source_type text NOT NULL CHECK (source_type IN ('minigame', 'quiz', 'discovery', 'event', 'admin')),
  source_id text NOT NULL,
  reward_key text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_type, source_id, reward_key)
);

CREATE TABLE leaderboard (
  season text NOT NULL,
  game_key text NOT NULL,
  account_id uuid REFERENCES accounts(id),
  score bigint NOT NULL CHECK (score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, game_key, account_id)
);
CREATE INDEX leaderboard_rank_idx ON leaderboard(season, game_key, score DESC, account_id);

CREATE TABLE moderation_reports (
  id uuid PRIMARY KEY,
  reporter_id uuid REFERENCES accounts(id),
  target_id uuid REFERENCES accounts(id),
  room_id text,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  handled_by uuid REFERENCES accounts(id),
  handled_at timestamptz
);

CREATE TABLE sanctions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('mute', 'ban')),
  expires_at timestamptz,
  reason text NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX sanctions_account_idx ON sanctions(account_id, expires_at);

CREATE TABLE outbox (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox(id) WHERE processed_at IS NULL;
