/**
 * shadcn charts importer: the core chart leaves (bar, line, area) on Recharts.
 *
 * Input is the pinned upstream `chart.tsx` (ChartContainer, ChartTooltip,
 * ChartLegend and friends) kept byte-exact under `vendor/shadcn-charts/`.
 * The only change at materialization is the registry alias resolution the
 * shadcn installer itself performs (`"cn"` to the local utils part). Each
 * leaf adds one composition that wires Recharts marks to that container.
 *
 * Colours: every series reads the shadcn `--chart-N` slot first and falls
 * back to the theme token the shadcn@aria adapter binds it to; chart chrome
 * reads the existing chart token family. No colour literal is emitted.
 *
 * Rendering is client-only, as upstream: the file is marked "use client" and
 * Recharts 3 sizes the chart in an effect, so a server render draws no SVG.
 * The Foundry server charts stay the gap seat for server-rendered use.
 *
 * Regenerate the committed fills with the focused test:
 *   UPDATE_SHADCN_CHART_FILLS=1 npx vitest run src/importers/shadcn-charts.test.tsx
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot, FillMeta } from "../catalog-core/types.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";

export interface ChartSourceFile { path: string; content: string }

export const SHADCN_CHARTS_SOURCE = "shadcn-charts";
export const SHADCN_CHARTS_TRANSFORM = "shadcn-registry-alias@1";
export const SHADCN_CHARTS_PIN = Object.freeze({
  url: "https://github.com/shadcn-ui/ui",
  commit: "daaf156ee00ed91cc7e6bdd937c1b4973152d141",
  path: "apps/v4/registry/bases/aria/ui/chart.tsx",
  sha256: "1bbf2ff917b84dde3c715477618a244e374eaa490732c976dadf91c9b80328d7",
  notice: { path: "LICENSE.md", sha256: "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f" },
  engine: { name: "recharts", version: "3.8.0", license: "MIT" },
});

export interface ShadcnChartsInput { chart: ChartSourceFile; notice: ChartSourceFile; slots?: readonly ComponentSlot[] }
export interface ShadcnChartRewrite { files: readonly ChartSourceFile[]; outputSha256: readonly { path: string; sha256: string }[] }
export interface ShadcnChartFillDoc {
  $extensions: { "com.clossys.fill": FillMeta };
  components: Readonly<Record<string, Record<string, unknown>>>;
}
export interface ShadcnChartsImport { fills: readonly ShadcnChartFillDoc[]; rewrites: Readonly<Record<string, ShadcnChartRewrite>> }

/** Series colour slots: the shadcn var first, then the adapter-bound theme token. */
export const SHADCN_CHART_SERIES_COLORS: readonly string[] = Object.entries(adapter.bindings as Record<string, { property: string }>)
  .filter(([name]) => /^chart-\d+$/.test(name))
  .sort(([a], [b]) => Number(a.slice(6)) - Number(b.slice(6)))
  .map(([name, binding]) => `var(--${name}, var(${binding.property}))`);

/** Chart chrome reads the existing chart token family. */
export const SHADCN_CHART_CHROME = Object.freeze({
  grid: "var(--color-chart-grid)",
  axis: "var(--color-chart-axis)",
  axisLabel: "var(--color-chart-axis-label)",
});

const ALIAS_IMPORT = 'import { cn } from "cn"';
const ALIAS_TARGET = 'import { cn } from "../_parts/utils/index.js"';
const UTILS = 'import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n';
const READS = ["tokens.border-color", "tokens.categorical-color", "tokens.chart-color", "tokens.surface-color", "tokens.text-color"];
const DEPS = [
  { name: "react", version: "19.2.3", license: "MIT" },
  { name: "recharts", version: SHADCN_CHARTS_PIN.engine.version, license: "MIT" },
  { name: "clsx", version: "2.1.1", license: "MIT" },
  { name: "tailwind-merge", version: "3.3.1", license: "MIT" },
];

interface ChartLeaf { leaf: string; exportName: string; chart: string; mark: string; markProps: string; chartProps: string }
const LEAVES: readonly ChartLeaf[] = [
  { leaf: "chart-bar", exportName: "ChartBar", chart: "BarChart", mark: "Bar", chartProps: "", markProps: "fill={color} radius={4}" },
  { leaf: "chart-line", exportName: "ChartLine", chart: "LineChart", mark: "Line", chartProps: " margin={{ left: 12, right: 12 }}", markProps: 'type="monotone" stroke={color} strokeWidth={2} dot={false}' },
  { leaf: "chart-area", exportName: "ChartArea", chart: "AreaChart", mark: "Area", chartProps: " margin={{ left: 12, right: 12 }}", markProps: 'type="natural" fill={color} fillOpacity={0.4} stroke={color} stackId="series"' },
];

