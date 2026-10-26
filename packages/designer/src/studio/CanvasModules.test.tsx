import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "./Studio.js";
import { FrameSlotProvider, FrameModuleOutlet } from "../shell/FrameSlots.js";
import { FrameNoticeProvider } from "../frames/frame-notices.js";
import { CanvasMap } from "../components/CanvasMap.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
it("leases Explorer, Map and Zoom into actual Frame hosts and ties grid geometry to the camera", async () => {
  const view = render(<FrameSlotProvider><FrameNoticeProvider><Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} />
    <div data-test-dock=""><FrameModuleOutlet id="explorer" /><FrameModuleOutlet id="map" /><FrameModuleOutlet id="zoom" /></div>
  </FrameNoticeProvider></FrameSlotProvider>);
  await screen.findByRole("link", { name: "Tokens" });
  expect(screen.getByRole("treegrid", { name: labels.treeLabel })).toBeInTheDocument();
  expect(screen.getByRole("toolbar", { name: labels.canvas.zoomLabel })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: labels.canvas.minimap }).closest("[data-test-dock]")).not.toBeNull();
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
