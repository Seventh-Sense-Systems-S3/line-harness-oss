/**
 * Supabase の line_webhook_events (follow) から友だちを LINE Harness D1 に一括インポート
 * セグメント別タグを自動付与する
 *
 * 実行: npx tsx scripts/import-friends-from-supabase.ts
 */

const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const LINE_HARNESS_API_KEY = process.env.LINE_HARNESS_API_KEY!;
const LINE_HARNESS_URL =
  process.env.LINE_HARNESS_URL ||
  "https://line-crm-worker.kyousuke10000.workers.dev";

// ── セグメント定義 ──────────────────────────────────────────────
const SEGMENTS: {
  prefix: string;
  tagName: string;
  color: string;
  description: string;
}[] = [
  {
    prefix: "2025-12",
    tagName: "TikTok集客（コンサル）",
    color: "#FF6B6B",
    description: "TikTok経由で登録・コンサル対象",
  },
  {
    prefix: "2026-01",
    tagName: "水鏡GPT希望者（JS①）",
    color: "#4ECDC4",
    description: "ジェームス・スキナーサミット①/QRコード登録/水鏡GPT利用希望",
  },
  {
    prefix: "2026-02",
    tagName: "要調査（2月）",
    color: "#FFE66D",
    description: "2026年2月登録/流入経路要調査",
  },
  {
    prefix: "2026-03",
    tagName: "分身AI希望者（JS②）",
    color: "#A8E6CF",
    description: "ジェームス・スキナーサミット②/分身AI作成希望/セミナー未受講",
  },
];

// ── ユーティリティ ──────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function supabaseFetch(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
    },
  });
  return res.json() as Promise<any[]>;
}

async function lineGetProfile(userId: string) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<{
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
  }>;
}

async function harnessPost(path: string, body: unknown) {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_HARNESS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function harnessGet(path: string) {
  const res = await fetch(`${LINE_HARNESS_URL}${path}`, {
    headers: { Authorization: `Bearer ${LINE_HARNESS_API_KEY}` },
  });
  return res.json();
}

// ── メイン処理 ──────────────────────────────────────────────────
async function main() {
  console.log("=== Supabase → LINE Harness インポート開始 ===\n");

  // 1. Supabase から全 follow イベントを取得
  console.log("📥 Supabase から follow イベントを取得中...");
  const events = await supabaseFetch(
    "/line_webhook_events?event_type=eq.follow&select=line_user_id,received_at&order=received_at.asc&limit=1000",
  );
  console.log(`  取得: ${events.length}件\n`);

  // 重複を除去（同一ユーザーの最初の follow を使用）
  const userMap = new Map<string, string>(); // userId -> received_at
  for (const e of events) {
    if (!userMap.has(e.line_user_id)) {
      userMap.set(e.line_user_id, e.received_at);
    }
  }
  console.log(`  ユニークユーザー: ${userMap.size}人\n`);

  // 2. タグを作成（既存は再利用）
  console.log("🏷️  タグを作成中...");
  const existingTagsRes = await harnessGet("/api/tags");
  const existingTags: { id: string; name: string }[] =
    existingTagsRes?.data || existingTagsRes || [];
  const tagIdMap = new Map<string, string>(); // tagName -> tagId

  for (const seg of SEGMENTS) {
    const existing = existingTags.find((t) => t.name === seg.tagName);
    if (existing) {
      tagIdMap.set(seg.tagName, existing.id);
      console.log(`  ✓ 既存タグ: ${seg.tagName} (${existing.id})`);
    } else {
      const res = await harnessPost("/api/tags", {
        name: seg.tagName,
        color: seg.color,
      });
      const tagId = res?.data?.id || res?.id;
      if (tagId) {
        tagIdMap.set(seg.tagName, tagId);
        console.log(`  ✨ 作成: ${seg.tagName} (${tagId})`);
      } else {
        console.log(`  ❌ タグ作成失敗: ${seg.tagName}`, res);
      }
    }
  }
  console.log();

  // 3. 既存の friends を取得（重複 INSERT 防止）
  console.log("👥 既存の友だちを確認中...");
  const existingFriendsRes = await harnessGet("/api/friends?limit=1000");
  const existingFriends: { id: string; line_user_id: string }[] =
    existingFriendsRes?.data || existingFriendsRes || [];
  const existingUserIds = new Set(existingFriends.map((f) => f.line_user_id));
  console.log(`  既存: ${existingUserIds.size}人\n`);

  // 4. 各ユーザーのプロフィールを取得して D1 に INSERT
  console.log("👤 プロフィール取得 & インポート中...");
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const users = Array.from(userMap.entries());

  for (let i = 0; i < users.length; i++) {
    const [userId, receivedAt] = users[i];

    // セグメント判定
    const month = receivedAt.slice(0, 7);
    const seg = SEGMENTS.find((s) => month.startsWith(s.prefix));

    // 既存チェック
    if (existingUserIds.has(userId)) {
      // 既存でもタグだけ付与する
      const existingFriend = existingFriends.find(
        (f) => f.line_user_id === userId,
      );
      if (existingFriend && seg) {
        const tagId = tagIdMap.get(seg.tagName);
        if (tagId) {
          await harnessPost(
            `/api/friends/${existingFriend.id}/tags/${tagId}`,
            {},
          );
        }
      }
      skipped++;
      continue;
    }

    // LINE プロフィール取得（レート制限対策: 50ms間隔）
    await sleep(50);
    const profile = await lineGetProfile(userId);

    if (!profile) {
      // プロフィール取得失敗（ブロック済みや退会など）→ 名前なしで登録
      console.log(
        `  ⚠️  [${i + 1}/${users.length}] プロフィール取得失敗: ${userId.slice(0, 15)}...`,
      );
    }

    // LINE Harness に友だち登録
    try {
      const friendRes = await harnessPost("/api/friends", {
        lineUserId: userId,
        displayName: profile?.displayName || `Unknown (${month})`,
        pictureUrl: profile?.pictureUrl || null,
        statusMessage: profile?.statusMessage || null,
        createdAt: receivedAt, // 元の登録日時を使用
      });

      const friendId =
        friendRes?.data?.id || friendRes?.friend?.id || friendRes?.id;

      if (friendId && seg) {
        const tagId = tagIdMap.get(seg.tagName);
        if (tagId) {
          await harnessPost(`/api/friends/${friendId}/tags/${tagId}`, {});
        }
      }

      imported++;
      if ((i + 1) % 20 === 0 || i + 1 === users.length) {
        console.log(
          `  [${i + 1}/${users.length}] ${imported}人インポート済み / ${skipped}人スキップ / ${errors}件エラー`,
        );
      }
    } catch (e) {
      errors++;
      console.log(`  ❌ エラー: ${userId}`, e);
    }
  }

  console.log("\n=== インポート完了 ===");
  console.log(`✅ 新規インポート: ${imported}人`);
  console.log(`⏭️  スキップ（既存）: ${skipped}人`);
  console.log(`❌ エラー: ${errors}件`);
  console.log("\nタグ別内訳:");
  for (const seg of SEGMENTS) {
    const count = Array.from(userMap.values()).filter((dt) =>
      dt.startsWith(seg.prefix),
    ).length;
    console.log(`  ${seg.tagName}: ${count}人`);
  }
}

main().catch(console.error);
