# Architecture Decision Records

> このディレクトリは LINE Harness の **アーキテクチャ判断記録 (ADR)** を保持する。
> ADR は不可逆/影響範囲の広い設計判断のみを記録する。日々の実装判断は PR / コミットログで十分。

## ADR フォーマット

[MADR](https://adr.github.io/madr/) (Markdown Any Decision Records) に準拠。各 ADR は以下を含む:

- **Status**: `Draft` / `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-NNNN`
- **Context**: 判断が必要になった背景
- **Decision**: 採用した結論 (能動態・断定形)
- **Consequences**: 採用結果として発生する制約・トレードオフ
- **Provenance**: 起源となった proposal / Notion / Issue / PR への参照

## 番号付け

- `0001` から連番 (ゼロ埋め 4 桁)
- `Superseded` でも番号は再利用しない
- ファイル名: `NNNN-kebab-case-title.md`

## Index

| # | Title | Status | Owner |
|---|---|---|---|
| [0001](0001-line-token-exclusive.md) | LINE Messaging API Token Exclusive | Draft | line-harness |
| [0002](0002-email-engine-resend-exclusive.md) | Email Engine = Resend Exclusive | Draft | line-harness |

## 関連

- [UTAGE × LINE Harness × Resend 統合アーキテクチャ](../utage-lh-resend-integration.md) — 上位アーキテクチャ正本
