import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface, type CanvasSurfaceProps } from "./CanvasSurface.js";
import { fitTo, toWorld, zoomAt, type CanvasItem } from "./models.js";

const items: readonly CanvasItem[] = [
  { id: "a", label: "Alpha", rect: { x: 0, y: 0, width: 20, height: 20 } },
  { id: "b", label: "Beta", rect: { x: 100, y: 0, width: 20, height: 20 } },
  { id: "c", label: "Gamma", rect: { x: 0, y: 100, width: 20, height: 20 } },
];
const initial = { x: 0, y: 0, zoom: 1 };
const viewSize = { width: 800, height: 600 };
const worldBounds = { x: 0, y: 0, width: 1000, height: 800 };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse";
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<CanvasSurfaceProps> = {}) {
  const props: CanvasSurfaceProps = {
    "aria-label": "Workspace", viewport: initial, onViewportChange: vi.fn(), selection: Object.freeze([]),
    onSelectionChange: vi.fn(), items, worldBounds, viewSize, ...overrides,
  };
  const result = render(<CanvasSurface {...props} />);
  const surface = screen.getByRole("region", { name: "Workspace" });
  Object.defineProperties(surface, { setPointerCapture: { value: vi.fn(), configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true }, hasPointerCapture: { value: () => true, configurable: true } });
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ x: 40, y: 30, left: 40, top: 30, width: 800, height: 600, right: 840, bottom: 630, toJSON() {} });
  return { ...result, surface, props, world: result.container.querySelector("[data-canvas-world]") as HTMLElement };
}
const pointer = (node: Element, type: "down" | "move" | "up" | "cancel", x: number, y: number, extra: PointerEventInit = {}) =>
  fireEvent(node, new PointerEvent(`pointer${type}`, { bubbles: true, cancelable: true, clientX: x + 40, clientY: y + 30, button: 0, pointerId: 1, ...extra }));

