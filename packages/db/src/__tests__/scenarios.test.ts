import { describe, expect, it } from "vitest";
import { scenarioMatchesAccount } from "../scenarios.js";

describe("scenarioMatchesAccount", () => {
  it("both null → match (legacy global scenario × legacy friend)", () => {
    expect(scenarioMatchesAccount(null, null)).toBe(true);
  });

  it("scenario unassigned + friend scoped → match (legacy global scenario)", () => {
    expect(scenarioMatchesAccount(null, "PROD")).toBe(true);
  });

  it("scenario scoped + friend unassigned → BLOCK (DEV→PROD leakage防止の核心)", () => {
    expect(scenarioMatchesAccount("PROD", null)).toBe(false);
  });

  it("both scoped to same account → match", () => {
    expect(scenarioMatchesAccount("PROD", "PROD")).toBe(true);
  });

  it("scenario PROD + friend DEV → BLOCK", () => {
    expect(scenarioMatchesAccount("PROD", "DEV")).toBe(false);
  });

  it("scenario DEV + friend PROD → BLOCK", () => {
    expect(scenarioMatchesAccount("DEV", "PROD")).toBe(false);
  });

  it("undefined is treated like null on both sides", () => {
    expect(scenarioMatchesAccount(undefined, undefined)).toBe(true);
    expect(scenarioMatchesAccount(undefined, "PROD")).toBe(true);
    expect(scenarioMatchesAccount("PROD", undefined)).toBe(false);
  });
});
