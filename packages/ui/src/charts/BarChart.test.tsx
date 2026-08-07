import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarChart } from "./BarChart.js";
import { MAX_CATEGORICAL_SERIES } from "./internal/chart-vars.js";

describe("BarChart", () => {
  it("renders one <rect> per category for a single series", () => {
    const { container } = render(
      <BarChart title="Revenue" categories={["Jan", "Feb", "Mar"]} series={[{ name: "Revenue", values: [10, 20, 30] }]} />,
    );
    expect(container.querySelectorAll("rect").length).toBe(3);
  });

  it("renders category-count x series-count rects for multiple series (grouped bars)", () => {
    const { container } = render(
      <BarChart
        title="Revenue vs cost"
        categories={["Jan", "Feb"]}
        series={[
          { name: "Revenue", values: [10, 20] },
          { name: "Cost", values: [5, 8] },
        ]}
      />,
    );
    expect(container.querySelectorAll("rect").length).toBe(4);
  });

  it("the tallest bar's top touches the plot's top edge for a value equal to the domain maximum", () => {
    const { container } = render(<BarChart title="t" width={400} height={200} categories={["a", "b"]} series={[{ name: "s", values: [0, 100] }]} />);
    const rects = [...container.querySelectorAll("rect")];
    const tallest = rects.reduce((max, r) => (Number(r.getAttribute("height")) > Number(max.getAttribute("height")) ? r : max));
    // plot top = margin.top (16 by DEFAULT_MARGIN) when the value hits the domain max.
    expect(Number(tallest.getAttribute("y"))).toBeCloseTo(16, 0);
  });

  it("a zero-value bar has zero height and sits on the baseline", () => {
    const { container } = render(<BarChart title="t" width={400} height={200} categories={["a"]} series={[{ name: "s", values: [0] }]} />);
    const rect = container.querySelector("rect")!;
    expect(Number(rect.getAttribute("height"))).toBe(0);
  });

  it("caps bar thickness at 24px (marks-and-anatomy.md)", () => {
    const { container } = render(<BarChart title="t" width={2000} height={200} categories={["a"]} series={[{ name: "s", values: [1] }]} />);
    const rect = container.querySelector("rect")!;
    expect(Number(rect.getAttribute("width"))).toBeLessThanOrEqual(24);
  });

  it("renders no legend for a single series", () => {
    const { container } = render(<BarChart title="t" categories={["a"]} series={[{ name: "Revenue", values: [1] }]} />);
    expect(container.querySelector('[data-chart-part="legend"]')).not.toBeInTheDocument();
  });

  it("renders a legend for two or more series, and each rect keeps its series color regardless of value order (color follows the entity)", () => {
    const { container } = render(
      <BarChart
        title="t"
        categories={["a", "b"]}
        series={[
          { name: "Revenue", values: [1, 100] },
          { name: "Cost", values: [50, 2] },
        ]}
      />,
    );
    const legend = container.querySelector('[data-chart-part="legend"]')!;
    expect(legend).toBeInTheDocument();
    expect(legend.textContent).toContain("Revenue");
    expect(legend.textContent).toContain("Cost");
    const rects = [...container.querySelectorAll("rect")];
    const revenueFills = new Set(rects.filter((r) => r.getAttribute("aria-label")?.startsWith("Revenue")).map((r) => r.getAttribute("fill")));
    expect(revenueFills.size).toBe(1); // Revenue's own bars are always the same color, low or high value
  });

  it("exposes the same data via the table fallback", () => {
    render(<BarChart title="t" categories={["Jan", "Feb"]} series={[{ name: "Revenue", values: [10, 20] }]} />);
    expect(screen.getByRole("cell", { name: "Jan" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "20" })).toBeInTheDocument();
  });

  it("drops series past the 8th and warns, rather than cycling a 9th color", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const series = Array.from({ length: MAX_CATEGORICAL_SERIES + 1 }, (_, i) => ({ name: `s${i}`, values: [1] }));
    const { container } = render(<BarChart title="t" categories={["a"]} series={series} />);
    expect(container.querySelectorAll("rect").length).toBe(MAX_CATEGORICAL_SERIES);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("forwards className to the outer figure, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<BarChart title="t" categories={["a"]} series={[{ name: "s", values: [1] }]} className="gap-lg" />);
    const figure = container.querySelector("figure")!;
    expect(figure.className).toContain("gap-lg");
    expect(figure.className).not.toContain("gap-sm");
  });

  it("merges a consumer style object", () => {
    const { container } = render(<BarChart title="t" categories={["a"]} series={[{ name: "s", values: [1] }]} style={{ maxWidth: 500 }} />);
    expect(container.querySelector("figure")!.style.maxWidth).toBe("500px");
  });

  it("each bar carries an accessible name with its category and formatted value (per-mark hover/focus target)", () => {
    render(<BarChart title="t" categories={["Jan"]} series={[{ name: "Revenue", values: [1284] }]} />);
    expect(screen.getByRole("img", { name: "Revenue, Jan: 1,284" })).toBeInTheDocument();
  });

  it("with colorDomain supplied, a filtered-out series does not repaint the survivors (color follows the entity, never its rank)", () => {
    const domain = ["Revenue", "Cost", "Refunds"];
    const full = render(
      <BarChart
        title="t"
        categories={["a"]}
        colorDomain={domain}
        series={[
          { name: "Revenue", values: [1] },
          { name: "Cost", values: [2] },
          { name: "Refunds", values: [3] },
        ]}
      />,
    );
    const refundsColorBefore = full.container.querySelector('rect[aria-label^="Refunds"]')!.getAttribute("fill");
    full.unmount();

    // "Revenue" filtered out: "Refunds" is now at array position 0 instead of 2.
    const filtered = render(
      <BarChart
        title="t"
        categories={["a"]}
        colorDomain={domain}
        series={[
          { name: "Cost", values: [2] },
          { name: "Refunds", values: [3] },
        ]}
      />,
    );
    const refundsColorAfter = filtered.container.querySelector('rect[aria-label^="Refunds"]')!.getAttribute("fill");
    expect(refundsColorAfter).toBe(refundsColorBefore);
  });
});
