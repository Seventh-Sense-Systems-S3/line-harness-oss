# line-harness-oss — Project Context (Layer 1)

> Cloudflare Worker + LINE Bot CRM。Hono フレームワーク、D1 データベース。

## TTS 発音修正（必読）

子竜が Fish Audio TTS（子竜クローン音声）の読み誤りを報告したら、**即座に** Supabase `tts_pronunciation_rules` テーブルに INSERT する。コードデプロイ不要。最大5分で Railway TTS が自動リフレッシュする。

### 発動パターン

| 子竜の発言 | 解釈 | アクション |
|-----------|------|-----------|
| `"XXXはYYYと読む"` | surface=XXX, reading=YYY | 即INSERT |
| `"XXXの読みがおかしい"` | 正読みを確認 | 確認後INSERT |
| `"XXXをYYYと言ってる"` | surface=XXX, reading=正読み | 即INSERT |
| `/fix-tts XXX YYY` | スキル経由 | スキル実行 |

### INSERT クエリ（Supabase project: `eizsilomeafyhftuvqst`）

```sql
INSERT INTO tts_pronunciation_rules (surface, reading, source)
VALUES ('{surface}', '{reading}', 'fix-tts-skill')
ON CONFLICT (surface) DO UPDATE SET
  reading = EXCLUDED.reading,
  source = 'fix-tts-skill',
  created_at = now();
```

### アーキテクチャ（Ambient TTS Fix — δ型鬼洗練 proposal `86627778`）

- **データ層**: Supabase `tts_pronunciation_rules` — 唯一の正本
- **PC層**: `/fix-tts` スキル or 自然言語で CC に言う → Supabase INSERT
- **モバイル層**: LINE Bot `!fix {surface} {reading}` → 同テーブルに INSERT
- **TTS層**: Railway fish-audio-tts が5分ごとに hot-reload

---

## プロジェクト概要

- **Worker**: `apps/worker/` — Cloudflare Worker (Hono)
- **DB**: D1 (`wrangler.toml` 参照)
- **デプロイ**: `wrangler deploy`
- **ローカル**: `wrangler dev`

## 重要ファイル

- `apps/worker/src/routes/webhook.ts` — LINE Bot webhook ハンドラ
- `apps/worker/src/index.ts` — ルート登録・スケジューラ
- `apps/worker/src/services/` — ビジネスロジック

## 開発ルール

- TypeScript strict mode
- `wrangler deploy` 前に `wrangler types` で型再生成
- LINE Messaging API の署名検証は必ず行う
- `OWNER_LINE_USER_ID` ガードを admin コマンドに付ける
