// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ia from "../catalog/ia/components.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot } from "../catalog-core/types.js";
import { TOKENS } from "../tokens/tokens.js";
import {
  generatedShadcnChartFiles, importShadcnCharts, materializeShadcnChart, pinnedShadcnChartsInput, resolveChartAlias,
  SHADCN_CHARTS_PIN, verifyShadcnChartSource, type ChartSourceFile,
} from "./shadcn-charts.js";

const SHADCN_CHART_FILLS_DIR = resolve(import.meta.dirname, "../catalog/fills/shadcn-charts");
const requireFromHere = createRequire(import.meta.url);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
interface IaNode { id: string; leaves?: string[]; children?: IaNode[] }
const find = (nodes: readonly IaNode[], id: string): IaNode | undefined => {
  for (const node of nodes) { if (node.id === id) return node; const hit = node.children && find(node.children, id); if (hit) return hit; }
  return undefined;
};
const coreLeaves = find((ia as unknown as { nodes: IaNode[] }).nodes, "charts-core")!.leaves!;
const chartLeaves = [...coreLeaves, "components.chart-scatter", "components.chart-range", "components.chart-waterfall", "components.chart-sparkline"];
const slotById = new Map((slots as unknown as ComponentSlot[]).map(slot => [slot.id, slot]));

if (process.env.UPDATE_SHADCN_CHART_FILLS === "1") {
  mkdirSync(SHADCN_CHART_FILLS_DIR, { recursive: true });
  for (const [name, bytes] of Object.entries(generatedShadcnChartFiles(pinnedShadcnChartsInput()))) writeFileSync(resolve(SHADCN_CHART_FILLS_DIR, name), bytes);
}

/** Transpile the materialized in-memory sources to CommonJS and link them; React, Recharts and helpers stay shared. */
async function load(files: readonly ChartSourceFile[], entry: string): Promise<Record<string, unknown>> {
  const ts = requireFromHere("typescript") as typeof import("typescript");
  const byPath = new Map(files.map(file => [file.path, file.content]));
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const link = (path: string): Record<string, unknown> => {
    const hit = cache.get(path); if (hit) return hit.exports;
    const module = { exports: {} as Record<string, unknown> }; cache.set(path, module);
    const code = ts.transpileModule(byPath.get(path)!, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const local = (specifier: string): unknown => {
      if (!specifier.startsWith(".")) return requireFromHere(specifier);
      const base = posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, "");
      const target = [".tsx", ".ts"].map(ext => base + ext).find(candidate => byPath.has(candidate));
      if (!target) throw new Error(`unresolved ${specifier} from ${path}`);
      return link(target);
    };
    new Function("require", "module", "exports", code)(local, module, module.exports);
    return module.exports;
  };
  return link(entry);
}

