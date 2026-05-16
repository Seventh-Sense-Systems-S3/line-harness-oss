import { Hono } from "hono";
import { verifySignature, LineClient } from "@line-crm/line-sdk";
import { createPostHogClient } from "../lib/posthog.js";
import type {
  WebhookRequestBody,
  WebhookEvent,
  TextEventMessage,
} from "@line-crm/line-sdk";
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  addTagToFriend,
} from "@line-crm/db";
import { fireEvent } from "../services/event-bus.js";
import { buildMessage, expandVariables } from "../services/step-delivery.js";
import type { Env } from "../index.js";

const webhook = new Hono<Env>();

// LINE webhook bodies are small (events array). Cap defends against unauthenticated
// large-payload DoS before signature verification (upstream #104). 1 MiB leaves room
// for bursty batched deliveries (~100 events × ~5 KB) while still well below the
// 128 MB Cloudflare Workers memory ceiling.
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024; // 1 MiB

webhook.post("/webhook", async (c) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header("Content-Length");
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: "too_large" }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: rawBody.length counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: "too_large" }, 413);
  }

  const signature = c.req.header("X-Line-Signature") ?? "";
  const db = c.env.DB;

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error("Failed to parse webhook body");
    return c.json({ status: "ok" }, 200);
  }

  // Multi-account: resolve credentials from DB by destination (channel user ID)
  // or fall back to environment variables (default account)
  let channelSecret = c.env.LINE_CHANNEL_SECRET;
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  // ADR: Channel-Based Routing — DEV/PROD 振り分けに使う LINE channel_id
  let matchedChannelId: string | null = null;

  if ((body as { destination?: string }).destination) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      const isValid = await verifySignature(
        account.channel_secret,
        rawBody,
        signature,
      );
      if (isValid) {
        channelSecret = account.channel_secret;
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        matchedChannelId = account.channel_id;
        break;
      }
    }
    console.log(
      `[mizu-routing-debug] destination=${(body as { destination?: string }).destination} matchedChannelId=${matchedChannelId} accountsCount=${accounts.length}`,
    );
  }

  // Verify with resolved secret
  const valid = await verifySignature(channelSecret, rawBody, signature);
  if (!valid) {
    console.error("Invalid LINE signature");
    return c.json({ status: "ok" }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  const posthog = c.env.POSTHOG_API_KEY
    ? createPostHogClient(
        c.env.POSTHOG_API_KEY,
        c.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
      )
    : null;

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      // ─────────────────────────────────────────────────────────
      // Webhook 二重処理防止 (ED-NEW, 5幕イニシエーション Bug 1 対策)
      //
      // LINE Webhook は以下のケースで同一 event が複数回配信される:
      //   - Messaging API サーバー側のタイムアウト再送
      //   - transient network error 後のリトライ
      //   - まれに LINE 内部で重複 enqueue
      //
      // webhookEventId は event 単位で一意 (LINE 仕様)。
      // webhook_dedupe テーブルに INSERT OR IGNORE し、既処理なら skip。
      // 旧 entry の掃除は cron (*/5 * * * *) に委任。
      // ─────────────────────────────────────────────────────────
      const eventId =
        (event as { webhookEventId?: string }).webhookEventId ||
        // webhookEventId が無い古い webhook 版向けフォールバック
        `${event.type}:${event.timestamp}:${
          (event.source as { userId?: string }).userId ?? "unknown"
        }`;
      try {
        const dedupeResult = await db
          .prepare(
            `INSERT OR IGNORE INTO webhook_dedupe (event_id, received_at) VALUES (?, ?)`,
          )
          .bind(eventId, new Date().toISOString())
          .run();
        if ((dedupeResult.meta?.changes ?? 0) === 0) {
          console.log(
            `[webhook dedupe] skip duplicate event_id=${eventId} type=${event.type}`,
          );
          continue;
        }
      } catch (dedupeErr) {
        // テーブルが未作成の環境でも処理は継続 (migration 未適用時の safety net)
        console.error(
          `[webhook dedupe] table access failed (migration 024 未適用?):`,
          dedupeErr,
        );
      }

      try {
        await handleEvent(
          db,
          lineClient,
          event,
          channelAccessToken,
          matchedAccountId,
          c.env.WORKER_URL || new URL(c.req.url).origin,
          c.env.MIZUKAGAMI_WORKER_URL,
          c.env.MIZUKAGAMI_API_KEY,
          c.env.MIZUKAGAMI,
          c.env.LIFF_URL,
          c.env.SUPABASE_URL,
          c.env.SUPABASE_SERVICE_ROLE_KEY,
          c.env.OWNER_LINE_USER_ID,
          posthog,
          // ADR: Channel-Based Routing — DEV LINE OA → DEV mizukagami worker (Service binding)
          matchedChannelId,
          c.env.MIZUKAGAMI_DEV_LINE_CHANNEL_ID,
          c.env.MIZUKAGAMI_DEV,
        );
      } catch (err) {
        console.error("Error handling webhook event:", err);
        posthog?.captureException(err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: "ok" }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  mizukagamiWorkerUrl?: string,
  mizukagamiApiKey?: string,
  mizukagamiService?: Fetcher,
  liffUrl?: string,
  supabaseMizukagamiUrl?: string,
  supabaseMizukagamiServiceKey?: string,
  ownerLineUserId?: string,
  posthog?: import("posthog-node").PostHog | null,
  // ADR: Channel-Based Routing — DEV/PROD 振り分けのための任意パラメータ
  matchedChannelId: string | null = null,
  mizukagamiDevChannelId?: string,
  mizukagamiDevService?: Fetcher,
): Promise<void> {
  if (event.type === "follow") {
    const userId =
      event.source.type === "user" ? event.source.userId : undefined;
    if (!userId) return;

    console.log(`[follow] userId=${userId} lineAccountId=${lineAccountId}`);

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error("Failed to get profile for", userId, err);
    }

    console.log(`[follow] profile=${profile?.displayName ?? "null"}`);

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      lineAccountId: lineAccountId ?? null,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    console.log(
      `[follow] friend.id=${friend.id} friend.line_account_id=${friend.line_account_id}`,
    );

    posthog?.capture({
      distinctId: userId,
      event: "line_friend_followed",
      properties: {
        friend_id: friend.id,
        display_name: profile?.displayName ?? null,
        line_account_id: lineAccountId,
      },
    });

    // ref_code: LINE chatReferral（Voom/広告経由）または follow_params から取得
    const chatReferral = (event as unknown as Record<string, unknown>)
      .chatReferral as { ref?: string } | undefined;
    const refCode = chatReferral?.ref ?? null;
    if (refCode) {
      await db
        .prepare("UPDATE friends SET ref_code = ?, updated_at = ? WHERE id = ?")
        .bind(refCode, jstNow(), friend.id)
        .run();
      console.log(
        `[follow] ref_code set to ${refCode} for friend ${friend.id}`,
      );
    }

    // 水鏡WEBセッションの自動同期（フォロー時にSupabaseからメタデータを取得してD1に書き込む）
    if (supabaseMizukagamiUrl && supabaseMizukagamiServiceKey) {
      try {
        await syncMizukagamiOnFollow(
          db,
          friend.id,
          userId,
          supabaseMizukagamiUrl,
          supabaseMizukagamiServiceKey,
        );
      } catch (err) {
        // 同期失敗はフォロー処理全体を止めない（best-effort）
        console.error(
          `[mizukagami-sync] follow sync failed for ${userId}:`,
          err,
        );
      }

      // display_name を Supabase に逆同期（ファネル分析用: 誰がどのステップにいるか可視化）
      if (profile?.displayName) {
        try {
          await syncDisplayNameToSupabase(
            userId,
            profile.displayName,
            supabaseMizukagamiUrl,
            supabaseMizukagamiServiceKey,
          );
        } catch (err) {
          console.error(`[display-name-sync] failed for ${userId}:`, err);
        }
      }
    }

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    const scenarios = await getScenarios(db);
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch =
        !scenario.line_account_id ||
        !lineAccountId ||
        scenario.line_account_id === lineAccountId;
      if (
        scenario.trigger_type === "friend_add" &&
        scenario.is_active &&
        scenarioAccountMatch
      ) {
        try {
          const existing = await db
            .prepare(
              `SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`,
            )
            .bind(friend.id, scenario.id)
            .first<{ id: string }>();
          if (!existing) {
            const friendScenario = await enrollFriendInScenario(
              db,
              friend.id,
              scenario.id,
            );

            // Immediate delivery: if the first step has delay=0, send it now via replyMessage (free)
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            if (
              firstStep &&
              firstStep.delay_minutes === 0 &&
              friendScenario.status === "active"
            ) {
              try {
                const { resolveMetadata } =
                  await import("../services/step-delivery.js");
                const resolvedMeta = await resolveMetadata(db, {
                  user_id: (friend as unknown as Record<string, string | null>)
                    .user_id,
                  metadata: (friend as unknown as Record<string, string | null>)
                    .metadata,
                });
                const expandedContent = expandVariables(
                  firstStep.message_content,
                  { ...friend, metadata: resolvedMeta } as Parameters<
                    typeof expandVariables
                  >[1],
                );
                const message = buildMessage(
                  firstStep.message_type,
                  expandedContent,
                );
                await lineClient.replyMessage(event.replyToken, [message]);
                console.log(
                  `Immediate delivery: sent step ${firstStep.id} to ${userId}`,
                );

                // Log outgoing message (replyMessage = 無料)
                const logId = crypto.randomUUID();
                await db
                  .prepare(
                    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
                     VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', ?)`,
                  )
                  .bind(
                    logId,
                    friend.id,
                    firstStep.message_type,
                    firstStep.message_content,
                    firstStep.id,
                    jstNow(),
                  )
                  .run();

                // Advance or complete the friend_scenario
                const secondStep = steps[1] ?? null;
                if (secondStep) {
                  const nextDeliveryDate = new Date(
                    Date.now() + 9 * 60 * 60_000,
                  );
                  nextDeliveryDate.setMinutes(
                    nextDeliveryDate.getMinutes() + secondStep.delay_minutes,
                  );
                  // Enforce 9:00-21:00 JST delivery window
                  const h = nextDeliveryDate.getUTCHours();
                  if (h < 9 || h >= 21) {
                    if (h >= 21)
                      nextDeliveryDate.setUTCDate(
                        nextDeliveryDate.getUTCDate() + 1,
                      );
                    nextDeliveryDate.setUTCHours(9, 0, 0, 0);
                  }
                  await advanceFriendScenario(
                    db,
                    friendScenario.id,
                    firstStep.step_order,
                    nextDeliveryDate.toISOString().slice(0, -1) + "+09:00",
                  );
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }
              } catch (err) {
                console.error(
                  "Failed immediate delivery for scenario",
                  scenario.id,
                  err,
                );
              }
            }
          }
        } catch (err) {
          console.error(
            "Failed to enroll friend in scenario",
            scenario.id,
            err,
          );
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(
      db,
      "friend_add",
      { friendId: friend.id, eventData: { displayName: friend.display_name } },
      lineAccessToken,
      lineAccountId,
    );
    return;
  }

  if (event.type === "unfollow") {
    const userId =
      event.source.type === "user" ? event.source.userId : undefined;
    if (!userId) return;

    posthog?.capture({
      distinctId: userId,
      event: "line_friend_unfollowed",
      properties: { line_account_id: lineAccountId },
    });

    await updateFriendFollowStatus(db, userId, false);
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === "postback") {
    const userId =
      event.source.type === "user" ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const postbackData = (event as unknown as { postback: { data: string } })
      .postback.data;

    // Match postback data against auto_replies (exact match on keyword)
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (
      lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt
    ).all<{
      id: string;
      keyword: string;
      match_type: "exact" | "contains";
      response_type: string;
      response_content: string;
    }>();

    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === "exact"
          ? postbackData === rule.keyword
          : postbackData.includes(rule.keyword);

      if (isMatch) {
        try {
          const { resolveMetadata } =
            await import("../services/step-delivery.js");
          const resolvedMeta = await resolveMetadata(db, {
            user_id: (friend as unknown as Record<string, string | null>)
              .user_id,
            metadata: (friend as unknown as Record<string, string | null>)
              .metadata,
          });
          const expandedContent = expandVariables(
            rule.response_content,
            { ...friend, metadata: resolvedMeta } as Parameters<
              typeof expandVariables
            >[1],
            workerUrl,
          );
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
        } catch (err) {
          console.error("Failed to send postback reply", err);
        }
        break;
      }
    }
    return;
  }

  if (event.type === "message" && event.message.type === "text") {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === "user" ? event.source.userId : undefined;
    if (!userId) return;

    // ─── Admin command: !fix {surface} {reading} ───
    const msgText = textMessage.text;
    const replyToken = (event as unknown as { replyToken?: string }).replyToken;
    if (
      ownerLineUserId &&
      userId === ownerLineUserId &&
      msgText.startsWith("!fix ") &&
      replyToken
    ) {
      const parts = msgText.slice(5).trim().split(/\s+/);
      const surface = parts[0];
      const reading = parts.slice(1).join(" ");
      if (
        surface &&
        reading &&
        supabaseMizukagamiUrl &&
        supabaseMizukagamiServiceKey
      ) {
        try {
          const resp = await fetch(
            `${supabaseMizukagamiUrl}/rest/v1/tts_pronunciation_rules`,
            {
              method: "POST",
              headers: {
                apikey: supabaseMizukagamiServiceKey,
                Authorization: `Bearer ${supabaseMizukagamiServiceKey}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates",
              },
              body: JSON.stringify({ surface, reading, source: "line-admin" }),
            },
          );
          const txt = resp.ok
            ? `✅ 登録完了\n${surface} → ${reading}\n\n最大5分で音声に反映されます`
            : `❌ 登録失敗 (${resp.status})`;
          await lineClient.replyMessage(replyToken, [
            { type: "text", text: txt },
          ]);
        } catch (err) {
          console.error("[admin !fix] error:", err);
        }
      } else {
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "使い方: !fix {単語} {よみ}\n例: !fix 説得力 せっとくりょく",
          },
        ]);
      }
      return;
    }
    // ─────────────────────────────────────────────────

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // ─── IGNITION 発火 — 事前登録キーワード ───
    const trimmedIncoming = incomingText.trim();
    if (
      trimmedIncoming === "発火" ||
      trimmedIncoming.toLowerCase() === "ignition"
    ) {
      try {
        await addTagToFriend(
          db,
          friend.id,
          "e3470801-f9d2-474a-9eb0-a4dfd8983262",
        );
        if (replyToken) {
          const ignitionReplyText = `"発火" 受け取りました🔥\n\n来週月曜、LP公開と同時に\nあなたに最優先でご案内します。\n\n6/2-3-4 にむけて、\n楽しみにお待ちください。`;
          await lineClient.replyMessage(replyToken, [
            { type: "text", text: ignitionReplyText },
          ]);
          const replyLogId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
               VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, ?)`,
            )
            .bind(replyLogId, friend.id, ignitionReplyText, jstNow())
            .run();
        }
      } catch (err) {
        console.error("[ignition handler] error:", err);
      }
      return;
    }
    // ─────────────────────────────────────────────────

    // MIZUKAGAMI Mirror Session — 水鏡 Worker に転送（最優先で処理）
    // ADR: Channel-Based Routing — DEV LINE OA からの message は DEV worker URL に振る。
    // それ以外は従来通り PROD Service binding (mizukagamiService) or fallback URL。
    const isDevChannel = Boolean(
      mizukagamiDevChannelId &&
      matchedChannelId &&
      matchedChannelId === mizukagamiDevChannelId &&
      mizukagamiDevService,
    );
    console.log(
      `[mizu-routing-debug] matchedChannelId=${matchedChannelId} devChannelId=${mizukagamiDevChannelId} devSvc=${mizukagamiDevService ? "set" : "unset"} isDevChannel=${isDevChannel}`,
    );
    if (
      mizukagamiApiKey &&
      (isDevChannel || mizukagamiService || mizukagamiWorkerUrl)
    ) {
      try {
        const mizuUrl = isDevChannel
          ? "https://mizukagami-dev/handle"
          : mizukagamiService
            ? "https://mizukagami/handle"
            : `${mizukagamiWorkerUrl}/handle`;
        const replyToken = (event as unknown as { replyToken?: string })
          .replyToken;
        const req = new Request(mizuUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mizukagamiApiKey}`,
          },
          body: JSON.stringify({
            userId,
            text: incomingText,
            lineAccessToken,
            replyToken,
          }),
        });
        const mizuRes =
          isDevChannel && mizukagamiDevService
            ? await mizukagamiDevService.fetch(req)
            : mizukagamiService
              ? await mizukagamiService.fetch(req)
              : await fetch(req);
        console.log(
          `[mizu-routing-debug] mizuUrl=${mizuUrl} status=${mizuRes.status} ok=${mizuRes.ok}`,
        );
        if (mizuRes.ok) {
          const mizuResult = await mizuRes.json<{ handled: boolean }>();
          if (mizuResult.handled) {
            await fireEvent(
              db,
              "message_received",
              {
                friendId: friend.id,
                eventData: {
                  text: incomingText,
                  matched: true,
                  handler: "mizukagami",
                },
              },
              lineAccessToken,
              lineAccountId,
            );
            return;
          }
        }
      } catch (err) {
        console.error("[webhook] Mizukagami Worker 呼び出し失敗:", err);
      }
    }

    // チャットを作成/更新（ユーザーの自発的メッセージのみ unread にする）
    // ボタンタップ等の自動応答キーワードは除外
    const autoKeywords = [
      "料金",
      "機能",
      "API",
      "フォーム",
      "ヘルプ",
      "UUID",
      "UUID連携について教えて",
      "UUID連携を確認",
      "配信時間",
      "導入支援を希望します",
      "アカウント連携を見る",
      "体験を完了する",
      "BAN対策を見る",
      "連携確認",
    ];
    const isAutoKeyword = autoKeywords.some((k) => incomingText === k);
    const isTimeCommand =
      /(?:配信時間|配信|届けて|通知)[はを]?\s*\d{1,2}\s*時/.test(incomingText);
    if (!isAutoKeyword && !isTimeCommand) {
      await upsertChatOnMessage(db, friend.id);
    }

    // 配信時間設定: 「配信時間は○時」「○時に届けて」等のパターンを検出
    const timeMatch = incomingText.match(
      /(?:配信時間|配信|届けて|通知)[はを]?\s*(\d{1,2})\s*時/,
    );
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      if (hour >= 6 && hour <= 22) {
        // Save preferred_hour to friend metadata
        const existing = await db
          .prepare("SELECT metadata FROM friends WHERE id = ?")
          .bind(friend.id)
          .first<{ metadata: string }>();
        const meta = JSON.parse(existing?.metadata || "{}");
        meta.preferred_hour = hour;
        await db
          .prepare(
            "UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?",
          )
          .bind(JSON.stringify(meta), jstNow(), friend.id)
          .run();

        // Reply with confirmation
        try {
          const period = hour < 12 ? "午前" : "午後";
          const displayHour = hour <= 12 ? hour : hour - 12;
          await lineClient.replyMessage(event.replyToken, [
            buildMessage(
              "flex",
              JSON.stringify({
                type: "bubble",
                body: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "配信時間を設定しました",
                      size: "lg",
                      weight: "bold",
                      color: "#1e293b",
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "text",
                          text: `${period} ${displayHour}:00`,
                          size: "xxl",
                          weight: "bold",
                          color: "#f59e0b",
                          align: "center",
                        },
                        {
                          type: "text",
                          text: `（${hour}:00〜）`,
                          size: "sm",
                          color: "#64748b",
                          align: "center",
                          margin: "sm",
                        },
                      ],
                      backgroundColor: "#fffbeb",
                      cornerRadius: "md",
                      paddingAll: "20px",
                      margin: "lg",
                    },
                    {
                      type: "text",
                      text: "今後のステップ配信はこの時間以降にお届けします。",
                      size: "xs",
                      color: "#64748b",
                      wrap: true,
                      margin: "lg",
                    },
                  ],
                  paddingAll: "20px",
                },
              }),
            ),
          ]);
        } catch (err) {
          console.error("Failed to reply for time setting", err);
        }
        return;
      }
    }

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === "体験を完了する" && lineAccountId) {
      try {
        const friendRecord = await db
          .prepare("SELECT user_id FROM friends WHERE id = ?")
          .bind(friend.id)
          .first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db
            .prepare(
              "SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1",
            )
            .bind(friendRecord.user_id, lineAccountId)
            .all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } =
              await import("../services/step-delivery.js");
            await otherClient.pushMessage(other.line_user_id, [
              bm(
                "flex",
                JSON.stringify({
                  type: "bubble",
                  size: "giga",
                  header: {
                    type: "box",
                    layout: "vertical",
                    paddingAll: "20px",
                    backgroundColor: "#fffbeb",
                    contents: [
                      {
                        type: "text",
                        text: `${friend.display_name || ""}さんへ`,
                        size: "lg",
                        weight: "bold",
                        color: "#1e293b",
                      },
                    ],
                  },
                  body: {
                    type: "box",
                    layout: "vertical",
                    paddingAll: "20px",
                    contents: [
                      {
                        type: "text",
                        text: "別アカウントからのアクションを検知しました。",
                        size: "sm",
                        color: "#06C755",
                        weight: "bold",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text: "アカウント連携が正常に動作しています。体験ありがとうございました。",
                        size: "sm",
                        color: "#1e293b",
                        wrap: true,
                        margin: "md",
                      },
                      { type: "separator", margin: "lg" },
                      {
                        type: "text",
                        text: "ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。",
                        size: "xs",
                        color: "#64748b",
                        wrap: true,
                        margin: "lg",
                      },
                    ],
                  },
                  footer: {
                    type: "box",
                    layout: "vertical",
                    paddingAll: "16px",
                    contents: [
                      {
                        type: "button",
                        action: {
                          type: "message",
                          label: "導入について相談する",
                          text: "導入支援を希望します",
                        },
                        style: "primary",
                        color: "#06C755",
                      },
                      ...(liffUrl
                        ? [
                            {
                              type: "button",
                              action: {
                                type: "uri",
                                label: "フィードバックを送る",
                                uri: `${liffUrl}?page=form`,
                              },
                              style: "secondary",
                              margin: "sm",
                            },
                          ]
                        : []),
                    ],
                  },
                }),
              ),
            ]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [
            buildMessage(
              "flex",
              JSON.stringify({
                type: "bubble",
                body: {
                  type: "box",
                  layout: "vertical",
                  paddingAll: "20px",
                  contents: [
                    {
                      type: "text",
                      text: "Account ① にメッセージを送りました",
                      size: "sm",
                      color: "#06C755",
                      weight: "bold",
                      align: "center",
                    },
                    {
                      type: "text",
                      text: "Account ① のトーク画面を確認してください",
                      size: "xs",
                      color: "#64748b",
                      align: "center",
                      margin: "md",
                    },
                  ],
                },
              }),
            ),
          ]);
          return;
        }
      } catch (err) {
        console.error("Cross-account trigger error:", err);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (
      lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt
    ).all<{
      id: string;
      keyword: string;
      match_type: "exact" | "contains";
      response_type: string;
      response_content: string;
      is_active: number;
      created_at: string;
    }>();

    let matched = false;
    let replyTokenConsumed = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === "exact"
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        try {
          // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}})
          const { resolveMetadata: resolveMeta2 } =
            await import("../services/step-delivery.js");
          const resolvedMeta2 = await resolveMeta2(db, {
            user_id: (friend as unknown as Record<string, string | null>)
              .user_id,
            metadata: (friend as unknown as Record<string, string | null>)
              .metadata,
          });
          const expandedContent = expandVariables(
            rule.response_content,
            { ...friend, metadata: resolvedMeta2 } as Parameters<
              typeof expandVariables
            >[1],
            workerUrl,
          );
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
          replyTokenConsumed = true;

          // 送信ログ（replyMessage = 無料）
          const outLogId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', ?)`,
            )
            .bind(
              outLogId,
              friend.id,
              rule.response_type,
              rule.response_content,
              jstNow(),
            )
            .run();
        } catch (err) {
          console.error("Failed to send auto-reply", err);
          // replyToken may still be unused if replyMessage threw before LINE accepted it
        }

        matched = true;
        break;
      }
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(
      db,
      "message_received",
      {
        friendId: friend.id,
        eventData: { text: incomingText, matched },
        replyToken: replyTokenConsumed ? undefined : event.replyToken,
      },
      lineAccessToken,
      lineAccountId,
    );

    posthog?.capture({
      distinctId: userId,
      event: "line_message_received",
      properties: {
        friend_id: friend.id,
        auto_reply_matched: matched,
        line_account_id: lineAccountId,
      },
    });

    return;
  }
}

/**
 * 水鏡WEBセッション → D1 メタデータ同期（followイベント時）
 *
 * WEB版（LINEログイン経由）で診断を完了したユーザーが
 * LINE公式アカウントをフォローしたとき、Supabaseのセッションデータを
 * D1 friends.metadata に自動同期する。
 *
 * 冪等: metadata.mizukagami_session_id が既にセットされていればスキップ。
 */
async function syncMizukagamiOnFollow(
  db: D1Database,
  friendId: string,
  lineUserId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<void> {
  // 冪等チェック: 既に同期済みならスキップ
  const existing = await db
    .prepare("SELECT metadata FROM friends WHERE id = ?")
    .bind(friendId)
    .first<{ metadata: string | null }>();
  const currentMeta = JSON.parse(existing?.metadata || "{}") as Record<
    string,
    unknown
  >;
  if (currentMeta.mizukagami_session_id) {
    console.log(
      `[mizukagami-sync] already synced for friend ${friendId}, skipping`,
    );
    return;
  }

  // Supabase REST API でWEBセッションを取得
  const apiUrl =
    `${supabaseUrl}/rest/v1/sap_mizukagami_line_sessions` +
    `?line_user_id=eq.${encodeURIComponent(lineUserId)}` +
    `&current_step=eq.completed` +
    `&select=session_id,line_user_id,current_step,completed_at,innate_profile,card_data,user_keywords,conversation_history` +
    `&order=completed_at.desc&limit=1`;

  const resp = await fetch(apiUrl, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(
      `Supabase query failed: ${resp.status} ${await resp.text()}`,
    );
  }

  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  if (!rows || rows.length === 0) {
    console.log(
      `[mizukagami-sync] no completed WEB session found for ${lineUserId}`,
    );
    return;
  }

  const session = rows[0];
  const innateProfile = (
    typeof session.innate_profile === "string"
      ? JSON.parse(session.innate_profile)
      : session.innate_profile
  ) as Record<string, unknown> | null;
  const cardData = (
    typeof session.card_data === "string"
      ? JSON.parse(session.card_data)
      : session.card_data
  ) as Record<string, unknown> | null;
  const sm = (innateProfile?.soulMatch as Record<string, string>) ?? {};
  const cd = (cardData ?? {}) as Record<string, unknown>;
  const fp = (cd.five_powers as Record<string, string>) ?? {};
  const clip = (s?: string) => (s ? s.slice(0, 200) : undefined);

  const meta: Record<string, string | null> = {
    mizukagami_session_id: (session.session_id as string) ?? null,
    diagnosis_completed_at: (session.completed_at as string) ?? "",
    mizukagami_funnel_stage: "0",
    mizukagami_power_pattern: null,
  };

  const soulName = (cd.soul_name as string) ?? sm.soulName;
  if (soulName) meta.soul_name = soulName;
  if (cd.soul_no ?? sm.soulNo) meta.soul_no = String(cd.soul_no ?? sm.soulNo);
  if (sm.innateSpiral) meta.innate_spiral = sm.innateSpiral;
  if (sm.acquiredSystem) meta.acquired_system = sm.acquiredSystem;
  if (sm.manifestedWisdom) meta.manifested_wisdom = sm.manifestedWisdom;
  if (cd.closing_message) meta.soul_message = cd.closing_message as string;
  if (cd.user_essence) meta.user_essence = cd.user_essence as string;

  const words = (cd.user_words as string[]) ?? [];
  if (words.length > 0) {
    meta.mizukagami_user_words = JSON.stringify(words.slice(0, 6));
    if (words[0]) meta.mizukagami_user_word_1 = words[0];
    if (words[1]) meta.mizukagami_user_word_2 = words[1];
    if (words[2]) meta.mizukagami_user_word_3 = words[2];
    meta.mizukagami_user_words_joined = words.slice(0, 6).join("・");
  }

  if (fp.strength) meta.mizukagami_five_powers_strength = clip(fp.strength)!;
  if (fp.potential) meta.mizukagami_five_powers_potential = clip(fp.potential)!;
  if (fp.depth) meta.mizukagami_five_powers_depth = clip(fp.depth)!;
  if (fp.hidden) meta.mizukagami_five_powers_hidden = clip(fp.hidden)!;
  if (fp.recognized)
    meta.mizukagami_five_powers_recognized = clip(fp.recognized)!;

  if (cd.convergence_narrative)
    meta.mizukagami_convergence_narrative = cd.convergence_narrative as string;

  const keywords = session.user_keywords as string[] | null;
  if (keywords && keywords.length > 0)
    meta.mizukagami_keywords = JSON.stringify(keywords);

  // q1〜q6 会話回答（各ステップの最後の user メッセージ、200 字以内）
  const convHistory = session.conversation_history as Array<{
    role: string;
    content: string;
    step?: string;
  }> | null;
  if (convHistory && convHistory.length > 0) {
    for (const step of ["q1", "q2", "q3", "q4", "q5", "q6"]) {
      const msgs = convHistory.filter(
        (m) => m.role === "user" && m.step === step,
      );
      if (msgs.length > 0) {
        const text = msgs[msgs.length - 1].content.trim().slice(0, 200);
        if (text.length >= 3) meta[`mizukagami_${step}_answer`] = text;
      }
    }
  }

  // D1に直接マージ書き込み（nullキーは保持して既存データをクリア）
  const updatedMeta = { ...currentMeta, ...meta };
  await db
    .prepare("UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(updatedMeta), jstNow(), friendId)
    .run();

  console.log(
    `[mizukagami-sync] synced WEB session ${meta.mizukagami_session_id} → friend ${friendId}` +
      ` (soul_name: ${meta.soul_name ?? "n/a"})`,
  );
}

/**
 * follow 時に取得した LINE display_name を Supabase sap_mizukagami_line_sessions に書き込む。
 * ファネル分析で「誰がどのステップにいるか」を名前付きで把握するために使用。
 * best-effort: 失敗してもフォロー処理全体は止めない。
 */
async function syncDisplayNameToSupabase(
  lineUserId: string,
  displayName: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<void> {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/sap_mizukagami_line_sessions?line_user_id=eq.${encodeURIComponent(lineUserId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ display_name: displayName }),
    },
  );
  if (!resp.ok) {
    throw new Error(
      `Supabase display_name sync failed: ${resp.status} ${await resp.text()}`,
    );
  }
  console.log(
    `[display-name-sync] synced "${displayName}" → line_user_id=${lineUserId}`,
  );
}

export { webhook };
