import type { D1Database } from "@cloudflare/workers-types";
import { LineClient } from "@line-crm/line-sdk";

interface ScheduledPush {
  id: string;
  friend_id: string;
  line_user_id: string;
  line_account_id: string | null;
  message: string;
  send_at: string;
}

interface LineAccount {
  id: string;
  channel_access_token: string;
}

export async function processScheduledPushes(
  db: D1Database,
  defaultAccessToken: string,
): Promise<void> {
  const pending = await db
    .prepare(
      `SELECT id, friend_id, line_user_id, line_account_id, message, send_at
       FROM scheduled_pushes
       WHERE sent_at IS NULL
         AND julianday(send_at) <= julianday('now')
       LIMIT 20`,
    )
    .all<ScheduledPush>();

  if (!pending.results?.length) return;

  for (const push of pending.results) {
    try {
      let accessToken = defaultAccessToken;
      if (push.line_account_id) {
        const account = await db
          .prepare(
            `SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1 LIMIT 1`,
          )
          .bind(push.line_account_id)
          .first<LineAccount>();
        if (account) accessToken = account.channel_access_token;
      }

      const client = new LineClient(accessToken);
      await client.pushMessage(push.line_user_id, [
        { type: "text", text: push.message },
      ]);

      await db
        .prepare(
          `UPDATE scheduled_pushes SET sent_at = datetime('now') WHERE id = ?`,
        )
        .bind(push.id)
        .run();

      console.log(
        `[scheduled-pushes] sent to ${push.line_user_id} (id=${push.id})`,
      );
    } catch (err) {
      console.error(`[scheduled-pushes] failed id=${push.id}:`, err);
    }
  }
}