describe("canvas surface keyboard and controlled values", () => {
  it("renders real named item buttons with one roving tab stop and passive content once", () => {
    setup({ children: <svg data-testid="edge"><path /></svg>, renderItem: item => <span>{item.label} detail</span> });
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByTestId("edge")).toHaveLength(1);
    expect(screen.getAllByText("Alpha detail")).toHaveLength(1);
  });
  it("moves actual DOM focus spatially, including all four arrow directions", () => {
    const { props } = setup();
    const a = screen.getByRole("button", { name: "Alpha" }), b = screen.getByRole("button", { name: "Beta" }), c = screen.getByRole("button", { name: "Gamma" });
    act(() => a.focus());
    for (const [key, target] of [["ArrowRight", b], ["ArrowLeft", a], ["ArrowDown", c], ["ArrowUp", a]] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(target).toHaveFocus(); expect(target).toHaveAttribute("tabindex", "0");
    }
    fireEvent.keyDown(a, { key: "ArrowUp" }); expect(a).toHaveFocus();
    expect(props.onSelectionChange).not.toHaveBeenCalled();
  });
  it("hands DOM focus to the surface on empty press and to an activated item", () => {
    const { props, surface } = setup({ children: <svg><path data-testid="focus-wire" /></svg> });
    pointer(screen.getByTestId("focus-wire"), "down", 400, 350);
    expect(surface).toHaveFocus();
    pointer(surface, "up", 400, 350);
    fireEvent.keyDown(document.activeElement!, { key: "+" });
    expect(props.onViewportChange).toHaveBeenCalled();
    const b = screen.getByRole("button", { name: "Beta" });
    fireEvent.click(b); expect(b).toHaveFocus(); expect(b).toHaveAttribute("tabindex", "0");
  });
  it("extends selection with shift arrows in item order, without mutating or applying it internally", () => {
    const selected = Object.freeze(["c"]);
    const { props } = setup({ selection: selected });
    const a = screen.getByRole("button", { name: "Alpha" }), b = screen.getByRole("button", { name: "Beta" });
    act(() => a.focus()); fireEvent.keyDown(a, { key: "ArrowRight", shiftKey: true });
    expect(b).toHaveFocus(); expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a", "b", "c"]);
    expect(b).toHaveAttribute("aria-pressed", "false"); expect(selected).toEqual(["c"]);
  });
  it("single-selects, toggles with command/control, and ranges from a stable click anchor", () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a"]);
    rerender(<CanvasSurface {...props} selection={["a"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }), { ctrlKey: true });
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }), { shiftKey: true });
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(["c"]);
  });
  it("zooms with +/- and fits with 0/Home; Escape requests clear", () => {
    const { surface, props } = setup({ selection: ["b"] });
    fireEvent.keyDown(surface, { key: "+" });
    expect(vi.mocked(props.onViewportChange).mock.lastCall![0].zoom).toBeGreaterThan(1);
    fireEvent.keyDown(surface, { key: "-" });
    expect(vi.mocked(props.onViewportChange).mock.lastCall![0].zoom).toBeLessThan(1);
    for (const key of ["0", "Home"]) {
      fireEvent.keyDown(surface, { key });
      expect(props.onViewportChange).toHaveBeenLastCalledWith(fitTo(worldBounds, viewSize, 0));
    }
    fireEvent.keyDown(surface, { key: "Escape" }); expect(props.onSelectionChange).toHaveBeenLastCalledWith([]);
  });
  it("uses the latest controlled viewport and zoom limits without optimistic transforms", () => {
    const { surface, props, world, rerender } = setup({ minZoom: 0.5, maxZoom: 2 });
    fireEvent.keyDown(surface, { key: "+" }); expect(world.style.transform).toBe("translate(0px, 0px) scale(1)");
    rerender(<CanvasSurface {...props} viewport={{ x: 7, y: 9, zoom: 2 }} />);
    fireEvent.keyDown(surface, { key: "+" }); expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 7, y: 9, zoom: 2 });
    expect(world.style.transform).toBe("translate(7px, 9px) scale(2)");
  });
  it("does not intercept typing or shortcuts in consumer controls", () => {
    const { props } = setup({ children: <input aria-label="Node name" /> });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "+" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(props.onViewportChange).not.toHaveBeenCalled(); expect(props.onSelectionChange).not.toHaveBeenCalled();
  });
  it("recovers a roving tab stop when the focused item is removed", () => {
    const { props, rerender } = setup();
    act(() => screen.getByRole("button", { name: "Beta" }).focus());
    rerender(<CanvasSurface {...props} items={[items[0]!, items[2]!]} />);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
  });
  it("offers a keyboard entry point when the canvas is empty", () => {
    const { surface } = setup({ items: [] }); expect(surface).toHaveAttribute("tabindex", "0");
  });
});

