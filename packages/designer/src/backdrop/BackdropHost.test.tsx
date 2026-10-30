import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackdropHost } from "./BackdropHost.js";
import { Hero } from "../blocks/Hero.js";
import { heroInputs, renderHeroSection } from "../runtime/sections/hero.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";
import { checkBackdropElement, BACKDROP_BUDGET_CEILING_BYTES } from "./contract.js";
import { checkRuntimeBackdrop, type BackdropModuleLoaders, type RuntimeBackdropResource } from "./runtime-module.js";

const still = { slot: "backdrop", purpose: "decorative", alt: "", width: 1600, height: 900, aspect: "16:9", fit: "cover", loading: "lazy", bytes: 1000, backgroundToken: "--color-surface-base", source: { format: "webp", src: "/media/still.webp" } } as const;
const resource: RuntimeBackdropResource = { kind: "module", moduleRef: "./art/scene.js", poster: { ...still, source: { format: "webp", src: "/media/poster.webp" } }, still, moduleBytes: 2000, budgetBytes: 4000 };
let reduced = false;
let onMotion: (() => void) | undefined;
let observed: Element | undefined;
let onVisibility: IntersectionObserverCallback;
let idle: (() => void) | undefined;
const pause = vi.fn();
const destroy = vi.fn();
const load = vi.fn(async () => ({ mount: vi.fn((element: HTMLElement) => {
  const content = document.createElement("canvas");
  content.style.pointerEvents = "none";
  element.append(content);
  return { setPaused: pause, destroy };
}) }));
const modules: BackdropModuleLoaders = { [resource.moduleRef]: load };

