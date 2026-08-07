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