describe("canvas surface gestures and cleanup", () => {
  it("pans on decorative world descendants in screen coordinates", () => {
    const { props, surface } = setup({ children: <svg><path data-testid="wire" /></svg> });
    pointer(screen.getByTestId("wire"), "down", 100, 100);
    pointer(surface, "move", 125, 85); pointer(surface, "up", 125, 85);
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 25, y: -15, zoom: 1 });
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it("space drag pans from an item, keyup outside and blur release space mode", () => {
    const { props, surface } = setup(); const a = screen.getByRole("button", { name: "Alpha" });
    fireEvent.keyDown(a, { key: " " }); pointer(a, "down", 0, 0); pointer(surface, "move", 20, 10); pointer(surface, "up", 20, 10);
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 20, y: 10, zoom: 1 });
    fireEvent.keyUp(window, { key: " " });
    vi.mocked(props.onViewportChange).mockClear(); pointer(a, "down", 0, 0); pointer(surface, "move", 30, 10);
    expect(props.onViewportChange).not.toHaveBeenCalled();
    fireEvent.keyDown(a, { key: " " }); fireEvent.blur(window);
    pointer(a, "down", 0, 0); pointer(surface, "move", 30, 10); expect(props.onViewportChange).not.toHaveBeenCalled();
  });
  it("marquees inclusively in world coordinates under pan and zoom", () => {
    const { props, surface } = setup({ viewport: { x: 10, y: 20, zoom: 2 } });
    pointer(surface, "down", 50, 60, { shiftKey: true }); pointer(surface, "move", 210, 220); pointer(surface, "up", 210, 220);
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a", "b", "c"]);
    expect(props.onViewportChange).not.toHaveBeenCalled();
  });
  it("cancels marquee without selection on pointercancel or Escape", () => {
    const { props, surface } = setup();
    pointer(surface, "down", 0, 0, { shiftKey: true }); pointer(surface, "move", 50, 50); pointer(surface, "cancel", 50, 50);
    expect(props.onSelectionChange).not.toHaveBeenCalled();
    pointer(surface, "down", 0, 0, { shiftKey: true }); fireEvent.keyDown(surface, { key: "Escape" }); pointer(surface, "up", 50, 50);
    expect(props.onSelectionChange).toHaveBeenCalledTimes(1); expect(props.onSelectionChange).toHaveBeenLastCalledWith([]);
  });
  it("zooms wheel and trackpad pinch at the local pointer, preventing native scrolling", () => {
    const { props, surface } = setup({ viewport: { x: 10, y: 20, zoom: 2 } });
    for (const [deltaY, ctrlKey] of [[-100, false], [100, true]] as const) {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 240, clientY: 180, deltaY, ctrlKey });
      fireEvent(surface, event); expect(event.defaultPrevented).toBe(true);
      const next = vi.mocked(props.onViewportChange).mock.lastCall![0];
      expect(next.zoom > 2).toBe(deltaY < 0);
      expect(toWorld(next, { x: 200, y: 150 })).toEqual(toWorld(props.viewport, { x: 200, y: 150 }));
    }
  });
  it("pinches with two touch pointers and pans the moving midpoint", () => {
    const { props, surface } = setup();
    pointer(surface, "down", 100, 100, { pointerId: 1, pointerType: "touch" });
    pointer(surface, "down", 200, 100, { pointerId: 2, pointerType: "touch" });
    pointer(surface, "move", 300, 100, { pointerId: 2, pointerType: "touch" });
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: -100, y: -100, zoom: 2 });
    pointer(surface, "up", 100, 100, { pointerId: 1, pointerType: "touch" });
    pointer(surface, "up", 300, 100, { pointerId: 2, pointerType: "touch" });
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1); expect(surface.releasePointerCapture).toHaveBeenCalledWith(2);
  });
  it("ignores secondary mouse buttons and does not pan on item clicks", () => {
    const { props, surface } = setup();
    pointer(surface, "down", 0, 0, { button: 2 }); pointer(surface, "move", 10, 10);
    pointer(screen.getByRole("button", { name: "Alpha" }), "down", 0, 0); pointer(surface, "move", 10, 10);
    expect(props.onViewportChange).not.toHaveBeenCalled();
  });
  it("suppresses a moved touch item's synthetic click while preserving later keyboard activation", () => {
    const { props, surface } = setup(); const a = screen.getByRole("button", { name: "Alpha" });
    pointer(a, "down", 0, 0, { pointerType: "touch" }); pointer(surface, "move", 30, 10); pointer(surface, "up", 30, 10);
    fireEvent.click(a, { detail: 1 }); expect(props.onSelectionChange).not.toHaveBeenCalled();
    fireEvent.click(a, { detail: 0 }); expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a"]);
  });
  it("preserves native touch tap targeting and delays item capture until an actual drag", () => {
    const { props, surface } = setup(); const a = screen.getByRole("button", { name: "Alpha" });
    pointer(a, "down", 0, 0, { pointerType: "touch" });
    expect(surface.setPointerCapture).not.toHaveBeenCalled();
    pointer(a, "up", 0, 0, { pointerType: "touch" });
    fireEvent.click(a, { detail: 1 }); expect(props.onSelectionChange).toHaveBeenLastCalledWith(["a"]);
    pointer(a, "down", 0, 0, { pointerType: "touch" }); pointer(a, "move", 10, 10, { pointerType: "touch" });
    expect(surface.setPointerCapture).toHaveBeenCalledWith(1);
  });
  it("accounts for surface borders when anchoring wheel zoom", () => {
    const { props, surface } = setup();
    Object.defineProperties(surface, { clientLeft: { value: 2 }, clientTop: { value: 3 } });
    fireEvent(surface, new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 242, clientY: 183, deltaY: -100 }));
    const next = vi.mocked(props.onViewportChange).mock.lastCall![0];
    expect(toWorld(next, { x: 200, y: 150 })).toEqual({ x: 200, y: 150 });
  });
  it("cancels captured gestures when pointer capture is lost", () => {
    const { props, surface } = setup();
    pointer(surface, "down", 0, 0, { shiftKey: true });
    fireEvent(surface, new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }));
    pointer(surface, "up", 100, 100); expect(props.onSelectionChange).not.toHaveBeenCalled();
    expect(surface.querySelector("[data-canvas-marquee]")).toBeNull();
  });
  it("measures the surface and disposes ResizeObserver and resize listeners", () => {
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 400, height: 300, left: 0, top: 0 } as DOMRect);
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    const { props, surface, unmount } = setup({ viewSize: undefined, fitPadding: 20 });
    fireEvent.keyDown(surface, { key: "Home" });
    expect(props.onViewportChange).toHaveBeenLastCalledWith(fitTo(worldBounds, { width: 400, height: 300 }, 20));
    unmount(); expect(observe).toHaveBeenCalledWith(surface); expect(disconnect).toHaveBeenCalledOnce();
    const handler = add.mock.calls.find(call => call[0] === "resize")![1];
    expect(remove.mock.calls.some(call => call[0] === "resize" && call[1] === handler)).toBe(true);
    bounds.mockRestore();
  });
  it("removes native listeners and releases every live pointer capture on unmount", () => {
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    const { props, surface, unmount } = setup(); const surfaceRemove = vi.spyOn(surface, "removeEventListener");
    pointer(surface, "down", 0, 0, { pointerType: "touch" }); pointer(surface, "down", 50, 0, { pointerId: 2, pointerType: "touch" });
    unmount();
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1); expect(surface.releasePointerCapture).toHaveBeenCalledWith(2);
    expect(surfaceRemove.mock.calls.some(call => call[0] === "wheel")).toBe(true);
    for (const type of ["blur", "keyup"]) {
      const handler = add.mock.calls.find(call => call[0] === type)![1];
      expect(remove.mock.calls.some(call => call[0] === type && call[1] === handler)).toBe(true);
    }
    const handler = media.addEventListener.mock.calls.find(call => call[0] === "change")![1];
    expect(media.removeEventListener).toHaveBeenCalledWith("change", handler);
    const calls = vi.mocked(props.onViewportChange).mock.calls.length;
    fireEvent(surface, new WheelEvent("wheel", { deltaY: -10 })); expect(props.onViewportChange).toHaveBeenCalledTimes(calls);
  });
});

