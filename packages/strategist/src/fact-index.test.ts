import { describe, expect, it } from "vitest";
import { buildFactIndex, isTracedSurfaceForm } from "./fact-index.js";
import type { Finding } from "./format/types.js";

const numberFact: Finding = {
  id: "active-customers",

  value: 4200,
  unit: "customers",
  source: "billing-export-2026-06",
  observed: "2026-06-30",
  by: "researcher", bullets: [], path: "findings/fictional.md",
  aliases: ["4,200", "4.2K"],
};

const moneyFact: Finding = {
  id: "annual-revenue",

  value: 4200000, unit: "USD",
  source: "audited-statement-2026",
  observed: "2026-06-30",
  by: "researcher", bullets: [], path: "findings/fictional.md",
  aliases: ["$4.2M"],
};

describe("buildFactIndex", () => {
  it("indexes every fact by key", () => {
    const index = buildFactIndex([numberFact, moneyFact]);
    expect(index.byKey.get("active-customers")).toBe(numberFact);
    expect(index.byKey.get("annual-revenue")).toBe(moneyFact);
    expect(index.byKey.get("does-not-exist")).toBeUndefined();
  });

  it("indexes a bare-number fact's raw stringification and its declared aliases", () => {
    const index = buildFactIndex([numberFact]);
    expect(isTracedSurfaceForm(index, "4200")).toBe(true);
    expect(isTracedSurfaceForm(index, "4,200")).toBe(true);
    expect(isTracedSurfaceForm(index, "4.2K")).toBe(true);
    expect(isTracedSurfaceForm(index, "4.3K")).toBe(false); // a nearby but different number is NOT traced
  });

  it("indexes a finding with a currency unit's amount and 'amount currency' form, plus its declared aliases", () => {
    const index = buildFactIndex([moneyFact]);
    expect(isTracedSurfaceForm(index, "4200000")).toBe(true);
    expect(isTracedSurfaceForm(index, "4200000 USD")).toBe(true);
    expect(isTracedSurfaceForm(index, "$4.2M")).toBe(true);
  });

  it("does NOT invent a formatted variant nobody declared as an alias", () => {
    const index = buildFactIndex([moneyFact]);
    // "$4,200,000" is a plausible rendering of the same fact but was never
    // declared — buildFactIndex must not guess it into existence.
    expect(isTracedSurfaceForm(index, "$4,200,000")).toBe(false);
  });

  it("maps a surface form shared by two facts to both keys", () => {
    const a: Finding = { ...numberFact, id: "fact-a", aliases: ["100"] };
    const b: Finding = { ...numberFact, id: "fact-b", value: 1, aliases: ["100"] };
    const index = buildFactIndex([a, b]);
    expect(index.bySurfaceForm.get("100")).toEqual(["fact-a", "fact-b"]);
  });
});
