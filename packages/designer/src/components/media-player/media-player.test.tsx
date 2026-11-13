import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPlayer, type MediaPlayerPassage, type MediaPlayerProps } from "./media-player.js";

const writer = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../writer/src/catalog/records/site.en.json"), "utf8"));
const text = (id: string): string => writer.records.find((record: { id: string; text?: string }) => record.id === id).text;
const errorPassage = writer.records.find((record: { id: string }) => record.id === "ps.7mpayr0001");
const passage: MediaPlayerPassage = {
  title: text("st.7mpayr0001"), play: text("st.7mpayr0002"), pause: text("st.7mpayr0003"),
  mute: text("st.7mpayr0004"), seek: text("st.7mpayr0005"), captions: text("st.7mpayr0006"),
  error: { title: text(errorPassage.fields["header.heading"].id), description: text(errorPassage.fields["header.description"].id) },
};
const video: MediaPlayerProps["video"] = { src: "/example.mp4", mediaType: "video/mp4", width: 1280, height: 720, reducedMotion: "poster" };
const poster: MediaPlayerProps["poster"] = { kind: "illustration", src: "/example-poster.webp", width: 1280, height: 720, alt: "Example Co. overview still" };
const captions = { src: "/example.vtt", srclang: "en", label: "English" };
const props = { video, poster, passage };
let reduced = false;
let motion: ((event: MediaQueryListEvent) => void) | undefined;
let intersection: IntersectionObserverCallback;
let observed: Element;
const play = vi.fn();
const pause = vi.fn();
const disconnect = vi.fn();
const enter = (ratio = 1) => act(() => intersection([{ target: observed, isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver));
const preference = (value: boolean) => act(() => { reduced = value; motion?.({ matches: value } as MediaQueryListEvent); });
const element = (container: HTMLElement) => container.querySelector("video")!;
/** media-chrome's own control (jsdom treats media-chrome as server-side, so its elements stay inert here). */
const chrome = (container: HTMLElement, tag: string) => container.querySelector(`media-control-bar ${tag}`);

beforeEach(() => {
  reduced = false;
  motion = undefined;
  play.mockReset().mockImplementation(function(this: HTMLVideoElement) { fireEvent.play(this); return Promise.resolve(); });
  pause.mockReset().mockImplementation(function(this: HTMLVideoElement) { fireEvent.pause(this); });
  disconnect.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reduced, addEventListener: (_: string, listener: typeof motion) => { if (query === "(prefers-reduced-motion: reduce)") motion = listener; }, removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersection = callback; } observe(target: Element) { observed = target; } disconnect = disconnect; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MediaPlayer", () => {
  it("renders a poster and named play control on the server without native autoplay", () => {
    const markup = renderToString(<MediaPlayer {...props} autoplay muted />);
    expect(markup).toContain('poster="/example-poster.webp"');
    expect(markup).toContain("Play video");
    expect(markup).toContain('preload="metadata"');
    expect(markup).not.toMatch(/autoplay=/i);
    expect(play).not.toHaveBeenCalled();
  });
  it("starts with the poster and named keyboard-accessible play control", async () => {
    const user = userEvent.setup();
    const { container } = render(<MediaPlayer {...props} />);
    enter();
    expect(play).not.toHaveBeenCalled();
    expect(element(container)).toHaveAttribute("playsinline");
    expect(screen.getByRole("group", { name: passage.title })).toHaveAttribute("aria-keyshortcuts");
    await user.click(screen.getByRole("button", { name: passage.play }));
    expect(play).toHaveBeenCalledTimes(1);
    // Started: the poster's start control gives way to media-chrome's play/pause control.
    expect(screen.queryByRole("button", { name: passage.play })).toBeNull();
    expect(chrome(container, "media-play-button")).not.toBeNull();
  });
  it("autoplays only after at least a quarter is visible and only muted", () => {
    const { container } = render(<MediaPlayer {...props} autoplay muted loop />);
    expect(play).not.toHaveBeenCalled();
    enter(0.24);
    expect(play).not.toHaveBeenCalled();
    enter(0.25);
    expect(play).toHaveBeenCalledTimes(1);
    expect(element(container).muted).toBe(true);
    expect(element(container).loop).toBe(true);
  });
  it("refuses automatic playback with sound", () => {
    render(<MediaPlayer {...props} autoplay muted={false} />);
    enter();
    expect(play).not.toHaveBeenCalled();
    enter(0); enter();
    expect(play).not.toHaveBeenCalled();
  });
  it.each(["full", "minimal"] as const)("never starts itself under reduced motion with %s controls, including visibility changes", controls => {
    reduced = true;
    render(<MediaPlayer {...props} controls={controls} autoplay muted loop />);
    enter(); enter(0); enter();
    expect(play).not.toHaveBeenCalled();
  });
  it("allows explicit playback under reduced motion and pauses when the preference is enabled", async () => {
    reduced = true;
    const user = userEvent.setup();
    const { container } = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    await user.click(screen.getByRole("button", { name: passage.play }));
    expect(play).toHaveBeenCalledTimes(1);
    pause.mockClear();
    preference(true);
    expect(pause).toHaveBeenCalled();
    expect(chrome(container, "media-play-button")).not.toBeNull();
    enter(0); enter();
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("pauses below 25 percent and resumes an eligible automatic clip", () => {
    const { container } = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    expect(play).toHaveBeenCalledTimes(1);
    enter(0.249);
    expect(pause).toHaveBeenCalled();
    expect(chrome(container, "media-play-button")).not.toBeNull();
    enter(0.25);
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("never auto-resumes after a user pause, even after motion or prop changes", async () => {
    const view = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    // A user pause: media-chrome's pause control pauses the media element directly.
    act(() => { element(view.container).pause(); });
    const count = play.mock.calls.length;
    enter(0); enter(); preference(true); preference(false);
    view.rerender(<MediaPlayer {...props} autoplay muted controls="minimal" />);
    enter();
    expect(play).toHaveBeenCalledTimes(count);
    // The user resumes through media-chrome's play control, which plays the media element directly.
    act(() => { void element(view.container).play(); });
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("hands Space/K, five-second seeking, M and C to media-chrome's hotkeys on the focusable player", () => {
    const { container } = render(<MediaPlayer {...props} captions={captions} />);
    // media-chrome's media-controller owns the hotkeys (Space and K play or pause, ArrowLeft and ArrowRight seek,
    // M mutes, C toggles captions) and skips keys a focused range or button uses itself.
    const group = screen.getByRole("group", { name: passage.title });
    expect(group.tagName).toBe("MEDIA-CONTROLLER");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group).toHaveAttribute("aria-keyshortcuts", "Space K ArrowLeft ArrowRight M C");
    expect(group).toHaveAttribute("keyboardbackwardseekoffset", "5");
    expect(group).toHaveAttribute("keyboardforwardseekoffset", "5");
    expect(group).not.toHaveAttribute("nohotkeys");
    expect(group).not.toHaveAttribute("hotkeys");
    expect(element(container).getAttribute("slot")).toBe("media");
    expect(element(container).querySelector("track")).toHaveAttribute("kind", "captions");
    for (const tag of ["media-play-button", "media-mute-button", "media-time-range", "media-captions-button"]) expect(chrome(container, tag), tag).not.toBeNull();
  });
  it("keeps the minimal variant operable and omits its seek slider", () => {
    const { container } = render(<MediaPlayer {...props} captions={captions} controls="minimal" />);
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    expect(chrome(container, "media-play-button")).not.toBeNull();
    expect(chrome(container, "media-mute-button")).not.toBeNull();
    expect(chrome(container, "media-time-range")).toBeNull();
    expect(chrome(container, "media-captions-button")).toBeNull();
  });
  it("restores the poster and Writer error passage after a decoding failure", () => {
    const { container } = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    fireEvent.error(element(container));
    expect(screen.getByRole("img", { name: poster.alt })).toHaveAttribute("src", poster.src);
    expect(screen.getByRole("alert")).toHaveTextContent(passage.error.title);
    expect(screen.getByRole("alert")).toHaveTextContent(passage.error.description);
    expect(screen.queryByRole("button")).toBeNull();
    const count = play.mock.calls.length;
    enter(0); enter();
    expect(play).toHaveBeenCalledTimes(count);
  });
  it("keeps play available after a browser refuses the play request", async () => {
    play.mockRejectedValueOnce(new DOMException("Playback blocked", "NotAllowedError"));
    const user = userEvent.setup();
    render(<MediaPlayer {...props} />);
    await user.click(screen.getByRole("button", { name: passage.play }));
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not replay an ended clip unless the user starts it again", () => {
    const { container } = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    fireEvent.ended(element(container));
    enter(0); enter();
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("starts a fresh session when the video asset changes", () => {
    const view = render(<MediaPlayer {...props} />);
    fireEvent.error(element(view.container));
    view.rerender(<MediaPlayer {...props} video={{ ...video, src: "/second-example.mp4" }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
  });
  it("disconnects its observer and pauses on unmount", () => {
    const view = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalled();
  });
});
