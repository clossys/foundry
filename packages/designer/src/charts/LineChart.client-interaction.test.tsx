import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render } from "@testing-library/react";
import { LineChart } from "./LineChart.js";

const props = {
  title: "Sample counts", description: "Counts by period",
  x: [-10, 0, 10],
  series: [
    { name: "Group A", values: [-2, 0, 6] },
    { name: "Group B", values: [4, 2, 1] },
  ],
  width: 400, height: 200,
  xColumnLabel: "Period", tableFallbackLabel: "Data table",
};
afterEach(() => vi.restoreAllMocks());
function bounds(svg: SVGSVGElement, width = 800) {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 0, left: 100, right: 100 + width,
    top: 0, bottom: 200, width, height: 200,
    toJSON: () => ({}),
  } as DOMRect);
}
function move(overlay: Element, clientX: number) {
  // JSDOM has no PointerEvent constructor; React forwards these MouseEvent
  // coordinates through its pointermove synthetic event.
  fireEvent(overlay, new MouseEvent("pointermove", {
    bubbles: true, clientX,
  }));
}
const crosshair = (root: HTMLElement) =>
  root.querySelector('[data-chart-part="crosshair"]');
const tooltip = (root: HTMLElement) =>
  root.querySelector('[data-chart-part="tooltip"]')?.textContent;
function key(overlay: Element, name: string) {
  const event = createEvent.keyDown(overlay, {
    key: name, bubbles: true, cancelable: true,
  });
  fireEvent(overlay, event);
  return event;
}

describe("LineChart client interaction after geometry extraction", () => {
  it("maps scaled pointer coordinates and preserves every series readout", () => {
    const { container } = render(<LineChart {...props} />);
    const svg = container.querySelector("svg")!;
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    bounds(svg);
    expect(crosshair(container)).toBeNull();
    move(overlay, 532); // (532 - 100) * (400 / 800) = 216
    expect(crosshair(container)!.getAttribute("x1")).toBe("216");
    expect(crosshair(container)!.getAttribute("x2")).toBe("216");
    expect(tooltip(container)).toBe("0: Group A 0, Group B 2");
    expect(Array.from(container.querySelectorAll('[data-chart-part="hover-dot"]'),
      node => [node.getAttribute("cx"), node.getAttribute("cy")]))
      .toEqual([["216", "130"], ["216", "92"]]);
    move(overlay, 100); // nearest first sample
    expect(crosshair(container)!.getAttribute("x1")).toBe("48");
    move(overlay, 1000); // nearest last sample
    expect(crosshair(container)!.getAttribute("x1")).toBe("384");
    fireEvent.pointerLeave(overlay);
    expect(crosshair(container)).toBeNull();
    expect(container.querySelector('[data-chart-part="tooltip"]')).toBeNull();
    expect(container.querySelectorAll('[data-chart-part="hover-dot"]')).toHaveLength(0);
  });

  it("keeps the zero-width layout fallback deterministic", () => {
    const { container } = render(<LineChart {...props} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    bounds(container.querySelector("svg")!, 0);
    move(overlay, 316); // zero width uses scale 1: 316 - 100 = 216
    expect(crosshair(container)!.getAttribute("x1")).toBe("216");
    expect(tooltip(container)).toBe("0: Group A 0, Group B 2");
  });

  it("keeps focus, arrow stepping, clamps, Escape and blur behavior", () => {
    const { container } = render(<LineChart {...props} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    expect(overlay.getAttribute("tabindex")).toBe("0");
    expect(overlay.getAttribute("aria-label"))
      .toBe("Sample counts: use arrow keys to inspect values");
    fireEvent.focus(overlay);
    expect(crosshair(container)!.getAttribute("x1")).toBe("48");
    expect(tooltip(container)).toBe("-10: Group A -2, Group B 4");
    expect(key(overlay, "ArrowRight").defaultPrevented).toBe(true);
    expect(crosshair(container)!.getAttribute("x1")).toBe("216");
    expect(tooltip(container)).toBe("0: Group A 0, Group B 2");
    for (let index = 0; index < 4; index++) key(overlay, "ArrowRight");
    expect(crosshair(container)!.getAttribute("x1")).toBe("384");
    expect(key(overlay, "ArrowLeft").defaultPrevented).toBe(true);
    expect(crosshair(container)!.getAttribute("x1")).toBe("216");
    for (let index = 0; index < 4; index++) key(overlay, "ArrowLeft");
    expect(crosshair(container)!.getAttribute("x1")).toBe("48");
    key(overlay, "Escape");
    expect(crosshair(container)).toBeNull();
    key(overlay, "ArrowLeft"); // existing null-index behavior starts at the end
    expect(crosshair(container)!.getAttribute("x1")).toBe("384");
    fireEvent.blur(overlay);
    expect(crosshair(container)).toBeNull();
    expect(container.querySelectorAll('[data-chart-part="hover-dot"]')).toHaveLength(0);
  });

  it("preserves a pointer-selected index when focus arrives", () => {
    const { container } = render(<LineChart {...props} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    bounds(container.querySelector("svg")!);
    move(overlay, 532);
    fireEvent.focus(overlay);
    expect(crosshair(container)!.getAttribute("x1")).toBe("216");
    expect(tooltip(container)).toBe("0: Group A 0, Group B 2");
  });

  it("uses Date spacing for pointer selection and keyboard steps", () => {
    const x = [
      new Date("2026-01-01T12:00:00Z"),
      new Date("2026-01-02T12:00:00Z"),
      new Date("2026-01-04T12:00:00Z"),
    ];
    const { container } = render(<LineChart {...props} x={x}
      xFormat={value => (value as Date).toISOString().slice(0, 10)} />);
    const overlay = container.querySelector('[data-chart-part="hover-overlay"]')!;
    bounds(container.querySelector("svg")!);
    move(overlay, 660); // local 280: nearest Date endpoint, unlike uniform spacing
    expect(crosshair(container)!.getAttribute("x1")).toBe("384");
    expect(tooltip(container)).toBe("2026-01-04: Group A 6, Group B 1");
    key(overlay, "ArrowLeft");
    expect(crosshair(container)!.getAttribute("x1")).toBe("160");
    expect(tooltip(container)).toBe("2026-01-02: Group A 0, Group B 2");
    fireEvent.blur(overlay);
    expect(crosshair(container)).toBeNull();
  });

  it("preserves the existing client-only final-label behavior for short series", () => {
    // Intentional legacy compatibility pin. The new static server variant
    // instead labels the final zero-filled x sample as Group B 0.
    const { container } = render(<LineChart {...props}
      series={[props.series[0]!, { name: "Group B", values: [4] }]} />);
    const lastSeries = container.querySelectorAll('[data-chart-part="series"]')[1]!;
    expect(lastSeries.querySelector("circle")!.getAttribute("cy")).toBe("130");
    expect(lastSeries.querySelector("text")!.textContent).toBe("Group B 4");
    const finalRow = Array.from(container.querySelectorAll("tbody tr")).at(-1)!;
    expect(Array.from(finalRow.querySelectorAll("td"), cell => cell.textContent))
      .toEqual(["10", "6", "0"]);
  });
});
