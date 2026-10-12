import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SECTIONED_VIEW_CONTENT_CONTRACT, resolveSectionedViewDocument } from "../../core/index.js";
import { LandingView } from "../../web/views/LandingView.server.js";
import type { LandingViewProps } from "../../web/views/LandingView.js";
import { SectionedView } from "../../web/views/SectionedView.server.js";
import { CATALOG_FIXTURES, CATALOG_COMPOSITIONS, catalogCopyResolver, type CatalogFixture } from "./index.js";
import type { ResolvedSectionedViewContentSection, SectionedViewDocument } from "../../core/sectioned-view.js";
/** Native qualification for the complete retained contract fixture inventory. */
function closeProps(section: ResolvedSectionedViewContentSection): NonNullable<LandingViewProps["callToAction"]> {
    const actions = (section.actions ?? []).map(action => {
        if (action.emphasis === "tertiary")
            throw new Error("Catalog closing actions need a supported Landing action emphasis.");
        return { ...action, emphasis: action.emphasis };
    });
    return { id: section.id, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: section.footnote === undefined ? undefined : section.footnote.text === undefined ? { text: createElement("a", { href: section.footnote.link.href }, section.footnote.link.label) } : section.footnote };
}
export function renderCatalogComposition(id: string): string {
    const document = CATALOG_COMPOSITIONS[id];
    if (document === undefined)
        throw new Error(`Unknown catalog composition ${id}.`);
    const resolved = resolveSectionedViewDocument(document, catalogCopyResolver);
    const close = resolved.sections.at(-1);
    if (close?.kind !== "content-section")
        throw new Error("Catalog composition needs a closing content section.");
    return renderToStaticMarkup(createElement(LandingView, { document: { ...resolved, sections: resolved.sections.slice(0, -1) }, header: "reserved", peek: false, landmark: "none", callToAction: closeProps(close) }));
}
export function renderCatalogFixture(fixture: CatalogFixture): string {
    if (fixture.fn === "Recipes")
        return renderCatalogComposition(fixture.id);
    const document: SectionedViewDocument = { id: `catalog-${fixture.id}`, sections: [fixture.section] };
    const resolved = resolveSectionedViewDocument(document, catalogCopyResolver);
    if (fixture.section.kind === "hero")
        return renderToStaticMarkup(createElement(LandingView, { document: resolved, header: "reserved", peek: false, landmark: "none" }));
    if (fixture.id === "say-close") {
        const hero = CATALOG_FIXTURES.find(entry => entry.id === "say-hero-display");
        const close = resolved.sections[0];
        if (hero === undefined || close?.kind !== "content-section")
            throw new Error("Catalog close needs its hero context.");
        const heroDocument = resolveSectionedViewDocument({ id: "catalog-close-context", sections: [hero.section] }, catalogCopyResolver);
        const html = renderToStaticMarkup(createElement(LandingView, { document: heroDocument, header: "reserved", peek: false, landmark: "none", callToAction: closeProps(close) }));
        return html.slice(html.indexOf(`<section id="${close.id}"`), html.lastIndexOf("</div>"));
    }
    return renderToStaticMarkup(createElement(SectionedView, { document: resolved, landmark: "none" }));
}
export const CATALOG_RECIPE_LINKS = Object.fromEntries(SECTIONED_VIEW_CONTENT_CONTRACT.recipes.map(recipe => {
    const fixture = CATALOG_FIXTURES.find(entry => entry.section.kind === "content-section" && entry.section.block?.type === "items" && entry.section.block.recipe === recipe);
    if (fixture === undefined)
        throw new Error(`Catalog needs an example of ${recipe}.`);
    return [recipe, fixture.id];
}));
