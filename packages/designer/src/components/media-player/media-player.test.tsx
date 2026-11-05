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
  error: { title: text(errorPassage.fields.title.id), description: text(errorPassage.fields.description.id) },
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
    expect(screen.getByRole("button", { name: passage.pause })).toBeVisible();
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
    render(<MediaPlayer {...props} autoplay muted />);
    enter();
    await user.click(screen.getByRole("button", { name: passage.play }));
    expect(play).toHaveBeenCalledTimes(1);
    preference(true);
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    enter(0); enter();
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("pauses below 25 percent and resumes an eligible automatic clip", () => {
    render(<MediaPlayer {...props} autoplay muted />);
    enter();
    expect(play).toHaveBeenCalledTimes(1);
    enter(0.249);
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    enter(0.25);
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("never auto-resumes after a user pause, even after motion or prop changes", async () => {
    const user = userEvent.setup();
    const view = render(<MediaPlayer {...props} autoplay muted />);
    enter();
    await user.click(screen.getByRole("button", { name: passage.pause }));
    const count = play.mock.calls.length;
    enter(0); enter(); preference(true); preference(false);
    view.rerender(<MediaPlayer {...props} autoplay muted controls="minimal" />);
    enter();
    expect(play).toHaveBeenCalledTimes(count);
    await user.click(screen.getByRole("button", { name: passage.play }));
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("supports Space/K, five-second seeking, M and C without stealing control keys", async () => {
    const user = userEvent.setup();
    const { container } = render(<MediaPlayer {...props} captions={captions} />);
    const media = element(container);
    const track = { mode: "disabled" };
    Object.defineProperty(media, "textTracks", { value: [track] });
    Object.defineProperty(media, "duration", { value: 20 });
    fireEvent.loadedMetadata(media);
    const group = screen.getByRole("group", { name: passage.title });
    group.focus();
    await user.keyboard(" ");
    expect(play).toHaveBeenCalledTimes(1);
    await user.keyboard("k");
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");
    expect(media.currentTime).toBe(5);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(media.currentTime).toBe(0);
    await user.keyboard("m");
    expect(media.muted).toBe(true);
    expect(screen.getByRole("button", { name: passage.mute })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("c");
    expect(track.mode).toBe("showing");
    expect(screen.getByRole("button", { name: passage.captions })).toHaveAttribute("aria-pressed", "true");
    const slider = screen.getByRole("slider", { name: passage.seek });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(media.currentTime).toBe(5);
    const count = play.mock.calls.length;
    screen.getByRole("button", { name: passage.play }).focus();
    await user.keyboard(" ");
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("keeps the minimal variant operable and omits its seek slider", () => {
    render(<MediaPlayer {...props} controls="minimal" />);
    expect(screen.getByRole("button", { name: passage.play })).toBeVisible();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: passage.captions })).toBeNull();
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
