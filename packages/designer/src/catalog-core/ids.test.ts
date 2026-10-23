import { describe, expect, it } from "vitest";
import { idFinding, isPrefixOf, isValidId, splitFillId, type IdKind } from "./ids.js";

const valid: Record<IdKind, readonly string[]> = {
  slot: ["tokens.scale.color.ramp", "tokens.role.color.action", "components.button.shape.corner"],
  member: ["tokens.role.color.action.default", "tokens.scale.color.ramp.red.500", "tokens.scale.color.ramp.neutral.50"],
  source: ["foundry", "tailwind-default", "shadcn@aria"],
  subtree: ["tokens", "tokens.scale", "tokens.scale.color"],
  fill: ["tailwind-default/tokens.scale.color.ramp"],
  clause: ["dtcg#alias", "wcag-2.2#1.4.3"],
};
// Build the deliberately invalid source sigil from parts for the account scanner.
const invalid: Record<IdKind, readonly string[]> = {
  slot: ["tokens.scale.color", "tokens.scale.color.ramp.red", "token.scale.color.ramp", "tokens..color.ramp", "tokens.scale.color.ramp.", "tokens.scale.color.Ramp", "tokens.scale.color.rаmp", "tokens.scale.color.ｒamp", "Tokens.scale.color.ramp", ""],
  member: ["tokens.scale.color.ramp", "tokens.scale.color.ramp.", "tokens.scale.color.ramp..500", "tokens.scale.color.ramp.Red.500", "tokens.scale.color.ramp.red_500"],
  source: ["Tailwind-default", "tailwind_default", "shadcn@", "@" + "aria", "shadcn@aria@x", "1tailwind", "tailwind-"],
  subtree: ["tokens.scale.color.ramp", "Tokens", "tokens."],
  fill: ["tailwind-default/tokens.scale.color", "a/b/c", "/tokens.scale.color.ramp", "foundry"],
  clause: ["dtcg#", "#alias", "DTCG#alias", "dtcg#Alias", "dtcg alias"],
};
describe("catalog ids", () => {
  for (const kind of Object.keys(valid) as IdKind[]) {
    it.each(valid[kind])(`accepts ${kind} %s`, value => expect(isValidId(kind, value)).toBe(true));
    it.each(invalid[kind])(`rejects ${kind} %s`, value => expect(isValidId(kind, value)).toBe(false));
  }
  it.each([
    ["tokens.scale.type", "tokens.scale.type.family"], ["tokens.scale", "tokens.scale"], ["tokens", "tokens.role.color.action"],
  ])("matches whole-segment prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(true));
  it.each([
    ["tokens.scale.ty", "tokens.scale.type.family"], ["tokens.scale.type", "tokens.scale.typeface.x"], ["tokens.scale.type.family", "tokens.scale.type"],
  ])("rejects non-prefix %s of %s", (prefix, id) => expect(isPrefixOf(prefix!, id!)).toBe(false));
  it("splits only validated fill ids", () => {
    expect(splitFillId(valid.fill[0]!)).toEqual({ source: "tailwind-default", slot: "tokens.scale.color.ramp" });
    for (const value of invalid.fill) expect(splitFillId(value)).toBeUndefined();
  });
  it("returns the exact id finding", () => {
    expect(idFinding("slot", "tokens.scale.color.Ramp", "s")).toEqual({ code: "C1", rule: "id", severity: "error", subject: "s", message: "id: slot tokens.scale.color.Ramp is not a valid slot id" });
  });
});
