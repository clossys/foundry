import { describe, expect, it, vi } from "vitest";

vi.mock("../../tokens/tokens.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tokens/tokens.js")>();
  return {
    ...actual,
    TOKENS: {
      ...actual.TOKENS,
      "--color-chart-categorical-1": { ...actual.TOKENS["--color-chart-categorical-1"], value: "#123456" },
      "--color-chart-sequential-100": { ...actual.TOKENS["--color-chart-sequential-100"], value: "#654321" },
    },
  };
});

import { assignCategoricalColor, chartSequentialVar } from "./chart-vars.js";

describe("chart fallback defaults", () => {
  it("uses the token registry's defaults rather than an independently copied palette", () => {
    expect(assignCategoricalColor(0)).toBe("var(--color-chart-categorical-1, #123456)");
    expect(chartSequentialVar(100)).toBe("var(--color-chart-sequential-100, #654321)");
  });
});
