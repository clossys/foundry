import { describe, expect, it } from "vitest";
import { compareBrandStylesheets } from "./compare-brand-stylesheets.js";

describe("compareBrandStylesheets", () => {
  it("reports divergence on brandable slots", () => {
    const findings = compareBrandStylesheets(
      { "--color-accent": "#111111" },
      { "--color-accent": "#222222" },
      "extra.css",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("brand-slot-divergence");
  });

  it("ignores matching values", () => {
    expect(
      compareBrandStylesheets({ "--color-accent": " red " }, { "--color-accent": "red" }, "extra.css"),
    ).toHaveLength(0);
  });
});
