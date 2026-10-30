import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPlayer } from "./media-player.js";
const video = { src: "/example.webm", mediaType: "video/webm", width: 1600, height: 900, reducedMotion: "poster" } as const;
const poster = { kind: "photo", src: "/example-poster.webp", width: 1600, height: 900, decorative: true } as const;
let reduced = false;
let changed: (() => void) | undefined;
let play: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reduced = false; changed = undefined;
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener(_event: string, callback: () => void) { changed = callback; }, removeEventListener() {} }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("MediaPlayer passive decoration", () => {
  it("plays muted inline looping decoration with no controls or tab stops", async () => {
    const { container } = render(<MediaPlayer decorative video={video} poster={poster} />);
    const player = container.querySelector("video")!;
    expect(player).not.toBeNull();
    expect(player.muted).toBe(true); expect(player.autoplay).toBe(true); expect(player.loop).toBe(true); expect(player.playsInline).toBe(true);
    expect(player.controls).toBe(false); expect(player.tabIndex).toBe(-1);
    expect(container.querySelector("button,[tabindex='0'],[role='group']")).toBeNull();
    expect(container.querySelector("[data-media-passive]")).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => expect(play).toHaveBeenCalled());
  });
  it("keeps the poster and never plays when reduced motion is enabled", () => {
    reduced = true;
    const { container } = render(<MediaPlayer decorative video={video} poster={poster} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", poster.src);
    expect(play).not.toHaveBeenCalled();
  });
  it("returns to the poster when video loading fails or motion preference changes", () => {
    const first = render(<MediaPlayer decorative video={video} poster={poster} />);
    fireEvent.error(first.container.querySelector("video")!);
    expect(first.container.querySelector("video")).toBeNull();
    expect(first.container.querySelector("img")).toHaveAttribute("src", poster.src);
    first.unmount();
    const second = render(<MediaPlayer decorative video={video} poster={poster} />);
    act(() => { reduced = true; changed?.(); });
    expect(second.container.querySelector("video")).toBeNull();
    expect(second.container.querySelector("img")).toHaveAttribute("src", poster.src);
  });
  it("retains the poster after an automatic playback rejection", async () => {
    play.mockRejectedValue(new Error("Playback unavailable"));
    const { container } = render(<MediaPlayer decorative video={video} poster={poster} />);
    await waitFor(() => expect(container.querySelector("video")).toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", poster.src);
  });
  it.each(["full", "minimal"] as const)("preserves normal %s control mode", controls => {
    const passage = { title: "ExampleCo. film", play: "Play", pause: "Pause", mute: "Mute", seek: "Seek", captions: "Captions", error: { title: "Unavailable", description: "Try again" } };
    render(<MediaPlayer video={video} poster={poster} passage={passage} controls={controls} />);
    expect(screen.getByRole("group", { name: passage.title })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: passage.play })).toBeInTheDocument();
    expect(Boolean(screen.queryByRole("slider"))).toBe(controls === "full");
  });
});
