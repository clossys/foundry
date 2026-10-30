// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = resolve(sourceRoot, "..");
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LAYOUT_LEAVES, getLayoutLeaf, getEffectiveLayoutContract } from "../../layouts/index.js";
import { Stack } from "./Stack.js";
import { Split } from "./Split.js";
import { SidebarContent } from "./SidebarContent.js";
import { Bento } from "./Bento.js";
import { LayoutPreview, LayoutPreviewMatrix } from "./preview/LayoutPreview.js";
import type { BreakpointValues } from "../../core/flow-stage.js";
import { breakpoint, columnsAt, planFlowStage, flowStageStyleSheet } from "../../core/flow-stage.js";

// Explicit fixture values model a host's resolved consumer library.
const breakpointValues: BreakpointValues = {
  "tokens.breakpoint.mobile": 375, "tokens.breakpoint.mobile-lg": 480,
  "tokens.breakpoint.tablet": 768, "tokens.breakpoint.tablet-lg": 1024,
  "tokens.breakpoint.desktop": 1280, "tokens.breakpoint.wide": 1440,
};

function dom(element: React.ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}
const fill = (id: string) => <span data-fill={id}>{id}</span>;
const readOrder = (host: HTMLElement) => [...host.querySelectorAll("[data-fill]")].map(node => node.getAttribute("data-fill"));

