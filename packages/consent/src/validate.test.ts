import { describe, expect, it } from "vitest";
import { isConsentAction, isConsentCategory, isConsentPolicyVersion, isGpcSignal } from "./validate.js";

describe("isConsentCategory", () => {
  it("accepts a non-empty string", () => expect(isConsentCategory("marketing")).toBe(true));
  it("rejects an empty or whitespace-only string", () => {
    expect(isConsentCategory("")).toBe(false);
    expect(isConsentCategory("   ")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isConsentCategory(1)).toBe(false);
    expect(isConsentCategory(null)).toBe(false);
    expect(isConsentCategory(undefined)).toBe(false);
  });
});

describe("isConsentPolicyVersion", () => {
  it("accepts a well-formed policy version", () => {
    expect(isConsentPolicyVersion({ policyId: "cookie-policy", version: "1" })).toBe(true);
  });
  it("rejects a missing or empty field", () => {
    expect(isConsentPolicyVersion({ policyId: "cookie-policy" })).toBe(false);
    expect(isConsentPolicyVersion({ policyId: "", version: "1" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isConsentPolicyVersion(null)).toBe(false);
    expect(isConsentPolicyVersion("cookie-policy@1")).toBe(false);
    expect(isConsentPolicyVersion(["cookie-policy", "1"])).toBe(false);
  });
});

describe("isGpcSignal", () => {
  it("accepts a well-formed signal", () => {
    expect(isGpcSignal({ present: true, observedAt: "2026-08-13T00:00:00.000Z" })).toBe(true);
  });
  it("rejects a truthy non-boolean present value", () => {
    expect(isGpcSignal({ present: "true", observedAt: "2026-08-13T00:00:00.000Z" })).toBe(false);
    expect(isGpcSignal({ present: 1, observedAt: "2026-08-13T00:00:00.000Z" })).toBe(false);
  });
  it("rejects an unparseable timestamp", () => {
    expect(isGpcSignal({ present: true, observedAt: "not-a-date" })).toBe(false);
    expect(isGpcSignal({ present: true, observedAt: "" })).toBe(false);
  });
});

describe("isConsentAction", () => {
  const policyVersion = { policyId: "cookie-policy", version: "1" };

  it("accepts a well-formed grant/deny/withdraw action", () => {
    expect(isConsentAction({ kind: "grant", category: "marketing", policyVersion })).toBe(true);
    expect(isConsentAction({ kind: "deny", category: "marketing", policyVersion })).toBe(true);
    expect(isConsentAction({ kind: "withdraw", category: "marketing", policyVersion })).toBe(true);
  });
  it("rejects an unrecognized kind", () => {
    expect(isConsentAction({ kind: "revoke", category: "marketing", policyVersion })).toBe(false);
  });
  it("rejects a withdraw action missing policyVersion", () => {
    expect(isConsentAction({ kind: "withdraw", category: "marketing" })).toBe(false);
  });
  it("rejects a malformed policyVersion nested inside an otherwise-valid action", () => {
    expect(isConsentAction({ kind: "grant", category: "marketing", policyVersion: { policyId: "cookie-policy" } })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isConsentAction(null)).toBe(false);
    expect(isConsentAction("grant")).toBe(false);
  });
});