/** Member pointers name the composed upstream export that carries each member. */
const memberMap = (leaf: ChartLeaf): Record<string, string> => ({
  axes: `${leaf.exportName}.categoryKey: Recharts XAxis + CartesianGrid in ChartContainer`,
  legend: `${leaf.exportName}: ChartLegend content=ChartLegendContent`,
  series: `${leaf.exportName}.series: Recharts ${leaf.mark} per ChartConfig key`,
  tooltip: `${leaf.exportName}: ChartTooltip content=ChartTooltipContent`,
});

function composition(leaf: ChartLeaf): string {
  return `"use client"

import { ${leaf.mark}, ${leaf.chart}, CartesianGrid, XAxis } from "recharts"
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../chart/chart.js"

export interface ${leaf.exportName}Series { key: string; label: string }
export interface ${leaf.exportName}Props {
  data: Record<string, string | number>[]
  categoryKey: string
  series: readonly ${leaf.exportName}Series[]
  initialDimension?: { width: number; height: number }
  isAnimationActive?: boolean
  className?: string
}

const SERIES_COLORS = ${JSON.stringify(SHADCN_CHART_SERIES_COLORS)} as const

export function ${leaf.exportName}({ data, categoryKey, series, initialDimension, isAnimationActive = true, className }: ${leaf.exportName}Props) {
  if (series.length > SERIES_COLORS.length) throw new Error("${leaf.exportName}: at most " + SERIES_COLORS.length + " series; fold the tail before rendering")
  const config: ChartConfig = Object.fromEntries(series.map((item, index) => [item.key, { label: item.label, color: SERIES_COLORS[index]! }]))
  return (
    <ChartContainer config={config} className={className} {...(initialDimension ? { initialDimension } : {})}>
      <${leaf.chart} accessibilityLayer data={data}${leaf.chartProps}>
        <CartesianGrid vertical={false} stroke="${SHADCN_CHART_CHROME.grid}" />
        <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} tickMargin={8} stroke="${SHADCN_CHART_CHROME.axis}" tick={{ fill: "${SHADCN_CHART_CHROME.axisLabel}" }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map(item => {
          const color = \`var(--color-\${item.key})\`
          return <${leaf.mark} key={item.key} dataKey={item.key} ${leaf.markProps} isAnimationActive={isAnimationActive} />
        })}
      </${leaf.chart}>
    </ChartContainer>
  )
}
`;
}

/** Validate exact upstream bytes before anything reads them. */
export function verifyShadcnChartSource(file: ChartSourceFile): void {
  const expected = file.path === SHADCN_CHARTS_PIN.path ? SHADCN_CHARTS_PIN.sha256 : file.path === SHADCN_CHARTS_PIN.notice.path ? SHADCN_CHARTS_PIN.notice.sha256 : undefined;
  if (!expected || sha256(file.content) !== expected) throw new Error(`shadcn-charts: pinned sha256 mismatch for ${file.path}`);
}

/** Registry alias resolution only; every other upstream byte is kept. */
export function resolveChartAlias(content: string): string {
  if (content.split(ALIAS_IMPORT).length !== 2) throw new Error("shadcn-charts: expected exactly one cn alias import");
  return content.replace(ALIAS_IMPORT, ALIAS_TARGET);
}

