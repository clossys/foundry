import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A distinct canonical member proves these builders read the media contract,
// rather than duplicating the channel registry's current dimensions.
const canonical = vi.hoisted(() => ({ share: { width: 191, height: 100 } }));
vi.mock("@clossys/designer/catalog", () => ({ IMAGE_RATIOS: canonical }));
import { buildBrandShareCard, buildShareCard } from "./shareCard.js";

describe("share image member", () => {
  afterEach(() => { canonical.share = { width: 191, height: 100 }; });

  function cards() {
    return [
      buildShareCard({ name: "Name", tagline: "Tagline", alt: "Alternative" }),
      buildBrandShareCard({ markSrc: "data:image/png;base64,YQ==", headline: "Headline" }),
    ];
  }

  it("reads the exact canonical share member from the public Designer catalog", async () => {
    const actual = await vi.importActual<typeof import("@clossys/designer/catalog")>("@clossys/designer/catalog");
    expect(actual.IMAGE_RATIOS.share).toEqual({ width: 191, height: 100 });
  });

  it("keeps the channel geometry while the preferred canonical crop has a different rounded height", () => {
    expect(Math.round(1200 * canonical.share.height / canonical.share.width)).toBe(628);
    for (const card of cards()) {
      expect(card).toMatchObject({ width: 1200, height: 630, shareCard: { width: 1200, height: 630 } });
      expect(card.element.props.style).toMatchObject({ width: 1200, height: 630, aspectRatio: "191 / 100" });
      const markup = renderToStaticMarkup(card.element);
      expect(markup).toContain("width:1200px;height:630px;aspect-ratio:191 / 100");
    }
  });

  it("reads changed canonical geometry in both builders without replacing channel dimensions", () => {
    canonical.share = { width: 3, height: 2 };
    for (const card of cards()) {
      expect(card).toMatchObject({ width: 1200, height: 630, shareCard: { width: 1200, height: 630 } });
      expect(card.element.props.style).toMatchObject({ width: 1200, height: 630, aspectRatio: "3 / 2" });
    }
  });
});
