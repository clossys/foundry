import { describe, expect, it } from "vitest";
import { checkHeroCss, utilityRulePresent } from "./check-hero-css.js";

describe("checkHeroCss", () => {
  it("returns findings when required utilities are absent", () => {
    const result = checkHeroCss("/* empty */\n");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.rule === "missing-utility")).toBe(true);
  });

  it("passes when every required utility has a rule", () => {
    const css = `
.text-display-l { font-size: 1rem; }
.font-display { font-family: sans-serif; }
.bg-accent { background-color: red; }
.rounded-control { border-radius: 4px; }
.tablet\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
`;
    expect(checkHeroCss(css).findings).toEqual([]);
  });

});
