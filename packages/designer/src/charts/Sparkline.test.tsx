import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./Sparkline.js";

describe("Sparkline", () => {
  it("renders an accessible SVG named after the title prop", () => {
    render(<Sparkline title="7-day active users trend" values={[1, 2, 3]} />);
    expect(screen.getByRole("img", { name: "7-day active users trend" })).toBeInTheDocument();
  });

  it("renders no axes, grid, or legend chrome", () => {
    const { container } = render(<Sparkline title="t" values={[1, 2, 3]} />);
    expect(container.querySelector('[data-chart-part="grid"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-chart-part="axis"]')).not.toBeInTheDocument();
    expect(container.querySelector("ul")).not.toBeInTheDocument();
  });

  it("the path's first point sits at the domain-minimum x and the last at the domain-maximum x", () => {
    const { container } = render(<Sparkline title="t" width={120} values={[5, 5, 5, 5]} />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    const points = d.split(" ");
    const firstX = Number(points[0]!.slice(1).split(",")[0]);
    const lastX = Number(points[points.length - 1]!.slice(1).split(",")[0]);
    expect(firstX).toBeCloseTo(2, 0); // padding
    expect(lastX).toBeCloseTo(118, 0); // width - padding
  });

  it("a flat series (all equal values) still renders without producing NaN coordinates", () => {
    const { container } = render(<Sparkline title="t" values={[5, 5, 5]} />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    expect(d).not.toContain("NaN");
  });

  it("still exposes a table-view fallback, even though it has no other chrome", () => {
    render(<Sparkline title="t" values={[10, 20, 30]} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "30" })).toBeInTheDocument();
  });

  it("has no hover/keyboard interaction layer (the one documented exception in this chart layer)", () => {
    const { container } = render(<Sparkline title="t" values={[1, 2, 3]} />);
    expect(container.querySelector('[data-chart-part="hover-overlay"]')).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).not.toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Sparkline title="t" values={[1, 2, 3]} className="gap-lg" />);
    const wrapper = container.querySelector("span")!;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("merges a consumer style object", () => {
    const { container } = render(<Sparkline title="t" values={[1, 2, 3]} style={{ opacity: 0.5 }} />);
    expect(container.querySelector("span")!.style.opacity).toBe("0.5");
  });
});

describe("Sparkline optional parts", () => {
  it("draws a zero baseline and min/max range labels only when axes is set", () => {
    const { container } = render(<Sparkline title="t" values={[-2, 4, 9]} axes valueFormat={(v) => `${v}%`} />);
    const axis = container.querySelector('[data-chart-part="axis"] line')!;
    expect(axis).toBeInTheDocument();
    expect(axis.getAttribute("y1")).toBe(axis.getAttribute("y2"));
    const labels = Array.from(container.querySelectorAll('[data-chart-part="ticks"] text')).map((t) => t.textContent);
    expect(labels).toEqual(["9%", "-2%"]);
    const path = container.querySelector('path[fill="none"]')!.getAttribute("d")!;
    // marks move right of the label gutter so the labels never overlap the line
    expect(Number(path.split(" ")[0]!.slice(1).split(",")[0])).toBeGreaterThan(2);
    // the zero baseline sits between the max and min label rows
    const ys = Array.from(container.querySelectorAll('[data-chart-part="ticks"] text')).map((t) => Number(t.getAttribute("y")));
    expect(Number(axis.getAttribute("y1"))).toBeGreaterThan(ys[0]!);
    expect(Number(axis.getAttribute("y1"))).toBeLessThan(ys[1]!);
  });

  it("renders a single-series legend naming the series only when a legend label is given", () => {
    const { container, rerender } = render(<Sparkline title="t" values={[1, 2]} />);
    expect(container.querySelector('[data-chart-part="legend"]')).not.toBeInTheDocument();
    rerender(<Sparkline title="t" values={[1, 2]} legend="Active users" color="var(--chart-cat-2)" />);
    const legend = screen.getByRole("list");
    expect(legend).toHaveAttribute("data-chart-part", "legend");
    expect(screen.getByRole("listitem")).toHaveTextContent("Active users");
    const swatch = legend.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("var(--chart-cat-2)");
  });

  it("exposes one keyboard-focusable tooltip per point when tooltip is set, labelled with its position and formatted value", () => {
    render(<Sparkline title="Weekly signups" values={[3, 1200]} tooltip valueColumnLabel="Signups" />);
    const group = screen.getByRole("group", { name: "Weekly signups" });
    const points = screen.getAllByRole("img", { name: /Signups/ });
    expect(points.map((p) => p.getAttribute("aria-label"))).toEqual(["1. Signups: 3", "2. Signups: 1,200"]);
    for (const point of points) {
      expect(group).toContainElement(point);
      expect(point).toHaveAttribute("tabindex", "0");
      expect(point.querySelector('[data-chart-part="tooltip"]')).toBeInTheDocument();
    }
    // the hover/focus reveal rule ships with the part, and the overlay may overflow the tiny plot
    expect(group.querySelector("style")!.textContent).toContain("[data-chart-tooltip-trigger]:focus");
    expect(group.getAttribute("overflow")).toBe("visible");
  });

  it("keeps the non-interactive img role and no tab stops when tooltip is off", () => {
    const { container } = render(<Sparkline title="t" values={[1, 2]} axes legend="x" />);
    expect(screen.getByRole("img", { name: "t" })).toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).not.toBeInTheDocument();
    expect(container.querySelector("svg")!.getAttribute("overflow")).toBeNull();
  });
});
