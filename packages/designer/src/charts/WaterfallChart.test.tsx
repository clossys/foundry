import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaterfallChart } from "./WaterfallChart.js";
import { WaterfallChart as PublicWaterfallChart, type WaterfallChartProps as PublicProps } from "./index.js";
import { WaterfallChart as ServerWaterfallChart, type WaterfallChartProps as ServerProps } from "./server.js";
import {
  CHART_DIVERGING_NEGATIVE,
  CHART_DIVERGING_NEUTRAL,
  CHART_DIVERGING_POSITIVE,
} from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL } from "./internal/marks.js";

type Props = Parameters<typeof WaterfallChart>[0];
type RectProps = Record<string, unknown>;
const sourceDir = dirname(fileURLToPath(import.meta.url));

const props = {
  title: "Balance bridge",
  description: "Opening balance and signed changes",
  start: { label: "Opening", value: 100 },
  steps: [
    { id: "a", label: "Added", value: 30 },
    { id: "b", label: "Removed", value: -20 },
    { id: "c", label: "Recovered", value: 10 },
  ],
  end: { label: "Closing" },
  labels: { table: "Show values", category: "Stage", value: "Amount" },
  valueFormat: (value: number) => String(value),
} satisfies Props;

function rectProps(node: ReactNode): RectProps[] {
  if (Array.isArray(node)) return node.flatMap(rectProps);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return node.type === "rect" ? [node.props] : rectProps(node.props.children);
}

// Same pure-component/render-prop approach as BarChart.server.test.tsx.
// Expected geometry never calls the production accumulator or scale helper.
function marks(overrides: Partial<Props> = {}, height = 130): RectProps[] {
  const frame = WaterfallChart({ ...props, ...overrides });
  return rectProps(frame.props.children({ x: 0, y: 0, width: 300, height }));
}

function expectGeometry(actual: RectProps[], expected: readonly (readonly [number, number])[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((mark, index) => {
    expect(mark.y, `bar ${index} top`).toBeCloseTo(expected[index]![0], 10);
    expect(mark.height, `bar ${index} height`).toBeCloseTo(expected[index]![1], 10);
  });
}

function tableRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("table tbody tr")].map(row =>
    [...row.querySelectorAll("th, td")].map(cell => cell.textContent ?? ""),
  );
}

function visibleMarkValues(container: HTMLElement): string[] {
  // ChartFrame's outer marks group also contains this chart's own ticks.
  return [...container.querySelectorAll('[data-chart-part="marks"] text')]
    .filter(text => !text.closest('[data-chart-part="ticks"], [data-chart-part="tooltip"]'))
    .map(text => text.textContent ?? "");
}

function categoryTickLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-chart-part="ticks"] text[text-anchor="middle"]')]
    .map(text => text.textContent ?? "");
}

