/**
 * SUMMIT 2026-05-17 live-demo handlers — unit tests.
 *
 * 既存「発火」(IGNITION_発火) ハンドラと同じ実装パターンで、以下 2 機能を検証する:
 *
 *   - 機能 1: text === "サミット" → addTagToFriend(friend.id, SUMMIT_TAG_ID) + reply
 *   - 機能 2: SUMMIT タグ持ち友達の自由文 → reply + Supabase POST (summit_demo_inbox)
 *
 * webhook.test.ts と同じ vi.mock 戦略を採用し、@line-crm/db / @line-crm/line-sdk /
 * services 一式をスタブする。
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// 機能 1 で必須: addTagToFriend / getFriendByLineUserId / messages_log INSERT
// SUMMIT TAG ID (migration 041 で seed されるのと同じ固定 UUID)
const SUMMIT_TAG_ID = "b2d4a3f0-5e17-4cae-9a01-20260517a001";

// ─── @line-crm/db スタブ ────────────────────────────────────
const addTagToFriendMock = vi.fn().mockResolvedValue(undefined);
const getFriendByLineUserIdMock = vi.fn();
const upsertFriendMock = vi.fn();
const upsertChatOnMessageMock = vi.fn().mockResolvedValue(undefined);
const getScenariosMock = vi.fn().mockResolvedValue([]);
const getLineAccountsMock = vi.fn().mockResolvedValue([]);
const jstNowMock = vi.fn().mockReturnValue("2026-05-17T13:00:00.000+09:00");
const scenarioMatchesAccountMock = vi.fn().mockReturnValue(true);

vi.mock("@line-crm/db", () => ({
  upsertFriend: upsertFriendMock,
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: getFriendByLineUserIdMock,
  getScenarios: getScenariosMock,
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn().mockResolvedValue([]),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: upsertChatOnMessageMock,
  getLineAccounts: getLineAccountsMock,
  jstNow: jstNowMock,
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: addTagToFriendMock,
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  scenarioMatchesAccount: scenarioMatchesAccountMock,
}));

// ─── @line-crm/line-sdk スタブ ───────────────────────────────
const verifySignatureMock = vi.fn().mockResolvedValue(true);
const replyMessageMock = vi.fn().mockResolvedValue({ status: 200 });

vi.mock("@line-crm/line-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@line-crm/line-sdk")>(
      "@line-crm/line-sdk",
    );
  return {
    ...actual,
    verifySignature: verifySignatureMock,
    LineClient: vi.fn().mockImplementation(() => ({
      replyMessage: replyMessageMock,
      getProfile: vi.fn().mockResolvedValue({ displayName: "TestUser" }),
    })),
  };
});

// ─── services スタブ (副作用を遮断) ───────────────────────────
vi.mock("../services/event-bus.js", () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/step-delivery.js", () => ({
  buildMessage: vi.fn().mockReturnValue({ type: "text", text: "" }),
  expandVariables: vi.fn((s: string) => s),
  resolveMetadata: vi.fn().mockResolvedValue({}),
}));
vi.mock("../lib/posthog.js", () => ({
  createPostHogClient: vi.fn().mockReturnValue(null),
}));

import { webhook } from "./webhook.js";

// ─── D1 fake — INSERT / SELECT 最低限を吸収する ───────────────
// SUMMIT tag check (SELECT 1 ...) の返り値を differentiate するため、
// `summitTagPresent` フラグを介して切り替える。
let summitTagPresent = false;

function makeDb(): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    all: vi.fn().mockResolvedValue({ results: [] }),
    first: vi.fn().mockImplementation((..._args: unknown[]) => {
      // 直近の prepare query を見て SUMMIT タグチェックなら summitTagPresent を返す
      if (
        lastPreparedSql.includes("friend_tags") &&
        lastPreparedSql.includes("LIMIT 1")
      ) {
        return Promise.resolve(summitTagPresent ? { hit: 1 } : null);
      }
      return Promise.resolve(null);
    }),
  };
  let lastPreparedSql = "";
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      lastPreparedSql = sql;
      return stmt;
    }),
  } as unknown as D1Database;
}

function setupApp() {
  const app = new Hono();
  app.route("/", webhook);
  return app;
}

let waitUntilPromise: Promise<unknown> | null = null;

function makeExecCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      waitUntilPromise = p;
    }),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: "test-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-token",
  SUMMIT_SUPABASE_URL: "https://example-phoenix.supabase.co",
  SUMMIT_SUPABASE_SERVICE_KEY: "test-summit-key",
} as Record<string, unknown>;

const validSignature = "A".repeat(43) + "=";

beforeEach(() => {
  vi.clearAllMocks();
  verifySignatureMock.mockResolvedValue(true);
  // re-bind because clearAllMocks() drops return values
  addTagToFriendMock.mockResolvedValue(undefined);
  getScenariosMock.mockResolvedValue([]);
  getLineAccountsMock.mockResolvedValue([]);
  jstNowMock.mockReturnValue("2026-05-17T13:00:00.000+09:00");
  scenarioMatchesAccountMock.mockReturnValue(true);
  replyMessageMock.mockResolvedValue({ status: 200 });
  waitUntilPromise = null;
  summitTagPresent = false;
});

describe("SUMMIT_20260517 機能 1: キーワード「サミット」→ タグ自動付与", () => {
  test('text === "サミット" で addTagToFriend が SUMMIT_TAG_ID で呼ばれる', async () => {
    // friend は事前に存在する想定 (LINE 友達追加後)
    getFriendByLineUserIdMock.mockResolvedValue({
      id: "friend-uuid-1",
      line_user_id: "U-test-1",
      line_account_id: null,
      display_name: "TestUser",
      metadata: null,
    });

    const app = setupApp();
    const env = { ...baseEnv, DB: makeDb() };
    const ctx = makeExecCtx();
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Line-Signature": validSignature,
        },
        body: JSON.stringify({
          events: [
            {
              type: "message",
              webhookEventId: "evt-summit-keyword-1",
              timestamp: 1747449600000,
              replyToken: "reply-token-1",
              source: { type: "user", userId: "U-test-1" },
              message: { type: "text", id: "msg-1", text: "サミット" },
            },
          ],
        }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    // waitUntil の内部処理を完走させる
    if (waitUntilPromise) await waitUntilPromise;

    expect(addTagToFriendMock).toHaveBeenCalledWith(
      expect.anything(),
      "friend-uuid-1",
      SUMMIT_TAG_ID,
    );
    // 歓迎返信が出ている
    expect(replyMessageMock).toHaveBeenCalledWith(
      "reply-token-1",
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("サミットへようこそ"),
        }),
      ]),
    );
  });
});

describe("SUMMIT_20260517 機能 2: タグ持ち友達の自由文 → 受信確認 + Supabase 保存", () => {
  test("SUMMIT タグ持ち friend の自由文 → reply + summit_demo_inbox POST", async () => {
    summitTagPresent = true;
    getFriendByLineUserIdMock.mockResolvedValue({
      id: "friend-uuid-2",
      line_user_id: "U-test-2",
      line_account_id: null,
      display_name: "SummitGuest",
      metadata: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const app = setupApp();
    const env = { ...baseEnv, DB: makeDb() };
    const ctx = makeExecCtx();
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Line-Signature": validSignature,
        },
        body: JSON.stringify({
          events: [
            {
              type: "message",
              webhookEventId: "evt-summit-free-1",
              timestamp: 1747449700000,
              replyToken: "reply-token-2",
              source: { type: "user", userId: "U-test-2" },
              message: {
                type: "text",
                id: "msg-2",
                text: "会場で叶えたいこと: もっとAIで稼ぐ",
              },
            },
          ],
        }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    if (waitUntilPromise) await waitUntilPromise;

    // 受信確認返信
    expect(replyMessageMock).toHaveBeenCalledWith(
      "reply-token-2",
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("届きました"),
        }),
      ]),
    );

    // Supabase POST (summit_demo_inbox)
    const summitFetchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("summit_demo_inbox"),
    );
    expect(summitFetchCall).toBeTruthy();
    expect(summitFetchCall?.[0]).toBe(
      "https://example-phoenix.supabase.co/rest/v1/summit_demo_inbox",
    );
    const init = summitFetchCall?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      line_user_id: "U-test-2",
      friend_id: "friend-uuid-2",
      text: "会場で叶えたいこと: もっとAIで稼ぐ",
      summit_id: "SUMMIT_20260517",
    });

    fetchMock.mockRestore();
  });

  test("SUMMIT タグ未保有の friend は自由文を summit_demo_inbox に保存しない", async () => {
    summitTagPresent = false;
    getFriendByLineUserIdMock.mockResolvedValue({
      id: "friend-uuid-3",
      line_user_id: "U-test-3",
      line_account_id: null,
      display_name: "NormalGuest",
      metadata: null,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const app = setupApp();
    const env = { ...baseEnv, DB: makeDb() };
    const ctx = makeExecCtx();
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Line-Signature": validSignature,
        },
        body: JSON.stringify({
          events: [
            {
              type: "message",
              webhookEventId: "evt-non-summit-1",
              timestamp: 1747449800000,
              replyToken: "reply-token-3",
              source: { type: "user", userId: "U-test-3" },
              message: { type: "text", id: "msg-3", text: "こんにちは" },
            },
          ],
        }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    if (waitUntilPromise) await waitUntilPromise;

    const summitFetchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("summit_demo_inbox"),
    );
    expect(summitFetchCall).toBeUndefined();
    fetchMock.mockRestore();
  });
});

describe("SUMMIT_20260517: 既存「発火」ハンドラを壊さない (regression)", () => {
  test('text === "発火" は既存 IGNITION ハンドラ (e3470801...) を呼び SUMMIT を呼ばない', async () => {
    getFriendByLineUserIdMock.mockResolvedValue({
      id: "friend-uuid-4",
      line_user_id: "U-test-4",
      line_account_id: null,
      display_name: "IgnitionUser",
      metadata: null,
    });

    const app = setupApp();
    const env = { ...baseEnv, DB: makeDb() };
    const ctx = makeExecCtx();
    await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Line-Signature": validSignature,
        },
        body: JSON.stringify({
          events: [
            {
              type: "message",
              webhookEventId: "evt-ignition-1",
              timestamp: 1747449900000,
              replyToken: "reply-token-4",
              source: { type: "user", userId: "U-test-4" },
              message: { type: "text", id: "msg-4", text: "発火" },
            },
          ],
        }),
      },
      env,
      ctx,
    );

    if (waitUntilPromise) await waitUntilPromise;

    // IGNITION tag UUID で呼ばれる、SUMMIT tag UUID では呼ばれない
    expect(addTagToFriendMock).toHaveBeenCalledWith(
      expect.anything(),
      "friend-uuid-4",
      "e3470801-f9d2-474a-9eb0-a4dfd8983262",
    );
    expect(addTagToFriendMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      SUMMIT_TAG_ID,
    );
  });
});
