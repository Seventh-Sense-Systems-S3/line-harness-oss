/**
 * Supabase → D1 インポート（SQL ファイル経由）
 */
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SUPABASE_URL = "https://eizsilomeafyhftuvqst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WORKER_DIR = "/Users/shiryu/Shii/line-harness-oss/apps/worker";

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
function esc(s) {
  return (s ?? "").replace(/'/g, "''");
}

function runSqlFile(sqlPath) {
  const cmd = `CLOUDFLARE_API_TOKEN=${CF_TOKEN} npx wrangler d1 execute line-crm --env production --remote --file ${JSON.stringify(sqlPath)}`;
  try {
    execSync(cmd, {
      cwd: WORKER_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (e) {
    console.error(
      "  SQL エラー:",
      e.stderr?.slice(0, 200) || e.message?.slice(0, 200),
    );
    return false;
  }
}

function runCmd(sql) {
  const cmd = `CLOUDFLARE_API_TOKEN=${CF_TOKEN} npx wrangler d1 execute line-crm --env production --remote --json --command ${JSON.stringify(sql)}`;
  const result = execSync(cmd, {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
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
  await sleep(60);
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log("=== D1 直接 INSERT (SQLファイル方式) ===\n");

  // 1. Supabase
  console.log("📥 Supabase から取得中...");
  const events = await supabase(
    "/line_webhook_events?event_type=eq.follow&select=line_user_id,received_at&order=received_at.asc&limit=1000",
  );
  const userMap = new Map();
  for (const e of events) {
    if (!userMap.has(e.line_user_id))
      userMap.set(e.line_user_id, e.received_at);
  }
  console.log(`  ユニークユーザー: ${userMap.size}人\n`);

  // 2. 既存確認
  const existingResult = runCmd("SELECT line_user_id FROM friends;");
  const existingIds = new Set(
    existingResult[0].results.map((r) => r.line_user_id),
  );
  console.log(`既存の友だち: ${existingIds.size}人\n`);

  // 3. タグ確認・作成
  console.log("🏷️  タグを確認・作成中...");
  const existingTags = runCmd("SELECT id, name FROM tags;")[0].results;
  const tagIdMap = new Map();

  for (const seg of SEGMENTS) {
    const existing = existingTags.find((t) => t.name === seg.name);
    if (existing) {
      tagIdMap.set(seg.prefix, existing.id);
      console.log(`  ✓ 既存: ${seg.name} (${existing.id})`);
    } else {
      const tagId = uuid();
      const now = new Date().toISOString();
      const sqlFile = join(tmpdir(), `tag-${tagId}.sql`);
      writeFileSync(
        sqlFile,
        `INSERT INTO tags (id, name, color, created_at) VALUES ('${tagId}', '${esc(seg.name)}', '${seg.color}', '${now}');`,
      );
      runSqlFile(sqlFile);
      unlinkSync(sqlFile);
      tagIdMap.set(seg.prefix, tagId);
      console.log(`  ✨ 作成: ${seg.name} → ${tagId}`);
    }
  }
  console.log();

  // 4. プロフィール取得
  console.log("👤 LINE プロフィール取得中...");
  const newUsers = Array.from(userMap.entries()).filter(
    ([uid]) => !existingIds.has(uid),
  );
  console.log(`  新規対象: ${newUsers.length}人\n`);

  const records = [];
  for (let i = 0; i < newUsers.length; i++) {
    const [userId, receivedAt] = newUsers[i];
    const profile = await lineProfile(userId);
    const displayName = profile?.displayName ?? `不明_${userId.slice(-4)}`;
    const pictureUrl = profile?.pictureUrl ?? null;
    const statusMessage = profile?.statusMessage ?? "";
    const month = receivedAt.slice(0, 7);
    const seg = SEGMENTS.find((s) => month.startsWith(s.prefix));
    records.push({
      userId,
      receivedAt,
      displayName,
      pictureUrl,
      statusMessage,
      segPrefix: seg?.prefix ?? null,
    });

    if ((i + 1) % 50 === 0 || i + 1 === newUsers.length) {
      process.stdout.write(`\r  取得済: ${i + 1}/${newUsers.length}`);
    }
  }
  console.log("\n  プロフィール取得完了\n");

  // 5. SQL ファイルを生成して INSERT
  console.log("💾 D1 へ INSERT 中...");

  // friends INSERT (10件ずつ)
  const BATCH = 10;
  let imported = 0;
  let tagLinked = 0;

  for (let b = 0; b < records.length; b += BATCH) {
    const batch = records.slice(b, b + BATCH);
    const now = new Date().toISOString();

    // friends INSERT SQL
    const friendLines = batch.map((r) => {
      const fid = uuid();
      // このバッチの friend_id を記録
      r._friendId = fid;
      const createdAt = r.receivedAt.replace("T", " ").replace("Z", "");
      const pic = r.pictureUrl ? `'${esc(r.pictureUrl)}'` : "NULL";
      return `('${fid}', '${esc(r.userId)}', '${esc(r.displayName)}', ${pic}, '${esc(r.statusMessage)}', 1, '${createdAt}', '${createdAt}')`;
    });

    const friendSql = `INSERT OR IGNORE INTO friends (id, line_user_id, display_name, picture_url, status_message, is_following, created_at, updated_at) VALUES\n${friendLines.join(",\n")};`;
    const fPath = join(tmpdir(), `friends-batch-${b}.sql`);
    writeFileSync(fPath, friendSql, "utf8");
    const ok = runSqlFile(fPath);
    unlinkSync(fPath);
    if (ok) imported += batch.length;

    // friend_tags INSERT
    const tagLines = batch
      .filter((r) => r.segPrefix && tagIdMap.has(r.segPrefix))
      .map(
        (r) => `('${r._friendId}', '${tagIdMap.get(r.segPrefix)}', '${now}')`,
      );

    if (tagLines.length > 0) {
      const tagSql = `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES\n${tagLines.join(",\n")};`;
      const tPath = join(tmpdir(), `tags-batch-${b}.sql`);
      writeFileSync(tPath, tagSql, "utf8");
      const tok = runSqlFile(tPath);
      unlinkSync(tPath);
      if (tok) tagLinked += tagLines.length;
    }

    const pct = Math.round(((b + batch.length) / records.length) * 100);
    process.stdout.write(
      `\r  [${pct}%] ${Math.min(b + BATCH, records.length)}/${records.length} — friends:${imported} tags:${tagLinked}`,
    );
  }
  console.log("\n");

  // 6. 最終確認
  const finalFriends = runCmd("SELECT COUNT(*) as cnt FROM friends;")[0]
    .results[0].cnt;
  const finalTags = runCmd("SELECT COUNT(*) as cnt FROM friend_tags;")[0]
    .results[0].cnt;

  console.log("=== ✅ インポート完了 ===");
  console.log(`  D1 友だち総数: ${finalFriends}人`);
  console.log(`  タグ付与件数: ${finalTags}件\n`);
  console.log("セグメント別:");
  for (const seg of SEGMENTS) {
    const tagId = tagIdMap.get(seg.prefix);
    if (!tagId) continue;
    const cnt = runCmd(
      `SELECT COUNT(*) as cnt FROM friend_tags WHERE tag_id = '${tagId}';`,
    )[0].results[0].cnt;
    console.log(`  ${seg.name}: ${cnt}人`);
  }
}

main().catch(console.error);
