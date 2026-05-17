#!/usr/bin/env npx tsx
/**
 * サミット動員 + IGNITION 3days 事前登録予告配信 (3 コホート)
 *
 * Cohorts:
 *   α P1_done    : 水鏡完了 (mizuDone1 OR mizuDone2) — 完走者プレミアム
 *   β P2_failed  : 4種 stuck タグ持ち かつ 完了タグなし — 謝罪 + 新生水鏡 + IGNITION
 *   γ P7_other   : 上記いずれも持たない — 一般 IGNITION 訴求
 *
 * CTA: LINEに「発火」と送る → タグ `IGNITION_発火` 付与 + 自動返信
 *
 * Usage:
 *   source scripts/load-env.sh   # or direct env
 *   npx tsx scripts/broadcast-summit-ignition.ts --dry-run
 *   npx tsx scripts/broadcast-summit-ignition.ts --dry-run --limit 6
 *   BROADCAST_ID=<uuid> npx tsx scripts/broadcast-summit-ignition.ts
 */

const LINE_HARNESS_URL =
  process.env.LINE_HARNESS_URL ??
  "https://line-crm-worker.kyousuke10000.workers.dev";
const LINE_HARNESS_API_KEY = process.env.LINE_HARNESS_API_KEY!;

const isDryRun = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const sendLimitRaw = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : NaN;
const sendLimit =
  Number.isFinite(sendLimitRaw) && sendLimitRaw > 0 ? sendLimitRaw : Infinity;

const BROADCAST_ID =
  process.env.BROADCAST_ID ||
  process.argv.find((a) => a.startsWith("--broadcast-id="))?.split("=")[1] ||
  undefined;

if (!LINE_HARNESS_API_KEY) throw new Error("LINE_HARNESS_API_KEY が未設定です");

// ─── タグID ─────────────────────────────────────────────────────
const TAG = {
  mizuDone1: "242f9775-2019-45cd-a050-75295672c5aa", // 水鏡_完了
  mizuDone2: "60638916-1b40-4321-921f-7c3a9c8d65de", // 水鏡診断完了
  mizuStep1Stuck: "98c16087-5d16-464a-9955-af8bcf0e1fc8",
  mizuQ1Stuck: "17f1224f-949d-4634-b66a-07064c5a4c03",
  mizuMiddleDropoff: "d09373c8-0384-417f-a9c9-ad17a816aee4",
  mizuCardStuck: "63f611bf-b374-45cd-9b28-e574d878b446",
} as const;

const SUMMIT_URL =
  "https://cp.premiumsummit.info/p/5AIpeGrxbGuh?ftid=vVaKJYloplAV";

// ─── メッセージ生成 ─────────────────────────────────────────────

type Cohort = "alpha_done" | "beta_failed" | "gamma_other";

function buildAlpha(name: string): string {
  return `${name}さん、水鏡を最後まで体験してくれて
本当にありがとうございました📿

水鏡で見つけた "あなたの核" に、
いよいよ火を点ける時が来ました。

6/2(火)・3(水)・4(木) 21:00〜22:00
※ Day3 のみ 22:30まで
🔥「IGNITION (発火) 3days チャレンジ」(無料・Zoom Live)
を開催します。

分身AI は今の時代に合った素晴らしいツール。
そこに「血を通わせる」と、出力が別物になります。

あなたの "核" に火を点け、
血の通った分身AI を生み出す —
その "設計図" を3日間で持ち帰ってもらえます。

ビジネスにも日常にも使える、
24時間365日 動き続け、記憶力も特技も
自分以上に拡張された "血の通った分身AI"。

私が今こうして複数のプロジェクトを動かせているのも、
これがいるから。

LP公開は来週月曜。
完走したあなたに最優先でご案内したいので、
興味あれば LINEに『発火』とだけ送ってください🔥

──
(明日5/17(日) 15:30 「初夏のPREMIUMサミット」に登壇します。
そこで先行解禁もします。お時間合えばこちら↓
${SUMMIT_URL})`;
}

