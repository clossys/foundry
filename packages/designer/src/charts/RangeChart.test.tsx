import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RangeChart, type RangeChartProps } from "./RangeChart.js";
import { RangeChart as ServerRangeChart } from "./server.js";
import * as Charts from "./index.js";
import * as ServerCharts from "./server.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL, CHART_MARK_RADIUS } from "./internal/marks.js";
import type { StatusMarkTone } from "../atoms/StatusMark.js";

type RangeChartRow = RangeChartProps["rows"][number];

const labels = { table: "Schedule data", category: "Activity", from: "Start boundary", to: "End boundary", status: "State" };
const ticks = ["Phase A", "Phase B", "Phase C", "Phase D"];
const rows: readonly RangeChartRow[] = [
  { id: "whole", label: "Whole schedule", from: 0, to: 4 },
  { id: "fraction", label: "Fractional schedule", from: 0.5, to: 2.75 },
];
const props: RangeChartProps = { title: "Sample schedule", description: "Four authored periods", ticks, rows, labels, fit: "fluid" };
// Injected render-prop geometry only. The native frame/browser harness uses
// ChartFrame's existing x48/width296 plot inside the same 360-unit viewBox.
const plot = { x: 16, y: 16, width: 328, height: 72 };
const sourceDir = dirname(fileURLToPath(import.meta.url));
const SERVER_EXPORTS_WITHOUT_RANGE = ["ChartFrame", "BarChart", "LineChart", "ScatterChart", "Sparkline", "WaterfallChart", "AreaChart", "Heatmap", "StatusStrip"];

function elementProps(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(elementProps);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.props as Record<string, unknown>, ...elementProps(node.props.children)];
}
function markNodes(overrides: Partial<RangeChartProps> = {}) {
  const element = RangeChart({ ...props, ...overrides });
  return element.props.children(plot);
}
function tableRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tbody tr"), row => Array.from(row.querySelectorAll("th, td"), cell => cell.textContent));
}
function rowGroup(container: HTMLElement, id: string) {
  return container.querySelector(`[data-chart-part="range-row"][data-chart-row-id="${id}"]`)!;
}

