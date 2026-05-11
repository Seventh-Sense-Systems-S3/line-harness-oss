#!/usr/bin/env npx tsx
/**
 * パーソナライズ一斉送信 — 予告1通目
 *
 * グループ優先度（タグベース）:
 *   G1. 分身AI希望者（JSサミット②） → 分身AIいよいよ追伸
 *       ↳ + 水鏡_完了タグも持つ場合 → 水鏡進化追伸も追加
 *   G2. 水鏡GPT希望者（JSサミット①） → 水鏡GPT進化追伸（全員同じ）
 *   G3. TikTok集客（コンサル） → TikTok/AI波追伸
 *   G4. その他 → 追伸なし
 *
 * Usage:
 *   source scripts/load-env.sh
 *   npx tsx scripts/personalized-broadcast-1.ts --dry-run
 *   npx tsx scripts/personalized-broadcast-1.ts --dry-run --limit 20
 *   npx tsx scripts/personalized-broadcast-1.ts
 */

const LINE_HARNESS_URL =
  process.env.LINE_HARNESS_URL ??
  "https://line-crm-worker.kyousuke10000.workers.dev";
const LINE_HARNESS_API_KEY = process.env.LINE_HARNESS_API_KEY!;

const isDryRun = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const sendLimit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;

if (!LINE_HARNESS_API_KEY) throw new Error("LINE_HARNESS_API_KEY が未設定です");

// ─── タグID ─────────────────────────────────────────────────────
const TAG = {
  bunshiAI: "32369f91-29e5-4f5b-ae3b-ca1c456c117a", // 分身AI希望者（JSサミット②）
  mizuGPT: "bc6bd6aa-bd1e-403f-a9c1-1692e554ee09", // 水鏡GPT希望者（JSサミット①）
  tiktok: "2e08552e-24df-4c8c-817e-adb68f5976bd", // TikTok集客（コンサル）
  mizuDone1: "242f9775-2019-45cd-a050-75295672c5aa", // 水鏡_完了
  mizuDone2: "60638916-1b40-4321-921f-7c3a9c8d65de", // 水鏡診断完了
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

type Group = "G1_bunshi" | "G2_mizu_gpt" | "G3_tiktok" | "G4_other";

// ─── グループ判定 ─────────────────────────────────────────────────

function classifyFriend(friend: HarnessFriend): {
  group: Group;
  hasMizuDone: boolean;
} {
  const tagIds = new Set(friend.tags.map((t) => t.id));
  const hasMizuDone = tagIds.has(TAG.mizuDone1) || tagIds.has(TAG.mizuDone2);

  if (tagIds.has(TAG.bunshiAI)) return { group: "G1_bunshi", hasMizuDone };
  if (tagIds.has(TAG.mizuGPT)) return { group: "G2_mizu_gpt", hasMizuDone };
  if (tagIds.has(TAG.tiktok)) return { group: "G3_tiktok", hasMizuDone };
  return { group: "G4_other", hasMizuDone };
}

// ─── メッセージ生成 ───────────────────────────────────────────────

function buildMessage(friend: HarnessFriend): {
  text: string;
  group: Group;
  label: string;
} {
  const name = friend.displayName ?? "あなた";
  const { group, hasMizuDone } = classifyFriend(friend);

  let greeting: string;
  let ps: string;

  switch (group) {
    case "G1_bunshi":
      greeting = `以前、分身AI作りに興味があると教えてくれた${name}さんへ`;
      ps = [PS_BUNSHI(name), hasMizuDone ? PS_MIZU_EVOLUTION : ""]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "G2_mizu_gpt":
      greeting = `${name}さんへ`;
      ps = PS_MIZU_GPT;
      break;

    case "G3_tiktok":
      greeting = `${name}さんへ`;
      ps = PS_TIKTOK(name);
      break;

    case "G4_other":
    default:
      greeting = `${name}さんへ`;
      ps = "";
      break;
  }

  // 水鏡未完了タグ持ち全員に「お詫び追伸」を追加 (proposal 07285094 ATSP)
  if (!hasMizuDone) {
    ps = [ps, PS_MIZU_APOLOGY].filter(Boolean).join("\n\n");
  }

  // 末尾署名は必ず付ける (PS から署名除去、ATSP の Snippet 分離原則)
  const parts = [greeting, BASE_BODY, ps, SIGN_DEFAULT].filter(Boolean);
  const text = parts.join("\n\n");

  const label = `${group}${hasMizuDone ? "+水鏡完了" : ""} name=${name}`;
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

async function harnessPush(friendId: string, text: string): Promise<void> {
  const res = await fetch(
    `${LINE_HARNESS_URL}/api/friends/${friendId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LINE_HARNESS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageType: "text", content: text }),
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
    `🚀 パーソナライズBroadcast 1通目${isDryRun ? " [DRY-RUN]" : ""}`,
  );
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
  const grouped = { G1_bunshi: 0, G2_mizu_gpt: 0, G3_tiktok: 0, G4_other: 0 };
  for (const f of allFriends) {
    grouped[classifyFriend(f).group]++;
  }
  console.log("📊 グループ内訳:");
  console.log(`  G1 分身AI希望者      : ${grouped.G1_bunshi}人`);
  console.log(`  G2 水鏡GPT希望者(JS①): ${grouped.G2_mizu_gpt}人`);
  console.log(`  G3 TikTok集客        : ${grouped.G3_tiktok}人`);
  console.log(`  G4 その他            : ${grouped.G4_other}人`);
  console.log();

  const targets = allFriends.slice(
    0,
    sendLimit === Infinity ? allFriends.length : sendLimit,
  );

  if (isDryRun) {
    console.log(
      `[DRY-RUN] ${targets.length}件プレビュー（各グループ先頭のみ表示）\n`,
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
      if (shown.size === 4) break; // 全グループ表示したら終了
    }
    console.log(`\n✅ dry-run 完了。送信するには --dry-run を外してください。`);
    return;
  }

  // 本番送信
  const stats = { G1: 0, G2: 0, G3: 0, G4: 0, errors: 0 };
  for (let i = 0; i < targets.length; i++) {
    const friend = targets[i];
    const { text, group } = buildMessage(friend);
    try {
      await harnessPush(friend.id, text);
      if (group === "G1_bunshi") stats.G1++;
      else if (group === "G2_mizu_gpt") stats.G2++;
      else if (group === "G3_tiktok") stats.G3++;
      else stats.G4++;
      process.stdout.write(
        `\r  [${i + 1}/${targets.length}] G1:${stats.G1} G2:${stats.G2} G3:${stats.G3} G4:${stats.G4} ❌:${stats.errors}`,
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
  console.log(`  G1 分身AI     : ${stats.G1}人`);
  console.log(`  G2 水鏡GPT    : ${stats.G2}人`);
  console.log(`  G3 TikTok     : ${stats.G3}人`);
  console.log(`  G4 その他     : ${stats.G4}人`);
  console.log(`  ❌ エラー     : ${stats.errors}件`);
}

main().catch(console.error);
