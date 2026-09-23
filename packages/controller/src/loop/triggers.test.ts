import { describe, expect, it } from "vitest";
import { TRIGGER_KINDS } from "./types.js";
import { isTriggerKind, reentryScopeForTrigger, reentryStageForTrigger } from "./triggers.js";

describe("trigger re-entry", () => {
  it("re-enters at sense only for changed inputs, scoped to affected capabilities", () => {
    expect(reentryStageForTrigger("inputs-changed")).toBe("sense");
    expect(reentryScopeForTrigger("inputs-changed")).toBe("affected-capabilities-only");
  });

  it("re-enters at judge for a role change, a freshness window, or a client request", () => {
    expect(reentryStageForTrigger("role-changed")).toBe("judge");
    expect(reentryStageForTrigger("freshness-window")).toBe("judge");
    expect(reentryStageForTrigger("client-request")).toBe("judge");
  });

  it("re-enters at learn for a review window or a missed outcome", () => {
    expect(reentryStageForTrigger("review-window")).toBe("learn");
    expect(reentryStageForTrigger("outcome-missed")).toBe("learn");
  });

  it("scopes a role change to every capability, and a client request to the one named", () => {
    expect(reentryScopeForTrigger("role-changed")).toBe("all-capabilities");
    expect(reentryScopeForTrigger("client-request")).toBe("named-capability");
  });

  it("covers every declared trigger kind with no gaps in either map", () => {
    for (const trigger of TRIGGER_KINDS) {
      expect(["sense", "judge", "act", "verify", "learn"]).toContain(reentryStageForTrigger(trigger));
      expect(["affected-capabilities-only", "all-capabilities", "named-capability"]).toContain(reentryScopeForTrigger(trigger));
    }
  });

  it("recognizes only the declared trigger kinds", () => {
    expect(isTriggerKind("inputs-changed")).toBe(true);
    expect(isTriggerKind("outcome-missed")).toBe(true);
    expect(isTriggerKind("budget-exceeded")).toBe(false);
    expect(isTriggerKind(42)).toBe(false);
  });
});
