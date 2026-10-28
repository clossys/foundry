import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasModules } from "./CanvasModules.js";
import type { useCanvasWorld } from "./useCanvasWorld.js";
import { Studio } from "./Studio.js";
import { FrameSlotProvider, FrameModuleOutlet } from "../shell/FrameSlots.js";
import { FrameNoticeProvider } from "../frames/frame-notices.js";
import { CanvasMap } from "../components/CanvasMap.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { findLayerSelect, railCard, railCards } from "./__fixtures__/frame.js";
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
/** DESIGNER-RO (rail): the modules live in the page's right rail cards; nothing is leased into the frame's hosts. */
it("places Explorer, Map and Zoom in the rail cards, leases nothing to Frame hosts, and ties grid geometry to the camera", async () => {
  const view = render(<FrameSlotProvider><FrameNoticeProvider><Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} />
    <div data-test-dock=""><FrameModuleOutlet id="explorer" /><FrameModuleOutlet id="map" /><FrameModuleOutlet id="zoom" /></div>
  </FrameNoticeProvider></FrameSlotProvider>);
  await findLayerSelect();
  expect(railCards().map(card => card.dataset.studioRailCard)).toEqual(["explorer", "inspector", "map", "zoom"]);
  expect(railCard("explorer")!.contains(screen.getByRole("treegrid", { name: labels.treeLabel }))).toBe(true);
  expect(railCard("zoom")!.contains(screen.getByRole("toolbar", { name: labels.canvas.zoomLabel }))).toBe(true);
  // The map card's disclosure trigger and the map itself share the map label; both live in the map card.
  const maps = screen.getAllByRole("button", { name: labels.canvas.minimap });
  expect(maps).toHaveLength(2); expect(maps.every(button => railCard("map")!.contains(button))).toBe(true);
  const dock = view.container.querySelector<HTMLElement>("[data-test-dock]")!;
  expect(dock.querySelector('[role="treegrid"], [role="toolbar"], button')).toBeNull(); expect(dock.textContent).toBe("");
  expect(view.container.querySelector("[data-studio-canvas]")).toHaveAttribute("data-frame-bleed");
  expect(view.container.querySelector("[data-canvas-controls]")).toBeNull();
  expect(view.container.querySelector("[data-canvas-panel]")).toBeNull();
  const stage = screen.getByRole("region", { name: labels.canvas.label });
  const size = stage.style.backgroundSize;
  await userEvent.setup().click(screen.getByRole("button", { name: labels.canvas.zoomIn }));
  expect(stage.style.backgroundSize).not.toBe(size);
  const origin = stage.style.backgroundPosition;
  fireEvent.keyDown(stage, { key: "ArrowRight" }); expect(stage.style.backgroundPosition).not.toBe(origin);
  fireEvent.keyDown(stage, { key: "1" }); expect(screen.getByRole("status", { name: labels.canvas.zoomLabel })).toHaveTextContent("100%");
  expect(stage.style.backgroundImage).toContain("--color-line-base");
  expect(stage.style.backgroundImage).toContain("--ui-border-hairline");
  expect(stage.style.backgroundSize).toContain("--spacing-xl");
});
it("projects real board rectangles and drags the viewport using world coordinates", () => {
  const change = vi.fn();
  render(<CanvasMap label="Map" bounds={{ x: 0, y: 0, width: 1000, height: 500 }} viewport={{ x: -100, y: -50, zoom: 1 }} viewSize={{ width: 200, height: 100 }} items={[{ id: "board", rect: { x: 50, y: 25, width: 100, height: 50 } }]} onViewportChange={change} />);
  const map = screen.getByRole("button", { name: "Map" });
  const captured = new Set<number>();
  const capture = vi.fn((id: number) => { captured.add(id); });
  const release = vi.fn((id: number) => { captured.delete(id); });
  Object.defineProperties(map, { setPointerCapture: { value: capture }, releasePointerCapture: { value: release } });
  const pointer = (type: string, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
    fireEvent(map, event);
  };
  vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON() {} });
  const rect = map.querySelector("svg rect")!;
  expect(rect).toHaveAttribute("x", "50"); expect(rect).toHaveAttribute("width", "100");
  pointer("pointerdown", 30, 15);
  expect(capture).toHaveBeenCalledWith(1); expect(captured.has(1)).toBe(true);
  pointer("pointermove", 50, 25);
  expect(change).toHaveBeenLastCalledWith({ x: -200, y: -100, zoom: 1 });
  pointer("pointerup", 50, 25);
  expect(release).toHaveBeenCalledWith(1); expect(captured.has(1)).toBe(false);
});


