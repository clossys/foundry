import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LineChart } from "./LineChart.js";
import { MAX_CATEGORICAL_SERIES } from "./internal/chart-vars.js";

describe("LineChart", () => {
  it("renders one <path> per series", () => {
    const { container } = render(
      <LineChart
        title="t"
        x={[0, 1, 2]}
        series={[
          { name: "A", values: [1, 2, 3] },
          { name: "B", values: [3, 2, 1] },
        ]}
      />,
    );
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("the path's first point sits at the domain-minimum x and the path's last point sits at the domain-maximum x", () => {
    const { container } = render(<LineChart title="t" width={400} height={200} x={[0, 10]} series={[{ name: "A", values: [1, 2] }]} />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    const [firstCmd, secondCmd] = d.split(" ");
    const firstX = Number(firstCmd!.slice(1).split(",")[0]);
    const secondX = Number(secondCmd!.slice(1).split(",")[0]);
    // plot x = margin.left (48 by DEFAULT_MARGIN); plot right = width - margin.right (400-16=384).
    expect(firstX).toBeCloseTo(48, 0);
    expect(secondX).toBeCloseTo(384, 0);
  });

  it("a value equal to the y-domain maximum places its point at the plot's top edge", () => {
    const { container } = render(<LineChart title="t" width={400} height={200} x={[0, 1]} series={[{ name: "A", values: [0, 100] }]} />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    const lastY = Number(d.split(" ")[1]!.slice(1).split(",")[1]);
    expect(lastY).toBeCloseTo(16, 0); // margin.top
  });

  it("renders no legend for a single series", () => {
    const { container } = render(<LineChart title="t" x={[0, 1]} series={[{ name: "Revenue", values: [1, 2] }]} />);
    expect(container.querySelector('[data-chart-part="legend"]')).not.toBeInTheDocument();
  });

  it("renders a legend for two or more series", () => {
    const { container } = render(
      <LineChart
        title="t"
        x={[0, 1]}
        series={[
          { name: "Revenue", values: [1, 2] },
          { name: "Cost", values: [2, 1] },
        ]}
      />,
    );
    const legend = container.querySelector('[data-chart-part="legend"]')!;
    expect(legend).toBeInTheDocument();
    expect(legend.textContent).toContain("Revenue");
    expect(legend.textContent).toContain("Cost");
  });

  it("exposes the same data via the table fallback", () => {
    render(<LineChart title="t" x={[0, 1]} series={[{ name: "Revenue", values: [10, 20] }]} />);
    expect(screen.getByRole("cell", { name: "20" })).toBeInTheDocument();
  });

  it("drops series past the 8th and warns, rather than cycling a 9th color", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const series = Array.from({ length: MAX_CATEGORICAL_SERIES + 1 }, (_, i) => ({ name: `s${i}`, values: [1, 2] }));
    const { container } = render(<LineChart title="t" x={[0, 1]} series={series} />);
    expect(container.querySelectorAll("path").length).toBe(MAX_CATEGORICAL_SERIES);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("shows the same crosshair/tooltip detail on keyboard focus as it would on hover", () => {
    const { container } = render(<LineChart title="t" x={[0, 1, 2]} series={[{ name: "Revenue", values: [1, 2, 3] }]} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    expect(container.querySelector('[data-chart-part="crosshair"]')).not.toBeInTheDocument();
    fireEvent.focus(overlay);
    expect(container.querySelector('[data-chart-part="crosshair"]')).toBeInTheDocument();
    fireEvent.keyDown(overlay, { key: "ArrowRight" });
    expect(container.querySelector('[data-chart-part="tooltip"]')?.textContent).toContain("2");
  });

  it("clears the crosshair on blur", () => {
    const { container } = render(<LineChart title="t" x={[0, 1]} series={[{ name: "Revenue", values: [1, 2] }]} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    fireEvent.focus(overlay);
    expect(container.querySelector('[data-chart-part="crosshair"]')).toBeInTheDocument();
    fireEvent.blur(overlay);
    expect(container.querySelector('[data-chart-part="crosshair"]')).not.toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<LineChart title="t" x={[0, 1]} series={[{ name: "s", values: [1, 2] }]} className="gap-lg" />);
    const figure = container.querySelector("figure")!;
    expect(figure.className).toContain("gap-lg");
    expect(figure.className).not.toContain("gap-sm");
  });

  it("merges a consumer style object", () => {
    const { container } = render(<LineChart title="t" x={[0, 1]} series={[{ name: "s", values: [1, 2] }]} style={{ maxWidth: 500 }} />);
    expect(container.querySelector("figure")!.style.maxWidth).toBe("500px");
  });

  it("accepts Date x-values and formats ticks as dates", () => {
    render(
      <LineChart
        title="t"
        x={[new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z")]}
        series={[{ name: "s", values: [1, 2] }]}
      />,
    );
    expect(screen.getByRole("cell", { name: /Jan/ })).toBeInTheDocument();
  });
});
