import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCanvas, type SystemCanvasHandle, type SystemCanvasProps } from "./SystemCanvas.js";
import { testLabels, testPlacements } from "./__fixtures__/system.js";
import { studioTestCopy } from "../__fixtures__/copy.js";

// Default (token) geometry: a cell is 320 x 240 world pixels.
// In a 400 x 300 view the System stop draws every cell far; the tokens/color Board stop draws them mid.
// In a 1200 x 800 view a Board stop draws cells near.
const small = { width: 400, height: 300 }, large = { width: 1200, height: 800 };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<SystemCanvasProps> = {}) {
  const handle = createRef<SystemCanvasHandle>();
  const props: SystemCanvasProps = { copy: studioTestCopy, data: { placements: testPlacements }, labels: testLabels, viewSize: small, handleRef: handle, ...overrides };
  const result = render(<SystemCanvas {...props} />);
  const world = result.container.querySelector<HTMLElement>("[data-canvas-world]")!;
  const navigate = (target: Parameters<SystemCanvasHandle["navigateTo"]>[0]) => act(() => handle.current!.navigateTo(target));
  const tiers = () => [...result.container.querySelectorAll<HTMLElement>("[data-system-cell]")].map(cell => [cell.dataset.systemCell, cell.dataset.systemTier]);
  return { ...result, world, navigate, tiers, handle };
}

describe("SystemCanvas", () => {
  it("opens at the System stop with every board as one far chip grid and no per-cell elements", () => {
    const { container, tiers } = setup();
    expect(container.querySelectorAll("[data-system-board]")).toHaveLength(6);
    expect(container.querySelectorAll("svg[data-system-chips]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-canvas-chip]")).toHaveLength(14);
    expect(tiers()).toEqual([]);
  });

  it("snaps with reduced motion: no transition, the new detail at once", () => {
    media.matches = true;
    const { world, navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(world).not.toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("0s");
    expect(tiers()).toContainEqual(["tokens.status-color", "mid"]);
  });

  it("eases one move with the motion tokens and swaps detail only when the move ends", () => {
    const { world, navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(world).toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("var(--ui-duration-default)");
    expect(world.style.transitionTimingFunction).toBe("var(--ease-decelerate)");
    expect(tiers()).toEqual([]);
    fireEvent.transitionEnd(world);
    expect(world).not.toHaveClass("transition-transform");
    expect(tiers()).toContainEqual(["tokens.status-color", "mid"]);
  });

  it("releases the held detail on a fallback timer when the transition never reports its end", () => {
    vi.useFakeTimers();
    const { navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(tiers()).toEqual([]);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tiers()).toContainEqual(["tokens.status-color", "mid"]);
  });

  it("does not move when the target is already on screen at its stop", () => {
    const { world, navigate } = setup();
    navigate({ layer: "tokens", l1: "color" }); fireEvent.transitionEnd(world);
    const transform = world.style.transform;
    navigate({ layer: "tokens", l1: "color" });
    expect(world).not.toHaveClass("transition-transform");
    expect(world.style.transform).toBe(transform);
  });

  it("selects an L3 target and marks its arrival with a ring that clears", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const { container, navigate } = setup({ onSelect });
    navigate({ layer: "tokens", leaf: "tokens.status-color" });
    expect(onSelect).toHaveBeenCalledWith("tokens.status-color");
    expect(container.querySelector("[data-system-ring]")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector("[data-system-ring]")).toBeNull();
  });

  it("mounts no off-screen board", () => {
    media.matches = true;
    const { container, navigate } = setup({ viewSize: large });
    navigate({ layer: "sections", l1: "parts" });
    expect(container.querySelector('[data-system-board="sections/parts"]')).not.toBeNull();
    expect(container.querySelector('[data-system-board="tokens/color"]')).toBeNull();
    expect(container.querySelector('[data-system-cell="tokens.status-color"]')).toBeNull();
  });

  it("mounts live specimens only for near Tokens, Assets and Components cells; Sections and Frames never mount live", () => {
    media.matches = true;
    const renderSpecimen = vi.fn((leaf: string) => <span data-live={leaf}>{leaf}</span>);
    const { container, navigate, tiers } = setup({ viewSize: large, renderSpecimen });
    navigate({ layer: "tokens", l1: "color" });
    expect(container.querySelector('[data-live="tokens.status-color"]')).not.toBeNull();
    expect(tiers()).toContainEqual(["tokens.status-color", "near"]);
    navigate({ layer: "sections", l1: "parts" });
    navigate({ layer: "frames", l1: "page-shells" });
    expect(renderSpecimen.mock.calls.map(call => call[0]).filter(leaf => /^(sections|frames)\./.test(leaf))).toEqual([]);
    expect(tiers()).toContainEqual(["frames.site-shell", "mid"]);
    expect(container.querySelector('[data-system-cell="frames.site-shell"] [data-system-thumbnail="pending"]')).not.toBeNull();
  });

  it("shows the Layer > L1 > L2 breadcrumb for the viewport", () => {
    media.matches = true;
    const { navigate } = setup({ viewSize: large });
    navigate({ layer: "tokens", l1: "color", l2: "color-palettes" });
    const trail = screen.getByRole("navigation", { name: "Canvas position" });
    expect(trail).toHaveTextContent(/Tokens.*Color.*Palettes/);
  });

  it("dims leaves outside the selection's lit set", () => {
    const { container } = setup({ selectedLeaf: "tokens.spacing", edges: [{ from: "components.button", to: "tokens.spacing" }] });
    const chip = (leaf: string) => container.querySelector<SVGElement>(`[data-canvas-chip="${leaf}"]`)!;
    expect(chip("components.menu").style.opacity).not.toBe("");
    expect(chip("components.button").style.opacity).toBe("");
    expect(chip("tokens.spacing").style.opacity).toBe("");
  });

  it("selects a cell from its name", () => {
    media.matches = true;
    const onSelect = vi.fn();
    const { navigate } = setup({ onSelect });
    navigate({ layer: "tokens", l1: "color" });
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "tokens.accent-color" }));
    expect(onSelect).toHaveBeenCalledWith("tokens.accent-color");
  });
});
