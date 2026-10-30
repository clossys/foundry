import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaFigure } from "./MediaFigure.js";
import type { MediaPlayerProps } from "../components/media-player/index.js";
import { mediaInputs, renderMediaSection } from "../runtime/sections/media.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";

const video: MediaPlayerProps = {
  video: { src: "/media/example.webm", width: 1600, height: 900, mediaType: "video/webm", reducedMotion: "poster" },
  poster: { kind: "photo", src: "/media/poster.webp", width: 1600, height: 900, decorative: true },
  passage: { title: "Example Co.", play: "Play", pause: "Pause", mute: "Mute", seek: "Seek", captions: "Captions", error: { title: "Unavailable", description: "Try again" } },
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("composes the real registered MediaPlayer for inline video and retains a figure caption", () => {
  const { container } = render(<MediaFigure kind="video" video={video} caption="Example caption" />);
  expect(container.querySelector("figure [data-slot='media-player']")).not.toBeNull();
  expect(container.querySelector("video")).toHaveAttribute("src", video.video.src);
  expect(container.querySelector("video")).toHaveAttribute("playsinline");
  expect(container.querySelector("figcaption")).toHaveTextContent("Example caption");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});
it("refuses mixed resources, a mismatched kind and image-ratio selection on video", () => {
  expect(() => render(<MediaFigure image={video.poster} video={video} />)).toThrow(/one image/);
  expect(() => render(<MediaFigure kind="video" />)).toThrow(/matching resource/);
  expect(() => render(<MediaFigure video={video} ratio={"wide" as never} />)).toThrow(/requires an image/);
});

it("the registered JSON adapter binds actual video, poster and resolved passage to MediaPlayer", () => {
  const { title, ...passage } = video.passage;
  const input = {
    fill: { leaf: "sections.media", slots: mediaInputs.slots, members: mediaInputs.members },
    selection: { leaf: "sections.media", members: ["kind.video"] },
    content: { figure: { value: { media: { kind: "video", resource: video.video, poster: video.poster, title, passage }, caption: "Example caption" } } },
  } as unknown as SectionRenderInput;
  const { container } = render(<>{renderMediaSection(input)}</>);
  expect(container.querySelector("figure [data-slot='media-player'] video")).toHaveAttribute("src", video.video.src);
  expect(screen.getByRole("group", { name: video.passage.title })).toBeInTheDocument();
});
