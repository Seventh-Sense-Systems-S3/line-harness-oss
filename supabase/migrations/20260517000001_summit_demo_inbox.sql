-- Supabase migration: summit_demo_inbox (phoenix-memory-os / project_id=eizsilomeafyhftuvqst)
--
-- 目的:
--   2026-05-17 サミットライブデモ用、SUMMIT_20260517 タグ持ち友達からの自由文を
--   Hermes (子竜の分身 AI) が読みやすい形で保存する inbox。
--   Worker (apps/worker/src/routes/webhook.ts) が SUMMIT タグ持ち friend の
--   text message 受信時に POST する。
--
-- 既存「発火」(IGNITION_発火) パターンとの差分:
--   - 発火 = D1 (line-harness の friend_tags + messages_log) のみ
--   - サミット = D1 (タグ付与) + Supabase (自由文 inbox)
--     Hermes は Anthropic Claude を呼ぶため Supabase 経由が自然
--
-- サミット後 (2026-05-18 以降) は本テーブルを保持したまま運用停止する
-- (履歴・DNA 抽出材料として残す)。

CREATE TABLE IF NOT EXISTS summit_demo_inbox (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  line_user_id        TEXT         NOT NULL,
  friend_id           UUID,
  text                TEXT         NOT NULL,
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  tag_classification  TEXT,                   -- pain / vision / confusion / specific (Hermes が後で更新)
  hermes_reply        TEXT,
  hermes_replied_at   TIMESTAMPTZ,
  summit_id           TEXT         NOT NULL DEFAULT 'SUMMIT_20260517'
);

CREATE INDEX IF NOT EXISTS idx_summit_demo_inbox_received_at
  ON summit_demo_inbox (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_summit_demo_inbox_line_user_id
  ON summit_demo_inbox (line_user_id);

CREATE INDEX IF NOT EXISTS idx_summit_demo_inbox_pending
  ON summit_demo_inbox (received_at DESC)
  WHERE hermes_replied_at IS NULL;

COMMENT ON TABLE summit_demo_inbox IS
  'SUMMIT 2026-05-17 live demo: free-text messages from SUMMIT_20260517-tagged friends. Hermes reads and replies.';
