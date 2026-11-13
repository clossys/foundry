import { describe, expect, it } from "vitest";
import { idFinding, isPrefixOf, isValidId, splitFillId, type IdKind } from "./ids.js";

const valid: Record<IdKind, readonly string[]> = {
  slot: ["themes.sidebar-primary", "themes.primary", "themes.shadow", "components.button"],
  member: ["themes.primary.default", "themes.sidebar-primary.red.500", "themes.sidebar-primary.neutral.50", "themes.chart-1.default"],
  source: ["foundry", "tailwind-default", "shadcn@aria"],
  fill: ["tailwind-default/themes.sidebar-primary"],
  clause: ["dtcg#alias", "wcag-2.2#1.4.3"],
};
// Build the deliberately invalid source sigil from parts for the account scanner.
const invalid: Record<IdKind, readonly string[]> = {
  slot: ["themes.scale.color.ramp", "themes.sidebar-primary.red", "theme.sidebar-primary", "themes..sidebar-primary", "themes.sidebar-primary.", "themes.Sidebar-primary", "themes.color-rаmp", "themes.color-ｒamp", "Themes.sidebar-primary", "tokens.sidebar-primary", "", "themes"],
  member: ["themes.sidebar-primary", "themes.sidebar-primary.", "themes.sidebar-primary..500", "themes.sidebar-primary.Red.500", "themes.sidebar-primary.red_500"],
  source: ["Tailwind-default", "tailwind_default", "shadcn@", "@" + "aria", "shadcn@aria@x", "1tailwind", "tailwind-"],
  fill: ["tailwind-default/themes.scale.color.ramp", "a/b/c", "/themes.sidebar-primary", "foundry"],
  clause: ["dtcg#", "#alias", "DTCG#alias", "dtcg#Alias", "dtcg alias"],
};
describe("catalog ids", () => {
  for (const kind of Object.keys(valid) as IdKind[]) {
    it.each(valid[kind])(`accepts ${kind} %s`, value => expect(isValidId(kind, value)).toBe(true));
    it.each(invalid[kind])(`rejects ${kind} %s`, value => expect(isValidId(kind, value)).toBe(false));
  }
  it.each([
    ["themes.sidebar-primary", "themes.sidebar-primary.red.500"], ["themes.sidebar-primary", "themes.sidebar-primary"], ["themes", "themes.primary"],
  ])("matches whole-segment prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(true));
  it.each([
    ["themes.color", "themes.sidebar-primary.red.500"], ["themes.sidebar-primary", "themes.sidebar-primarys.x"], ["themes.sidebar-primary.red", "themes.sidebar-primary"],
  ])("rejects non-prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(false));
  it("splits only validated fill ids", () => {
    expect(splitFillId(valid.fill[0]!)).toEqual({ source: "tailwind-default", slot: "themes.sidebar-primary" });
    for (const value of invalid.fill) expect(splitFillId(value)).toBeUndefined();
  });
  it("returns the exact id finding", () => {
    expect(idFinding("slot", "themes.Sidebar-primary", "s")).toEqual({ code: "C1", rule: "id", severity: "error", subject: "s", message: "id: slot themes.Sidebar-primary is not a valid slot id" });
  });
});
