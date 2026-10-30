import { createRef, Profiler } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCanvas, type SystemCanvasHandle, type SystemCanvasProps } from "./SystemCanvas.js";
import { testLabels, testPlacements } from "./__fixtures__/system.js";
import { studioTestCopy } from "../__fixtures__/copy.js";

import type { Placement } from "../../catalog-core/index.js";
import type { StudioCopyBinding, StudioCopyRef } from "../copy-binding.js";
import { systemLayout } from "./layout.js";

// Synthetic host messages retain this interaction fixture's existing labels.
// They are test data, not Writer records or a production fallback.
function fixtureCopy(placements: readonly Placement[]): StudioCopyBinding {
  const messages: Record<string, StudioCopyRef> = {};
  const text = new Map<string, string>();
  const add = (cell: string, value: string) => {
    const id = `fixture.message-${text.size}`;
    messages[cell] = { id }; text.set(id, value);
  };
  const layout = systemLayout(placements);
  for (const board of layout.boards.values()) add(`studio.ia.board.${board.id}`, board.label);
  for (const line of layout.lines.values()) add(`studio.ia.line.${line.id}`, line.label);
  for (const cell of layout.cells.values()) {
    add(`studio.ia.item.${cell.leaf}`, cell.leaf);
  }
  return { ...studioTestCopy, messages, resolver(ref) {
    const value = text.get(ref.id);
    return value === undefined ? studioTestCopy.resolver(ref)
      : { ref, text: value, servedLocale: ref.locale, chain: [ref.locale!] };
  } };
}

// Default (token) geometry: a cell is 320 x 240 world pixels.
// A4-DE-PREVIEW retains readable captions at the System stop (minimum 0.75)
// instead of fitting this large world down to far chips. Board navigation and
// held-tier transitions still apply; viewport culling keeps off-screen boards out.
const small = { width: 400, height: 300 }, large = { width: 1200, height: 800 };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<SystemCanvasProps> = {}) {
  const handle = createRef<SystemCanvasHandle>();
  const props: SystemCanvasProps = { copy: fixtureCopy(testPlacements), data: { placements: testPlacements }, labels: testLabels, viewSize: small, handleRef: handle, ...overrides };
  const result = render(<SystemCanvas {...props} />);
  const world = result.container.querySelector<HTMLElement>("[data-canvas-world]")!;
  const navigate = (target: Parameters<SystemCanvasHandle["navigateTo"]>[0]) => act(() => handle.current!.navigateTo(target));
  const tiers = () => [...result.container.querySelectorAll<HTMLElement>("[data-system-cell]")].map(cell => [cell.dataset.systemCell, cell.dataset.systemTier]);
  return { ...result, world, navigate, tiers, handle };
}

