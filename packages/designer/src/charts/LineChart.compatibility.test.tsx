import { renderToStaticMarkup } from "react-dom/server";
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
  it.each(Object.entries(fixtures))("preserves %s published HTML", (_name, props) => {
    expect(renderToStaticMarkup(<LineChart {...props} />)).toMatchSnapshot();
  });
});
