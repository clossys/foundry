import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SECTIONED_VIEW_ITEM_RECIPES, SECTIONED_VIEW_CONTENT_CONTRACT, resolveSectionedViewDocument } from "../core/index.js";
import { LandingView } from "../web/views/LandingView.server.js";
import type { LandingViewProps } from "../web/views/LandingView.js";
import { SectionedView } from "../web/views/SectionedView.server.js";
import { CATALOG_FIXTURES, CATALOG_COMPOSITIONS, catalogCopyResolver, OTHER_KIND_LINKS, type CatalogFixture } from "./catalog/index.js";
import type { ContentCatalogStylesheets } from "./render-content-catalog.js";
import type { ResolvedSectionedViewContentSection, SectionedViewDocument } from "../core/sectioned-view.js";

export const CATALOG_FUNCTIONS = [
  { id: "say", label: "Say", purpose: "Introduce, explain and invite the next action.", axes: ["role", "size", "actions"] },
  { id: "items", label: "Items", purpose: "Arrange a set of related ideas and steps.", axes: ["arrangement", "order", "reveal", "treatment", "slots"] },
  { id: "matrix", label: "Matrix", purpose: "Compare two sides using the same primary form.", axes: ["points", "visual", "featured"] },
  { id: "frame", label: "Frame", purpose: "Choose a ground, measure and direction for a section.", axes: ["ground", "size", "layout", "actions"] },
  { id: "media", label: "Media", purpose: "Show sample panels, records and connected scenes.", axes: ["specimen", "key", "record", "scene", "previous"] },
  { id: "recipes", label: "Recipes", purpose: "Start from compatible defaults and compose a complete page.", axes: ["fixed", "defaults", "free", "composition"] },
  { id: "other", label: "Other kinds", purpose: "Visit the existing published section examples.", axes: ["published kinds"] },
] as const;

