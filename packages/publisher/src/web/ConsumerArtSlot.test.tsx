// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsumerArtSlot } from "./ConsumerArtSlot.js";
import type { ConsumerArtContract } from "@clossys/designer/tokens";
import type { RuntimeBackdropResource, VideoBackdropResource } from "@clossys/designer/blocks";
const art: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain", loading: "lazy",
  bytes: 100000, backgroundToken: "--color-surface-base", source: { format: "webp", src: "/art/photo.webp" },
};
function root(contract: ConsumerArtContract) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ConsumerArtSlot contract={contract} />);
  return host.querySelector("[data-consumer-art-slot]")!;
}
describe("Publisher checked consumer art slot", () => {
  const still = { ...art, slot: "backdrop", purpose: "decorative", alt: "", fit: "cover", loading: "lazy", bytes: 1000 } as const;
  const runtime: RuntimeBackdropResource = { kind: "module", moduleRef: "./art/example.js", poster: still, still, moduleBytes: 2000, budgetBytes: 4000 };
  it("delegates draft runtime artwork through the public checked BackdropHost and server-renders its still", () => {
    const html = renderToStaticMarkup(<ConsumerArtSlot contract={runtime} />);
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelector("[data-backdrop-host]")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/art/photo.webp");
    expect(host.querySelector("canvas,video,button")).toBeNull();
    expect(() => renderToStaticMarkup(<ConsumerArtSlot contract={{ ...runtime, budgetBytes: 1 }} />)).toThrow(/Invalid runtime backdrop/);
  });
  it("delegates video to the public checked VideoBackdrop without loading motion during server rendering", () => {
    const video: VideoBackdropResource = { kind: "video", video: { src: "/media/example.webm", width: 1600, height: 900, mediaType: "video/webm", reducedMotion: "poster" }, poster: still, still, bytes: 2000, budgetBytes: 4000, labels: { pause: "Pause", resume: "Resume" } };
    const host = document.createElement("div"); host.innerHTML = renderToStaticMarkup(<ConsumerArtSlot contract={video} />);
    expect(host.querySelector("[data-backdrop-host]")).not.toBeNull();
    expect(host.querySelector("video,button")).toBeNull();
  });
  it("renders media alt, intrinsic dimensions, asynchronous decoding and lazy loading", () => {
    const el = root(art);
    const image = el.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe(art.alt);
    expect(image.getAttribute("width")).toBe("1600");
    expect(image.getAttribute("height")).toBe("900");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.classList.contains("object-contain")).toBe(true);
    expect(image.hasAttribute("style")).toBe(false);
    expect((el as HTMLElement).style.aspectRatio).toBe("1600 / 900");
  });
  it("keeps the Clossys hero backdrop decorative, covered and noninteractive", () => {
    const el = root({ ...art, slot: "backdrop", purpose: "decorative", alt: "", fit: "cover", loading: "eager" });
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.classList.contains("pointer-events-none")).toBe(true);
    expect(el.classList.contains("absolute")).toBe(true);
    expect(el.classList.contains("inset-0")).toBe(true);
    expect(el.classList.contains("h-full")).toBe(true);
    expect(el.classList.contains("w-full")).toBe(true);
    expect(el.classList.contains("overflow-hidden")).toBe(true);
    const image = el.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.classList.contains("object-cover")).toBe(true);
    expect(el.querySelector("[tabindex],a,button")).toBeNull();
  });
  it("uses existing utility classes for fixed media geometry", () => {
    const el = root(art);
    expect(el.classList.contains("relative")).toBe(true);
    expect(el.classList.contains("w-full")).toBe(true);
    const image = el.querySelector("img")!;
    for (const token of ["block", "w-full", "h-full"]) expect(image.classList.contains(token)).toBe(true);
    for (const property of ["position", "inset", "width", "height", "overflow", "pointer-events"]) {
      expect((el as HTMLElement).style.getPropertyValue(property)).toBe("");
    }
    expect(image.style.display).toBe("");
    expect(image.style.width).toBe("");
    expect(image.style.height).toBe("");
    expect(image.style.objectFit).toBe("");
    expect(image.classList.contains("object-contain")).toBe(true);
  });
  it("uses the shipped square utility for square media", () => {
    const el = root({ ...art, width: 900, height: 900, aspect: "1:1" });
    expect(el.classList.contains("aspect-square")).toBe(true);
    expect((el as HTMLElement).style.aspectRatio).toBe("");
  });
  it("preserves explicit deferred loading for a backdrop", () => {
    const el = root({ ...art, slot: "backdrop", purpose: "decorative", alt: "", fit: "cover", loading: "lazy" });
    expect(el.querySelector("img")!.getAttribute("loading")).toBe("lazy");
  });
  it("renders inline SVG with live tokens and a meaningful accessible name", () => {
    const accentToken = "--color-accent";
    const el = root({ ...art, source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: accentToken }] } });
    const svg = el.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(art.alt);
    expect(svg.getAttribute("viewBox")).toBe("0 0 1600 900");
    for (const token of ["block", "w-full", "h-full"]) expect(svg.classList.contains(token)).toBe(true);
    expect(svg.getAttribute("style")).toBeNull();
    expect(svg.querySelector("path")!.getAttribute("fill")).toBe(`var(${accentToken})`);
  });
  it("refuses invalid art before producing markup", () => {
    expect(() => root({ ...art, backgroundToken: "#fff" })).toThrow(/backgroundToken/);
    expect(() => root({ ...art, slot: "backdrop" } as ConsumerArtContract)).toThrow(/purpose/);
  });
});
