import { describe, expect, it } from "vitest";
import { BUDGET_PREFERENCE_CARD, applyBudgetPreferenceChoice, toPreferencesFile } from "./index.js";

describe("budget preference card (issue #1219, Advisor side)", () => {
  it("names no model anywhere in its prompt or choice labels", () => {
    const text = [BUDGET_PREFERENCE_CARD.prompt, ...BUDGET_PREFERENCE_CARD.choices.map((choice) => choice.label)].join(" ").toLowerCase();
    for (const forbidden of ["claude", "gpt", "gemini", "opus", "sonnet", "haiku"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("offers exactly the fixed tier names from #1219, plus an explicit unknown", () => {
    const ids = BUDGET_PREFERENCE_CARD.choices.map((choice) => choice.id);
    expect(ids).toEqual(["cost-conscious", "balanced", "max-quality", "unknown"]);
  });

  it("a known choice resolves to its own id", () => {
    expect(applyBudgetPreferenceChoice("balanced")).toEqual({ kind: "known", value: "balanced" });
  });

  it("unknown never invents a preference", () => {
    expect(applyBudgetPreferenceChoice("unknown")).toEqual({ kind: "unknown" });
  });

  it("an unrecognised choice id is reported, not silently accepted", () => {
    expect(applyBudgetPreferenceChoice("premium")).toEqual({ kind: "unknown-choice" });
  });

  it("toPreferencesFile writes the exact clossys/preferences.json shape", () => {
    expect(toPreferencesFile("cost-conscious")).toEqual({ schemaVersion: 1, budget: "cost-conscious" });
  });
});
