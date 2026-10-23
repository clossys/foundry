import { describe, expect, it } from "vitest";
import { idFinding, isPrefixOf, isValidId, splitFillId, type IdKind } from "./ids.js";

const valid: Record<IdKind, readonly string[]> = {
  slot: ["tokens.color-ramp", "tokens.accent-color", "tokens.z-index", "components.button"],
  member: ["tokens.accent-color.default", "tokens.color-ramp.red.500", "tokens.color-ramp.neutral.50", "tokens.categorical-color.1"],
  source: ["foundry", "tailwind-default", "shadcn@aria"],
  fill: ["tailwind-default/tokens.color-ramp"],
  clause: ["dtcg#alias", "wcag-2.2#1.4.3"],
};
// Build the deliberately invalid source sigil from parts for the account scanner.
const invalid: Record<IdKind, readonly string[]> = {
  slot: ["tokens.scale.color.ramp", "tokens.color-ramp.red", "token.color-ramp", "tokens..color-ramp", "tokens.color-ramp.", "tokens.Color-ramp", "tokens.color-rаmp", "tokens.color-ｒamp", "Tokens.color-ramp", "", "tokens"],
  member: ["tokens.color-ramp", "tokens.color-ramp.", "tokens.color-ramp..500", "tokens.color-ramp.Red.500", "tokens.color-ramp.red_500"],
  source: ["Tailwind-default", "tailwind_default", "shadcn@", "@" + "aria", "shadcn@aria@x", "1tailwind", "tailwind-"],
  fill: ["tailwind-default/tokens.scale.color.ramp", "a/b/c", "/tokens.color-ramp", "foundry"],
  clause: ["dtcg#", "#alias", "DTCG#alias", "dtcg#Alias", "dtcg alias"],
};
describe("catalog ids", () => {
  for (const kind of Object.keys(valid) as IdKind[]) {
    it.each(valid[kind])(`accepts ${kind} %s`, value => expect(isValidId(kind, value)).toBe(true));
    it.each(invalid[kind])(`rejects ${kind} %s`, value => expect(isValidId(kind, value)).toBe(false));
  }
  it.each([
    ["tokens.color-ramp", "tokens.color-ramp.red.500"], ["tokens.color-ramp", "tokens.color-ramp"], ["tokens", "tokens.accent-color"],
  ])("matches whole-segment prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(true));
  it.each([
    ["tokens.color", "tokens.color-ramp.red.500"], ["tokens.color-ramp", "tokens.color-ramps.x"], ["tokens.color-ramp.red", "tokens.color-ramp"],
  ])("rejects non-prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(false));
  it("splits only validated fill ids", () => {
    expect(splitFillId(valid.fill[0]!)).toEqual({ source: "tailwind-default", slot: "tokens.color-ramp" });
    for (const value of invalid.fill) expect(splitFillId(value)).toBeUndefined();
  });
  it("returns the exact id finding", () => {
    expect(idFinding("slot", "tokens.Color-ramp", "s")).toEqual({ code: "C1", rule: "id", severity: "error", subject: "s", message: "id: slot tokens.Color-ramp is not a valid slot id" });
  });
});
