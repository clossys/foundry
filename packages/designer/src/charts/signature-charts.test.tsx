import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, createElement, type ComponentType } from "react";
import * as charts from "./index.js";
import * as serverCharts from "./server.js";

// Namespace lookup deliberately runs assertions on the unchanged base:
// missing public components fail at runtime, not during module collection.
function component(name: string, server = false): ComponentType<any> {
  const value = (server ? serverCharts : charts) as Record<string, unknown>;
  expect(value[name], `${name} must be a public chart`).toBeTypeOf("function");
  return value[name] as ComponentType<any>;
}
const area = {
  title: "Volume",
  description: "Volume by period",
  x: ["Jan", "Feb", "Mar"],
  series: [
    { name: "First", values: [10, 20, 30] },
    { name: "Second", values: [30, 20, 10] },
  ],
  width: 400,
  height: 200,
};
const heat = {
  title: "Capacity",
  description: "Capacity by team",
  rows: ["East", "West"],
  columns: ["Mon", "Tue"],
  values: [
    [0, 100],
    [null, 50],
  ],
  width: 400,
  height: 200,
};
const strip = {
  title: "Uptime",
  description: "Service history",
  segments: [
    { from: 0, to: 10, status: "ok" },
    { from: 20, to: 40, status: "error" },
  ],
  domain: [0, 40],
  width: 400,
  height: 100,
};
const cases = [
  ["AreaChart", area],
  ["Heatmap", heat],
  ["StatusStrip", strip],
] as const;
function plot(name: string, props: object) {
  return render(createElement(component(name), props));
}
function rows(root: HTMLElement) {
  return [...root.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  );
}
function withoutIds(html: string) {
  return html.replace(/«[^»]+»|_R_[^"\s]+/g, "ID");
}

describe("signature chart common contract", () => {
  it.each(cases)("%s honors translated empty/loading copy", (name, props) => {
    const labels = { loading: "Chargement", empty: "Aucune donnée", missing: "Absent" };
    const { container } = plot(name, { ...props, loading: true, labels });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Chargement");
  });
  it("uses the same missing-value and accessible-name overrides throughout inspection and table data", () => {
    const { container } = plot("Heatmap", { ...heat, activeIndex: 2, labels: { missing: "Absent", rowColumn: "Équipe", scale: (min: string, max: string) => `${min} à ${max}` } });
    expect(container.querySelector('[data-chart-part="readout"]')?.textContent).toBe("West, Mon, Absent");
    expect(rows(container)[1]).toEqual(["West", "Absent", "50"]);
    expect(container.querySelector("th")?.textContent).toBe("Équipe");
    expect(container.querySelector('[aria-label="0 à 100"]')).not.toBeNull();
  });
  it.each(cases)(
    "%s exposes accessible title, description and table fallback",
    (name, props) => {
      const { container } = plot(name, props);
      expect(container.querySelector("figcaption")?.textContent).toBe(
        props.title,
      );
      expect(container.querySelector("svg title")?.textContent).toBe(
        props.title,
      );
      expect(container.querySelector("svg desc")?.textContent).toBe(
        props.description,
      );
      expect(container.querySelector("summary")?.textContent).toBe(
        "View as table",
      );
      expect(
        container.querySelector("svg")?.getAttribute("aria-labelledby"),
      ).toBeTruthy();
    },
  );
  it.each(cases)(
    "%s shares deterministic marks and table data with the static server variant",
    (name, props) => {
      const client = renderToStaticMarkup(
        createElement(component(name), props),
      );
      const server = renderToStaticMarkup(
        createElement(component(name, true), props),
      );
      const clientNode = document.createElement("div"),
        serverNode = document.createElement("div");
      clientNode.innerHTML = client;
      serverNode.innerHTML = server;
      expect(rows(serverNode)).toEqual(rows(clientNode));
      expect(
        [
          ...serverNode.querySelectorAll(
            'path[data-chart-part="area"], rect[data-chart-part="cell"], rect[data-chart-part="segment"]',
          ),
        ].map((node) => [
          node.getAttribute("d"),
          node.getAttribute("x"),
          node.getAttribute("y"),
          node.getAttribute("width"),
          node.getAttribute("height"),
          withoutIds(node.getAttribute("fill") ?? ""),
        ]),
      ).toEqual(
        [
          ...clientNode.querySelectorAll(
            'path[data-chart-part="area"], rect[data-chart-part="cell"], rect[data-chart-part="segment"]',
          ),
        ].map((node) => [
          node.getAttribute("d"),
          node.getAttribute("x"),
          node.getAttribute("y"),
          node.getAttribute("width"),
          node.getAttribute("height"),
          withoutIds(node.getAttribute("fill") ?? ""),
        ]),
      );
      expect(
        serverNode.querySelectorAll(
          'button, [tabindex], [role="button"], [role="gridcell"]',
        ),
      ).toHaveLength(0);
      expect(
        withoutIds(renderToStaticMarkup(createElement(component(name), props))),
      ).toBe(withoutIds(client));
    },
  );
  it.each(cases)(
    "%s hydrates its exact SSR markup without errors and preserves client initial output",
    async (name, props) => {
      const element = createElement(component(name), props);
      const host = document.createElement("div"),
        recover = vi.fn();
      host.innerHTML = renderToString(element);
      document.body.append(host);
      const before = host.innerHTML;
      let root: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(host, element, { onRecoverableError: recover });
      });
      expect(recover).not.toHaveBeenCalled();
      expect(host.innerHTML).toBe(before);
      await act(async () => root!.unmount());
      host.remove();
    },
  );
  it.each(cases)(
    "%s exposes interactive descendants through a named SVG group",
    (name, props) => {
      const { container } = plot(name, props);
      expect(container.querySelector("svg")?.getAttribute("role")).toBe(
        "group",
      );
    },
  );
  it.each(cases)(
    "%s renders loading state without presenting stale marks",
    (name, props) => {
      const { container } = plot(name, { ...props, loading: true });
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Loading data",
      );
      expect(
        container.querySelectorAll(
          '[data-chart-part="area"], [role="gridcell"], [data-chart-part="segment"]',
        ),
      ).toHaveLength(0);
    },
  );
  it.each([
    ["AreaChart", { x: [], series: [] }],
    ["Heatmap", { rows: [], columns: [], values: [] }],
    ["StatusStrip", { segments: [] }],
  ])("%s exposes an empty state", (name, data) => {
    const { container } = plot(name as string, {
      title: "Empty",
      ...(data as object),
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "No data",
    );
    expect(container.querySelector("table")).not.toBeNull();
  });
  it("imports and invokes each emitted server chart under the real react-server condition", () => {
    const entry = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../dist/charts/server.js",
    );
    const fixtures = [
      { ...area, name: "AreaChart" },
      { ...heat, name: "Heatmap" },
      { ...strip, name: "StatusStrip" },
    ];
    const script = `import * as charts from ${JSON.stringify(entry)}; for (const {name,...props} of ${JSON.stringify(fixtures)}) { if(typeof charts[name]!=="function") throw new Error(name); const result=charts[name](props); if(!result) throw new Error(name+" empty"); } process.stdout.write("OK");`;
    expect(
      execFileSync(
        process.execPath,
        ["--conditions=react-server", "--input-type=module", "-e", script],
        { encoding: "utf8" },
      ),
    ).toBe("OK");
  });
});

