// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import slots from "../catalog/slots/components.json" with { type: "json" };
import { generatedShadcnComponentFiles, importShadcnAriaComponents, materializeShadcnComponent, SHADCN_COMPONENT_ITEMS } from "./shadcn-aria-components.js";

const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(here, name), "utf8");
const input = () => ({ items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });
const supported: Record<string, string[]> = {
  dialog: ["dismissable", "role.modal"], popover: ["placement"], tooltip: ["placement"],
  menu: ["part.items", "part.sections", "part.submenu", "selection.multiple", "selection.none", "selection.single"],
  avatar: ["content.image", "content.initials", "size.lg", "size.md", "size.sm"], breadcrumbs: ["collapsed", "current"],
  tabs: ["orientation.horizontal", "orientation.vertical"], disclosure: ["scope.group"],
  separator: ["orientation.horizontal", "orientation.vertical"], keyboard: ["scope.chord", "scope.single"], card: [],
};
const itemFor = (leaf: string) => ({ menu: "dropdown-menu", breadcrumbs: "breadcrumb", disclosure: "accordion", keyboard: "kbd" } as Record<string, string>)[leaf] ?? leaf;
const counts: Record<string, number> = { dialog: 5, popover: 6, tooltip: 6, menu: 11, avatar: 7, breadcrumbs: 4, tabs: 16, disclosure: 4, separator: 4, keyboard: 3, card: 6 };

