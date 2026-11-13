import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StatGroup } from "../StatGroup.js";
import { nativeStatsMarkup, nativeStatsSelection, nativeStatsTree } from "./__fixtures__/native.js";

let selection: Awaited<ReturnType<typeof nativeStatsSelection>>;
beforeAll(async () => { selection = await nativeStatsSelection(); });
const items = [{ id: "customers", label: "ExampleCo customers", value: "2,481", countTo: 2481 }];
let enter: IntersectionObserverCallback, node: Element, frames: FrameRequestCallback[], reduced: boolean, change: () => void;
let observe: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  frames = []; reduced = false; observe = vi.fn(); disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { enter = callback; }
    observe(value: HTMLElement) { node = value; value.style.setProperty("--ui-duration-default", "240ms"); observe(value); }
    disconnect() { disconnect(); }
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return reduced; }, addEventListener: (_: string, callback: () => void) => { change = callback; }, removeEventListener: vi.fn() })));
  document.documentElement.style.setProperty("--ui-duration-default", "240ms");
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty("--ui-duration-default"); });
function intersect(visible = true) {
  act(() => { enter([{ target: node, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver); });
}
describe("Stats opt-in count", () => {
  it("ships the final authored value in SSR without zero or a hidden duplicate", async () => {
    const html = await nativeStatsMarkup(selection, <StatGroup aria-label="ExampleCo figures" items={items} motion="count" />);
    expect(html).toContain("2,481");
    expect(html).not.toMatch(/>0<|sr-only|aria-hidden/);
    expect(html).toMatch(/<section[^>]+data-ds-leaf="sections.stats"/);
  });
  it("stays static by default without a viewport observer", async () => {
    render(nativeStatsTree(selection, <StatGroup items={items} />));
    await screen.findByText("2,481");
    expect(observe).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("counts after entry, preserves the accessible final value, and runs once", async () => {
    const view = render(nativeStatsTree(selection, <StatGroup items={items} motion="count" />));
    await screen.findByText("2,481");
    expect(observe).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    intersect(false); expect(requestAnimationFrame).not.toHaveBeenCalled();
    intersect();
    expect(screen.getByText("2,481")).toHaveClass("sr-only");
    expect(screen.getByText("0")).toHaveAttribute("aria-hidden", "true");
    act(() => { frames.shift()!(0); });
    act(() => { frames.shift()!(120); });
    expect(screen.getByText("1241")).toHaveAttribute("aria-hidden", "true");
    act(() => { frames.shift()!(240); });
    expect(screen.getByText("2,481")).not.toHaveClass("sr-only");
    expect(view.container.querySelector('[data-stats-count] [aria-hidden]')).toBeNull();
    const count = vi.mocked(requestAnimationFrame).mock.calls.length;
    intersect(); expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(count);
  });
  it("never schedules a count when reduced motion is already selected", async () => {
    reduced = true;
    render(nativeStatsTree(selection, <StatGroup items={items} motion="count" />));
    expect(await screen.findByText("2,481")).not.toHaveClass("sr-only");
    expect(observe).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("cancels an active count and restores the final value when reduced motion changes", async () => {
    render(nativeStatsTree(selection, <StatGroup items={items} motion="count" />));
    await screen.findByText("2,481"); intersect();
    reduced = true; act(() => { change(); });
    expect(screen.getByText("2,481")).not.toHaveClass("sr-only");
    expect(screen.queryByText("0")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    act(() => { frames.shift()!(0); });
    expect(screen.getByText("2,481")).not.toHaveClass("sr-only");
  });
  it("restores an updated authored target without repeating the count", async () => {
    const view = render(nativeStatsTree(selection, <StatGroup items={items} motion="count" />));
    await screen.findByText("2,481"); intersect();
    view.rerender(nativeStatsTree(selection, <StatGroup items={[{ ...items[0]!, value: "3,000", countTo: 3000 }]} motion="count" />));
    expect(await screen.findByText("3,000")).not.toHaveClass("sr-only");
    expect(screen.queryByText("0")).toBeNull();
    expect(observe).toHaveBeenCalledOnce();
  });
});
