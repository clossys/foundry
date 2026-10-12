import { describe, expect, it } from "vitest";
import { checkConsumerArtContract, type ConsumerArtContract } from "./consumer-art.js";

const photo: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain",
  loading: "lazy", bytes: 100000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/photo.webp" },
};
const vector: ConsumerArtContract = {
  ...photo, source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: "--color-accent" }] },
};
const ok = (input: unknown) => checkConsumerArtContract(input).ok;

describe("consumer art contract", () => {
  it("accepts static photos and token-painted vector art", () => {
    expect(ok(photo)).toBe(true);
    expect(ok(vector)).toBe(true);
    for (const format of ["avif", "webp", "png", "jpeg"]) expect(ok({ ...photo, source: { format, src: `/art/photo.${format}` } })).toBe(true);
    for (const [aspect, width, height] of [["1:1", 800, 800], ["4:3", 1200, 900], ["3:2", 1200, 800], ["16:9", 1600, 900]]) expect(ok({ ...photo, aspect, width, height })).toBe(true);
  });
  it("requires meaningful alt and keeps every backdrop decorative and inert", () => {
    expect(ok({ ...photo, alt: " " })).toBe(false);
    for (const slot of ["backdrop", "section-backdrop"]) {
      expect(ok({ ...photo, slot })).toBe(false);
      expect(ok({ ...photo, slot, purpose: "decorative", alt: "", fit: "cover" })).toBe(true);
      expect(ok({ ...photo, slot, purpose: "decorative", alt: "", loading: "eager" })).toBe(false);
    }
    expect(ok({ ...photo, purpose: "decorative", alt: photo.alt })).toBe(false);
  });
  it.each([
    { width: 0 }, { height: -1 }, { width: 1.5 }, { width: Infinity },
    { width: 9000 }, { height: 1000 }, { aspect: "auto" }, { fit: "stretch" },
    { bytes: 0 }, { bytes: 2097153 }, { bytes: NaN }, { loading: "idle" },
    { backgroundToken: "#fff" }, { backgroundToken: "--color-imaginary" },
    { backgroundToken: "--spacing-md" }, { className: "custom" }, { owner: "foundry" },
    { source: { format: "gif", src: "/art/animated.gif" } },
    { source: { format: "webp", src: "javascript:void(0)" } },
    { source: { format: "webp", src: "//example.com/photo.webp" } },
    { source: { format: "webp", src: "data:image/webp;base64,AAAA" } },
    { source: { format: "webp", src: "/art/photo.webp", colors: ["#fff"] } },
    { source: { format: "svg", src: "/art/external.svg" } },
    { source: { format: "svg", paths: [] } },
    { source: { format: "svg", paths: [{ d: "M0 0", fillToken: "#fff" }] } },
    { source: { format: "svg", paths: [{ d: "M0 0", fillToken: "--color-accent", onClick: "handler" }] } },
    { source: { format: "svg", paths: [{ d: "<script>", fillToken: "--color-accent" }] } },
  ])("rejects invalid or unsupported declarations: %j", patch => expect(ok({ ...photo, ...patch })).toBe(false));
  it("rejects malformed data without evaluating accessors", () => {
    for (const input of [null, [], true, {}, Object.create(photo)]) expect(ok(input)).toBe(false);
    const getter = { ...photo };
    Object.defineProperty(getter, "width", { get: () => { throw new Error("accessor evaluated"); } });
    expect(ok(getter)).toBe(false);
    const paths = new Array(1);
    expect(ok({ ...vector, source: { format: "svg", paths } })).toBe(false);
  });
});