describe("SystemCanvas", () => {
  it("renders a real rest thumbnail for a visible composition when no static capture is supplied", () => {
    media.matches = true;
    const renderThumbnail = vi.fn((leaf: string) => <span data-rest={leaf}>{leaf}</span>);
    const { container, navigate } = setup({ viewSize: large, renderThumbnail });
    navigate({ layer: "sections", l1: "parts" });
    expect(container.querySelector('[data-system-cell^="sections."] [data-rest]')).not.toBeNull();
    expect(container.querySelector('[data-system-cell^="sections."] [data-system-thumbnail="pending"]')).toBeNull();
    navigate({ layer: "frames", l1: "page-shells" });
    expect(container.querySelector('[data-system-cell="frames.site-shell"] [data-rest="frames.site-shell"]')).not.toBeNull();
  });

  it("prefers a supplied static thumbnail over the rest-state fallback", () => {
    media.matches = true;
    const renderThumbnail = vi.fn((leaf: string) => <span data-rest={leaf}>{leaf}</span>);
    const renderStaticThumbnail = vi.fn((leaf: string) => <span data-capture={leaf}>{leaf}</span>);
    const { container, navigate } = setup({ viewSize: large, renderThumbnail, renderStaticThumbnail });
    navigate({ layer: "frames", l1: "page-shells" });
    const cell = container.querySelector('[data-system-cell="frames.site-shell"]')!;
    expect(cell.querySelector('[data-capture="frames.site-shell"]')).not.toBeNull();
    expect(cell.querySelector("[data-rest]")).toBeNull();
    expect(cell.querySelector("[data-system-rest-preview]")).toHaveAttribute("inert");
  });

  it("clamps rail and map viewport requests to the same legible range", () => {
    media.matches = true;
    const onViewChange = vi.fn();
    const { handle } = setup({ onViewChange });
    act(() => handle.current!.setViewport({ x: 0, y: 0, zoom: 0.01 }));
    expect(onViewChange.mock.lastCall?.[0].viewport.zoom).toBeGreaterThanOrEqual(0.75);
    act(() => handle.current!.setViewport({ x: 0, y: 0, zoom: 20 }));
    expect(onViewChange.mock.lastCall?.[0].viewport.zoom).toBe(1);
  });
  it("opens at the System centre with legible specimens and keeps off-screen boards unmounted", () => {
    const onViewChange = vi.fn();
    const { container, tiers } = setup({ onViewChange });
    expect(onViewChange.mock.lastCall?.[0].viewport.zoom).toBe(0.75);
    expect(container.querySelectorAll("[data-system-board]").length).toBeLessThan(6);
    expect(tiers().length).toBeGreaterThan(0);
    expect(tiers().every(([, tier]) => tier === "near" || tier === "mid")).toBe(true);
  });

  it("snaps with reduced motion: no transition, the new detail at once", () => {
    media.matches = true;
    const { world, navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(world).not.toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("0s");
    expect(tiers()).toContainEqual(["tokens.status-color", "near"]);
  });

  it("eases one move with the motion tokens and swaps detail only when the move ends", () => {
    const { world, navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(world).toHaveClass("transition-transform");
    expect(world.style.transitionDuration).toBe("var(--ui-duration-default)");
    expect(world.style.transitionTimingFunction).toBe("var(--ease-decelerate)");
    expect(tiers()).toContainEqual(["tokens.status-color", "mid"]);
    fireEvent.transitionEnd(world);
    expect(world).not.toHaveClass("transition-transform");
    expect(tiers()).toContainEqual(["tokens.status-color", "near"]);
  });

  it("releases the held detail on a fallback timer when the transition never reports its end", () => {
    vi.useFakeTimers();
    const { navigate, tiers } = setup();
    navigate({ layer: "tokens", l1: "color" });
    expect(tiers()).toContainEqual(["tokens.status-color", "mid"]);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tiers()).toContainEqual(["tokens.status-color", "near"]);
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
    media.matches = true;
    const { container, navigate } = setup({ viewSize: large, selectedLeaf: "components.button", edges: [{ from: "components.button", to: "tokens.spacing" }] });
    navigate({ layer: "components", l1: "actions" });
    const cell = (leaf: string) => container.querySelector<HTMLElement>(`[data-system-cell="${leaf}"]`)!;
    expect(cell("components.menu").style.opacity).not.toBe("");
    expect(cell("components.button").style.opacity).toBe("");
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

it("mounts the measured SystemCanvas without ref loops and ignores unchanged resize notifications", () => {
  let width = 400, height = 300;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-canvas-surface") ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-canvas-surface") ? height : 0;
  });
  const observers: TestResizeObserver[] = [];
  class TestResizeObserver {
    element?: Element;
    disconnect = vi.fn();
    constructor(readonly notify: () => void) { observers.push(this); }
    observe(element: Element) { this.element = element; }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const onViewChange = vi.fn();
  const props: SystemCanvasProps = { copy: fixtureCopy(testPlacements), data: { placements: testPlacements }, labels: testLabels, onViewChange };
  let commits = 0;
  const canvas = (selectedLeaf?: string) => <Profiler id="measured-canvas" onRender={() => { commits++; }}>
    <SystemCanvas {...props} selectedLeaf={selectedLeaf} />
  </Profiler>;
  const result = render(canvas());
  const surface = result.container.querySelector("[data-canvas-surface]")!;
  expect(surface).not.toBeNull();
  expect(onViewChange.mock.lastCall?.[0].size).toEqual({ width, height });
  const active = observers.filter(observer => observer.element === surface);
  expect(active.length).toBeGreaterThan(0);
  const notify = () => act(() => { active.forEach(observer => observer.notify()); });
  // Include the observer's initial delivery before measuring idle behaviour.
  notify();
  const idleCommits = commits;
  for (let index = 0; index < 3; index++) notify();
  expect(commits).toBe(idleCommits);

  result.rerender(canvas("tokens.spacing"));
  expect(observers).toHaveLength(active.length);
  expect(active.every(observer => observer.disconnect.mock.calls.length === 0)).toBe(true);
  width = 640; notify();
  expect(onViewChange.mock.lastCall?.[0].size).toEqual({ width: 640, height: 300 });
  height = 480; notify();
  expect(onViewChange.mock.lastCall?.[0].size).toEqual({ width: 640, height: 480 });
  notify();
  const resizedCommits = commits;
  notify();
  expect(commits).toBe(resizedCommits);
  result.unmount();
  for (const observer of active) expect(observer.disconnect).toHaveBeenCalledOnce();
});