function visible(value: boolean) {
  act(() => onVisibility([{ target: observed, isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver));
}
async function flushIdle() { await act(async () => { idle?.(); }); }
beforeEach(() => {
  reduced = false; onMotion = undefined; idle = undefined;
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, callback: () => void) => { onMotion = callback; }, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { onVisibility = callback; }
    observe(target: Element) { observed = target; }
    disconnect() {}
  });
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => { idle = callback; return 1; });
  vi.stubGlobal("cancelIdleCallback", () => { idle = undefined; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("checked runtime backdrop", () => {
  it("accepts bounded local declarations and refuses remote code, remote images and over-budget totals", () => {
    expect(checkRuntimeBackdrop(resource)).toBe(true);
    for (const changed of [
      { moduleRef: "https://example.invalid/art.js" }, { moduleRef: "//example.invalid/art.js" }, { moduleRef: "./../art.js" },
      { poster: { ...still, source: { format: "webp", src: "https://example.invalid/poster.webp" } } },
      { budgetBytes: BACKDROP_BUDGET_CEILING_BYTES + 1 }, { budgetBytes: 3999 }, { moduleBytes: 0 },
    ]) expect(checkRuntimeBackdrop({ ...resource, ...changed })).toBe(false);
  });
  it("loads only after both visibility and idle, with a checked inert rendered layer", async () => {
    const { container } = render(<BackdropHost resource={resource} modules={modules} />);
    expect(load).not.toHaveBeenCalled();
    expect(idle).toBeUndefined();
    visible(true);
    expect(load).not.toHaveBeenCalled();
    await flushIdle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(checkBackdropElement(container.querySelector("[data-backdrop-host]")!)).toMatchObject({ ok: true });
    expect(pause).toHaveBeenLastCalledWith(false);
  });
  it("pauses the active runtime offscreen and resumes it when visible", async () => {
    render(<BackdropHost resource={resource} modules={modules} />);
    visible(true); await flushIdle();
    visible(false);
    expect(pause).toHaveBeenLastCalledWith(true);
    visible(true);
    expect(pause).toHaveBeenLastCalledWith(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("reduced motion keeps the still without importing or mounting a module", async () => {
    reduced = true;
    const { container } = render(<BackdropHost resource={resource} modules={modules} />);
    visible(true); await flushIdle();
    expect(load).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toHaveAttribute("src", still.source.src);
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("a live reduced-motion change destroys the runtime and restores its still", async () => {
    const { container } = render(<BackdropHost resource={resource} modules={modules} />);
    visible(true); await flushIdle();
    act(() => { reduced = true; onMotion?.(); });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", still.source.src);
  });
  it("keeps the poster after an import failure", async () => {
    const failed = { [resource.moduleRef]: vi.fn(async () => { throw new Error("unavailable"); }) };
    const { container } = render(<BackdropHost resource={resource} modules={failed} />);
    visible(true); await flushIdle();
    expect(container.querySelector("img")).toHaveAttribute("src", resource.poster.source.format !== "svg" ? resource.poster.source.src : "");
    expect(container.querySelector("[data-backdrop-runtime]")).toHaveStyle({ visibility: "hidden" });
  });
  it("destroys a module that violates the decorative element contract", async () => {
    const invalid = { [resource.moduleRef]: async () => ({ mount(element: HTMLElement) {
      element.append(document.createElement("button"));
      return { setPaused: pause, destroy };
    } }) };
    const { container } = render(<BackdropHost resource={resource} modules={invalid} />);
    visible(true); await flushIdle();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[data-backdrop-runtime]")).toHaveStyle({ visibility: "hidden" });
  });
  it("cancels an idle import when leaving view and disposes on unmount", async () => {
    const { unmount } = render(<BackdropHost resource={resource} modules={modules} />);
    visible(true); visible(false); await flushIdle();
    expect(load).not.toHaveBeenCalled();
    visible(true); await flushIdle();
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("does not mount an import that resolves after unmount", async () => {
    let finish!: (module: Awaited<ReturnType<typeof load>>) => void;
    const late = vi.fn(() => new Promise<Awaited<ReturnType<typeof load>>>(resolve => { finish = resolve; }));
    const { unmount } = render(<BackdropHost resource={resource} modules={{ [resource.moduleRef]: late }} />);
    visible(true); await flushIdle();
    unmount();
    const module = await load();
    await act(async () => finish(module));
    expect(module.mount).not.toHaveBeenCalled();
  });
  it("aborts an asynchronous mount when reduced motion turns on", async () => {
    let signal!: AbortSignal;
    let finish!: (instance: { setPaused: typeof pause; destroy: typeof destroy }) => void;
    const mounting: BackdropModuleLoaders = { [resource.moduleRef]: async () => ({ mount(_element, options) {
      signal = options.signal;
      return new Promise(resolve => { finish = resolve; });
    } }) };
    render(<BackdropHost resource={resource} modules={mounting} />);
    visible(true); await flushIdle();
    expect(signal.aborted).toBe(false);
    act(() => { reduced = true; onMotion?.(); });
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ setPaused: pause, destroy }));
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("keeps the poster when idle observation is unavailable", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    render(<BackdropHost resource={resource} modules={modules} />);
    visible(true);
    await waitFor(() => expect(load).not.toHaveBeenCalled());
  });
  it("Hero composes the checked runtime host behind its own message", async () => {
    const { container } = render(<Hero heading="Example Co." backdrop={resource} backdropModules={modules} />);
    expect(container.querySelector("[data-backdrop-host]")).not.toBeNull();
    visible(true); await flushIdle();
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.querySelector("h1")).toHaveTextContent("Example Co.");
    expect(checkBackdropElement(container.querySelector("[data-backdrop-host]")!)).toMatchObject({ ok: true });
  });
  it("the registered JSON Hero adapter reads its actual section host loader registry", async () => {
    const input = {
      fill: { leaf: "sections.hero", slots: heroInputs.slots, members: heroInputs.members },
      selection: { leaf: "sections.hero", members: [] },
      content: { header: { value: { heading: "Example Co." } }, backdrop: { value: resource } },
      sectionHost: { backdropModules: modules },
    } as unknown as SectionRenderInput;
    const { container } = render(<>{renderHeroSection(input)}</>);
    visible(true); await flushIdle();
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(() => renderHeroSection({ ...input, sectionHost: undefined })).toThrow(/local module loader/);
  });
});