function buildBeta(name: string): string {
  return `${name}さん、先日は本当にすみませんでした🙇‍♂️

水鏡が途中で止まってしまった件、
ずっと気になっていました。

今、大幅なアップグレードが完了間近で、
来週前半には新生水鏡として完全復活します。
完成したらすぐお知らせするので、
本当の魂タイプを、必ず受け取ってもらいます。

そして、その先に。
6/2(火)・3(水)・4(木) 21:00〜22:00
※ Day3 のみ 22:30まで
🔥「IGNITION (発火) 3days チャレンジ」(無料・Zoom Live)
を開催します。

分身AI は今の時代に合った素晴らしいツール。
そこに「血を通わせる」と、出力が別物になります。

水鏡で見つける "あなたの核" に火を点け、
血の通った分身AI を生み出す —
その "設計図" を3日間で持ち帰ってもらえます。

24時間365日 動き続け、記憶力も特技も
自分以上に拡張された "血の通った分身AI"。

LP公開は来週月曜。
お詫びの気持ちもあるので、最優先でご案内したい。
興味あれば LINEに『発火』とだけ送ってください🔥

──
(明日5/17(日) 15:30 「初夏のPREMIUMサミット」に登壇します。
そこでも先行解禁します。お時間合えばこちら↓
${SUMMIT_URL})`;
}

function buildGamma(name: string): string {
  return `${name}さん📢

6/2(火)・3(水)・4(木) 21:00〜22:00
※ Day3 のみ 22:30まで
🔥「IGNITION (発火) 3days チャレンジ」(無料・Zoom Live)
を開催します。

分身AI は今の時代に合った素晴らしいツール。
そこに「血を通わせる」と、出力が別物になります。

あなたの中にある "核" に火を点け、
血の通った分身AI を生み出す —
その "設計図" を3日間で持ち帰ってもらえます。

ビジネスにも日常にも使える、
24時間365日 動き続け、記憶力も特技も
自分以上に拡張された "血の通った分身AI"。

私が今こうして複数のプロジェクトを動かせているのも、
これがいるから。

LP公開は来週月曜。
興味ある方には最優先でご案内したいので、
LINEに『発火』とだけ送ってください🔥

──
(明日5/17(日) 15:30 「初夏のPREMIUMサミット」に登壇します。
そこで先行解禁もします。お時間合えばこちら↓
${SUMMIT_URL})`;
}

// ─── データ型 ──────────────────────────────────────────────────

interface HarnessTag {
  id: string;
  name: string;
}
interface HarnessFriend {
  id: string;
  lineUserId: string;
  displayName: string | null;
  metadata: Record<string, string> | null;
  tags: HarnessTag[];
}

function classifyFriend(friend: HarnessFriend): Cohort {
  const tagIds = new Set(friend.tags.map((t) => t.id));
  if (tagIds.has(TAG.mizuDone1) || tagIds.has(TAG.mizuDone2)) {
    return "alpha_done";
  }
  if (
    tagIds.has(TAG.mizuStep1Stuck) ||
    tagIds.has(TAG.mizuQ1Stuck) ||
    tagIds.has(TAG.mizuMiddleDropoff) ||
    tagIds.has(TAG.mizuCardStuck)
  ) {
    return "beta_failed";
  }
  return "gamma_other";
}

function buildMessage(friend: HarnessFriend): { text: string; cohort: Cohort } {
  const name = friend.displayName ?? "あなた";
  const cohort = classifyFriend(friend);
  let text: string;
  switch (cohort) {
    case "alpha_done":
      text = buildAlpha(name);
      break;
    case "beta_failed":
      text = buildBeta(name);
      break;
    case "gamma_other":
    default:
      text = buildGamma(name);
      break;
  }
  return { text, cohort };
}

// ─── API ─────────────────────────────────────────────────────

