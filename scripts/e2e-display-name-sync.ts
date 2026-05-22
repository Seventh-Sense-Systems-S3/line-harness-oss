/**
 * E2E テスト: display_name Supabase 逆同期
 *
 * 手順:
 *   1. テスト対象ユーザーの display_name を Supabase から一時的に消す
 *   2. LINE follow イベントを HMAC 署名付きで worker に POST
 *   3. Supabase に display_name が書き戻されたことを確認
 *   4. クリーンアップ
 *
 * 実行:
 *   export LINE_CHANNEL_SECRET=xxx
 *   export LINE_CHANNEL_DESTINATION=Uxxxxxxxx  # チャンネル自身の user-id
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   export TEST_LINE_USER_ID=Uxxxxxxxx         # テスト対象の LINE user ID
 *   npx tsx scripts/e2e-display-name-sync.ts
 */
import * as crypto from "node:crypto";

const WORKER_URL = "https://line-crm-worker.kyousuke10000.workers.dev";
const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const CHANNEL_DESTINATION = process.env.LINE_CHANNEL_DESTINATION!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_USER_ID =
  process.env.TEST_LINE_USER_ID ?? "U0e108e78b9bf9d7fd6262e5fd260a803";

if (!CHANNEL_SECRET || !CHANNEL_DESTINATION || !SUPABASE_KEY) {
  console.error(
    "Required: LINE_CHANNEL_SECRET, LINE_CHANNEL_DESTINATION, SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

async function supabasePatch(
  lineUserId: string,
  body: object,
): Promise<boolean> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/sap_mizukagami_line_sessions?line_user_id=eq.${encodeURIComponent(lineUserId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    },
  );
  return r.ok;
}

async function supabaseGet(
  lineUserId: string,
): Promise<{ display_name: string | null } | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/sap_mizukagami_line_sessions?line_user_id=eq.${encodeURIComponent(lineUserId)}&select=line_user_id,display_name&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  const rows = (await r.json()) as Array<{ display_name: string | null }>;
  return rows[0] ?? null;
}

async function main() {
  console.log(`\n🧪 E2E テスト: display_name Supabase 同期`);
  console.log(`   対象ユーザー: ${TEST_USER_ID}`);
  console.log(`   Worker URL: ${WORKER_URL}\n`);

  // ── Step 1: 現在の display_name を確認・保存 ─────────────────────
  console.log("[1/5] 現在の display_name を取得...");
  const before = await supabaseGet(TEST_USER_ID);
  if (!before) {
    console.error(
      `  ❌ ${TEST_USER_ID} が sap_mizukagami_line_sessions に見つかりません`,
    );
    process.exit(1);
  }
  const savedDisplayName = before.display_name;
  console.log(`  現在値: "${savedDisplayName ?? "(null)"}"`);

  // ── Step 2: display_name を NULL に設定（テスト前提作り）──────────
  console.log("[2/5] display_name を一時的に NULL に設定...");
  const clearOk = await supabasePatch(TEST_USER_ID, { display_name: null });
  if (!clearOk) {
    console.error("  ❌ NULL クリア失敗");
    process.exit(1);
  }
  const afterClear = await supabaseGet(TEST_USER_ID);
  console.log(`  クリア後: "${afterClear?.display_name ?? "(null)"}" ✅`);

  // ── Step 3: LINE follow イベントを署名付きで POST ────────────────
  console.log("[3/5] LINE follow webhook を POST...");

  const payload = JSON.stringify({
    destination: CHANNEL_DESTINATION,
    events: [
      {
        type: "follow",
        timestamp: Date.now(),
        mode: "active",
        webhookEventId: `E2E_TEST_${Date.now()}`,
        deliveryContext: { isRedelivery: false },
        source: { type: "user", userId: TEST_USER_ID },
        replyToken: "e2e_test_reply_token_00000000000",
      },
    ],
  });

  const signature = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(payload)
    .digest("base64");

  const resp = await fetch(`${WORKER_URL}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": signature,
    },
    body: payload,
  });

  console.log(`  HTTP ${resp.status} ${resp.ok ? "✅" : "❌"}`);
  if (!resp.ok) {
    console.error(`  レスポンス: ${await resp.text()}`);
  }

  // ── Step 4: display_name が書き込まれるまで待機・確認 ────────────
  console.log("[4/5] Supabase に display_name が書き込まれるまで待機...");

  let result: { display_name: string | null } | null = null;
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await supabaseGet(TEST_USER_ID);
    if (result?.display_name) {
      console.log(
        `  ✅ display_name 確認: "${result.display_name}" (${(i + 1) * 2}秒後)`,
      );
      break;
    }
    process.stdout.write(`  待機中... (${(i + 1) * 2}s)\r`);
  }

  const passed = !!result?.display_name;

  // ── Step 5: クリーンアップ ──────────────────────────────────────
  console.log("\n[5/5] クリーンアップ (display_name を元の値に戻す)...");
  if (savedDisplayName) {
    await supabasePatch(TEST_USER_ID, { display_name: savedDisplayName });
    console.log(`  復元: "${savedDisplayName}" ✅`);
  } else {
    console.log("  元々 NULL だったのでスキップ");
  }

  // ── 最終判定 ───────────────────────────────────────────────────
  console.log("\n" + "─".repeat(50));
  if (passed) {
    console.log("✅ E2E テスト PASS");
    console.log(
      `   LINE follow → Worker → LINE getProfile → Supabase PATCH の全経路が動作している`,
    );
  } else {
    console.log("❌ E2E テスト FAIL");
    console.log(
      `   display_name が 12 秒以内に Supabase に書き込まれませんでした`,
    );
    console.log(
      "   Cloudflare Worker ログを確認: npx wrangler tail --env production",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
