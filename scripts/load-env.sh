#!/usr/bin/env bash
# =============================================================
# load-env.sh — 1Password から全シークレットを一括ロード
# =============================================================
# 使い方:
#   source scripts/load-env.sh            # 本番（LINE Harness + Mizukagami）
#   source scripts/load-env.sh --local    # ローカル開発用キー
#
# 前提: op (1Password CLI) がインストール・認証済みであること
#   brew install 1password-cli
#   op signin
# =============================================================

set -uo pipefail

VAULT="Seventh-Sense-Systems-Enterprise-Secrets"

# ロードモード判定
MODE="${1:-production}"
if [[ "${1:-}" == "--local" ]]; then
  MODE="local"
fi

echo "🔑 1Password から環境変数をロード中 (mode: $MODE)..."

# ── Supabase (phoenix-memory-os) ──────────────────────────────
export SUPABASE_URL="https://eizsilomeafyhftuvqst.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SERVICE_ROLE_KEY="$(op read "op://${VAULT}/supabase-phoenix-memory-os/service-role-key")"
export SUPABASE_ANON_KEY
SUPABASE_ANON_KEY="$(op read "op://${VAULT}/supabase-phoenix-memory-os/anon-key")"

# ── Supabase (mizukagami-prod) ────────────────────────────────
export SUPABASE_MIZUKAGAMI_SERVICE_ROLE_KEY
SUPABASE_MIZUKAGAMI_SERVICE_ROLE_KEY="$(op read "op://${VAULT}/SUPABACE_mizukagami-prod/secret")"
export SUPABASE_MIZUKAGAMI_ANON_KEY
SUPABASE_MIZUKAGAMI_ANON_KEY="$(op read "op://${VAULT}/SUPABACE_mizukagami-prod/annon")"
export SUPABASE_MIZUKAGAMI_URL
SUPABASE_MIZUKAGAMI_URL="$(op read "op://${VAULT}/SUPABACE_mizukagami-prod/URL")"

# ── LINE Harness Worker ───────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  # ローカル開発用（localhost）
  export LINE_HARNESS_API_KEY
  LINE_HARNESS_API_KEY="$(op read "op://${VAULT}/LINE Harness localhost/api_key")"
  export LINE_HARNESS_URL="http://localhost:8787"
else
  # 本番
  export LINE_HARNESS_API_KEY
  LINE_HARNESS_API_KEY="$(op read "op://${VAULT}/LINE Harness Worker Production/api_key")"
  export LINE_HARNESS_URL
  LINE_HARNESS_URL="$(op read "op://${VAULT}/LINE Harness Worker Production/worker_url")"
fi

# ── Mizukagami Worker ─────────────────────────────────────────
export MIZUKAGAMI_API_KEY
MIZUKAGAMI_API_KEY="$(op read "op://${VAULT}/Mizukagami Worker Production/api_key")"
export MIZUKAGAMI_URL
MIZUKAGAMI_URL="$(op read "op://${VAULT}/Mizukagami Worker Production/worker_url")"

# ── LINE Diagnosis API ────────────────────────────────────────
# ※ フィールド名が日本語で op read 非対応のためスキップ（必要時は手動取得）
# export LINE_DIAGNOSIS_API_KEY
# LINE_DIAGNOSIS_API_KEY="$(op item get "LINE Diagnosis API Key" --vault "${VAULT}" --fields label=認証情報 --reveal)"

# ── 確認表示（値は隠す）──────────────────────────────────────
echo ""
echo "✅ ロード完了:"
echo "  SUPABASE_URL              = ${SUPABASE_URL}"
echo "  SUPABASE_SERVICE_ROLE_KEY = ${SUPABASE_SERVICE_ROLE_KEY:0:12}..."
echo "  SUPABASE_MIZUKAGAMI_URL   = ${SUPABASE_MIZUKAGAMI_URL}"
echo "  LINE_HARNESS_URL          = ${LINE_HARNESS_URL}"
echo "  LINE_HARNESS_API_KEY      = ${LINE_HARNESS_API_KEY:0:8}..."
echo "  MIZUKAGAMI_URL            = ${MIZUKAGAMI_URL}"
echo "  MIZUKAGAMI_API_KEY        = ${MIZUKAGAMI_API_KEY:0:8}..."
echo ""
echo "💡 このシェルで有効です。スクリプト実行例:"
echo "   npx tsx scripts/sync-mizukagami-to-d1.ts --dry-run"
