-- Dormant only. Apply through the normal migrator after approval; never enables sessions.
ALTER TABLE progression_wallets ADD COLUMN xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0);
ALTER TABLE daily_checkins DROP CONSTRAINT daily_checkins_reward_check;
ALTER TABLE daily_checkins ADD CONSTRAINT daily_checkins_reward_check CHECK (reward >= 0);
-- Full question snapshots preserve grading when the curated bank is updated later.
CREATE TABLE progression_quiz_attempts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  day date NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  questions jsonb NOT NULL CHECK (jsonb_array_length(questions) = 5),
  answers jsonb,
  correct smallint CHECK (correct BETWEEN 0 AND 5),
  xp_earned integer CHECK (xp_earned BETWEEN 0 AND 50),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_at timestamptz,
  UNIQUE (account_id, day, ordinal),
  CHECK ((submitted_at IS NULL AND answers IS NULL AND correct IS NULL AND xp_earned IS NULL)
    OR (submitted_at IS NOT NULL AND answers IS NOT NULL AND jsonb_array_length(answers) = 5 AND correct IS NOT NULL AND xp_earned = correct * 10))
);
CREATE UNIQUE INDEX progression_quiz_active_day ON progression_quiz_attempts(account_id, day) WHERE submitted_at IS NULL;
INSERT INTO catalog_items (id, category, asset_key, display_name, description, price) VALUES
  ('cave-ragged-shorts', 'avatar', 'tl_char_fan_headband_v01', 'Quần đùi rách', 'Phong cách cư dân hang.', 25),
  ('cave-tshirt', 'avatar', 'tl_char_fan_cap_red_v01', 'Áo thun', 'Áo thun cổ vũ.', 50),
  ('cave-tank-top', 'avatar', 'tl_char_fan_headband_v01', 'Áo ba lỗ', 'Mát mẻ trong hang.', 60),
  ('cave-jersey', 'avatar', 'tl_char_fan_hoodie_white_v01', 'Áo đấu', 'Sắc đỏ ngày thi đấu.', 100),
  ('cave-glasses', 'avatar', 'tl_char_fan_cap_red_v01', 'Kính cổ vũ', 'Diện mạo fan đeo kính.', 75),
  ('cave-keyboard', 'avatar', 'tl_char_fan_headband_v01', 'Bàn phím cầm tay', 'Đạo cụ cổ vũ trong hang.', 125);
