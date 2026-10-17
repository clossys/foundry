import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { BarChart } from "./BarChart.js";
import { BarChart as ServerBarChart } from "./server.js";

const props = {
  title: "Sample counts",
  description: "Counts by period",
  categories: ["First", "Next"],
  series: [{ name: "Group A", values: [10, -2] }, { name: "Group B", values: [4, 6] }],
};
const sourceDir = dirname(fileURLToPath(import.meta.url));

function rectProps(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(rectProps);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return node.type === "rect" ? [node.props] : rectProps(node.props.children);
}

describe("server-safe BarChart", () => {
  it("keeps the published fixed default structure and corners", () => {
    const { container } = render(<BarChart {...props} />);
    const svg = container.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual(["480", "280", "0 0 480 280"]);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")!.id);
    expect(svg.getAttribute("aria-describedby")).toBe(svg.querySelector("desc")!.id);
    expect(svg.querySelector("title")!.textContent).toBe(props.title);
    expect(svg.querySelector("desc")!.textContent).toBe(props.description);
    expect(container.querySelectorAll("rect")).toHaveLength(4);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual(["Category", "Group A", "Group B"]);
    expect(Array.from(container.querySelectorAll("tbody tr"), row => Array.from(row.querySelectorAll("td"), cell => cell.textContent))).toEqual([["First", "10", "4"], ["Next", "-2", "6"]]);
    expect(container.querySelector("summary")!.textContent).toBe("View as table");
    for (const rect of container.querySelectorAll("rect")) {
      expect(rect.getAttribute("rx")).toBe("4");
      expect(rect.getAttribute("tabindex")).toBe("0");
    }
  });

  it("uses token corners on the new static path without focus targets or handlers", () => {
    const chart = BarChart({ ...props, marks: "static" });
    const marks = rectProps(chart.props.children({ x: 48, y: 16, width: 296, height: 192 }));
    expect(marks).toHaveLength(4);
    for (const mark of marks) {
      expect(mark.tabIndex).toBeUndefined();
      expect(mark["aria-hidden"]).toBe(true);
      expect(mark.style).toEqual({ rx: "var(--radius-subtle, 2px)" });
      expect(Object.entries(mark).filter(([name, value]) => /^on[A-Z]/.test(name) && value !== undefined)).toEqual([]);
    }
    const { container } = render(<BarChart {...props} marks="static" />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("tbody")!.textContent).toContain("-2");
  });

  it("renders the combined fluid static path with a visible legend and complete no-JS table", () => {
    const { container, getByText } = render(<ServerBarChart {...props} fit="fluid" marks="static" tableFallbackLabel="Data table" categoryColumnLabel="Period" />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("100%");
    expect(container.querySelectorAll("rect[tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll('[data-chart-part="ticks"]')[1]!.getAttribute("fill")).toBe("var(--color-ink-secondary, oklch(0.36 0 0))");
    expect(getByText("Data table").tagName).toBe("SUMMARY");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("tbody")!.textContent).toContain("10");
    expect(container.querySelector("tbody")!.textContent).toContain("-2");
    for (const series of props.series) expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain(series.name);
  });

  it.each([1, 2, 8])("keeps readable series names and every table value for %i static series", count => {
    const series = Array.from({length: count}, (_, i) => ({name: `Group ${i + 1}`, values: [10 + i, -2 - i]}));
    const colorDomain = count === 8 ? series.map(item => item.name) : ["Other", ...series.map(item => item.name)];
    const title = "Sample counts";
    const { container } = render(<ServerBarChart {...props} title={title} series={series} colorDomain={colorDomain} fit="fluid" marks="static" tableFallbackLabel="Data table" categoryColumnLabel="Period" />);
    expect(container.querySelector("summary")!.textContent).toBe("Data table");
    expect(container.querySelectorAll("rect[tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll("thead th")).toHaveLength(count + 1);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual(["Period", ...series.map(item => item.name)]);
    expect(Array.from(container.querySelectorAll("tbody tr"), row => Array.from(row.querySelectorAll("th, td"), cell => cell.textContent))).toEqual(props.categories.map((category, index) => [category, ...series.map(item => String(item.values[index]))]));
    const marks = Array.from(container.querySelectorAll("rect"));
    expect(marks).toHaveLength(count * props.categories.length);
    for (const [index, item] of series.entries()) {
      for (const mark of marks.filter((_, markIndex) => markIndex % count === index)) expect(mark.getAttribute("fill")).toContain(`--color-chart-categorical-${count === 8 ? index + 1 : index + 2}`);
      expect(container.querySelector("thead")!.textContent).toContain(item.name);
      for (const value of item.values) expect(container.querySelector("tbody")!.textContent).toContain(String(value));
      expect(container.querySelector('[data-chart-part="legend"]')!.textContent).toContain(item.name);
    }
  });

  it("keeps fluid table headers available when narrow layouts stack the data cells", () => {
    const { container } = render(<BarChart {...props} fit="fluid" marks="static" categoryColumnLabel="Period" />);
    const table = container.querySelector("table")!;
    expect(table.getAttribute("role")).toBe("table");
    expect(Array.from(table.querySelectorAll("thead th"), cell => cell.getAttribute("role"))).toEqual(["columnheader", "columnheader", "columnheader"]);
    expect(Array.from(table.querySelectorAll("tbody tr"), row => row.getAttribute("role"))).toEqual(["row", "row"]);
    expect(Array.from(table.querySelectorAll("tbody td"), cell => cell.getAttribute("data-column-label"))).toEqual(["Period", "Group A", "Group B", "Period", "Group A", "Group B"]);
    expect(Array.from(table.querySelectorAll("tbody td"), cell => cell.getAttribute("role"))).toEqual(Array(6).fill("cell"));
  });

  it("makes explicit fixed interactive options identical to the omitted options", () => {
    expect(renderToStaticMarkup(<BarChart {...props} fit="fixed" marks="interactive" />)).toBe(
      renderToStaticMarkup(<BarChart {...props} />),
    );
  });

  it("forwards authored fluid dimensions", () => {
    const { container } = render(<BarChart {...props} fit="fluid" width={400} height={240} />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 400 240");
    expect(container.querySelector("svg")!.style.maxWidth).toBe("600px");
  });

  it("uses the fluid geometry and token corners without changing mark interactivity", () => {
    const { container } = render(<BarChart {...props} fit="fluid" />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 360 280");
    expect(container.querySelector("svg")!.style.maxWidth).toBe("540px");
    const serializedMarks = renderToStaticMarkup(<BarChart {...props} fit="fluid" />).match(/<rect\b[^>]*>/g) ?? [];
    expect(serializedMarks).toHaveLength(4);
    for (const mark of serializedMarks) {
      expect(mark).toContain('style="rx:var(--radius-subtle, 2px)"');
      expect(mark).not.toContain('rx="4"');
    }
    for (const rect of container.querySelectorAll("rect")) {
      expect(rect.getAttribute("tabindex")).toBe("0");
    }
  });

  it("resolves the real compiled component and server barrel under react-server", () => {
    const component = resolve(sourceDir, "../../dist/charts/BarChart.js");
    const barrel = resolve(sourceDir, "../../dist/charts/server.js");
    const script = `const [component, barrel, serializedProps] = process.argv.slice(1); const props = JSON.parse(serializedProps); const a = await import(component); const b = await import(barrel); if (a.BarChart !== b.BarChart) throw new Error("missing server export"); function rects(n) { if (Array.isArray(n)) return n.flatMap(rects); if (!n || !n.props) return []; return n.type === "rect" ? [n.props] : rects(n.props.children); } for (const mode of ["interactive", "static"]) { const element = a.BarChart({ ...props, marks: mode }); const marks = rects(element.props.children({ x: 48, y: 16, width: 296, height: 192 })); if (marks.length !== 4) throw new Error("missing marks"); if (marks.some(m => Object.entries(m).some(([k,v]) => /^on[A-Z]/.test(k) && v !== undefined))) throw new Error("client handler"); if (mode === "static" && marks.some(m => m.tabIndex !== undefined || m.style.rx !== "var(--radius-subtle, 2px)")) throw new Error("static mark contract"); } process.stdout.write("OK");`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script, component, barrel, JSON.stringify(props)], { encoding: "utf8", timeout: 10_000 }).trim()).toBe("OK");
  });

  it("keeps hover and focus feedback in CSS without motion", () => {
    const css = readFileSync(resolve(sourceDir, "../../styles/theme-keys.css"), "utf8");
    const feedback = css.match(/\[data-chart-part="cluster"\] rect\[tabindex="0"\]:hover[\s\S]*?\{([^}]+)\}/)?.[1];
    expect(feedback).toBeDefined();
    expect(css).toContain('[data-chart-part="cluster"] rect[tabindex="0"]:focus');
    expect(feedback).toContain("stroke-width: var(--ui-border-rule, 2px)");
    expect(feedback).not.toMatch(/transition|animation/);
  });
});
