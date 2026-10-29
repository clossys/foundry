import { describe, expect, it } from "vitest";
import { ChevronRight } from "../icons/ChevronRight.js";
import { CATALOGS } from "./index.js";
import componentIA from "./ia/components.json" with { type: "json" };
import sectionIA from "./ia/sections.json" with { type: "json" };
import { resolveComponentId } from "./component-aliases.js";
import sectionHomes from "./maps/blocks-to-sections.json" with { type: "json" };

/** Expected [L1, L2] group counts per catalog. */
const GROUP_COUNTS: Record<(typeof CATALOGS)[number]["kind"], readonly [number, number]> = {
  tokens: [6, 31],
  assets: [3, 7],
  icons: [2, 11],
  components: [componentIA.nodes.length, componentIA.nodes.flatMap(group => group.children).length],
  blocks: [sectionIA.nodes.length, sectionIA.nodes.flatMap(group => group.children).length],
};

/** Every display string in a value: labels and notes, walked recursively. */
function displayStrings(value: unknown, key = ""): string[] {
  if (typeof value === "string") return key === "label" || key === "notes" ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => displayStrings(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => displayStrings(v, k));
  }
  return [];
}

describe.each(CATALOGS.map((catalog) => [catalog.kind, catalog] as const))("%s catalog", (kind, catalog) => {
  it("has the expected L1 and L2 group counts", () => {
    const [l1, l2] = GROUP_COUNTS[kind];
    expect(catalog.groups).toHaveLength(l1);
    expect(catalog.groups.flatMap((group) => group.children)).toHaveLength(l2);
  });

  it("has unique L1 ids, and unique L2 ids within each L1", () => {
    const l1Ids = catalog.groups.map((group) => group.id);
    expect(new Set(l1Ids).size).toBe(l1Ids.length);
    for (const group of catalog.groups) {
      const l2Ids = group.children.map((child) => child.id);
      expect(new Set(l2Ids).size, group.id).toBe(l2Ids.length);
    }
  });

  it("has at least one entry, each with a non-empty unique id", () => {
    const ids = catalog.entries.map((entry) => entry.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.trim(), id).not.toBe("");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives registered homes from IA and keeps unregistered legacy metadata outside display", () => {
    for (const entry of catalog.entries) {
      if (kind === "components" || kind === "blocks") {
        const tree = kind === "components" ? componentIA.nodes : sectionIA.nodes;
        const homes: Readonly<Record<string, string>> = sectionHomes;
        const id = kind === "components" ? resolveComponentId(entry.id) : homes[entry.id] ?? entry.id;
        const group = tree.find(group => group.children.some(family => family.leaves.includes(id)));
        const family = group?.children.find(family => family.leaves.includes(id));
        expect(entry.l1, entry.id).toBe(group?.id ?? null);
        expect(entry.l2, entry.id).toBe(family?.id ?? null);
      } else {
        const group = catalog.groups.find(candidate => candidate.id === entry.l1);
        expect(group, `${entry.id} l1`).toBeDefined();
        expect(group?.children.some(child => child.id === entry.l2), `${entry.id} l2`).toBe(true);
      }
    }
  });

  it("uses no ampersand in any id, label or note", () => {
    const strings = [
      ...catalog.groups.flatMap((group) => [group.id, ...group.children.map((child) => child.id)]),
      ...catalog.entries.map((entry) => entry.id),
      ...displayStrings(catalog),
    ];
    expect(strings.length).toBeGreaterThan(catalog.entries.length);
    expect(strings.filter((text) => text.includes("&"))).toEqual([]);
  });
});

describe("catalog entry rules", () => {
  it("covers all five catalogs once", () => {
    expect(CATALOGS.map((catalog) => catalog.kind)).toEqual(["tokens", "assets", "icons", "components", "blocks"]);
  });

  it("gives every brand-optional token a fallback", () => {
    const tokens = CATALOGS[0].entries;
    for (const token of tokens) {
      if (token.tier === "brand-optional") expect(token.fallback, token.id).toBeDefined();
      else expect(token.fallback, token.id).toBeUndefined();
    }
  });

  it("vendors the exported glyph data itself, not a copy", () => {
    const chevron = CATALOGS[2].entries.find((entry) => entry.id === "ChevronRight");
    expect(chevron?.nodes).toBe(ChevronRight);
  });

  it("keeps parked components and parked status in step", () => {
    for (const component of CATALOGS[3].entries) {
      expect(component.status === "parked", component.id).toBe(component.lifecycle === "parked");
      expect(component.status === "in-flight", component.id).toBe(component.inFlight !== undefined);
    }
  });

  it("names a successor for every deprecated block, and an export for every built block that is not a recipe", () => {
    for (const block of CATALOGS[4].entries) {
      expect(block.lifecycle === "deprecated", block.id).toBe(block.successor !== undefined);
      expect(block.export === null, block.id).toBe(block.built === "no" || block.recipeOf !== undefined);
      if (block.recipeOf !== undefined) expect(block.built, block.id).not.toBe("no");
    }
  });

  it("detects an ampersand when one is present", () => {
    expect(displayStrings({ label: "A and B", notes: ["x & y"] })).toContain("x & y");
  });
});