describe("WaterfallChart accumulation and geometry", () => {
  it("connects every adjacent bar at the preceding accumulated endpoint", () => {
    const frame = WaterfallChart(props);
    function connectors(node: ReactNode): RectProps[] {
      if (Array.isArray(node)) return node.flatMap(connectors);
      if (!isValidElement<{ children?: ReactNode; "data-chart-part"?: string }>(node)) return [];
      if (node.props["data-chart-part"] === "grid") return [];
      return node.type === "line" ? [node.props] : connectors(node.props.children);
    }
    const actual = connectors(frame.props.children({ x: 0, y: 0, width: 300, height: 130 }));
    expect(actual).toHaveLength(4);
    // Five bands place their centers at 30,90,150,210,270; each bar is 24 wide.
    const expected = [[42, 78, 30], [102, 138, 0], [162, 198, 20], [222, 258, 10]];
    for (const [index, line] of actual.entries()) {
      expect(line.x1).toBeCloseTo(expected[index]![0]!, 10);
      expect(line.x2).toBeCloseTo(expected[index]![1]!, 10);
      expect(line.y1).toBeCloseTo(expected[index]![2]!, 10);
      expect(line.y2).toBeCloseTo(expected[index]![2]!, 10);
    }
  });

  it("accumulates each delta from its prior endpoint and draws both totals from zero", () => {
    expectGeometry(marks(), [
      [30, 100], // 0 -> 100
      [0, 30],   // 100 -> 130
      [0, 20],   // 130 -> 110
      [10, 10],  // 110 -> 120
      [10, 120], // 0 -> 120
    ]);
  });

  it("includes every running endpoint in the domain, including excursions and a zero crossing", () => {
    expectGeometry(marks({
      start: { label: "Opening", value: -20 },
      steps: [
        { id: "a", label: "First", value: 5 },
        { id: "b", label: "Second", value: -30 },
        { id: "c", label: "Third", value: 50 },
      ],
    }, 50), [
      [5, 20],  // 0 -> -20
      [20, 5],  // -20 -> -15
      [20, 30], // -15 -> -45
      [0, 50],  // -45 -> 5
      [0, 5],   // 0 -> 5
    ]);
  });

  it("retains an authored zero step without inventing a positive mark height", () => {
    const input = { steps: [{ id: "zero", label: "Unchanged", value: 0 }] };
    const actual = marks(input, 100);
    expectGeometry(actual, [[0, 100], [0, 0], [0, 100]]);
    const { container } = render(<WaterfallChart {...props} {...input} />);
    expect(tableRows(container)).toEqual([
      ["Opening", "+100"], ["Unchanged", "0"], ["Closing", "+100"],
    ]);
    expect(visibleMarkValues(container)).toEqual(["+100", "0", "+100"]);
  });

  it("accepts an empty bridge and preserves both authored total rows", () => {
    expectGeometry(marks({ steps: [] }, 100), [[0, 100], [0, 100]]);
    const { container } = render(<WaterfallChart {...props} steps={[]} />);
    expect(tableRows(container)).toEqual([["Opening", "+100"], ["Closing", "+100"]]);
  });

  it("keeps all-zero marks at the zero baseline and normalizes negative zero text", () => {
    const input = {
      start: { label: "Opening", value: -0 },
      steps: [{ id: "zero", label: "Unchanged", value: -0 }],
      end: { label: "Closing", value: 0 },
    };
    expectGeometry(marks(input, 100), [[100, 0], [100, 0], [100, 0]]);
    const { container } = render(<WaterfallChart {...props} {...input} />);
    expect(visibleMarkValues(container)).toEqual(["0", "0", "0"]);
    expect(tableRows(container)).toEqual([["Opening", "0"], ["Unchanged", "0"], ["Closing", "0"]]);
  });
});