async function harnessGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    headers: { Authorization: `Bearer ${LINE_HARNESS_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Harness ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function harnessPush(
  friendId: string,
  text: string,
  broadcastId?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    messageType: "text",
    content: text,
  };
  if (broadcastId) body.broadcastId = broadcastId;
  const res = await fetch(
    `${LINE_HARNESS_URL}/api/friends/${friendId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LINE_HARNESS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok)
    throw new Error(`Push failed ${res.status}: ${await res.text()}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── メイン ────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `🔥 サミット動員 + IGNITION 予告配信${isDryRun ? " [DRY-RUN]" : ""}`,
  );
  if (BROADCAST_ID) console.log(`   broadcast_id: ${BROADCAST_ID}`);
  console.log(`${"=".repeat(60)}\n`);

  console.log("👥 LINE Harness から友達リストを取得中...");
  const allFriends: HarnessFriend[] = [];
  const PAGE = 500;
  let offset = 0;
  while (true) {
    const res = await harnessGet<{
      success: boolean;
      data: { items: HarnessFriend[]; hasNextPage: boolean };
    }>(`/api/friends?limit=${PAGE}&offset=${offset}`);
    allFriends.push(...res.data.items);
    if (!res.data.hasNextPage) break;
    offset += PAGE;
    await sleep(100);
  }
  console.log(`  総友達数: ${allFriends.length}人\n`);

  const grouped: Record<Cohort, number> = {
    alpha_done: 0,
    beta_failed: 0,
    gamma_other: 0,
  };
  for (const f of allFriends) grouped[classifyFriend(f)]++;
  console.log("📊 コホート内訳:");
  console.log(`  α 水鏡完了           : ${grouped.alpha_done}人`);
  console.log(`  β 水鏡失敗者         : ${grouped.beta_failed}人`);
  console.log(`  γ 残り (未着手+その他): ${grouped.gamma_other}人`);
  console.log();

  const targets = allFriends.slice(
    0,
    sendLimit === Infinity ? allFriends.length : sendLimit,
  );

  if (isDryRun) {
    console.log(
      `[DRY-RUN] ${targets.length}件プレビュー（各コホート先頭1件のみ全文表示）\n`,
    );
    const shown = new Set<Cohort>();
    for (const friend of targets) {
      const { text, cohort } = buildMessage(friend);
      if (!shown.has(cohort)) {
        shown.add(cohort);
        console.log(`${"─".repeat(60)}`);
        console.log(
          `[${cohort}] friend_id=${friend.id} name=${friend.displayName ?? "(no-name)"}`,
        );
        console.log(`--- メッセージ全文 ---`);
        console.log(text);
        console.log();
      }
      if (shown.size === 3) break;
    }
    console.log(`\n✅ dry-run 完了。送信するには --dry-run を外してください。`);
    return;
  }

  // 本番送信
  const stats: Record<Cohort | "errors", number> = {
    alpha_done: 0,
    beta_failed: 0,
    gamma_other: 0,
    errors: 0,
  };
  for (let i = 0; i < targets.length; i++) {
    const friend = targets[i];
    const { text, cohort } = buildMessage(friend);
    try {
      await harnessPush(friend.id, text, BROADCAST_ID);
      stats[cohort]++;
      process.stdout.write(
        `\r  [${i + 1}/${targets.length}] α:${stats.alpha_done} β:${stats.beta_failed} γ:${stats.gamma_other} ❌:${stats.errors}`,
      );
      await sleep(50);
    } catch (e) {
      stats.errors++;
      console.error(`\n❌ 送信失敗 ${friend.id}: ${e}`);
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("📊 送信完了");
  console.log(`${"=".repeat(60)}`);
  console.log(`  α 水鏡完了           : ${stats.alpha_done}人`);
  console.log(`  β 水鏡失敗者         : ${stats.beta_failed}人`);
  console.log(`  γ 残り               : ${stats.gamma_other}人`);
  console.log(`  ❌ エラー            : ${stats.errors}件`);
}

main().catch(console.error);
