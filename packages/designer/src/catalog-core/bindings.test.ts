import { describe, expect, it } from "vitest";
import themePlacement from "../catalog/ia/themes.json" with { type: "json" };
import retired from "../catalog/retired.json" with { type: "json" };
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { THEME_OUTPUTS } from "./emit.js";
import { isValidId } from "./ids.js";
import type { Placement, PlacementNode, Slot } from "./types.js";

const slots = themeSlots as unknown as readonly Slot[];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const SHADOWS = ["2xl", "2xs", "lg", "md", "sm", "xl", "xs"];

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
    if (!properties.includes(property)) findings.push(`binding: ${property} is not a shipped theme variable`);
  }
  for (const property of properties) if (!owners.has(property)) findings.push(`binding: shipped theme variable ${property} is not bound`);
  return findings.sort(compare);
}
const fixtureSlot = (id: string, emit: Record<string, `--${string}`>): Slot => ({ id, layer: "themes", status: "draft", requires: [], contract: { kind: "token", tier: "scale", $type: "number", members: { mode: "closed", names: Object.keys(emit) }, modes: ["light"], emit } });
const domains: Record<string, readonly string[]> = {
  colors: [
    "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
    "secondary", "secondary-foreground", "accent", "accent-foreground", "destructive", "muted", "muted-foreground", "border",
    "input", "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "sidebar", "sidebar-foreground", "sidebar-primary",
    "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
  ],
  shape: ["radius"],
  typography: ["font-sans", "font-heading", "font-mono", "font-serif", "tracking-tight"],
  space: ["spacing"],
  depth: ["shadow"],
  motion: ["animate-marquee", "animate-marquee-vertical", "animate-shiny-text"],
};
const colorIds = new Set(domains.colors!.map(id => "themes." + id));

describe("catalog theme bindings", () => {
  it("binds every shipped theme variable exactly once", () => expect(bindingFindings(slots, THEME_OUTPUTS.map(output => output.property))).toEqual([]));
  it("reports both owners of duplicate bindings in id order", () => {
    expect(bindingFindings([fixtureSlot("themes.shadow", { a: "--x" }), fixtureSlot("themes.spacing", { a: "--x" })], ["--x"])).toEqual(["binding: --x is bound to themes.shadow.a and themes.spacing.a"]);
  });
  it("reports an unshipped emit property", () => {
    expect(bindingFindings([fixtureSlot("themes.spacing", { a: "--x" }), fixtureSlot("themes.shadow", {})], [])).toEqual(["binding: --x is not a shipped theme variable"]);
  });
  it("reports a shipped property without a binding", () => {
    expect(bindingFindings([fixtureSlot("themes.spacing", {}), fixtureSlot("themes.shadow", {})], ["--x"])).toEqual(["binding: shipped theme variable --x is not bound"]);
  });
  it("pins 42 slots, one default binding each and the seven shadow steps", () => {
    expect(slots).toHaveLength(42);
    for (const slot of slots) {
      const emit = slot.contract.emit ?? {};
      if (slot.id === "themes.shadow") expect(Object.entries(emit).toSorted(([a], [b]) => compare(a, b))).toEqual(SHADOWS.map(step => [step, `--shadow-${step}`]));
      else expect(emit).toEqual({ default: "--" + slot.id.slice("themes.".length) });
    }
    expect(slots.flatMap(slot => Object.values(slot.contract.emit ?? {}))).toHaveLength(48);
  });
  it("uses valid members, closed names, modes and clause defaults", () => {
    for (const slot of slots) {
      expect(isValidId("slot", slot.id)).toBe(true);
      expect(slot.layer).toBe("themes");
      expect(slot.status).toBe("draft");
      expect(slot.signoff).toBeUndefined();
      expect(slot.contract.kind).toBe("token");
      const entries = Object.entries(slot.contract.emit ?? {});
      for (const [member, property] of entries) {
        expect(property).toMatch(/^--[a-z0-9-]+$/);
        expect(isValidId("member", slot.id + "." + member)).toBe(true);
      }
      expect(slot.contract.members.mode).toBe("closed");
      if (slot.contract.members.mode === "closed") expect(slot.contract.members.names.toSorted(compare)).toEqual(entries.map(([member]) => member).toSorted(compare));
      const color = colorIds.has(slot.id);
      expect(slot.contract.$type === "color").toBe(color);
      expect(slot.requires).toEqual(color ? ["dtcg#format", "dtcg#alias", "wcag-2.2#1.4.3"] : ["dtcg#format", "dtcg#alias"]);
      expect(slot.contract.modes).toEqual(color ? ["light", "dark"] : ["light"]);
    }
  });
  it("places all 42 slots exactly once under six ordered domains without facet branches", () => {
    const tree = themePlacement as unknown as Placement;
    expect(tree.layer).toBe("themes");
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
      expect(domainLeaves).toEqual(domains[node.id]!.map(id => "themes." + id));
    }
    expect(placed).toHaveLength(42);
    expect(new Set(placed).size).toBe(42);
    expect(placed.toSorted(compare)).toEqual(slots.map(slot => slot.id));
    expect(retired).toEqual([]);
  });
  it("keeps colors as role-tier slots and every other theme as scale-tier metadata", () => {
    for (const slot of slots) expect(slot.contract.tier).toBe(colorIds.has(slot.id) ? "role" : "scale");
    expect(slots.filter(slot => slot.contract.tier === "role")).toHaveLength(31);
    expect(slots.filter(slot => slot.contract.tier === "scale")).toHaveLength(11);
  });
});