describe("WaterfallChart visible information and table", () => {
  it("rejects a missing authored labels object instead of falling back to English copy", () => {
    expect(() => WaterfallChart({ ...props, labels: undefined as unknown as Props["labels"] }))
      .toThrow(/label|table|category|value/i);
  });

  it.each(["table", "category", "value"] as const)("rejects missing or blank authored labels.%s", field => {
    for (const value of [undefined, "", " \t "]) {
      const labels = { ...props.labels, [field]: value } as unknown as Props["labels"];
      expect(() => WaterfallChart({ ...props, labels })).toThrow(/label|table|category|value/i);
    }
  });

  it("defaults to the authored fluid coordinate space and keeps outer class/style", () => {
    const { container } = render(<WaterfallChart {...props} className="fixture-chart" style={{ maxWidth: 400 }} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 280");
    expect(svg.style.maxWidth).toBe("540px");
    expect(svg.style.height).toBe("auto");
    expect(container.querySelector("figure")?.classList.contains("fixture-chart")).toBe(true);
    expect(container.querySelector("figure")?.style.maxWidth).toBe("400px");
  });

  it("shows signs on every nonzero bar and keeps all authored rows in the required table fallback", () => {
    const { container } = render(<WaterfallChart {...props} />);
    expect(container.querySelector("figcaption")?.textContent).toBe("Balance bridge");
    expect(container.querySelector("svg title")?.textContent).toBe("Balance bridge");
    expect(visibleMarkValues(container)).toEqual(["+100", "+30", "\u221220", "+10", "+120"]);
    expect(container.querySelector("details summary")?.textContent).toBe("Show values");
    expect([...container.querySelectorAll("table thead th")].map(cell => cell.textContent)).toEqual(["Stage", "Amount"]);
    expect(tableRows(container)).toEqual([
      ["Opening", "+100"],
      ["Added", "+30"],
      ["Removed", "\u221220"],
      ["Recovered", "+10"],
      ["Closing", "+120"],
    ]);
  });

  it("supplies every bar's sign independently of a formatter that only formats magnitude", () => {
    const { container } = render(<WaterfallChart {...props} valueFormat={value => `$${value}`} />);
    expect(visibleMarkValues(container)).toEqual(["+$100", "+$30", "\u2212$20", "+$10", "+$120"]);
    expect(tableRows(container)).toEqual([
      ["Opening", "+$100"], ["Added", "+$30"], ["Removed", "\u2212$20"],
      ["Recovered", "+$10"], ["Closing", "+$120"],
    ]);
    const axisTicks = [...container.querySelectorAll('[data-chart-part="ticks"] text[text-anchor="end"]')]
      .map(text => text.textContent ?? "");
    expect(axisTicks.some(text => text.startsWith("$"))).toBe(true);
    expect(axisTicks.some(text => text.startsWith("+"))).toBe(false);
  });

  it("keeps normal short stage names directly on the SVG without an ordinal key", () => {
    const input = {
      start: { label: "Open", value: 100 },
      steps: [
        { id: "a", label: "Add", value: 30 },
        { id: "b", label: "Less", value: -20 },
        { id: "c", label: "Add", value: 10 },
      ],
      end: { label: "End" },
    };
    const { container } = render(<WaterfallChart {...props} {...input} />);
    expect(categoryTickLabels(container)).toEqual(["Open", "Add", "Less", "Add", "End"]);
    expect(container.querySelector('[data-chart-part="legend"]')).toBeNull();
    expect(visibleMarkValues(container)).toEqual(["+100", "+30", "\u221220", "+10", "+120"]);
  });

  it("maps dense ordinal anchors to every full authored name in an always-visible key", () => {
    const names = [
      "Opening balance carried from the prior reporting period",
      "Adjustment with a long authored category name retained in full",
      "Adjustment with a long authored category name retained in full",
      "Recovery adjustment with a separate full authored category name",
      "Closing balance after all authored reporting-period changes",
    ];
    const input = {
      start: { label: names[0]!, value: 100 },
      steps: props.steps.map((step, index) => ({ ...step, label: names[index + 1]! })),
      end: { label: names[4]! },
    };
    const frame = WaterfallChart({ ...props, ...input });
    expect(frame.props.legend?.map(item => item.label)).toEqual(names.map((name, index) => `${index + 1} ${name}`));
    expect(frame.props.legend?.map(item => item.color)).toEqual([
      CHART_DIVERGING_NEUTRAL, CHART_DIVERGING_POSITIVE, CHART_DIVERGING_NEGATIVE,
      CHART_DIVERGING_POSITIVE, CHART_DIVERGING_NEUTRAL,
    ]);
    const { container } = render(<WaterfallChart {...props} {...input} />);
    expect(categoryTickLabels(container)).toEqual(["1", "2", "3", "4", "5"]);
    const legend = container.querySelector('[data-chart-part="legend"]')!;
    expect(legend).not.toBeNull();
    expect(legend.closest("details")).toBeNull();
    expect([...legend.querySelectorAll("li")].map(item => item.textContent)).toEqual(
      names.map((name, index) => `${index + 1} ${name}`),
    );
    expect(tableRows(container)).toEqual(names.map((name, index) => [
      name, ["+100", "+30", "\u221220", "+10", "+120"][index]!,
    ]));
    expect(visibleMarkValues(container)).toEqual(["+100", "+30", "\u221220", "+10", "+120"]);
  });

  it("keeps negative totals and zero changes distinct with the same custom formatter", () => {
    const { container } = render(<WaterfallChart
      {...props}
      start={{ label: "Opening", value: -20 }}
      steps={[
        { id: "zero", label: "Unchanged", value: 0 },
        { id: "loss", label: "Removed", value: -5 },
        { id: "gain", label: "Added", value: 10 },
      ]}
      valueFormat={value => `$${value}`}
    />);
    expect(visibleMarkValues(container)).toEqual(["\u2212$20", "$0", "\u2212$5", "+$10", "\u2212$15"]);
    expect(tableRows(container)).toEqual([
      ["Opening", "\u2212$20"], ["Unchanged", "$0"], ["Removed", "\u2212$5"],
      ["Added", "+$10"], ["Closing", "\u2212$15"],
    ]);
  });

  it("uses the unsigned formatter consistently for bars, table and negative-axis ticks", () => {
    const calls: number[] = [];
    const { container } = render(<WaterfallChart
      {...props}
      start={{ label: "Opening", value: -20 }}
      steps={[{ id: "gain", label: "Added", value: 5 }]}
      valueFormat={value => { calls.push(value); return `$${value}`; }}
    />);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(value => value >= 0 && !Object.is(value, -0))).toBe(true);
    expect(visibleMarkValues(container)).toEqual(["\u2212$20", "+$5", "\u2212$15"]);
    expect(tableRows(container)).toEqual([["Opening", "\u2212$20"], ["Added", "+$5"], ["Closing", "\u2212$15"]]);
    const ticks = [...container.querySelectorAll('[data-chart-part="ticks"] text')]
      .map(text => text.textContent ?? "");
    expect(ticks.some(text => text.startsWith("\u2212$"))).toBe(true);
    expect(ticks.some(text => text.startsWith("$-"))).toBe(false);
  });

  it("accepts an exact authored end without changing the accumulated bars or rows", () => {
    expect(marks({ end: { label: "Closing", value: 120 } })).toEqual(marks());
    const { container } = render(<WaterfallChart {...props} end={{ label: "Closing", value: 120 }} />);
    expect(tableRows(container).at(-1)).toEqual(["Closing", "+120"]);
  });
});

