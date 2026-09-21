import { describe, expect, it } from "vitest";
import {
  validateAudience,
  validateBrand,
  validateDirectionEntities,
  validateDirectionEntity,
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

  it("accepts value + currency and normalizes to amount", () => {
    const result = validateMoney({ value: 4200000, currency: "USD" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ amount: 4200000, currency: "USD" });
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
      values: [{ id: "clarity", rule: "When two designs are equally good, ship the one a newcomer understands fastest." }],
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
      audienceIds: ["ops-leads"],
      weAre: "the fastest way to turn a spreadsheet into a real tool",
      unlike: "general-purpose no-code builders",
      claimIds: ["prototype-same-meeting"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects retired forWhom with a finding that names audienceIds", () => {
    const result = validatePositioning({
      productName: "Widgetronic",
      category: "internal tooling platform",
      forWhom: "operations teams",
      audienceIds: ["ops-leads"],
      weAre: "the fastest way to turn a spreadsheet into a real tool",
      unlike: "general-purpose no-code builders",
      claimIds: ["prototype-same-meeting"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "forWhom" && issue.message.includes("audienceIds"))).toBe(true);
    }
  });
});

describe("validateMarket / validateAudience / validateRoadmapItem", () => {
  it("accept well-formed entries", () => {
    expect(
      validateMarket({ id: "smb-ops", name: "SMB operations", audienceIds: ["ops-lead"], factRefs: ["active-customers"] }).ok,
    ).toBe(true);
    expect(
      validateAudience({ id: "ops-lead", name: "Operations lead", situation: "Runs day-to-day operations.", pains: ["too many spreadsheets"] })
        .ok,
    ).toBe(true);
    expect(validateRoadmapItem({ id: "sso", title: "Single sign-on", status: "next" }).ok).toBe(true);
  });

  it("rejects a roadmap status outside the closed vocabulary", () => {
    expect(validateRoadmapItem({ id: "sso", title: "Single sign-on", status: "someday" }).ok).toBe(false);
  });
});

describe("validateBrand", () => {
  it("accepts a well-formed brand.json document", () => {
    expect(
      validateBrand({
        essence: { statement: "Precision engineering for teams who cannot afford to guess." },
        attributes: [
          {
            id: "precise",
            statement: "Every claim is checkable.",
            basis: "Enforced by the facts-traceability gate in CI on every pull request.",
          },
        ],
        derivations: [{ attributeId: "precise", tokenSlots: ["--color-accent-primary"], voiceRuleIds: [] }],
      }).ok,
    ).toBe(true);
  });
});

describe("validateDirectionEntity", () => {
  const base = {
    id: "vision-2026-h2",
    subject: { file: "mission.json", id: "mission" },
    decidedOn: "2026-01-05",
    derivesFrom: [] as string[],
  };

  it("accepts a well-formed root entity (empty derivesFrom, no supersedes)", () => {
    const result = validateDirectionEntity(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("vision-2026-h2");
      expect(result.value.supersedes).toBeUndefined();
    }
  });

  it("accepts an entity that supersedes a prior version and derives from others", () => {
    const result = validateDirectionEntity({
      ...base,
      id: "vision-2026-h2-v2",
      supersedes: "vision-2026-h2",
      derivesFrom: ["market-us-mid", "audience-eng-leads"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-kebab-case id", () => {
    expect(validateDirectionEntity({ ...base, id: "Vision 2026" }).ok).toBe(false);
  });

  it("rejects a decidedOn that is not an ISO date", () => {
    expect(validateDirectionEntity({ ...base, decidedOn: "Jan 5 2026" }).ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(validateDirectionEntity("vision").ok).toBe(false);
    expect(validateDirectionEntity(null).ok).toBe(false);
  });
});

describe("validateDirectionEntities", () => {
  const vision = {
    id: "vision-2026-h2",
    subject: { file: "mission.json", id: "mission" },
    decidedOn: "2026-01-05",
    derivesFrom: [],
  };
  const positioning = {
    id: "positioning-2026-h2",
    subject: { file: "positioning.json", id: "positioning" },
    decidedOn: "2026-01-12",
    derivesFrom: ["vision-2026-h2"],
  };

  it("accepts an array of well-formed entities forming a DAG", () => {
    expect(validateDirectionEntities([vision, positioning]).ok).toBe(true);
  });

  it("accepts an empty array — no direction authored yet is not itself a shape error", () => {
    expect(validateDirectionEntities([]).ok).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateDirectionEntities({}).ok).toBe(false);
  });

  it("rejects two entities sharing the same id", () => {
    const result = validateDirectionEntities([vision, { ...positioning, id: vision.id }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("duplicate direction entity id"))).toBe(true);
    }
  });
});
