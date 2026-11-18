import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBackdropElement } from "../../backdrop/contract.js";
import { INTERACTIVE_BACKDROP_COMPONENT_IDS, type InteractiveBackdropDescriptor } from "../../tokens/interactive-backdrops.js";
import { GRADIENT_MESH_MAX_DURATION, gradientMeshDuration, InteractiveBackdrop } from "./InteractiveBackdrop.js";
import { InteractiveBackdrop as InteractiveBackdropBoundary } from "./interactive-backdrop-boundary.js";

const descriptors: Record<(typeof INTERACTIVE_BACKDROP_COMPONENT_IDS)[number], InteractiveBackdropDescriptor> = {
  "particle-field": { component: "particle-field", params: { links: true, density: 24 } },
  "gradient-mesh": { component: "gradient-mesh", params: { intensity: 0.4 } },
  "grid-glow": { component: "grid-glow", params: { pulse: true } },
};
const motion = (reduced: boolean) => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })));

let raf: ReturnType<typeof vi.fn>;
let animate: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.fn>;
let addListener: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  raf = vi.fn(() => 7);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  cancel = vi.fn();
  animate = vi.fn(() => ({ cancel }));
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  getContext = vi.fn(() => context);
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = getContext;
  addListener = vi.spyOn(window, "addEventListener");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});
const pointerListeners = () => addListener.mock.calls.filter(([type]) => type === "pointermove");

describe("Foundry interactive backdrops (foundry-build-0048 A4)", () => {
  it.each(INTERACTIVE_BACKDROP_COMPONENT_IDS)("%s renders a still, decorative frame on the server", component => {
    const html = renderToString(<InteractiveBackdrop descriptor={descriptors[component]} />);
    expect(html).toContain(`data-interactive-backdrop="${component}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-motion="static"');
    expect(html).toMatch(/pointer-events:\s*none/);
    expect(html).not.toMatch(/<canvas|tabindex|<a |<button|<input/);
    // Colour is a token utility, never an inline value.
    expect(html).not.toMatch(/style="[^"]*(?:color|fill|stroke|background)/);
  });

  it.each(INTERACTIVE_BACKDROP_COMPONENT_IDS)("%s under prefers-reduced-motion is the still frame and starts nothing", component => {
    motion(true);
    const { container } = render(<InteractiveBackdrop descriptor={descriptors[component]} />);
    const layer = container.querySelector(`[data-interactive-backdrop="${component}"]`)!;
    expect(layer.getAttribute("data-motion")).toBe("static");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(container.querySelector("canvas")).toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(pointerListeners()).toEqual([]);
  });

  it.each(INTERACTIVE_BACKDROP_COMPONENT_IDS)("%s without matchMedia stays still", component => {
    vi.stubGlobal("matchMedia", undefined);
    const { container } = render(<InteractiveBackdrop descriptor={descriptors[component]} />);
    expect(container.querySelector("[data-interactive-backdrop]")!.getAttribute("data-motion")).toBe("static");
    expect(raf).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it("particle-field animates a canvas when motion is welcome, and stops on unmount", () => {
    motion(false);
    const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors["particle-field"]} />);
    const layer = container.querySelector('[data-interactive-backdrop="particle-field"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    const canvas = layer.querySelector("canvas")!;
    expect(canvas).toHaveClass("text-primary");
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => { (raf.mock.calls[0]![0] as FrameRequestCallback)(16); });
    expect(raf).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });

  it("particle-field at speed 0 is the still frame even when motion is welcome", () => {
    motion(false);
    const { container } = render(<InteractiveBackdrop descriptor={{ component: "particle-field", params: { speed: 0 } }} />);
    expect(container.querySelector("[data-interactive-backdrop]")!.getAttribute("data-motion")).toBe("static");
    expect(container.querySelector("canvas")).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it("gradient-mesh drifts its three fields when motion is welcome, and cancels on unmount", () => {
    motion(false);
    const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors["gradient-mesh"]} />);
    const layer = container.querySelector('[data-interactive-backdrop="gradient-mesh"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(animate).toHaveBeenCalledTimes(3);
    expect([...layer.children].map(child => [...child.classList].find(name => name.startsWith("bg-")))).toEqual(["bg-primary", "bg-accent", "bg-secondary"]);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("grid-glow follows the pointer and pulses when motion is welcome, and detaches on unmount", () => {
    motion(false);
    const remove = vi.spyOn(window, "removeEventListener");
    const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors["grid-glow"]} />);
    const layer = container.querySelector('[data-interactive-backdrop="grid-glow"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    const glow = layer.querySelector<HTMLElement>("[data-grid-glow]")!;
    vi.spyOn(glow.parentElement!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} });
    expect(pointerListeners()).toHaveLength(1);
    act(() => { window.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 75 })); });
    expect(glow.style.left).toBe("25%");
    expect(glow.style.top).toBe("75%");
    expect(animate).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "pointermove")).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("grid-glow with neither follow nor pulse is still", () => {
    motion(false);
    const { container } = render(<InteractiveBackdrop descriptor={{ component: "grid-glow", params: { follow: false, pulse: false } }} />);
    expect(container.querySelector("[data-interactive-backdrop]")!.getAttribute("data-motion")).toBe("static");
    expect(pointerListeners()).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("drops an invalid descriptor: it paints nothing and never throws", () => {
    for (const descriptor of [
      { component: "three-scene", params: {} },
      { component: "particle-field", params: { color: "https://example.com/x.js" } },
      { component: "grid-glow", params: { cell: 4 } },
      { component: "gradient-mesh", params: {}, script: "x" },
      Object.create({ component: "grid-glow", params: {} }),
    ]) {
      expect(renderToString(<InteractiveBackdrop descriptor={descriptor as never} />), JSON.stringify(descriptor)).toBe("");
    }
  });

  it("gradient-mesh drift duration is always finite, even at a denormal speed", () => {
    expect(gradientMeshDuration(1)).toBe(24000);
    expect(gradientMeshDuration(0.5)).toBe(48000);
    for (const speed of [5e-324, 1e-300, 0.001]) expect(gradientMeshDuration(speed), String(speed)).toBe(GRADIENT_MESH_MAX_DURATION);
    motion(false);
    render(<InteractiveBackdrop descriptor={{ component: "gradient-mesh", params: { speed: 5e-324 } }} />);
    expect(animate).toHaveBeenCalledTimes(3);
    for (const [, options] of animate.mock.calls as [unknown, { duration: number }][]) expect(Number.isFinite(options.duration)).toBe(true);
  });
});

describe("server-safe boundary (foundry-build-0048 A4)", () => {
  // Hero reaches the components through this boundary; react-server keeps a deferred reference
  // (render-environment and hero-rsc-boundary probe that), every other renderer gets the component itself.
  it("resolves the client component synchronously where React has createContext", () => {
    expect(InteractiveBackdropBoundary).toBe(InteractiveBackdrop);
  });
});
