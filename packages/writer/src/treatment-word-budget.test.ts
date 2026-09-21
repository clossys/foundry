import { describe, expect, it } from "vitest";
import { checkTreatmentWordBudgets, countCopyWords } from "./treatment-word-budget.js";
import type { CopyRegistry } from "./types.js";

function makeRegistry(entries: CopyRegistry["entries"]): CopyRegistry {
  return {
    id: "fixture",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixture" },
    entries,
  };
}

describe("countCopyWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countCopyWords("One two  three")).toBe(3);
  });
});

describe("checkTreatmentWordBudgets", () => {
  it("flags approved display-heading copy over the default budget", () => {
    const long = "word ".repeat(20).trim();
    const report = checkTreatmentWordBudgets(
      makeRegistry([
        {
          id: "hero.display-title",
          text: long,
          context: "Hero",
          status: "approved",
          treatment: "display-heading",
        },
      ]),
    );
    expect(report.findings.some((f) => f.rule === "word-budget-exceeded")).toBe(true);
  });

  it("respects per-entry maxWords override", () => {
    const report = checkTreatmentWordBudgets(
      makeRegistry([
        {
          id: "cta.primary",
          text: "Save progress now",
          context: "CTA",
          status: "approved",
          treatment: "button",
          maxWords: 2,
        },
      ]),
    );
    expect(report.findings.some((f) => f.rule === "word-budget-exceeded")).toBe(true);
  });

  it("skips draft entries", () => {
    const long = "word ".repeat(20).trim();
    const report = checkTreatmentWordBudgets(
      makeRegistry([
        {
          id: "hero.display-title",
          text: long,
          context: "Hero",
          status: "draft",
          treatment: "display-heading",
        },
      ]),
    );
    expect(report.findings).toEqual([]);
  });
});