// Compiles the generated module verbatim. Only external primitives are supplied;
// this observes public prop forwarding, not browser timing or APG conformance.
function moduleExports(code: string, rac: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
  const exports = {};
  const nativeRequire = createRequire(import.meta.url);
  const require = (name: string) => name === "react-aria-components" ? rac : name.endsWith("/_parts/utils/index") ? { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") } : nativeRequire(name);
  new Function("require", "exports", compiled.outputText)(require, exports);
  return exports;
}

describe("overlay and display pinned source evidence", () => {
  for (const [leaf, members] of Object.entries(supported)) it(`partitions ${leaf} into evidenced closed members and explicit gaps`, () => {
    const result = importShadcnAriaComponents(input());
    const doc = result.fills.find(doc => doc.components[leaf])!, fill = doc.components[leaf]!;
    const contract = slots.find(slot => slot.id === fill.slot)!.contract;
    expect(fill.members).toEqual(members);
    expect(Object.keys(fill.propMap)).toEqual(members);
    expect(Object.values(fill.propMap).every(pointer => typeof pointer === "string" && pointer.length > 0)).toBe(true);
    expect(doc.$extensions["com.clossys.fill"].unmapped).toEqual(contract.members.names!.filter(member => !members.includes(member)));
    expect([...fill.members, ...doc.$extensions["com.clossys.fill"].unmapped!].sort()).toEqual([...contract.members.names!].sort());
    expect(doc.$extensions["com.clossys.fill"]).toMatchObject({ status: "draft", evidence: [], conforms: [] });
    expect(fill).not.toHaveProperty("measurements");
    expect(SHADCN_COMPONENT_ITEMS[itemFor(leaf)]).toBe(leaf);
  });
  it("retains exact unresolved K codes and both unapproved ellipsis findings", () => {
    const result = importShadcnAriaComponents(input());
    for (const [leaf, count] of Object.entries(counts)) {
      const item = itemFor(leaf), rewrite = result.rewrites[item]!;
      expect(rewrite.issues, leaf).toHaveLength(count);
      expect([...new Set(rewrite.issues.map(issue => issue.code))].sort(), leaf).toEqual(leaf === "breadcrumbs" ? ["K4", "K7"] : ["K4"]);
      expect(() => materializeShadcnComponent(result, item), leaf).toThrow(/unresolved/);
    }
    expect(result.rewrites.breadcrumb!.issues.filter(issue => issue.code === "K7").map(issue => issue.value).sort()).toEqual(["MoreHorizontalIcon", "glyph"]);
    // Existing resolved alternate is a positive materialization control only.
    expect(materializeShadcnComponent(result, "collapsible").length).toBeGreaterThan(0);
  });
  it("passes consumer-bound tooltip timing through the actual rewritten trigger without invented defaults", () => {
    const result = importShadcnAriaComponents(input());
    const source = result.rewrites.tooltip!.files.find(file => file.path === "components/tooltip/tooltip.tsx")!.content;
    const Trigger = () => null, Focusable = () => null;
    const exports = moduleExports(source, { TooltipTrigger: Trigger, Tooltip: () => null, OverlayArrow: () => null, Focusable });
    // The caller binds exact consumer values; one member in seconds proves the unit conversion.
    const delay = 500, closeDelay = 300;
    const behaviorTiming = {
      "tooltip-delay": { value: 500, unit: "ms" as const },
      "tooltip-close": { value: 0.3, unit: "s" as const },
    };
    const children = [React.createElement("button", { key: "trigger" }, "Help"), React.createElement("span", { key: "tip" }, "Details")];
    const explicit = exports.TooltipTrigger!({ children, behaviorTiming, delay, closeDelay, isDisabled: true, "aria-label": "Help" });
    expect(explicit.type).toBe(Trigger);
    expect(explicit.props).toMatchObject({ delay, closeDelay, isDisabled: true, "aria-label": "Help" });
    expect(explicit.props.children[0].type).toBe(Focusable);
    expect(explicit.props.children[1].type).toBe("span");
    const bound = exports.TooltipTrigger!({ children, behaviorTiming });
    expect(bound.props).toMatchObject({ delay, closeDelay });
    expect(() => exports.TooltipTrigger!({ children })).toThrow(/tooltip timing binding/);
    // Timing is a caller binding, not a themes leaf: neither the contract nor the rewrite reads one.
    expect(slots.find(slot => slot.id === "components.tooltip")!.contract.allowedReads.themes.some(read => /behavior-timing|duration|easing/.test(read))).toBe(false);
    expect(result.rewrites.tooltip!.reads.themes.some(read => /behavior-timing|duration|easing/.test(read))).toBe(false);
  });
  it("keeps the popover trigger/context protocol and placement forwarding intact", () => {
    const result = importShadcnAriaComponents(input());
    const source = result.rewrites.popover!.files.find(file => file.path === "components/popover/popover.tsx")!.content;
    const Trigger = () => null, Popover = () => null;
    const exports = moduleExports(source, { DialogTrigger: Trigger, Popover, Heading: () => null });
    const children = [React.createElement("button", { key: "trigger" }, "Open"), React.createElement("div", { key: "content" }, "Content")];
    const trigger = exports.PopoverTrigger!({ children, isOpen: true, onOpenChange: () => {} });
    expect(trigger.type).toBe(Trigger);
    expect(trigger.props.children).toBe(children);
    expect(trigger.props.isOpen).toBe(true);
    const popover = exports.Popover!({ placement: "end top", offset: 8, crossOffset: 2, children: "Content" });
    expect(popover.type).toBe(Popover);
    expect(popover.props).toMatchObject({ placement: "end top", offset: 8, crossOffset: 2, children: "Content" });
    expect(exports).not.toHaveProperty("PopoverContent");
    expect(source).not.toContain("OverlayArrow");
  });
  it("preserves overlay elevation reads without introducing literal shadows", () => {
    const result = importShadcnAriaComponents(input());
    for (const item of ["dialog", "popover", "dropdown-menu"]) {
      if (item === "dialog") expect(result.rewrites[item]!.reads.themes.some(read => read.startsWith("themes.shadow."))).toBe(false);
      else expect(result.rewrites[item]!.reads.themes).toContain("themes.shadow.md");
      expect(result.rewrites[item]!.files.map(file => file.content).join("\n")).not.toMatch(/\bshadow-(?:sm|md|lg|xl|2xl)\b/);
    }
    expect(result.rewrites.tabs!.files.map(file => file.content).join("\n")).not.toMatch(/cn-tabs-list-variant-(?:default|line)/);
  });
  for (const item of ["dialog", "tabs"]) it(`keeps ${item} adapter output byte-exact with its golden`, () => {
    expect(importShadcnAriaComponents(input()).rewrites[item]).toEqual(JSON.parse(read(`${item}.golden.json`)));
  });
  it("keeps consumption members current and every unresolved candidate blocked", () => {
    const report = JSON.parse(readFileSync(resolve(import.meta.dirname, "../catalog/reports/components-consumption.json"), "utf8"));
    for (const [leaf, members] of Object.entries(supported)) {
      const fill = report.fills.find((row: { id: string }) => row.id === `shadcn@aria/components.${leaf}`);
      expect(fill.members, leaf).toEqual(members);
      expect(fill.evidence, leaf).toEqual([]);
      const candidate = report.candidates.find((row: { slot: string }) => row.slot === `components.${leaf}`);
      expect(candidate.shadcn.status, leaf).toBe("blocked");
      expect(candidate.shadcn.blockerCount, leaf).toBe(counts[leaf]);
    }
    expect(report.claims.runtimeAccessibility).toBe("unmeasured");
  });
  it("regenerates the eleven descriptors byte-exactly", () => {
    const files = generatedShadcnComponentFiles(input());
    for (const leaf of Object.keys(supported)) expect(files[`components.${leaf}.json`]).toBe(readFileSync(resolve(here, `../../../catalog/fills/shadcn@aria/components.${leaf}.json`), "utf8"));
  });
});
