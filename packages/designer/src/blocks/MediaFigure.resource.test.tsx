import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaFigure } from "./MediaFigure.js";
import { Hero } from "./Hero.js";
import { Gallery } from "./Gallery.js";
import { isImageResource, type ImageResource } from "../catalog-assets/media.js";
import { IMAGE_RATIOS } from "../importers/image-ratio.js";
import sections from "../catalog/slots/sections.json";

const image: ImageResource = { kind: "share", src: "/image.webp", width: 1200, height: 630, alt: "Resource", sources: [{ src: "/image.avif", width: 1200, height: 630, media: "(min-width: 40rem)" }], sizes: "100vw", focal: { x: .25, y: .75 }, placeholder: { kind: "blur", value: "/still.webp" } };

describe("structured media wiring", () => {
  it("groups adjacent responsive candidates without changing art-direction precedence", () => {
    const html = renderToStaticMarkup(<MediaFigure image={{ ...image, sources: [
      { media: "(min-width: 40rem)", src: "/large.webp", width: 1200, height: 630 },
      { media: "(min-width: 40rem)", src: "/larger.webp", width: 2400, height: 1260 },
      { media: "(min-width: 40rem)", src: "/portrait.webp", width: 900, height: 1200 },
      { media: "(max-width: 39.99rem)", src: "/small.webp", width: 600, height: 800 },
      { media: "(min-width: 40rem)", src: "/last.webp", width: 600, height: 315 },
    ] }} ratio="cinema" />);
    const root = document.createElement("div");
    root.innerHTML = html;
    const picture = root.querySelector("picture")!;
    const sources = [...picture.querySelectorAll("source")];
    expect(sources.map(source => source.getAttribute("srcset"))).toEqual([
      "/large.webp 1200w, /larger.webp 2400w", "/portrait.webp 900w", "/small.webp 600w", "/last.webp 600w",
    ]);
    expect(sources.map(source => source.getAttribute("media"))).toEqual([
      "(min-width: 40rem)", "(min-width: 40rem)", "(max-width: 39.99rem)", "(min-width: 40rem)",
    ]);
    for (const source of sources) expect(source.getAttribute("sizes")).toBe(image.sizes);
    expect(picture.style.display).toBe("block");
    expect(picture.style.height).toBe("100%");
    const fallback = picture.querySelector("img")!;
    expect(fallback.getAttribute("src")).toBe(image.src);
    expect(fallback.getAttribute("sizes")).toBe(image.sizes);
    expect(fallback.getAttribute("width")).toBe("1200");
    expect(fallback.getAttribute("height")).toBe("630");
    expect(fallback.style.objectFit).toBe("cover");
    expect(fallback.style.objectPosition).toBe("25% 75%");
    expect(picture.parentElement!.style.aspectRatio).toBe("21 / 9");
  });

  it("allows image resources on exactly the six requested section entries", () => {
    const requested = ["hero", "media", "features", "testimonials", "people", "logo-cloud"];
    for (const id of requested) {
      const entry = sections.find(slot => slot.id === `sections.${id}`)!;
      expect(entry.contract.allowedReads.assets).toContain("assets.image");
    }
  });

  it("declares the existing semantic primitive used by the media implementation", () => {
    const entry = sections.find(slot => slot.id === "sections.media")!;
    expect(entry.contract.allowedComposes).toContain("components.semantic-content");
  });

  it("renders every responsive image field and binds a canonical crop", () => {
    const html = renderToStaticMarkup(<MediaFigure image={image} ratio="cinema" caption="Caption" />);
    expect(html).toContain('<picture style="display:block;width:100%;height:100%">');
    expect(html).toContain('srcSet="/image.avif 1200w"');
    expect(html).toContain('media="(min-width: 40rem)"');
    expect(html).toContain('sizes="100vw"');
    expect(html).toContain('object-position:25% 75%');
    expect(html).toContain('background-image:url(&quot;/still.webp&quot;)');
    expect(html).toContain('aspect-ratio:21 / 9');
    expect(html).toContain('alt="Resource"');
    expect(html).toContain('width="1200" height="630"');
    expect(IMAGE_RATIOS.share).toEqual({ width: 191, height: 100 });
  });
  it("paints a color placeholder and reserves intrinsic dimensions without an explicit crop", () => {
    const html = renderToStaticMarkup(<MediaFigure image={{ ...image, placeholder: { kind: "color", value: "#abcdef" } }} />);
    expect(html).toContain("background-color:#abcdef");
    expect(html).toContain("aspect-ratio:1200 / 630");
  });
  it("composes through the existing hero and gallery media slots", () => {
    const media = <MediaFigure image={image} ratio="share" />;
    expect(renderToStaticMarkup(<Hero heading="Heading" media={media} />)).toContain('src="/image.webp"');
    expect(renderToStaticMarkup(<Gallery label="Gallery" lightbox={false} images={[{ id: "one", label: "One", media }]} />)).toContain('src="/image.webp"');
  });
  it("retains node media and gives decorative images empty alternatives", () => {
    expect(renderToStaticMarkup(<MediaFigure>Media</MediaFigure>)).toContain('Media');
    expect(renderToStaticMarkup(<MediaFigure image={{ ...image, decorative: true }} />)).toContain('alt=""');
  });
  it("rejects conflicting media and unknown crop members", () => {
    expect(() => renderToStaticMarkup(<MediaFigure image={image}>Conflict</MediaFigure>)).toThrow("image or children");
    expect(() => renderToStaticMarkup(<MediaFigure image={image} ratio={"unknown" as "square"} />)).toThrow("Invalid image ratio");
  });
  it("rejects malformed optional image fields at validation and render boundaries", () => {
    for (const patch of [{ sources: [{}] }, { sources: [] }, { sources: [{ src: "/a.webp", height: 630, media: "screen" }] }, { sizes: " " }, { focal: { x: 2, y: 0 } }, { focal: { x: 0 } }, { placeholder: { kind: "blur", value: "" } }, { placeholder: { kind: "video", value: "/a.webp" } }]) {
      const invalid = { ...image, ...patch };
      expect(isImageResource(invalid)).toBe(false);
      expect(() => renderToStaticMarkup(<MediaFigure image={invalid as ImageResource} />)).toThrow();
    }
  });
});
