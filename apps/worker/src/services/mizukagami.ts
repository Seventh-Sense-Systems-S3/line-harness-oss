/**
 * MIZUKAGAMI 即時診断フロー
 *
 * 生年月日→先天螺旋→核/本領/見失い を LINE Flex Message で即時表示。
 * LLM 不使用。純粋数学計算のみ。
 *
 * 状態遷移: IDLE → AWAITING_BIRTHDAY → CALCULATING → RESULT_SHOWN
 */

import type { LineClient } from "@line-crm/line-sdk";
import { buildDiagnosisFlexMessage } from "./mizukagami-flex.js";

// トリガーキーワード
const TRIGGER_KEYWORDS = ["診断", "水鏡", "mizukagami", "MIZUKAGAMI"];

// 生年月日パターン: YYYY-MM-DD, YYYY/MM/DD, 8桁数字
const DATE_PATTERNS = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{4})\/(\d{2})\/(\d{2})$/,
  /^(\d{4})(\d{2})(\d{2})$/,
];

type SessionState =
  | "AWAITING_BIRTHDAY"
  | "CALCULATING"
  | "RESULT_SHOWN"
  | "MIRROR_SESSION";

interface MizukagamiSession {
  id: string;
  line_user_id: string;
  state: SessionState;
  birthday: string | null;
  diagnosis_result: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * トリガーキーワードかどうかを判定
 */
export function isMizukagamiTrigger(text: string): boolean {
  return TRIGGER_KEYWORDS.some(
    (kw) => text.trim().toLowerCase() === kw.toLowerCase(),
  );
}

/**
 * テキストから生年月日をパースする
 * @returns YYYY-MM-DD 形式の文字列、またはパース不可なら null
 */
function parseBirthday(text: string): string | null {
  const trimmed = text.trim();
  for (const pattern of DATE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) {
      const [, y, mo, d] = m;
      const dateStr = `${y}-${mo}-${d}`;
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return null;
      // 未来日チェック
      if (date > new Date()) return null;
      // 妥当性チェック（1900年以降）
      if (date.getFullYear() < 1900) return null;
      return dateStr;
    }
  }
  return null;
}

/**
 * アクティブなセッションを取得（24h以内、未完了）
 */
