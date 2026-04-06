/**
 * MIZUKAGAMI Mirror Session — CF Workers → Soul Agent Platform BFF
 *
 * LINE上での水鏡v2対話フロー:
 * 1. ユーザーが「水鏡」等のキーワードを送信 → セッション開始
 * 2. アクティブセッション中の全テキスト → mirror-session API に転送
 * 3. APIレスポンスからテキスト + Flex Message を生成して返信
 */

import { LineClient } from "@line-crm/line-sdk";

// ============================================================
// Types (mirror-session v2 API response)
// ============================================================

interface MirrorSessionApiResponse {
  session_id: string;
  current_step: string;
  next_step?: string;
  message: string;
  disclosed_traditions?: string[];
  remaining_traditions?: string[];
  convergence_points?: Array<{
    traditions: string[];
    theme: string;
    strength: number;
  }>;
  divergence_points?: Array<{
    traditions: string[];
    theme: string;
    insight: string;
  }>;
  card?: WaterMirrorCardV2 | null;
  sessionCompleted?: boolean;
  resumed?: boolean;
  processingTime?: number;
}

interface WaterMirrorCardV2 {
  user_essence: string;
  convergence_narrative: string;
  action_guidance: { what: string; when: string; where: string; who: string };
  user_words: string[];
  closing_message: string;
  tradition_summary: Array<{
    tradition: string;
    result: string;
    disclosed_at: string;
    connection_to_user: string;
  }>;
  convergence_network: {
    nodes: string[];
    edges: Array<{
      from: string;
      to: string;
      type: "resonance" | "tension";
      label: string;
    }>;
  };
  /** 216魂マッチング結果（SAP APIが自動注入） */
  soul_name?: string;
  soul_no?: number;
  soul_name_reading?: string;
}

interface MirrorSessionStatusResponse {
  hasActiveSession: boolean;
  session: {
    session_id: string;
    current_step: string;
    disclosed_traditions: string[];
    remaining_traditions: string[];
  } | null;
}

// ============================================================
// Trigger detection
// ============================================================

const MIZUKAGAMI_TRIGGERS = [
  "水鏡",
  "みずかがみ",
  "mizukagami",
  "診断を始める",
  "水鏡を始める",
];

export function isMizukagamiTrigger(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return MIZUKAGAMI_TRIGGERS.some((t) => normalized.includes(t.toLowerCase()));
}

// ============================================================
// API Client
// ============================================================

async function callMirrorSessionApi(
  sapApiUrl: string,
  sapApiKey: string,
  body: Record<string, unknown>,
): Promise<MirrorSessionApiResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": sapApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mirror session API error: ${res.status} ${text}`);
  }

  return (await res.json()) as MirrorSessionApiResponse;
}

async function checkMirrorSessionStatus(
  sapApiUrl: string,
  sapApiKey: string,
  lineUserId: string,
): Promise<MirrorSessionStatusResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": sapApiKey,
    },
    body: JSON.stringify({ action: "status", line_user_id: lineUserId }),
  });

  if (!res.ok) return { hasActiveSession: false, session: null };
  return (await res.json()) as MirrorSessionStatusResponse;
}

// ============================================================
// Tradition colors (for Flex Messages)
// ============================================================

const TRADITION_COLORS: Record<string, { color: string; label: string }> = {
  干支: { color: "#C4A882", label: "Chinese Zodiac" },
  数秘術: { color: "#B08CD8", label: "Numerology" },
  四柱推命: { color: "#C4A882", label: "BaZi" },
  西洋占星術: { color: "#E07B6A", label: "Western Astrology" },
  カバラ: { color: "#B08CD8", label: "Kabbalah" },
  マヤ暦: { color: "#D4B06A", label: "Maya Calendar" },
  宿曜: { color: "#7EB8D8", label: "Sukuyo" },
  易経: { color: "#8BC4A0", label: "I Ching" },
  九星気学: { color: "#FFFFFF", label: "Nine Star Ki" },
  算命学: { color: "#8BC4A0", label: "Sanmei" },
  紫微斗数: { color: "#B08CD8", label: "Zi Wei Dou Shu" },
  ヴェーダ占星術: { color: "#7EB8D8", label: "Vedic" },
};

// ============================================================
// Flex Message builders (simplified for CF Workers)
// ============================================================

