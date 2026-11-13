// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isImageResource } from "./media.js";

const image = { kind: "photo", src: "/image.webp", width: 1600, height: 900, alt: "A landscape" };
const source = { media: "(min-width: 40rem)", src: "/image-wide.webp", width: 1920, height: 1080 };

describe("image resource contract", () => {
  it("preserves existing image resources and accepts the share kind", () => {
    for (const kind of ["photo", "illustration", "share"]) {
      expect(isImageResource({ ...image, kind })).toBe(true);
      expect(isImageResource({ ...image, kind, alt: undefined, decorative: true })).toBe(true);
    }
  });

  it("accepts ordered responsive sources, sizes, focal endpoints and both placeholder kinds", () => {
    for (const focal of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: .25, y: .75 }]) {
      for (const placeholder of [{ kind: "color", value: "#abcdef" }, { kind: "blur", value: "/still.webp" }]) {
        expect(isImageResource({ ...image, sources: [source], sizes: "(min-width: 40rem) 50vw, 100vw", focal, placeholder })).toBe(true);
      }
    }
  });

  it.each([-1, 1.01, Infinity, -Infinity, NaN, "0.5", undefined])("rejects focal coordinates outside the normalized contract: %s", coordinate => {
    expect(isImageResource({ ...image, focal: { x: coordinate, y: .5 } })).toBe(false);
    expect(isImageResource({ ...image, focal: { x: .5, y: coordinate } })).toBe(false);
  });

  it("rejects a responsive source without width", () => {
    const { width: _width, ...withoutWidth } = source;
    expect(isImageResource({ ...image, sources: [withoutWidth] })).toBe(false);
  });

  it.each([
    [], [{}], [{ ...source, width: 0 }], [{ ...source, width: Infinity }],
    [{ ...source, width: 320.5 }], [{ ...source, height: 180.5 }],
    [{ ...source, height: undefined }], [{ ...source, height: -1 }],
    [{ ...source, media: " " }], [{ ...source, src: "" }],
  ].map(sources => ({ sources })))("rejects malformed responsive sources: $sources", ({ sources }) => {
    expect(isImageResource({ ...image, sources })).toBe(false);
  });

  it.each([
    { sizes: " " }, { sizes: 100 }, { focal: null }, { focal: [] },
    { placeholder: null }, { placeholder: { kind: "video", value: "/still.webp" } },
    { placeholder: { kind: "color", value: " " } }, { placeholder: { kind: "blur" } },
  ])("rejects malformed optional image data: %j", patch => {
    expect(isImageResource({ ...image, ...patch })).toBe(false);
  });

  it.each([
    { kind: "icon" }, { src: " " }, { width: 0 }, { height: NaN }, { alt: " " },
  ])("keeps the fallback and accessibility requirements: %j", patch => {
    expect(isImageResource({ ...image, ...patch })).toBe(false);
  });
});
