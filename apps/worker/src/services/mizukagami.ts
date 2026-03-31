/**
 * MIZUKAGAMI Mirror Session — CF Workers → Soul Agent Platform BFF
 *
 * フロー:
 * 1. ユーザーが「水鏡」→ D1に状態 waiting_birthday を記録
 * 2. 生年月日入力 → diagnosis API (innate_only) → innateProfile取得
 * 3. innateProfile → mirror-session API (action=start) → 対話開始
 * 4. 以降のテキスト → mirror-session API (action=message) → 対話継続
 * 5. 完了時 → Web Report リンク送信
 */

import { LineClient } from "@line-crm/line-sdk";

// ============================================================
// Types
// ============================================================

interface MirrorSessionApiResponse {
  session_id: string;
  current_step: string;
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
}

interface DiagnosisApiResponse {
  diagnosis: {
    innate: {
      primary: string;
      confidence: number;
      details: Record<string, unknown>;
    };
  };
  unleash: {
    kaku: { name: string; description: string };
    honryou: { name: string; description: string };
    miushinai: { name: string; description: string };
  } | null;
  calculatorDetails: Record<
    string,
    { tradition: string; weight: number; data: Record<string, unknown> }
  >;
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

type MizukagamiState = "waiting_birthday" | "active" | "completed";

interface MizukagamiD1Row {
  id: string;
  line_user_id: string;
  state: MizukagamiState;
  birth_date: string | null;
  sap_session_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// D1 Table setup (idempotent)
// ============================================================

export async function ensureMizukagamiTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `
    CREATE TABLE IF NOT EXISTS mizukagami_sessions (
      id TEXT PRIMARY KEY,
      line_user_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'waiting_birthday',
      birth_date TEXT,
      sap_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
    )
    .run();
  // Index for quick lookup
  await db
    .prepare(
      `
    CREATE INDEX IF NOT EXISTS idx_mizukagami_sessions_user_state
    ON mizukagami_sessions (line_user_id, state)
  `,
    )
    .run();
}

// ============================================================
// D1 Operations
// ============================================================

async function getActiveD1Session(
  db: D1Database,
  lineUserId: string,
): Promise<MizukagamiD1Row | null> {
  return db
    .prepare(
      "SELECT * FROM mizukagami_sessions WHERE line_user_id = ? AND state IN ('waiting_birthday', 'active') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lineUserId)
    .first<MizukagamiD1Row>();
}

async function createD1Session(
  db: D1Database,
  lineUserId: string,
): Promise<MizukagamiD1Row> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO mizukagami_sessions (id, line_user_id, state, created_at, updated_at) VALUES (?, ?, 'waiting_birthday', ?, ?)",
    )
    .bind(id, lineUserId, now, now)
    .run();
  return {
    id,
    line_user_id: lineUserId,
    state: "waiting_birthday",
    birth_date: null,
    sap_session_id: null,
    created_at: now,
    updated_at: now,
  };
}

async function updateD1Session(
  db: D1Database,
  id: string,
  updates: Partial<
    Pick<MizukagamiD1Row, "state" | "birth_date" | "sap_session_id">
  >,
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const vals: string[] = [new Date().toISOString()];
  if (updates.state) {
    sets.push("state = ?");
    vals.push(updates.state);
  }
  if (updates.birth_date) {
    sets.push("birth_date = ?");
    vals.push(updates.birth_date);
  }
  if (updates.sap_session_id) {
    sets.push("sap_session_id = ?");
    vals.push(updates.sap_session_id);
  }
  vals.push(id);
  await db
    .prepare(`UPDATE mizukagami_sessions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
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
// Birthday parsing
// ============================================================

function parseBirthday(text: string): string | null {
  // Strip all non-digit characters first, then check patterns
  const digitsOnly = text.trim().replace(/[\s\-\/\.年月日]/g, "");

  let year: number, month: number, day: number;

  // Pattern 1: 8 digits (YYYYMMDD)
  const m8 = digitsOnly.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    year = parseInt(m8[1], 10);
    month = parseInt(m8[2], 10);
    day = parseInt(m8[3], 10);
  } else {
    // Pattern 2: YYYY-MM-DD or YYYY/MM/DD (original text)
    const mDash = text.trim().match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
    if (mDash) {
      year = parseInt(mDash[1], 10);
      month = parseInt(mDash[2], 10);
      day = parseInt(mDash[3], 10);
    } else {
      return null;
    }
  }

  // Validate ranges
  if (year < 1900 || year > new Date().getFullYear()) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Build YYYY-MM-DD string
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Final validation: ensure it's a real date and in the past
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  )
    return null;
  if (d > new Date()) return null;

  return dateStr;
}

