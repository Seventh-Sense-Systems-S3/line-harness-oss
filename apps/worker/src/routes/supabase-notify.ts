import { Hono } from "hono";
import { LineClient } from "@line-crm/line-sdk";
import type { Env } from "../index.js";

// Extend Env with notification secrets (set via `wrangler secret put --env production`)
type NotifyEnv = Env & {
  Bindings: Env["Bindings"] & {
    WORKER_NOTIFY_SECRET: string;
    OWNER_LINE_USER_ID: string;
  };
};

const supabaseNotify = new Hono<NotifyEnv>();

/**
 * POST /api/notify/worker-brief
 *
 * Supabase Database Webhook target.
 * Fires when a row is INSERTed into cowork_notifications with
 * notification_type = 'worker_brief_complete'.
 *
 * Auth: Authorization: Bearer {WORKER_NOTIFY_SECRET}
 *
 * Body (Supabase webhook payload):
 * {
 *   type: "INSERT",
 *   table: "cowork_notifications",
 *   record: { notification_type, priority, summary, ... },
 *   ...
 * }
 */
supabaseNotify.post("/api/notify/worker-brief", async (c) => {
  // Verify webhook secret
  const authHeader = c.req.header("Authorization") ?? "";
  const expected = `Bearer ${c.env.WORKER_NOTIFY_SECRET}`;
  if (authHeader !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: {
    type?: string;
    record?: {
      notification_type?: string;
      priority?: string;
      summary?: string;
    };
  };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const record = payload?.record;
  if (!record || record.notification_type !== "worker_brief_complete") {
    return c.json({ ok: true, skipped: true });
  }

  const summary = record.summary ?? "(no summary)";

  // Build LINE push message
  const lineText = `🤖 Worker 完了通知\n\n${summary}\n\n---\n次のアクション: session-resume で結果を確認`;

  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  await lineClient.pushMessage(c.env.OWNER_LINE_USER_ID, [
    { type: "text", text: lineText },
  ]);

  return c.json({ ok: true, sent: true });
});

export { supabaseNotify };
