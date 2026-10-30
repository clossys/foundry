import { act, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatGroup } from "./StatGroup.js";

const items = [{ id: "one", label: "Completed tasks", value: "1,200", countTo: 1200 }];
let reduced = false, notify: IntersectionObserverCallback;
let frames: FrameRequestCallback[];
const observe = vi.fn(), disconnect = vi.fn();
const observer = vi.fn(function (callback: IntersectionObserverCallback) { notify = callback; return { observe, disconnect }; });
beforeEach(() => {
  reduced = false; frames = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", observer);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Stats proof motion", () => {
  it("keeps the authored final value in server HTML and counts once on entry", () => {
    expect(renderToStaticMarkup(<StatGroup items={items} motion="count" />)).toContain("1,200");
    const { container } = render(<StatGroup items={items} motion="count" />);
    const root = container.querySelector("[data-stats-count]")!;
    expect(root).toHaveTextContent("1,200");
    act(() => notify([{ target: root, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames).toHaveLength(0);
    act(() => notify([{ target: root, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(root.querySelector(".sr-only")).toHaveTextContent("1,200");
    expect(root.querySelector('[aria-hidden="true"]')).toHaveTextContent("0");
    act(() => frames.shift()!(0));
    act(() => frames.shift()!(1000000));
    expect(root).toHaveTextContent("1,200");
    expect(root.querySelector('[aria-hidden="true"]')).toBeNull();
    act(() => notify([{ target: root, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames).toHaveLength(0);
  });
  it("does not count without opt-in", () => {
    render(<StatGroup items={items} />);
    expect(observer).not.toHaveBeenCalled();
  });
  it("reduced motion keeps final value without an observer or intermediate value", () => {
    reduced = true;
    const { container } = render(<StatGroup items={items} motion="count" />);
    expect(container.querySelector("[data-stats-count]")).toHaveTextContent("1,200");
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(observer).not.toHaveBeenCalled();
  });
});