describe("page layout reading order and token reflow", () => {
  it.each([320, 1280])("keeps ordered stack slots at %i", width => {
    const host = dom(<Stack  stage={planFlowStage("layouts.stack", undefined, undefined, width, breakpointValues)} slots={{ lead: [fill("lead")], body: [fill("one"), fill("two")], close: [fill("close")] }} />);
    expect(readOrder(host)).toEqual(["lead", "one", "two", "close"]);
    expect(host.querySelector("main,aside,header,footer")).toBeNull();
  });
  it.each([320, 1280])("uses split collapse as DOM order at %i", width => {
    const slots = { lead: [fill("lead")], start: [fill("start")], end: [fill("end")] };
    expect(readOrder(dom(<Split  stage={planFlowStage("layouts.split", undefined, { collapse: "end-first" }, width, breakpointValues)} slots={slots} members={{ collapse: "end-first" }} />))).toEqual(["lead", "end", "start"]);
    expect(readOrder(dom(<Split  stage={planFlowStage("layouts.split", undefined, undefined, width, breakpointValues)} slots={slots} />))).toEqual(["lead", "start", "end"]);
  });
  it("changes sidebar DOM order with the token boundary and stacks per member", () => {
    const slots = { lead: [fill("lead")], main: [fill("main")], aside: [fill("aside")] };
    const members = { side: "start", "stacked-aside": "after", breakpoint: "tablet-lg" };
    const threshold = breakpoint("tokens.breakpoint.tablet-lg", breakpointValues);
    expect(readOrder(dom(<SidebarContent  stage={planFlowStage("layouts.sidebar-content", undefined, members, threshold - 1, breakpointValues)} slots={slots} members={members} />))).toEqual(["lead", "main", "aside"]);
    expect(readOrder(dom(<SidebarContent  stage={planFlowStage("layouts.sidebar-content", undefined, members, threshold, breakpointValues)} slots={slots} members={members} />))).toEqual(["lead", "aside", "main"]);
    expect(readOrder(dom(<SidebarContent  stage={planFlowStage("layouts.sidebar-content", undefined, { ...members, "stacked-aside": "before" }, 320, breakpointValues)} slots={slots} members={{ ...members, "stacked-aside": "before" }} />))).toEqual(["lead", "aside", "main"]);
  });
  it("resolves every reflow step from registered breakpoint tokens", () => {
    for (const leaf of LAYOUT_LEAVES.filter(leaf => leaf.status !== "held")) {
      let previous = 1;
      for (const step of leaf.contract.reflow) {
        const threshold = breakpoint(step.at, breakpointValues);
        expect(columnsAt(leaf.contract, threshold - 1, breakpointValues)).toBe(previous);
        expect(columnsAt(leaf.contract, threshold, breakpointValues)).toBe(step.columns);
        expect(columnsAt(leaf.contract, threshold + 1, breakpointValues)).toBe(step.columns);
        previous = step.columns;
      }
    }
  });
  it.each([320, 1280])("keeps bento tiles ordered and bounded at %i", width => {
    const host = dom(<Bento  stage={planFlowStage("layouts.bento", undefined, undefined, width, breakpointValues)} slots={{ tiles: [fill("a"), fill("b"), fill("c"), fill("d")] }} spans={["2x2", "1x1", "2x1", "1x2"]} />);
    expect(readOrder(host)).toEqual(["a", "b", "c", "d"]);
    expect([...host.querySelectorAll("[data-span]")].map(node => node.getAttribute("data-span"))).toEqual(["2x2", "1x1", "2x1", "1x2"]);
    expect(host.querySelector("[style]")).toBeNull();
  });
  it("projects exact Stage DOM order and emits container-query thresholds through the canonical consumer CSS pipeline", () => {
    const consumerValues = { ...breakpointValues, "tokens.breakpoint.tablet": 1100, "tokens.breakpoint.tablet-lg": 1200 };
    const profile = (values: BreakpointValues) => ({ values: { consumer: "synthetic", selectionHash: "fnv1a64:0000000000000000", members: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value: { light: { value, unit: "px" } }, css: { light: `${value}px` } }])) } }) as never;
    const css = (leaf: "layouts.split" | "layouts.bento", values: BreakpointValues) => flowStageStyleSheet(profile(values), leaf);
    expect(css("layouts.split", breakpointValues)).toContain("@container publisher-stage (min-width:768px)");
    expect(css("layouts.split", consumerValues)).toContain("@container publisher-stage (min-width:1100px)");
    expect(planFlowStage("layouts.bento", undefined, undefined, 900, breakpointValues).columns).toBe(2);
    expect(planFlowStage("layouts.bento", undefined, undefined, 900, consumerValues).columns).toBe(1);
    expect(css("layouts.bento", consumerValues)).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    const members = { breakpoint: "tablet", side: "start", "stacked-aside": "after" };
    expect(planFlowStage("layouts.sidebar-content", undefined, members, 900, breakpointValues).slotOrder).toEqual(["lead", "aside", "main"]);
    expect(planFlowStage("layouts.sidebar-content", undefined, members, 900, consumerValues).slotOrder).toEqual(["lead", "main", "aside"]);
    expect(css("layouts.split", consumerValues)).not.toMatch(/order:|var\(--breakpoint|@media/);
  });
  it.each([undefined, NaN, Infinity, 0, -1])("fails closed on missing or invalid used breakpoint %s", value => {
    const values = { ...breakpointValues, "tokens.breakpoint.tablet": value };
    expect(() => dom(<Split stage={planFlowStage("layouts.split", undefined, undefined, 900, values)}  slots={{ start: [fill("start")], end: [fill("end")] }} />)).toThrow("Unresolved layout breakpoint: tokens.breakpoint.tablet");
    expect(() => dom(<LayoutPreview leaf="layouts.split" width={900} theme="light" breakpointValues={values} />)).toThrow("Unresolved layout breakpoint: tokens.breakpoint.tablet");
  });
  it("enforces closed members, configs, slots and spans", () => {
    const slots = { start: [fill("s")], end: [fill("e")] };
    expect(() => dom(<Split  stage={planFlowStage("layouts.split", undefined, { collapse: "reverse" }, 320, breakpointValues)} slots={slots} members={{ collapse: "reverse" }} />)).toThrow();
    expect(() => dom(<Stack  stage={planFlowStage("layouts.stack", "stack.missing", undefined, 320, breakpointValues)} slots={{ body: [fill("a")] }} config="stack.missing" />)).toThrow();
    expect(() => dom(<Stack  stage={planFlowStage("layouts.stack", undefined, undefined, 320, breakpointValues)} slots={{ body: [fill("a")], unknown: [] }} />)).toThrow();
    expect(() => dom(<Stack  stage={planFlowStage("layouts.stack", undefined, undefined, 320, breakpointValues)} slots={{ body: [] }} />)).toThrow();
    expect(() => dom(<Stack  stage={planFlowStage("layouts.stack", undefined, undefined, NaN, breakpointValues)} slots={{ body: [fill("a")] }} />)).toThrow();
    expect(() => dom(<Bento  stage={planFlowStage("layouts.bento", undefined, undefined, 320, breakpointValues)} slots={{ tiles: [fill("a"), fill("b"), fill("c")] }} spans={["9x9" as "1x1", "1x1", "1x1"]} />)).toThrow();
    expect(() => dom(<SidebarContent  stage={planFlowStage("layouts.sidebar-content", undefined, { sticky: "aside" }, 1280, breakpointValues)} slots={{ main: [fill("m")], aside: [fill("a")] }} members={{ sticky: "aside" }} />)).toThrow();
  });
});

