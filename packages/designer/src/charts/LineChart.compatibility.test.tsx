import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart, type LineChartProps } from "./LineChart.js";

const authored = {
  title: "Measured samples", description: "Three observations",
  xColumnLabel: "Period", tableFallbackLabel: "Measurements",
  keyboardHintLabel: "Inspect observations",
};
const numeric = {
  ...authored, x: [-10, 0, 10],
  series: [{ name: "Group A", values: [-2, 0, 6] }, { name: "Group B", values: [4, 2, -1] }],
  width: 400, height: 200, xFormat: String, valueFormat: String,
} satisfies LineChartProps;
const fixtures: Record<string, LineChartProps> = {
  numeric,
  defaults: { ...authored, x: [0, 1, 2], series: [{ name: "Group A", values: [1, 2, 3] }] },
  short: { ...numeric, series: [numeric.series[0]!, { name: "Group B", values: [4] }] },
  dates: {
    ...numeric, x: Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1, 12))),
    series: [{ name: "Group A", values: [1, 2, 3, 4, 5, 6, 7] }],
    xFormat: value => (value as Date).toISOString().slice(0, 10),
  },
};

describe("LineChart client compatibility", () => {
  it.each(Object.entries(fixtures))("preserves %s published structure and data", (_name, props) => {
    const { container } = render(<LineChart {...props} />);
    const svg = container.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual([
      String(props.width ?? 480), String(props.height ?? 280), `0 0 ${props.width ?? 480} ${props.height ?? 280}`,
    ]);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")!.id);
    expect(svg.getAttribute("aria-describedby")).toBe(svg.querySelector("desc")!.id);
    expect(svg.querySelector("title")!.textContent).toBe(props.title);
    expect(svg.querySelector("desc")!.textContent).toBe(props.description);
    expect(container.querySelectorAll('[data-chart-part="series"]')).toHaveLength(props.series.length);
    expect(container.querySelectorAll('[data-chart-part="series"] path')).toHaveLength(props.series.length);
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
    expect(svg.querySelector('[data-chart-part="hover-overlay"]')!.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("summary")!.textContent).toBe(props.tableFallbackLabel);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual([props.xColumnLabel, ...props.series.map(series => series.name)]);
    expect(Array.from(container.querySelectorAll("tbody tr"), row => Array.from(row.querySelectorAll("td"), cell => cell.textContent))).toEqual(
      props.x.map((x, index) => [props.xFormat?.(x) ?? String(x), ...props.series.map(series => String(series.values[index] ?? 0))]),
    );
  });
});
