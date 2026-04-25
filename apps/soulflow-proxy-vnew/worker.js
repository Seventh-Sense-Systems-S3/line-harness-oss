// soulflow-proxy-vnew
//
// TruthSphere webhook → (1) Google Apps Script 転送
//   → (2) Supabase iqb_entries UPSERT (legacy, best-effort)
//   → (3) soul_memories Two-Track dual-write (Brief: soul_memories_two_track_arch 2026-04-22)
//        - Track 1 (子竜 Supabase): 常時実行。失敗時 500。
//        - Track 2 (受講生 Supabase): student_supabase_config に登録済みの場合のみ、ベストエフォート。
//          失敗時は cowork_notifications に INSERT (priority: medium) して 200 返却。
//
// 既存動作（GAS 転送 + iqb_entries UPSERT）は維持。soul_memories UPSERT は
// 新しい GPT 送信フォーマット `{ action, parameters: { sheetId, week, row, ... } }`
// に対してのみ発火する。旧フォーマット (tenant_id/user_id/...) が来た場合は
// soul_memories 側は `skipped: required_fields_missing` となり、Track 1 として
// 失敗扱いはしない (両フォーマットの同時稼働をサポート)。
//
// Secrets (wrangler secret put で設定):
//   - SUPABASE_URL                  例: https://eizsilomeafyhftuvqst.supabase.co
//   - SUPABASE_SERVICE_ROLE_KEY     phoenix-memory-os の service_role key
// 両方未設定の環境では Supabase 書き込みをスキップする (本番以外で安全に動作)。

// GAS Webアプリの /exec を指定（最新デプロイURL）
const API_URL =
  "https://script.google.com/macros/s/AKfycbz8FCVerL6qb6qI4ASzRqAX1IbmQboCTRZHdG4UcKw8j8V_JqtiL_a0XxqGzar2dHej/exec";
const TOKEN = "soulflow2025";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

// 複数候補キーから最初に見つかった非空値を返す
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// ================================================================
// Legacy: iqb_entries mapping + UPSERT (Course 2 AI clone RAG 用、温存)
// ================================================================
// 対応フォーマット:
//   旧) 直接フィールド形式: { tenant_id, user_id, week_number, week_label, entry_data, ... }
//   新) スフィGPT パラメータ形式: { action, parameters: { sheetId, week, row, 意味, ... } }
//       → tenant_id="7thsense", user_id=sheetId, week_label="Week N" として変換
function mapIncomingToIqbEntry(incoming) {
  const p = incoming?.parameters ?? null;

  // --- tenant_id: 旧フォーマット優先、新フォーマットでは固定値 "7thsense" ---
  const tenant_id =
    pick(incoming, "tenant_id", "tenantId") ??
    (p != null ? "7thsense" : undefined);

  // --- user_id: 旧フォーマット優先、新フォーマットでは sheetId を使用 ---
  const user_id =
    pick(incoming, "user_id", "userId") ?? pick(p, "sheetId", "sheet_id");

  // --- week_number: 旧フォーマット優先、新フォーマットでは parameters.week ---
  const week_number_raw =
    pick(incoming, "week_number", "weekNumber", "week") ?? pick(p, "week");
  const week_number =
    week_number_raw !== undefined
      ? typeof week_number_raw === "string"
        ? parseInt(week_number_raw, 10)
        : week_number_raw
      : undefined;

  // --- week_label: 旧フォーマット優先、新フォーマットでは "Week N" として導出 ---
  const week_label =
    pick(incoming, "week_label", "weekLabel") ??
    (week_number !== undefined ? `Week ${week_number}` : undefined);

  // --- entry_data: 旧フォーマット優先、新フォーマットでは parameters 全体 ---
  const entry_data =
    pick(incoming, "entry_data", "entryData") ?? incoming.data ?? p ?? incoming;

  const version = pick(incoming, "version") ?? 1;

  if (
    !tenant_id ||
    !user_id ||
    week_number === undefined ||
    !week_label ||
    !entry_data
  ) {
    return null;
  }

  return {
    tenant_id,
    user_id,
    week_number,
    week_label,
    source_gpt_number:
      pick(incoming, "source_gpt_number", "sourceGptNumber") ?? null,
    source_gpt_name:
      pick(incoming, "source_gpt_name", "sourceGptName") ??
      (p != null ? "TruthSphere" : null),
    entry_data,
    version: typeof version === "string" ? parseInt(version, 10) : version,
    is_finalized: pick(incoming, "is_finalized", "isFinalized") ?? false,
    finalized_at: pick(incoming, "finalized_at", "finalizedAt") ?? null,
  };
}