async function getActiveSession(
  db: D1Database,
  lineUserId: string,
): Promise<MizukagamiSession | null> {
  const row = await db
    .prepare(
      `SELECT * FROM mizukagami_sessions
       WHERE line_user_id = ? AND state != 'RESULT_SHOWN'
       AND created_at > datetime('now', '-24 hours')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(lineUserId)
    .first<MizukagamiSession>();
  return row ?? null;
}

/**
 * 新しいセッションを作成
 */
async function createSession(
  db: D1Database,
  lineUserId: string,
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await db
    .prepare(
      `INSERT INTO mizukagami_sessions (id, line_user_id, state, created_at, updated_at)
       VALUES (?, ?, 'AWAITING_BIRTHDAY', datetime('now'), datetime('now'))`,
    )
    .bind(id, lineUserId)
    .run();
  return id;
}

/**
 * セッション状態を更新
 */
async function updateSession(
  db: D1Database,
  sessionId: string,
  updates: Partial<
    Pick<
      MizukagamiSession,
      "state" | "birthday" | "diagnosis_result" | "completed_at"
    >
  >,
): Promise<void> {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.state !== undefined) {
    sets.push("state = ?");
    values.push(updates.state);
  }
  if (updates.birthday !== undefined) {
    sets.push("birthday = ?");
    values.push(updates.birthday);
  }
  if (updates.diagnosis_result !== undefined) {
    sets.push("diagnosis_result = ?");
    values.push(updates.diagnosis_result);
  }
  if (updates.completed_at !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completed_at);
  }

  values.push(sessionId);
  await db
    .prepare(`UPDATE mizukagami_sessions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Soul Agent Platform API を呼び出して先天診断を取得
 */
async function callDiagnosisApi(
  birthday: string,
  apiUrl: string,
  apiKey: string,
): Promise<{
  diagnosis: {
    innate: { primary: string; secondary: string; confidence: number };
  };
  unleash: {
    kaku: { name: string; description: string };
    honryou: { name: string; description: string };
    miushinai: { name: string; description: string };
  } | null;
  calculationTime: number;
}> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      birthday,
      mode: "innate_only",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Diagnosis API error: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * MIZUKAGAMI メッセージハンドラー
 *
 * @returns true if the message was handled by MIZUKAGAMI, false otherwise
 */
export async function handleMizukagamiMessage(
  db: D1Database,
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  env: {
    SOUL_AGENT_DIAGNOSIS_URL?: string;
    SOUL_AGENT_API_KEY?: string;
  },
): Promise<boolean> {
  // 1. トリガーキーワードチェック
  if (isMizukagamiTrigger(text)) {
    await createSession(db, lineUserId);
    await lineClient.replyMessage(replyToken, [
      {
        type: "text",
        text: "🔮 MIZUKAGAMI — あなたの核を映し出します\n\n生年月日を入力してください\n\n例: 1990-01-15",
      },
    ]);
    return true;
  }

  // 2. アクティブセッションの確認
  const session = await getActiveSession(db, lineUserId);
  if (!session) return false;

  // 3. 状態別ハンドリング
  switch (session.state) {
    case "AWAITING_BIRTHDAY": {
      const birthday = parseBirthday(text);
      if (!birthday) {
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "生年月日の形式が正しくありません 📅\n\nYYYY-MM-DD の形式で入力してください\n例: 1990-01-15",
          },
        ]);
        return true;
      }

      // API URLチェック
      if (!env.SOUL_AGENT_DIAGNOSIS_URL || !env.SOUL_AGENT_API_KEY) {
        console.error(
          "[mizukagami] SOUL_AGENT_DIAGNOSIS_URL or SOUL_AGENT_API_KEY not configured",
        );
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "申し訳ございません。診断システムの設定が完了していません。しばらくお待ちください。",
          },
        ]);
        return true;
      }

      // 「計算中」メッセージを reply_token で即返信（30秒制限対策）
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "🔮 あなたの魂を解読しています...",
        },
      ]);

      // セッション更新: CALCULATING
      await updateSession(db, session.id, {
        state: "CALCULATING",
        birthday,
      });

      // API呼び出し → 結果を Push API で送信
      try {
        const result = await callDiagnosisApi(
          birthday,
          env.SOUL_AGENT_DIAGNOSIS_URL,
          env.SOUL_AGENT_API_KEY,
        );

        if (!result.unleash) {
          throw new Error("No unleash data in response");
        }

        // Flex Message で結果を Push 送信
        const flexMessage = buildDiagnosisFlexMessage(
          result.diagnosis.innate.primary,
          result.unleash,
          result.diagnosis.innate.confidence,
          result.diagnosis.innate.consensus ?? undefined,
        );
        await lineClient.pushMessage(lineUserId, [flexMessage]);

        // D1 に結果を保存し、Mirror Session 状態に遷移
        await updateSession(db, session.id, {
          state: "MIRROR_SESSION",
          diagnosis_result: JSON.stringify(result),
        });

        // Mirror Session (Phase 2) の開始を Soul Agent API に依頼
        try {
          const mirrorUrl = env.SOUL_AGENT_DIAGNOSIS_URL!.replace(
            "/diagnosis",
            "/mirror-session",
          );
          const mirrorRes = await fetch(mirrorUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": env.SOUL_AGENT_API_KEY!,
            },
            body: JSON.stringify({
              action: "start",
              line_user_id: lineUserId,
              innate_profile: {
                spiralPrimary: result.diagnosis.innate.primary,
                confidence: result.diagnosis.innate.confidence,
                kaku: result.unleash.kaku,
                honryou: result.unleash.honryou,
                miushinai: result.unleash.miushinai,
                calculatorDetails:
                  (result as Record<string, unknown>).calculatorDetails ??
                  undefined,
              },
            }),
          });

          if (mirrorRes.ok) {
            const mirrorData = (await mirrorRes.json()) as {
              message?: string;
            };
            if (mirrorData.message) {
              await lineClient.pushMessage(lineUserId, [
                { type: "text", text: mirrorData.message },
              ]);
            }
          }
        } catch (mirrorErr) {
          console.error("[mizukagami] Mirror session start failed:", mirrorErr);
          // Phase 1は成功しているので、Phase 2の失敗は致命的ではない
        }
      } catch (err) {
        console.error("[mizukagami] Diagnosis API call failed:", err);
        await lineClient.pushMessage(lineUserId, [
          {
            type: "text",
            text: "申し訳ございません。診断に失敗しました。もう一度「診断」と送信してください。",
          },
        ]);
        await updateSession(db, session.id, { state: "RESULT_SHOWN" });
      }
      return true;
    }

    case "CALCULATING": {
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "診断結果を計算中です... 少々お待ちください ⏳",
        },
      ]);
      return true;
    }

    case "MIRROR_SESSION": {
      // Phase 2: 水鏡との対話セッション
      if (!env.SOUL_AGENT_DIAGNOSIS_URL || !env.SOUL_AGENT_API_KEY) {
        return false;
      }

      // reply_token で「考え中」を即返信（LLM呼び出しに時間がかかるため）
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "...",
        },
      ]);

      try {
        const mirrorUrl = env.SOUL_AGENT_DIAGNOSIS_URL.replace(
          "/diagnosis",
          "/mirror-session",
        );
        const mirrorRes = await fetch(mirrorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.SOUL_AGENT_API_KEY,
          },
          body: JSON.stringify({
            action: "message",
            line_user_id: lineUserId,
            text,
          }),
        });

        if (!mirrorRes.ok) {
          const errText = await mirrorRes.text();
          console.error("[mizukagami] Mirror session error:", errText);
          await lineClient.pushMessage(lineUserId, [
            {
              type: "text",
              text: "水鏡との接続に問題が生じました。もう一度お話しください。",
            },
          ]);
          return true;
        }

        const mirrorData = (await mirrorRes.json()) as {
          message?: string;
          card?: {
            kaku_expression: string;
            honryou_expression: string;
            miushinai_expression: string;
            closing_message: string;
            calculator_summary?: Array<{
              tradition: string;
              value: string;
              disclosed: boolean;
            }>;
            overall_resonance?: number;
          };
          sessionCompleted?: boolean;
          current_step?: string;
        };

        // 水鏡のメッセージを Push 送信
        if (mirrorData.message) {
          await lineClient.pushMessage(lineUserId, [
            { type: "text", text: mirrorData.message },
          ]);
        }

        // Step 4 完了: 水鏡カードを送信
        if (mirrorData.sessionCompleted && mirrorData.card) {
          const diagnosisResult = session.diagnosis_result
            ? JSON.parse(session.diagnosis_result)
            : null;
          const spiralPrimary =
            diagnosisResult?.diagnosis?.innate?.primary ?? "識";
          const kakuName = diagnosisResult?.unleash?.kaku?.name ?? "あなたの核";

          // カード用 Flex Message を構築（簡易版、API側で構築済みのデータを使用）
          const cardFlex = buildMirrorCardFlex(
            spiralPrimary,
            kakuName,
            mirrorData.card,
          );
          await lineClient.pushMessage(lineUserId, [cardFlex]);

          // セッション完了
          await updateSession(db, session.id, {
            state: "RESULT_SHOWN",
            completed_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("[mizukagami] Mirror session message error:", err);
        await lineClient.pushMessage(lineUserId, [
          {
            type: "text",
            text: "水鏡との対話中にエラーが発生しました。もう一度「診断」と送信してください。",
          },
        ]);
        await updateSession(db, session.id, { state: "RESULT_SHOWN" });
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * 水鏡カード Flex Message（CF Workers 側簡易版）
 */
function buildMirrorCardFlex(
  spiralPrimary: string,
  kakuName: string,
  card: {
    kaku_expression: string;
    honryou_expression: string;
    miushinai_expression: string;
    closing_message: string;
    calculator_summary?: Array<{
      tradition: string;
      value: string;
      disclosed: boolean;
    }>;
    overall_resonance?: number;
  },
): {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
} {
  const COLORS: Record<string, string> = {
    地: "#C4A882",
    水: "#7EB8D8",
    火: "#E07B6A",
    風: "#8BC4A0",
    空: "#B08CD8",
    識: "#D4B06A",
  };
  const accent = COLORS[spiralPrimary] ?? "#D4B06A";

  return {
    type: "flex",
    altText: `水鏡カード — ${kakuName}`,
    contents: {
      type: "bubble",
      size: "giga",
      styles: { body: { backgroundColor: "#050008" } },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "24px",
        spacing: "lg",
        contents: [
          {
            type: "text",
            text: "水 鏡",
            size: "xxs",
            color: "#6E6E8E",
            align: "center",
          },
          {
            type: "text",
            text: kakuName,
            weight: "bold",
            size: "xl",
            color: accent,
            align: "center",
            margin: "lg",
          },
          {
            type: "text",
            text: `─── ${spiralPrimary} ───`,
            size: "xs",
            color: "#5E5E7E",
            align: "center",
            margin: "sm",
          },
          { type: "separator", color: "#1a1a2e", margin: "lg" },
          // 核
          {
            type: "text",
            text: "核",
            size: "xxs",
            color: "#5E5E7E",
            margin: "lg",
          },
          {
            type: "text",
            text: card.kaku_expression,
            size: "md",
            color: accent,
            wrap: true,
          },
          { type: "separator", color: "#1a1a2e", margin: "lg" },
          // 本領
          {
            type: "text",
            text: "本領",
            size: "xxs",
            color: "#5E5E7E",
            margin: "lg",
          },
          {
            type: "text",
            text: card.honryou_expression,
            size: "md",
            color: "#C8C8D8",
            wrap: true,
          },
          { type: "separator", color: "#1a1a2e", margin: "lg" },
          // 見失い
          {
            type: "text",
            text: "見失い",
            size: "xxs",
            color: "#5E5E7E",
            margin: "lg",
          },
          {
            type: "text",
            text: card.miushinai_expression,
            size: "md",
            color: "#8E8EA8",
            wrap: true,
          },
          { type: "separator", color: "#1a1a2e", margin: "lg" },
          // 八つの深層（calculator_summary）
          ...(card.calculator_summary && card.calculator_summary.length > 0
            ? [
                {
                  type: "text",
                  text: `八つの深層${card.overall_resonance ? `  共鳴度 ${card.overall_resonance}%` : ""}`,
                  size: "xxs",
                  color: "#5E5E7E",
                  margin: "lg",
                },
                ...card.calculator_summary.map(
                  (cs: {
                    tradition: string;
                    value: string;
                    disclosed: boolean;
                  }) => ({
                    type: "text",
                    text: `${cs.disclosed ? "★ " : "  "}${cs.tradition}: ${cs.value}`,
                    size: "xs",
                    color: cs.disclosed ? "#A8A8C8" : "#5E5E7E",
                    wrap: true,
                  }),
                ),
                { type: "separator", color: "#1a1a2e", margin: "lg" },
              ]
            : []),
          // closing
          {
            type: "text",
            text: card.closing_message,
            size: "sm",
            color: "#A8A8C8",
            align: "center",
            wrap: true,
            margin: "lg",
          },
          {
            type: "text",
            text: "あなたの水面に映った言葉から紡がれました",
            size: "xxs",
            color: "#4E4E6E",
            align: "center",
            margin: "lg",
          },
          {
            type: "button",
            action: {
              type: "message",
              label: "もう一度、水面を覗く",
              text: "診断",
            },
            style: "link",
            color: accent,
            height: "sm",
            margin: "md",
          },
        ],
      },
    },
  };
}
