import { createRef, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasSurface, CanvasLod, CanvasLodLayers,
  type CanvasSurfaceActions, type CanvasSurfaceProps, type CanvasItem,
} from "./index.js";

const items: readonly CanvasItem[] = [
  { id: "brief", label: "Brief", rect: { x: 20, y: 20, width: 200, height: 100 } },
  { id: "article", label: "Article", rect: { x: 260, y: 20, width: 200, height: 100 } },
];

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(overrides: Partial<CanvasSurfaceProps> = {}) {
  const props: CanvasSurfaceProps = {
    "aria-label": "Consumer board", viewport: { x: 0, y: 0, zoom: 1 },
    onViewportChange: vi.fn(), selection: [], onSelectionChange: vi.fn(),
    items, worldBounds: { x: 0, y: 0, width: 1000, height: 800 },
    viewSize: { width: 800, height: 600 }, ...overrides,
  };
  const result = render(<CanvasSurface {...props} />);
  const surface = screen.getByRole("region", { name: "Consumer board" });
  Object.defineProperties(surface, {
    setPointerCapture: { value: vi.fn() }, releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => true },
  });
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON() {},
  });
  return { ...result, surface, props, world: result.container.querySelector<HTMLElement>("[data-canvas-world]")! };
}

describe("public Studio canvas for consumer boards", () => {
  it("mounts registered sections and interactive cells without a Studio provider", () => {
    const open = vi.fn();
    const registry: Record<string, ReactNode> = {
      brief: <><h2>Campaign brief</h2><button onClick={open}>Inspect candidate</button></>,
      article: <><h2>Long-form article</h2><input aria-label="Cell copy" defaultValue="Draft copy" /></>,
    };
    mount({ itemInteraction: "content", renderItem: item => registry[item.id], children: <p>Consumer world annotation</p> });
    const brief = screen.getByRole("region", { name: "Brief" });
    expect(within(brief).getByRole("heading", { name: "Campaign brief" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Article" })).toContainElement(screen.getByRole("textbox", { name: "Cell copy" }));
    expect(screen.getByText("Consumer world annotation")).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole("button", { name: "Inspect candidate" }));
    expect(open).toHaveBeenCalledOnce();
    expect(brief).toHaveAttribute("tabindex", "0");
  });

  it("keeps viewport and selection controlled through host callbacks", () => {
    const { props, surface, world, rerender } = mount({ renderItem: item => <span>{item.label} stage cell</span> });
    fireEvent.click(screen.getByRole("button", { name: "Article" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(["article"]);
    expect(screen.getByRole("button", { name: "Article" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(surface, { key: "+" });
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: -80, y: -60, zoom: 1.2 });
    expect(world.style.transform).toBe("translate(0px, 0px) scale(1)");
    rerender(<CanvasSurface {...props} viewport={{ x: 12, y: 24, zoom: 2 }} selection={["article"]} />);
    expect(world.style.transform).toBe("translate(12px, 24px) scale(2)");
    expect(screen.getByRole("button", { name: "Article" })).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves spatial keyboard navigation for selectable consumer cells", () => {
    mount();
    const brief = screen.getByRole("button", { name: "Brief" });
    const article = screen.getByRole("button", { name: "Article" });
    act(() => brief.focus());
    fireEvent.keyDown(brief, { key: "ArrowRight" });
    expect(article).toHaveFocus();
    expect(article).toHaveAttribute("tabindex", "0");
    expect(brief).toHaveAttribute("tabindex", "-1");
  });

  it("pans the board by pointer and zooms a content board around the wheel anchor", () => {
    const { props, surface, world } = mount({ itemInteraction: "content" });
    for (const [phase, x, y] of [["down", 100, 100], ["move", 130, 80], ["up", 130, 80]] as const) {
      fireEvent(surface, new PointerEvent(`pointer${phase}`, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
    }
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 30, y: -20, zoom: 1 });
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: 200, clientY: 150 });
    fireEvent(surface, wheel);
    const next = vi.mocked(props.onViewportChange).mock.lastCall![0];
    expect(wheel.defaultPrevented).toBe(true);
    expect(next.zoom).toBeGreaterThan(1);
    expect((200 - next.x) / next.zoom).toBeCloseTo(200);
    expect((150 - next.y) / next.zoom).toBeCloseTo(150);
    expect(world.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("lets nested content controls own input while exposing host camera actions", () => {
    const actions = createRef<CanvasSurfaceActions>();
    const { props } = mount({ actionsRef: actions, itemInteraction: "content", renderItem: () => <input aria-label="Consumer cell" /> });
    const input = screen.getAllByRole("textbox", { name: "Consumer cell" })[0]!;
    fireEvent.keyDown(input, { key: "+" });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 20 });
    fireEvent(input, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(props.onViewportChange).not.toHaveBeenCalled();
    act(() => actions.current!.pan(30, -10));
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 30, y: -10, zoom: 1 });
  });

  it("reuses the canvas facade and retains cells across detail tiers", async () => {
    const canvas = await import("./canvas.js");
    expect(canvas.CanvasSurface).toBe(CanvasSurface);
    const board = (zoom: number) => <CanvasLod zoom={zoom}><CanvasLodLayers
      full={<input aria-label="Detailed cell" defaultValue="Consumer value" />} overview={<p>Board summary</p>}
    /></CanvasLod>;
    const { rerender } = render(board(1));
    const input = screen.getByRole("textbox", { name: "Detailed cell" });
    fireEvent.change(input, { target: { value: "Edited value" } });
    rerender(board(0.1));
    expect(screen.getByText("Board summary")).toBeVisible();
    expect(input.closest("[data-canvas-lod-layer]")).toHaveAttribute("aria-hidden", "true");
    rerender(board(1));
    expect(screen.getByRole("textbox", { name: "Detailed cell" })).toBe(input);
    expect(input).toHaveValue("Edited value");
  });
});