/** Pure import: pinned input is caller-supplied; no registry or network calls. */
export function importShadcnCharts(input: ShadcnChartsInput): ShadcnChartsImport {
  verifyShadcnChartSource(input.chart); verifyShadcnChartSource(input.notice);
  const slots = new Map((input.slots ?? componentSlots as unknown as ComponentSlot[]).map(slot => [slot.id, slot]));
  const chart = { path: "components/chart/chart.tsx", content: resolveChartAlias(input.chart.content) };
  const notice = { path: adapter.notice, content: `# Third-party notice\n\nSource: ${SHADCN_CHARTS_PIN.url}\nCommit: ${SHADCN_CHARTS_PIN.commit}\nTransform: ${SHADCN_CHARTS_TRANSFORM}\n\n${input.notice.content}` };
  const utils = { path: "components/_parts/utils/index.ts", content: UTILS };
  const fills: ShadcnChartFillDoc[] = [], rewrites: Record<string, ShadcnChartRewrite> = {};
  for (const leaf of LEAVES) {
    const slot = slots.get(`components.${leaf.leaf}`);
    if (!slot) throw new Error(`shadcn-charts: missing contract components.${leaf.leaf}`);
    const entry = { path: `components/${leaf.leaf}/${leaf.leaf}.tsx`, content: composition(leaf) };
    const files = [chart, entry, notice, utils].sort((a, b) => a.path.localeCompare(b.path));
    const outputSha256 = files.map(file => ({ path: file.path, sha256: sha256(file.content) }));
    rewrites[leaf.leaf] = { files, outputSha256 };
    const propMap = memberMap(leaf);
    const members = Object.keys(propMap).sort();
    const required = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
    const pin = { url: SHADCN_CHARTS_PIN.url, commit: SHADCN_CHARTS_PIN.commit, files: [{ path: SHADCN_CHARTS_PIN.path, sha256: SHADCN_CHARTS_PIN.sha256 }, { path: SHADCN_CHARTS_PIN.notice.path, sha256: SHADCN_CHARTS_PIN.notice.sha256 }] };
    fills.push({
      $extensions: { "com.clossys.fill": {
        id: `${SHADCN_CHARTS_SOURCE}/${slot.id}`, slot: slot.id, source: SHADCN_CHARTS_SOURCE, mode: "implementation",
        sourceAddress: `${SHADCN_CHARTS_PIN.url}/blob/${SHADCN_CHARTS_PIN.commit}/${SHADCN_CHARTS_PIN.path}`,
        relation: required.every(member => members.includes(member)) && members.length === required.length ? "same-contract" : "subset",
        builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft",
        pin: { url: SHADCN_CHARTS_PIN.url, commit: SHADCN_CHARTS_PIN.commit, sha256: SHADCN_CHARTS_PIN.sha256 },
        unmapped: required.filter(member => !members.includes(member)),
      } as FillMeta },
      components: { [leaf.leaf]: {
        slot: slot.id, source: SHADCN_CHARTS_SOURCE, root: slot.contract.root, members, props: ["categoryKey", "className", "data", "initialDimension", "isAnimationActive", "series"], propMap,
        reads: { tokens: READS, assets: [], components: [] }, composes: [],
        impl: { kind: "source", entry: entry.path, export: leaf.exportName },
        license: "MIT", pin, notice: adapter.notice, transform: SHADCN_CHARTS_TRANSFORM, item: "chart",
        deps: DEPS, parts: [{ item: "utils" }], rendering: "client", outputSha256, blockers: [],
      } },
    });
  }
  return { fills, rewrites };
}

/** Adoption consumes only a rewrite whose output bytes still match its receipt. */
export function materializeShadcnChart(result: ShadcnChartsImport, leaf: string): readonly ChartSourceFile[] {
  const rewrite = result.rewrites[leaf];
  if (!rewrite) throw new Error(`shadcn-charts: no rewrite for ${leaf}`);
  if (rewrite.files.length !== rewrite.outputSha256.length || rewrite.files.some(file => !rewrite.outputSha256.some(pin => pin.path === file.path && pin.sha256 === sha256(file.content)))) throw new Error("shadcn-charts: rewritten output hash differs");
  return rewrite.files;
}

export function generatedShadcnChartFiles(input: ShadcnChartsInput): Readonly<Record<string, string>> {
  return Object.fromEntries(importShadcnCharts(input).fills.map(fill => [`${fill.$extensions["com.clossys.fill"].slot}.json`, stableStringify(fill)]));
}

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored pin: upstream chart.tsx byte-exact and the shadcn licence. */
export function pinnedShadcnChartsInput(): ShadcnChartsInput {
  return {
    chart: { path: SHADCN_CHARTS_PIN.path, content: readFileSync(resolve(here, "vendor/shadcn-charts/chart.tsx.txt"), "utf8") },
    notice: { path: SHADCN_CHARTS_PIN.notice.path, content: readFileSync(resolve(here, "vendor/shadcn-LICENSE.md"), "utf8") },
  };
}
export const SHADCN_CHART_FILLS_DIR = resolve(here, "../catalog/fills", SHADCN_CHARTS_SOURCE);
