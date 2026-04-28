/**
 * 水鏡診断（MIZUKAGAMI）Supabase → LINE Harness D1 メタデータ同期スクリプト
 *
 * やること:
 *   - Supabase sap_mizukagami_line_sessions から完了セッションを取得
 *   - LINE Harness D1 の friends.metadata に魂データを同期
 *   - リッチデータ（user_words / concern / five_powers / convergence_narrative / keywords）も同期
 *   - 完了者に「水鏡診断完了」タグを付与（IF-THEN条件に使える）
 *   - 途中離脱者に「水鏡診断未完了」タグを付与（再招待用）
 *
 * 実行:
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   export LINE_HARNESS_API_KEY=xxx
 *   export LINE_HARNESS_URL=https://line-crm-worker.kyousuke10000.workers.dev  # optional
 *   npx tsx scripts/sync-mizukagami-to-d1.ts
 *
 * オプション:
 *   --dry-run    実際には更新せず、処理対象のみ表示
 *   --incomplete 途中離脱者のタグ付けも実行（デフォルト: 完了者のみ）
 *   --limit N    処理件数を N 件に制限（動作確認用）
 *
 * 仕様書参照:
 *   - MIZUKAGAMI: https://www.notion.so/AI-MIZUKAGAMI-34d2619c6bd3818da937c5d2f678ecba
 *   - LINE Harness: https://www.notion.so/LINE-Harness-34d2619c6bd3814793faef881d2cc778
 *   - mizukagami-lineharness-preflight PASS (2026-04-28)
 */

// ── 設定 ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LINE_HARNESS_API_KEY = process.env.LINE_HARNESS_API_KEY!;
const LINE_HARNESS_URL =
  process.env.LINE_HARNESS_URL ||
  "https://line-crm-worker.kyousuke10000.workers.dev";

// タグ名（これらが LINE Harness の IF-THEN conditionType: tag_exists で使える）
const TAG_COMPLETED = "水鏡診断完了";
const TAG_INCOMPLETE = "水鏡診断未完了";
const TAG_INCOMPLETE_COLOR = "#FFB347";
const TAG_COMPLETED_COLOR = "#7EC8E3";

// ── 型定義 ──────────────────────────────────────────────────────────
interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  step?: string;
}

interface MizukagamiSession {
  session_id: string;
  line_user_id: string;
  current_step: string;
  completed_at: string | null;
  innate_profile: {
    soulMatch?: {
      soulName?: string;
      soulNo?: string;
      innateSpiral?: string;
      acquiredSystem?: string;
      manifestedWisdom?: string;
    };
  } | null;
  card_data: {
    closing_message?: string;
    user_essence?: string;
    user_words?: string[];
    five_powers?: {
      strength?: string;
      potential?: string;
      depth?: string;
      hidden?: string;
      recognized?: string;
    };
    action_guidance?: {
      who?: string;
      what?: string;
      when?: string;
      where?: string;
    };
    convergence_narrative?: string;
    // soul_name は新バージョンの card_data に存在。旧バージョンは innate_profile.soulMatch.soulName を使用
    soul_name?: string;
    soul_no?: string;
    tradition_summary?: string;
  } | null;
  user_keywords?: string[] | null;
  conversation_history?: ConversationMessage[] | null;
}

interface HarnessFriend {
  id: string;
  lineUserId: string;
  displayName: string;
}

// ── ユーティリティ ──────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    includeIncomplete: args.includes("--incomplete"),
    limit: (() => {
      const i = args.indexOf("--limit");
      return i !== -1 ? parseInt(args[i + 1], 10) : Infinity;
    })(),
  };
}

