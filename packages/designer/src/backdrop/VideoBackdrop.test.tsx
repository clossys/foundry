import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hero } from "../blocks/Hero.js";
import { checkBackdropElement } from "./contract.js";
import { checkVideoBackdrop, type VideoBackdropResource } from "./VideoBackdrop.js";
import { heroInputs, renderHeroSection } from "../runtime/sections/hero.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";

const still = { slot: "backdrop", purpose: "decorative", alt: "", width: 1600, height: 900, aspect: "16:9", fit: "cover", loading: "lazy", bytes: 1000, backgroundToken: "--color-surface-base", source: { format: "webp", src: "/media/still.webp" } } as const;
const resource: VideoBackdropResource = {
  kind: "video", video: { src: "/media/loop.webm", mediaType: "video/webm", width: 1600, height: 900, reducedMotion: "poster" },
  poster: { ...still, source: { format: "webp", src: "/media/poster.webp" } }, still,
  bytes: 2000, budgetBytes: 4000, labels: { pause: "Pause video", resume: "Resume video" },
};
let reduced = false;
let target: Element;
let visibility: IntersectionObserverCallback;
let idle: (() => void) | undefined;
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reduced = false; idle = undefined;
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { visibility = callback; }
    observe(element: Element) { target = element; }
    disconnect() {}
  });
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => { idle = callback; return 1; });
  vi.stubGlobal("cancelIdleCallback", () => { idle = undefined; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function visible(value: boolean) { act(() => visibility([{ target, isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver)); }
async function start() { visible(true); await act(async () => idle?.()); }

describe("Hero video backdrop", () => {
  it("defers a muted inline looping video, with its accessible pause control outside the hidden layer", async () => {
    const { container } = render(<Hero heading="Example Co." backdrop={resource} />);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await start();
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/media/loop.webm");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    const layer = container.querySelector("[data-backdrop-host]")!;
    const control = screen.getByRole("button", { name: resource.labels.pause });
    expect(layer.contains(control)).toBe(false);
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    fireEvent.click(control);
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: resource.labels.resume })).toHaveAttribute("aria-pressed", "true");
  });
  it("reduced motion keeps the still and never creates video or a pause control", async () => {
    reduced = true;
    const { container } = render(<Hero heading="Example Co." backdrop={resource} />);
    await start();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", still.source.src);
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("offscreen pauses the actual video and returning resumes it", async () => {
    render(<Hero heading="Example Co." backdrop={resource} />);
    await start();
    const pauses = pause.mock.calls.length;
    visible(false);
    expect(pause).toHaveBeenCalledTimes(pauses + 1);
    visible(true);
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("a user pause remains paused after leaving and re-entering view", async () => {
    render(<Hero heading="Example Co." backdrop={resource} />);
    await start();
    fireEvent.click(screen.getByRole("button", { name: resource.labels.pause }));
    visible(false); visible(true);
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: resource.labels.resume }));
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("a video error destroys the player and retains the poster", async () => {
    const { container } = render(<Hero heading="Example Co." backdrop={resource} />);
    await start();
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", "/media/poster.webp");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("refuses remote video sources, missing copy and an insufficient combined budget", () => {
    expect(checkVideoBackdrop(resource)).toBe(true);
    expect(checkVideoBackdrop({ ...resource, video: { ...resource.video, src: "https://example.invalid/loop.webm" } })).toBe(false);
    expect(checkVideoBackdrop({ ...resource, labels: { pause: "", resume: "Resume video" } })).toBe(false);
    expect(checkVideoBackdrop({ ...resource, budgetBytes: 3999 })).toBe(false);
  });
  it("the registered JSON Hero adapter binds its actual video resource and resolved labels", async () => {
    const input = {
      fill: { leaf: "sections.hero", slots: heroInputs.slots, members: heroInputs.members },
      selection: { leaf: "sections.hero", members: [] },
      content: { header: { value: { heading: "Example Co." } }, backdrop: { value: resource } },
    } as unknown as SectionRenderInput;
    const { container } = render(<>{renderHeroSection(input)}</>);
    await start();
    expect(container.querySelector("video")).toHaveAttribute("src", resource.video.src);
    expect(screen.getByRole("button", { name: resource.labels.pause })).toBeInTheDocument();
  });
});
