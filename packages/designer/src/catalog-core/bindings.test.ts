import { describe, expect, it } from "vitest";
import tokenPlacement from "../catalog/ia/tokens.json" with { type: "json" };
import retired from "../catalog/retired.json" with { type: "json" };
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { TOKENS } from "../tokens/tokens.js";
import { isValidId } from "./ids.js";
import type { Placement, PlacementNode, Slot } from "./types.js";

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
  "tokens.accent-color": 5, "tokens.action-color": 5, "tokens.animation": 0, "tokens.behavior-timing": 6, "tokens.blur": 2, "tokens.body-size": 4, "tokens.border-color": 6, "tokens.border-width": 3,
  "tokens.brandmark-size": 6, "tokens.breakpoint": 6, "tokens.caption-size": 1, "tokens.categorical-color": 8, "tokens.chart-color": 4, "tokens.code-size": 1,
  "tokens.color-ramp": 11, "tokens.container-width": 0, "tokens.content-size": 13, "tokens.control-color": 5, "tokens.control-radius": 1, "tokens.control-size": 8, "tokens.density": 5,
  "tokens.display-face": 4, "tokens.display-size": 3, "tokens.diverging-color": 3, "tokens.duration": 5, "tokens.easing": 4, "tokens.elevation": 4,
  "tokens.focus-color": 2, "tokens.focus-outline": 2, "tokens.focus-shadow": 2, "tokens.font-size": 0, "tokens.font-weight": 0, "tokens.gutter": 1,
  "tokens.heading-size": 4, "tokens.icon-size": 3, "tokens.icon-stroke": 1, "tokens.letter-spacing": 4, "tokens.line-height": 2, "tokens.radius": 4,
  "tokens.region-width": 4, "tokens.scrim-color": 1, "tokens.sequential-color": 7, "tokens.shadow": 0, "tokens.shift-distance": 1, "tokens.spacing": 10,
  "tokens.state-opacity": 4, "tokens.status-color": 12, "tokens.surface-color": 11, "tokens.surface-radius": 3, "tokens.text-color": 8, "tokens.touch-target": 1,
  "tokens.transition-duration": 1, "tokens.transition-easing": 2, "tokens.typeface": 3, "tokens.z-index": 11,
};
const fixtureSlot = (id: string, emit: Record<string, `--${string}`>): Slot => ({ id, layer: "tokens", status: "draft", requires: [], contract: { kind: "token", tier: "scale", $type: "number", members: { mode: "closed", names: Object.keys(emit) }, modes: ["light"], emit } });

