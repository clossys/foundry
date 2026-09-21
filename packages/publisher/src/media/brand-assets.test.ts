import { describe, expect, it } from "vitest";
import { checkBrandAssetRoster, deriveBrandAssetRoster, type BrandAssetEntry } from "./brand-assets.js";
import { brandAssetHeadLinks, publicationMapEmitsBrandAssets } from "../web/brandAssetHead.js";
import type { PublicationMap } from "../core/publication-map.js";

const MASTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;

function complete(alt = "Fixture mark"): BrandAssetEntry[] {
  return [
    { role: "favicon-svg", src: MASTER, width: 0, height: 0, alt },
    { role: "favicon-32", src: "/favicon-32.png", width: 32, height: 32, alt },
    { role: "apple-touch-180", src: "/apple-touch.png", width: 180, height: 180, alt },
    { role: "maskable-192", src: "/maskable-192.png", width: 192, height: 192, alt },
    { role: "maskable-512", src: "/maskable-512.png", width: 512, height: 512, alt },
    { role: "open-graph", src: "/og.png", width: 1200, height: 630, alt },
    { role: "twitter-image", src: "/twitter.png", width: 1200, height: 630, alt },
    { role: "email-png", src: "/email.png", width: 600, height: 200, alt },
  ];
}

describe("brand asset roster", () => {
  it("fails a master SVG until every required role exists at the required pixel size", () => {
    const derived = deriveBrandAssetRoster(MASTER, [{ role: "favicon-32", src: "/favicon-32.png", width: 16, height: 16, alt: "Fixture mark" }]);
    expect(derived.findings.some((finding) => finding.role === "favicon-32" && finding.message.includes("32×32"))).toBe(true);
    expect(derived.findings.some((finding) => finding.message.includes("apple-touch-180"))).toBe(true);
    expect(checkBrandAssetRoster(complete())).toEqual([]);
  });

  it("links the favicon and touch icon once the roster is complete and the map has a web path", () => {
    const links = brandAssetHeadLinks(complete());
    expect(links).toEqual([
      { rel: "icon", href: MASTER, type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch.png", sizes: "180x180" },
    ]);
    const map: PublicationMap = {
      entries: [
        { id: "home", template: "MarketingView", documentId: "doc.home", location: { kind: "path", path: "/" } },
        { id: "deck", template: "MarketingView", documentId: "doc.deck", location: { kind: "slide", index: 0 } },
      ],
    };
    expect(publicationMapEmitsBrandAssets(map)).toBe(true);
    expect(brandAssetHeadLinks([])).toEqual([]);
  });
});