const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const chrome = `body{margin:0;background:var(--color-surface-base)}.catalog-nav,.catalog-note,.catalog-table{font-family:var(--font-body);font-size:var(--text-body-s);line-height:1.5;color:var(--color-ink-primary);background:var(--color-surface-sunken);padding:var(--spacing-xl);overflow-wrap:anywhere}.catalog-nav ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--ui-width-prose-max)/2)),1fr));gap:var(--spacing-xl);padding:0;list-style:none}.catalog-nav a,.catalog-note a,.catalog-table a{color:inherit}.catalog-nav h1{font-family:var(--font-display);font-size:var(--text-h2)}.catalog-chip{display:inline-block;font-family:var(--font-mono);font-size:var(--text-caption);line-height:1.5;border:var(--ui-border-hairline) solid var(--color-line-base);padding:var(--spacing-xs) var(--spacing-sm);margin:var(--spacing-xs)}.catalog-note h2,.catalog-note h3{margin:0 0 var(--spacing-sm)}.catalog-table{width:100%;min-width:var(--ui-width-content-max);border-collapse:collapse}.catalog-table th,.catalog-table td{padding:var(--spacing-md);text-align:left;border-bottom:var(--ui-border-hairline) solid var(--color-line-base);vertical-align:top}.catalog-table-wrap{overflow-x:auto}.catalog-example,.catalog-example>div{min-width:0}.catalog-example>div{padding-inline:var(--ui-width-page-padding-x)}`;
function page(title: string, body: string, sheets: ContentCatalogStylesheets): string {
  const links = [sheets.designerTokens, sheets.utilities, ...(sheets.brand === null ? [] : [sheets.brand])].map(href => `<link rel="stylesheet" href="${escape(href)}" />`).join("\n");
  return `<!DOCTYPE html>\n<html lang="en" data-brand-bound><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(title)}</title>${links}<style>${chrome}</style></head><body><main id="catalog-page">${body}</main></body></html>\n`;
}
const chips = (axes: readonly string[]): string => axes.map(axis => `<span class="catalog-chip" data-catalog-axis="${escape(axis)}">${escape(axis)}</span>`).join("");
export function buildFunctionalCatalogIndex(sheets: ContentCatalogStylesheets): string {
  return page("Content catalog", `<header class="catalog-nav"><h1>Content catalog</h1><p>Choose a function, then explore its axes and compatible recipes.</p><ul>${CATALOG_FUNCTIONS.map(fn => `<li data-catalog-function="${fn.id}"><h2><a href="catalog/${fn.id}.html">${fn.label}</a></h2><p>${fn.purpose}</p>${chips(fn.axes)}</li>`).join("")}</ul></header>`, sheets);
}
function closeProps(section: ResolvedSectionedViewContentSection): NonNullable<LandingViewProps["callToAction"]> {
  const actions = (section.actions ?? []).map(action => {
    if (action.emphasis === "tertiary") throw new Error("Catalog closing actions need a supported Landing action emphasis.");
    return { ...action, emphasis: action.emphasis };
  });
  return { id: section.id, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: section.footnote === undefined ? undefined : section.footnote.text === undefined ? { text: createElement("a", { href: section.footnote.link.href }, section.footnote.link.label) } : section.footnote };
}
export function renderCatalogComposition(id: string): string {
  const document = CATALOG_COMPOSITIONS[id];
  if (document === undefined) throw new Error(`Unknown catalog composition ${id}.`);
  const resolved = resolveSectionedViewDocument(document, catalogCopyResolver);
  const close = resolved.sections.at(-1);
  if (close?.kind !== "content-section") throw new Error("Catalog composition needs a closing content section.");
  return renderToStaticMarkup(createElement(LandingView, { document: { ...resolved, sections: resolved.sections.slice(0, -1) }, header: "reserved", peek: false, landmark: "none", callToAction: closeProps(close) }));
}
export function renderCatalogFixture(fixture: CatalogFixture): string {
  if (fixture.fn === "Recipes") return renderCatalogComposition(fixture.id);
  const document: SectionedViewDocument = { id: `catalog-${fixture.id}`, sections: [fixture.section] };
  const resolved = resolveSectionedViewDocument(document, catalogCopyResolver);
  if (fixture.section.kind === "hero") return renderToStaticMarkup(createElement(LandingView, { document: resolved, header: "reserved", peek: false, landmark: "none" }));
  if (fixture.id === "say-close") {
    const hero = CATALOG_FIXTURES.find(entry => entry.id === "say-hero-display");
    const close = resolved.sections[0];
    if (hero === undefined || close?.kind !== "content-section") throw new Error("Catalog close needs its hero context.");
    const heroDocument = resolveSectionedViewDocument({ id: "catalog-close-context", sections: [hero.section] }, catalogCopyResolver);
    const html = renderToStaticMarkup(createElement(LandingView, { document: heroDocument, header: "reserved", peek: false, landmark: "none", callToAction: closeProps(close) }));
    return html.slice(html.indexOf(`<section id="${close.id}"`), html.lastIndexOf("</div>"));
  }
  return renderToStaticMarkup(createElement(SectionedView, { document: resolved, landmark: "none" }));
}
export const CATALOG_RECIPE_LINKS = Object.fromEntries(SECTIONED_VIEW_CONTENT_CONTRACT.recipes.map(recipe => {
  const fixture = CATALOG_FIXTURES.find(entry => entry.section.kind === "content-section" && entry.section.block?.type === "items" && entry.section.block.recipe === recipe);
  if (fixture === undefined) throw new Error(`Catalog needs an example of ${recipe}.`);
  return [recipe, fixture.id];
}));
function recipeTable(): string {
  const aliases: Partial<Record<string, string>> = { features: "feature-grid", faq: "faq", steps: "ordered-step-sequence" };
  const axes = ["arrangement", "order", "reveal", "treatment", "scale"];
  const rows = SECTIONED_VIEW_CONTENT_CONTRACT.recipes.map(recipe => {
    const definition = SECTIONED_VIEW_ITEM_RECIPES[recipe];
    const values = (value: object): string => Object.entries(value).map(([key, value]) => `${key}=${value}`).join(", ") || "—";
    return `<tr data-catalog-recipe="${recipe}"><th><a href="items.html#example-${CATALOG_RECIPE_LINKS[recipe]}">${recipe}</a></th><td data-recipe-fixed>${escape(values(definition.fixed))}</td><td data-recipe-defaults>${escape(values(definition.defaults ?? {}))}</td><td data-recipe-free>${escape([...axes, ...(["columns", "rows"].includes(String(definition.fixed.arrangement ?? definition.defaults?.arrangement)) ? ["columns"] : [])].filter(axis => !Object.hasOwn(definition.fixed, axis)).join(", "))}${definition.treatments === undefined ? "" : `<br />treatment: ${escape(definition.treatments.join(" / "))}`}</td><td data-recipe-slots>${escape(definition.slots.join(", ") || "—")}${definition.requiredSlot === undefined ? "" : `<br />required: ${escape(definition.requiredSlot)}`}</td><td>${escape(aliases[recipe] ?? "—")}</td></tr>`;
  }).join("");
  return `<div class="catalog-table-wrap" role="region" aria-label="Recipe reference" tabindex="0"><table class="catalog-table"><thead><tr><th>Recipe</th><th>Fixed axes</th><th>Defaults</th><th>Free axes</th><th>Compatible slots</th><th>Published alias</th></tr></thead><tbody>${rows}<tr data-catalog-recipe="comparison"><th><a href="matrix.html#example-matrix-points">comparison</a></th><td>two sides</td><td>—</td><td>primary form, featured</td><td>points or visual, optional description lead</td><td>—</td></tr></tbody></table></div>`;
}
export function buildCatalogFunctionPages(sheets: ContentCatalogStylesheets): Array<{ file: string; content: string }> {
  const nested = { designerTokens: `../${sheets.designerTokens}`, utilities: `../${sheets.utilities}`, brand: sheets.brand === null ? null : `../${sheets.brand}` };
  return CATALOG_FUNCTIONS.map(fn => {
    const fixtures = CATALOG_FIXTURES.filter(fixture => fixture.fn === fn.label);
    const axes = [...new Set(fixtures.map(fixture => fixture.axis))];
    let body = `<header class="catalog-nav"><a href="../content-catalog.html">Content catalog</a><h1>${fn.label}</h1><p>${fn.purpose}</p>${chips(fn.axes)}</header>`;
    if (fn.id === "recipes") body += recipeTable();
    if (fn.id === "other") body += `<nav class="catalog-nav"><ul>${OTHER_KIND_LINKS.map(link => `<li data-published-kind="${link.kind}"><a href="${link.href}">${link.kind}</a></li>`).join("")}</ul></nav>`;
    for (const axis of axes) {
      body += `<section data-catalog-axis-group="${escape(axis)}"><header class="catalog-note"><h2>${escape(axis)}</h2></header>`;
      for (const fixture of fixtures.filter(fixture => fixture.axis === axis)) body += `<article class="catalog-example" id="example-${fixture.id}" data-catalog-fixture="${fixture.id}"><header class="catalog-note"><h3>${escape(fixture.caption)}</h3>${chips([fixture.axis, ...(Array.isArray(fixture.value) ? fixture.value : [String(fixture.value)])])}</header><div${fixture.fn === "Recipes" ? ' data-catalog-composition=""' : ""}>${renderCatalogFixture(fixture)}</div></article>`;
      body += "</section>";
    }
    return { file: `catalog/${fn.id}.html`, content: page(`${fn.label} — Content catalog`, body, nested) };
  });
}