async function upsertIqbEntry(env, incoming) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    return { skipped: "supabase_env_missing" };
  }

  const row = mapIncomingToIqbEntry(incoming);
  if (!row) {
    return { skipped: "required_fields_missing" };
  }

  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/iqb_entries?on_conflict=tenant_id,user_id,week_number,version`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, status: resp.status, error: body.slice(0, 500) };
  }
  return { ok: true, status: resp.status };
}

// ================================================================
// Two-Track: soul_memories mapping
// ================================================================
// 新フォーマット `{ action, parameters: { sheetId, week, row, 意味, 価値観・信念, ... } }`
// にも、wrapper なしのフラット形式にも対応する。
function mapIncomingToSoulMemory(incoming) {
  const p = incoming?.parameters ?? incoming;

  const sheet_id = pick(p, "sheetId", "sheet_id");
  const week = pick(p, "week");
  const row_number = pick(p, "row", "row_number", "rowNumber");

  if (!sheet_id || week === undefined || row_number === undefined) {
    return null;
  }

  return {
    sheet_id,
    week: typeof week === "string" ? parseInt(week, 10) : week,
    row_number:
      typeof row_number === "string" ? parseInt(row_number, 10) : row_number,
    meaning: pick(p, "意味", "meaning") ?? null,
    values_belief:
      pick(p, "価値観・信念", "values_belief", "valuesBelief") ?? null,
    current_impact:
      pick(p, "現在への影響", "current_impact", "currentImpact") ?? null,
    pride: pick(p, "誇り", "pride") ?? null,
    reintegration_message:
      pick(
        p,
        "再統合メッセージ",
        "reintegration_message",
        "reintegrationMessage",
      ) ?? null,
    unfinished_theme:
      pick(p, "未完了テーマ", "unfinished_theme", "unfinishedTheme") ?? null,
    ingested_source: "webhook",
    updated_at: new Date().toISOString(),
  };
}

// Track 1: 子竜 Supabase (phoenix-memory-os) の soul_memories に UPSERT。
// 失敗は throw して上位で 500 に変換する。
async function upsertSoulMemoryTrack1(env, row) {
  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/soul_memories?on_conflict=sheet_id,week,row_number`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const body = await resp.text();
    const err = new Error(
      `track1_upsert_failed status=${resp.status} body=${body.slice(0, 500)}`,
    );
    err.status = resp.status;
    err.responseBody = body;
    throw err;
  }
  return { ok: true, status: resp.status };
}

// Track 2 の宛先情報を子竜 Supabase から取得。
// 登録がなければ null (= Track 2 skip)。
async function fetchStudentSupabaseConfig(env, sheet_id) {
  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/student_supabase_config?sheet_id=eq.${encodeURIComponent(
    sheet_id,
  )}&select=id,student_supabase_url,student_supabase_anon_key&limit=1`;
  const resp = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) {
    // 構成テーブル自体の取得失敗は Track 1 の状態に影響させない (silent fallback
    // ではなく、呼び出し元で response に載せる)
    const body = await resp.text();
    const err = new Error(
      `student_config_fetch_failed status=${resp.status} body=${body.slice(0, 300)}`,
    );
    err.status = resp.status;
    throw err;
  }
  const rows = await resp.json();
  return rows && rows[0] ? rows[0] : null;
}

// Track 2: 受講生 Supabase (anon_key) の soul_memories に UPSERT。
// ベストエフォート。失敗は throw して上位で cowork_notifications に記録。
async function upsertSoulMemoryTrack2(config, row) {
  const endpoint = `${config.student_supabase_url.replace(/\/$/, "")}/rest/v1/soul_memories?on_conflict=sheet_id,week,row_number`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: config.student_supabase_anon_key,
      authorization: `Bearer ${config.student_supabase_anon_key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const body = await resp.text();
    const err = new Error(
      `track2_upsert_failed status=${resp.status} body=${body.slice(0, 500)}`,
    );
    err.status = resp.status;
    err.responseBody = body;
    throw err;
  }
  return { ok: true, status: resp.status };
}

