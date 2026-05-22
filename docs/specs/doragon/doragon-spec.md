# 🐉 DORAGON — AI Marketing Conductor for LINE — RFC仕様書 v1.0

> **canonical_code**: `doragon`
> **SSOT**: このファイル (GitHub) + Notion Product Registry row
> **作成日**: 2026-05-11
> **作成者**: Claude Code (project-genesis スキル経由)
> **元設計**: ai_design_proposal `3bbeef62` (鬼洗練 v3 Round 3, 構造美10/事業価値10)
> **supersedes**: ai_design_proposal `6b2bf871` (旧 Segmented Broadcast Architecture v1)

> ⚠️ **重要**: このプロダクトを実装する Claude Code / Cowork は必ず先にこのページを読むこと。
> 関連する既存プロダクト「LINE Harness CRM (`line-harness`)」と混同しないこと。

---

## ⚠️ 命名マップ（混同防止）

| 識別子 | 用途 | 注意点 |
|---|---|---|
| **`doragon`** (canonical_code) | コード/DB/API/会話の唯一ID | 変更禁止 |
| **DORAGON** (英字表記) | ブランド名 / マーケティング表記 | 英字一本表記。漢字/カナ表記は使わない |
| **AI Marketing Conductor for LINE** (descriptor) | 機能説明 | 検索流入用キーワード |

### ⚠️ 混同注意リスト

