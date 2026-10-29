import { describe, expect, it, vi } from "vitest";

// A distinct canonical member proves these builders read the media contract,
// rather than duplicating the channel registry's current dimensions.
vi.mock("@clossys/designer/catalog", () => ({ IMAGE_RATIOS: { share: { width: 1000, height: 525 } } }));
import { buildBrandShareCard, buildShareCard } from "./shareCard.js";

describe("share image member", () => {
  it("reads the canonical share ratio while retaining standard channel pixel dimensions", () => {
    const cards = [
      buildShareCard({ name: "Name", tagline: "Tagline", alt: "Alternative" }),
      buildBrandShareCard({ markSrc: "data:image/png;base64,YQ==", headline: "Headline" }),
    ];
    for (const card of cards) {
      expect(card).toMatchObject({ width: 1200, height: 630, shareCard: { width: 1200, height: 630 } });
      expect(card.element.props.style).toMatchObject({ width: 1200, height: 630, aspectRatio: "1000 / 525" });
    }
  });
});
