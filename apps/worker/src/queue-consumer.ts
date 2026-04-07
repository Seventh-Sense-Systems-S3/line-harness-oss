/**
 * MIZUKAGAMI Queue Consumer
 *
 * Processes mirror-session work enqueued by the webhook handler.
 * Runs with a 15-minute budget (vs 30s for fetch handlers).
 */

import { LineClient } from "@line-crm/line-sdk";
import type { Message } from "@line-crm/line-sdk";
import {
  callMirrorSessionApi,
  buildDisclosureFlexBubble,
  buildFinalCardFlexBubble,
  buildBridgeMessages,
  updateD1Session,
  ensureMizukagamiTable,
} from "./services/mizukagami.js";
import type { MizukagamiQueueMessage } from "./services/mizukagami.js";
import type { Env } from "./index.js";
import { sleep } from "./services/stealth.js";

export async function handleMizukagamiQueue(
  batch: MessageBatch<MizukagamiQueueMessage>,
  env: Env["Bindings"],
): Promise<void> {
  await ensureMizukagamiTable(env.DB);

  console.log(`[queue] Received batch of ${batch.messages.length} messages`);
  for (const msg of batch.messages) {
    const data = msg.body;
    console.log(
      `[queue] Processing: type=${data.type}, session=${data.sessionId}`,
    );
    try {
      if (data.type === "session_start") {
        await handleSessionStart(env.DB, data);
      } else if (data.type === "session_message") {
        await handleSessionMessage(env.DB, data);
      } else {
        console.error(
          "[queue] Unknown message type:",
          (data as { type: string }).type,
        );
      }
      msg.ack();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[queue] Error processing ${data.type}:`, message);
      console.error("[queue] Full error:", err);
      // Retry transient errors (up to default retry limit), ack permanent failures
      const isPermanent =
        message.includes("400") ||
        message.includes("404") ||
        message.includes("422");
      if (isPermanent) {
        console.warn("[queue] Permanent failure, acking:", message);
        // Notify user of failure
        try {
          const lineClient = new LineClient(data.lineAccessToken);
          await lineClient.pushMessage(data.lineUserId, [
            {
              type: "text",
              text: "水鏡のセッションでエラーが発生しました。\n「水鏡」と送ると最初からやり直せます。",
            },
          ]);
          await updateD1Session(env.DB, data.sessionId, {
            state: "completed",
          });
        } catch {
          // Best-effort notification
        }
        msg.ack();
      } else {
        msg.retry();
      }
    }
  }
}

async function handleSessionStart(
  db: D1Database,
  data: MizukagamiQueueMessage,
): Promise<void> {
  const lineClient = new LineClient(data.lineAccessToken);

  if (!data.innateProfile) {
    await lineClient.pushMessage(data.lineUserId, [
      {
        type: "text",
        text: "セッションデータが見つかりません。\n「水鏡」と送ると最初からやり直せます。",
      },
    ]);
    await updateD1Session(db, data.sessionId, { state: "completed" });
    return;
  }

  const savedProfile = JSON.parse(data.innateProfile);
  const savedCalcSummary: Record<string, string> = data.calcSummary
    ? JSON.parse(data.calcSummary)
    : {};

  const sessionResponse = await callMirrorSessionApi(
    data.sapApiUrl,
    data.sapApiKey,
    {
      action: "start",
      line_user_id: data.lineUserId,
      innate_profile: savedProfile,
    },
    data.vercelBypass,
  );

  // Build messages
  const messages: Array<Record<string, unknown>> = [];
  const disclosed = sessionResponse.disclosed_traditions ?? [];
  if (disclosed.length > 0) {
    messages.push({
      type: "flex",
      altText: `${disclosed.join("・")} が開示されました (${disclosed.length}/12)`,
      contents: buildDisclosureFlexBubble(
        disclosed,
        disclosed,
        savedCalcSummary,
      ),
    });
  }
  if (sessionResponse.message) {
    messages.push({ type: "text", text: sessionResponse.message });
  }
  if (messages.length > 0) {
    await lineClient.pushMessage(data.lineUserId, messages.slice(0, 5));
  }

  await updateD1Session(db, data.sessionId, {
    state: "active",
    sap_session_id: sessionResponse.session_id,
  });
}

async function handleSessionMessage(
  db: D1Database,
  data: MizukagamiQueueMessage,
): Promise<void> {
  const lineClient = new LineClient(data.lineAccessToken);
  const d1SessionId = data.d1SessionId ?? data.sessionId;
  const calcSummary: Record<string, string> | undefined = data.calcSummary
    ? JSON.parse(data.calcSummary)
    : undefined;

  const apiResponse = await callMirrorSessionApi(
    data.sapApiUrl,
    data.sapApiKey,
    {
      action: "message",
      line_user_id: data.lineUserId,
      text: data.text,
    },
    data.vercelBypass,
  );

  // ──────────────────────────────────────────────────────────
  // 段階的開示: q6→card遷移時はメッセージを分割送信
  // q6応答 → ブリッジメッセージ → カード送信
  // cardが同時に返った場合もブリッジ演出は必ず発動
  // ──────────────────────────────────────────────────────────
  const isQ6CardTransition = apiResponse.next_step === "card";

  if (isQ6CardTransition) {
    // Phase 1: q6応答を即送信（体感待ち時間ゼロの核心）
    const phase1: Array<Record<string, unknown>> = [];
    if (apiResponse.message) {
      phase1.push({ type: "text", text: apiResponse.message });
    }
    if (phase1.length > 0) {
      await safePushMessage(lineClient, data.lineUserId, phase1);
    }

    // Phase 2: ブリッジメッセージ（LLM不要、決定論的生成）
    await sleep(2000);
    const innateProfile = data.innateProfile
      ? JSON.parse(data.innateProfile)
      : null;
    const bridgeMessages = buildBridgeMessages(innateProfile, calcSummary);
    if (bridgeMessages.length > 0) {
      await safePushMessage(lineClient, data.lineUserId, bridgeMessages);
    }

    // Phase 3: カード取得（既にある場合はそのまま、なければAPI呼出）
    await sleep(2000);
    let finalCard = apiResponse.card ?? null;
    let cardResponse: typeof apiResponse | null = null;
    if (!finalCard) {
      try {
        cardResponse = await callMirrorSessionApi(
          data.sapApiUrl,
          data.sapApiKey,
          {
            action: "message",
            line_user_id: data.lineUserId,
            text: "水鏡カードを紡いでください",
          },
          data.vercelBypass,
        );
        finalCard = cardResponse?.card ?? null;
      } catch (err) {
        console.error("[queue] Auto card generation error:", err);
      }
    }

    // Phase 4: カード + レポートリンク送信
    const cardMessages: Array<Record<string, unknown>> = [];
    if (cardResponse?.message) {
      cardMessages.push({ type: "text", text: cardResponse.message });
    }
    if (finalCard) {
      cardMessages.push({
        type: "flex",
        altText: "水鏡カード — あなたの12叡智の統合",
        contents: buildFinalCardFlexBubble(finalCard),
      });
    }
    const isCompleted =
      cardResponse?.sessionCompleted ?? apiResponse.sessionCompleted ?? false;
    const sessionId = cardResponse?.session_id ?? apiResponse.session_id;
    if (isCompleted) {
      await updateD1Session(db, d1SessionId, { state: "completed" });
      if (sessionId) {
        cardMessages.push(buildReportLinkFlex(data.sapApiUrl, sessionId));
      }
    }
    if (cardMessages.length > 0) {
      await safePushMessage(lineClient, data.lineUserId, cardMessages);
    }
    return;
  }

  // ──────────────────────────────────────────────────────────
  // 通常フロー（q1-q5、またはq6でcardが同時に返った場合）
  // ──────────────────────────────────────────────────────────
  const messages: Array<Record<string, unknown>> = [];

  const disclosed = apiResponse.disclosed_traditions ?? [];
  if (disclosed.length > 0 && !apiResponse.card) {
    messages.push({
      type: "flex",
      altText: `${disclosed.length}/12 叡智体系`,
      contents: buildDisclosureFlexBubble(disclosed, disclosed, calcSummary),
    });
  }

  if (apiResponse.message) {
    messages.push({ type: "text", text: apiResponse.message });
  }

  const finalCard = apiResponse.card;
  if (finalCard) {
    messages.push({
      type: "flex",
      altText: "水鏡カード — あなたの12叡智の統合",
      contents: buildFinalCardFlexBubble(finalCard),
    });
  }

  const isCompleted = apiResponse.sessionCompleted;
  const sessionId = apiResponse.session_id;
  if (isCompleted) {
    await updateD1Session(db, d1SessionId, { state: "completed" });
    if (sessionId) {
      messages.push(buildReportLinkFlex(data.sapApiUrl, sessionId));
    }
  }

  if (messages.length > 0) {
    await safePushMessage(lineClient, data.lineUserId, messages);
  }
}

// ──────────────────────────────────────────────────────────
// Helper: pushMessage with text-only fallback
// ──────────────────────────────────────────────────────────
async function safePushMessage(
  lineClient: LineClient,
  userId: string,
  messages: Array<Record<string, unknown>>,
): Promise<void> {
  try {
    await lineClient.pushMessage(userId, messages.slice(0, 5));
  } catch (pushErr) {
    console.error("[queue] pushMessage failed, text-only fallback:", pushErr);
    console.error(
      "[queue] Failed JSON:",
      JSON.stringify(messages).slice(0, 2000),
    );
    const textOnly = messages.filter((m) => m.type === "text").slice(0, 5);
    if (textOnly.length > 0) {
      await lineClient.pushMessage(userId, textOnly);
    }
  }
}

// ──────────────────────────────────────────────────────────
// Helper: レポートリンクFlex
// ──────────────────────────────────────────────────────────
function buildReportLinkFlex(
  sapApiUrl: string,
  sessionId: string,
): Record<string, unknown> {
  const reportUrl = `${sapApiUrl}/mizukagami/report/${sessionId}`;
  return {
    type: "flex",
    altText: "振り返りレポートを見る",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#07070d",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "あなたの水面の全貌を見る",
            size: "sm",
            color: "#e0e0e8",
            align: "center",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#07070d",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "振り返りレポート →",
              uri: reportUrl,
            },
            style: "primary",
            color: "#7EB8D8",
          },
        ],
      },
    },
  };
}
