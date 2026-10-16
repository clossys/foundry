import { describe, expect, it } from "vitest";
import { checkContentAssetContract, checkContentAssetFill, CONTENT_ASSET_FORMATS, CONTENT_ASSET_RATIOS } from "./index.js";

const contract = { width: 1600, height: 900, aspectRatio: "16:9", format: "image/png", loading: "lazy" };
const image = { id: "example.photo", type: "image", src: "/assets/example.png", width: 1600, height: 900, alt: "Registry description", mimeType: "image/png" };

describe("consumer content asset contract", () => {
  it("accepts a declared intrinsic size, supported format, ratio and loading policy", () => {
    expect(checkContentAssetContract(contract).ok).toBe(true);
    expect(checkContentAssetFill(contract, image, "example.photo").ok).toBe(true);
  });
  it("exports and evaluates every supported ratio, MIME format and loading policy", () => {
    expect(CONTENT_ASSET_RATIOS).toEqual(["1:1", "4:3", "3:4", "16:9"]);
    expect(CONTENT_ASSET_FORMATS).toEqual(["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml", "video/mp4", "video/webm"]);
    expect(Object.isFrozen(CONTENT_ASSET_FORMATS)).toBe(true);
    expect(Object.isFrozen(CONTENT_ASSET_RATIOS)).toBe(true);
    for (const aspectRatio of CONTENT_ASSET_RATIOS) {
      const [width, height] = aspectRatio.split(":").map(Number);
      for (const format of CONTENT_ASSET_FORMATS) for (const loading of ["lazy", "eager"]) expect(checkContentAssetContract({ width: width! * 100, height: height! * 100, aspectRatio, format, loading }).ok).toBe(true);
    }
  });
  it.each([
    { ...contract, width: 0 }, { ...contract, height: 900.5 }, { ...contract, width: Infinity },
    null, undefined, [], { ...contract, width: NaN }, { ...contract, width: Number.MAX_SAFE_INTEGER + 1 },
    { ...contract, aspectRatio: "free" }, { ...contract, height: 800 },
    { ...contract, width: 1000, height: 1000, aspectRatio: "16:9" },
    { ...contract, width: 9007199254740983, height: 5066549580791803 },
    { ...contract, format: "image/gif" }, { ...contract, loading: "idle" },
    { ...contract, color: "red" }, { ...contract, style: {} },
    Object.assign(Object.create({ width: 1600 }), contract),
    { ...contract, [Symbol("hidden")]: true },
  ])("refuses unsupported or malformed declarations %#", (value) => {
    expect(checkContentAssetContract(value).ok).toBe(false);
  });
  it("refuses getters without executing them", () => {
    let reads = 0;
    const value = { ...contract };
    Object.defineProperty(value, "width", { enumerable: true, get() { reads++; return 1600; } });
    expect(checkContentAssetContract(value).ok).toBe(false);
    expect(reads).toBe(0);
    const fill = { ...image };
    Object.defineProperty(fill, "src", { enumerable: true, get() { reads++; return image.src; } });
    expect(checkContentAssetFill(contract, fill, "example.photo").ok).toBe(false);
    expect(reads).toBe(0);
  });
  it.each([
    undefined, null, { ...image, id: "example.foreign" }, { ...image, id: undefined }, { ...image, width: 800 }, { ...image, height: 450 },
    { ...image, mimeType: "image/jpeg" }, { ...image, mimeType: undefined },
    { ...image, src: "javascript:alert(1)" },
    { ...image, sources: [{ src: "/assets/example.gif", width: 800, format: "image/gif" }] },
  ])("refuses missing, mismatched and unpaintable fills %#", (value) => {
    expect(checkContentAssetFill(contract, value, "example.photo").ok).toBe(false);
  });
  it("requires a matching video format and usable captions in addition to existing motion validation", () => {
    const videoContract = { ...contract, format: "video/mp4" };
    const video = { id: "example.photo", type: "video", width: 1600, height: 900, alt: "A demonstration", sources: [{ src: "/assets/example.mp4", mimeType: "video/mp4" }], reducedMotion: "pause", captions: [{ src: "/assets/example.vtt", srclang: "en", label: "English" }] };
    expect(checkContentAssetFill(videoContract, video, "example.photo").ok).toBe(true);
    for (const value of [{ ...video, captions: undefined, transcript: "Text" }, { ...video, reducedMotion: undefined }, { ...video, autoplay: true }, { ...video, sources: [{ src: "/assets/example.mov", mimeType: "video/quicktime" }] }]) expect(checkContentAssetFill(videoContract, value, "example.photo").ok).toBe(false);
  });
});
