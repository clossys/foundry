import { createElement } from "react";
import type { CopyResolver } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { SECTIONED_VIEW_CONTENT_CONTRACT, resolveSectionedViewDocument } from "../../core/index.js";
import { SectionedView } from "../../web/views/SectionedView.server.js";
import { CATALOG_FIXTURES, CATALOG_COMPOSITIONS, catalogCopyResolver, type CatalogFixture } from "./index.js";
import type { ResolvedSectionedViewDocument, SectionedViewDocument, SectionedViewGround } from "../../core/sectioned-view.js";
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

/** Render every section of the checked fixture, including closing actions and footnotes. */
export function renderCatalogComposition(id: string): string {
    const document = CATALOG_COMPOSITIONS[id];
    if (document === undefined) throw new Error(`Unknown catalog composition ${id}.`);
    const resolved = resolveSectionedViewDocument(document, catalogCopyResolver);
    return renderToStaticMarkup(createElement(SectionedView, { document: resolved, landmark: "none" }));
}
export function renderCatalogFixture(fixture: CatalogFixture): string {
    if (fixture.fn === "Recipes" && fixture.axis === "composition") return renderCatalogComposition(fixture.id);
    return renderToStaticMarkup(createElement(SectionedView, { document: resolveCatalogFixtureDocument(fixture), landmark: "none" }));
}
export const CATALOG_RECIPE_LINKS = Object.fromEntries(SECTIONED_VIEW_CONTENT_CONTRACT.recipes.map(recipe => {
    const fixture = CATALOG_FIXTURES.find(entry => entry.section.kind === "content-section" && entry.section.block?.type === "items" && entry.section.block.recipe === recipe);
    if (fixture === undefined)
        throw new Error(`Catalog needs an example of ${recipe}.`);
    return [recipe, fixture.id];
}));
