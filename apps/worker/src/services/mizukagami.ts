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

type SessionState = "AWAITING_BIRTHDAY" | "CALCULATING" | "RESULT_SHOWN";

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
        );
        await lineClient.pushMessage(lineUserId, [flexMessage]);

        // セッション完了
        await updateSession(db, session.id, {
          state: "RESULT_SHOWN",
          diagnosis_result: JSON.stringify(result),
          completed_at: new Date().toISOString(),
        });
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
      // 計算中のメッセージを受け取った場合
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "診断結果を計算中です... 少々お待ちください ⏳",
        },
      ]);
      return true;
    }

    default:
      return false;
  }
}