// Track 2 失敗時の通知。子竜の Supabase cowork_notifications に priority:medium で記録。
// 通知自体の失敗は黙殺せずログ応答に乗せる (silent fallback 禁止)。
async function notifyTrack2Failure(env, studentConfig, errMsg) {
  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/cowork_notifications`;
  const body = {
    source_table: "student_supabase_config",
    source_id: studentConfig.id,
    notification_type: "agent_failed",
    priority: "medium",
    summary: `soulflow-proxy-vnew Track 2 dual-write failed: ${errMsg}`.slice(
      0,
      1000,
    ),
  };
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { ok: false, status: resp.status, error: t.slice(0, 300) };
  }
  return { ok: true };
}

// ================================================================
// Two-Track orchestrator
// ================================================================
// 戻り値: { track1: {...}, track2: {...} }
// Track 1 失敗は throw (上位で 500 返却)。Track 2 失敗は戻り値に乗せて 200 返却。
async function twoTrackDualWrite(env, incoming) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      track1: { skipped: "supabase_env_missing" },
      track2: { skipped: "supabase_env_missing" },
    };
  }

  const row = mapIncomingToSoulMemory(incoming);
  if (!row) {
    return {
      track1: { skipped: "required_fields_missing" },
      track2: { skipped: "required_fields_missing" },
    };
  }

  // Track 1 (required)
  const track1 = await upsertSoulMemoryTrack1(env, row);

  // Track 2 lookup
  let studentConfig;
  try {
    studentConfig = await fetchStudentSupabaseConfig(env, row.sheet_id);
  } catch (e) {
    return {
      track1,
      track2: {
        ok: false,
        error: `config_lookup_failed: ${String(e.message || e)}`,
      },
    };
  }

  if (!studentConfig) {
    return {
      track1,
      track2: { skipped: "no_student_config", sheet_id: row.sheet_id },
    };
  }

  // Track 2 (best-effort)
  try {
    const track2 = await upsertSoulMemoryTrack2(studentConfig, row);
    return { track1, track2 };
  } catch (e) {
    const errMsg = String(e.message || e);
    const notifyResult = await notifyTrack2Failure(env, studentConfig, errMsg);
    return {
      track1,
      track2: { ok: false, error: errMsg, notified: notifyResult },
    };
  }
}

// ================================================================
// HTTP entry point
// ================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (
      request.method === "GET" &&
      (pathname === "/health" || pathname === "/v2/health")
    ) {
      return json({ status: "ok" });
    }

    const isWebhook =
      pathname === "/webhook/soul-diagnosis" ||
      pathname === "/v2/webhook/soul-diagnosis";

    if (request.method === "POST" && isWebhook) {
      let incoming;
      try {
        incoming = await request.json();
      } catch {
        return json({ status: 400, body: { error: "Invalid JSON" } });
      }

      incoming.token = TOKEN;

      // (1) GAS 転送 (既存動作そのまま)
      let gasPayload;
      let gasOk = false;
      try {
        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          redirect: "follow",
          body: JSON.stringify(incoming),
        });

        gasOk = resp.ok;
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          gasPayload = await resp.json();
        } else {
          gasPayload = {
            status: resp.status,
            body: { raw: await resp.text() },
          };
        }

        if (typeof gasPayload?.body !== "object") {
          gasPayload = {
            status: gasPayload?.status ?? resp.status,
            body: { result: gasPayload?.body ?? gasPayload },
          };
        }
      } catch (e) {
        return json({
          status: 500,
          body: { error: "Failed to reach GAS endpoint", message: String(e) },
        });
      }

      // GAS 成功時のみ Supabase 書き込みに進む (既存動作維持)
      if (gasOk) {
        // (2) iqb_entries UPSERT (legacy, best-effort) — 旧フォーマット payload 用
        try {
          const iqbResult = await upsertIqbEntry(env, incoming);
          gasPayload.body = { ...(gasPayload.body ?? {}), iqb: iqbResult };
        } catch (e) {
          gasPayload.body = {
            ...(gasPayload.body ?? {}),
            iqb: { ok: false, error: String(e) },
          };
        }

        // (3) Two-Track soul_memories dual-write
        //     Track 1 失敗は 500 に昇格 (brief 要件)
        try {
          const tracks = await twoTrackDualWrite(env, incoming);
          gasPayload.body = { ...(gasPayload.body ?? {}), ...tracks };

          if (tracks.track1?.ok === false) {
            // 実際には upsertSoulMemoryTrack1 が throw するのでここは通常来ないが、
            // 防御的に失敗ケースを 500 応答に変換する。
            return json(
              {
                status: 500,
                body: {
                  error: "Track 1 (soul_memories) write failed",
                  details: tracks.track1,
                },
              },
              500,
            );
          }
        } catch (e) {
          // Track 1 throw = 500
          return json(
            {
              status: 500,
              body: {
                error: "Track 1 (soul_memories) write failed",
                message: String(e.message || e),
              },
            },
            500,
          );
        }
      }

      return json(gasPayload);
    }

    return new Response("Not Found", { status: 404 });
  },
};
