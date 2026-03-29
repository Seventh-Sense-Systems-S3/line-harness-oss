-- MIZUKAGAMI 即時診断セッション管理テーブル
-- 状態遷移: AWAITING_BIRTHDAY → CALCULATING → RESULT_SHOWN

CREATE TABLE IF NOT EXISTS mizukagami_sessions (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'AWAITING_BIRTHDAY',
  birthday TEXT,
  diagnosis_result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mizukagami_user
  ON mizukagami_sessions(line_user_id, created_at DESC);