describe("RangeChart bounds and tick-boundary geometry", () => {
  it("draws the exact four-tick full span and fractional span", () => {
    const { container } = render(<svg>{markNodes()}</svg>);
    const whole = rowGroup(container, "whole").querySelector('[data-chart-part="range"]')!;
    expect(Number(whole.getAttribute("x"))).toBe(16);
    expect(Number(whole.getAttribute("width"))).toBe(328);
    const fraction = rowGroup(container, "fraction").querySelector('[data-chart-part="range"]')!;
    expect(Number(fraction.getAttribute("x"))).toBe(57); // 16 + .5 * 82
    expect(Number(fraction.getAttribute("width"))).toBe(184.5); // (2.75 - .5) * 82
    expect(container.querySelectorAll('[data-chart-part="range"]')).toHaveLength(2);
  });

  it("keeps terminal boundary N valid, without indexing an absent tick N", () => {
    const { container } = render(<RangeChart {...props} />);
    expect(tableRows(container)).toEqual([["Whole schedule", "0", "4"], ["Fractional schedule", "0.5", "2.75"]]);
    expect(container.textContent).not.toContain("undefined");
  });

  it("accepts fractional bounds without rounding them to periods", () => {
    const fractionalRows = [{ id: "a", label: "A", from: 0.01, to: 0.02 }, { id: "b", label: "B", from: 3.9, to: 4 }];
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={fractionalRows} />)).not.toThrow();
    const { container } = render(<svg>{markNodes({ rows: fractionalRows })}</svg>);
    const rect = rowGroup(container, "a").querySelector('[data-chart-part="range"]')!;
    expect(Number(rect.getAttribute("x"))).toBeCloseTo(16.82);
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(0.82);
  });

  it("retains one long authored period in a visible single-entry numbered key", () => {
    const tick = "One extended authored period covering the complete schedule";
    const { container, getAllByRole } = render(<RangeChart {...props} ticks={[tick]} rows={[{ id: "one", label: "Activity", from: 0, to: 1 }]} />);
    const tickNodes = [...container.querySelectorAll('[data-chart-part="ticks"] text')];
    expect(tickNodes.map(node => node.textContent)).toEqual(["1"]);
    expect(Number(tickNodes[0]!.getAttribute("x"))).toBe(196); // native48 +296/2
    const entries = [...container.querySelectorAll('[data-chart-part="legend"] li')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toBe(`1 ${tick}`);
    expect(getAllByRole("listitem")).toHaveLength(1);
    expect(tableRows(container)).toEqual([["Activity", "0", "1"]]);
  });

  it("uses numbered anchors for two wide authored period names and retains their full visible key", () => {
    const periods = ["W".repeat(20), "W".repeat(20)];
    const { container, getAllByRole } = render(<RangeChart {...props} ticks={periods} rows={[{ id: "two", label: "Activity", from: 0, to: 2 }]} />);
    const tickNodes = [...container.querySelectorAll('[data-chart-part="ticks"] text')];
    expect(tickNodes.map(node => node.textContent)).toEqual(["1", "2"]);
    expect(tickNodes.map(node => Number(node.getAttribute("x")))).toEqual([122, 270]);
    const entries = [...container.querySelectorAll('[data-chart-part="legend"] li')];
    expect(entries.map(node => node.textContent)).toEqual(periods.map((period, index) => `${index + 1} ${period}`));
    expect(getAllByRole("listitem")).toHaveLength(2);
    expect(entries.every(node => !node.closest("details"))).toBe(true);
    expect(container.querySelector("details")!.open).toBe(false);
    expect(tableRows(container)).toEqual([["Activity", "0", "2"]]);
  });

  it.each(["\u{1F600}", "e\u0301", "\u{1F469}\u200D\u{1F4BB}"])("keeps grapheme %s intact at each text wrap boundary", cluster => {
    const nameFirst = "A".repeat(25) + cluster;
    const statusFirst = "A".repeat(24) + cluster;
    const { container } = render(<RangeChart {...props} rows={[{ id: "unicode", label: nameFirst + "B", from: 0, to: 4, status: { tone: "info", label: statusFirst + "B" } }]} />);
    const group = rowGroup(container, "unicode");
    // Inspect every tspan separately: joining split UTF-16 pieces would hide
    // a broken emoji, combining cluster or ZWJ sequence across two lines.
    expect([...group.querySelectorAll('[data-chart-part="row-label"] tspan')].map(span => span.textContent)).toEqual([nameFirst, "B"]);
    expect([...group.querySelectorAll('[data-chart-part="status"] text tspan')].map(span => span.textContent)).toEqual([statusFirst, "B"]);
    expect(tableRows(container)).toEqual([[nameFirst + "B", "0", "4", statusFirst + "B"]]);
  });

  it("keeps a 26-grapheme emoji label on one line rather than splitting UTF-16 units", () => {
    const label = "A".repeat(25) + "\u{1F600}";
    const { container } = render(<RangeChart {...props} rows={[{ id: "emoji", label, from: 0, to: 4 }]} />);
    expect([...rowGroup(container, "emoji").querySelectorAll('[data-chart-part="row-label"] tspan')].map(span => span.textContent)).toEqual([label]);
  });

  it("rejects narrow coordinate spaces and retains glyph-capable widths", () => {
    expect(() => renderToStaticMarkup(<RangeChart {...props} width={65} />)).toThrow(/width|margin/i);
    expect(() => renderToStaticMarkup(<RangeChart {...props} width={75} ticks={["P"]} rows={[{ id: "a", label: "A", from: 0, to: 1 }]} />)).not.toThrow();
    const short = [{ id: "a", label: "W", from: 0, to: 1, status: { tone: "info" as const, label: "W" } }];
    expect(() => renderToStaticMarkup(<RangeChart {...props} ticks={["P"]} rows={short} width={88} />)).toThrow(/width|status/i);
    for (const width of [89, 90]) {
      const { container } = render(<RangeChart {...props} ticks={["P"]} rows={short} width={width} />);
      expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe(`0 0 ${width} 102`);
      const rect = rowGroup(container, "a").querySelector('[data-chart-part="range"]')!;
      expect(Number(rect.getAttribute("x"))).toBe(48);
      expect(Number(rect.getAttribute("width"))).toBe(width - 64);
      expect(rowGroup(container, "a").querySelector('[data-chart-part="status"] text')!.textContent).toBe("W");
    }
  });

  it.each([89, 90])("rejects four numbered periods that cannot retain distinct tick glyphs at width%s", width => {
    expect(() => renderToStaticMarkup(<RangeChart {...props} width={width} rows={[{ id: "a", label: "W", from: 0, to: 4, status: { tone: "info", label: "W" } }]} />)).toThrow(/tick|period|width|space/i);
  });

  it("derives exact height and row spacing from wrapped name/status lines", () => {
    const longRows = [{ id: "long", label: "W".repeat(27), from: 0, to: 4, status: { tone: "info" as const, label: "W".repeat(26) } }, { id: "short", label: "W", from: 0, to: 4 }];
    const { container } = render(<RangeChart {...props} rows={longRows} />);
    // First pitch36+14+18+14=82; second36; margin48 =>166.
    expect(container.querySelector('svg[data-chart-part="frame"]')!.getAttribute("viewBox")).toBe("0 0 360 166");
    const first=rowGroup(container,"long"),second=rowGroup(container,"short");
    expect([...first.querySelectorAll('[data-chart-part="row-label"] tspan')].map(n=>n.textContent)).toEqual(["W".repeat(26),"W"]);
    expect([...first.querySelectorAll('[data-chart-part="status"] text tspan')].map(n=>n.textContent)).toEqual(["W".repeat(25),"W"]);
    expect(first.querySelector('[data-chart-part="status"]')!.getAttribute("transform")).toBe("translate(48 44)");
    expect(Number(first.querySelector('[data-chart-part="range"]')!.getAttribute("y"))).toBe(80);
    expect(Number(second.querySelector('[data-chart-part="row-label"]')!.getAttribute("y"))).toBe(107);
    expect(Number(second.querySelector('[data-chart-part="range"]')!.getAttribute("y"))).toBe(116);
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={longRows} height={165} />)).toThrow(/height|text/i);
    const { container: authored } = render(<RangeChart {...props} rows={longRows} height={200} />);
    expect(authored.querySelector('svg[data-chart-part="frame"]')!.getAttribute("viewBox")).toBe("0 0 360 200");
    expect([...authored.querySelectorAll('[data-chart-part="range"]')].map(n=>Number(n.getAttribute("y")))).toEqual([80,116]);
  });

  it("rejects empty data and blank authored row/tick labels", () => {
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={[]} />)).toThrow(/row|empty|data/i);
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={[{ ...rows[0]!, label: "   " }]} />)).toThrow(/label|authored/i);
    expect(() => renderToStaticMarkup(<RangeChart {...props} ticks={["   "]} rows={[{ id: "a", label: "A", from: 0, to: 1 }]} />)).toThrow(/tick|period|label|authored/i);
  });

  it("rejects a missing row ID with an authored validation TypeError", () => {
    const { id: _removed, ...withoutId } = rows[0]!;
    const renderInvalid = () => renderToStaticMarkup(<RangeChart {...props} rows={[withoutId as RangeChartRow]} />);
    expect(renderInvalid).toThrow(TypeError);
    expect(renderInvalid).toThrow("RangeChart requires authored row IDs.");
  });

  it.each([undefined, null, 42, false, {}, []].map(id => [id]))("rejects non-string row ID %j with an authored validation TypeError", id => {
    const invalidRow = { ...rows[0]!, id } as unknown as RangeChartRow;
    const renderInvalid = () => renderToStaticMarkup(<RangeChart {...props} rows={[invalidRow]} />);
    expect(renderInvalid).toThrow(TypeError);
    expect(renderInvalid).toThrow("RangeChart requires authored row IDs.");
  });

  it.each(["", "   ", rows[1]!.id])("retains unique nonblank row ID validation for %j", id => {
    const renderInvalid = () => renderToStaticMarkup(<RangeChart {...props} rows={[{ ...rows[0]!, id }, rows[1]!]} />);
    expect(renderInvalid).toThrow(RangeError);
    expect(renderInvalid).toThrow("RangeChart requires unique nonblank row IDs.");
  });

  it.each([
    [0, 4.01], // mutation target: N + .01 must fail while N remains valid
    [-0.01, 1], [1, 1], [2, 1], [4, 4.01],
    [NaN, 1], [0, NaN], [-Infinity, 1], [0, Infinity],
  ])("rejects from=%s to=%s rather than clamping or dropping the row", (from, to) => {
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={[{ ...rows[0]!, from, to }, rows[1]!]} />)).toThrow();
  });

  it("preserves authored row order and puts each label above its bar", () => {
    const { container } = render(<svg>{markNodes()}</svg>);
    expect(Array.from(container.querySelectorAll('[data-chart-part="range-row"]'), row => row.getAttribute("data-chart-row-id"))).toEqual(["whole", "fraction"]);
    for (const row of rows) {
      const group = rowGroup(container, row.id);
      const label = group.querySelector('[data-chart-part="row-label"]')!;
      const bar = group.querySelector('[data-chart-part="range"]')!;
      expect(label.tagName.toLowerCase()).toBe("text");
      expect(label.textContent).toBe(row.label);
      expect(Number(label.getAttribute("y"))).toBeLessThan(Number(bar.getAttribute("y")));
      expect(bar.getAttribute("fill")).toContain("--color-chart-categorical-1");
    }
    // cssstyle/jsdom does not implement CSS rx. Pin the authored React style;
    // the browser harness independently proves its computed token radius.
    const barProps = elementProps(markNodes()).filter(node => node["data-chart-part"] === "range");
    expect(barProps).toHaveLength(rows.length);
    for (const bar of barProps) expect(bar.style).toMatchObject({ rx: CHART_MARK_RADIUS });
  });
});