describe("shadcn charts source (charts-core on Recharts)", () => {
  it("pins Recharts exactly at the version the shadcn commit uses", () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"));
    expect(manifest.dependencies.recharts).toBe(SHADCN_CHARTS_PIN.engine.version);
    expect(requireFromHere("recharts/package.json").version).toBe("3.8.0");
  });

  it("keeps the vendored upstream chart.tsx byte-exact and rejects tampering", () => {
    const input = pinnedShadcnChartsInput();
    expect(input.chart.content).toBe(readFileSync(resolve(import.meta.dirname, "vendor/shadcn-charts/chart.tsx.txt"), "utf8"));
    expect(input.notice.content).toBe(readFileSync(resolve(import.meta.dirname, "vendor/shadcn-LICENSE.md"), "utf8"));
    expect(() => verifyShadcnChartSource(input.chart)).not.toThrow();
    expect(() => importShadcnCharts({ ...input, chart: { ...input.chart, content: input.chart.content + " " } })).toThrow(/sha256 mismatch/);
    expect(() => importShadcnCharts({ ...input, notice: { ...input.notice, content: input.notice.content + " " } })).toThrow(/sha256 mismatch/);
    const chart = importShadcnCharts(input).rewrites["chart-bar"]!.files.find(file => file.path === "components/chart/chart.tsx")!.content;
    // Only the registry alias import differs from upstream.
    expect(chart).toBe(resolveChartAlias(input.chart.content));
    expect(chart.split("\n").filter((line, index) => line !== input.chart.content.split("\n")[index])).toEqual(['import { cn } from "../_parts/utils/index"']);
  });

  it("covers 100% of the charts-core members with committed, regenerated fills", () => {
    expect(coreLeaves).toEqual(["components.chart-bar", "components.chart-line", "components.chart-area"]);
    const generated = generatedShadcnChartFiles(pinnedShadcnChartsInput());
    const result = importShadcnCharts(pinnedShadcnChartsInput());
    expect(readdirSync(SHADCN_CHART_FILLS_DIR).sort()).toEqual(Object.keys(generated).sort());
    for (const slotId of chartLeaves) {
      const slot = slotById.get(slotId)!;
      const required = slot.contract.members.mode === "closed" ? slot.contract.members.names : [];
      expect(required.length).toBeGreaterThan(0);
      const path = resolve(SHADCN_CHART_FILLS_DIR, `${slotId}.json`);
      expect(existsSync(path), slotId).toBe(true);
      const committed = readFileSync(path, "utf8");
      expect(committed, slotId).toBe(generated[`${slotId}.json`]);
      for (const doc of [JSON.parse(committed), result.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === slotId)!]) {
        const meta = doc.$extensions["com.clossys.fill"];
        const descriptor = Object.values(doc.components)[0] as { members: string[]; propMap: Record<string, string>; reads: { tokens: string[] } };
        expect(meta).toMatchObject({ source: "shadcn-charts", relation: "same-contract", unmapped: [] });
        expect([...descriptor.members].sort(), slotId).toEqual([...required].sort());
        expect(Object.keys(descriptor.propMap).sort(), slotId).toEqual([...required].sort());
        for (const read of descriptor.reads.tokens) expect(slot.contract.allowedReads.tokens).toContain(read);
      }
    }
  });

  it("emits no hex literal: series read --chart-N, chrome reads chart tokens", () => {
    const result = importShadcnCharts(pinnedShadcnChartsInput());
    const importer = readFileSync(resolve(import.meta.dirname, "shadcn-charts.ts"), "utf8");
    expect(importer).not.toMatch(HEX);
    for (const leaf of ["chart-bar", "chart-line", "chart-area", "chart-scatter", "chart-range", "chart-waterfall", "chart-sparkline"]) {
      const code = materializeShadcnChart(result, leaf).find(file => file.path === `components/${leaf}/${leaf}.tsx`)!.content;
      expect(code, leaf).not.toMatch(HEX);
      for (const n of [1, 2, 3, 4, 5]) expect(code).toContain(`var(--chart-${n}, var(--color-chart-categorical-${n}))`);
      const vars = [...code.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1]!);
      for (const name of vars) {
        if (/^--chart-\d+$/.test(name) || name === "--color-") continue;
        expect(TOKENS[name], `${leaf} reads ${name}`).toBeDefined();
      }
      for (const chrome of ["--color-chart-grid", "--color-chart-axis", "--color-chart-axis-label"]) expect(vars).toContain(chrome);
    }
  });

  it.each(["chart-bar", "chart-line", "chart-area", "chart-scatter", "chart-range", "chart-waterfall", "chart-sparkline"])("%s renders an <svg> with series marks on the client", async leaf => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const React = requireFromHere("react") as typeof import("react");
    const { createRoot } = requireFromHere("react-dom/client") as typeof import("react-dom/client");
    const result = importShadcnCharts(pinnedShadcnChartsInput());
    const files = materializeShadcnChart(result, leaf);
    const exportName = (Object.values(result.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === `components.${leaf}`)!.components)[0] as { impl: { export: string } }).impl.export;
    const Chart = (await load(files, `components/${leaf}/${leaf}.tsx`))[exportName] as (props: Record<string, unknown>) => React.ReactElement;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const data = leaf === "chart-scatter"
      ? [{ month: -2, desktop: 8, mobile: 3 }, { month: 1, desktop: 5, mobile: 7 }, { month: 9, desktop: 12, mobile: 4 }]
      : leaf === "chart-range"
        ? [{ month: "Jan", desktop: [2, 7], mobile: [1, 5] }, { month: "Feb", desktop: [4, 8], mobile: [3, 9] }, { month: "Mar", desktop: [3, 6], mobile: [2, 8] }]
        : [{ month: "Jan", desktop: 186, mobile: 80 }, { month: "Feb", desktop: 305, mobile: 200 }, { month: "Mar", desktop: 237, mobile: 120 }];
    await React.act(async () => {
      root.render(React.createElement(Chart, { data, categoryKey: "month", series: [{ key: "desktop", label: "Desktop" }, { key: "mobile", label: "Mobile" }], initialDimension: { width: 320, height: 200 }, isAnimationActive: false }));
    });
    await React.act(async () => { await new Promise(done => setTimeout(done, 20)); });
    const svg = host.querySelector("svg.recharts-surface");
    expect(svg, leaf).not.toBeNull();
    const marks = { "chart-bar": ".recharts-bar-rectangle", "chart-line": ".recharts-line-curve", "chart-area": ".recharts-area-area", "chart-scatter": ".recharts-scatter-symbol", "chart-range": ".recharts-area-area", "chart-waterfall": ".recharts-bar-rectangle", "chart-sparkline": ".recharts-line-curve" }[leaf]!;
    expect(svg!.querySelectorAll(marks).length, leaf).toBeGreaterThanOrEqual(2);
    if (leaf === "chart-sparkline") {
      expect(svg!.querySelector(".recharts-cartesian-grid")).toBeNull();
      expect(host.querySelector(".recharts-legend-wrapper")).toBeNull();
      await React.act(async () => root.render(React.createElement(Chart, { data, categoryKey: "month", series: [{ key: "desktop", label: "Desktop" }], initialDimension: { width: 320, height: 200 }, isAnimationActive: false, showAxes: true, showLegend: true, showTooltip: true })));
      expect(host.querySelector(".recharts-cartesian-grid")).not.toBeNull();
      expect(host.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    }
    expect(host.querySelector("[data-slot=chart] style")?.textContent).toContain("--color-desktop: var(--chart-1, var(--color-chart-categorical-1));");
    await React.act(async () => root.unmount());
    host.remove();
    expect(dirname(SHADCN_CHART_FILLS_DIR)).toMatch(/catalog\/fills$/);
  });

  it("draws floating waterfall ranges below and across zero and exposes signed deltas", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const React = requireFromHere("react") as typeof import("react");
    const { createRoot } = requireFromHere("react-dom/client") as typeof import("react-dom/client");
    const files = materializeShadcnChart(importShadcnCharts(pinnedShadcnChartsInput()), "chart-waterfall");
    const { ChartWaterfall } = await load(files, "components/chart-waterfall/chart-waterfall.tsx");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await React.act(async () => root.render(React.createElement(ChartWaterfall as React.ComponentType<Record<string, unknown>>, {
        data: [-10, 5, 12, -20].map((change, index) => ({ stage: String(index), change })),
        categoryKey: "stage", series: [{ key: "change", label: "Change" }],
        initialDimension: { width: 500, height: 300 }, isAnimationActive: false,
      })));
      const ticks = [...host.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")].map(tick => ({ value: Number(tick.textContent), y: Number(tick.getAttribute("y")) }));
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      const a = ticks[0]!, b = ticks[1]!;
      const yAt = (value: number) => a.y + (value - a.value) * (b.y - a.y) / (b.value - a.value);
      const bars = [...host.querySelectorAll('.recharts-bar-rectangle path[fill="var(--color-change)"]')];
      expect(bars).toHaveLength(4);
      const ranges = [[-10, 0], [-10, -5], [-5, 7], [-13, 7]];
      for (const [index, bar] of bars.entries()) {
        const [low, high] = ranges[index]!;
        const y = Number(bar.getAttribute("y")), height = Number(bar.getAttribute("height"));
        expect(y, `bar ${index} upper bound`).toBeCloseTo(yAt(high!), 3);
        expect(y + height, `bar ${index} lower bound`).toBeCloseTo(yAt(low!), 3);
      }
      await React.act(async () => bars[0]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(host.querySelector(".cn-chart-tooltip")?.textContent).toContain("-10");
      expect(host.querySelector(".recharts-legend-wrapper")?.textContent).toBe("Change");
    } finally {
      await React.act(async () => root.unmount()); host.remove();
    }
  });
});