describe("canvas surface controls and motion", () => {
  it("allows hosts to translate help and every control name", () => {
    const { surface } = setup({ minimap: true, zoomControls: true, instructionText: "Navigation help", recenterLabel: "Center view",
      zoomGroupLabel: "Magnification", zoomOutLabel: "Smaller", zoomPercentageLabel: "Scale", zoomInLabel: "Larger", fitLabel: "Show all" });
    expect(document.getElementById(surface.getAttribute("aria-describedby")!)).toHaveTextContent("Navigation help");
    for (const name of ["Center view", "Smaller", "Larger", "Show all"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByRole("group", { name: "Magnification" })).toBeVisible();
    expect(screen.getByLabelText("Scale")).toHaveTextContent("100%");
  });
  it("provides zoom controls with a controlled percentage readout", () => {
    const { props } = setup({ zoomControls: true, viewport: { x: 0, y: 0, zoom: 1.5 } });
    expect(screen.getByText("150%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" })); expect(vi.mocked(props.onViewportChange).mock.lastCall![0].zoom).toBeGreaterThan(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" })); expect(vi.mocked(props.onViewportChange).mock.lastCall![0].zoom).toBeLessThan(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Fit canvas" })); expect(props.onViewportChange).toHaveBeenLastCalledWith(fitTo(worldBounds, viewSize));
    expect(screen.getByText("150%")).toBeVisible();
  });
  it("recenters via minimap click position, including translated world origins", () => {
    const { props } = setup({ minimap: true, worldBounds: { ...worldBounds, x: -100, y: -50 } });
    const map = screen.getByRole("button", { name: "Recenter canvas" });
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
    fireEvent.click(map, { detail: 1, clientX: 160, clientY: 45 });
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: -250, y: 150, zoom: 1 });
    fireEvent.click(map, { detail: 0 }); expect(props.onViewportChange).toHaveBeenLastCalledWith({ x: 0, y: -50, zoom: 1 });
  });
  it("animates only fit and disables it for changing reduced-motion preferences", () => {
    const { surface, world } = setup();
    expect(world.style.transitionDuration).toBe("0s");
    fireEvent.keyDown(surface, { key: "Home" }); expect(world).toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toContain("--ui-duration-fast");
    const handler = media.addEventListener.mock.calls.find(call => call[0] === "change")![1];
    act(() => handler({ matches: true })); expect(world).not.toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("0s");
    fireEvent.keyDown(surface, { key: "Home" }); expect(world).not.toHaveClass("transition-transform");
    act(() => handler({ matches: false })); fireEvent.keyDown(surface, { key: "+" }); expect(world).not.toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("0s");
  });
  it("respects reduced motion at mount and exposes instructions with a unique id", () => {
    media.matches = true;
    const { surface, world } = setup(); fireEvent.keyDown(surface, { key: "Home" });
    expect(world).not.toHaveClass("transition-transform");
    expect(document.getElementById(surface.getAttribute("aria-describedby")!)).toHaveTextContent(/arrow.*focus/i);
  });
});


