import { createElement } from "react";
import type { CopyResolver } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { SECTIONED_VIEW_CONTENT_CONTRACT, resolveSectionedViewDocument } from "../../core/index.js";
import { ServerLandingView as LandingView } from "@clossys/designer/frames";
import type { LandingViewProps } from "@clossys/designer/frames";
import { SectionedView } from "../../web/views/SectionedView.server.js";
import { CATALOG_FIXTURES, CATALOG_COMPOSITIONS, catalogCopyResolver, type CatalogFixture } from "./index.js";
import type { ResolvedSectionedViewContentSection, ResolvedSectionedViewDocument, SectionedViewDocument, SectionedViewGround } from "../../core/sectioned-view.js";
/** Package-private preview projection; original authored validation and copy resolution run first. */
export function resolveCatalogPresentationDocument(
    document: SectionedViewDocument,
    resolver: CopyResolver,
    sectionId?: string,
    ground?: SectionedViewGround,
): ResolvedSectionedViewDocument {
    const resolved = resolveSectionedViewDocument(document, resolver);
    if (ground === undefined || sectionId === undefined) return resolved;
    if (!resolved.sections.some(section => section.id === sectionId && section.kind === "content-section"))
        throw new Error("Catalog presentation needs an existing canonical section.");
    return {
        ...resolved,
        sections: resolved.sections.map(section => section.id === sectionId ? { ...section, ground } : section),
        ...(resolved.viewGrounds === undefined ? {} : { viewGrounds: resolved.viewGrounds.filter(id => id !== sectionId) }),
    };
}

/** Existing ground descriptors affect only the resolved preview model. */
export function resolveCatalogFixtureDocument(
    fixture: CatalogFixture,
    resolver: CopyResolver = catalogCopyResolver,
): ResolvedSectionedViewDocument {
    const ground = fixture.axis === "ground" ? fixture.value : undefined;
    const presentation = fixture.section.kind === "content-section" && (ground === "base" || ground === "sunken" || ground === "inverse") ? ground : undefined;
    return resolveCatalogPresentationDocument(
        { id: `catalog-${fixture.id}`, sections: [fixture.section] }, resolver,
        presentation === undefined ? undefined : fixture.section.id, presentation,
    );
}

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
    if (fixture.fn === "Recipes" && fixture.axis === "composition")
        return renderCatalogComposition(fixture.id);
    const resolved = resolveCatalogFixtureDocument(fixture);
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