function buildProgressDots(
  disclosed: string[],
  total: number = 12,
): Record<string, unknown> {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const isRevealed = i < disclosed.length;
    dots.push({
      type: "box",
      layout: "vertical",
      width: "6px",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: isRevealed ? "#7EB8D8" : "#1a1a2e",
    });
  }
  return {
    type: "box",
    layout: "horizontal",
    contents: dots,
    spacing: "4px",
    justifyContent: "center",
    margin: "md",
  };
}

function buildDisclosureFlexBubble(
  disclosed: string[],
  newTraditions: string[],
  message: string,
): Record<string, unknown> {
  const tradContents = newTraditions.map((t) => {
    const tc = TRADITION_COLORS[t] ?? { color: "#8e8ea8", label: "" };
    return {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "box",
          layout: "vertical",
          width: "8px",
          height: "8px",
          cornerRadius: "4px",
          backgroundColor: tc.color,
          offsetTop: "4px",
        },
        {
          type: "text",
          text: `${t}  ${tc.label}`,
          size: "xs",
          color: tc.color,
          margin: "sm",
        },
      ],
      margin: "sm",
    };
  });

  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050008",
      paddingAll: "20px",
      contents: [
        buildProgressDots(disclosed),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        ...tradContents,
        {
          type: "text",
          text: `${disclosed.length} / 12 叡智体系`,
          size: "xxs",
          color: "#5e5e7e",
          align: "center",
          margin: "lg",
        },
      ],
    },
  };
}

function buildFinalCardFlexBubble(
  card: WaterMirrorCardV2,
): Record<string, unknown> {
  const actionItems = [
    { icon: "⚡", label: "WHAT", text: card.action_guidance.what },
    { icon: "🕐", label: "WHEN", text: card.action_guidance.when },
    { icon: "🧭", label: "WHERE", text: card.action_guidance.where },
    { icon: "👥", label: "WHO", text: card.action_guidance.who },
  ];

  const userWordBubbles = card.user_words.slice(0, 8).map((w) => ({
    type: "box",
    layout: "vertical",
    contents: [{ type: "text", text: w, size: "xxs", color: "#8e8ea8" }],
    backgroundColor: "#1a1a2e",
    cornerRadius: "12px",
    paddingAll: "6px",
    paddingStart: "10px",
    paddingEnd: "10px",
  }));

  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050008",
      paddingAll: "20px",
      contents: [
        // Header gradient bar (simulated with colored box)
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "filler" },
            {
              type: "text",
              text: "水　鏡",
              size: "lg",
              color: "#e0e0e8",
              weight: "bold",
              align: "center",
            },
            { type: "filler" },
          ],
        },
        // Soul name (216魂マッチング結果)
        ...(card.soul_name
          ? [
              {
                type: "text",
                text: `「${card.soul_name}」の魂`,
                size: "md",
                color: "#D4B06A",
                weight: "bold",
                align: "center",
                margin: "md",
              },
            ]
          : []),
        // User essence
        {
          type: "text",
          text: card.user_essence,
          size: "sm",
          color: "#e0e0e8",
          wrap: true,
          align: "center",
          margin: "lg",
        },
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        // User words
        {
          type: "text",
          text: "YOUR WORDS",
          size: "xxs",
          color: "#5e5e7e",
          margin: "lg",
        },
        {
          type: "box",
          layout: "horizontal",
          contents:
            userWordBubbles.length > 0 ? userWordBubbles : [{ type: "filler" }],
          wrap: true,
          spacing: "4px",
          margin: "sm",
        },
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        // Action guidance
        {
          type: "text",
          text: "ACTION GUIDANCE",
          size: "xxs",
          color: "#5e5e7e",
          margin: "lg",
        },
        ...actionItems.map((item) => ({
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: `${item.icon} ${item.label}`,
              size: "xxs",
              color: "#7EB8D8",
              flex: 2,
            },
            {
              type: "text",
              text: item.text,
              size: "xxs",
              color: "#e0e0e8",
              wrap: true,
              flex: 5,
            },
          ],
          margin: "sm",
        })),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        // Closing
        {
          type: "text",
          text: card.closing_message,
          size: "xs",
          color: "#8e8ea8",
          wrap: true,
          align: "center",
          margin: "lg",
          style: "italic",
        },
      ],
    },
  };
}

