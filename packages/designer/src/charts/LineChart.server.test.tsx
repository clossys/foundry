import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LineChartProps } from "./LineChart.js";
import { LineChart as ClientLineChart } from "./LineChart.js";
import { LineChart } from "./LineChart.server.js";
import { LineChart as BarrelLineChart } from "./server.js";
import * as serverExports from "./server.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const props = {
  title: "Sample counts", description: "Counts by period",
  x: [-10, 0, 10],
  series: [
    { name: "Group A", values: [-2, 0, 6] },
    { name: "Group B", values: [4] },
  ],
  width: 400, height: 200,
  xColumnLabel: "Period", tableFallbackLabel: "Data table",
} satisfies LineChartProps;
const plot = { x: 48, y: 16, width: 336, height: 152 };
const expectedPaths = ["M48,168 L216,130 L384,16", "M48,54 L216,130 L384,130"];
const paths = (root: HTMLElement) => Array.from(
  root.querySelectorAll('[data-chart-part="series"] path'), node => node.getAttribute("d"),
);
const rows = (root: HTMLElement) => Array.from(
  root.querySelectorAll("tbody tr"),
  row => Array.from(row.querySelectorAll("th, td"), cell => cell.textContent),
);
type NodeProps = { children?: ReactNode; [name: string]: unknown };
function nodes(node: ReactNode): Array<{ type: unknown; props: NodeProps }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  return [{ type: node.type, props: node.props }, ...nodes(node.props.children)];
}