describe("catalog token bindings", () => {
  it("binds the shipped token corpus without defects", () => expect(bindingFindings(slots, tokens.map(token => token.property))).toEqual([]));
  it("reports both owners of duplicate bindings in id order", () => {
    expect(bindingFindings([fixtureSlot("tokens.shadow", { a: "--x" }), fixtureSlot("tokens.font-weight", { a: "--x" })], ["--x"])).toEqual(["binding: --x is bound to tokens.font-weight.a and tokens.shadow.a"]);
  });
  it("reports an unshipped emit property", () => {
    expect(bindingFindings([fixtureSlot("tokens.font-weight", { a: "--x" }), fixtureSlot("tokens.shadow", {})], [])).toEqual(["binding: --x is not a shipped token"]);
  });
  it("reports a shipped property without a binding", () => {
    expect(bindingFindings([fixtureSlot("tokens.font-weight", {}), fixtureSlot("tokens.shadow", {})], ["--x"])).toEqual(["binding: shipped token --x is not bound"]);
  });
  it("pins 55 slots and every slot's bound count", () => {
    expect(slots).toHaveLength(55);
    expect(Object.fromEntries(slots.map(slot => [slot.id, Object.keys(slot.contract.emit ?? {}).length]))).toEqual(counts);
    expect(slots.map(slot => slot.id)).toEqual(Object.keys(counts).sort(compare));
  });
  it("pins 227 bindings, 65 brandable bindings, 50 historically bound slots and fourteen dark slots", () => {
    const properties = slots.flatMap(slot => Object.values(slot.contract.emit ?? {}));
    expect(properties).toHaveLength(227);
    expect(tokens.filter(token => token.brandable && properties.includes(token.property as `--${string}`))).toHaveLength(65);
    expect(slots.filter(slot => Object.keys(slot.contract.emit ?? {}).length > 0)).toHaveLength(50);
    expect(slots.filter(slot => slot.contract.modes.includes("dark")).map(slot => slot.id)).toEqual([
      "tokens.accent-color", "tokens.action-color", "tokens.border-color", "tokens.categorical-color", "tokens.chart-color", "tokens.control-color", "tokens.diverging-color", "tokens.elevation", "tokens.focus-color", "tokens.scrim-color", "tokens.sequential-color", "tokens.status-color", "tokens.surface-color", "tokens.text-color",
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
      const colorRole = slot.contract.tier === "role" && slot.contract.$type === "color";
      expect(slot.requires).toEqual(colorRole ? ["dtcg#format", "dtcg#alias", "wcag-2.2#1.4.3"] : ["dtcg#format", "dtcg#alias"]);
      const themeDependent = entries.some(([, property]) => TOKENS[property]?.themeDependent);
      expect(slot.contract.modes).toEqual(colorRole || themeDependent ? ["light", "dark"] : ["light"]);
    }
  });
  it("places all 55 slots exactly once under seven ordered domains without facet branches", () => {
    const tree = tokenPlacement as unknown as Placement;
    const domains: Record<string, readonly string[]> = {
      color: ["color-ramp", "surface-color", "text-color", "border-color", "accent-color", "action-color", "control-color", "status-color", "focus-color", "scrim-color", "chart-color", "categorical-color", "sequential-color", "diverging-color"],
      type: ["font-size", "font-weight", "line-height", "letter-spacing", "typeface", "display-size", "display-face", "heading-size", "body-size", "caption-size", "code-size"],
      space: ["spacing", "breakpoint", "content-size", "region-width", "gutter", "container-width", "density"],
      shape: ["radius", "border-width", "control-radius", "surface-radius", "icon-size", "icon-stroke", "brandmark-size"],
      depth: ["shadow", "blur", "z-index", "elevation", "focus-shadow"],
      motion: ["duration", "easing", "behavior-timing", "transition-duration", "animation", "transition-easing", "shift-distance"],
      interaction: ["state-opacity", "touch-target", "control-size", "focus-outline"],
    };
    expect(tree.layer).toBe("tokens");
    expect(tree.nodes.map(node => node.id)).toEqual(Object.keys(domains));
    const placed: string[] = [];
    const walk = (nodes: readonly PlacementNode[]): void => {
      for (const node of nodes) {
        expect(node.id).not.toMatch(/(?:^|-)(?:scale|role|tier|library|lifecycle)(?:-|$)/i);
        expect(node.label).not.toMatch(/^(?:scale|role|tier|library|lifecycle)$/i);
        if ("leaves" in node) placed.push(...node.leaves);
        else walk(node.children);
      }
    };
    walk(tree.nodes);
    for (const node of tree.nodes) {
      const domainLeaves = "children" in node ? node.children.flatMap(family => "leaves" in family ? family.leaves : []) : [];
      expect(domainLeaves.toSorted(compare)).toEqual(domains[node.id]!.map(id => "tokens." + id).toSorted(compare));
    }
    expect(placed).toHaveLength(55);
    expect(new Set(placed).size).toBe(55);
    expect(placed.toSorted(compare)).toEqual(slots.map(slot => slot.id));
    expect(retired).toEqual([]);
  });
  it("retains scale and role as slot metadata independent of placement", () => {
    const scale = new Set([
      "color-ramp", "font-size", "font-weight", "line-height", "letter-spacing", "spacing", "breakpoint",
      "radius", "border-width", "shadow", "blur", "z-index", "duration", "easing", "container-width", "animation",
    ].map(id => "tokens." + id));
    for (const slot of slots) expect(slot.contract.tier).toBe(scale.has(slot.id) ? "scale" : "role");
    expect(slots.filter(slot => slot.contract.tier === "scale")).toHaveLength(16);
    expect(slots.filter(slot => slot.contract.tier === "role")).toHaveLength(39);
  });
});