// ============================================================
// Main handler — called from webhook.ts
// ============================================================

export interface MizukagamiResult {
  handled: boolean;
  error?: string;
}

/**
 * Handle a MIZUKAGAMI mirror session interaction.
 * Returns { handled: true } if the message was processed, false to fall through to other handlers.
 */
export async function handleMizukagami(
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  sapApiUrl: string,
  sapApiKey: string,
  innateProfile?: Record<string, unknown>,
): Promise<MizukagamiResult> {
  try {
    // 1. Check for active session
    const status = await checkMirrorSessionStatus(
      sapApiUrl,
      sapApiKey,
      lineUserId,
    );

    if (!status.hasActiveSession && !isMizukagamiTrigger(text)) {
      return { handled: false };
    }

    let apiResponse: MirrorSessionApiResponse;

    if (!status.hasActiveSession) {
      // 2a. Start new session
      if (!innateProfile) {
        // No profile available — need to run diagnosis first
        // For now, reply with instruction
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡の対話を始めるには、先に生年月日の診断が必要です。\n生年月日を「YYYY-MM-DD」形式で送ってください。",
          },
        ]);
        return { handled: true };
      }

      apiResponse = await callMirrorSessionApi(sapApiUrl, sapApiKey, {
        action: "start",
        line_user_id: lineUserId,
        innate_profile: innateProfile,
      });
    } else {
      // 2b. Continue existing session
      apiResponse = await callMirrorSessionApi(sapApiUrl, sapApiKey, {
        action: "message",
        line_user_id: lineUserId,
        text,
      });
    }

    // 2c. q6→card 自動遷移: next_step が "card" なら、ユーザー入力を待たずにカード生成を実行
    let cardResponse: MirrorSessionApiResponse | null = null;
    if (apiResponse.next_step === "card" && !apiResponse.card) {
      try {
        cardResponse = await callMirrorSessionApi(sapApiUrl, sapApiKey, {
          action: "message",
          line_user_id: lineUserId,
          text: "水鏡カードを紡いでください",
        });
      } catch (err) {
        console.error("[mizukagami] Auto card generation error:", err);
        // q6メッセージだけ送信してフォールバック
      }
    }

    // 3. Build LINE messages
    const messages: Array<Record<string, unknown>> = [];

    // Text message (q6 response)
    if (apiResponse.message) {
      messages.push({ type: "text", text: apiResponse.message });
    }

    // Flex Message for tradition disclosure (if new traditions were disclosed)
    const disclosed = apiResponse.disclosed_traditions ?? [];
    const previousDisclosed = status.session?.disclosed_traditions ?? [];
    const newTraditions = disclosed.filter(
      (t) => !previousDisclosed.includes(t),
    );

    if (newTraditions.length > 0 && !apiResponse.card) {
      const flexBubble = buildDisclosureFlexBubble(
        disclosed,
        newTraditions,
        apiResponse.message,
      );
      messages.push({
        type: "flex",
        altText: `${newTraditions.join("・")} が開示されました (${disclosed.length}/12)`,
        contents: flexBubble,
      });
    }

    // Card message from auto-transition (q6→card)
    if (cardResponse?.message) {
      messages.push({ type: "text", text: cardResponse.message });
    }

    // Final card Flex Message (from original response or auto-transition)
    const finalCard = cardResponse?.card ?? apiResponse.card;
    if (finalCard) {
      const cardBubble = buildFinalCardFlexBubble(finalCard);
      messages.push({
        type: "flex",
        altText: "水鏡カード — あなたの12叡智の統合",
        contents: cardBubble,
      });
    }

    // Session completed — add report link
    const isCompleted =
      cardResponse?.sessionCompleted ?? apiResponse.sessionCompleted;
    const sessionId = cardResponse?.session_id ?? apiResponse.session_id;
    if (isCompleted && sessionId) {
      const reportUrl = `${sapApiUrl}/mizukagami/report/${sessionId}`;
      messages.push({
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
            backgroundColor: "#07070d",
            paddingAll: "12px",
          },
        },
      });
    }

    // Send (max 5 messages per reply)
    if (messages.length > 0) {
      await lineClient.replyMessage(replyToken, messages.slice(0, 5));
    }

    return { handled: true };
  } catch (err) {
    console.error("[mizukagami] Error:", err);
    return {
      handled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
