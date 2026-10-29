import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import componentsIA from "./ia/components.json" with { type: "json" };
import sectionsIA from "./ia/sections.json" with { type: "json" };
import * as catalog from "./index.js";
import { COMPONENT_ALIASES } from "./component-aliases.js";
import * as components from "../components/index.js";

import * as api from "../catalog-core/index.js";
describe("one IA display tree", () => {
  it("keeps the foundational components barrel free of catalog references", () => {
    const source = ts.createSourceFile("index.ts", readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const refs = source.statements.flatMap(node => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? [node.moduleSpecifier.text] : []);
    expect(refs.filter(specifier => specifier.includes("catalog"))).toEqual([]);
  });
  it("uses the authoritative IA nodes in the actual catalogs and public catalog navigation", () => {
    expect(catalog.COMPONENT_CATALOG.groups).toEqual(componentsIA.nodes);
    expect(catalog.BLOCK_CATALOG.groups).toEqual(sectionsIA.nodes);
    expect(api.COMPONENT_DISPLAY_TREE).toEqual(componentsIA.nodes);
    for (const name of ["COMPONENT_DISPLAY_GROUPS", "COMPONENT_DISPLAY_TREE", "componentSelection", "resolveComponentId"]) expect(components).not.toHaveProperty(name);
    expect(catalog).not.toHaveProperty("COMPONENT_GROUPS");
    expect(catalog).not.toHaveProperty("BLOCK_GROUPS");
  });
  it("resolves every act address to an existing canonical component, preserving each legacy entry", () => {
    const leaves = componentsIA.nodes.flatMap(group => group.children.flatMap(family => family.leaves));
    const actions = catalog.COMPONENT_ENTRIES.filter(entry => entry.id.startsWith("act."));
    expect(actions.length).toBeGreaterThan(0);
    expect(api.resolveComponentId).toBeTypeOf("function");
    for (const entry of actions) {
      const canonical = api.resolveComponentId?.(entry.id);
      expect(leaves, entry.id).toContain(canonical);
      expect(api.resolveComponentId?.(canonical!)).toBe(canonical);
      const group = componentsIA.nodes.find(group => group.children.some(family => family.leaves.includes(canonical!)));
      expect(entry.l1, entry.id).toBe(group?.id);
    }
    expect(api.resolveComponentId?.("unknown.component")).toBe("unknown.component");
  });
  it("never creates a canonical leaf for an unregistered legacy gap", () => {
    const leaves = componentsIA.nodes.flatMap(group => group.children.flatMap(family => family.leaves));
    for (const target of Object.values(COMPONENT_ALIASES)) expect(leaves).toContain(target);
    const legacy = catalog.COMPONENT_ENTRIES.find(entry => entry.id === "enter.textarea");
    expect(legacy).toMatchObject({ id: "enter.textarea", l1: null, l2: null });
    expect(api.componentSelection?.("enter.textarea")?.facts).toBe(components.COMPONENT_API_FACTS["enter.textarea"]);
    expect(api.componentSelection?.("constructor")).toBeUndefined();
  });
  it("lets a real public guidance consumer select canonical IDs or pinned aliases", () => {
    expect(api.componentSelection).toBeTypeOf("function");
    expect(api.componentSelection?.("components.button")?.guidance).toBe(components.COMPONENT_GUIDANCE["act.button"]);
    expect(api.componentSelection?.("act.button")).toEqual(api.componentSelection?.("components.button"));
    expect(api.componentSelection?.("act.icon-button")?.facts).toBe(components.COMPONENT_API_FACTS["act.icon-button"]);
    expect(api.componentSelection?.("unknown.component")).toBeUndefined();
  });
});
