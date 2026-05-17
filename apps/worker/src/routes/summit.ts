/**
 * SUMMIT_20260517 live-demo push endpoint — POST /summit/push
 *
 * サミット会場で Hermes (子竜の分身 AI 自律実行層) が curl で叩き、
 * SUMMIT タグ持ち友達の line_user_id 配列に対して任意のメッセージを
 * 並列 push する。観客 100 人想定 (LINE Bot Push API 100req/s 制限内)。
 *
 * 認証: Authorization: Bearer ${API_KEY} (auth middleware は /api/ 配下しか
 * 自動チェックしないので、本ルートでは入口で明示的に Bearer 検証する)。
 *
 * Body:
 *   {
 *     line_user_ids: string[],   // 配信対象 (非空)
 *     message: string,           // テキスト本文
 *     followup_tag?: string,     // "pain" / "vision" / "confusion" / "specific" (ログ用)
 *   }
 *
 * Response (200 / 207 partial):
 *   { sent: number, failed: number, errors: Array<{ line_user_id, error }> }
 *
 * サミット後は撤去する (本 file は 2026-05-17 限定のライブデモ用)。
 */
import { Hono } from "hono";
import { LineClient } from "@line-crm/line-sdk";
import type { Env } from "../index.js";

const summit = new Hono<Env>();

type SummitPushBody = {
  line_user_ids?: unknown;
  message?: unknown;
  followup_tag?: unknown;
};

summit.post("/summit/push", async (c) => {
  // ─── 1. 明示的 Bearer 認証 (auth middleware は /api/ 配下のみ自動適用) ───
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice("Bearer ".length);
  if (token !== c.env.API_KEY) {
    // LEGACY_API_KEY フォールバック (auth.ts と同じ rotation 思想)
    if (
      !c.env.LEGACY_API_KEY ||
      c.env.LEGACY_API_KEY === c.env.API_KEY ||
      token !== c.env.LEGACY_API_KEY
    ) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    console.log("[summit-push] accept_via=LEGACY_API_KEY");
  }

  // ─── 2. LINE_CHANNEL_ACCESS_TOKEN 存在チェック ───
  if (!c.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("[summit-push] LINE_CHANNEL_ACCESS_TOKEN missing");
    return c.json(
      { success: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" },
      500,
    );
  }

  // ─── 3. body validation ───
  let body: SummitPushBody;
  try {
    body = await c.req.json<SummitPushBody>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const lineUserIds = body.line_user_ids;
  const message = body.message;
  const followupTag =
    typeof body.followup_tag === "string" ? body.followup_tag : undefined;

  if (!Array.isArray(lineUserIds) || lineUserIds.length === 0) {
    return c.json(
      { success: false, error: "line_user_ids must be a non-empty array" },
      400,
    );
  }
  if (typeof message !== "string" || message.length === 0) {
    return c.json(
      { success: false, error: "message must be a non-empty string" },
      400,
    );
  }
  // line_user_ids の各要素が string であることを保証
  const userIds: string[] = [];
  for (const u of lineUserIds) {
    if (typeof u !== "string" || u.length === 0) {
      return c.json(
        {
          success: false,
          error: "line_user_ids must contain non-empty strings",
        },
        400,
      );
    }
    userIds.push(u);
  }

  console.log(
    `[summit-push] dispatch target=${userIds.length} followup_tag=${followupTag ?? "-"} msg_len=${message.length}`,
  );

  // ─── 4. 並列 push (Promise.allSettled で部分失敗を許容) ───
  // 既存 LineClient.pushMessage を使う。default access token は本番 OA 用。
  const client = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const results = await Promise.allSettled(
    userIds.map((to) =>
      client.pushMessage(to, [{ type: "text", text: message }]),
    ),
  );

  let sent = 0;
  let failed = 0;
  const errors: Array<{ line_user_id: string; error: string }> = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      sent += 1;
    } else {
      failed += 1;
      const errMsg =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push({ line_user_id: userIds[idx], error: errMsg });
      console.error(
        `[summit-push] push failed userId=${userIds[idx]} err=${errMsg}`,
      );
    }
  });

  console.log(
    `[summit-push] complete sent=${sent} failed=${failed} followup_tag=${followupTag ?? "-"}`,
  );

  // ─── 5. summit_demo_inbox に followup 記録 (任意・ログのみ・migration なし) ───
  // 既存 summit_demo_inbox スキーマに followup 列が無いので今日は **ログのみ**。
  // 将来 migration で hermes_followup_tag / hermes_followup_message_id を追加するまで
  // ここでは触らない (応急処置で schema を壊さない原則)。
  if (followupTag) {
    console.log(
      `[summit-push] followup_tag=${followupTag} (note: no DB write — schema migration deferred)`,
    );
  }

  // ─── 6. レスポンス: 全成功なら 200、部分失敗なら 207、全滅は 200 で sent=0 ───
  // (全滅でも HTTP 500 は返さない。caller (Hermes) が sent/failed を見て判断する)
  const status = failed === 0 ? 200 : 207;
  return c.json(
    {
      success: failed === 0,
      sent,
      failed,
      errors,
    },
    status,
  );
});

export { summit };
