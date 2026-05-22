/**
 * Supabase → LINE Harness D1 友だち一括インポート
 * セグメント別タグを自動付与
 */

const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const API_KEY = process.env.LINE_HARNESS_API_KEY;
const HARNESS_URL = "https://line-crm-worker.kyousuke10000.workers.dev";

const SEGMENTS = [
  { prefix: "2025-12", name: "TikTok集客（コンサル）", color: "#FF6B6B" },
  { prefix: "2026-01", name: "水鏡GPT希望者（JSサミット①）", color: "#4ECDC4" },
  { prefix: "2026-02", name: "要調査（2026年2月）", color: "#FFE66D" },
  { prefix: "2026-03", name: "分身AI希望者（JSサミット②）", color: "#A8E6CF" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
    },
  });
  return res.json();
}

async function lineProfile(userId) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function api(method, path, body) {
  const res = await fetch(`${HARNESS_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  console.log("=== Supabase → LINE Harness インポート開始 ===\n");

  // ── STEP 1: Supabase から follow ユーザーを取得 ─────────────
  console.log("📥 Supabase から follow イベントを取得中...");
  const events = await supabase(
    "/line_webhook_events?event_type=eq.follow&select=line_user_id,received_at&order=received_at.asc&limit=1000",
  );

  // 重複除去（最初のfollow日時を使用）
  const userMap = new Map();
  for (const e of events) {
    if (!userMap.has(e.line_user_id))
      userMap.set(e.line_user_id, e.received_at);
  }
  console.log(`  ユニークユーザー: ${userMap.size}人\n`);

  // ── STEP 2: タグを作成（テストタグ削除 + 本番タグ作成） ────
  console.log("🏷️  タグを準備中...");

  // 既存タグ取得
  const tagsRes = await api("GET", "/api/tags");
  const existingTags = tagsRes?.data || [];

  // テストタグを削除
  for (const t of existingTags) {
    if (t.name === "テストタグ") {
      await api("DELETE", `/api/tags/${t.id}`);
      console.log(`  🗑️  テストタグを削除`);
    }
  }

  const tagIdMap = new Map(); // name -> id

  for (const seg of SEGMENTS) {
    const existing = existingTags.find(
      (t) => t.name === seg.name && t.name !== "テストタグ",
    );
    if (existing) {
      tagIdMap.set(seg.name, existing.id);
      console.log(`  ✓ 既存: ${seg.name}`);
    } else {
      const res = await api("POST", "/api/tags", {
        name: seg.name,
        color: seg.color,
      });
      const id = res?.data?.id;
      if (id) {
        tagIdMap.set(seg.name, id);
        console.log(`  ✨ 作成: ${seg.name} → ${id}`);
      } else {
        console.log(`  ❌ タグ作成失敗: ${seg.name}`, JSON.stringify(res));
      }
    }
  }
  console.log();

  // ── STEP 3: 既存の friends を確認 ──────────────────────────
  console.log("👥 既存の友だちを確認中...");
  const existingRes = await api("GET", "/api/friends?limit=1000");
  const existingFriends = existingRes?.data?.items || [];
  const existingMap = new Map(existingFriends.map((f) => [f.lineUserId, f]));
  console.log(`  既存: ${existingMap.size}人\n`);

  // ── STEP 4: プロフィール取得 & INSERT ──────────────────────
  console.log("👤 プロフィール取得 & インポート中...\n");

  let imported = 0,
    skipped = 0,
    tagOnly = 0,
    errors = 0;
  const users = Array.from(userMap.entries());

  for (let i = 0; i < users.length; i++) {
    const [userId, receivedAt] = users[i];
    const month = receivedAt.slice(0, 7);
    const seg = SEGMENTS.find((s) => month.startsWith(s.prefix));
    const tagId = seg ? tagIdMap.get(seg.name) : null;

    // 既存ユーザー → タグだけ付与してスキップ
    if (existingMap.has(userId)) {
      const f = existingMap.get(userId);
      if (tagId) {
        await api("POST", `/api/friends/${f.id}/tags`, { tagId });
        tagOnly++;
      }
      skipped++;
      continue;
    }

    // LINE プロフィール取得（50ms 間隔でレート制限回避）
    await sleep(50);
    const profile = await lineProfile(userId);

    // 友だち登録
    try {
      const createRes = await api("POST", "/api/friends", {
        lineUserId: userId,
        displayName: profile?.displayName ?? `不明 (${month}入会)`,
        pictureUrl: profile?.pictureUrl ?? null,
        statusMessage: profile?.statusMessage ?? null,
      });

      const friendId =
        createRes?.data?.id ?? createRes?.friend?.id ?? createRes?.id;

      if (friendId && tagId) {
        await api("POST", `/api/friends/${friendId}/tags`, { tagId });
      }

      imported++;
    } catch (e) {
      errors++;
      console.log(`  ❌ [${userId.slice(0, 12)}] エラー: ${e.message}`);
    }

    // 進捗表示（20件ごと）
    if ((i + 1) % 20 === 0 || i + 1 === users.length) {
      const pct = Math.round(((i + 1) / users.length) * 100);
      console.log(
        `  [${pct}%] ${i + 1}/${users.length} — 新規: ${imported} / スキップ: ${skipped} / エラー: ${errors}`,
      );
    }
  }

  // ── 結果サマリー ────────────────────────────────────────────
  console.log("\n=== ✅ インポート完了 ===");
  console.log(`  新規インポート : ${imported}人`);
  console.log(`  タグ付与のみ   : ${tagOnly}人（既存）`);
  console.log(`  エラー         : ${errors}件`);
  console.log("\nセグメント別:");
  for (const seg of SEGMENTS) {
    const cnt = Array.from(userMap.values()).filter((d) =>
      d.startsWith(seg.prefix),
    ).length;
    console.log(`  ${seg.name}: ${cnt}人`);
  }
}

main().catch(console.error);