// ── Supabase API ────────────────────────────────────────────────────
async function supabaseFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── LINE Harness API ────────────────────────────────────────────────
async function harnessGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    headers: { Authorization: `Bearer ${LINE_HARNESS_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harness GET ${path} error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function harnessPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_HARNESS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harness POST ${path} error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function harnessPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_HARNESS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harness PUT ${path} error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// タグ取得または作成（idを返す）
async function getOrCreateTag(
  name: string,
  color: string,
  tagCache: Map<string, string>,
): Promise<string> {
  if (tagCache.has(name)) return tagCache.get(name)!;

  const res = await harnessGet<
    { data?: { id: string; name: string }[] } | { id: string; name: string }[]
  >("/api/tags");
  const tags: { id: string; name: string }[] = Array.isArray(res)
    ? res
    : (res as any)?.data || [];

  const existing = tags.find((t) => t.name === name);
  if (existing) {
    tagCache.set(name, existing.id);
    return existing.id;
  }

  const created = await harnessPost<{ data?: { id: string }; id?: string }>(
    "/api/tags",
    { name, color },
  );
  const id = (created as any)?.data?.id || (created as any)?.id;
  if (!id)
    throw new Error(`タグ作成失敗: ${name} → ${JSON.stringify(created)}`);

  tagCache.set(name, id);
  return id;
}

// line_user_id から Harness friend id を取得
// friends API は { data: { items: [...], total: N } } 形式で返す（tags API の { data: [] } とは異なる）
async function findFriendByLineUserId(
  lineUserId: string,
): Promise<HarnessFriend | null> {
  try {
    const res = await harnessGet<
      { data?: { items?: HarnessFriend[] } | HarnessFriend[] } | HarnessFriend[]
    >(`/api/friends?lineUserId=${lineUserId}&limit=1`);
    const friends: HarnessFriend[] = Array.isArray(res)
      ? res
      : (res as any)?.data?.items || (res as any)?.data || [];
    return friends.length > 0 ? friends[0] : null;
  } catch {
    return null;
  }
}

// ── concern 抽出 ────────────────────────────────────────────────────
// conversation_history の role=user メッセージのうち、「対話を始めたい」以外・5文字以上の最初の発言
// step1 を優先し、なければ q1 の回答を使用
function extractConcern(
  history: ConversationMessage[] | null | undefined,
): string {
  if (!history || history.length === 0) return "";

  const candidates = history.filter(
    (m) =>
      m.role === "user" &&
      m.content !== "対話を始めたい" &&
      m.content.trim().length >= 5,
  );

  // step1 を優先
  const step1 = candidates.find((m) => m.step === "step1");
  if (step1) return step1.content.trim();

  // q1 にフォールバック
  const q1 = candidates.find((m) => m.step === "q1");
  if (q1) return q1.content.trim();

  // どちらも見つからなければ最初の候補
  return candidates[0]?.content.trim() ?? "";
}

// ── 水鏡データ → メタデータ変換 ─────────────────────────────────────
function extractMetadata(session: MizukagamiSession): Record<string, string> {
  const sm = session.innate_profile?.soulMatch ?? {};
  const cd = session.card_data ?? {};

  const meta: Record<string, string> = {
    mizukagami_session_id: session.session_id,
    diagnosis_completed_at: session.completed_at ?? "",
  };

  // soul_name: card_data.soul_name（新バージョン）→ innate_profile.soulMatch.soulName（旧バージョン）の順でフォールバック
  const soulName = cd.soul_name ?? sm.soulName;
  if (soulName) meta.soul_name = soulName;

  // soul_no: card_data.soul_no → innate_profile.soulMatch.soulNo の順でフォールバック
  const soulNo = cd.soul_no ?? sm.soulNo;
  if (soulNo) meta.soul_no = soulNo;

  // innate_profile.soulMatch フィールド
  if (sm.innateSpiral) meta.innate_spiral = sm.innateSpiral;
  if (sm.acquiredSystem) meta.acquired_system = sm.acquiredSystem;
  if (sm.manifestedWisdom) meta.manifested_wisdom = sm.manifestedWisdom;

  // card_data フィールド（LLM生成パーソナルメッセージ）
  // closing_message = 個人向けLLM生成（soul_catalog_216の汎用版ではない）
  if (cd.closing_message) meta.soul_message = cd.closing_message;
  if (cd.user_essence) meta.user_essence = cd.user_essence;

  // ── リッチデータフィールド（新規追加）──

  // user_words: JSON配列文字列（最大6要素）
  if (cd.user_words && cd.user_words.length > 0) {
    meta.mizukagami_user_words = JSON.stringify(cd.user_words.slice(0, 6));
  }

  // user_words スカラー化（LINE Harness {{metadata.KEY}} はスカラー値を期待するため）
  if (cd.user_words && cd.user_words.length > 0) {
    const words = cd.user_words;
    if (words[0]) meta.mizukagami_user_word_1 = words[0];
    if (words[1]) meta.mizukagami_user_word_2 = words[1];
    if (words[2]) meta.mizukagami_user_word_3 = words[2];
    meta.mizukagami_user_words_joined = words.slice(0, 6).join("・");
  }

  // concern: conversation_history から抽出
  const concern = extractConcern(session.conversation_history);
  if (concern) meta.mizukagami_concern = concern;

  // five_powers: 各軸を個別キーに展開
  if (cd.five_powers) {
    const fp = cd.five_powers;
    if (fp.strength) meta.mizukagami_five_powers_strength = fp.strength;
    if (fp.potential) meta.mizukagami_five_powers_potential = fp.potential;
    if (fp.depth) meta.mizukagami_five_powers_depth = fp.depth;
    if (fp.hidden) meta.mizukagami_five_powers_hidden = fp.hidden;
    if (fp.recognized) meta.mizukagami_five_powers_recognized = fp.recognized;
  }

  // power_pattern: 最大値の軸を人間可読ラベルに変換（LINE Harness の metadata_equals 条件に使用）
  if (cd.five_powers) {
    const fp = cd.five_powers;
    const axes = [
      { label: "hidden_gem", value: parseFloat(fp.hidden ?? "0") },
      { label: "potential_type", value: parseFloat(fp.potential ?? "0") },
      { label: "strength_type", value: parseFloat(fp.strength ?? "0") },
      { label: "depth_type", value: parseFloat(fp.depth ?? "0") },
      { label: "recognized_type", value: parseFloat(fp.recognized ?? "0") },
    ].filter((a) => !isNaN(a.value) && a.value > 0);

    if (axes.length > 0) {
      const dominant = axes.reduce((a, b) => (a.value >= b.value ? a : b));
      meta.mizukagami_power_pattern = dominant.label;
    }
  }

  // convergence_narrative
  if (cd.convergence_narrative) {
    meta.mizukagami_convergence_narrative = cd.convergence_narrative;
  }

  // user_keywords: JSON配列文字列
  if (session.user_keywords && session.user_keywords.length > 0) {
    meta.mizukagami_keywords = JSON.stringify(session.user_keywords);
  }

  // funnel_stage: バックフィル時点では全員 Stage 0（水鏡診断完了）
  meta.mizukagami_funnel_stage = "0";

  return meta;
}

// ── SELECT クエリ（完了者・途中離脱者共通）──────────────────────────
const SELECT_FIELDS = [
  "session_id",
  "line_user_id",
  "current_step",
  "completed_at",
  "innate_profile",
  "card_data",
  "user_keywords",
  "conversation_history",
].join(",");

// ── メイン処理 ──────────────────────────────────────────────────────
async function main() {
  const { dryRun, includeIncomplete, limit } = parseArgs();

  // 事前チェック
  if (!SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_SERVICE_ROLE_KEY が未設定です");
    process.exit(1);
  }
  if (!LINE_HARNESS_API_KEY) {
    console.error("❌ LINE_HARNESS_API_KEY が未設定です");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  水鏡診断 → LINE Harness D1 メタデータ同期       ║");
  console.log("║  リッチデータ同期拡張版 (user_words/concern/     ║");
  console.log("║  five_powers/convergence_narrative/keywords)     ║");
  console.log("╚══════════════════════════════════════════════════╝");
  if (dryRun) console.log("🔍 DRY RUN モード（実際の更新はしません）\n");
  console.log(`接続先: ${LINE_HARNESS_URL}\n`);

  // ── STEP 1: Supabase から完了セッションを取得 ──
  console.log("📥 STEP 1: Supabase から水鏡診断セッションを取得中...");

  // 完了セッション（current_step = 'completed' かつ line_user_id が LINE UID形式）
  const completedSessions = await supabaseFetch<MizukagamiSession[]>(
    "/sap_mizukagami_line_sessions" +
      "?current_step=eq.completed" +
      "&line_user_id=like.U*" +
      `&select=${SELECT_FIELDS}` +
      "&order=completed_at.desc" +
      "&limit=1000",
  );
  console.log(`  ✅ 完了セッション: ${completedSessions.length}件`);

  let incompleteSessions: MizukagamiSession[] = [];
  if (includeIncomplete) {
    // 途中離脱（line_user_id はあるが current_step != 'completed'）
    incompleteSessions = await supabaseFetch<MizukagamiSession[]>(
      "/sap_mizukagami_line_sessions" +
        "?current_step=neq.completed" +
        "&line_user_id=like.U*" +
        `&select=${SELECT_FIELDS}` +
        "&limit=1000",
    );
    console.log(`  ⚠️  途中離脱セッション: ${incompleteSessions.length}件`);
  }
  console.log();

  // ── STEP 2: タグを準備 ──
  console.log("🏷️  STEP 2: タグを準備中...");
  const tagCache = new Map<string, string>();

  if (!dryRun) {
    const completedTagId = await getOrCreateTag(
      TAG_COMPLETED,
      TAG_COMPLETED_COLOR,
      tagCache,
    );
    console.log(`  ✅ "${TAG_COMPLETED}" タグ準備完了 (id: ${completedTagId})`);

    if (includeIncomplete) {
      const incompleteTagId = await getOrCreateTag(
        TAG_INCOMPLETE,
        TAG_INCOMPLETE_COLOR,
        tagCache,
      );
      console.log(
        `  ✅ "${TAG_INCOMPLETE}" タグ準備完了 (id: ${incompleteTagId})`,
      );
    }
  } else {
    console.log(`  [DRY RUN] タグ作成をスキップ`);
  }
  console.log();

  // ── STEP 3: 完了者のメタデータ同期 ──
  console.log("🔄 STEP 3: 完了者のメタデータを同期中...");

  const results = {
    completed: { synced: 0, notFound: 0, skipped: 0, errors: 0 },
    incomplete: { tagged: 0, notFound: 0, errors: 0 },
  };

  // 重複 line_user_id は最新1件だけ使う
  const uniqueCompleted = new Map<string, MizukagamiSession>();
  for (const s of completedSessions) {
    if (!uniqueCompleted.has(s.line_user_id)) {
      uniqueCompleted.set(s.line_user_id, s);
    }
  }
  console.log(`  ユニーク完了者: ${uniqueCompleted.size}人\n`);

  const completedList = Array.from(uniqueCompleted.values()).slice(0, limit);
  const completedTagId = tagCache.get(TAG_COMPLETED);

  for (let i = 0; i < completedList.length; i++) {
    const session = completedList[i];
    const progress = `[${i + 1}/${completedList.length}]`;

    // 1. LINE Harness で友だちを検索
    const friend = await findFriendByLineUserId(session.line_user_id);
    if (!friend) {
      console.log(
        `  ⚠️  ${progress} 未登録: ${session.line_user_id.slice(0, 12)}... (LINE Harness に友だちなし)`,
      );
      results.completed.notFound++;
      continue;
    }

    // 2. メタデータ抽出
    const metadata = extractMetadata(session);
    const hasData = Object.keys(metadata).length > 2; // session_id + completed_at 以外のデータがあるか

    if (!hasData) {
      console.log(
        `  ⚠️  ${progress} データ不足: ${friend.displayName} (innate_profile/card_data が空)`,
      );
      results.completed.skipped++;
    }

    if (!dryRun) {
      try {
        // 3. メタデータを更新（PUT /api/friends/:id/metadata はマージなので既存データは保持）
        await harnessPut(`/api/friends/${friend.id}/metadata`, metadata);

        // 4. 完了タグを付与（正しいエンドポイント: POST /api/friends/:id/tags with { tagId }）
        if (completedTagId) {
          await harnessPost(`/api/friends/${friend.id}/tags`, {
            tagId: completedTagId,
          });
        }

        results.completed.synced++;
        if ((i + 1) % 20 === 0 || i + 1 === completedList.length) {
          console.log(
            `  ✅ ${progress} ${friend.displayName} — soul: ${metadata.soul_name ?? "データなし"}, concern: ${(metadata.mizukagami_concern ?? "").slice(0, 20) || "n/a"}`,
          );
        }
      } catch (err) {
        console.log(
          `  ❌ ${progress} エラー: ${friend.displayName} — ${(err as Error).message}`,
        );
        results.completed.errors++;
      }
    } else {
      // DRY RUN
      console.log(
        `  [DRY] ${progress} ${friend.displayName}` +
          ` → soul_name: ${metadata.soul_name ?? "n/a"}` +
          `, user_word_1: ${metadata.mizukagami_user_word_1 ?? "n/a"}` +
          `, user_words_joined: ${metadata.mizukagami_user_words_joined ?? "n/a"}` +
          `, power_pattern: ${metadata.mizukagami_power_pattern ?? "n/a"}` +
          `, funnel_stage: ${metadata.mizukagami_funnel_stage}` +
          `, concern: ${(metadata.mizukagami_concern ?? "").slice(0, 20) || "n/a"}`,
      );
      results.completed.synced++;
    }

    // レート制限対策（Cloudflare Workers は1秒に多数のリクエストを受けられるが念のため）
    if (!dryRun && i % 10 === 9) await sleep(200);
  }

  // ── STEP 4: 途中離脱者へのタグ付け ──
  if (includeIncomplete && incompleteSessions.length > 0) {
    console.log(`\n🔄 STEP 4: 途中離脱者にタグを付与中...`);
    const incompleteTagId = tagCache.get(TAG_INCOMPLETE);

    const uniqueIncomplete = new Map<string, MizukagamiSession>();
    for (const s of incompleteSessions) {
      // 完了者と重複していれば除外（完了が優先）
      if (
        !uniqueCompleted.has(s.line_user_id) &&
        !uniqueIncomplete.has(s.line_user_id)
      ) {
        uniqueIncomplete.set(s.line_user_id, s);
      }
    }

    const incompleteList = Array.from(uniqueIncomplete.values());
    console.log(
      `  ユニーク途中離脱者（完了者除外）: ${incompleteList.length}人\n`,
    );

    for (let i = 0; i < incompleteList.length; i++) {
      const session = incompleteList[i];
      const progress = `[${i + 1}/${incompleteList.length}]`;

      const friend = await findFriendByLineUserId(session.line_user_id);
      if (!friend) {
        results.incomplete.notFound++;
        continue;
      }

      if (!dryRun && incompleteTagId) {
        try {
          await harnessPost(`/api/friends/${friend.id}/tags`, {
            tagId: incompleteTagId,
          });
          results.incomplete.tagged++;
          if ((i + 1) % 20 === 0 || i + 1 === incompleteList.length) {
            console.log(
              `  ⚠️  ${progress} ${friend.displayName} — 途中離脱タグ付与`,
            );
          }
        } catch (err) {
          results.incomplete.errors++;
        }
      } else if (dryRun) {
        console.log(
          `  [DRY] ${progress} ${friend.displayName} → 途中離脱タグ付与予定 (step: ${session.current_step})`,
        );
        results.incomplete.tagged++;
      }

      if (!dryRun && i % 10 === 9) await sleep(200);
    }
  }

  // ── 完了サマリー ────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  完了サマリー                                     ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(
    `║  ✅ 完了者 同期済み    : ${String(results.completed.synced).padEnd(20)} ║`,
  );
  console.log(
    `║  ⚠️  完了者 未登録     : ${String(results.completed.notFound).padEnd(20)} ║`,
  );
  console.log(
    `║  🔕 完了者 データ不足  : ${String(results.completed.skipped).padEnd(20)} ║`,
  );
  console.log(
    `║  ❌ 完了者 エラー      : ${String(results.completed.errors).padEnd(20)} ║`,
  );
  if (includeIncomplete) {
    console.log(
      `║  ⚠️  離脱者 タグ付与   : ${String(results.incomplete.tagged).padEnd(20)} ║`,
    );
    console.log(
      `║  🔍 離脱者 未登録     : ${String(results.incomplete.notFound).padEnd(20)} ║`,
    );
  }
  console.log("╚══════════════════════════════════════════════════╝");

  if (dryRun) {
    console.log("\n💡 実際に更新するには --dry-run を外して再実行してください");
  } else {
    console.log(
      "\n✅ 同期完了！LINE Harness のフレンド詳細で metadata を確認してください",
    );
    console.log(`   ${LINE_HARNESS_URL}/friends`);
  }

  console.log("\n📋 これで使えるようになる IF-THEN 条件:");
  console.log(`   conditionType: "tag_exists", tagName: "${TAG_COMPLETED}"`);
  console.log(`   → 水鏡完了者にだけメッセージ送信`);
  console.log(
    `   conditionType: "metadata_equals", key: "soul_name", value: "孤高の星"`,
  );
  console.log(`   → 特定の魂タイプにパーソナライズメッセージ`);
  console.log("\n📋 新規追加メタデータ変数:");
  console.log(
    `   {{metadata.mizukagami_user_words}}         — ユーザーの力強いフレーズ（JSON配列）`,
  );
  console.log(
    `   {{metadata.mizukagami_user_word_1}}        — 力強いフレーズ 1位（スカラー）`,
  );
  console.log(
    `   {{metadata.mizukagami_user_word_2}}        — 力強いフレーズ 2位（スカラー）`,
  );
  console.log(
    `   {{metadata.mizukagami_user_word_3}}        — 力強いフレーズ 3位（スカラー）`,
  );
  console.log(
    `   {{metadata.mizukagami_user_words_joined}}  — 力強いフレーズ「・」区切り文字列`,
  );
  console.log(
    `   {{metadata.mizukagami_power_pattern}}      — 最大5軸ラベル (hidden_gem/potential_type/...)`,
  );
  console.log(
    `   {{metadata.mizukagami_funnel_stage}}       — ファネルステージ（"0" = 診断完了）`,
  );
  console.log(
    `   {{metadata.mizukagami_concern}}            — 診断で語った一番の悩み`,
  );
  console.log(`   {{metadata.mizukagami_five_powers_strength}}  — 5軸: 力`);
  console.log(`   {{metadata.mizukagami_five_powers_potential}} — 5軸: 可能性`);
  console.log(`   {{metadata.mizukagami_five_powers_depth}}     — 5軸: 深み`);
  console.log(
    `   {{metadata.mizukagami_five_powers_hidden}}    — 5軸: 隠れた才能`,
  );
  console.log(
    `   {{metadata.mizukagami_five_powers_recognized}}— 5軸: 評価されている面`,
  );
  console.log(
    `   {{metadata.mizukagami_convergence_narrative}} — 12叡智収束の物語`,
  );
  console.log(
    `   {{metadata.mizukagami_keywords}}           — 診断キーワード（JSON配列）`,
  );
}

main().catch((err) => {
  console.error("\n💥 スクリプトがクラッシュしました:", err);
  process.exit(1);
});
