# GW明け挽回キャンペーン E案 正本 (2026-05)

> **SSOT**: このファイルは `scripts/seed-gw-recovery-scenarios.py` の `CAMPAIGN_SCHEDULE` 定数の
> 背景・根拠・戦略を記録する正本ドキュメント。  
> 日程・価格などの実行値は seed script の `CAMPAIGN_SCHEDULE` dict が真の参照先。
> git commit = 変更履歴 = Audit Trail。

---

## キャンペーン概要

| 項目 | 値 |
|------|-----|
| 名称 | GW明け挽回キャンペーン |
| 期間 | 2026-05-09 〜 2026-05-26 |
| 対象 | 水鏡診断ユーザー（5世代 合計約700人） |
| 主軸 | Soul-resonant Marketing（水鏡診断データ × LINE個別配信） |
| 戦略バージョン | E案（2026-05-04 確定） |

---

## E案スケジュール（確定版）

### チャレンジ LIVE 3日間

| Day | 日程 | テーマ |
|-----|------|--------|
| Day 1 | 5/20(火) 21:00 | **WHY** — なぜ今 分身AI なのか。子竜ジャーニー × AI ツールブームの闇 × Soul-resonant AI カテゴリー宣言 |
| Day 2 | 5/21(水) 21:00 | **WHAT** — 6コース全体（人体錬成メタファー）+ TruthSphere 儀式 |
| Day 3 | 5/22(木) 21:00 | **HOW + BUY** — 8幕構成（135分）。3階建て価格提示 |

### 個別審査

| 項目 | 内容 |
|------|------|
| 期間 | 5/23(水) 〜 5/25(金) |
| フォーマット | ZOOM 15分（子竜が直接担当） |
| 件数見込み | 12〜20件 |
| 締切 | 5/25(日) 23:59 |

### 配信タイムライン

| 配信日 | シナリオ | 対象 |
|--------|----------|------|
| 5/9(土) | S01 水鏡完走 190人 | 水鏡_完了タグ |
| 5/10(日) | S02 途中止まり 47人 / S03 VIP 4人 | 手動 enroll |
| 5/11(月) | S04 中盤離脱 64人 / S05 第3世代 40人 | タグ自動 |
| 5/12(火) | S06 第2世代 229人 / S07 VIP 5人 / S08 TikTok 15人 | タグ自動 + 手動 |
| 5/14(木) | S09 全員 → チャレンジ前日リマインド | broadcast |
| 5/16(土) | S10 全員 → サミット翌日 + Day3 告知 | broadcast |
| 5/18(月) | S11 水鏡_未着手 107人 | タグ自動 |
| 5/24(土) | S12 個別審査_未予約（動的） | タグ自動 |
| 5/26(月) | S13 IGNITION ダウンセル（動的） | タグ自動 |

---

## 価格体系

| 商品 | 価格 | 提供条件 |
|------|------|---------|
| 分身AI構築 本講座 | ¥198,000 | Day 3 後 個別審査クリア |
| IGNITION 3日チャレンジ | ¥9,800 | S13 ダウンセル |
| IGNITION 無料枠 | ¥0 | S02 対象者限定（お詫び）|

---

## E案採択経緯

- **A〜D案**: 複数の日程案を検討
- **E案決定 (2026-05-04)**: チャレンジ LIVE を 5/20-22 に設定。理由: 水鏡診断期間（5/9-5/18 配信後）→ LIVE 参加動機形成 → 高質リードが個別審査に来る設計
- 一人称転換 (俺→私) 2026-05-03 確定。叡智の通訳者ポジショニング

---

## Soul-resonant テンプレート変数

```
{{display_name}} / {{name}}
{{metadata.soul_name}}                    — 魂の名前（例: 燿旋）
{{metadata.soul_no}}                      — 1〜216
{{metadata.innate_spiral}}                — 先天螺旋
{{metadata.acquired_system}}              — 後天系統
{{metadata.manifested_wisdom}}            — 顕現叡智（漢字1文字）
{{metadata.soul_message}}                 — card_data.closing_message（最重要）
{{metadata.mizukagami_user_word_1}}       — 診断中フレーズ1番目
{{metadata.mizukagami_user_word_2}}       — 診断中フレーズ2番目
{{metadata.mizukagami_user_word_3}}       — 診断中フレーズ3番目
{{metadata.mizukagami_user_words_joined}} — 全フレーズ「・」区切り
{{metadata.mizukagami_concern}}           — 診断中の課題
```

---

## 次のアクション（URL差込待ち）

- [ ] `[動画①URL]` — 5/6-7 撮影後に INSERT UPDATE
- [ ] `[チャレンジ申込URL]` — 同上
- [ ] `[IGNITION無料URL]` — 同上
- [ ] `[IGNITION有料URL]` — 同上

URL 差込後に D1 UPDATE → is_active=1 化（配信日前日に子竜が UI で確認）

---

## 参照

- seed script: `scripts/seed-gw-recovery-scenarios.py` (`CAMPAIGN_SCHEDULE` dict が日程の実行値 SSOT)
- Notion 戦略 SSOT: `🚀 GW明け挽回キャンペーン 2026-05` (`3552619c-6bd3-817e-92e2-e9a5bc1967cf`)
- Notion コンセプト: 分身AI講座 v3.1 (`3562619c-6bd3-8158`)
- 水鏡診断データ: Supabase `sap_mizukagami_line_sessions` (project: `eizsilomeafyhftuvqst`)
