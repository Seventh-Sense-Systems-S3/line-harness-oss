/**
 * D1 friends.display_name → Supabase sap_mizukagami_line_sessions バックフィルスクリプト
 *
 * やること:
 *   - D1 (line-crm prod) から LINE ユーザー (U形式) の display_name を取得
 *   - Supabase sap_mizukagami_line_sessions.display_name に一括書き込み
 *
 * 実行:
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   cd apps/worker && npx tsx ../../scripts/backfill-display-name-to-supabase.ts
 *
 * オプション:
 *   --dry-run    実際には更新せず、処理対象のみ表示
 */
import { execSync } from "node:child_process";

const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const D1_DATABASE = "line-crm";
const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is required");
    process.exit(1);
  }

  // ── Step 1: D1 から LINE ユーザーの display_name を取得 ─────────────

  console.log("[1/4] D1 から display_name を取得中...");

  let d1Rows: Array<{ line_user_id: string; display_name: string | null }> = [];
  try {
    const output = execSync(
      `npx wrangler d1 execute ${D1_DATABASE} --env production --remote --json ` +
        `--command "SELECT line_user_id, display_name FROM friends WHERE line_user_id LIKE 'U%' ORDER BY created_at"`,
      { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    );
    // wrangler --json outputs an array of result objects; first element has .results
    const parsed = JSON.parse(output) as Array<{
      results: Array<{ line_user_id: string; display_name: string | null }>;
    }>;
    d1Rows = parsed[0]?.results ?? [];
  } catch (err) {
    console.error("D1 query failed:", err);
    process.exit(1);
  }

  const withName = d1Rows.filter((r) => r.display_name);
  console.log(
    `[2/4] D1: ${d1Rows.length} 件中 ${withName.length} 件が display_name 保有`,
  );

  if (DRY_RUN) {
    console.log("[DRY RUN] 最初の 10 件:");
    withName
      .slice(0, 10)
      .forEach((r) => console.log(`  ${r.line_user_id} → "${r.display_name}"`));
    console.log("[DRY RUN] 実際の更新はスキップ");
    return;
  }

  // ── Step 2: Supabase にある対象ユーザーの line_user_id を確認 ──────

  console.log("[3/4] Supabase 対象ユーザーを確認中...");

  const supabaseResp = await fetch(
    `${SUPABASE_URL}/rest/v1/sap_mizukagami_line_sessions` +
      `?line_user_id=like.U%25&select=line_user_id&limit=1000`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!supabaseResp.ok) {
    console.error(
      "Supabase query failed:",
      supabaseResp.status,
      await supabaseResp.text(),
    );
    process.exit(1);
  }
  const supabaseSessions = (await supabaseResp.json()) as Array<{
    line_user_id: string;
  }>;
  const supabaseUserSet = new Set(supabaseSessions.map((s) => s.line_user_id));
  console.log(`[3/4] Supabase: LINE ユーザー ${supabaseSessions.length} 件`);

  // ── Step 3: 一致するユーザーの display_name を更新 ─────────────────

  console.log("[4/4] display_name をバックフィル中...");

  const toUpdate = withName.filter((r) => supabaseUserSet.has(r.line_user_id));
  console.log(`  更新対象: ${toUpdate.length} 件`);

  let successCount = 0;
  let errorCount = 0;

  for (const row of toUpdate) {
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/sap_mizukagami_line_sessions` +
        `?line_user_id=eq.${encodeURIComponent(row.line_user_id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ display_name: row.display_name }),
      },
    );
    if (patchResp.ok) {
      successCount++;
    } else {
      console.error(
        `  PATCH failed for ${row.line_user_id}: ${patchResp.status} ${await patchResp.text()}`,
      );
      errorCount++;
    }
  }

  console.log(
    `\n✅ バックフィル完了: 成功 ${successCount} 件 / エラー ${errorCount} 件`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
