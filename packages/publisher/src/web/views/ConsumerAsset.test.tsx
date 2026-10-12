// @vitest-environment jsdom
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "./LandingView.js";
import { LandingView as ServerLandingView } from "./LandingView.server.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";

const registry = { id: "consumer-content", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: [{ id: "example.heading", text: "Example heading", context: "test", status: "approved" }, { id: "example.alt", text: "A landscape photograph", context: "test", status: "approved" }] } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const ref = (id = "heading") => ({ id: `example.${id}` });
const contract = { width: 1600, height: 900, aspectRatio: "16:9", format: "image/png", loading: "lazy" };
const media = { type: "asset", assetId: "example.photo", purpose: "meaningful", alt: ref("alt"), contract };
const image = { id: "example.photo", type: "image", src: "/assets/example.png", width: 1600, height: 900, alt: "Registry description", mimeType: "image/png" };
function document(fill: unknown = media): SectionedViewDocument {
  return { id: "example", sectionGroundRhythm: "base-then-sunken", sections: [{ id: "hero", kind: "hero", heading: ref() }, { id: "content", kind: "content-section", heading: ref(), layout: "split-start", media: fill }] } as SectionedViewDocument;
}
const errors = (fill: unknown) => validateSectionedViewDocument(document(fill)).filter(finding => finding.severity === "error");

describe("consumer asset fills the canonical content slot", () => {
  const views = [["ordinary", SectionedView], ["server", ServerSectionedView], ["landing", LandingView], ["server landing", ServerLandingView]] as const;
  it.each(views)("renders meaningful CopyRef alt, intrinsic size and enforced lazy loading through %s", (_name, View) => {
    expect(errors(media)).toEqual([]);
    const resolved = resolveSectionedViewDocument(document(), resolver);
    expect(resolved.resolutions.map(item => item.ref.id)).toContain("example.alt");
    const html = renderToStaticMarkup(<View document={resolved} resolveAssetId={() => image} />);
    const root = new DOMParser().parseFromString(html, "text/html");
    const img = root.querySelector("[data-media-figure] img")!;
    expect(img.getAttribute("alt")).toBe("A landscape photograph");
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("900");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.className).toContain("w-full");
    expect(img.hasAttribute("aria-hidden")).toBe(false);
  });
  it("renders decorative images with empty alt and excludes meaningful copy", () => {
    const decorative = { type: "asset", assetId: "example.photo", purpose: "decorative", contract };
    expect(errors(decorative)).toEqual([]);
    const html = renderToStaticMarkup(<SectionedView document={resolveSectionedViewDocument(document(decorative), resolver)} resolveAssetId={() => image} />);
    const img = new DOMParser().parseFromString(html, "text/html").querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });
  it.each([{ ...media, alt: undefined }, { ...media, alt: "raw copy" }, { ...media, purpose: "unknown" }, { ...media, color: "red" }, { ...media, purpose: "decorative" }, { type: "asset", assetId: "example.video", purpose: "decorative", contract: { ...contract, format: "video/mp4" } }])("rejects invalid accessibility and unsupported slot fields %#", fill => expect(errors(fill).length).toBeGreaterThan(0));
  it.each([undefined, () => undefined, () => ({ ...image, width: 800 }), () => ({ ...image, id: "example.foreign" }), () => ({ ...image, mimeType: "image/jpeg" }), () => { throw new Error("private resolver detail"); }])("refuses missing and mismatched fills at render time %#", resolveAssetId => {
    const resolved = resolveSectionedViewDocument(document(), resolver);
    expect(() => renderToStaticMarkup(<SectionedView document={resolved} resolveAssetId={resolveAssetId} />)).toThrow(/asset|content/i);
  });
  it.each(views)("uses existing layouts and responsive images without consumer view code through %s", (_name, View) => {
    for (const layout of ["stacked", "split-start", "split-end"] as const) {
      const authored = document({ ...media, caption: ref("heading"), contract: { ...contract, loading: "eager" } });
      Object.assign(authored.sections[1]!, { layout });
      const resolved = resolveSectionedViewDocument(authored, resolver);
      const fill = { ...image, sources: [{ src: "/assets/example.webp", width: 800, format: "image/webp" }] };
      const root = new DOMParser().parseFromString(renderToStaticMarkup(<View document={resolved} resolveAssetId={() => fill} />), "text/html");
      expect(root.querySelector("picture source")!.getAttribute("type")).toBe("image/webp");
      expect(root.querySelector("img")!.getAttribute("loading")).toBe("eager");
      expect(root.querySelector("figcaption")!.textContent).toBe("Example heading");
      expect(resolved.resolutions.slice(-2).map(item => item.ref.id)).toEqual(["example.alt", "example.heading"]);
    }
  });
  it.each(views)("renders captions, controls and loading hints for meaningful video through %s", (_name, View) => {
    const videoMedia = { ...media, contract: { ...contract, format: "video/mp4" } };
    const video = { id: "example.photo", type: "video", width: 1600, height: 900, alt: "Registry description", sources: [{ src: "/assets/example.mp4", mimeType: "video/mp4" }], reducedMotion: "static-poster", poster: "/assets/example.png", captions: [{ src: "/assets/example.vtt", srclang: "en", label: "English" }] };
    const resolved = resolveSectionedViewDocument(document(videoMedia), resolver);
    const render = (prefersReducedMotion = false) => new DOMParser().parseFromString(renderToStaticMarkup(<View document={resolved} resolveAssetId={() => video} prefersReducedMotion={prefersReducedMotion} />), "text/html");
    const root = render();
    expect(root.querySelector("video")!.hasAttribute("controls")).toBe(true);
    expect(root.querySelector("video")!.getAttribute("preload")).toBe("none");
    expect(root.querySelector("video")!.getAttribute("aria-label")).toBe("A landscape photograph");
    expect(root.querySelector("track")!.getAttribute("kind")).toBe("captions");
    expect(render(true).querySelector("video")).toBeNull();
    expect(render(true).querySelector("img")!.getAttribute("loading")).toBe("lazy");
  });
  it("refuses forged resolved fields before resolving a fill and does not execute contract getters", () => {
    const resolved = resolveSectionedViewDocument(document(), resolver);
    let calls = 0;
    for (const change of [{ alt: " " }, { purpose: "decorative", alt: "Conflicting alt" }, { contract: { ...contract, color: "red" } }]) {
      const forged = structuredClone(resolved);
      Object.assign((forged.sections[1] as { media: object }).media, change);
      expect(() => renderToStaticMarkup(<SectionedView document={forged} resolveAssetId={() => { calls++; return image; }} />)).toThrow();
    }
    const getterContract = { ...contract };
    Object.defineProperty(getterContract, "format", { enumerable: true, get() { calls++; return "video/mp4"; } });
    expect(errors({ ...media, purpose: "decorative", alt: undefined, contract: getterContract }).length).toBeGreaterThan(0);
    expect(calls).toBe(0);
  });
});
