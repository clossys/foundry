// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSectionedViewDocument, resolveSectionedViewDocument } from "../../core/sectioned-view.js";
import { heroCompactCatalogDocument, contentCatalogCopyResolver } from "../../preview/fixture-content-catalog.js";
import { LandingView, type LandingViewProps } from "@clossys/designer/frames";
const dom = (props: LandingViewProps) => { const host = document.createElement("div"); host.innerHTML = renderToStaticMarkup(<LandingView {...props} />); return host; };
describe("compact catalog fixture", () => {
  it("uses generic inverse copy without actions and renders through LandingView", () => {
    expect(validateSectionedViewDocument(heroCompactCatalogDocument)).toEqual([]);
    const hero = heroCompactCatalogDocument.sections[0];
    expect(hero).toMatchObject({ id: "hero-compact", ground: "inverse", size: "compact" });
    expect(hero).not.toHaveProperty("actions");
    const root = dom({ document: resolveSectionedViewDocument(heroCompactCatalogDocument, contentCatalogCopyResolver), header: "reserved" });
    expect(root.querySelector("[data-hero-size=compact]")).not.toBeNull();
    expect(root.querySelectorAll("h1")).toHaveLength(1);
  });
});
