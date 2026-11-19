import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBackdropElement } from "../../backdrop/contract.js";
import { BACKDROP_REGISTRY, INTERACTIVE_BACKDROP_COMPONENT_IDS, type InteractiveBackdropDescriptor } from "../../tokens/interactive-backdrops.js";
import { BACKDROP_RENDERER_KEYS, backdropRendererKey, InteractiveBackdrop } from "./InteractiveBackdrop.js";
import { GRADIENT_MESH_MAX_DURATION, gradientMeshDuration } from "./GradientMesh.js";
import { InteractiveBackdrop as InteractiveBackdropBoundary } from "./interactive-backdrop-boundary.js";

const descriptors: Record<string, InteractiveBackdropDescriptor> = {
  particles: { component: "particles", params: { quantity: 24 } },
  "flickering-grid": { component: "flickering-grid", params: { squareSize: 6 } },
  "grid-pattern": { component: "grid-pattern", params: { width: 32 } },
  "gradient-mesh": { component: "gradient-mesh", params: { intensity: 0.4 } },
};
const motion = (reduced: boolean) => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })));

let raf: ReturnType<typeof vi.fn>;
let animate: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.fn>;
let observed: string[];
beforeEach(() => {
  raf = vi.fn(() => 7);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  observed = [];
  class Observer { constructor(readonly kind: string) {} observe() { observed.push(this.kind); } disconnect() {} unobserve() {} }
  vi.stubGlobal("ResizeObserver", class extends Observer { constructor() { super("resize"); } });
  vi.stubGlobal("IntersectionObserver", class extends Observer { constructor() { super("intersection"); } });
  cancel = vi.fn();
  animate = vi.fn(() => ({ cancel }));
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  // Every 2D call is a no-op; a 1x1 read-back paints the probe colour rgb(10, 20, 30).
  const calls: Record<string | symbol, unknown> = { getImageData: () => ({ data: [10, 20, 30, 255] }) };
  const context = new Proxy(calls, { get: (target, key) => (key in target ? target[key] : (target[key] = vi.fn())), set: (target, key, value) => { target[key] = value; return true; } });
  getContext = vi.fn(() => context);
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = getContext;
  const computed = window.getComputedStyle.bind(window);
  // The probe reports its painted colour; every other property reads as unset, as a real declaration would.
  const probe = { color: "rgb(10, 20, 30)", getPropertyValue: (name: string) => (name === "color" ? "rgb(10, 20, 30)" : "") };
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => (element instanceof HTMLElement && element.hasAttribute("data-backdrop-probe") ? (probe as unknown as CSSStyleDeclaration) : computed(element)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

describe("the adapter renders adopted registry records (foundry-build-0048 U23)", () => {
  it("ships exactly one renderer per registry record, keyed by the record's source", () => {
    expect([...BACKDROP_RENDERER_KEYS].sort()).toEqual(BACKDROP_REGISTRY.components.map(backdropRendererKey).sort());
    expect(BACKDROP_REGISTRY.components.map(backdropRendererKey)).toEqual(["magicui/particles", "magicui/flickering-grid", "magicui/grid-pattern", "foundry/GradientMesh"]);
  });

  it.each(INTERACTIVE_BACKDROP_COMPONENT_IDS.filter(id => id !== "particles"))("%s renders a still, decorative layer on the server", component => {
    const html = renderToString(<InteractiveBackdrop descriptor={descriptors[component]!} />);
    expect(html).toContain(`data-interactive-backdrop="${component}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-motion="static"');
    expect(html).toMatch(/pointer-events:\s*none/);
    expect(html).not.toMatch(/tabindex|<a |<button|<input/);
    // Colour is a token utility, never an inline value.
    expect(html).not.toMatch(/style="[^"]*(?:color|fill|stroke|background)/);
  });

  it("particles (reduced motion: omit) renders no layer on the server, where motion reads as reduced", () => {
    expect(renderToString(<InteractiveBackdrop descriptor={descriptors.particles!} />)).toBe("");
  });

  it("particles: an adopted Magic UI canvas in the painted token colour when motion is welcome", () => {
    motion(false);
    const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors.particles!} />);
    const layer = container.querySelector('[data-interactive-backdrop="particles"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(layer.querySelector('[data-backdrop-probe="color"]')).toHaveClass("text-primary");
    expect(layer.querySelector("canvas")).not.toBeNull();
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(raf).toHaveBeenCalled();
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });

  it("particles under prefers-reduced-motion renders no layer and starts nothing", () => {
    motion(true);
    const { container } = render(<InteractiveBackdrop descriptor={descriptors.particles!} />);
    expect(container.querySelector("[data-interactive-backdrop]")).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it("flickering-grid animates its own canvas when motion is welcome, and is held still under reduced motion", () => {
    motion(false);
    const live = render(<InteractiveBackdrop descriptor={descriptors["flickering-grid"]!} />);
    const layer = live.container.querySelector('[data-interactive-backdrop="flickering-grid"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(layer.querySelector("canvas")).not.toBeNull();
    expect(observed).toEqual(expect.arrayContaining(["resize", "intersection"]));
    live.unmount();
    motion(true);
    const still = render(<InteractiveBackdrop descriptor={descriptors["flickering-grid"]!} />);
    const stillLayer = still.container.querySelector('[data-interactive-backdrop="flickering-grid"]')!;
    expect(stillLayer.getAttribute("data-motion")).toBe("static");
    expect(checkBackdropElement(stillLayer)).toMatchObject({ ok: true });
  });

  it("grid-pattern is a static SVG painted through the layer's currentColor", () => {
    motion(false);
    const { container } = render(<InteractiveBackdrop descriptor={{ component: "grid-pattern", params: { color: "border", width: 24, height: 48 } }} />);
    const layer = container.querySelector('[data-interactive-backdrop="grid-pattern"]')!;
    expect(layer.getAttribute("data-motion")).toBe("static");
    expect(layer).toHaveClass("text-border");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    const pattern = layer.querySelector("svg pattern")!;
    expect(pattern.getAttribute("width")).toBe("24");
    expect(pattern.getAttribute("height")).toBe("48");
    expect(layer.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(raf).not.toHaveBeenCalled();
  });

  it("gradient-mesh drifts its three fields when motion is welcome, holds them still when reduced, and cancels on unmount", () => {
    motion(false);
    const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors["gradient-mesh"]!} />);
    const layer = container.querySelector('[data-interactive-backdrop="gradient-mesh"]')!;
    expect(layer.getAttribute("data-motion")).toBe("animated");
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(animate).toHaveBeenCalledTimes(3);
    const mesh = layer.querySelector("[data-gradient-mesh]")!;
    expect([...mesh.children].map(child => [...child.classList].find(name => name.startsWith("bg-")))).toEqual(["bg-primary", "bg-accent", "bg-secondary"]);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    animate.mockClear();
    motion(true);
    const still = render(<InteractiveBackdrop descriptor={descriptors["gradient-mesh"]!} />);
    expect(still.container.querySelector("[data-gradient-mesh]")!.getAttribute("data-gradient-mesh")).toBe("static");
    expect(animate).not.toHaveBeenCalled();
  });

  it("without matchMedia every layer stays still", () => {
    vi.stubGlobal("matchMedia", undefined);
    for (const component of INTERACTIVE_BACKDROP_COMPONENT_IDS) {
      const { container, unmount } = render(<InteractiveBackdrop descriptor={descriptors[component]!} />);
      const layer = container.querySelector("[data-interactive-backdrop]");
      if (layer) expect(layer.getAttribute("data-motion"), component).toBe("static");
      unmount();
    }
    expect(animate).not.toHaveBeenCalled();
  });

  it("drops an invalid descriptor: it paints nothing and never throws", () => {
    for (const descriptor of [
      { component: "three-scene", params: {} },
      { component: "particle-field", params: {} },
      { component: "particles", params: { color: "https://example.com/x.js" } },
      { component: "flickering-grid", params: { squareSize: 1 } },
      { component: "gradient-mesh", params: {}, script: "x" },
      Object.create({ component: "flickering-grid", params: {} }),
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