describe("AreaChart", () => {
  it("keeps all source data in the table including null, never converting a gap to zero", () => {
    const { container } = plot("AreaChart", {
      ...area,
      series: [{ name: "First", values: [10, null, 30] }],
    });
    expect(rows(container)).toEqual([
      ["Jan", "10"],
      ["Feb", "No data"],
      ["Mar", "30"],
    ]);
    const paths = [...container.querySelectorAll('[data-chart-part="area"]')];
    expect(paths).toHaveLength(2);
    expect(
      paths.map((path) => path.getAttribute("d")?.match(/M/g)?.length),
    ).toEqual([1, 1]);
    expect(
      paths.every((path) => !path.getAttribute("d")?.includes("216")),
    ).toBe(true);
  });
  it("stacks in authored series order, with exact cumulative boundaries", () => {
    const { container } = plot("AreaChart", { ...area, stacked: true });
    const paths = [...container.querySelectorAll('[data-chart-part="area"]')];
    expect(paths.map((path) => path.getAttribute("data-series"))).toEqual([
      "First",
      "Second",
    ]);
    // plot y=[16,168], total=40: first top=130,92,54;
    // second top=16,16,16 and its baseline follows the first.
    expect(paths[0]?.getAttribute("d")).toBe(
      "M48,130 L216,92 L384,54 L384,168 L216,168 L48,168 Z",
    );
    expect(paths[1]?.getAttribute("d")).toBe(
      "M48,16 L216,16 L384,16 L384,54 L216,92 L48,130 Z",
    );
  });
  it("normalizes each column to 100 percent and labels the scale as percentages", () => {
    const { container } = plot("AreaChart", { ...area, normalized: true });
    const paths = [...container.querySelectorAll('[data-chart-part="area"]')];
    expect(paths[0]?.getAttribute("d")).toBe(
      "M48,130 L216,92 L384,54 L384,168 L216,168 L48,168 Z",
    );
    expect(
      paths[1]?.getAttribute("d")?.startsWith("M48,16 L216,16 L384,16"),
    ).toBe(true);
    expect(
      container.querySelector('[data-chart-part="ticks"]')?.textContent,
    ).toContain("100%");
    expect(rows(container)[0]).toEqual(["Jan", "10", "30"]);
  });
  it("handles zero normalized columns and all-null series without NaN or invented zero marks", () => {
    const { container } = plot("AreaChart", {
      ...area,
      normalized: true,
      series: [
        { name: "Zero", values: [0, 0, 0] },
        { name: "Missing", values: [null, null, null] },
      ],
    });
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(
      container.querySelectorAll(
        '[data-series="Missing"][data-chart-part="area"]',
      ),
    ).toHaveLength(0);
  });
  it("supports one time series with a continuous time scale and optional smoothing", () => {
    const { container, rerender } = plot("AreaChart", {
      ...area,
      x: [new Date(0), new Date(10), new Date(40)],
      series: [area.series[0]],
      smooth: false,
    });
    expect(
      container.querySelector('[data-chart-part="area"]')?.getAttribute("d"),
    ).toContain("L132,");
    expect(
      container.querySelector('[data-chart-part="area"]')?.getAttribute("d"),
    ).not.toContain("C");
    rerender(createElement(component("AreaChart"), { ...area, smooth: true }));
    expect(
      container.querySelector('[data-chart-part="area"]')?.getAttribute("d"),
    ).toContain("C");
  });
  it("toggles series without losing table data or changing remaining series identity", () => {
    const { container, getByRole } = plot("AreaChart", {
      ...area,
      stacked: true,
    });
    const color = container
      .querySelector('[data-series="Second"]')
      ?.getAttribute("fill");
    fireEvent.click(getByRole("button", { name: "First" }));
    expect(
      getByRole("button", { name: "First" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(container.querySelector('[data-series="First"]')).toBeNull();
    expect(
      container.querySelector('[data-series="Second"]')?.getAttribute("fill"),
    ).toBe(color);
    expect(rows(container)[0]).toEqual(["Jan", "10", "30"]);
    fireEvent.click(getByRole("button", { name: "First" }));
    expect(container.querySelector('[data-series="First"]')).not.toBeNull();
  });
  it("provides keyboard crosshair readout, null text and controlled hover/selection callbacks", () => {
    const onActiveIndexChange = vi.fn(),
      onSelectionChange = vi.fn();
    const props = {
      ...area,
      series: [{ name: "First", values: [10, null, 30] }],
      onActiveIndexChange,
      onSelectionChange,
    };
    const { container, rerender } = plot("AreaChart", props);
    const overlay = container.querySelector(
      '[data-chart-part="hover-overlay"]',
    )!;
    fireEvent.focus(overlay);
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("Jan: First 10");
    fireEvent.keyDown(overlay, { key: "ArrowRight" });
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("Feb: First No data");
    expect(
      container
        .querySelector('[data-chart-part="crosshair"]')
        ?.getAttribute("x1"),
    ).toBe("216");
    fireEvent.keyDown(overlay, { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(1);
    rerender(
      createElement(component("AreaChart"), {
        ...props,
        activeIndex: 2,
        selectedIndex: 0,
      }),
    );
    fireEvent.keyDown(overlay, { key: "ArrowLeft" });
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(1);
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("Mar: First 30");
    expect(overlay.getAttribute("aria-label")).toContain("Volume");
  });
  it("maps pointer coordinates through the actual SVG size", () => {
    const { container } = plot("AreaChart", area);
    vi.spyOn(
      container.querySelector("svg")!,
      "getBoundingClientRect",
    ).mockReturnValue({ left: 100, width: 800 } as DOMRect);
    const overlay = container.querySelector(
      '[data-chart-part="hover-overlay"]',
    )!;
    fireEvent(
      overlay,
      new MouseEvent("pointermove", { bubbles: true, clientX: 532 }),
    );
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toContain("Feb");
    fireEvent.pointerLeave(overlay);
    expect(container.querySelector('[data-chart-part="readout"]')).toBeNull();
  });
  it("honors controlled series visibility and reports changes", () => {
    const onHiddenSeriesChange = vi.fn();
    const { container, getByRole } = plot("AreaChart", {
      ...area,
      hiddenSeries: ["First"],
      onHiddenSeriesChange,
    });
    fireEvent.click(getByRole("button", { name: "First" }));
    expect(onHiddenSeriesChange).toHaveBeenCalledWith([]);
    expect(container.querySelector('[data-series="First"]')).toBeNull();
  });
  it("preserves earlier layers when a later series is missing, and draws signed unstacked values around zero", () => {
    const { container, rerender } = plot("AreaChart", {
      ...area,
      stacked: true,
      series: [
        { name: "First", values: [10, 10, 10] },
        { name: "Second", values: [20, null, 20] },
      ],
    });
    expect(container.querySelectorAll('[data-series="First"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-series="Second"]')).toHaveLength(
      2,
    );
    rerender(
      createElement(component("AreaChart"), {
        ...area,
        stacked: true,
        series: [
          { name: "First", values: [10, null, 10] },
          { name: "Second", values: [20, 20, 20] },
        ],
      }),
    );
    expect(container.querySelectorAll('[data-series="First"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-series="Second"]')).toHaveLength(
      1,
    );
    expect(
      container.querySelector('[data-series="Second"]')?.getAttribute("d"),
    ).toContain("L216,66.66666666666667");
    rerender(
      createElement(component("AreaChart"), {
        ...area,
        series: [{ name: "Signed", values: [-10, 0, 10] }],
      }),
    );
    expect(
      container.querySelector('[data-chart-part="area"]')?.getAttribute("d"),
    ).toBe("M48,168 L216,92 L384,16 L384,92 L216,92 L48,92 Z");
  });
  it("rejects invalid series length, nonfinite values, negative stacks and mixed x coordinates", () => {
    for (const props of [
      { ...area, series: [{ name: "Bad", values: [1] }] },
      { ...area, series: [{ name: "Bad", values: [1, NaN, 3] }] },
      { ...area, stacked: true, series: [{ name: "Bad", values: [1, -1, 3] }] },
      { ...area, x: ["A", 1, "B"] },
    ])
      expect(() =>
        renderToStaticMarkup(createElement(component("AreaChart"), props)),
      ).toThrow();
  });
});

describe("Heatmap", () => {
  it("maps min and max to the sequential ramp ends and displays every datum in the table", () => {
    const { container } = plot("Heatmap", heat);
    const cells = [...container.querySelectorAll('[role="gridcell"]')];
    expect(cells).toHaveLength(4);
    expect(cells[0]?.getAttribute("fill")).toContain(
      "--color-chart-sequential-100",
    );
    expect(cells[1]?.getAttribute("fill")).toContain(
      "--color-chart-sequential-700",
    );
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "East, Mon, 0",
      "East, Tue, 100",
      "West, Mon, No data",
      "West, Tue, 50",
    ]);
    expect(rows(container)).toEqual([
      ["East", "0", "100"],
      ["West", "No data", "50"],
    ]);
    expect(
      container.querySelectorAll('[data-chart-part="ramp-step"]'),
    ).toHaveLength(7);
  });
  it("uses categorical identity and labels rather than a sequential numeric ramp", () => {
    const { container } = plot("Heatmap", {
      ...heat,
      categorical: true,
      values: [
        ["Open", "Closed"],
        [null, "Open"],
      ],
    });
    const cells = [...container.querySelectorAll('[role="gridcell"]')];
    expect(cells[0]?.getAttribute("fill")).toBe(cells[3]?.getAttribute("fill"));
    expect(cells[0]?.getAttribute("fill")).not.toBe(
      cells[1]?.getAttribute("fill"),
    );
    expect(
      container.querySelector('[data-chart-part="categorical-legend"]')
        ?.textContent,
    ).toContain("Closed");
    expect(container.querySelector('[data-chart-part="ramp-step"]')).toBeNull();
  });
  it("navigates grid cells with arrows, clamps edges, displays value on focus and selects by keyboard", () => {
    const onActiveIndexChange = vi.fn(),
      onSelectionChange = vi.fn();
    const { container } = plot("Heatmap", {
      ...heat,
      onActiveIndexChange,
      onSelectionChange,
    });
    const cells = [...container.querySelectorAll('[role="gridcell"]')];
    fireEvent.focus(cells[0]!);
    fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.keyDown(cells[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cells[3]);
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("West, Tue, 50");
    fireEvent.keyDown(cells[3]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[3]);
    fireEvent.keyDown(cells[3]!, { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(3);
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(3);
  });
  it("keeps a controlled active cell until the host rerenders", () => {
    const onActiveIndexChange = vi.fn();
    const { container } = plot("Heatmap", {
      ...heat,
      activeIndex: 0,
      onActiveIndexChange,
    });
    fireEvent.pointerEnter(container.querySelectorAll('[role="gridcell"]')[1]!);
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("East, Mon, 0");
  });
  it("handles constant and all-null data without nonfinite colours or missing labels", () => {
    const { container, rerender } = plot("Heatmap", {
      ...heat,
      values: [
        [4, 4],
        [4, 4],
      ],
    });
    expect(
      [...container.querySelectorAll('[role="gridcell"]')].every((cell) =>
        cell.getAttribute("fill")?.includes("--color-chart-sequential-100"),
      ),
    ).toBe(true);
    rerender(
      createElement(component("Heatmap"), {
        ...heat,
        values: [
          [null, null],
          [null, null],
        ],
      }),
    );
    expect(
      [...container.querySelectorAll('[role="gridcell"]')].every((cell) =>
        cell.getAttribute("aria-label")?.includes("No data"),
      ),
    ).toBe(true);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("rejects ragged data and invalid sequential values", () => {
    for (const values of [
      [[1]],
      [
        [1, 2],
        [3, "bad"],
      ],
      [
        [1, Infinity],
        [3, 4],
      ],
    ]) {
      expect(() =>
        renderToStaticMarkup(
          createElement(component("Heatmap"), { ...heat, values }),
        ),
      ).toThrow();
    }
  });
});

describe("StatusStrip", () => {
  it("scales interval widths, inserts explicit unknown gaps and names every interval", () => {
    const { container } = plot("StatusStrip", strip);
    const segments = [
      ...container.querySelectorAll('[data-chart-part="segment"]'),
    ];
    expect(
      segments.map((segment) => Number(segment.getAttribute("width"))),
    ).toEqual([84, 84, 168]);
    expect(
      segments.map((segment) => segment.getAttribute("aria-label")),
    ).toEqual(["ok: 0–10", "unknown: 10–20", "error: 20–40"]);
    expect(rows(container)).toEqual([
      ["0", "10", "ok"],
      ["10", "20", "unknown"],
      ["20", "40", "error"],
    ]);
  });
  it("uses a visible label and unique pattern for every status including unknown", () => {
    const segments = ["ok", "warn", "error", "unknown"].map(
      (status, index) => ({ from: index, to: index + 1, status }),
    );
    const { container } = plot("StatusStrip", {
      ...strip,
      domain: [0, 4],
      segments,
    });
    expect(
      [...container.querySelectorAll('[data-chart-part="status-label"]')].map(
        (label) => label.textContent,
      ),
    ).toEqual(["ok", "warn", "error", "unknown"]);
    const fills = [
      ...container.querySelectorAll('[data-chart-part="segment"]'),
    ].map((segment) => segment.getAttribute("fill"));
    expect(fills.every((fill) => fill?.startsWith("url(#"))).toBe(true);
    expect(new Set(fills).size).toBe(4);
    expect(container.querySelectorAll("pattern")).toHaveLength(4);
  });
  it("handles leading and trailing unknown periods and time intervals", () => {
    const { container } = plot("StatusStrip", {
      ...strip,
      domain: [new Date(0), new Date(40)],
      segments: [{ from: new Date(10), to: new Date(20), status: "warn" }],
    });
    expect(
      container.querySelectorAll('[data-chart-part="segment"]'),
    ).toHaveLength(3);
    expect(rows(container).map((row) => row[2])).toEqual([
      "unknown",
      "warn",
      "unknown",
    ]);
  });
  it("exposes controlled inspection and selection without coupling to a table component", () => {
    const onActiveIndexChange = vi.fn(),
      onSelectionChange = vi.fn();
    const { container } = plot("StatusStrip", {
      ...strip,
      activeIndex: 0,
      onActiveIndexChange,
      onSelectionChange,
    });
    const segment = container.querySelectorAll(
      '[data-chart-part="segment"]',
    )[2]!;
    fireEvent.focus(segment);
    fireEvent.click(segment);
    expect(onActiveIndexChange).toHaveBeenCalledWith(2);
    expect(onSelectionChange).toHaveBeenCalledWith(2);
    expect(
      container.querySelector('[data-chart-part="readout"]')?.textContent,
    ).toBe("ok: 0–10");
  });
  it("rejects overlapping or reversed authored intervals", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(component("StatusStrip"), {
          ...strip,
          segments: [{ from: 10, to: 0, status: "ok" }],
        }),
      ),
    ).toThrow(/interval/i);
    expect(() =>
      renderToStaticMarkup(
        createElement(component("StatusStrip"), {
          ...strip,
          segments: [
            { from: 0, to: 20, status: "ok" },
            { from: 10, to: 30, status: "warn" },
          ],
        }),
      ),
    ).toThrow(/overlap/i);
  });
  it("sorts intervals, retains an entirely unknown observation window and navigates segments", () => {
    const { container, rerender } = plot("StatusStrip", {
      ...strip,
      segments: [...strip.segments].reverse(),
    });
    const first = container.querySelector('[data-chart-part="segment"]')!;
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(
      container.querySelectorAll('[data-chart-part="segment"]')[2],
    );
    rerender(
      createElement(component("StatusStrip"), { ...strip, segments: [] }),
    );
    expect(rows(container)).toEqual([["0", "40", "unknown"]]);
  });
});

describe("AreaChart inspection sequence regressions", () => {
  it.each(["Enter", " "])("does not select an absent datum after Escape then %j", key => {
    const onSelectionChange = vi.fn();
    const { container } = plot("AreaChart", { ...area, onSelectionChange });
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    fireEvent.focus(overlay);
    expect(container.querySelector('[data-chart-part="crosshair"]')).not.toBeNull();
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(container.querySelector('[data-chart-part="crosshair"]')).toBeNull();
    fireEvent.keyDown(overlay, { key });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(overlay).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector('[data-chart-part="readout"]')).toBeNull();
    fireEvent.keyDown(overlay, { key: "End" });
    fireEvent.keyDown(overlay, { key });
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(overlay).toHaveAttribute("aria-pressed", "true");
  });

  it.each([false, true])("selects the clicked datum before any pointermove (focused=%s)", focused => {
    const onSelectionChange = vi.fn();
    const onActiveIndexChange = vi.fn();
    const { container } = plot("AreaChart", { ...area, onSelectionChange, onActiveIndexChange });
    vi.spyOn(container.querySelector("svg")!, "getBoundingClientRect")
      .mockReturnValue({ left: 100, width: 800 } as DOMRect);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    if (focused) fireEvent.focus(overlay);
    fireEvent.click(overlay, { clientX: 868 });
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(2);
    expect(overlay).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('[data-chart-part="readout"]')?.textContent).toContain("Mar");
  });
});
