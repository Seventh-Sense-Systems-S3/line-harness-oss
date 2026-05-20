-- Migration 025: friends に複合 UNIQUE (line_account_id, line_user_id) を導入
--
-- 目的:
--   現状 friends.line_user_id は単独 UNIQUE。これが OSS の multi-account 設計と乖離している。
--   同一ユーザーが複数の LINE 公式アカウントに友達追加した場合、後発の webhook が
--   先発 friend の line_account_id を上書きしてしまい、本番/DEV アカウント間で
--   friend が「奪い合い」になる構造的バグの根本原因。
--
-- 参照: proposal 2a5f0274 (構造美 5→10)
-- インシデント: 2026-05-11 friends.line_user_id 単独UNIQUE retroactive UPDATE 事件
--
-- 動作:
--   1. SQLite は ALTER TABLE で UNIQUE 制約を直接 drop できないため、テーブル再生成方式で実施
--   2. line_account_id を NOT NULL 化（NULL データは事前救済済み前提）
--   3. (line_account_id, line_user_id) 複合 UNIQUE を導入
--   4. PRIMARY KEY id を保持するため、13個の FK 参照テーブルとの整合性は維持される
--
-- 事前条件 (必ず確認すること):
--   SELECT COUNT(*) FROM friends WHERE line_account_id IS NULL;  -- 0 でなければ中止
--
-- application 側併走改修 (本 migration 単体では不十分):
--   - packages/db/src/friends.ts: getFriendByLineUserId に lineAccountId 必須化
--   - packages/db/src/friends.ts: upsertFriend に lineAccountId 必須化、INSERT 句に bind 追加
--   - packages/db/src/friends.ts: updateFriendFollowStatus に lineAccountId 必須化
--   - apps/worker/src/routes/webhook.ts: 2ステップ upsert アンチパターン解消 (line 174 + 189-194)
--   - 他 lookup 呼び出し点: liff.ts / forms.ts / tracked-links.ts / meet-callback.ts ほか
--   - 詳細: SubAgent application 棚卸結果 (proposal 2a5f0274 添付)

-- Step 1: 外部キー制約を一時無効化 (テーブル再生成中の FK 整合性チェック回避)
PRAGMA foreign_keys = OFF;

-- Step 2: 新スキーマで friends_new を作成
CREATE TABLE friends_new (
  id                    TEXT PRIMARY KEY,
  line_user_id          TEXT NOT NULL,
  display_name          TEXT,
  picture_url           TEXT,
  status_message        TEXT,
  is_following          INTEGER NOT NULL DEFAULT 1,
  user_id               TEXT,
  score                 INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ref_code              TEXT,
  metadata              TEXT NOT NULL DEFAULT '{}',
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL,
  ig_igsid              TEXT,
  UNIQUE(line_account_id, line_user_id)
);

-- Step 3: データ移行 (NULL line_account_id は事前条件違反なので除外して安全策)
INSERT INTO friends_new
SELECT id, line_user_id, display_name, picture_url, status_message,
       is_following, user_id, score, created_at, updated_at,
       ref_code, metadata, line_account_id, first_tracked_link_id, ig_igsid
FROM friends
WHERE line_account_id IS NOT NULL;

-- Step 4: 旧テーブルを drop し、新テーブルを rename
DROP TABLE friends;
ALTER TABLE friends_new RENAME TO friends;

-- Step 5: インデックス再作成 (テーブル再生成で消えるため)
CREATE INDEX idx_friends_line_user_id ON friends (line_user_id);
CREATE INDEX idx_friends_user_id ON friends (user_id);
CREATE INDEX idx_friends_ig_igsid ON friends (ig_igsid);
-- 複合 UNIQUE が line_account_id を含むため、line_account_id 単独 INDEX は不要

-- Step 6: FK 制約を再有効化
PRAGMA foreign_keys = ON;
