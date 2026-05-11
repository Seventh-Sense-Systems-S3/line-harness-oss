#!/usr/bin/env npx tsx
/**
 * パーソナライズ一斉送信 — 予告1通目 (7 Persona 拡張版)
 *
 * proposal 35711a90 (鬼洗練 v3 Round 2 構造美 12) の物理実装。
 *
 * Persona 優先順位（タグベース、上から先に判定）:
 *   P1. 水鏡_完了 → metadata から word_1/2/3 + soul_name + birth_month を verbatim 引用
 *   P2. 水鏡_step1stuck or _q1stuck → birth_month のみ、お詫び
 *   P3. 水鏡_中盤離脱_q2-q6 or _card直前stuck → partial verbatim + お詫び
 *   P4. 分身AI希望(JSサミット②) → 分身AI追伸 + 水鏡お詫び
 *   P5. 水鏡GPT希望(JSサミット①) → 水鏡GPT進化追伸
 *   P6. TikTok集客(コンサル) → TikTok/AI波追伸
 *   P7. その他 → シンプル + 水鏡お詫び
 *
 * Usage:
 *   source scripts/load-env.sh
 *   npx tsx scripts/personalized-broadcast-1.ts --dry-run
 *   npx tsx scripts/personalized-broadcast-1.ts --dry-run --limit 20
 *   npx tsx scripts/personalized-broadcast-1.ts --broadcast-id=<uuid>
 *   BROADCAST_ID=<uuid> npx tsx scripts/personalized-broadcast-1.ts
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

// broadcast_id を CLI 引数 or 環境変数から受け取る (任意)
const BROADCAST_ID =
  process.env.BROADCAST_ID ||
  process.argv.find((a) => a.startsWith("--broadcast-id="))?.split("=")[1] ||
  undefined;

if (!LINE_HARNESS_API_KEY) throw new Error("LINE_HARNESS_API_KEY が未設定です");

// ─── タグID ─────────────────────────────────────────────────────
const TAG = {
  bunshiAI: "32369f91-29e5-4f5b-ae3b-ca1c456c117a", // 分身AI希望者（JSサミット②）
  mizuGPT: "bc6bd6aa-bd1e-403f-a9c1-1692e554ee09", // 水鏡GPT希望者（JSサミット①）
  tiktok: "2e08552e-24df-4c8c-817e-adb68f5976bd", // TikTok集客（コンサル）
  mizuDone1: "242f9775-2019-45cd-a050-75295672c5aa", // 水鏡_完了
  mizuDone2: "60638916-1b40-4321-921f-7c3a9c8d65de", // 水鏡診断完了
  // TODO: LINE Harness API で GET /api/tags を叩いて取得、子竜に確認後置換
  mizuStep1Stuck: "98c16087-5d16-464a-9955-af8bcf0e1fc8", // 水鏡_step1stuck (Notion S02)
  mizuQ1Stuck: "17f1224f-949d-4634-b66a-07064c5a4c03", // 水鏡_q1stuck (Notion S02)
  mizuMiddleDropoff: "d09373c8-0384-417f-a9c9-ad17a816aee4", // 水鏡_中盤離脱_q2-q6 (Notion S04)
  mizuCardStuck: "63f611bf-b374-45cd-9b28-e574d878b446", // 水鏡_card直前stuck (Notion S03)
} as const;

// ─── メッセージ定義 ───────────────────────────────────────────────

const BASE_BODY = `㊙️【予告】限られた人だけに伝えます㊙️

突然ですが、今、みんながひっくり返るようなびっくり仰天なものを作ってます。

まさに、このAI時代だからこそ可能になりました。

いやー本当、すごい時代になりましたね。😄

これはあまりにも強力で、
あなたのビジネスのやり方そのものが変わる可能性が高いです。

🔥この方式でやってる人、日本にまだ誰もいません。✨

広める気もありません。限られた人だけが実行するからこそ
価値を最高に高く保つことができます。

なので、僕はこのLINEに登録してくれている人だけに
伝えるつもりです。

あなたもこれを聞いたら

「えー！？こんなことできるの！？（脳汁スパーク必至）」

となるとおもいます。

この詳細は2、3日後にまたお知らせしますので、
ぜひ楽しみにお待ちください。`;

const PS_BUNSHI = (name: string) =>
  `追伸：あの時「分身AIの作り方が知りたい」と手を挙げてくれましたよね。
いよいよです。
2、3日後のお知らせは、まさに${name}さんが待っていたものになります。
それまでの間、この期待感を楽しんでいてください。`;

const PS_MIZU_EVOLUTION = `追伸②：そして、以前体験してくれた水鏡も、さらに次の次元へと進化しています。
こちらも合わせて楽しみにしていてください。`;

const PS_MIZU_GPT = `追伸：以前、水鏡GPTを体験してくれましたよね。
あの水鏡が、さらに次の次元へと進化しています。
どんな進化なのか、2、3日後に詳しくお届けします。
楽しみにしていてください！`;

const PS_TIKTOK = (name: string) =>
  `追伸：${name}さんは、TikTokがまだ誰も注目していない頃から、
あの波に飛び込んだ人ですよね。
あの決断、本当にかっこよかったと思います。

今回のAIの波は、あの時と同じ匂いがします。
いや、規模はあの比じゃない。

まずは2、3日後のお知らせを楽しみにしていてください。`;

const SIGN_DEFAULT = `それではまた！

金本子竜`;

// 水鏡未完了タグ持ち全員に追加 — proposal 07285094 (ATSP)
// Notion: GW明け挽回キャンペーン 2026-05 SSOT より直書き予告 LINE
const PS_MIZU_APOLOGY = `追伸：水鏡診断が途中で止まってしまってできなかった方、ごめんなさい。
アクセス集中のためAPIクレジットが枯渇して強制停止になってしまっていました。
いま、さらに最強アップグレードをかけてるので、完成したらまたご連絡させて頂きますのでお楽しみに！`;

// ─── データ型 ────────────────────────────────────────────────────

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

type Group =
  | "P1_mizu_done"
  | "P2_mizu_step1stuck"
  | "P3_mizu_middle_dropoff"
  | "P4_bunshi"
  | "P5_mizu_gpt"
  | "P6_tiktok"
  | "P7_other";

// ─── metadata ヘルパー ───────────────────────────────────────────

// 生年月日から月だけ抽出 (YYYY-MM-DD → MM、YYYY/MM/DD、YYYYMMDD 等に対応)
function getBirthMonth(metadata: Record<string, string> | null): string | null {
  if (!metadata) return null;
  const birthDate =
    metadata.birth_date || metadata.birthday || metadata.birth_day;
  if (!birthDate) return null;
  const match = birthDate.match(/(?:^|\D)(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (match) return String(parseInt(match[2], 10)); // 04 → 4
  return null;
}

// metadata から verbatim 引用フィールド取得 (null safe)
function getVerbatim(metadata: Record<string, string> | null): {
  word1: string | null;
  word2: string | null;
  word3: string | null;
  soulName: string | null;
} {
  if (!metadata)
    return { word1: null, word2: null, word3: null, soulName: null };
  return {
    word1: metadata.mizukagami_user_word_1 || null,
    word2: metadata.mizukagami_user_word_2 || null,
    word3: metadata.mizukagami_user_word_3 || null,
    soulName: metadata.soul_name || null,
  };
}

// ─── グループ判定 ─────────────────────────────────────────────────

function classifyFriend(friend: HarnessFriend): {
  group: Group;
  metadata: Record<string, string> | null;
} {
  const tagIds = new Set(friend.tags.map((t) => t.id));
  const meta = friend.metadata;

  // P1: 水鏡完了 (mizuDone1 or mizuDone2)
  if (tagIds.has(TAG.mizuDone1) || tagIds.has(TAG.mizuDone2)) {
    return { group: "P1_mizu_done", metadata: meta };
  }
  // P2: 水鏡 step1stuck or q1stuck
  if (tagIds.has(TAG.mizuStep1Stuck) || tagIds.has(TAG.mizuQ1Stuck)) {
    return { group: "P2_mizu_step1stuck", metadata: meta };
  }
  // P3: 中盤離脱 or card直前stuck
  if (tagIds.has(TAG.mizuMiddleDropoff) || tagIds.has(TAG.mizuCardStuck)) {
    return { group: "P3_mizu_middle_dropoff", metadata: meta };
  }
  // P4: 分身AI希望
  if (tagIds.has(TAG.bunshiAI)) {
    return { group: "P4_bunshi", metadata: meta };
  }
  // P5: 水鏡GPT
  if (tagIds.has(TAG.mizuGPT)) {
    return { group: "P5_mizu_gpt", metadata: meta };
  }
  // P6: TikTok
  if (tagIds.has(TAG.tiktok)) {
    return { group: "P6_tiktok", metadata: meta };
  }
  // P7: その他
  return { group: "P7_other", metadata: meta };
}

// ─── メッセージ生成 ───────────────────────────────────────────────

function buildMessage(friend: HarnessFriend): {
  text: string;
  group: Group;
  label: string;
} {
  const name = friend.displayName ?? "あなた";
  const { group, metadata: meta } = classifyFriend(friend);

  let greeting: string;
  let body: string = BASE_BODY;
  let ps: string;
  let label: string;

  switch (group) {
    case "P1_mizu_done": {
      const { word1, word2, word3, soulName } = getVerbatim(meta);
      const birthMonth = getBirthMonth(meta);
      // 生年月日は現状 D1 に未 sync (水鏡 Supabase のみ保存)、soul_name 単独 fallback あり
      // soul_name はすでに「○○の魂」形式なので prefix は「の 」のみ (重複回避)
      const greetingPrefix =
        birthMonth && soulName
          ? `${birthMonth}月生まれ、${soulName}の `
          : soulName
            ? `${soulName}の `
            : birthMonth
              ? `${birthMonth}月生まれの `
              : "";
      greeting = `${greetingPrefix}${name}さんへ`;

      const verbatimBlock =
        word1 || word2 || word3
          ? `「${word1 || ""}」\n「${word2 || ""}」\n「${word3 || ""}」\n\nあの言葉、ちゃんと覚えています。`
          : "";

      body = verbatimBlock ? `${verbatimBlock}\n\n${BASE_BODY}` : BASE_BODY;
      ps = `追伸：水鏡を最後まで歩んでくれた${name}さんへ、2、3日後のお知らせは、まさにあなたにこそ届くものです。`;
      label = `P1 水鏡完了(${birthMonth ? birthMonth + "月" : "no-birth"}/${soulName || "no-soul"}) name=${name}`;
      break;
    }

    case "P2_mizu_step1stuck": {
      const birthMonth = getBirthMonth(meta);
      const greetingPrefix = birthMonth ? `${birthMonth}月生まれの ` : "";
      greeting = `${greetingPrefix}${name}さんへ`;
      // 個別お詫び 1 つで完結 (PS_MIZU_APOLOGY は P4-P7 用、二重お詫び防止)
      ps = `追伸：水鏡診断、生年月日を入れていただいた直後で止まってしまいましたよね。本当にごめんなさい。`;
      label = `P2 step1stuck${birthMonth ? `(${birthMonth}月)` : ""} name=${name}`;
      break;
    }

    case "P3_mizu_middle_dropoff": {
      const { word1, word2, word3 } = getVerbatim(meta);
      greeting = `${name}さんへ`;
      const verbatimBlock =
        word1 || word2 || word3
          ? `「${[word1, word2, word3].filter(Boolean).join("」「")}」\n\nあなたが残してくれた言葉、ちゃんと受け取っています。\n\n`
          : "";
      body = verbatimBlock ? `${verbatimBlock}${BASE_BODY}` : BASE_BODY;
      // 個別お詫び 1 つで完結 (PS_MIZU_APOLOGY は P4-P7 用、二重お詫び防止)
      ps = `追伸：水鏡診断、途中まで進んでくれたのに最後までお届けできなくてごめんなさい。`;
      label = `P3 middle_dropoff name=${name}${verbatimBlock ? " +verbatim" : ""}`;
      break;
    }

    case "P4_bunshi": {
      greeting = `以前、分身AI作りに興味があると教えてくれた${name}さんへ`;
      ps = [PS_BUNSHI(name), PS_MIZU_APOLOGY].filter(Boolean).join("\n\n");
      label = `P4 bunshi name=${name}`;
      break;
    }

    case "P5_mizu_gpt": {
      greeting = `${name}さんへ`;
      ps = PS_MIZU_GPT;
      label = `P5 mizu_gpt name=${name}`;
      break;
    }

    case "P6_tiktok": {
      greeting = `${name}さんへ`;
      ps = PS_TIKTOK(name);
      label = `P6 tiktok name=${name}`;
      break;
    }

    case "P7_other":
    default: {
      greeting = `${name}さんへ`;
      ps = PS_MIZU_APOLOGY;
      label = `P7 other name=${name}`;
      break;
    }
  }

  // 末尾署名は必ず付ける (PS から署名除去、ATSP の Snippet 分離原則)
  const parts = [greeting, body, ps, SIGN_DEFAULT].filter(Boolean);
  const text = parts.join("\n\n");

  return { text, group, label };
}

// ─── API ヘルパー ────────────────────────────────────────────────

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

// ─── メイン ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `🚀 パーソナライズBroadcast 1通目 (7 Persona)${isDryRun ? " [DRY-RUN]" : ""}`,
  );
  if (BROADCAST_ID) console.log(`   broadcast_id: ${BROADCAST_ID}`);
  console.log(`${"=".repeat(60)}\n`);

  // 全友達をページネーションで取得（tagsを含む）
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

  // グループ別集計（送信前にプレビュー）
  const grouped: Record<Group, number> = {
    P1_mizu_done: 0,
    P2_mizu_step1stuck: 0,
    P3_mizu_middle_dropoff: 0,
    P4_bunshi: 0,
    P5_mizu_gpt: 0,
    P6_tiktok: 0,
    P7_other: 0,
  };
  for (const f of allFriends) {
    grouped[classifyFriend(f).group]++;
  }
  console.log("📊 Persona 内訳:");
  console.log(`  P1 水鏡完了             : ${grouped.P1_mizu_done}人`);
  console.log(`  P2 step1/q1 stuck       : ${grouped.P2_mizu_step1stuck}人`);
  console.log(
    `  P3 中盤離脱/card stuck  : ${grouped.P3_mizu_middle_dropoff}人`,
  );
  console.log(`  P4 分身AI希望(JS②)      : ${grouped.P4_bunshi}人`);
  console.log(`  P5 水鏡GPT希望(JS①)     : ${grouped.P5_mizu_gpt}人`);
  console.log(`  P6 TikTok集客           : ${grouped.P6_tiktok}人`);
  console.log(`  P7 その他               : ${grouped.P7_other}人`);
  console.log();

  const targets = allFriends.slice(
    0,
    sendLimit === Infinity ? allFriends.length : sendLimit,
  );

  if (isDryRun) {
    console.log(
      `[DRY-RUN] ${targets.length}件プレビュー（各 Persona 先頭のみ表示）\n`,
    );
    const shown = new Set<Group>();
    for (const friend of targets) {
      const { text, group, label } = buildMessage(friend);
      if (!shown.has(group)) {
        shown.add(group);
        console.log(`${"─".repeat(60)}`);
        console.log(`[${label}]`);
        console.log(`friend_id: ${friend.id}`);
        console.log(`--- メッセージ全文 ---`);
        console.log(text);
        console.log();
      }
      if (shown.size === 7) break; // 全 Persona 表示したら終了
    }
    console.log(`\n✅ dry-run 完了。送信するには --dry-run を外してください。`);
    return;
  }

  // 本番送信
  const stats: Record<Group | "errors", number> = {
    P1_mizu_done: 0,
    P2_mizu_step1stuck: 0,
    P3_mizu_middle_dropoff: 0,
    P4_bunshi: 0,
    P5_mizu_gpt: 0,
    P6_tiktok: 0,
    P7_other: 0,
    errors: 0,
  };
  for (let i = 0; i < targets.length; i++) {
    const friend = targets[i];
    const { text, group } = buildMessage(friend);
    try {
      await harnessPush(friend.id, text, BROADCAST_ID);
      stats[group]++;
      process.stdout.write(
        `\r  [${i + 1}/${targets.length}] P1:${stats.P1_mizu_done} P2:${stats.P2_mizu_step1stuck} P3:${stats.P3_mizu_middle_dropoff} P4:${stats.P4_bunshi} P5:${stats.P5_mizu_gpt} P6:${stats.P6_tiktok} P7:${stats.P7_other} ❌:${stats.errors}`,
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
  console.log(`  P1 水鏡完了             : ${stats.P1_mizu_done}人`);
  console.log(`  P2 step1/q1 stuck       : ${stats.P2_mizu_step1stuck}人`);
  console.log(`  P3 中盤離脱/card stuck  : ${stats.P3_mizu_middle_dropoff}人`);
  console.log(`  P4 分身AI希望(JS②)      : ${stats.P4_bunshi}人`);
  console.log(`  P5 水鏡GPT希望(JS①)     : ${stats.P5_mizu_gpt}人`);
  console.log(`  P6 TikTok集客           : ${stats.P6_tiktok}人`);
  console.log(`  P7 その他               : ${stats.P7_other}人`);
  console.log(`  ❌ エラー               : ${stats.errors}件`);
}

main().catch(console.error);
