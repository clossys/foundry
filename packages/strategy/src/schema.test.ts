import { describe, expect, it } from "vitest";
import {
  validateAudience,
  validateFact,
  validateFacts,
  validateMarket,
  validateMission,
  validateMoney,
  validatePositioning,
  validateRoadmapItem,
} from "./schema.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain. "Widgetronic" is a placeholder name invented for this
// test file only.

describe("validateMoney", () => {
  it("accepts a well-formed amount + ISO 4217 currency", () => {
    expect(validateMoney({ amount: 4200000, currency: "USD" }).ok).toBe(true);
  });

  it("rejects a currency that is not a 3-letter uppercase code", () => {
    expect(validateMoney({ amount: 100, currency: "usd" }).ok).toBe(false);
    expect(validateMoney({ amount: 100, currency: "US" }).ok).toBe(false);
    expect(validateMoney({ amount: 100, currency: "US$" }).ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(validateMoney("4200000 USD").ok).toBe(false);
    expect(validateMoney(null).ok).toBe(false);
    expect(validateMoney(undefined).ok).toBe(false);
  });
});

describe("validateFact", () => {
  const base = {
    key: "active-customers",
    label: "Active customers",
    value: 4200,
    unit: "customers",
    source: "billing-export-2026-06",
    lastUpdatedAt: "2026-06-30",
  };

  it("accepts a well-formed fact", () => {
    expect(validateFact(base).ok).toBe(true);
  });

  it("accepts a Money value", () => {
    expect(validateFact({ ...base, value: { amount: 4200000, currency: "USD" } }).ok).toBe(true);
  });

  it("rejects a key that is not kebab-case", () => {
    expect(validateFact({ ...base, key: "Active_Customers" }).ok).toBe(false);
    expect(validateFact({ ...base, key: "activeCustomers" }).ok).toBe(false);
  });

  it("rejects a non-ISO-date lastUpdatedAt", () => {
    expect(validateFact({ ...base, lastUpdatedAt: "June 30 2026" }).ok).toBe(false);
  });

  it("requires source", () => {
    const { source, ...rest } = base;
    expect(validateFact(rest).ok).toBe(false);
  });

  it("rejects a value that is not a string, number, boolean, or Money object", () => {
    expect(validateFact({ ...base, value: null }).ok).toBe(false);
    expect(validateFact({ ...base, value: [1, 2, 3] }).ok).toBe(false);
  });

  it("reports a path-scoped issue for a nested Money field", () => {
    const result = validateFact({ ...base, value: { amount: 100, currency: "usd" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "(root).value.currency")).toBe(true);
    }
  });

  it("rejects a non-object input", () => {
    expect(validateFact("not an object").ok).toBe(false);
    expect(validateFact(null).ok).toBe(false);
  });
});

describe("validateFacts", () => {
  const fact = (key: string) => ({
    key,
    label: key,
    value: 1,
    source: "test",
    lastUpdatedAt: "2026-01-01",
  });

  it("accepts a set of facts with unique keys", () => {
    const result = validateFacts([fact("a"), fact("b")]);
    expect(result.ok).toBe(true);
  });

  it("rejects a duplicate fact key", () => {
    const result = validateFacts([fact("a"), fact("a")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('duplicate fact key "a"');
    }
  });

  it("accepts an empty array", () => {
    expect(validateFacts([]).ok).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateFacts({}).ok).toBe(false);
  });
});

describe("validateMission", () => {
  it("accepts a well-formed mission", () => {
    const result = validateMission({
      statement: "We help small teams ship internal tools faster.",
      vision: "A world where every team can build its own software.",
      values: [{ name: "Clarity", rule: "When two designs are equally good, ship the one a newcomer understands fastest." }],
    });
    expect(result.ok).toBe(true);
  });

  it("requires at least one operating value", () => {
    const result = validateMission({
      statement: "We help small teams ship internal tools faster.",
      vision: "A world where every team can build its own software.",
      values: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("validatePositioning", () => {
  it("accepts a well-formed positioning statement", () => {
    const result = validatePositioning({
      productName: "Widgetronic",
      category: "internal tooling platform",
      forWhom: "operations teams at mid-size companies",
      weAre: "the fastest way to turn a spreadsheet into a real tool",
      unlike: "general-purpose no-code builders",
      reasonToBelieve: "we ship a working prototype in the same meeting the request is made",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateMarket / validateAudience / validateRoadmapItem", () => {
  it("accept well-formed entries", () => {
    expect(
      validateMarket({ id: "smb-ops", name: "SMB operations", description: "Small and mid-size operations teams.", factRefs: ["active-customers"] })
        .ok,
    ).toBe(true);
    expect(
      validateAudience({ id: "ops-lead", name: "Operations lead", description: "Runs day-to-day operations.", painPoints: ["too many spreadsheets"] })
        .ok,
    ).toBe(true);
    expect(
      validateRoadmapItem({ id: "sso", title: "Single sign-on", status: "next", description: "SAML-based SSO." }).ok,
    ).toBe(true);
  });

  it("rejects a roadmap status outside the closed vocabulary", () => {
    expect(
      validateRoadmapItem({ id: "sso", title: "Single sign-on", status: "someday", description: "SAML-based SSO." }).ok,
    ).toBe(false);
  });
});