describe("contract-only skeleton previews and reproducible pins", () => {
  it("renders all slot shapes, minimum counts and only slot captions in each theme and width", () => {
    for (const leaf of LAYOUT_LEAVES.filter(leaf => leaf.status !== "held")) {
      for (const config of [undefined, ...leaf.contract.configs.map(config => config.id)]) {
        const contract = getEffectiveLayoutContract(leaf, config);
        for (const width of [320, 1280]) for (const theme of ["light", "dark"] as const) {
          const host = dom(<LayoutPreview breakpointValues={breakpointValues} leaf={leaf.id} config={config} width={width} theme={theme} />);
          expect(host.querySelector("[data-theme]")?.getAttribute("data-theme")).toBe(theme);
          for (const slot of contract.slots) {
            const shapes = host.querySelectorAll(`[data-layout-slot="${slot.id}"] [data-preview-shape]`);
            expect(shapes).toHaveLength(Math.min(slot.max, Math.max(1, slot.min)));
            for (const shape of shapes) { expect(shape.getAttribute("data-preview-shape")).toBe(slot.previewShape); expect(shape.textContent).toBe(slot.id); expect(shape.querySelector('[aria-hidden="true"]')).not.toBeNull(); }
          }
        }
      }
      expect(dom(<LayoutPreviewMatrix breakpointValues={breakpointValues} leaf={leaf.id} />).querySelectorAll("[data-theme]")).toHaveLength(4);
    }
    expect(() => dom(<LayoutPreview breakpointValues={breakpointValues} leaf="layouts.staggered-grid" width={320} theme="light" />)).toThrow();
  });
  it("pins the exact renderer and structural helper bytes for all four active fills", () => {
    for (const name of ["stack", "split", "sidebar-content", "bento"]) {
      const record = JSON.parse(readFileSync(resolve(sourceRoot, `layouts/fills/foundry/layouts.${name}.json`), "utf8"));
      expect(record.leaf).toBe(`layouts.${name}`);
      expect(record.library).toBe("foundry");
      expect(record.origin).toBe("authored");
      expect(record.configs).toEqual(getLayoutLeaf(record.leaf)!.contract.configs.map(config => config.id));
      const renderer = ({ "layouts.stack": "Stack", "layouts.split": "Split", "layouts.sidebar-content": "SidebarContent", "layouts.bento": "Bento" } as Record<string,string>)[record.leaf];
      expect(record.pin.files.map((file: { path: string }) => file.path).sort()).toEqual([`src/web/layouts/${renderer}.tsx`, "src/web/layouts/preview/structure.tsx", "src/layouts/resolve.ts", "src/layouts/ids.ts", "src/layouts/slots/layouts.json"].sort());
      for (const file of record.pin.files) {
        const bytes = readFileSync(resolve(packageRoot, file.path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
      }
    }
  });
});
