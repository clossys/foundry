import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChunkHost, CHUNK_ROOT_MARGIN, type ChunkHostHandle } from "./ChunkHost.js";
import { useHeadingScrollSpy } from "../TableOfContents.scroll-spy.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("reserves estimates, loads only on intersection, and keeps anchoring on the scroller", async () => {
  let callback: IntersectionObserverCallback = () => {};
  const observe = vi.fn(), disconnect = vi.fn();
  const observer = vi.fn(function (this: object, cb: IntersectionObserverCallback, options: IntersectionObserverInit) { callback = cb; expect(options.rootMargin).toBe(CHUNK_ROOT_MARGIN); return { observe, disconnect }; });
  vi.stubGlobal("IntersectionObserver", observer);
  const load = vi.fn(async () => <h2 id="tokens">Tokens</h2>);
  const view = render(<ChunkHost chunks={[{ id: "tokens", estimate: 440, load }]} />);
  expect(load).not.toHaveBeenCalled();
  const placeholder = view.container.querySelector("[data-chunk-placeholder]") as HTMLElement;
  expect(placeholder.style.minHeight).toBe("440px");
  expect(placeholder.style.overflowAnchor).toBe("none");
  expect((view.container.firstChild as HTMLElement).style.overflowAnchor).toBe("auto");
  await act(async () => callback([{ target: placeholder, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(screen.getByRole("heading", { name: "Tokens" })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
});
it("loads an unloaded hash target and focuses it after navigation", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  const ref = createRef<ChunkHostHandle>();
  render(<ChunkHost ref={ref} chunks={[{ id: "strings", anchors: ["strings--names"], estimate: 400, load: async () => <h3 id="strings--names">Names</h3> }]} />);
  await act(async () => { await ref.current!.navigate("#strings--names"); });
  expect(document.activeElement?.id).toBe("strings--names");
  expect(scroll).toHaveBeenCalled();
});
it("scroll spy observes heading order and reports active headings", async () => {
  let callback: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", vi.fn(function (cb: IntersectionObserverCallback) { callback = cb; return { observe: vi.fn(), disconnect: vi.fn() }; }));
  const change = vi.fn();
  function Probe() { const current = useHeadingScrollSpy(["a", "b"], { onChange: change }); return <><h2 id="a">A</h2><h3 id="b">B</h3><output>{current}</output></>; }
  render(<Probe />);
  await act(async () => callback([{ target: document.getElementById("b")!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(screen.getByText("b")).toBeTruthy();
  expect(change).toHaveBeenCalledWith("b");
});

it("focuses the heading when the hash belongs to a section root", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  const ref = createRef<ChunkHostHandle>();
  render(<ChunkHost ref={ref} chunks={[{ id: "components", estimate: 200, load: async () => <section id="components"><h2>Components</h2></section> }]} />);
  await act(async () => { await ref.current!.navigate("#components"); });
  expect(document.activeElement?.tagName).toBe("H2");
  expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  expect(scroll).toHaveBeenCalledTimes(1);
});
it("preserves host scrollTop and never scrolls for an intersecting chunk above", async () => {
  let callback: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", vi.fn(function (cb: IntersectionObserverCallback) { callback = cb; return { observe: vi.fn(), disconnect: vi.fn() }; }));
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  const view = render(<ChunkHost chunks={[{ id: "above", estimate: 500, load: async () => <h2 id="above">Above</h2> }]} />);
  const host = view.container.firstElementChild as HTMLElement;
  host.scrollTop = 420;
  const placeholder = view.container.querySelector("[data-chunk-placeholder]")!;
  await act(async () => callback([{ target: placeholder, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(host.scrollTop).toBe(420);
  expect(scroll).not.toHaveBeenCalled();
  expect(host.style.overflowAnchor).toBe("auto");
});