describe("canvas measured fit padding", () => {
  const bounds = Object.freeze({ x: 10, y: 20, width: 10, height: 8 });
  const props = (): CanvasSurfaceProps => ({
    "aria-label": "Measured workspace", viewport: initial, selection: Object.freeze([]),
    onViewportChange: vi.fn(), onSelectionChange: vi.fn(), items: [], worldBounds: bounds,
    fitPadding: 20, zoomControls: true,
  });
  function measured(initialSize: { width: number; height: number }) {
    let dimensions = initialSize;
    let notify = () => {};
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      ...dimensions, x: 0, y: 0, left: 0, top: 0, right: dimensions.width, bottom: dimensions.height, toJSON() {},
    }));
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
    const supplied = props(); const result = render(<CanvasSurface {...supplied} />);
    const surface = screen.getByRole("region", { name: supplied["aria-label"] });
    return { ...result, supplied, surface, resize: (next: { width: number; height: number }) => { dimensions = next; act(() => notify()); } };
  }

  it.each([
    [{ width: 0, height: 0 }, { width: 1, height: 1 }, 0],
    [{ width: 1, height: 1 }, { width: 1, height: 1 }, 0],
    [{ width: 1, height: 300 }, { width: 1, height: 300 }, 0],
    [{ width: 3, height: 5 }, { width: 3, height: 5 }, 1],
  ])("fits a zero or tiny measured container without losing the fit action: %j", (measurement, size, padding) => {
    const { supplied, surface, container } = measured(measurement);
    expect(supplied.onViewportChange).not.toHaveBeenCalled();
    fireEvent.keyDown(surface, { key: "Home" });
    expect(supplied.onViewportChange).toHaveBeenLastCalledWith(fitTo(bounds, size, padding));
    fireEvent.click(screen.getByRole("button", { name: "Fit canvas" }));
    expect(supplied.onViewportChange).toHaveBeenCalledTimes(2);
    expect(supplied.onViewportChange).toHaveBeenLastCalledWith(fitTo(bounds, size, padding));
    expect(container.querySelector<HTMLElement>("[data-canvas-world]")!.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("uses the safe fallback padding for a real Home event before measurement effects", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 80, height: 60, left: 0, top: 0 } as DOMRect);
    const supplied = props();
    function FitOnLayout() {
      const host = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => { fireEvent.keyDown(host.current!.querySelector('[role="region"]')!, { key: "Home" }); }, []);
      return <div ref={host}><CanvasSurface {...supplied} /></div>;
    }
    render(<FitOnLayout />);
    expect(supplied.onViewportChange).toHaveBeenCalledExactlyOnceWith(fitTo(bounds, { width: 1, height: 1 }, 0));
  });

  it("recomputes measured padding through shrink and grow without changing the requested padding or fitting automatically", () => {
    const { supplied, surface, resize } = measured({ width: 80, height: 60 });
    fireEvent.keyDown(surface, { key: "Home" });
    expect(supplied.onViewportChange).toHaveBeenLastCalledWith(fitTo(bounds, { width: 80, height: 60 }, 20));
    resize({ width: 5, height: 3 }); expect(supplied.onViewportChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fit canvas" }));
    expect(supplied.onViewportChange).toHaveBeenLastCalledWith(fitTo(bounds, { width: 5, height: 3 }, 1));
    resize({ width: 80, height: 60 }); expect(supplied.onViewportChange).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(surface, { key: "Home" });
    expect(supplied.onViewportChange).toHaveBeenLastCalledWith(fitTo(bounds, { width: 80, height: 60 }, 20));
    expect(supplied.fitPadding).toBe(20);
  });

  it.each([{ width: 1, height: 1 }, { width: 40, height: 40 }, { width: 20, height: 200 }])("keeps explicitly supplied insufficient viewSize strict: %j", viewSize => {
    expect(() => render(<CanvasSurface {...props()} viewSize={viewSize} />)).toThrow("Canvas padding must leave a positive view area.");
  });
  it.each([-1, NaN, Infinity])("keeps invalid requested padding strict before measured clamping: %s", fitPadding => {
    expect(() => render(<CanvasSurface {...props()} fitPadding={fitPadding} />)).toThrow("Canvas padding must be finite and nonnegative.");
  });
  it("keeps valid explicit viewSize and requested fit padding unchanged", () => {
    const supplied = props(); const size = { width: 100, height: 80 };
    render(<CanvasSurface {...supplied} viewSize={size} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit canvas" }));
    expect(supplied.onViewportChange).toHaveBeenCalledExactlyOnceWith(fitTo(bounds, size, 20));
  });
});