| 紛らわしい名前 | 識別 | 区別方法 |
|---|---|---|
| **LINE Harness CRM** (`line-harness`) | 既存基盤プロダクト | DORAGON は line-harness の **上位レイヤー** で、テナント分離+AI Conductor+Visual UI を持つ独立 SaaS |
| **水鏡 (mizukagami)** | 既存診断 LINE Bot | DORAGON は配信側、mizukagami は診断側。DORAGON が mizukagami の友達追加機構を**流用**することがある |
| **UTAGE システム** | 既存ファネル基盤 | UTAGE = form/payment 専用 (8原則 #3)。DORAGON は配信オートメーション専用、決済はしない |
| **Soul Agent Platform** | 既存マルチエージェントPF | Soul Agent はAI開発基盤、DORAGON は SaaS プロダクト。レイヤーが違う |

---

## 1. Executive Summary（概要）

**DORAGON は、日本人マーケッターが LINE で AI に話しかけるだけで配信ファネルが組める、世界初の AI-Native Marketing Automation SaaS。**

業界デファクトの Customer Journey Builder (Mailchimp / HubSpot / ActiveCampaign) は「マーケティング知識がある人」前提で複雑性が高く、ノンプログラマーには使いきれない。一方で AI機能を持つ海外ツールは文章生成止まりで、Journey 設計まで踏み込んだ製品は世界的に空白である。

DORAGON はこの空白を埋める。`Personas / Snippets / Deliveries / Journeys` の4つの直交プリミティブを基盤に、Gemini 2.0 Flash による AI Conductor Layer が「自然言語 → Journey 自動生成」を実現する。場当たり配信もシナリオ配信も同じプリミティブで表現できるため、「今日の予告を投げる → 後からシナリオ化」という子竜のリアル運用フローが自然に成立する。

ターゲットは、LINE公式アカウントを運用する個人事業主・中小マーケター・コンサル受講生（30人〜1000人規模を想定）。月額 2万円以下の SaaS として展開し、初期は子竜本人が dogfooding で洗練、Phase 4 以降に受講生 → 一般市場に展開する。

---

## 2. Problem Statement（解決する問題）

### 2-1. 顧客課題

| 課題 | 現状の痛み |
|---|---|
| **使いきれない** | LINE自動化ツール (L Step / Lステップ等) は機能豊富だが、マーケティング知識ギャップ + UI複雑性で素人が触れない |
| **Journey 設計が高度** | Customer Journey Builder Canvas ですら「マーケティング知識がある人」前提 |
| **AI機能が浅い** | HubSpot/Mailchimp の AI機能は**文章生成止まり**。Journey 設計には踏み込んでいない |
| **日本語×LINE×AI が空白** | 国内 LINE自動化ツールは AI 統合が弱く、海外ツールは LINE 特化していない |

### 2-2. 競合空白象限 (世界初の根拠)

| プロダクト | LINE特化 | AI Co-pilot | Journey 自動生成 | 日本語 | 価格帯 |
|---|---|---|---|---|---|
| L Step (国内) | ✅ | ❌ | ❌ | ✅ | 中 |
| Lステップ (国内) | ✅ | ❌ | ❌ | ✅ | 中 |
| Mailchimp | ❌ | △ (文章のみ) | ❌ | △ | 中 |
| HubSpot | ❌ | △ (文章のみ) | ❌ | △ | 高 |
| ActiveCampaign | ❌ | △ (文章のみ) | ❌ | △ | 中 |
| Salesforce Marketing Cloud | ❌ | ✅ | △ | △ | 高 (エンタープライズ) |
| **DORAGON** | **✅** | **✅** | **✅** | **✅** | **低 (~2万円/月)** |

→ **完全空白の象限。世界初**。

### 2-3. 技術的根本原因 (鬼洗練 v3 Round 1 で発見)

既存 LINE Harness CRM は以下の構造的問題を持つ:

1. **broadcasts/scenarios の二元論**: 場当たり配信 (broadcasts) と シナリオ配信 (scenarios) が別テーブル別UIで、データ移動の経路がない → 「場当たり投げて後からシナリオ化」が不可能
2. **priority + is_default の線形決定木**: 4グループでは動くが 50グループで破綻
3. **メッセージの条件付き合成 hook なし**: G1+水鏡完了 のような複合条件が adhoc 実装になる
4. **SSOT の欠落**: 配信文章がスクリプトハードコード、管理画面から見えない

DORAGON はこれら全てを 4直交プリミティブで構造的に解消する。

---

## 3. Goals / Non-Goals

### Goals

- **G1**: 子竜本人が S3 完了時点 (約2-3週間) で日々の配信運用を DORAGON に完全移行できる
- **G2**: 受講生 5-10人が S4 完了時点でβ試験参加可能なレベルに達する
- **G3**: Workspace 単位のマルチテナント設計を最初から組み込み、将来の SaaS 公開で大規模リファクタを発生させない
- **G4**: AI コスト (Gemini Flash) を 1ユーザー月間 ~35円以下に抑え、月額 2万円で粗利 95%超を実現
- **G5**: 「自然言語 → Journey 自動生成」が Beginner Mode で動作し、マーケティング素人が初日に配信を完成できる

### Non-Goals

- **NG1**: ✗ 多言語対応 (Phase 1 では日本語のみ)
- **NG2**: ✗ 決済機能の自前実装 (Stripe + UTAGE form/payment に委譲)
- **NG3**: ✗ メールマーケティング統合 (Phase 1 では LINE 専用、Resend 統合は Phase D Issue #25 で別途)
- **NG4**: ✗ A/B テスト自動最適化 (Phase 2 / S5+)
- **NG5**: ✗ 子竜先生 Knowledge Base (Phase 2 / S5、シリュークローン側との関係を別途検討)
- **NG6**: ✗ 自前のリッチメッセージエディタ (Phase 1 では既存 Flex Message JSON 入力)

---

## 4. Target Users（ターゲットユーザー）

### Primary (Phase 1)

- **子竜本人**: dogfooding で洗練。1 Workspace × N LINE Accounts (7thSense / 水鏡 / 各案件)
- **コンサル受講生 (累計30人)**: マーケティング素人 / LINE運用は手動 / 月額1-2万円の支払意思あり

### Secondary (Phase 2 公開β以降)

- **個人事業主のマーケター**: 副業含めて1人で複数 LINE 公式運用
- **中小企業のマーケ担当**: 1人で複数ブランド運用
- **マーケティング代理店**: 顧客ごとに Workspace を切る (Slack/Notion の階層と同じ)

### ペルソナ詳細

| ペルソナ | 役割 | 困りごと | DORAGON の価値提案 |
|---|---|---|---|
| **マーケ素人 (Beginner)** | 個人事業主・副業 | 「何を、誰に、いつ送れば効果が出るか」がわからない | チャットで「来週金曜にイベント告知」と言うだけで AI が Journey を組む |
| **中級者 (Intermediate)** | 受講生・小規模法人 | 配信は組めるが、効果分析・最適化に時間取られる | AI 提案 + Visual Canvas で素早く編集、Strategy Suggestion で改善示唆 |
| **エキスパート (Expert)** | プロマーケター・代理店 | 既存ツールでは細かい制御が効かない | AI off / 完全手動制御モード。データ全公開 |

---

## 5. MVP機能定義

### Sprint 1 — Persona Library + Snippet Composition (3-4日)

| 機能 | 詳細 | GitHub Issue |
|---|---|---|
| F1.1: `personas` テーブル新設 | condition_expr (JSONLogic) で audience を表現 | TBD |
| F1.2: `snippets` テーブル新設 | applies_when_expr で条件付き合成可能 | TBD |
| F1.3: `tenant_id` 全テーブル追加 | 既存 friends/tags/broadcasts/scenarios/messages_log 等すべてに | TBD |
| F1.4: 既存 broadcasts に `persona_id` + `snippets_composition` 追加 | 段階移行のため後方互換維持 | TBD |
| F1.5: Beginner Mode 最小実装 (チャット → snippet 下書き生成) | Gemini Flash 経由 | TBD |
| F1.6: 4グループ移行 (現 personalized-broadcast-1.ts → DB) | G1/G2/G3/G4 を personas + snippets で表現 | TBD |

### Sprint 2 — Journey DAG + Intent Translation (4-5日)

| 機能 | 詳細 | GitHub Issue |
|---|---|---|
| F2.1: `journeys` + `deliveries` テーブル新設 | broadcasts/scenarios を統合する新プリミティブ | TBD |
| F2.2: `deliveries.parent_delivery_id` で DAG 構造表現 | 場当たり=単独ノード / シナリオ=連結グラフ | TBD |
| F2.3: 既存 broadcasts/scenarios → deliveries 段階移行 | 後方互換 view + 新規は新スキーマ | TBD |
| F2.4: Intent Translation (自然言語 → Journey 自動生成) | 「来週金曜に予告→3日後告知→CTA 4分岐」→ AI が DAG 構築 | TBD |
| F2.5: 場当たり→シナリオ昇格 API | `POST /api/deliveries/:id/attach-to-journey` | TBD |

### Sprint 3 — Visual Journey Builder Canvas (5-7日)

| 機能 | 詳細 | GitHub Issue |
|---|---|---|
| F3.1: React Flow ベースの Canvas Editor | ノード=delivery, 辺=parent_delivery_id | TBD |
| F3.2: Persona Library サイドパネル | drag & drop で delivery に persona 紐付け | TBD |
| F3.3: Snippet Composer | 条件付き合成プレビュー | TBD |
| F3.4: Strategy Suggestion (過去実績ベース提案) | broadcast_insights を AI が分析 | TBD |
| F3.5: プレビュー / 即時送信 / スケジュール | 3レイヤーUI 切替対応 | TBD |

### Sprint 4 — Multi-Tenant Activation (4-5日)

| 機能 | 詳細 | GitHub Issue |
|---|---|---|
| F4.1: `organizations` + `workspaces` テーブル | Slack/Linear 型 3階層 | TBD |
| F4.2: Workspace 切替 UI | ヘッダーに Workspace selector | TBD |
| F4.3: Onboarding Wizard | LINE登録 → 初期設定 → デモ配信完了 までの 30分体験 | TBD |
| F4.4: Demo Tenant + テンプレート | 受講生が即体験できるサンプル Persona / Snippet / Journey | TBD |
| F4.5: テナント別 Row-Level Security 強制 | Worker ミドルウェアで全クエリに `WHERE tenant_id=?` 強制 | TBD |

### Sprint 5 — Cross-Tenant Knowledge Base (3-4日, Phase 2)

| 機能 | 詳細 |
|---|---|
| F5.1: 子竜先生 Knowledge Base 設計 | シリュークローン側との関係を別途検討 |
| F5.2: 受講生からの質問インターフェース | 「子竜先生に質問」ボタン |

### Sprint 6 — SaaS 公開 (3-4日)

| 機能 | 詳細 |
|---|---|
| F6.1: Stripe 統合 (Customer = Organization) | サブスクリプション = Workspace 単位 |
| F6.2: 自動プロビジョニング | 新規登録 → Workspace 作成 → LINE Account 接続 |
| F6.3: 利用上限 + 従量課金 | AI 呼び出し回数 / 配信回数の上限制 |

### Sprint 7+ — 機能深堀り

- F7.1: Risk Detection (配信前ブロック/離脱予測)
- F7.2: A/B Suggester (配信前 2-3 パターン提案)
- F7.3: Performance Memory (過去実績の AI 学習)
- F7.4: Copy Generator (テナントごとの文体学習)

---

## 6. 技術アーキテクチャ

### 6-1. 4レイヤー構造

```
┌──────────────────────────────────────────────────────┐
│  [L0a] Cross-Tenant Knowledge Base (子竜先生)         │ ← Phase 2 (S5)
│        全テナントが相談可能な「教師AI」                 │
├──────────────────────────────────────────────────────┤
│  [L0b] Conductor Layer (per-tenant AI Co-pilot)       │ ← Phase 1 (S1〜)
│        Gemini 2.0 Flash via LiteLLM Proxy             │
│        Intent Translation / Copy Gen / Strategy        │
├──────────────────────────────────────────────────────┤
│  [L1] Personas / Snippets / Deliveries / Journeys     │ ← Phase 1 (S1-S2)
│        4直交プリミティブ (※ tenant_id でテナント分離)    │
├──────────────────────────────────────────────────────┤
│  [L2] LINE Harness Core (友達/タグ/配信/LINE Accounts)  │ ← 既存 (line-harness)
│        D1 + Hono + Cloudflare Worker                  │
└──────────────────────────────────────────────────────┘
```

### 6-2. マルチテナント階層 (Slack/Linear 型)

```
Organization (法人/個人, Stripe Customer)
  └── Workspace (tenant_id, 課金単位)
       ├── LINE Account A
       ├── LINE Account B
       └── Personas / Snippets / Journeys (workspace 内共有)
```

| 階層 | 責務 | 課金単位 |
|---|---|---|
| **Organization** | 課金・支払い・全体管理者 | Stripe Customer |
| **Workspace** | Persona Library / Snippets / Journeys のスコープ、tenant_id の本体 | Stripe Subscription Item |
| **LINE Account** | 物理的な LINE 公式アカウント | 制限なし (workspace 内で何個でも) |

**この設計の差別化価値**:
1. コンサル受講生が自分の顧客に再販する時、Organization 内に Workspace を増やすだけ
2. 1人で本業 / 副業 / クライアント案件を分離できる (個人事業主に刺さる)
3. Persona Library は Workspace 内共有 → 同じブランドの複数 LINE Account で再利用可能 (DRY)
4. 将来のエージェンシー機能拡張が自然 (Slack/Linear と同じ階層)

### 6-3. 3レイヤーUI (ユーザー成長曲線)

| Mode | UI | ターゲット | 切替条件 |
|---|---|---|---|
| **Beginner** | チャット入力のみ → AI 全自動 | マーケ素人 / 受講生最初期 | 初期デフォルト |
| **Intermediate** | AI 提案 + Visual Journey Builder Canvas で編集 | 受講生中級 / 子竜本人 | 子竜本人含めデフォルト運用モード |
| **Expert** | AI off / 完全手動制御 (D_v2 そのまま) | プロマーケッター / デバッグ用 | 設定で切替 |

同じデータ層を3つの UI で触れる。**ユーザーは成長すれば自然に Expert へ移行**。

### 6-4. 技術スタック

| レイヤー | 技術 | 既存 / 新規 |
|---|---|---|
| **エッジランタイム** | Cloudflare Worker (Hono) | 既存 (line-harness) |
| **DB** | Cloudflare D1 (SQLite) | 既存 (line-harness) |
| **キュー** | Cloudflare Queues | 既存 |
| **状態管理** | Durable Objects | 既存 |
| **AI Proxy** | LiteLLM Proxy (Railway) | 既存 (`https://7thsense-monorepo-production.up.railway.app`) |
| **AI モデル (主)** | **Gemini 2.0 Flash** | 新規採用 (コスト最適) |
| **AI モデル (副)** | Claude 4.6 / 4.7 | 高品質要時の routing 候補 |
| **UI** | React + React Flow + Tailwind | Visual Journey Builder Canvas 用 (新規) |
| **認証** | 既存 admin_users 拡張 + Workspace 切替 | 拡張 |
| **決済** | Stripe (Customer = Organization) | 新規 (S6) |
| **TTS** | Fish Audio (子竜文体は子竜のみ Phase 2) | 既存活用 |

### 6-5. 既存システムとの接続

| 既存システム | 接続方式 |
|---|---|
| **line-harness CRM** | 基盤として活用。`personas/snippets/deliveries/journeys` を line-harness の `friends/tags/messages_log` に重ねる |
| **mizukagami (水鏡 LINE Bot)** | 友達追加 → AI ヒアリング → tag 自動付与の機構を流用 |
| **broadcasts / scenarios (既存)** | 段階的に `deliveries / journeys` に統合移行 (S2)。後方互換 view を残す |
| **broadcast_insights (既存)** | Strategy Suggestion の学習元データとして読む |
| **UTAGE システム** | form/payment 専用 (8原則 #3)。DORAGON はタッチしない |
| **Soul Agent Platform** | 別レイヤー (AI 開発基盤)。DORAGON はプロダクト |

---

## 7. データモデル（主要テーブル設計）

### 7-1. organizations (S4 で導入、S1で tenant_id だけ全テーブル先行追加)

```sql
CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  stripe_customer_id TEXT,
  owner_user_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
```

### 7-2. workspaces (= tenant)

```sql
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  stripe_subscription_item_id TEXT,
  ui_mode         TEXT NOT NULL DEFAULT 'intermediate' CHECK (ui_mode IN ('beginner','intermediate','expert')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX idx_workspaces_organization_id ON workspaces(organization_id);
```

### 7-3. personas

```sql
CREATE TABLE personas (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,  -- = workspace_id
  name           TEXT NOT NULL,
  description    TEXT,
  condition_expr TEXT NOT NULL,  -- JSONLogic: {"and":[{"has_tag":"G1"},{"has_tag":"水鏡完了"}]}
  is_archived    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX idx_personas_tenant_id ON personas(tenant_id);
```

### 7-4. snippets

```sql
CREATE TABLE snippets (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  key                TEXT NOT NULL,  -- e.g. 'PS_BUNSHI', 'BASE_BODY'
  name               TEXT NOT NULL,
  body               TEXT NOT NULL,  -- {{name}}, {{persona.greeting}} 等のテンプレ変数
  applies_when_expr  TEXT,           -- JSONLogic: 条件付き合成 (NULL=常に含む)
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (tenant_id, key)
);
CREATE INDEX idx_snippets_tenant_id ON snippets(tenant_id);
```

### 7-5. journeys

```sql
CREATE TABLE journeys (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX idx_journeys_tenant_id ON journeys(tenant_id);
```

### 7-6. deliveries (broadcasts と scenario_steps を統合)

```sql
CREATE TABLE deliveries (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  journey_id          TEXT REFERENCES journeys(id) ON DELETE CASCADE,  -- NULL=場当たり配信
  parent_delivery_id  TEXT REFERENCES deliveries(id) ON DELETE SET NULL,  -- DAG 構造
  persona_id          TEXT REFERENCES personas(id) ON DELETE SET NULL,
  snippets_composition TEXT NOT NULL,  -- JSON: [{snippet_id, condition_override}]
  trigger_type        TEXT NOT NULL CHECK (trigger_type IN ('immediate','scheduled','tag_added','journey_advance')),
  trigger_config      TEXT,            -- JSON: スケジュール時刻 / トリガータグID等
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at        TEXT,
  sent_at             TEXT,
  total_count         INTEGER NOT NULL DEFAULT 0,
  success_count       INTEGER NOT NULL DEFAULT 0,
  line_account_id     TEXT,  -- 既存 line_accounts への参照
  line_request_id     TEXT,  -- LINE API insight 用
  aggregation_unit    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX idx_deliveries_tenant_id ON deliveries(tenant_id);
CREATE INDEX idx_deliveries_journey_id ON deliveries(journey_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
```

### 7-7. tenant_id を全既存テーブルに追加 (S1 で migration)

```sql
-- 全既存テーブルに tenant_id NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' (子竜固定) を追加
ALTER TABLE friends ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE tags ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE broadcasts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE scenarios ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE messages_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
-- (他全テーブル同様)
CREATE INDEX idx_friends_tenant_id ON friends(tenant_id);
-- (他全テーブル同様)
```

### 7-8. JSONLogic スキーマ (condition_expr / applies_when_expr)

```jsonc
// Persona.condition_expr の例
{
  "and": [
    { "has_tag": "G1_bunshi" },
    { "has_tag": "水鏡完了" }
  ]
}

// Snippet.applies_when_expr の例
{
  "or": [
    { "persona_is": "G1+水鏡完了" }
  ]
}

// サポート演算子
// has_tag(tag_id), persona_is(persona_id), has_metadata(key, value),
// and, or, not, eq, neq, in, gt, lt
```

---

## 8. API設計（主要エンドポイント）

### 8-1. Personas

```
GET    /api/personas                    # tenant 内の personas 一覧
POST   /api/personas                    # 新規作成
GET    /api/personas/:id                # 単一取得
PUT    /api/personas/:id                # 更新
DELETE /api/personas/:id                # 削除 (実体は archive)
GET    /api/personas/:id/preview        # condition_expr に該当する friends 一覧 (件数 + サンプル10件)
```

### 8-2. Snippets

```
GET    /api/snippets                    # tenant 内の snippets 一覧
POST   /api/snippets                    # 新規作成
GET    /api/snippets/:id                # 単一取得
PUT    /api/snippets/:id                # 更新
DELETE /api/snippets/:id                # 削除
POST   /api/snippets/:id/render         # body + applies_when_expr を friend_id 指定でプレビュー
```

### 8-3. Journeys

```
GET    /api/journeys                    # tenant 内の journeys 一覧
POST   /api/journeys                    # 新規作成
GET    /api/journeys/:id                # 単一取得 (deliveries の DAG 含む)
PUT    /api/journeys/:id                # 更新
DELETE /api/journeys/:id                # 削除
POST   /api/journeys/:id/activate       # status = active
POST   /api/journeys/:id/pause          # status = paused
```

### 8-4. Deliveries

```
GET    /api/deliveries                  # tenant 内の deliveries 一覧
POST   /api/deliveries                  # 新規作成 (journey_id NULL = 場当たり)
GET    /api/deliveries/:id              # 単一取得
PUT    /api/deliveries/:id              # 更新 (status=draft のみ)
DELETE /api/deliveries/:id              # 削除
POST   /api/deliveries/:id/send         # 即時送信
POST   /api/deliveries/:id/preview      # 送信前プレビュー (persona 該当者数 + 各 segment へのレンダリング結果)
POST   /api/deliveries/:id/attach-to-journey  # 場当たり → journey に昇格
```

### 8-5. AI Conductor

```
POST   /api/ai/intent                   # 自然言語 → Journey 自動生成
                                        # body: { prompt: "来週金曜にイベント告知、3日後にCTA" }
                                        # response: { journey_draft: {...}, deliveries_draft: [...] }
POST   /api/ai/copy                     # snippet body 自動生成
                                        # body: { context: "...", style: "casual|formal", length: "short|medium|long" }
POST   /api/ai/strategy                 # 過去実績ベース提案
                                        # response: { suggestions: [{type:"timing|tag|copy", message:"..."}] }
```

### 8-6. Workspaces / Organizations (S4以降)

```
GET    /api/workspaces                  # 自分が所属する workspaces 一覧
POST   /api/workspaces                  # 新規作成 (organization 配下)
PUT    /api/workspaces/:id              # 更新 (ui_mode 切替等)
GET    /api/organizations/:id           # organization 詳細
PUT    /api/organizations/:id           # 更新
```

---

## 9. 代替案と選択理由

### 9-1. なぜ Customer Journey Builder Canvas (D_v2) で止めず、AI Conductor Layer (D_v3) を追加するか

**代替案**: Mailchimp/HubSpot 同等の Visual Journey Builder のみで止める

**却下理由**:
- 子竜の真の目的は「日本人がめちゃくちゃ喜ぶ世界最高峰のマーケティングツール」
- 「使いきれない」の根本原因は UI 複雑性ではなく**マーケティング知識ギャップ**
- 業界の Customer Journey Builder ですら「マーケ知識がある人」前提
- AI 機能を持つ海外ツールは文章生成止まり、Journey 設計まで踏み込んだ製品が**世界的に空白**
- → Visual UI だけでは知識ギャップは埋まらない。AI Co-pilot Layer が必須

### 9-2. なぜ broadcasts/scenarios を deliveries に統合するか (D_v2 採用理由)

**代替案 (v1, proposal `6b2bf871`)**: broadcast_segments テーブル新設で broadcasts × segments の二段階階層

**却下理由**:
- broadcasts/scenarios の二元論こそ「場当たり↔シナリオ統合」の根本障害
- priority + is_default は決定木の線形化 = 50グループでスケールしない応急処置
- `extra_ps_tag_ids` は adhoc 実装シグナル
- segment が2義 (segment-query=誰フィルタ vs broadcast_segments=何送る) で名前一貫性違反

### 9-3. なぜ Slack/Linear 型 3階層 (Org → Workspace → LINE Account) か

**代替案**:
- A. Workspace = 1 LINE Account (L Step型): シンプルだが複数 LINE 運用は別契約=別請求
- B. Workspace = N LINE Account (HubSpot型): 1社で複数ブランド OK だが代理店向けには浅い
- D. Account → Sub-account ツリー (Stripe/AWS型): 複雑、過剰

**選定理由 (C: Slack/Linear型)**:
- 受講生 = 個人事業主が複数 LINE 運用しがち (本業+副業+クライアント案件)
- コンサル受講生が**自分の顧客に再販**する可能性あり → Org 内に Workspace 追加で対応
- 将来エージェンシー機能拡張が自然 (Slack/Linear と同じ階層)

### 9-4. なぜ Gemini 2.0 Flash か

**代替案**:
- Claude 4.6 / 4.7: 高品質だがコスト高 (~10倍)
- GPT-4o mini: コスト同等だが日本語性能で Gemini に劣る (主観)
- ローカル LLM: Worker 上で動かない

**選定理由**: 価格 2万円目標 → AI コスト最小化必須。Gemini 2.0 Flash で 1ユーザー月間 ~35円 = 粗利 99%超。LiteLLM 経由なので将来 Claude/Gemini Nano への routing も可能。

### 9-5. なぜ React Flow か (Visual Journey Builder)

**代替案**:
- 自前 Canvas 実装: 工数膨張
- Drawflow: シンプルだがカスタマイズ性低
- LiteGraph.js: ノード型UIだがマーケ向け事例なし

**選定理由**: React Flow は ActiveCampaign の Customer Journey Builder にも採用される業界標準。OSS で MIT ライセンス、商用 SaaS 多数事例。

---

## 10. リスクと対策

### R1: 命名混乱リスク (LINE Harness CRM との混同)

| リスク | 対策 |
|---|---|
| 「DORAGON」と「LINE Harness」が混同される | RFC 仕様書冒頭の「命名マップ」セクション + canonical_code `doragon` 必須使用 + GitHub Issue / PR タイトルに `[doragon]` プレフィックス |

### R2: マルチテナント設計の YAGNI 違反リスク

| リスク | 対策 |
|---|---|
| 「最初から完璧なマルチテナント」が結局子竜本人だけしか使わない | 設計だけ組み込み (tenant_id カラム + クエリ強制) し、UI/Onboarding/Stripe は S4 まで作らない。S3 完了時点で SaaS 化判断ゲート |

### R3: AI コスト爆発リスク

| リスク | 対策 |
|---|---|
| Gemini Flash でも大量利用ユーザーで月数千円超える | S6 で利用上限 + 従量課金実装。LiteLLM Proxy で max_budget 設定 |

### R4: 既存 broadcasts / scenarios 移行による破壊リスク

| リスク | 対策 |
|---|---|
| 既存運用を壊す | 後方互換 view を残し、新規は新スキーマ、既存は段階移行 (S2 で deliveries 新設、broadcasts/scenarios は read-only に縮退) |

### R5: 子竜先生 Knowledge Base のシリュークローン側との衝突

| リスク | 対策 |
|---|---|
| 別 SaaS の知識基盤と機能重複 | Phase 2 で別途検討 (S5 着手前にシリュークローン側のオーナーと整合) |

### R6: LINE 公式 API のレート制限

| リスク | 対策 |
|---|---|
| 大量配信時の rate limit | 既存 broadcast.ts のキューイング機構を流用 + Cloudflare Queues で分散 |

### R7: コンサル受講生の支払意思の見積誤り

| リスク | 対策 |
|---|---|
| 受講生が「2万円は高い」と離脱 | S3 完了時点で β 試験実施 (5-10人)、価格感度を直接ヒアリング。価格が合わなければ機能差別化で higher tier 検討 |

---

## 11. 受け入れ基準（MVP）

### Sprint 1 完了基準

- [ ] `personas`, `snippets` テーブルが migration 経由で作成される
- [ ] 全既存テーブルに `tenant_id` カラムが追加される (子竜=`00000000-0000-0000-0000-000000000001` 固定)
- [ ] 既存 broadcasts に `persona_id` + `snippets_composition` カラム追加
- [ ] 現行 `personalized-broadcast-1.ts` の4グループが personas+snippets として DB に登録される
- [ ] スクリプトが API 経由で persona+snippets を読む薄いクライアントに変換される
- [ ] Beginner Mode 最小実装: チャットで「分身AI 希望者向けのスニペット書いて」と入れると Gemini Flash 経由で snippet 下書きが返る

### Sprint 2 完了基準

- [ ] `journeys`, `deliveries` テーブルが migration 経由で作成される
- [ ] 既存 broadcast 1件を delivery (journey_id=NULL) として API 経由で送信できる
- [ ] 「来週金曜に予告→3日後告知→CTA」と自然言語で入れると AI が Journey の draft を返す
- [ ] 場当たり delivery を `attach-to-journey` で既存 journey に接続できる

### Sprint 3 完了基準

- [ ] React Flow Canvas で journey の DAG を表示・編集できる
- [ ] Persona Library サイドパネルから drag & drop で delivery に persona 紐付けできる
- [ ] 配信前プレビューで persona 該当人数 + 各 segment のレンダリング結果が見える
- [ ] 子竜本人が日々の配信運用を完全に DORAGON に移行する

### Sprint 4 完了基準

- [ ] `organizations`, `workspaces` テーブルが migration 経由で作成される
- [ ] Workspace 切替 UI でヘッダーから workspace 切替できる
- [ ] Onboarding Wizard で新規ユーザーが 30分以内にデモ配信を完了できる
- [ ] 受講生 5-10人が β 試験参加可能なレベル

---

## 12. 実装ロードマップ

### Phase 0: 着手準備 (0.5日)

- [ ] GitHub Issue #29 を本 RFC に基づいて update (旧 v1 spec を新 v2 spec に書き換え)
- [ ] 新 GitHub Issues を Sprint 1 機能ごとに作成 (F1.1〜F1.6)
- [ ] CLAUDE.md (line-harness-oss) に DORAGON 関連の記載追加 (canonical_code, parent: line-harness, spec URL)

### Phase 1: 子竜単テナント期 (S1-S3, 約2-3週間)

- [ ] **S1** (3-4日): Persona+Snippet+tenant_id+Beginner Mode
- [ ] **S2** (4-5日): Journey DAG+Intent Translation
- [ ] **S3** (5-7日): Visual Journey Builder Canvas+Strategy Suggestion
- [ ] **ゲート判断**: 子竜本人が日々の配信運用を完全移行できているか? できていれば S4 へ進む

### Phase 2: マルチテナント β 試験期 (S4-S5, 約1-2週間)

- [ ] **S4** (4-5日): Workspace 切替+Onboarding Wizard+Demo Tenant
- [ ] **S5** (3-4日): Cross-Tenant Knowledge Base (子竜先生) — シリュークローン側と整合確認
- [ ] **ゲート判断**: 受講生 5-10人で β 試験。支払意思額の検証

### Phase 3: SaaS 公開 (S6, 約1週間)

- [ ] **S6** (3-4日): Stripe + 自動プロビジョニング + 利用上限 + 従量課金
- [ ] 公開β リリース

### Phase 4: 機能深堀り (S7+, 継続)

- [ ] Risk Detection / A/B Suggester / Performance Memory / Copy Generator

---

## 13. オープンな問い (子竜判断必要)

| # | 問い | 期限 |
|---|---|---|
| Q1 | 命名「DORAGON」で確定 OK か? (NG なら他候補) | S1 着手前 |
| Q2 | tenant_id の物理表現は UUID か workspace_id (slug) か? | S1 着手前 |
| Q3 | Beginner Mode の最小実装で snippet 下書きをチャットに出すか、フォームに直接埋めるか? | S1 着手中 |
| Q4 | 子竜先生 Knowledge Base のソース範囲 (過去 LINE 配信全文 / 著作物 / mizukagami 会話 / 7thsense Notion) | S5 着手前 |
| Q5 | 受講生 β 試験の対象選定基準 (どの 5-10人にするか) | S4 完了前 |
| Q6 | Stripe 課金モデル (Workspace 単位 fixed / メッセージ数従量 / Hybrid) | S6 着手前 |
| Q7 | LINE Harness OSS リポジトリ内に統合 vs 独立リポジトリに分離 | S4 着手前 |

---

## 14. 関連リソース

### Supabase Records

| Record | 内容 |
|---|---|
| `ai_design_proposals.3bbeef62` | D_v3.5 鬼洗練 v3 結果 (構造美10/事業価値10) |
| `ai_design_proposals.6b2bf871` | 旧 v1 (superseded by 3bbeef62) |
| `ai_design_proposal_links` | 3bbeef62 → supersedes(6b2bf871) + synthesizes(98d99b21, 48ffffbc, c7d846f8) |

### GitHub

| Issue | 内容 |
|---|---|
| #29 | 旧 Segmented Broadcast Architecture v1 spec (本 RFC で update 必要) |

### Notion

| Page | 用途 |
|---|---|
| Product Registry row (`doragon`) | 本 RFC の Notion 表示 |

### File System

| Path | 用途 |
|---|---|
| `docs/specs/doragon/doragon-spec.md` | 本ファイル (SSOT) |
| `apps/worker/src/routes/` | Worker route 拡張先 |
| `packages/db/migrations/` | 025_personas.sql, 026_snippets.sql, 027_tenant_id.sql, ... |

---

## 更新履歴

- **v1.0 (2026-05-11)**: project-genesis スキル経由で初版作成。鬼洗練 v3 Round 3 D_v3.5 を反映 (proposal 3bbeef62)
