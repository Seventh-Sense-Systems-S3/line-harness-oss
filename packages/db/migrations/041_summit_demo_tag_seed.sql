-- Migration 041: SUMMIT_20260517 tag seed (live-demo on 2026-05-17)
-- See: docs/specs/summit-live-demo-20260517.md (handler in apps/worker/src/routes/webhook.ts)
--
-- 目的: 2026-05-17 サミット参加者専用の友達追加 URL（ref_code=SUMMIT_20260517）からの
-- 追加者だけに SUMMIT_20260517 タグを自動付与し、デモ配信を会場内に閉じ込めて
-- 誤爆防止する。Worker は固定 UUID を参照する（"発火"=IGNITION_発火 と同じ運用）。
--
-- Tag UUID は固定 — worker 側 (apps/worker/src/routes/webhook.ts) の
-- SUMMIT_TAG_ID 定数と一致させること。
--
-- 冪等: INSERT OR IGNORE。本 migration は何度実行しても安全。

INSERT OR IGNORE INTO tags (id, name, color, created_at)
VALUES (
  'b2d4a3f0-5e17-4cae-9a01-20260517a001',
  'SUMMIT_20260517',
  '#F59E0B',
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);