// Native browser scrolling is measured separately in Chromium; these cases
// exercise the synchronous handler and controlled request contract in jsdom.
describe("canvas wheel intent and focus visibility", () => {
  const frozen = Object.freeze({ x: 0, y: 0, zoom: 1 });
  const nearFar: readonly CanvasItem[] = [
    { id: "near", label: "Near", rect: { x: 20, y: 20, width: 20, height: 20 } },
    { id: "far", label: "Far", rect: { x: 1200, y: 900, width: 20, height: 20 } },
  ];
  const factor = Math.exp(0.2);
  const wheel = (surface: HTMLElement, point = { x: 100, y: 100 }, deltaY = -100, deltaMode = 0) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 40 + surface.clientLeft + point.x,
      clientY: 30 + surface.clientTop + point.y, deltaY, deltaMode });
    surface.dispatchEvent(event); return event;
  };
  const expectViewport = (actual: ReturnType<typeof zoomAt>, expected: ReturnType<typeof zoomAt>) => {
    expect(actual.x).toBeCloseTo(expected.x, 10); expect(actual.y).toBeCloseTo(expected.y, 10); expect(actual.zoom).toBeCloseTo(expected.zoom, 10);
  };

  it("accumulates native wheel intent before a host commit without painting an optimistic viewport or minimap", () => {
    const { surface, props, world } = setup({ viewport: frozen, minimap: true });
    const map = surface.querySelector("[data-canvas-minimap] span")!.getAttribute("style");
    let events: WheelEvent[] = [];
    act(() => { events = [wheel(surface), wheel(surface, { x: 150, y: 90 })]; });
    expect(events.every(event => event.defaultPrevented)).toBe(true);
    expect(props.onViewportChange).toHaveBeenCalledTimes(2);
    const first = zoomAt(frozen, { x: 100, y: 100 }, factor);
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[0]![0], first);
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[1]![0], zoomAt(first, { x: 150, y: 90 }, factor));
    expect(world.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(surface.querySelector("[data-canvas-minimap] span")!.getAttribute("style")).toBe(map);
  });

  it("accumulates a burst in a real accepting controlled host", () => {
    const changed = vi.fn();
    function Host() {
      const [viewport, setViewport] = useState(frozen);
      const onChange = useCallback((next: typeof frozen) => { changed(next); setViewport(next); }, []);
      return <CanvasSurface aria-label="Accepting canvas" viewport={viewport} onViewportChange={onChange} selection={[]}
        onSelectionChange={() => {}} worldBounds={worldBounds} viewSize={viewSize} items={items} />;
    }
    const { container } = render(<Host />); const surface = screen.getByRole("region", { name: "Accepting canvas" });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 40, top: 30, width: 800, height: 600 } as DOMRect);
    act(() => { wheel(surface); wheel(surface); });
    const expected = zoomAt(zoomAt(frozen, { x: 100, y: 100 }, factor), { x: 100, y: 100 }, factor);
    expect(changed).toHaveBeenCalledTimes(2); expectViewport(changed.mock.calls[1]![0], expected);
    expect(container.querySelector<HTMLElement>("[data-canvas-world]")!.style.transform).toBe(`translate(${expected.x}px, ${expected.y}px) scale(${expected.zoom})`);
  });

  it.each(["accepted", "clamped", "rejected with same frozen object", "external reset"])("reconciles pending wheel intent on authoritative host commit: %s", kind => {
    const result = setup({ viewport: frozen }); const { surface, props } = result;
    act(() => { wheel(surface); wheel(surface); });
    const accepted = vi.mocked(props.onViewportChange).mock.calls[1]![0];
    const authoritative = kind === "accepted" ? accepted : kind === "clamped" ? { x: -10, y: -20, zoom: 1.1 }
      : kind === "rejected with same frozen object" ? frozen : { x: 240, y: 80, zoom: 0.5 };
    // Identical viewport object and callback still constitute an authoritative commit.
    result.rerender(<CanvasSurface {...props} viewport={authoritative} />);
    vi.mocked(props.onViewportChange).mockClear(); act(() => { wheel(surface); });
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[0]![0], zoomAt(authoritative, { x: 100, y: 100 }, factor));
  });

  it.each(["zoom", "fit", "minimap", "pan"])("discards pending wheel intent for a non-wheel viewport operation: %s", operation => {
    const { surface, props } = setup({ viewport: frozen, minimap: true });
    act(() => { wheel(surface); });
    if (operation === "zoom") fireEvent.keyDown(surface, { key: "+" });
    else if (operation === "fit") fireEvent.keyDown(surface, { key: "Home" });
    else if (operation === "minimap") fireEvent.click(screen.getByRole("button", { name: "Recenter canvas" }));
    else { pointer(surface, "down", 5, 5); pointer(surface, "move", 25, 10); pointer(surface, "up", 25, 10); }
    vi.mocked(props.onViewportChange).mockClear(); act(() => { wheel(surface); });
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[0]![0], zoomAt(frozen, { x: 100, y: 100 }, factor));
  });

  it.each(["secondary button", "nested control"])("preserves wheel intent through an ignored pointer press: %s", kind => {
    const { surface, props } = setup({ viewport: frozen, minimap: true });
    act(() => { wheel(surface); });
    fireEvent.pointerDown(kind === "nested control" ? screen.getByRole("button", { name: "Recenter canvas" }) : surface,
      { pointerId: 17, pointerType: "mouse", button: kind === "secondary button" ? 2 : 0 });
    act(() => { wheel(surface); });
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[1]![0], zoomAt(zoomAt(frozen, { x: 100, y: 100 }, factor), { x: 100, y: 100 }, factor));
  });

  it("keeps wheel normalization, anchors and zoom limits while accumulating", () => {
    const { surface, props } = setup({ viewport: frozen, maxZoom: 2 });
    act(() => { wheel(surface, { x: 70, y: 80 }, -2, 1); wheel(surface, { x: 70, y: 80 }, -1, 2); });
    const first = zoomAt(frozen, { x: 70, y: 80 }, Math.exp(0.064));
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[0]![0], first);
    expectViewport(vi.mocked(props.onViewportChange).mock.calls[1]![0], zoomAt(first, { x: 70, y: 80 }, 2 / first.zoom));
  });

  it("discards wheel intent and listeners on teardown", () => {
    const result = setup({ viewport: frozen }); const old = result.surface;
    act(() => { wheel(old); }); result.unmount(); vi.mocked(result.props.onViewportChange).mockClear();
    act(() => { wheel(old); }); expect(result.props.onViewportChange).not.toHaveBeenCalled();
    const next = setup({ viewport: frozen }); act(() => { wheel(next.surface); });
    expectViewport(vi.mocked(next.props.onViewportChange).mock.calls[0]![0], zoomAt(frozen, { x: 100, y: 100 }, factor));
  });

  it("requests minimal focus reveal once at unchanged zoom and selection, with no optimistic paint", () => {
    const result = setup({ viewport: frozen, items: nearFar, selection: Object.freeze(["near"]) });
    const near = screen.getByRole("button", { name: "Near" }), far = screen.getByRole("button", { name: "Far" });
    act(() => near.focus()); expect(result.props.onViewportChange).not.toHaveBeenCalled();
    fireEvent.keyDown(near, { key: "ArrowRight" });
    expect(far).toHaveFocus(); expect(far).toHaveAttribute("tabindex", "0");
    expect(result.props.onViewportChange).toHaveBeenCalledExactlyOnceWith({ x: -422, y: -322, zoom: 1 });
    expect(result.props.onSelectionChange).not.toHaveBeenCalled(); expect(result.world.style.transform).toBe("translate(0px, 0px) scale(1)");
    act(() => far.focus()); expect(result.props.onViewportChange).toHaveBeenCalledTimes(1);
    result.rerender(<CanvasSurface {...result.props} viewport={{ x: -422, y: -322, zoom: 1 }} />);
    expect(screen.getByRole("button", { name: "Far" })).toBe(far); expect(far).toHaveFocus();
    expect(result.world.style.transform).toBe("translate(-422px, -322px) scale(1)");
    expect(result.props.onViewportChange).toHaveBeenCalledTimes(1);
  });

  it("keeps visible item focus free of viewport callbacks", () => {
    const { props } = setup({ viewport: frozen, items: [nearFar[0]!, { ...nearFar[1]!, rect: { x: 100, y: 100, width: 20, height: 20 } }] });
    const near = screen.getByRole("button", { name: "Near" }); act(() => near.focus()); fireEvent.keyDown(near, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Far" })).toHaveFocus();
    expect(props.onViewportChange).not.toHaveBeenCalled();
  });

  it("reveals both axes in world-to-screen coordinates without changing zoom", () => {
    const { props } = setup({ viewport: { x: 40, y: -20, zoom: 0.5 }, items: [{ id: "far", label: "Far", rect: { x: 2000, y: 1600, width: 100, height: 100 } }] });
    act(() => screen.getByRole("button", { name: "Far" }).focus());
    expect(props.onViewportChange).toHaveBeenCalledExactlyOnceWith({ x: -252, y: -252, zoom: 0.5 });
  });

  it.each([{ width: 80, height: 60, inset: 2 }, { width: 1, height: 1, inset: 0 }])("aligns oversized focus to a stable bounded leading edge: %j", dimensions => {
    const item = { id: "far", label: "Far", rect: { x: 100, y: 200, width: 500, height: 400 } };
    const { inset, ...view } = dimensions; const result = setup({ viewport: frozen, viewSize: view, items: [item] });
    const far = screen.getByRole("button", { name: "Far" }); act(() => far.focus());
    const requested = { x: inset - 100, y: inset - 200, zoom: 1 };
    expect(result.props.onViewportChange).toHaveBeenCalledExactlyOnceWith(requested);
    result.rerender(<CanvasSurface {...result.props} viewport={requested} />);
    const outside = document.createElement("button"); result.container.appendChild(outside);
    act(() => outside.focus()); act(() => far.focus()); expect(result.props.onViewportChange).toHaveBeenCalledTimes(1);
  });

  it("neutralizes native container scrolling synchronously without commandeering nested scroll or changing viewport", () => {
    const { surface, props, world } = setup({ viewport: frozen });
    surface.scrollLeft = 37; surface.scrollTop = 19; fireEvent.scroll(surface);
    expect(surface.scrollLeft).toBe(0); expect(surface.scrollTop).toBe(0);
    const nested = document.createElement("div"); world.appendChild(nested); nested.scrollLeft = 11; fireEvent.scroll(nested);
    expect(nested.scrollLeft).toBe(11); expect(props.onViewportChange).not.toHaveBeenCalled();
  });
});
