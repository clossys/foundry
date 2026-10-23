import { describe, expect, it } from "vitest";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { TOKENS } from "../tokens/tokens.js";
import { isValidId } from "./ids.js";
import type { Slot } from "./types.js";

const slots = tokenSlots as unknown as readonly Slot[];
const tokens = Object.values(TOKENS);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Keep every owner so duplicate binding errors cannot disappear in a set.
function bindingFindings(input: readonly Slot[], properties: readonly string[]): string[] {
  const owners = new Map<string, string[]>();
  for (const slot of input) for (const [member, property] of Object.entries(slot.contract.emit ?? {})) {
    const ids = owners.get(property) ?? [];
    ids.push(slot.id + "." + member);
    owners.set(property, ids);
  }
  const findings: string[] = [];
  for (const [property, ids] of owners) {
    ids.sort(compare);
    for (let i = 1; i < ids.length; i++) findings.push(`binding: ${property} is bound to ${ids[0]} and ${ids[i]}`);
    if (!properties.includes(property)) findings.push(`binding: ${property} is not a shipped token`);
  }
  for (const property of properties) if (!owners.has(property)) findings.push(`binding: shipped token ${property} is not bound`);
  return findings.sort(compare);
}
const counts: Record<string, number> = {
  "tokens.scale.color.ramp": 11, "tokens.scale.color.alpha": 0, "tokens.scale.color.fixed": 17,
  "tokens.scale.type.family": 3, "tokens.scale.type.size": 0, "tokens.scale.type.leading": 2, "tokens.scale.type.weight": 0, "tokens.scale.type.tracking": 4,
  "tokens.scale.space.step": 10, "tokens.scale.space.container": 14, "tokens.scale.space.breakpoint": 6,
  "tokens.scale.shape.radius": 4, "tokens.scale.shape.border-width": 4, "tokens.scale.shape.ring-width": 2, "tokens.scale.shape.aspect": 0,
  "tokens.scale.depth.shadow": 0, "tokens.scale.depth.blur": 2, "tokens.scale.depth.layer-order": 11,
  "tokens.scale.motion.duration": 8, "tokens.scale.motion.easing": 4, "tokens.scale.motion.spring": 0, "tokens.scale.motion.delay": 3,
  "tokens.role.color.surface": 12, "tokens.role.color.text": 8, "tokens.role.color.border": 8, "tokens.role.color.action": 10, "tokens.role.color.status": 12, "tokens.role.color.focus": 4, "tokens.role.color.scrim": 1,
  "tokens.role.type.display": 7, "tokens.role.type.heading": 4, "tokens.role.type.body": 4, "tokens.role.type.label": 0, "tokens.role.type.code": 1, "tokens.role.type.caption": 1,
  "tokens.role.depth.elevation": 4, "tokens.role.space.rhythm": 0, "tokens.role.space.section": 0, "tokens.role.space.gutter": 1,
  "tokens.role.shape.control": 1, "tokens.role.shape.surface": 3, "tokens.role.shape.media": 6,
  "tokens.role.motion.transition": 4, "tokens.role.interaction.state": 4, "tokens.role.interaction.control-size": 11, "tokens.role.interaction.density": 5, "tokens.role.interaction.touch-target": 1,
};
const fixtureSlot = (id: string, emit: Record<string, `--${string}`>): Slot => ({ id, layer: "tokens", status: "draft", requires: [], contract: { kind: "token", $type: "number", members: { mode: "closed", names: Object.keys(emit) }, modes: ["light"], emit } });

describe("catalog token bindings", () => {
  it("binds the shipped token corpus without defects", () => expect(bindingFindings(slots, tokens.map(token => token.property))).toEqual([]));
  it("reports both owners of duplicate bindings in id order", () => {
    expect(bindingFindings([fixtureSlot("tokens.scale.type.weight", { a: "--x" }), fixtureSlot("tokens.scale.color.alpha", { a: "--x" })], ["--x"])).toEqual(["binding: --x is bound to tokens.scale.color.alpha.a and tokens.scale.type.weight.a"]);
  });
  it("reports an unshipped emit property", () => {
    expect(bindingFindings([fixtureSlot("tokens.scale.color.alpha", { a: "--x" }), fixtureSlot("tokens.scale.type.weight", {})], [])).toEqual(["binding: --x is not a shipped token"]);
  });
  it("reports a shipped property without a binding", () => {
    expect(bindingFindings([fixtureSlot("tokens.scale.color.alpha", {}), fixtureSlot("tokens.scale.type.weight", {})], ["--x"])).toEqual(["binding: shipped token --x is not bound"]);
  });
  it("pins 47 slots and every slot's bound count", () => {
    expect(slots).toHaveLength(47);
    expect(Object.fromEntries(slots.map(slot => [slot.id, Object.keys(slot.contract.emit ?? {}).length]))).toEqual(counts);
    expect(slots.map(slot => slot.id)).toEqual(Object.keys(counts).sort(compare));
  });
  it("pins 217 bindings, 59 brandable bindings, 39 fill slots and nine dark slots", () => {
    const properties = slots.flatMap(slot => Object.values(slot.contract.emit ?? {}));
    expect(properties).toHaveLength(217);
    expect(tokens.filter(token => token.brandable && properties.includes(token.property as `--${string}`))).toHaveLength(59);
    expect(slots.filter(slot => Object.keys(slot.contract.emit ?? {}).length > 0 || slot.id === "tokens.scale.motion.spring")).toHaveLength(39);
    expect(slots.filter(slot => slot.contract.modes.includes("dark")).map(slot => slot.id)).toEqual([
      "tokens.role.color.action", "tokens.role.color.border", "tokens.role.color.focus", "tokens.role.color.scrim", "tokens.role.color.status", "tokens.role.color.surface", "tokens.role.color.text", "tokens.role.depth.elevation", "tokens.scale.color.fixed",
    ]);
  });
  it("uses valid members, closed names, modes and clause defaults", () => {
    for (const slot of slots) {
      expect(isValidId("slot", slot.id)).toBe(true);
      expect(slot.layer).toBe("tokens");
      expect(slot.status).toBe("draft");
      expect(slot.signoff).toBeUndefined();
      expect(slot.contract.kind).toBe("token");
      const entries = Object.entries(slot.contract.emit ?? {});
      for (const [member, property] of entries) {
        expect(property).toMatch(/^--[a-z0-9-]+$/);
        expect(isValidId("member", slot.id + "." + member)).toBe(true);
      }
      if (slot.contract.members.mode === "closed") expect(slot.contract.members.names).toEqual(entries.map(([member]) => member));
      const colorRole = slot.id.startsWith("tokens.role.color.");
      expect(slot.requires).toEqual(colorRole ? ["dtcg#format", "dtcg#alias", "wcag-2.2#1.4.3"] : ["dtcg#format", "dtcg#alias"]);
      const themeDependent = entries.some(([, property]) => TOKENS[property]?.themeDependent);
      expect(slot.contract.modes).toEqual(colorRole || themeDependent ? ["light", "dark"] : ["light"]);
    }
  });
});
