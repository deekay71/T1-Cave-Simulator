-- Dormant foundation: migration alone does not enable sessions or grant rewards.
-- Guest sessions are not account recovery. Clearing the cookie loses guest access.
CREATE TABLE guest_sessions (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX guest_sessions_account_idx ON guest_sessions(account_id);
CREATE INDEX guest_sessions_expiry_idx ON guest_sessions(expires_at);

CREATE TABLE progression_wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_checkin_day date,
  streak integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
  total_checkins integer NOT NULL DEFAULT 0 CHECK (total_checkins >= 0)
);

ALTER TABLE catalog_items ADD COLUMN display_name text NOT NULL DEFAULT '';
ALTER TABLE catalog_items ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE catalog_items ADD COLUMN price integer NOT NULL DEFAULT 0 CHECK (price >= 0);
INSERT INTO catalog_items (id, category, asset_key, display_name, description, price) VALUES
  ('fan-cap-red', 'avatar', 'tl_char_fan_cap_red_v01', 'Mũ đỏ cổ vũ', 'Bộ fan mũ đỏ.', 50),
  ('fan-hoodie-white', 'avatar', 'tl_char_fan_hoodie_white_v01', 'Hoodie trắng', 'Bộ fan hoodie trắng.', 100),
  ('fan-headband', 'avatar', 'tl_char_fan_headband_v01', 'Băng đô quyết tâm', 'Bộ fan đeo băng đô.', 150);

ALTER TABLE reward_ledger DROP CONSTRAINT reward_ledger_source_type_check;
ALTER TABLE reward_ledger ADD CONSTRAINT reward_ledger_source_type_check
  CHECK (source_type IN ('minigame', 'quiz', 'discovery', 'event', 'admin', 'daily_checkin'));

CREATE TABLE daily_checkins (
  account_id uuid NOT NULL REFERENCES accounts(id),
  day date NOT NULL,
  streak integer NOT NULL CHECK (streak > 0),
  reward integer NOT NULL CHECK (reward > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, day)
);

-- One receipt per idempotency key. A cosmetic can be owned once, never transferred.
CREATE TABLE progression_purchases (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  idempotency_key uuid NOT NULL,
  item_id text NOT NULL REFERENCES catalog_items(id),
  cost integer NOT NULL CHECK (cost >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, item_id)
);
