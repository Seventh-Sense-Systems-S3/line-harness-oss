# ADR-0001: LINE Messaging API Token Exclusive

- **Status**: Draft (Proposed 2026-05-09 — Phase D 完了時に Accepted へ昇格)
- **Date**: 2026-05-09
- **Owners**: line-harness
- **Provenance**: Supabase proposal `25e69188-6753-4427-966a-e2f7f1771b9e` (鬼洗練 v3 Round 1)

## Context

LINE 公式アカウントの Messaging API トークンは、月次配信通数 quota が固定されている (フリー/ライト/スタンダードプラン別)。同一トークンを複数の配信エンジンで併用すると、以下の問題が構造的に発生する。

1. **Quota 競合**: 配信通数が複数エンジンで奪い合いになり、シナリオ配信が突発的に止まる
2. **配信ログ分裂**: どのエンジンが何を送ったかが追跡不能になり、SSOT が崩れる
3. **レート制限の予測不能性**: 単一エンジンなら予測可能だが、複数だと制限到達タイミングが不明

UTAGE のような外部マーケティングプラットフォームは「LINE 配信機能」を内蔵しているが、このプラットフォームを LINE 配信に使うと、上記 3 つの問題が発生する。

## Decision

**LINE Messaging API トークンは LINE Harness が専有する。** 他のいかなる外部システム (UTAGE / Zapier / 個別スクリプト等) も同じトークンを使った LINE 配信を行わない。

UTAGE は LP / 予約 / 決済 (Surface 層) のみを担い、配信は Webhook 経由で LINE Harness にバトンタッチする。

## Consequences

### Positive

- **Quota の単一管理**: 全配信が LINE Harness を経由するため、quota 残量を単一箇所で監視可能
- **配信ログ統合**: `friends` + `scoring` テーブルに全配信履歴が集約され、SSOT が成立
- **AI 予測適合**: 配信ログが単一視点で揃うため、AI による予測・分岐が一貫性を持つ
- **障害切り分け**: 配信失敗時の責任境界が明確 (LINE Harness 内に閉じる)

### Negative / Trade-offs

- **UTAGE のノーコード LINE 配信機能を使えない**: 配信編集には LINE Harness 側の実装が必要
- **Webhook 設計が必須**: UTAGE → LINE Harness の Webhook 経路を維持し続ける運用負荷
- **トークン持ち主が単一エンジンに固定**: 将来 LINE Harness を捨てる場合、配信エンジン切替コストが高い

### Acceptance Criteria (Phase D 完了時)

- [ ] UTAGE 側で `message_*` 系機能を一切使わないことを運用ドキュメント化
- [ ] Webhook (UTAGE → LINE Harness) が一方向として実装されている
- [ ] LINE Messaging API トークンの管理場所が LINE Harness 環境変数に集約されている
- [ ] 上記が満たされた時点で Status を `Accepted` に昇格

## Related

- [UTAGE × LINE Harness × Resend 統合アーキテクチャ](../utage-lh-resend-integration.md) §原則 1〜5
- [ADR-0002: Email Engine = Resend Exclusive](0002-email-engine-resend-exclusive.md) — 対称的な原則 (Email 側)