describe("WaterfallChart existing color and outline tokens", () => {
  it("uses the diverging poles for deltas and a visible non-scaling neutral perimeter for totals", () => {
    const actual = marks();
    for (const index of [0, 4]) {
      expect(actual[index]?.fill).toBe(CHART_DIVERGING_NEUTRAL);
      expect(actual[index]?.stroke).toBe(CHART_INLINE_AXIS_LABEL);
      expect(actual[index]?.strokeWidth).toBe(CHART_HAIRLINE);
      expect(actual[index]?.vectorEffect).toBe("non-scaling-stroke");
    }
    expect(actual[1]?.fill).toBe(CHART_DIVERGING_POSITIVE);
    expect(actual[2]?.fill).toBe(CHART_DIVERGING_NEGATIVE);
    expect(actual[3]?.fill).toBe(CHART_DIVERGING_POSITIVE);
  });
});

describe("WaterfallChart additive server/public entry", () => {
  it("exports the same implementation and matching props through both barrels", () => {
    const publicProps: PublicProps = props;
    const serverProps: ServerProps = props;
    expect(PublicWaterfallChart).toBe(WaterfallChart);
    expect(ServerWaterfallChart).toBe(WaterfallChart);
    expect(publicProps.labels).toEqual(serverProps.labels);
  });

  it("resolves the actual compiled component and server barrel under react-server without client handlers or hooks", () => {
    const component = resolve(sourceDir, "../../dist/charts/WaterfallChart.js");
    const server = resolve(sourceDir, "../../dist/charts/server.js");
    const input = JSON.stringify({ ...props, valueFormat: undefined });
    const script = `const direct = await import(${JSON.stringify(component)});
const barrel = await import(${JSON.stringify(server)});
if (direct.WaterfallChart !== barrel.WaterfallChart) throw new Error("missing server export");
function nodes(n) { if (Array.isArray(n)) return n.flatMap(nodes); if (!n || !n.props) return []; return [n, ...nodes(n.props.children)]; }
const frame = direct.WaterfallChart(${input});
const tree = frame.props.children({x:48,y:16,width:296,height:232});
const marks = nodes(tree);
if (marks.filter(n => n.type === "rect").length !== 5) throw new Error("missing accumulated bars");
if (marks.some(n => n.props.tabIndex !== undefined || Object.entries(n.props).some(([k,v]) => /^on[A-Z]/.test(k) && v !== undefined))) throw new Error("interactive mark");
function checkHidden(n, hidden=false) { if (Array.isArray(n)) return n.forEach(c => checkHidden(c,hidden)); if (!n || !n.props) return; const current = hidden || n.props["aria-hidden"] === true || n.props["aria-hidden"] === "true"; if (n.type === "rect" && !current) throw new Error("nonstatic mark"); checkHidden(n.props.children,current); }
checkHidden(tree);
process.stdout.write("OK");`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], {
      encoding: "utf8", timeout: 10_000,
    }).trim()).toBe("OK");
  });
});

