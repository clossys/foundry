import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartFrame } from "./ChartFrame.js";

const table = { headers: ["Period", "Count"], rows: [["First", 12]] };

describe("ChartFrame fit", () => {
  it("preserves the published fixed dimensions, accessible names and table", () => {
    const { container } = render(
      <ChartFrame title="Sample counts" description="Count by period" table={table}>
        {() => <rect x={48} y={16} width={12} height={24} />}
      </ChartFrame>,
    );
    const svg = container.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual(["480", "280", "0 0 480 280"]);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")!.id);
    expect(svg.getAttribute("aria-describedby")).toBe(svg.querySelector("desc")!.id);
    expect(svg.querySelector("title")!.textContent).toBe("Sample counts");
    expect(svg.querySelector("desc")!.textContent).toBe("Count by period");
    expect(svg.querySelector("rect")!.outerHTML).toBe('<rect x="48" y="16" width="12" height="24"></rect>');
    expect(container.querySelector("summary")!.textContent).toBe("View as table");
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual(table.headers);
    expect(Array.from(container.querySelectorAll("tbody td"), cell => cell.textContent)).toEqual(["First", "12"]);
  });

  it("scales the intrinsic plot fluidly and caps it at 1.5 times its width", () => {
    const { container } = render(
      <ChartFrame title="Sample counts" table={table} width={360} height={240} fit="fluid" yTicks={[{ position: 32, label: "12" }]}>
        {(plot) => <rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} />}
      </ChartFrame>,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 240");
    expect(svg.style.maxWidth).toBe("540px");
    expect(svg.style.height).toBe("auto");
    expect(container.querySelector('[data-chart-part="ticks"]')!.getAttribute("fill")).toBe("var(--color-ink-secondary, oklch(0.36 0 0))");
    expect(container.querySelector("rect")!.getAttribute("width")).toBe("296");
    expect(container.querySelector('[data-chart-part="axis"] line')!.getAttribute("stroke-width")).toBe("var(--ui-border-hairline, 1px)");
    expect(container.querySelector('[data-chart-part="grid"] line')!.getAttribute("stroke-width")).toBe("var(--ui-border-hairline, 1px)");
  });

  it("can show the single-series legend without requiring the title to repeat its name", () => {
    const { container } = render(<ChartFrame title="Sample counts" table={table} showSingleSeriesLegend legend={[{label: "Group A", color: "var(--color-chart-categorical-2, #eb6834)"}]}>{() => null}</ChartFrame>);
    expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toBe("Group A");
  });

  it("keeps a caller's intrinsic width and outer style", () => {
    const { container } = render(
      <ChartFrame title="Sample counts" table={table} width={400} fit="fluid" style={{ maxWidth: 500 }}>
        {() => null}
      </ChartFrame>,
    );
    expect(container.querySelector("svg")!.style.maxWidth).toBe("600px");
    expect(container.querySelector("figure")!.style.maxWidth).toBe("500px");
  });

  it("makes explicit fixed fitting identical to the omitted option", () => {
    const implicit = renderToStaticMarkup(<ChartFrame title="Sample counts" table={table}>{() => null}</ChartFrame>);
    const explicit = renderToStaticMarkup(<ChartFrame title="Sample counts" table={table} fit="fixed">{() => null}</ChartFrame>);
    expect(explicit).toBe(implicit);
  });

  it("keeps the frame's published intrinsic default in fluid mode", () => {
    const { container } = render(
      <ChartFrame title="Sample counts" table={table} fit="fluid">{() => null}</ChartFrame>,
    );
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 480 280");
    expect(container.querySelector("svg")!.style.maxWidth).toBe("720px");
  });
});
