import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaFigure } from "./MediaFigure.js";
import { Hero } from "./Hero.js";
import { Gallery } from "./Gallery.js";
import { isImageResource, type ImageResource } from "../catalog-assets/media.js";
import { IMAGE_RATIOS } from "../importers/image-ratio.js";

const image: ImageResource = { kind: "share", src: "/image.webp", width: 1200, height: 630, alt: "Resource", sources: [{ src: "/image.avif", width: 1200, height: 630, media: "(min-width: 40rem)" }], sizes: "100vw", focal: { x: .25, y: .75 }, placeholder: { kind: "blur", value: "/still.webp" } };

describe("structured media wiring", () => {
  it("renders every responsive image field and binds a canonical crop", () => {
    const html = renderToStaticMarkup(<MediaFigure image={image} ratio="cinema" caption="Caption" />);
    expect(html).toContain('<picture>');
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
  it("rejects malformed optional image fields at validation and render boundaries", () => {
    for (const patch of [{ sources: [{}] }, { sources: [] }, { sources: [{ src: "/a.webp", height: 630, media: "screen" }] }, { sizes: " " }, { focal: { x: 2, y: 0 } }, { focal: { x: 0 } }, { placeholder: { kind: "blur", value: "" } }, { placeholder: { kind: "video", value: "/a.webp" } }]) {
      const invalid = { ...image, ...patch };
      expect(isImageResource(invalid)).toBe(false);
      expect(() => renderToStaticMarkup(<MediaFigure image={invalid as ImageResource} />)).toThrow();
    }
  });
});
