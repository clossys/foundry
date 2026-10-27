import { afterEach, describe, expect, it } from "vitest";
import { createStudioCamera } from "./camera.js";

const disposers: (() => void)[] = [];
const setup = () => {
  const viewport = document.createElement("div"); const world = document.createElement("div"); viewport.append(world); document.body.append(viewport);
  Object.defineProperties(viewport, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  Object.defineProperties(world, { offsetWidth: { value: 4000 }, offsetHeight: { value: 2000 } });
  const camera = createStudioCamera({ viewport, world }); disposers.push(camera.destroy); return { viewport, world, camera };
};
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
describe("Studio imperative camera", () => {
  it("fits container bounds, clamps the lower zoom and preserves zoom anchors", () => {
    const { camera, world } = setup(); camera.fit(); expect(camera.read().zoom).toBeCloseTo(.25);
    const before = camera.read(); camera.zoom(2, { x: 200, y: 100 }); const after = camera.read();
    expect(after.zoom).toBeCloseTo(.5); expect((200-after.x)/after.zoom).toBeCloseTo((200-before.x)/before.zoom);
    camera.zoom(.001); expect(camera.read().zoom).toBe(.12); expect(world.style.transform).toContain("scale(0.12)");
  });
  it("pans wheel and keyboard imperatively, ignores field arrows and exposes stable semantic levels", () => {
    const { camera, viewport, world } = setup(); const child = document.createElement("div"); child.dataset.studioZoomFull = ""; world.append(child);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true })); expect(camera.read().y).toBe(-40);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); expect(camera.read().x).toBe(-100);
    const input = document.createElement("input"); viewport.append(input); input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); expect(camera.read().x).toBe(-100);
    camera.zoom(.4); expect(world.dataset.semantic).toBe("summary"); expect(child.style.visibility).toBe("hidden");
    camera.zoom(2); expect(world.dataset.semantic).toBe("quiet"); camera.zoom(2); expect(world.dataset.semantic).toBe("full");
    expect(child.parentElement).toBe(world);
  });
  it("centres a target without native page scrolling and removes fly animation for reduced motion", () => {
    const { camera, viewport, world } = setup(); const item = document.createElement("section"); world.append(item);
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 } as DOMRect);
    item.getBoundingClientRect = () => ({ left: 1500, top: 1000, width: 400, height: 200 } as DOMRect);
    camera.flyTo(item, { reducedMotion: true }); expect(camera.read()).toMatchObject({ x: -1200, y: -700 }); expect(world.style.transition).toBe("none");
    camera.flyTo(item, { reducedMotion: false }); expect(world.style.transition).toBe("transform var(--ui-duration-default) var(--ease-default)");
  });
  it("drags and pinches with tracked pointers, then stops on cancellation", () => {
    const { camera, viewport } = setup();
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0 });
      viewport.dispatchEvent(event);
    };
    pointer("pointerdown", 1, 100, 100); pointer("pointermove", 1, 120, 140);
    expect(camera.read()).toEqual({ x: 20, y: 40, zoom: 1 });
    pointer("pointerdown", 2, 220, 140); pointer("pointermove", 2, 320, 140);
    expect(camera.read().zoom).toBe(2);
    pointer("pointercancel", 1, 120, 140); pointer("pointerup", 2, 320, 140);
    const ended = camera.read(); pointer("pointermove", 2, 400, 140);
    expect(camera.read()).toEqual(ended);
  });
  it("handles command-wheel and keyboard zoom and fit, and removes gesture listeners", () => {
    const { camera, viewport } = setup();
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -30, metaKey: true, cancelable: true }));
    expect(camera.read().zoom).toBeGreaterThan(1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
    const smaller = camera.read().zoom;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+" })); expect(camera.read().zoom).toBeGreaterThan(smaller);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "0" })); expect(camera.read().zoom).toBe(.25);
    camera.destroy(); const ended = camera.read();
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 80 })); expect(camera.read()).toEqual(ended);
  });
});
