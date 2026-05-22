/**
 * Supabase → LINE Harness D1 直接 INSERT スクリプト
 * LINE プロフィール取得 → wrangler d1 execute で一括 INSERT
 */
import { execSync } from "child_process";

const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const SEGMENTS = [
  { prefix: "2025-12", name: "TikTok集客（コンサル）", color: "#FF6B6B" },
  { prefix: "2026-01", name: "水鏡GPT希望者（JSサミット①）", color: "#4ECDC4" },
  { prefix: "2026-02", name: "要調査（2026年2月）", color: "#FFE66D" },
  { prefix: "2026-03", name: "分身AI希望者（JSサミット②）", color: "#A8E6CF" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uuid() {
  return crypto.randomUUID();
}

function jstNow() {
  return new Date().toISOString();
}

function d1(sql) {
  const cmd = `CLOUDFLARE_API_TOKEN=${CF_TOKEN} npx wrangler d1 execute line-crm --env production --remote --json --command ${JSON.stringify(sql)}`;
  const result = execSync(cmd, {
    cwd: "/Users/shiryu/Shii/line-harness-oss/apps/worker",
    encoding: "utf8",
  });
  return JSON.parse(result);
}

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
  await sleep(60); // レート制限対策
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log("=== D1 直接 INSERT インポート開始 ===\n");

  // 1. Supabase から follow ユーザーを取得
  console.log("📥 Supabase から follow イベントを取得中...");
  const events = await supabase(
    "/line_webhook_events?event_type=eq.follow&select=line_user_id,received_at&order=received_at.asc&limit=1000",
  );
  const userMap = new Map();
  for (const e of events) {
    if (!userMap.has(e.line_user_id))
      userMap.set(e.line_user_id, e.received_at);
  }
  console.log(`  ユニークユーザー: ${userMap.size}人\n`);

  // 2. 既存の friends を確認
  const existingResult = d1("SELECT line_user_id FROM friends;");
  const existingIds = new Set(
    existingResult[0].results.map((r) => r.line_user_id),
  );
  console.log(`既存の友だち: ${existingIds.size}人\n`);

  // 3. 既存タグを確認・作成
  console.log("🏷️  タグを確認・作成中...");
  const existingTagsResult = d1("SELECT id, name FROM tags;");
  const existingTags = existingTagsResult[0].results;
  const tagIdMap = new Map();

  for (const seg of SEGMENTS) {
    const existing = existingTags.find((t) => t.name === seg.name);
    if (existing) {
      tagIdMap.set(seg.prefix, existing.id);
      console.log(`  ✓ 既存: ${seg.name}`);
    } else {
      const tagId = uuid();
      const now = jstNow();
      d1(
        `INSERT INTO tags (id, name, color, created_at) VALUES ('${tagId}', '${seg.name.replace(/'/g, "''")}', '${seg.color}', '${now}');`,
      );
      tagIdMap.set(seg.prefix, tagId);
      console.log(`  ✨ 作成: ${seg.name} → ${tagId}`);
    }
  }
  console.log();

  // 4. プロフィール取得 & INSERT
  console.log("👤 プロフィール取得 & D1 INSERT 中...\n");

  const users = Array.from(userMap.entries()).filter(
    ([uid]) => !existingIds.has(uid),
  );
  console.log(
    `  新規インポート対象: ${users.length}人（既存 ${existingIds.size}人はスキップ）\n`,
  );

  // バッチ処理（50件ずつ）
  const BATCH = 50;
  let imported = 0;
  let errors = 0;

  for (let b = 0; b < users.length; b += BATCH) {
    const batch = users.slice(b, b + BATCH);
    const inserts = [];
    const tagInserts = [];

    for (const [userId, receivedAt] of batch) {
      const profile = await lineProfile(userId);
      const month = receivedAt.slice(0, 7);
      const seg = SEGMENTS.find((s) => month.startsWith(s.prefix));

      const friendId = uuid();
      const displayName = (profile?.displayName ?? `不明(${month})`).replace(
        /'/g,
        "''",
      );
      const pictureUrl = profile?.pictureUrl ?? null;
      const statusMessage = (profile?.statusMessage ?? "").replace(/'/g, "''");
      const createdAt = receivedAt.replace("T", " ").replace("Z", "");

      inserts.push(
        `('${friendId}', '${userId}', '${displayName}', ${pictureUrl ? `'${pictureUrl}'` : "NULL"}, '${statusMessage}', 1, '${createdAt}', '${createdAt}')`,
      );

      if (seg) {
        const tagId = tagIdMap.get(seg.prefix);
        if (tagId) {
          tagInserts.push(`('${friendId}', '${tagId}', '${jstNow()}')`);
        }
      }
    }

    // friends 一括 INSERT
    if (inserts.length > 0) {
      try {
        const sql = `INSERT OR IGNORE INTO friends (id, line_user_id, display_name, picture_url, status_message, is_following, created_at, updated_at) VALUES ${inserts.join(",\n")};`;
        d1(sql);
        imported += inserts.length;
      } catch (e) {
        errors += inserts.length;
        console.log(`  ❌ バッチ INSERT エラー:`, e.message?.slice(0, 100));
      }
    }

    // friend_tags 一括 INSERT
    if (tagInserts.length > 0) {
      try {
        const tagSql = `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES ${tagInserts.join(",\n")};`;
        d1(tagSql);
      } catch (e) {
        console.log(`  ⚠️  タグ INSERT エラー:`, e.message?.slice(0, 100));
      }
    }

    const pct = Math.round(((b + batch.length) / users.length) * 100);
    console.log(
      `  [${pct}%] ${b + batch.length}/${users.length} — 済: ${imported} / エラー: ${errors}`,
    );
  }

  // 5. 最終確認
  const finalCount = d1("SELECT COUNT(*) as cnt FROM friends;")[0].results[0]
    .cnt;
  const tagCount = d1("SELECT COUNT(*) as cnt FROM friend_tags;")[0].results[0]
    .cnt;

  console.log("\n=== ✅ 完了 ===");
  console.log(`  D1 友だち総数: ${finalCount}人`);
  console.log(`  タグ付与総数: ${tagCount}件`);
  console.log("\nセグメント別タグ件数:");
  for (const seg of SEGMENTS) {
    const tagId = tagIdMap.get(seg.prefix);
    if (tagId) {
      const cnt = d1(
        `SELECT COUNT(*) as cnt FROM friend_tags WHERE tag_id = '${tagId}';`,
      )[0].results[0].cnt;
      console.log(`  ${seg.name}: ${cnt}人`);
    }
  }
}

main().catch(console.error);
