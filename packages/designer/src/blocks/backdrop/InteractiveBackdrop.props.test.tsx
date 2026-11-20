import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What each adopted source component received, by its export name. */
const received = vi.hoisted(() => ({ calls: [] as { name: string; props: Record<string, unknown> }[] }));
const stub = (name: string) => (props: Record<string, unknown>) => { received.calls.push({ name, props }); return <i data-stub={name} />; };
vi.mock("../../components/partners/magicui/particles.js", () => ({ Particles: stub("Particles") }));
vi.mock("../../components/partners/magicui/flickering-grid.js", () => ({ FlickeringGrid: stub("FlickeringGrid") }));
vi.mock("../../components/partners/magicui/grid-pattern.js", () => ({ GridPattern: stub("GridPattern") }));
vi.mock("./GradientMesh.js", () => ({ GradientMesh: stub("GradientMesh") }));

const { InteractiveBackdrop } = await import("./InteractiveBackdrop.js");

const motion = (reduced: boolean) => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })));
const last = (name: string) => received.calls.filter(call => call.name === name).at(-1)?.props;

beforeEach(() => {
  received.calls = [];
  const context = { fillStyle: "", fillRect: vi.fn(), getImageData: () => ({ data: [255, 0, 128, 255] }) };
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = vi.fn(() => context);
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => (element instanceof HTMLElement && element.hasAttribute("data-backdrop-probe") ? ({ color: "rgb(255, 0, 128)" } as CSSStyleDeclaration) : computed(element)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("descriptor params reach the source component's own props as the record maps them (U23)", () => {
  it("particles: resolved defaults, the painted hex colour and the record's fixed props", () => {
    motion(false);
    render(<InteractiveBackdrop descriptor={{ component: "particles", params: { quantity: 30, vx: 0.5 } }} />);
    expect(last("Particles")).toEqual({ color: "#ff0080", quantity: 30, staticity: 50, ease: 50, size: 0.4, vx: 0.5, vy: 0, className: "absolute inset-0" });
  });

  it("flickering-grid: its schema params, and under reduced motion the record's still props win", () => {
    motion(false);
    render(<InteractiveBackdrop descriptor={{ component: "flickering-grid", params: { flickerChance: 0.6 } }} />);
    expect(last("FlickeringGrid")).toEqual({ color: "#ff0080", squareSize: 4, gridGap: 6, flickerChance: 0.6, maxOpacity: 0.3, className: "absolute inset-0" });
    motion(true);
    render(<InteractiveBackdrop descriptor={{ component: "flickering-grid", params: { flickerChance: 0.6 } }} />);
    expect(last("FlickeringGrid")).toMatchObject({ flickerChance: 0 });
  });

  it("grid-pattern: no colour prop (it paints with the layer's currentColor), only its mapped sizes", () => {
    motion(false);
    const { container } = render(<InteractiveBackdrop descriptor={{ component: "grid-pattern", params: { color: "accent", width: 20 } }} />);
    expect(last("GridPattern")).toEqual({ width: 20, height: 40, className: "fill-current/20 stroke-current/30" });
    expect(container.querySelector("[data-interactive-backdrop]")).toHaveClass("text-accent");
  });

  it("gradient-mesh: token names pass through as tokens, and reduced motion is the component's own", () => {
    motion(true);
    render(<InteractiveBackdrop descriptor={{ component: "gradient-mesh", params: { via: "border" } }} />);
    expect(last("GradientMesh")).toEqual({ from: "primary", via: "border", to: "secondary", speed: 0.5, intensity: 0.5 });
  });

  it("a colour that cannot be painted holds the source component back rather than guessing", () => {
    motion(false);
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = vi.fn(() => null);
    const { container } = render(<InteractiveBackdrop descriptor={{ component: "particles", params: {} }} />);
    expect(container.querySelector('[data-interactive-backdrop="particles"]')).not.toBeNull();
    expect(last("Particles")).toBeUndefined();
  });
});