it("measures rail boards once across camera renders, then updates on resize and board changes", async () => {
  const surface = document.createElement("div"), world = document.createElement("div");
  surface.append(world); document.body.append(surface);
  let pose = { x: 0, y: 0, zoom: 1 }, width = 100;
  const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} });
  const addBoard = (id: string, x: number) => {
    const wrapper = document.createElement("div"), board = document.createElement("section");
    wrapper.dataset.studioCanvasBoard = id; board.dataset.libraryBoard = id;
    wrapper.append(board); world.append(wrapper);
    const read = vi.spyOn(board, "getBoundingClientRect").mockImplementation(() => box(pose.x + x * pose.zoom, pose.y + 25 * pose.zoom, width * pose.zoom, 50 * pose.zoom));
    return { wrapper, read };
  };
  const first = addBoard("first", 50);
  vi.spyOn(surface, "getBoundingClientRect").mockImplementation(() => box(0, 0, 800, 600));
  const observers: { callback: ResizeObserverCallback; targets: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    targets: Element[] = []; disconnect = vi.fn();
    constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.push(target); }
    unobserve(target: Element) { this.targets = this.targets.filter(value => value !== target); }
  });
  const canvas = { surface: { current: surface }, world: { current: world }, actions: { current: null }, pose, bounds: { x: 0, y: 0, width: 1000, height: 500 }, setPose: vi.fn() } as unknown as ReturnType<typeof useCanvasWorld>;
  const modules = () => <CanvasModules canvas={{ ...canvas, pose }} labels={labels} explorer={null} inspector={null} />;
  try {
    const view = render(modules());
    expect(first.read).toHaveBeenCalledTimes(1);
    for (let frame = 1; frame <= 4; frame++) {
      pose = { x: -frame * 10, y: -frame * 5, zoom: 1 + frame / 10 };
      view.rerender(modules());
    }
    expect(first.read).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.targets).toContain(first.wrapper.firstElementChild);
    first.wrapper.firstElementChild!.append(document.createElement("span"));
    await act(async () => { await Promise.resolve(); });
    expect(first.read).toHaveBeenCalledTimes(1);
    width = 140;
    act(() => observers[0]!.callback([], observers[0] as unknown as ResizeObserver));
    expect(first.read).toHaveBeenCalledTimes(2);
    const boardRects = () => [...view.container.querySelectorAll('[data-studio-rail-card="map"] svg rect')];
    expect(boardRects()[0]).toHaveAttribute("x", "50");
    expect(boardRects()[0]).toHaveAttribute("width", "140");
    const second = addBoard("second", 250);
    await act(async () => { await Promise.resolve(); });
    expect(second.read).toHaveBeenCalledTimes(1);
    expect(boardRects()).toHaveLength(3); // two boards plus the viewport
    first.wrapper.hidden = true;
    await act(async () => { await Promise.resolve(); });
    expect(boardRects()).toHaveLength(2);
    second.wrapper.remove();
    await act(async () => { await Promise.resolve(); });
    expect(boardRects()).toHaveLength(1);
    expect(observers[0]!.targets).not.toContain(second.wrapper.firstElementChild);
    view.unmount(); expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
  } finally { surface.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
