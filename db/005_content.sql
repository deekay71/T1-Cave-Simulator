-- Nội dung admin chỉnh được (danh sách video màn hình lớn, bộ quest): mỗi phần một tài liệu JSON.
CREATE TABLE content_docs (
  key text PRIMARY KEY CHECK (key IN ('videos', 'quests')),
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'admin'
);
