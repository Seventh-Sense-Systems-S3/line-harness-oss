import { Hono } from "hono";
import type { Env } from "../index.js";

const supabaseWorkerNotify = new Hono<Env>();

// POST /api/supabase/worker-complete
// Called by Supabase Database Webhook on cowork_notifications INSERT
// when notification_type = 'worker_brief_complete'.
// Sends LINE push message to the owner so they know a worker finished.
//
// Setup required (one-time):
//   1. CF Worker secrets:
//      wrangler secret put SUPABASE_WEBHOOK_SECRET --env production
//      wrangler secret put LINE_OWNER_USER_ID --env production
//   2. Supabase Dashboard > Database > Webhooks:
//      Table: cowork_notifications, Event: INSERT
//      URL: https://line-crm-worker.kyousuke10000.workers.dev/api/supabase/worker-complete
//      HTTP Header: x-webhook-secret = <same value as SUPABASE_WEBHOOK_SECRET>
supabaseWorkerNotify.post("/api/supabase/worker-complete", async (c) => {
  const secret = c.req.header("x-webhook-secret");
  const expectedSecret = c.env.SUPABASE_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[worker-complete] SUPABASE_WEBHOOK_SECRET not configured");
    return c.json({ success: false, error: "Server misconfiguration" }, 500);
  }
  if (secret !== expectedSecret) {
    console.warn("[worker-complete] invalid webhook secret");
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }

  const record = (payload as { record?: Record<string, unknown> }).record;
  if (!record || record.notification_type !== "worker_brief_complete") {
    // Non-worker_brief_complete inserts — silently ignore
    return c.json({ success: true, skipped: true });
  }

  const ownerUserId = c.env.LINE_OWNER_USER_ID;
  if (!ownerUserId) {
    console.error("[worker-complete] LINE_OWNER_USER_ID not configured");
    return c.json(
      { success: false, error: "LINE_OWNER_USER_ID not configured" },
      500,
    );
  }

  const meta = (record.metadata as Record<string, unknown>) ?? {};
  const briefTitle = String(
    meta.brief_title ?? record.summary ?? "Unknown brief",
  );
  const branchName = String(meta.branch_name ?? "unknown-branch");
  const elapsedSecs = Number(meta.elapsed_secs ?? 0);
  const elapsedMin = Math.floor(elapsedSecs / 60);
  const elapsedSec = elapsedSecs % 60;
  const paneIdx = String(meta.pane_idx ?? "?");
  const completedAt = String(meta.completed_at ?? new Date().toISOString());

  const messageText = [
    "✅ Worker完了通知",
    "",
    `📋 ${briefTitle}`,
    `🌿 ${branchName}`,
    `🤖 Worker #${paneIdx}`,
    `⏱ ${elapsedMin}分${elapsedSec}秒`,
    `🕐 ${completedAt}`,
    "",
    "session-resumeで引き継ぎ可能",
  ].join("\n");

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: ownerUserId,
        messages: [{ type: "text", text: messageText }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `[worker-complete] LINE push failed: ${res.status} ${errBody}`,
      );
      return c.json(
        { success: false, error: `LINE API error: ${res.status}` },
        502,
      );
    }

    console.log(
      `[worker-complete] LINE push sent: ${briefTitle} → ${branchName}`,
    );
    return c.json({ success: true });
  } catch (err) {
    console.error("[worker-complete] fetch error:", err);
    return c.json({ success: false, error: "Internal error" }, 500);
  }
});

export { supabaseWorkerNotify };
