import { describe, expect, it } from "vitest";
import {
  AudienceSchema,
  FactSchema,
  FactsFileSchema,
  MarketSchema,
  MissionSchema,
  MoneySchema,
  PositioningSchema,
  RoadmapItemSchema,
} from "./schema.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain. "Widgetronic" is a placeholder name invented for this
// test file only.

describe("MoneySchema", () => {
  it("accepts a well-formed amount + ISO 4217 currency", () => {
    expect(MoneySchema.safeParse({ amount: 4200000, currency: "USD" }).success).toBe(true);
  });

  it("rejects a currency that is not a 3-letter uppercase code", () => {
    expect(MoneySchema.safeParse({ amount: 100, currency: "usd" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: 100, currency: "US" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: 100, currency: "US$" }).success).toBe(false);
  });
});

describe("FactSchema", () => {
  const base = {
    key: "active-customers",
    label: "Active customers",
    value: 4200,
    unit: "customers",
    source: "billing-export-2026-06",
    lastUpdatedAt: "2026-06-30",
  };

  it("accepts a well-formed fact", () => {
    expect(FactSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a Money value", () => {
    expect(
      FactSchema.safeParse({ ...base, value: { amount: 4200000, currency: "USD" } }).success,
    ).toBe(true);
  });

  it("rejects a key that is not kebab-case", () => {
    expect(FactSchema.safeParse({ ...base, key: "Active_Customers" }).success).toBe(false);
    expect(FactSchema.safeParse({ ...base, key: "activeCustomers" }).success).toBe(false);
  });

  it("rejects a non-ISO-date lastUpdatedAt", () => {
    expect(FactSchema.safeParse({ ...base, lastUpdatedAt: "June 30 2026" }).success).toBe(false);
  });

  it("requires source", () => {
    const { source, ...rest } = base;
    expect(FactSchema.safeParse(rest).success).toBe(false);
  });
});

describe("FactsFileSchema", () => {
  const fact = (key: string) => ({
    key,
    label: key,
    value: 1,
    source: "test",
    lastUpdatedAt: "2026-01-01",
  });

  it("accepts a set of facts with unique keys", () => {
    const result = FactsFileSchema.safeParse([fact("a"), fact("b")]);
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate fact key", () => {
    const result = FactsFileSchema.safeParse([fact("a"), fact("a")]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('duplicate fact key "a"');
    }
  });
});

describe("MissionSchema", () => {
  it("accepts a well-formed mission", () => {
    const result = MissionSchema.safeParse({
      statement: "We help small teams ship internal tools faster.",
      vision: "A world where every team can build its own software.",
      values: [{ name: "Clarity", rule: "When two designs are equally good, ship the one a newcomer understands fastest." }],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one operating value", () => {
    const result = MissionSchema.safeParse({
      statement: "We help small teams ship internal tools faster.",
      vision: "A world where every team can build its own software.",
      values: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("PositioningSchema", () => {
  it("accepts a well-formed positioning statement", () => {
    const result = PositioningSchema.safeParse({
      productName: "Widgetronic",
      category: "internal tooling platform",
      forWhom: "operations teams at mid-size companies",
      weAre: "the fastest way to turn a spreadsheet into a real tool",
      unlike: "general-purpose no-code builders",
      reasonToBelieve: "we ship a working prototype in the same meeting the request is made",
    });
    expect(result.success).toBe(true);
  });
});

describe("MarketSchema / AudienceSchema / RoadmapItemSchema", () => {
  it("accept well-formed entries", () => {
    expect(
      MarketSchema.safeParse({ id: "smb-ops", name: "SMB operations", description: "Small and mid-size operations teams.", factRefs: ["active-customers"] })
        .success,
    ).toBe(true);
    expect(
      AudienceSchema.safeParse({ id: "ops-lead", name: "Operations lead", description: "Runs day-to-day operations.", painPoints: ["too many spreadsheets"] })
        .success,
    ).toBe(true);
    expect(
      RoadmapItemSchema.safeParse({ id: "sso", title: "Single sign-on", status: "next", description: "SAML-based SSO." }).success,
    ).toBe(true);
  });

  it("rejects a roadmap status outside the closed vocabulary", () => {
    expect(
      RoadmapItemSchema.safeParse({ id: "sso", title: "Single sign-on", status: "someday", description: "SAML-based SSO." }).success,
    ).toBe(false);
  });
});
