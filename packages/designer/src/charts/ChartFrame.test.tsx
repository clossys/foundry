import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartFrame } from "./ChartFrame.js";

const TABLE = { headers: ["X", "Y"], rows: [["a", 1], ["b", 2]] };

describe("ChartFrame", () => {
  it("renders an accessible SVG whose <title> matches the title prop", () => {
    render(
      <ChartFrame title="Monthly signups" table={TABLE}>
        {() => null}
      </ChartFrame>,
    );
    const svg = screen.getByRole("img", { name: "Monthly signups" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("renders a <desc> when description is provided, referenced by aria-describedby", () => {
    render(
      <ChartFrame title="Signups" description="Count of new signups per month" table={TABLE}>
        {() => null}
      </ChartFrame>,
    );
    const svg = screen.getByRole("img", { name: "Signups" });
    const describedBy = svg.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Count of new signups per month");
  });

  it("passes the resolved plot rectangle to its children render prop", () => {
    let received: { x: number; y: number; width: number; height: number } | null = null;
    render(
      <ChartFrame title="t" width={400} height={200} margin={{ top: 10, right: 10, bottom: 20, left: 30 }} table={TABLE}>
        {(plot) => {
          received = plot;
          return null;
        }}
      </ChartFrame>,
    );
    expect(received).toEqual({ x: 30, y: 10, width: 360, height: 170 });
  });

  it("renders no legend for zero or one series (the title already names a single series)", () => {
    render(
      <ChartFrame title="t" table={TABLE} legend={[{ label: "Revenue", color: "#2a78d6" }]}>
        {() => null}
      </ChartFrame>,
    );
    expect(screen.queryByText("Revenue")).not.toBeInTheDocument();
  });

  it("renders a legend for two or more series", () => {
    render(
      <ChartFrame
        title="t"
        table={TABLE}
        legend={[
          { label: "Revenue", color: "#2a78d6" },
          { label: "Cost", color: "#eb6834" },
        ]}
      >
        {() => null}
      </ChartFrame>,
    );
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
  });

  it("exposes the same data as an ordinary HTML table (the accessibility fallback)", () => {
    render(
      <ChartFrame title="t" table={{ headers: ["Month", "Signups"], rows: [["Jan", 12], ["Feb", 18]] }}>
        {() => null}
      </ChartFrame>,
    );
    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Signups" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Jan" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "18" })).toBeInTheDocument();
  });

  it("draws exactly one axis baseline (never a second/dual y-axis)", () => {
    const { container } = render(
      <ChartFrame title="t" table={TABLE}>
        {() => null}
      </ChartFrame>,
    );
    const axisGroup = container.querySelector('[data-chart-part="axis"]');
    expect(axisGroup?.querySelectorAll("line").length).toBe(1);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <ChartFrame title="t" table={TABLE} className="gap-lg">
        {() => null}
      </ChartFrame>,
    );
    const figure = container.querySelector("figure")!;
    expect(figure.className).toContain("gap-lg");
    expect(figure.className).not.toContain("gap-sm");
  });

  it("merges a consumer style object onto the <figure>", () => {
    const { container } = render(
      <ChartFrame title="t" table={TABLE} style={{ maxWidth: 600 }}>
        {() => null}
      </ChartFrame>,
    );
    const figure = container.querySelector("figure")!;
    expect(figure.style.maxWidth).toBe("600px");
  });
});