// ============================================================
// API Clients (with Vercel Protection Bypass)
// ============================================================

/** Build common headers for SAP API calls. Includes Vercel bypass if configured. */
function buildSapHeaders(
  sapApiKey: string,
  vercelBypass?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": sapApiKey,
  };
  if (vercelBypass) {
    headers["x-vercel-protection-bypass"] = vercelBypass;
  }
  return headers;
}

async function callDiagnosisApi(
  sapApiUrl: string,
  sapApiKey: string,
  birthday: string,
  vercelBypass?: string,
): Promise<DiagnosisApiResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/diagnosis`, {
    method: "POST",
    headers: buildSapHeaders(sapApiKey, vercelBypass),
    body: JSON.stringify({ birthday, mode: "innate_only" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Diagnosis API error: ${res.status} ${text}`);
  }
  return (await res.json()) as DiagnosisApiResponse;
}

async function callMirrorSessionApi(
  sapApiUrl: string,
  sapApiKey: string,
  body: Record<string, unknown>,
  vercelBypass?: string,
): Promise<MirrorSessionApiResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
    method: "POST",
    headers: buildSapHeaders(sapApiKey, vercelBypass),
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
  vercelBypass?: string,
): Promise<MirrorSessionStatusResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
    method: "POST",
    headers: buildSapHeaders(sapApiKey, vercelBypass),
    body: JSON.stringify({ action: "status", line_user_id: lineUserId }),
  });
  if (!res.ok) return { hasActiveSession: false, session: null };
  return (await res.json()) as MirrorSessionStatusResponse;
}

// ============================================================
// Tradition colors
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
// Flex Message builders
// ============================================================

function buildProgressDots(
  disclosed: string[],
  total: number = 12,
): Record<string, unknown> {
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push({
      type: "box",
      layout: "vertical",
      width: "6px",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: i < disclosed.length ? "#7EB8D8" : "#1a1a2e",
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
): Record<string, unknown> {
  const tradContents = newTraditions.map((t) => {
    const tc = TRADITION_COLORS[t] ?? { color: "#8e8ea8", label: "" };
    return {
      type: "box",
      layout: "horizontal",
      margin: "sm",
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
          margin: "sm",
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
        })),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        {
          type: "text",
          text: card.closing_message,
          size: "xs",
          color: "#8e8ea8",
          wrap: true,
          align: "center",
          margin: "lg",
        },
      ],
    },
  };
}

// ============================================================
// Main handler
// ============================================================

export interface MizukagamiResult {
  handled: boolean;
  error?: string;
}