describe("server-safe LineChart", () => {
  it("preserves uneven numeric spacing and the subunit maximum floor", () => {
    const uneven = render(<LineChart {...props} x={[0, 2, 8]} series={[
      { name: "Group A", values: [-3, 0, 1] }, { name: "Group B", values: [0, 1, -1] },
    ]} />);
    expect(paths(uneven.container)).toEqual([
      "M48,168 L132,54 L384,16", "M48,54 L132,16 L384,92",
    ]);
    uneven.unmount();
    const subunit = render(<LineChart {...props} x={[0, 2, 8]}
      series={[{ name: "Group A", values: [0, 0.25, 0.5] }]} />);
    expect(paths(subunit.container)).toEqual(["M48,168 L132,130 L384,92"]);
  });

  it("matches client paths for identical defaults and Date formatting", () => {
    for (const shared of [
      { ...props, width: undefined, height: undefined },
      { ...props, x: [new Date("2026-01-01T12:00:00Z"), new Date("2026-01-02T12:00:00Z"), new Date("2026-01-04T12:00:00Z")] },
    ]) {
      const client = render(<ClientLineChart {...shared} />);
      const expected = paths(client.container);
      const tableRows = rows(client.container);
      client.unmount();
      const server = render(<LineChart {...shared} />);
      expect(paths(server.container)).toEqual(expected);
      expect(rows(server.container)).toEqual(tableRows);
      server.unmount();
    }
  });

  it("keeps rounded server ticks and grid lines inside the exact data plot", () => {
    const { container } = render(<LineChart {...props} x={[0, 1]}
      series={[{ name: "Group A", values: [-2, 10] }]} />);
    expect(paths(container)).toEqual(["M48,168 L384,16"]);
    const grid = Array.from(container.querySelectorAll('[data-chart-part="grid"] line'));
    const labels = Array.from(container.querySelectorAll('[data-chart-part="ticks"] > text[x="40"]'));
    expect(grid.length).toBeGreaterThan(0);
    expect(labels.map(node => node.textContent)).toEqual(["0", "5", "10"]);
    for (const node of [...grid, ...labels]) {
      const position = Number(node.getAttribute(node.tagName === "line" ? "y1" : "y"));
      expect(position).toBeGreaterThanOrEqual(plot.y);
      expect(position).toBeLessThanOrEqual(plot.y + plot.height);
    }
  });

  it("anchors the final authored Date tick inside the right plot edge", () => {
    const dates = [new Date("2026-01-01T12:00:00Z"), new Date("2026-01-02T12:00:00Z"), new Date("2026-01-04T12:00:00Z")];
    const { container } = render(<LineChart {...props} x={dates}
      xFormat={value => (value as Date).toISOString().slice(0, 10)} />);
    const ticks = Array.from(container.querySelectorAll('[data-chart-part="ticks"] > text[y="184"]'));
    expect(ticks.map(node => [node.textContent, node.getAttribute("x"), node.getAttribute("text-anchor")]))
      .toEqual([["2026-01-01", "48", "middle"], ["2026-01-02", "160", "middle"], ["2026-01-04", "384", "end"]]);
  });

  it("reads static stroke and endpoint radius from tokens", () => {
    const chart = LineChart(props);
    const native = nodes(chart.props.children(plot));
    for (const node of native.filter(item => item.type === "path" || item.type === "line")) {
      expect(node.props.strokeWidth).toBe("var(--ui-border-hairline, 1px)");
    }
    for (const node of native.filter(item => item.type === "circle")) {
      expect(node.props.style).toEqual({ r: "var(--radius-subtle, 2px)" });
    }
  });

  it("keeps endpoint labels inside the plot and separates their glyphs from crossing strokes", () => {
    const { container } = render(<LineChart {...props} x={[0, 1]} series={[
      { name: "Group A", values: [-2, 10] }, { name: "Group B", values: [10, -2] },
    ]} />);
    expect(paths(container)).toEqual(["M48,168 L384,16", "M48,16 L384,168"]);
    const labels = Array.from(container.querySelectorAll('[data-chart-part="direct-label"]'));
    expect(labels.map(node => node.textContent)).toEqual(["Group A 10", "Group B -2"]);
    for (const label of labels) {
      expect(Number(label.getAttribute("y"))).toBeGreaterThan(plot.y);
      expect(Number(label.getAttribute("y"))).toBeLessThan(plot.y + plot.height);
      expect(label.getAttribute("stroke")).toBe("var(--color-surface-base, oklch(0.9702 0 0))");
      expect(label.getAttribute("stroke-width")).toBe("var(--ui-border-hairline, 1px)");
      expect((label as SVGElement).style.paintOrder).toBe("stroke");
    }
  });

  it("separates labels whose series share the same final value", () => {
    const { container } = render(<LineChart {...props} series={[
      { name: "Group A", values: [-2, 0, 6] }, { name: "Group B", values: [4, 2, 6] },
    ]} />);
    const labels = Array.from(container.querySelectorAll('[data-chart-part="direct-label"]'));
    expect(labels.map(node => node.textContent)).toEqual(["Group A 6", "Group B 6"]);
    const baselines = labels.map(node => Number(node.getAttribute("y")));
    expect(Math.abs(baselines[1]! - baselines[0]!)).toBeGreaterThanOrEqual(14);
    for (const path of container.querySelectorAll('[data-chart-part="series"] path')) {
      for (const label of labels) {
        expect(path.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
  });

  it.each([{ x: [5] }, { x: [5, 5] }])("places degenerate x-domain names to the right of their endpoints: %j", ({ x }) => {
    const { container } = render(<LineChart {...props} x={x} series={[
      { name: "Group A", values: x.map(() => 6) }, { name: "Group B", values: x.map(() => -2) },
    ]} />);
    const labels = Array.from(container.querySelectorAll('[data-chart-part="direct-label"]'));
    expect(labels.map(node => node.textContent)).toEqual(["Group A 6", "Group B -2"]);
    for (const label of labels) {
      expect(Number(label.getAttribute("x"))).toBeGreaterThan(plot.x);
      expect(label.getAttribute("text-anchor")).toBe("start");
    }
    expect(rows(container)).toEqual(x.map(() => ["5", "6", "-2"]));
  });

  it.each([{ height: 64 }, { width: 64 }])("keeps names and values in the legend/table when the authored plot cannot fit labels: %j", size => {
    const { container } = render(<LineChart {...props} {...size} />);
    expect(container.querySelectorAll('[data-chart-part="series"] path')).toHaveLength(2);
    expect(container.querySelectorAll('[data-chart-part="direct-label"]')).toHaveLength(0);
    expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain("Group A");
    expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain("Group B");
    expect(rows(container)).toHaveLength(3);
    expect(rows(container).at(-1)).toEqual(["10", "6", "0"]);
  });

  it("draws exact pure negative/short-series geometry and labels the final zero-fill sample", () => {
    const chart = LineChart(props);
    const native = nodes(chart.props.children(plot));
    expect(native.filter(node => node.type === "path").map(node => node.props.d))
      .toEqual(expectedPaths);
    const { container } = render(<LineChart {...props} />);
    expect(paths(container)).toEqual(expectedPaths);
    expect(Array.from(container.querySelectorAll('[data-chart-part="series"] circle'),
      node => [node.getAttribute("cx"), node.getAttribute("cy")]))
      .toEqual([["384", "16"], ["384", "130"]]);
    expect(Array.from(container.querySelectorAll('[data-chart-part="direct-label"]'),
      node => node.textContent)).toEqual(["Group A 6", "Group B 0"]);
    expect(rows(container)).toEqual([
      ["-10", "-2", "4"], ["0", "0", "0"], ["10", "6", "0"],
    ]);
  });

  it("uses elapsed Date time rather than equal sample spacing", () => {
    const dateProps = {
      ...props,
      x: [new Date("2026-01-01T12:00:00Z"), new Date("2026-01-02T12:00:00Z"), new Date("2026-01-04T12:00:00Z")],
      xFormat: (value: Date | number) => (value as Date).toISOString().slice(0, 10),
    };
    const chart = LineChart(dateProps);
    expect(nodes(chart.props.children(plot)).filter(node => node.type === "path")
      .map(node => node.props.d)).toEqual([
        "M48,168 L160,130 L384,16", "M48,54 L160,130 L384,130",
      ]);
    const { container } = render(<LineChart {...dateProps} />);
    expect(rows(container)).toEqual([
      ["2026-01-01", "-2", "4"], ["2026-01-02", "0", "0"], ["2026-01-04", "6", "0"],
    ]);
  });

  it("uses the authored value formatter for ticks, direct labels and missing table samples", () => {
    const { container } = render(<LineChart {...props} valueFormat={value => `Value ${value}`} />);
    expect(rows(container)).toEqual([
      ["-10", "Value -2", "Value 4"], ["0", "Value 0", "Value 0"], ["10", "Value 6", "Value 0"],
    ]);
    expect(Array.from(container.querySelectorAll('[data-chart-part="direct-label"]'), node => node.textContent))
      .toEqual(["Group A Value 6", "Group B Value 0"]);
    expect(Array.from(container.querySelectorAll('[data-chart-part="ticks"] > text[x="40"]'), node => node.textContent))
      .toEqual(["Value -2", "Value 0", "Value 2", "Value 4", "Value 6"]);
  });

  it("handles empty and single-point data without non-finite geometry", () => {
    const empty = renderToStaticMarkup(
      <LineChart {...props} x={[]} series={[{ name: "Group A", values: [] }]} />,
    );
    expect(empty).not.toMatch(/NaN|Infinity/);
    const host = document.createElement("div");
    host.innerHTML = empty;
    expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(host.querySelectorAll('[data-chart-part="series"] circle')).toHaveLength(0);
    const { container } = render(
      <LineChart {...props} x={[5]} series={[{ name: "Group A", values: [0] }]} />,
    );
    expect(paths(container)).toEqual(["M48,168"]);
    const endpoint = container.querySelector('[data-chart-part="series"] circle')!;
    expect([endpoint.getAttribute("cx"), endpoint.getAttribute("cy")]).toEqual(["48", "168"]);
    expect(rows(container)).toEqual([["5", "0"]]);
  });

  it.each([1, 2, 8])("keeps every readable series name and table value for %i series", count => {
    const series = Array.from({ length: count },
      (_, index) => ({ name: "Group " + (index + 1), values: [-2 - index, 0, 6 + index] }));
    const { container } = render(<LineChart {...props} series={series} fit="fluid" />);
    expect(container.querySelectorAll('[data-chart-part="series"] path')).toHaveLength(count);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent))
      .toEqual(["Period", ...series.map(item => item.name)]);
    expect(rows(container)).toEqual(props.x.map((x, index) =>
      [String(x), ...series.map(item => String(item.values[index]))]));
    for (const item of series) {
      expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain(item.name);
    }
  });

  it("preserves entity palette slots when a series is filtered", () => {
    const colorDomain = ["Other", "Group A", "Group B"];
    const full = render(<LineChart {...props} colorDomain={colorDomain} />);
    const before = full.container.querySelectorAll('[data-chart-part="series"] path')[1]!
      .getAttribute("stroke");
    full.unmount();
    const filtered = render(<LineChart {...props} series={[props.series[1]!]} colorDomain={colorDomain} />);
    const after = filtered.container.querySelector('[data-chart-part="series"] path')!.getAttribute("stroke");
    expect(after).toBe(before);
    expect(after).toContain("--color-chart-categorical-3");
    filtered.unmount();
    const override = render(<LineChart {...props} series={[{ ...props.series[0]!, color: "currentColor" }]} />);
    expect(override.container.querySelector("path")!.getAttribute("stroke")).toBe("currentColor");
  });

  it("caps at eight before computing the domain, legend, labels and table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const series = Array.from({ length: 8 },
        (_, index) => ({ name: "Group " + (index + 1), values: [-2, 0, 6] }));
      const { container } = render(<LineChart {...props}
        series={[...series, { name: "Tail", values: [1000, 1000, 1000] }]} />);
      expect(paths(container)).toEqual(Array(8).fill(expectedPaths[0]));
      expect(container.querySelectorAll("thead th")).toHaveLength(9);
      expect(container.querySelectorAll('[data-chart-part="legend"] li')).toHaveLength(8);
      expect(container.querySelectorAll('[data-chart-part="direct-label"]')).toHaveLength(0);
      expect(container.textContent).not.toContain("Tail");
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });

  it("provides the named graphic and native data table without client handlers or focus targets", () => {
    const { container, getByRole } = render(<BarrelLineChart {...props} />);
    const svg = getByRole("img", { name: "Sample counts" });
    for (const [attribute, text] of [
      ["aria-labelledby", props.title], ["aria-describedby", props.description],
    ]) {
      const id = svg.getAttribute(attribute)!;
      expect(container.querySelector('[id="' + id + '"]')?.textContent).toBe(text);
    }
    expect(container.querySelector("summary")?.textContent).toBe("Data table");
    expect(rows(container)).toHaveLength(3);
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
    for (const part of ["hover-overlay", "hover-dot", "crosshair", "tooltip"]) {
      expect(container.querySelector('[data-chart-part="' + part + '"]')).toBeNull();
    }
    for (const mark of container.querySelectorAll(
      '[data-chart-part="series"] path, [data-chart-part="series"] circle',
    )) expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
    const chart = LineChart(props);
    for (const { props: native } of nodes(chart.props.children(plot))) {
      expect(native.tabIndex).toBeUndefined();
      expect(Object.entries(native).filter(([name, value]) =>
        /^on[A-Z]/.test(name) && value !== undefined)).toEqual([]);
    }
  });

  it("preserves fixed defaults and opts into fluid intrinsic sizing", () => {
    const defaults = { ...props, width: undefined, height: undefined };
    expect(renderToStaticMarkup(<LineChart {...defaults} fit="fixed" />))
      .toBe(renderToStaticMarkup(<LineChart {...defaults} />));
    const fixed = render(<LineChart {...defaults} />);
    expect(fixed.container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 480 280");
    expect(fixed.container.querySelector("svg")!.getAttribute("width")).toBe("480");
    fixed.unmount();
    const fluid = render(<LineChart {...defaults} fit="fluid" style={{ maxWidth: 500 }} />);
    const svg = fluid.container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 280");
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.style.maxWidth).toBe("540px");
    expect(svg.style.height).toBe("auto");
    expect(fluid.container.querySelector("figure")!.style.maxWidth).toBe("500px");
    fluid.unmount();
    const authored = render(<LineChart {...props} fit="fluid" />);
    expect(authored.container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 400 200");
    expect(authored.container.querySelector("svg")!.style.maxWidth).toBe("600px");
  });

  it.each([65, 96])("keeps cramped endpoint names in the legend and table at width %i", width => {
    const { container } = render(<LineChart {...props} width={width} />);
    expect(container.querySelectorAll('[data-chart-part="direct-label"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-chart-part="series"] path')).toHaveLength(2);
    expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain("Group A");
    expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain("Group B");
    expect(rows(container)).toHaveLength(3);
  });

  it("exports the ten intended server components", () => {
    expect(LineChart).toBe(BarrelLineChart);
    expect(Object.keys(serverExports).sort()).toEqual(["AreaChart", "BarChart", "ChartFrame", "Heatmap", "LineChart", "RangeChart", "ScatterChart", "Sparkline", "StatusStrip", "WaterfallChart"]);
  });

  it("imports compiled react-server modules and executes static geometry", () => {
    const component = resolve(sourceDir, "../../dist/charts/LineChart.server.js");
    const barrel = resolve(sourceDir, "../../dist/charts/server.js");
    const script = [
      "const a = await import(" + JSON.stringify(component) + ");",
      "const b = await import(" + JSON.stringify(barrel) + ");",
      'if (a.LineChart !== b.LineChart) throw new Error("missing server binding");',
      "const chart = a.LineChart(" + JSON.stringify(props) + ");",
      "const marks = chart.props.children(" + JSON.stringify(plot) + ");",
      "const found = [];",
      'function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node || !node.props) return; if (Object.entries(node.props).some(([key,value]) => /^on[A-Z]/.test(key) && value !== undefined)) throw new Error("client handler"); if (node.props.tabIndex !== undefined) throw new Error("focus target"); if (node.type === "path") found.push(node.props.d); visit(node.props.children); }',
      "visit(marks);",
      "if (JSON.stringify(found) !== " + JSON.stringify(JSON.stringify(expectedPaths)) + ') throw new Error("geometry mismatch");',
      'if (chart.props.table.rows[2][2] !== "0") throw new Error("missing final table sample");',
      'process.stdout.write("OK");',
    ].join("\n");
    expect(execFileSync(process.execPath,
      ["--conditions=react-server", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 10_000 }).trim()).toBe("OK");
  });
});
