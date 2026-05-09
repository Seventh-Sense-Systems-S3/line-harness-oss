# ADR-0002: Email Engine = Resend Exclusive

- **Status**: Draft (Proposed 2026-05-09 — Phase D 完了時に Accepted へ昇格)
- **Date**: 2026-05-09
- **Owners**: line-harness
- **Provenance**: Supabase proposal `9873c089-1645-4f3e-a55a-a6c679dce67a` (鬼洗練 v3 Round 2)

## Context

LINE Harness の「人」(friends) は LINE 経由のみで把握されてきたが、UTAGE LP 経由でメールアドレスを取得するフローが追加されたことで、Email を配信チャネルとして組み込む必要が生まれた。

Email 配信エンジンの選択肢として以下を検討した。

| 候補 | 評価 |
|---|---|
| **Resend** | React Email 公式統合・Cloudflare Workers ネイティブ・Webhook 設計が明快・配信レピュテーション良好 |
| SendGrid | 老舗だが Cloudflare Workers との統合が薄く、テンプレ DSL が独自 |
| Amazon SES | 安価だが Webhook 設計に追加構築が必要 (SNS/SQS 経由) |
| Mailgun | 機能十分だが Cloudflare Workers との親和性がやや低い |
| UTAGE 内蔵メール配信 | LP/予約/決済を超えてメール配信もカバーしているが、Surface 層を超える |

ADR-0001 で確立した「UTAGE は Surface のみ」原則と整合する選択肢は **Resend** が最も自然。

## Decision

**Email 配信は Resend が専有する。** 他のいかなる外部システム (UTAGE / SendGrid / SES / 個別 SMTP 等) も配信に使わない。

実装スタック:
- **配信 SDK**: Resend Node.js SDK
- **テンプレートエンジン**: React Email (V12 LP デザイン継承)
- **配信ランタイム**: Cloudflare Workers (`apps/worker/src/services/email-delivery.ts`)
- **Webhook 受信**: `apps/worker/src/routes/webhooks/resend.ts` で open / click / bounce を受信し scoring テーブルへ反映

## Consequences

### Positive

- **配信レピュテーション最大化**: Resend のドメイン認証 (DKIM / SPF / DMARC) ネイティブサポートで到達率が高い
- **テンプレート再利用**: V12 LP の React コンポーネントをほぼそのままメールに転用可能
- **Webhook → scoring 一気通貫**: open/click/bounce を `friends` の scoring に反映でき、AI 予測の精度が上がる
- **インフラ単一**: Cloudflare Workers 上で完結し、Resend SDK 以外の追加インフラ不要

### Negative / Trade-offs

- **Resend ベンダーロックイン**: 将来別プロバイダに乗り換える場合、SDK 呼び出し箇所と Webhook 経路を全置換
- **無料枠の制約**: Resend の月間配信通数上限を超えると有料プラン必須
- **Email 配信失敗時の独自監視**: Resend dashboard と LINE Harness scoring の双方で観測する運用コスト

### Acceptance Criteria (Phase D 完了時)

- [ ] `apps/worker/src/services/email-delivery.ts` が実装され、`scenarios.steps.channel = 'email' | 'both'` で動作
- [ ] React Email テンプレートが `apps/worker/src/templates/emails/` に格納されている
- [ ] Resend Webhook (open/click/bounce) が `friends.scoring` に反映されている
- [ ] ドメイン認証 (DKIM/SPF/DMARC) が完了
- [ ] 上記が満たされた時点で Status を `Accepted` に昇格

## Related

- [UTAGE × LINE Harness × Resend 統合アーキテクチャ](../utage-lh-resend-integration.md) §原則 6〜8
- [ADR-0001: LINE Messaging API Token Exclusive](0001-line-token-exclusive.md) — 対称的な原則 (LINE 側)