describe("direct SVG status adaptation", () => {
  const shapes: Record<StatusMarkTone, string> = { success: "circle", warning: "triangle", danger: "diamond", info: "open-circle", neutral: "dash" };
  // Independent SVG silhouettes; no production helper or atom DOM oracle.
  const paths: Partial<Record<StatusMarkTone, string>> = {
    success: "M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9Z",
    warning: "M5 0.5 9.75 9.25H0.25Z",
    danger: "M5 0 10 5 5 10 0 5Z",
    info: "M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9ZM5 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z",
  };
  const markClasses: Record<StatusMarkTone, string> = { success: "fill-status-success", warning: "fill-status-warning", danger: "fill-status-danger", info: "fill-status-info", neutral: "fill-ink-muted" };
  const textClasses: Record<StatusMarkTone, string> = { success: "text-status-success-text", warning: "text-status-warning-text", danger: "text-status-danger-text", info: "text-status-info-text", neutral: "text-ink-secondary" };
  const statusRows = (Object.keys(shapes) as StatusMarkTone[]).map((tone, index) => ({ id: tone, label: `Activity ${index + 1}`, from: 0, to: 4, status: { tone, label: `Authored ${tone}` } }));

  it("retains the five tone silhouettes, token classes and authored visible labels", () => {
    const { container } = render(<svg>{markNodes({ rows: statusRows })}</svg>);
    const serialized = document.createElement("div");
    serialized.innerHTML = renderToStaticMarkup(<svg>{markNodes({ rows: statusRows })}</svg>);
    for (const row of statusRows) {
      const tone = row.status.tone;
      const status = rowGroup(container, row.id).querySelector('[data-chart-part="status"]')!;
      expect(status.getAttribute("data-tone")).toBe(tone);
      const mark = status.querySelector('[data-part="mark"]')!;
      expect(mark.getAttribute("data-shape")).toBe(shapes[tone]);
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(mark.classList.contains(markClasses[tone])).toBe(true);
      expect(mark.children).toHaveLength(1);
      const glyph = mark.firstElementChild!;
      // The filled circle is an equivalent path contour. The dash keeps its
      // 8x2 geometry but uses CSS token rx instead of the atom's literal rx=1.
      if (tone === "neutral") {
        expect(glyph.tagName.toLowerCase()).toBe("rect");
        expect(["x", "y", "width", "height"].map(name => glyph.getAttribute(name))).toEqual(["1", "4", "8", "2"]);
        const serverDash = rowGroup(serialized, row.id).querySelector('[data-part="mark"] rect')!;
        expect(serverDash.getAttribute("style")?.replace(/\s/g, "").split(";")).toContain("rx:" + CHART_MARK_RADIUS.replace(/\s/g, ""));
      } else {
        expect(glyph.tagName.toLowerCase()).toBe("path");
        expect(glyph.getAttribute("d")).toBe(paths[tone]);
        if (tone === "info") expect(glyph.getAttribute("fill-rule")).toBe("evenodd");
      }
      for (const name of ["r", "rx", "ry"]) expect(glyph.hasAttribute(name)).toBe(false);
      if (tone === "success") {
        expect(glyph.getAttribute("stroke")).toBe(CHART_INLINE_AXIS_LABEL);
        expect(glyph.getAttribute("stroke-width")).toBe(CHART_HAIRLINE);
        expect(glyph.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      } else expect(glyph.hasAttribute("stroke-width")).toBe(false);
      const text = status.querySelector("text")!;
      expect(text.textContent).toBe(row.status.label);
      expect(text.classList.contains(textClasses[tone])).toBe(true);
      expect(text.getAttribute("fill")).toBe("currentColor");
    }
  });

  it("renders no HTML or foreignObject inside the marks", () => {
    const { container } = render(<svg>{markNodes({ rows: statusRows })}</svg>);
    for (const element of container.querySelector("svg")!.querySelectorAll("*")) {
      expect(element.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(["span", "div", "foreignobject"]).not.toContain(element.tagName.toLowerCase());
    }
  });
});

describe("complete native table and static accessibility", () => {
  it("rejects a missing required labels object at runtime", () => {
    const { labels: _removed, ...withoutLabels } = props;
    expect(() => renderToStaticMarkup(<RangeChart {...(withoutLabels as unknown as RangeChartProps)} />)).toThrow(/label|authored/i);
  });

  it.each(["table", "category", "from", "to"] as const)("rejects missing or blank required labels.%s at runtime", key => {
    const withoutHeading: Partial<RangeChartProps["labels"]> = { ...labels };
    delete withoutHeading[key];
    expect(() => renderToStaticMarkup(<RangeChart {...props} labels={withoutHeading as RangeChartProps["labels"]} />)).toThrow(/label|authored/i);
    for (const blank of ["", "   "]) {
      expect(() => renderToStaticMarkup(<RangeChart {...props} labels={{ ...labels, [key]: blank }} />)).toThrow(/label|authored/i);
    }
  });

  it("uses three authored columns when no status occurs", () => {
    const { container } = render(<ServerRangeChart {...props} />);
    expect(container.querySelector("details > summary")!.textContent).toBe(labels.table);
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(Array.from(container.querySelectorAll("thead th"), th => [th.textContent, th.getAttribute("scope")])).toEqual([[labels.category, "col"], [labels.from, "col"], [labels.to, "col"]]);
    expect(tableRows(container)).toEqual([["Whole schedule", "0", "4"], ["Fractional schedule", "0.5", "2.75"]]);
  });

  it("uses four columns for mixed status rows and retains the empty state cell", () => {
    const mixed = [{ ...rows[0]!, status: { tone: "warning" as const, label: "Awaiting review" } }, rows[1]!];
    const { container } = render(<RangeChart {...props} rows={mixed} />);
    expect(Array.from(container.querySelectorAll("thead th"), th => th.textContent)).toEqual([labels.category, labels.from, labels.to, labels.status]);
    expect(tableRows(container)).toEqual([["Whole schedule", "0", "4", "Awaiting review"], ["Fractional schedule", "0.5", "2.75", ""]]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr:last-child td")).toHaveLength(4);
  });

  it("requires an authored status header if any row has status", () => {
    const { status: _removed, ...withoutStatus } = labels;
    const mixed = [{ ...rows[0]!, status: { tone: "info" as const, label: "Scheduled" } }, rows[1]!];
    expect(() => renderToStaticMarkup(<RangeChart {...props} rows={mixed} labels={withoutStatus} />)).toThrow(/status|label/i);
    expect(() => renderToStaticMarkup(<RangeChart {...props} labels={withoutStatus} />)).not.toThrow();
  });

  it("provides title/description and a fluid360 static frame", () => {
    const { container } = render(<RangeChart {...props} />);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 120");
    expect(svg.getAttribute("width")).toBe("100%");
    expect((svg as SVGElement).style.maxWidth).toBe("540px");
    expect((svg as SVGElement).style.height).toBe("auto");
    expect(svg.querySelector("title")!.id).toBe(svg.getAttribute("aria-labelledby"));
    expect(svg.querySelector("title")!.textContent).toBe(props.title);
    expect(svg.querySelector("desc")!.id).toBe(svg.getAttribute("aria-describedby"));
    expect(svg.querySelector("desc")!.textContent).toBe(props.description);
    expect(svg.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(svg.querySelectorAll('[data-chart-part="range"]')).toHaveLength(2);
    for (const bar of svg.querySelectorAll('[data-chart-part="range"]')) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
    // Native details/summary is deliberately retained as the table control.
    const html = renderToStaticMarkup(<RangeChart {...props} />);
    expect(html).toContain("<details");
    expect(html).toContain(`<summary`);
    expect(html).toContain("<table");
    expect(html).not.toMatch(/\son[A-Z]|\stabindex=/i);
  });

  it("has zero React event handlers or tab targets on the geometry tree", () => {
    for (const node of elementProps(markNodes())) {
      expect(Object.entries(node).filter(([key, value]) => /^on[A-Z]/.test(key) && value != null)).toEqual([]);
      expect(node.tabIndex).toBeUndefined();
    }
  });
});

describe("RangeChart public and compiled server membership", () => {
  it("exports the same component through both existing chart barrels", () => {
    expect(Charts.RangeChart).toBe(RangeChart);
    expect(ServerCharts.RangeChart).toBe(RangeChart);
    // Synchronize with the existing exact render-environment.test.ts pin.
    expect(Object.keys(ServerCharts).sort()).toEqual([...SERVER_EXPORTS_WITHOUT_RANGE, "RangeChart"].sort());
  });

  it("resolves fresh compiled component and server barrel under react-server", () => {
    const component = resolve(sourceDir, "../../dist/charts/RangeChart.js");
    const barrel = resolve(sourceDir, "../../dist/charts/server.js");
    const expected = [...SERVER_EXPORTS_WITHOUT_RANGE, "RangeChart"].sort();
    const script = `
      const a = await import(${JSON.stringify(component)});
      const b = await import(${JSON.stringify(barrel)});
      if (a.RangeChart !== b.RangeChart) throw new Error("missing server export");
      if (JSON.stringify(Object.keys(b).sort()) !== JSON.stringify(${JSON.stringify(expected)})) throw new Error("server pin drift");
      const element = a.RangeChart(${JSON.stringify(props)});
      const nodes = element.props.children(${JSON.stringify(plot)});
      function walk(n) {
        if (Array.isArray(n)) return n.flatMap(walk);
        if (!n || !n.props) return [];
        return [n.props, ...walk(n.props.children)];
      }
      const tree = walk(nodes);
      if (tree.some(p => p.tabIndex !== undefined || Object.entries(p).some(([k,v]) => /^on[A-Z]/.test(k) && v != null))) throw new Error("client interaction");
      const bars = tree.filter(p => p["data-chart-part"] === "range");
      if (bars.length !== 2) throw new Error("missing marks");
      if (bars[0].x !== 16 || bars[0].width !== 328 || bars[1].x !== 57 || bars[1].width !== 184.5) throw new Error("geometry mismatch");
      process.stdout.write("OK");
    `;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 }).trim()).toBe("OK");
  });
});


describe("RangeChart accessible period mapping", () => {
  it.each([["A", "B", "C", "D"], ["P"]])("retains short period names outside hidden SVG for %j", (...periods) => {
    const { container, queryAllByRole } = render(<RangeChart {...props} ticks={periods} rows={[{ id: "short", label: "Activity", from: 0, to: periods.length }]} />);
    expect([...container.querySelectorAll('[data-chart-part="ticks"] text')].map(node => node.textContent)).toEqual(periods);
    const items = queryAllByRole("listitem");
    expect(items).toHaveLength(periods.length);
    expect(items.map(node => node.textContent)).toEqual(periods.map((period, index) => `${index + 1} ${period}`));
    expect(items.every(node => !node.closest('[aria-hidden="true"]') && !node.closest("details"))).toBe(true);
    expect(tableRows(container)).toEqual([["Activity", "0", String(periods.length)]]);
  });
});