describe("WaterfallChart bounded numeric inputs and explicit end", () => {
  it("rejects duplicate authored step IDs without requiring category labels to be unique", () => {
    expect(() => WaterfallChart({
      ...props,
      steps: [{ id: "same", label: "First", value: 1 }, { id: "same", label: "Second", value: 2 }],
    })).toThrow(/id|duplicate|unique/i);
    expect(() => WaterfallChart({
      ...props,
      steps: [{ id: "a", label: "Change", value: 1 }, { id: "b", label: "Change", value: 2 }],
    })).not.toThrow();
  });

  it("rejects an empty or whitespace-only step ID", () => {
    for (const id of ["", "   "]) {
      expect(() => WaterfallChart({ ...props, steps: [{ id, label: "Change", value: 1 }] })).toThrow(/id/i);
    }
  });

  it.each([1e-20, 1e308])("renders finite distinct axis ticks for valid magnitude %s", value => {
    const { container } = render(<WaterfallChart
      {...props} start={{ label: "Opening", value }} steps={[]} end={{ label: "Closing" }}
    />);
    const ticks = [...container.querySelectorAll('[data-chart-part="ticks"] text')];
    const text = ticks.map(tick => tick.textContent ?? "");
    expect(new Set(text).size).toBe(text.length);
    expect(text.join(" ")).not.toMatch(/NaN|Infinity/);
    // The authored category labels are nonnumeric. Require actual numeric
    // y-axis ticks, rather than accidentally counting Opening/Closing.
    const numericTicks = ticks.filter(tick => Number.isFinite(Number(tick.textContent)));
    const values = numericTicks.map(tick => Number(tick.textContent));
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain(0);
    expect(values).toContain(value);
    expect(values.every(tick => tick >= 0 && tick <= value)).toBe(true);
    // Default frame margin yields the independent plot interval [16,248].
    for (const tick of numericTicks) {
      const y = Number(tick.getAttribute("y"));
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThanOrEqual(248);
    }
    for (const mark of container.querySelectorAll("rect")) {
      for (const attribute of ["x", "y", "width", "height"]) {
        expect(Number.isFinite(Number(mark.getAttribute(attribute)))).toBe(true);
      }
    }
    for (const tick of ticks) {
      expect(Number.isFinite(Number(tick.getAttribute("x")))).toBe(true);
      expect(Number.isFinite(Number(tick.getAttribute("y")))).toBe(true);
    }
  });

  it("rejects an authored end that disagrees with the accumulation", () => {
    expect(() => WaterfallChart({ ...props, end: { label: "Closing", value: 121 } })).toThrow(/end|total|mismatch/i);
  });

  it("accepts ordinary floating-point roundoff without decimal-place rounding", () => {
    expect(() => WaterfallChart({
      ...props,
      start: { label: "Opening", value: 0.1 },
      steps: [{ id: "a", label: "Added", value: 0.2 }],
      end: { label: "Closing", value: 0.3 },
    })).not.toThrow();
  });

  it("uses the derived end in both text alternatives after accepting a near-equal authored end", () => {
    const input = {
      ...props,
      start: { label: "Opening", value: 0.1 },
      steps: [{ id: "a", label: "Added", value: 0.2 }],
      end: { label: "Closing", value: 0.3 },
    };
    const { container } = render(<WaterfallChart {...input} />);
    expect(visibleMarkValues(container).at(-1)).toBe("+0.30000000000000004");
    expect(tableRows(container).at(-1)).toEqual(["Closing", "+0.30000000000000004"]);
    const withoutProvidedEnd = { ...input, end: { label: "Closing" } };
    expect(marks(input).map(mark => [mark.y, mark.height])).toEqual(
      marks(withoutProvidedEnd).map(mark => [mark.y, mark.height]),
    );
  });

  it("rejects a small explicit-end discrepancy beyond proportional roundoff", () => {
    expect(() => WaterfallChart({
      ...props,
      start: { label: "Opening", value: 0.1 },
      steps: [{ id: "a", label: "Added", value: 0.2 }],
      end: { label: "Closing", value: 0.300000000001 },
    })).toThrow(/end|total|mismatch/i);
  });

  it("does not turn large-magnitude roundoff tolerance into a business percentage", () => {
    expect(() => WaterfallChart({
      ...props,
      start: { label: "Opening", value: 1e12 },
      steps: [
        { id: "a", label: "First", value: 0.1 },
        { id: "b", label: "Second", value: -0.2 },
        { id: "c", label: "Third", value: 0.3 },
      ],
      end: { label: "Closing", value: 1e12 + 0.21 },
    })).toThrow(/end|total|mismatch/i);
  });

  it("uses no absolute-one floor when checking tiny accumulated values", () => {
    expect(() => WaterfallChart({
      ...props,
      start: { label: "Opening", value: 1e-20 },
      steps: [{ id: "a", label: "Added", value: 1e-20 }],
      end: { label: "Closing", value: 0 },
    })).toThrow(/end|total|mismatch/i);
  });

  it("requires exact explicit end equality when there were no additions", () => {
    expect(() => WaterfallChart({ ...props, steps: [], end: { label: "Closing", value: 100 } })).not.toThrow();
    // One representable step above 100 fits EPSILON*100 but must still fail:
    // no addition occurred, so a general nonzero tolerance is inappropriate.
    expect(() => WaterfallChart({
      ...props, steps: [], end: { label: "Closing", value: 100.00000000000001 },
    })).toThrow(/end|total|mismatch/i);
    expect(() => WaterfallChart({
      ...props, steps: [], start: { label: "Opening", value: 1e-20 }, end: { label: "Closing", value: 0 },
    })).toThrow(/end|total|mismatch/i);
    expect(() => WaterfallChart({
      ...props, steps: [], start: { label: "Opening", value: 0 }, end: { label: "Closing", value: Number.MIN_VALUE },
    })).toThrow(/end|total|mismatch/i);
  });

  it("accepts exact zero instead of manufacturing a nonzero tolerance", () => {
    expect(() => WaterfallChart({
      ...props, start: { label: "Opening", value: 0 },
      steps: [{ id: "zero", label: "Unchanged", value: 0 }], end: { label: "Closing", value: 0 },
    })).not.toThrow();
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite start value %s", value => {
    expect(() => WaterfallChart({ ...props, start: { label: "Opening", value } })).toThrow(/finite|number/i);
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite delta value %s", value => {
    expect(() => WaterfallChart({ ...props, steps: [{ id: "a", label: "Change", value }] })).toThrow(/finite|number/i);
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite explicit end value %s", value => {
    expect(() => WaterfallChart({ ...props, end: { label: "Closing", value } })).toThrow(/finite|number/i);
  });

  it("rejects an overflowing intermediate total even though every authored number is finite", () => {
    expect(() => WaterfallChart({
      ...props, start: { label: "Opening", value: Number.MAX_VALUE },
      steps: [{ id: "a", label: "Added", value: Number.MAX_VALUE }],
    })).toThrow(/finite|overflow|total/i);
  });

  it("rejects overflow in sum-absolute-addends even when every running total remains finite", () => {
    const value = Number.MAX_VALUE / 2;
    expect(() => WaterfallChart({
      ...props, start: { label: "Opening", value },
      steps: [
        { id: "a", label: "First", value: -value },
        { id: "b", label: "Second", value },
        { id: "c", label: "Third", value: -value },
      ],
      end: { label: "Closing", value: 0 },
    })).toThrow(/finite|overflow|tolerance|magnitude/i);
  });
});