export async function handleMizukagami(
  db: D1Database,
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  sapApiUrl: string,
  sapApiKey: string,
  vercelBypass?: string,
): Promise<MizukagamiResult> {
  try {
    await ensureMizukagamiTable(db);

    const d1Session = await getActiveD1Session(db, lineUserId);

    // --- Case 1: No D1 session, check if trigger ---
    if (!d1Session) {
      if (!isMizukagamiTrigger(text)) {
        // Also check SAP for active mirror session (resuming after worker restart)
        const sapStatus = await checkMirrorSessionStatus(
          sapApiUrl,
          sapApiKey,
          lineUserId,
          vercelBypass,
        );
        if (!sapStatus.hasActiveSession) return { handled: false };
        // SAP has active session but D1 doesn't — create D1 record and continue
        const newD1 = await createD1Session(db, lineUserId);
        await updateD1Session(db, newD1.id, {
          state: "active",
          sap_session_id: sapStatus.session?.session_id ?? null,
        });
        // Fall through to Case 3 (active session message)
        return await handleActiveSession(
          db,
          newD1.id,
          lineClient,
          lineUserId,
          text,
          replyToken,
          sapApiUrl,
          sapApiKey,
          vercelBypass,
        );
      }

      // Trigger detected — start new session
      await createD1Session(db, lineUserId);
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
        },
      ]);
      return { handled: true };
    }

    // --- Case 2: Waiting for birthday ---
    if (d1Session.state === "waiting_birthday") {
      // If user sends trigger word again, reset session
      if (isMizukagamiTrigger(text)) {
        await updateD1Session(db, d1Session.id, { state: "completed" });
        const newSession = await createD1Session(db, lineUserId);
        console.log(
          `[mizukagami] Session reset for ${lineUserId}, new session: ${newSession.id}`,
        );
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }

      const birthday = parseBirthday(text);
      console.log(`[mizukagami] parseBirthday("${text}") => ${birthday}`);
      if (!birthday) {
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "生年月日の形式が正しくありません。\n8桁の数字で入力してください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }

      // Call diagnosis API
      let diagResult: DiagnosisApiResponse;
      try {
        diagResult = await callDiagnosisApi(
          sapApiUrl,
          sapApiKey,
          birthday,
          vercelBypass,
        );
      } catch (err) {
        console.error("[mizukagami] Diagnosis API failed:", err);
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "診断の計算中にエラーが発生しました。\nもう一度生年月日を送ってみてください。",
          },
        ]);
        return { handled: true };
      }

      // Build innateProfile from diagnosis response
      const innateProfile = {
        spiralPrimary: diagResult.diagnosis.innate.primary,
        confidence: diagResult.diagnosis.innate.confidence,
        kaku: diagResult.unleash?.kaku ?? { name: "unknown", description: "" },
        honryou: diagResult.unleash?.honryou ?? {
          name: "unknown",
          description: "",
        },
        miushinai: diagResult.unleash?.miushinai ?? {
          name: "unknown",
          description: "",
        },
        calculatorDetails: diagResult.calculatorDetails,
      };

      // Start mirror session
      let sessionResponse: MirrorSessionApiResponse;
      try {
        sessionResponse = await callMirrorSessionApi(
          sapApiUrl,
          sapApiKey,
          {
            action: "start",
            line_user_id: lineUserId,
            innate_profile: innateProfile,
          },
          vercelBypass,
        );
      } catch (err) {
        console.error("[mizukagami] Mirror session start failed:", err);
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡のセッション開始に失敗しました。\nしばらくしてからもう一度お試しください。",
          },
        ]);
        return { handled: true };
      }

      // Update D1 state
      await updateD1Session(db, d1Session.id, {
        state: "active",
        birth_date: birthday,
        sap_session_id: sessionResponse.session_id,
      });

      // Send response messages
      const messages: Array<Record<string, unknown>> = [];
      if (sessionResponse.message) {
        messages.push({ type: "text", text: sessionResponse.message });
      }
      const disclosed = sessionResponse.disclosed_traditions ?? [];
      if (disclosed.length > 0) {
        messages.push({
          type: "flex",
          altText: `${disclosed.join("・")} が開示されました (${disclosed.length}/12)`,
          contents: buildDisclosureFlexBubble(disclosed, disclosed),
        });
      }
      if (messages.length > 0) {
        await lineClient.replyMessage(replyToken, messages.slice(0, 5));
      }
      return { handled: true };
    }

    // --- Case 3: Active session — forward to mirror-session API ---
    if (d1Session.state === "active") {
      return await handleActiveSession(
        db,
        d1Session.id,
        lineClient,
        lineUserId,
        text,
        replyToken,
        sapApiUrl,
        sapApiKey,
        vercelBypass,
      );
    }

    return { handled: false };
  } catch (err) {
    console.error("[mizukagami] Error:", err);
    return {
      handled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleActiveSession(
  db: D1Database,
  d1SessionId: string,
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  sapApiUrl: string,
  sapApiKey: string,
  vercelBypass?: string,
): Promise<MizukagamiResult> {
  // Get previous state for diff
  const prevStatus = await checkMirrorSessionStatus(
    sapApiUrl,
    sapApiKey,
    lineUserId,
    vercelBypass,
  );
  const previousDisclosed = prevStatus.session?.disclosed_traditions ?? [];

  const apiResponse = await callMirrorSessionApi(
    sapApiUrl,
    sapApiKey,
    {
      action: "message",
      line_user_id: lineUserId,
      text,
    },
    vercelBypass,
  );

  const messages: Array<Record<string, unknown>> = [];

  if (apiResponse.message) {
    messages.push({ type: "text", text: apiResponse.message });
  }

  // Tradition disclosure Flex
  const disclosed = apiResponse.disclosed_traditions ?? [];
  const newTraditions = disclosed.filter((t) => !previousDisclosed.includes(t));
  if (newTraditions.length > 0 && !apiResponse.card) {
    messages.push({
      type: "flex",
      altText: `${newTraditions.join("・")} が開示されました (${disclosed.length}/12)`,
      contents: buildDisclosureFlexBubble(disclosed, newTraditions),
    });
  }

  // Final card
  if (apiResponse.card) {
    messages.push({
      type: "flex",
      altText: "水鏡カード — あなたの12叡智の統合",
      contents: buildFinalCardFlexBubble(apiResponse.card),
    });
  }

  // Session completed
  if (apiResponse.sessionCompleted) {
    await updateD1Session(db, d1SessionId, { state: "completed" });
    if (apiResponse.session_id) {
      const reportUrl = `${sapApiUrl}/mizukagami/report/${apiResponse.session_id}`;
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
      });
    }
  }

  if (messages.length > 0) {
    await lineClient.replyMessage(replyToken, messages.slice(0, 5));
  }

  return { handled: true };
}
