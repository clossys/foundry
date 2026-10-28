import { resolveDocumentLocale, type DocumentLocaleOptions } from "../render-document-locale.js";
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveSectionedViewDocument, desugarRecipe, SECTIONED_VIEW_ITEM_RECIPES, SECTIONED_VIEW_CONTENT_CONTRACT } from '../../core/index.js';
import { LandingView } from '../../web/views/LandingView.server.js';
import type { LandingViewProps } from '../../web/views/LandingView.js';
import { SectionedView } from '../../web/views/SectionedView.server.js';
import type { ResolvedSectionedViewContentSection, ResolvedSectionedViewDocument } from '../../core/sectioned-view.js';
import type { ContentCatalogStylesheets } from '../render-content-catalog.js';
import { OTHER_KIND_LINKS, type CatalogFixture } from './index.js';
import { CATALOG_RECIPE_LINKS } from './contract-reference.js';
import { READER_SAMPLES, READER_STATUS_LIST, readerCopyResolver, readerPage, deriveCatalogFunction, resolveReaderSampleDocument, type ReaderPage } from './reader-data.js';
type CatalogAxis = {
    name: string;
    values: readonly string[];
    effect: string;
    when: string;
};
type CatalogPage = {
    id: string;
    label: ReaderPage;
    purpose: string;
    axes: readonly CatalogAxis[];
};
export const READER_PAGES: readonly CatalogPage[] = [
    {
        "id": "overview",
        "label": "Overview",
        "purpose": "Choose the reader’s job, then a compatible recipe. Use Show for a leading visual, Explain for parallel ideas, Index for lookup, Sequence for order, and Compare for alternatives.",
        "axes": []
    },
    {
        "id": "introduce",
        "label": "Introduce",
        "purpose": "Set the page’s subject or invite the next action. Choose Show when a visual carries the meaning.",
        "axes": [
            {
                "name": "role",
                "values": [
                    "hero",
                    "intro",
                    "close"
                ],
                "effect": "Opens a page, introduces a band, or closes with an action.",
                "when": "Match the position and reader’s next step."
            },
            {
                "name": "hero-size",
                "values": [
                    "display",
                    "compact"
                ],
                "effect": "Changes hero scale and space.",
                "when": "Display for an opening focal point; compact for an inner-page guide."
            },
            {
                "name": "intro-layout",
                "values": [
                    "stacked",
                    "split"
                ],
                "effect": "Keeps the header together or places copy beside it.",
                "when": "Split when short supporting copy benefits from a second column."
            }
        ]
    },
    {
        "id": "show",
        "label": "Show",
        "purpose": "Lead with one visual or piece of evidence. Choose Introduce for a subject and action; choose Explain when several parallel ideas carry the meaning.",
        "axes": [
            {
                "name": "visual",
                "values": [
                    "specimen",
                    "specimen-key",
                    "record",
                    "scene"
                ],
                "effect": "Shows a panel, annotation, grouped context, or relationships.",
                "when": "Choose the form matching the evidence."
            },
            {
                "name": "companion",
                "values": [
                    "none",
                    "index-rows",
                    "explain-stack"
                ],
                "effect": "Adds lookup entries or illustrated supporting ideas.",
                "when": "Add only context the leading visual cannot carry."
            },
            {
                "name": "layout",
                "values": ["stacked", "split-start", "split-end"],
                "effect": "Places the leading visual below or beside its context.",
                "when": "Stack a wide visual; split when context fits alongside it."
            }
        ]
    },
    {
        "id": "explain",
        "label": "Explain",
        "purpose": "Explain parallel ideas or a passage of prose. Choose Index when the reader needs to find a short entry or answer.",
        "axes": [
            {
                "name": "shape",
                "values": [
                    "grid-2",
                    "grid-3",
                    "bento",
                    "stack"
                ],
                "effect": "Changes the rhythm and weight of parallel ideas.",
                "when": "Grid for peers; bento for different weights; stack for one visual per idea."
            },
            {
                "name": "treatment",
                "values": [
                    "plain",
                    "rule",
                    "plate"
                ],
                "effect": "Adds open space, dividers, or containers.",
                "when": "Choose the amount of separation each idea needs."
            },
            {
                "name": "scale",
                "values": [
                    "item",
                    "statement"
                ],
                "effect": "Changes concise headings into short statements.",
                "when": "Statement for a small set of guiding principles."
            }
        ]
    },
    {
        "id": "index-function",
        "label": "Index",
        "purpose": "Help the reader scan for an entry, destination, or answer. Choose Explain when each idea needs explanation.",
        "axes": [
            {
                "name": "shape",
                "values": [
                    "rows-1",
                    "rows-2",
                    "tiles"
                ],
                "effect": "Changes scan density and linked destinations.",
                "when": "Rows for lookup; tiles for a few clear destinations."
            },
            {
                "name": "reveal",
                "values": [
                    "all",
                    "disclose"
                ],
                "effect": "Shows every entry or opens an answer on demand.",
                "when": "Disclose for answers in one-column rows."
            },
            {
                "name": "groups",
                "values": [
                    "off",
                    "on"
                ],
                "effect": "Adds labelled groups to rows.",
                "when": "Group when the list has meaningful categories."
            }
        ]
    },
    {
        "id": "sequence",
        "label": "Sequence",
        "purpose": "Make the order or hand-off clear. Choose Compare when the reader weighs alternatives rather than follows steps.",
        "axes": [
            {
                "name": "shape",
                "values": [
                    "list",
                    "line",
                    "lanes"
                ],
                "effect": "Shows order, connected steps, or two roles.",
                "when": "Use lanes when ownership changes between roles."
            },
            {
                "name": "end",
                "values": [
                    "ends",
                    "continues"
                ],
                "effect": "Marks a terminal step or a named continuation.",
                "when": "Continue when the next hand-off is stated."
            }
        ]
    },
    {
        "id": "compare",
        "label": "Compare",
        "purpose": "Help the reader weigh two alternatives side by side. Choose Sequence when order or hand-off is the point.",
        "axes": [
            {
                "name": "form",
                "values": [
                    "points",
                    "visual"
                ],
                "effect": "Compares matched points or one panel per side.",
                "when": "Match the primary evidence on both sides."
            },
            {
                "name": "featured",
                "values": [
                    "none",
                    "one-side"
                ],
                "effect": "Gives one alternative visual priority.",
                "when": "Feature when the comparison recommends that alternative."
            }
        ]
    },
    {
        "id": "frame",
        "label": "Frame",
        "purpose": "Choose the shared ground, layout, and size around a reader job; use the function pages to choose that job.",
        "axes": [
            {
                "name": "layout",
                "values": [
                    "stacked",
                    "split-start",
                    "split-end"
                ],
                "effect": "Places headers and modules together or side by side.",
                "when": "Match content width and reading order."
            },
            {
                "name": "size",
                "values": [
                    "standard",
                    "display"
                ],
                "effect": "Changes scale and spacing.",
                "when": "Display for a focal band; standard for supporting content."
            },
            {
                "name": "ground",
                "values": [
                    "base",
                    "sunken",
                    "inverse"
                ],
                "effect": "Changes surface and contrast.",
                "when": "Omit ground for automatic base and sunken cadence; reserve inverse for a focal band."
            }
        ]
    },
    {
        "id": "parts",
        "label": "Parts",
        "purpose": "Find the fields, states, measurements, records, and scenes used inside Show examples. Follow each link to its complete example.",
        "axes": []
    }
];
const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const chrome = `body{margin:0;background:var(--color-surface-base, oklch(0.9702 0 0));color:var(--color-ink-primary, oklch(0.2178 0 0));font-family:var(--font-body, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);font-size:var(--text-body-s, 13px);line-height:1.5}.catalog-nav,.catalog-note{padding:var(--spacing-xl, 24px);background:var(--color-surface-sunken, oklch(0.9401 0 0));overflow-wrap:break-word}.catalog-nav h1{font-size:var(--text-h2, 18px)}.catalog-nav ul,.catalog-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--ui-width-prose-max, 48rem)),1fr));gap:var(--spacing-lg, 16px);padding:0;list-style:none}.catalog-function-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--ui-width-prose-max, 48rem)/2)),1fr));gap:var(--spacing-lg, 16px);margin:0;padding:var(--spacing-xl, 24px);list-style:none}.catalog-function-grid>li{padding:var(--spacing-lg, 16px);border:var(--ui-border-hairline, 1px) solid var(--color-line-base, oklch(0.8761 0 0));background:var(--color-surface-base, oklch(0.9702 0 0))}.catalog-compact-nav{display:flex;flex-wrap:wrap;gap:var(--spacing-sm, 8px)}.catalog-nav a,.catalog-note a{color:inherit}.catalog-function-grid>li>a,[data-published-kind]>a,[data-catalog-axis-reference]{text-decoration-line:underline}.catalog-note{overflow-wrap:break-word}.catalog-chip{display:inline-block;font-family:var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);font-size:var(--text-caption, 12px);border:var(--ui-border-hairline, 1px) solid var(--color-line-base, oklch(0.8761 0 0));padding:var(--spacing-xs, 4px) var(--spacing-sm, 8px);margin:var(--spacing-xs, 4px)}.catalog-example>div{min-width:0}:is([data-catalog-native],[data-config-native])>div:not([data-landing-view])>[data-content-section]{padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))}.catalog-config-grid{margin:var(--spacing-xl, 24px)}.catalog-config-cell{min-width:0;border:var(--ui-border-hairline, 1px) solid var(--color-line-base, oklch(0.8761 0 0))}.catalog-config-cell>header{padding:var(--spacing-md, 12px)}.catalog-config-cell [data-content-section]{padding-block:var(--spacing-xl, 24px)}.catalog-config-cell [data-landing-hero]{min-height:0!important}.catalog-table-wrap{overflow-x:auto}.catalog-table{min-width:var(--ui-width-content-max, 64rem)}.catalog-note table{width:100%;border-collapse:collapse}.catalog-note th,.catalog-note td{text-align:start;vertical-align:top;padding:var(--spacing-sm, 8px);border-block-end:var(--ui-border-hairline, 1px) solid var(--color-line-base, oklch(0.8761 0 0))}.catalog-published{font-family:var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);font-size:var(--text-caption, 12px)}`;
function page(title: string, body: string, sheets: ContentCatalogStylesheets, options: DocumentLocaleOptions = {}): string {
    const { locale, dir } = resolveDocumentLocale(options);
    const links = [sheets.designerTokens, sheets.utilities, ...(sheets.brand === null ? [] : [sheets.brand])].map(h => `<link rel="stylesheet" href="${escape(h)}" />`).join('\n');
    return `<!DOCTYPE html><html lang="${locale}" dir="${dir}" data-brand-bound><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(title === 'Content catalog' ? title : `${title} — Content catalog`)}</title>${links}<style>${chrome}</style></head><body>${body}</body></html>\n`;
}
function nav(current?: string): string {
    if (current !== undefined)
        return `<nav aria-label="Catalog functions" class="catalog-compact-nav">${READER_PAGES.map(p => `<a href="${p.id}.html"${p.id === current ? ' aria-current="page"' : ''}>${p.label}</a>`).join(' · ')}</nav>`;
    return `<nav aria-label="Catalog functions"><ul role="list" class="catalog-function-grid">${READER_PAGES.map(p => `<li data-catalog-function="${p.id}"><a href="catalog/${p.id}.html">${p.label}</a><p>${p.purpose}</p>${p.axes.map(axis => `<span class="catalog-chip" data-catalog-axis="${axis.name}">${axis.name.replaceAll('-', ' ')}</span>`).join('')}</li>`).join('')}</ul></nav>`;
}
export function buildFunctionalCatalogIndex(sheets: ContentCatalogStylesheets, options: DocumentLocaleOptions = {}): string { return page('Content catalog', `<header class="catalog-nav"><h1>Content catalog</h1><p>What does the reader need to do with this information? Choose its reader job, then a recipe and configuration.</p></header><main id="catalog-page">${nav()}</main>`, sheets, options); }
function closeProps(section: ResolvedSectionedViewContentSection): NonNullable<LandingViewProps['callToAction']> {
    const actions = (section.actions ?? []).map(action => {
        if (action.emphasis === 'tertiary')
            throw new Error('Closing actions require a supported emphasis.');
        return { ...action, emphasis: action.emphasis };
    });
    return { id: section.id, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: section.footnote === undefined ? undefined : section.footnote.text === undefined ? { text: createElement('a', { href: section.footnote.link.href }, section.footnote.link.label) } : section.footnote };
}
export function renderReaderSample(fixture: CatalogFixture): string {
    return renderResolvedReaderSample(fixture, resolveReaderSampleDocument(fixture));
}
function renderResolvedReaderSample(fixture: CatalogFixture, resolved: ResolvedSectionedViewDocument): string {
    const composition = fixture.id === 'recipes-nav-composition';

    if (composition) {
        const close = resolved.sections.at(-1);
        if (close?.kind !== 'content-section')
            throw new Error('A composition requires a closing band.');
        return renderToStaticMarkup(createElement(LandingView, { document: { ...resolved, sections: resolved.sections.slice(0, -1) }, header: 'reserved', peek: false, landmark: 'none', callToAction: closeProps(close) }));
    }
    if (fixture.section.kind === 'hero')
        return renderToStaticMarkup(createElement(LandingView, { document: resolved, header: 'reserved', peek: false, landmark: 'none' }));
    if (fixture.id === 'say-close') {
        const hero = READER_SAMPLES.find(f => f.id === 'say-hero-display');
        const close = resolved.sections[0];
        if (!hero || close?.kind !== 'content-section')
            throw new Error('A close requires its context.');
        const context = resolveSectionedViewDocument({ id: 'reader-close', sections: [hero.section] }, readerCopyResolver);
        const html = renderToStaticMarkup(createElement(LandingView, { document: context, header: 'reserved', peek: false, landmark: 'none', callToAction: closeProps(close) }));
        return html.slice(html.indexOf(`<section id="${close.id}"`), html.lastIndexOf('</div>'));
    }
    return renderToStaticMarkup(createElement(SectionedView, { document: resolved, landmark: 'none' }));
}
const published: Record<string, ReaderPage> = { hero: 'Introduce', 'feature-grid': 'Explain', faq: 'Index', 'status-list': 'Index', 'ordered-step-sequence': 'Sequence', pricing: 'Compare', 'stat-grid': 'Show', stat: 'Show', testimonial: 'Show' };
function recipe(fixture: CatalogFixture): string {
    if (fixture.id === 'recipes-nav-composition')
        return 'page composition';
    if (fixture.id === 'frame-actions')
        return 'actions and footnote';
    if (fixture.id === 'items-badge-meta')
        return 'badge and metadata';
    if (fixture.id === 'media-meter-previous')
        return 'meter history';
    if (fixture.id === 'say-close')
        return 'close';
    if (fixture.section.kind === 'hero')
        return fixture.section.size === 'compact' ? 'hero-compact' : 'hero';
    if (fixture.section.kind !== 'content-section')
        return 'published';
    const block = fixture.section.block;
    if (block?.type === 'prose')
        return 'prose';
    if (block?.type === 'matrix')
        return 'comparison';
    if (fixture.section.media && deriveCatalogFunction(fixture.section) === 'Show')
        return fixture.section.layout === 'stacked' ? 'showcase' : 'showcase-split';
    if (block?.type === 'items') {
        const effective = desugarRecipe(block);
        return block.lanes ? 'lanes' : block.recipe === 'specimen-stack' ? 'stack' : block.recipe ?? (effective.order === 'numbered' ? 'numbered' : effective.order === 'connected' ? 'steps' : effective.arrangement === 'columns' ? 'features' : effective.arrangement === 'bento' ? 'cards' : effective.arrangement === 'stacked' ? 'stack' : 'topics');
    }
    return fixture.section.media ? 'showcase' + (fixture.section.layout === 'stacked' ? '' : '-split') : fixture.section.layout === 'stacked' ? 'intro' : 'intro-split';
}
/** Effective, existing configuration values demonstrated by one native example. */
function axisValues(fixture: CatalogFixture, label: ReaderPage, resolved: ResolvedSectionedViewDocument = resolveReaderSampleDocument(fixture)): Record<string, string> {
    const section = resolved.sections[0]!;
    if (section.kind === 'hero') return label === 'Introduce' ? { role: 'hero', 'hero-size': section.size ?? 'display' } : {};
    if (section.kind !== 'content-section') throw new Error('Expected a canonical axis witness.');
    if (label === 'Frame') return { layout: section.layout, size: section.size, ground: section.ground };
    if (label === 'Introduce') return { role: fixture.id === 'say-close' ? 'close' : 'intro', ...(fixture.id === 'say-close' ? {} : { 'intro-layout': section.layout === 'stacked' ? 'stacked' : 'split' }) };
    if (label === 'Show') {
        const block = section.block?.type === 'items' ? section.block : undefined;
        return { visual: section.media?.type === 'specimen' ? (section.media.key ? 'specimen-key' : 'specimen') : section.media!.type, companion: block === undefined ? 'none' : block.arrangement === 'stacked' ? 'explain-stack' : 'index-rows', layout: section.layout };
    }
    if (section.block?.type === 'matrix') return { form: section.block.sides[0]?.visual ? 'visual' : 'points', featured: section.block.featured ? 'one-side' : 'none' };
    if (section.block?.type === 'prose') return {};
    if (section.block?.type !== 'items') return {};
    const block = section.block;
    if (label === 'Sequence') return { shape: block.lanes ? 'lanes' : block.order === 'numbered' ? 'list' : 'line', ...(block.order === 'connected' ? { end: block.end ?? 'ends' } : {}) };
    if (label === 'Index') return { shape: section.block.recipe === 'link-index' ? 'tiles' : `rows-${block.columns}`, reveal: block.reveal, groups: block.groups ? 'on' : 'off' };
    if (label === 'Explain') return { shape: block.arrangement === 'columns' ? `grid-${block.columns}` : block.arrangement === 'stacked' ? 'stack' : block.arrangement, treatment: block.treatment, scale: block.scale };
    return {};
}
function caption(fixture: CatalogFixture, label: ReaderPage, context?: string, resolved: ResolvedSectionedViewDocument = resolveReaderSampleDocument(fixture)): string {
    const name = context ?? (fixture.id === 'recipes-nav-composition' ? 'six-band page' : recipe(fixture));
    const contextNote = fixture.section.kind === 'content-section' && fixture.section.media?.type === 'record' ? ` · ${fixture.section.media.columns ?? 1} column${(fixture.section.media.columns ?? 1) === 1 ? '' : 's'}` : fixture.section.kind === 'content-section' && fixture.section.media?.type === 'scene' ? ` · ${fixture.section.media.input.template}` : '';
    return `${escape(name)}${escape(contextNote)}${Object.entries(axisValues(fixture, label, resolved)).map(([axis, value]) => ` · <span data-catalog-axis-witness="${escape(axis)}:${escape(value)}">${escape(axis)}: ${escape(value)}</span>`).join('')}`;
}
function frameReference(axis: string, value: string): CatalogFixture {
    const fixture = READER_SAMPLES.find(sample => sample.section.kind === 'content-section' && !['say-close', 'recipes-nav-composition'].includes(sample.id) && axisValues(sample, 'Frame')[axis] === value);
    if (!fixture) throw new Error(`Missing existing Frame witness for ${axis}: ${value}.`);
    return fixture;
}
function axisTable(definition: CatalogPage): string {
    if (definition.axes.length === 0)
        return '';
    return `<section class="catalog-note"><h2>Configuration reference</h2><div class="catalog-table-wrap" role="region" aria-label="${escape(definition.label)} configuration reference" tabindex="0"><table class="catalog-table" data-catalog-axes><thead><tr><th scope="col">Axis</th><th scope="col">Values</th><th scope="col">Effect</th><th scope="col">When</th></tr></thead><tbody>${definition.axes.map(axis => `<tr data-catalog-axis="${axis.name}"><th scope="row">${escape(axis.name.replaceAll('-', ' '))}</th><td>${axis.values.map(value => { if (definition.label !== 'Frame') return escape(value); const fixture = frameReference(axis.name, value); const target = READER_PAGES.find(page => page.label === readerPage(fixture))!; return `<a data-catalog-axis-reference="${escape(axis.name)}:${escape(value)}" href="${target.id}.html#example-${fixture.id}">${escape(axis.name)}: ${escape(value)}</a>`; }).join(' / ')}</td><td>${escape(axis.effect)}</td><td>${escape(axis.when)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function rules(label: ReaderPage): string {
    const content: Record<ReaderPage, [
        string,
        string
    ][]> = {
        Overview: [['Choose a function', 'Start with the reader’s job; recipes fill compatible defaults.'], ['Compose a page', 'Omit body ground for automatic cadence; inverse is a deliberate focal band.']],
        Introduce: [['Roles', 'Hero, intro, split intro, and close.'], ['Actions', '0–2 actions, at most one primary. A lone hero action is primary.']],
        Show: [['Scenes', 'Converge connects sources; evidence-trail traces a result; approval-chain shows checks leading to a decision.'], ['Specimen', 'One panel with 1–3 parts; a key names 3–5 distinct targets.'], ['Record', '1–3 groups; each has 1–6 rows, or the final group may contain an owner instead. Multi-column records use stacked frames.']],
        Explain: [['Grid', '2, 4 or 6 entries in two columns; 3 or 6 in three columns.'], ['Bento / stack', 'Bento has 2–6 entries whose spans fill 12-unit rows; visual stacks have 2–4, with one part each.'], ['Prose', '1–8 non-empty paragraphs, each with at most 24 spans, 6 links and 1,200 visible Unicode characters. Text and link spans retain authored order.']],
        Index: [['Rows', '2–8 entries in one or two columns; 2–4 groups each have 2–4 members.'], ['Status list', 'Use topics rows with a visible badge label on every item. Live, In progress and Planned are authored copy; tones use existing tokens.'], ['Readiness lookup', 'Status-list maps 3–8 entries to topics plus localized badges: available/success, partial/warning, planned/info, not-offered/neutral.'], ['FAQ', '4–6 answers; every answer needs a description.']],
        Sequence: [['Line', '3–5 steps; four warns. Visual steps need a Sample data caption.'], ['Lanes', 'Exactly two roles and 3–5 steps. Use a stacked frame with a columns or stacked arrangement, and name the continuation when relevant.']],
        Compare: [['Points', 'Two sides with 2–4 equal-count points each.'], ['Visuals', 'One panel per side with 1–3 parts; do not combine points and a panel.']],
        Frame: [['Directions', 'Stacked, split-start, or split-end.'], ['Ground', 'Base and sunken are automatic; choose inverse for a focal band.']],
        Parts: [['Specimen', 'Fields, status rows, meter, table, schedule, shares, and files.'], ['Independent copy', 'Badge and metadata coexist; meter history retains previous value and text.']],
    };
    return `<section class="catalog-note"><h2>Count and slot rules</h2><table data-catalog-rules><thead><tr><th scope="col">Recipe</th><th scope="col">Counts and slots</th></tr></thead><tbody>${content[label].map(([a, b]) => `<tr><th scope="row">${escape(a)}</th><td>${escape(b)}</td></tr>`).join('')}</tbody></table></section>`;
}
/** Scope trusted native fragments when several independent renders share a preview page. */
export function namespaceNativeMarkup(html: string, prefix: string): string {
    const ids = new Map<string, string>();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
        const id = match[1]!;
        if (ids.has(id))
            throw new Error('Native preview fragment contains duplicate IDs.');
        ids.set(id, `reader-${prefix.length}:${prefix}:${id}`);
    }
    return html.replace(/\s(id|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-details|aria-activedescendant|aria-flowto|aria-errormessage|headers|for|list|form|href|xlink:href)="([^"]*)"/g, (_all, key: string, value: string) => {
        if (key === 'id')
            return ` id="${ids.get(value)!}"`;
        if (key === 'href' || key === 'xlink:href')
            return ` ${key}="${value.startsWith('#') && ids.has(value.slice(1)) ? '#' + ids.get(value.slice(1)) : value}"`;
        return ` ${key}="${value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ')}"`;
    }).replace(/url\(#([^)]*)\)/g, (all, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : all);
}
type ConfigCell = {
    id: string;
    fixture: CatalogFixture;
    caption: string;
};
export function readerConfigCells(label: ReaderPage): ConfigCell[] {
    if (label === 'Index')
        return [{ id: 'status-list', fixture: structuredClone(READER_STATUS_LIST), caption: 'status list' }];
    const clone = (id: string): CatalogFixture => {
        const sample = READER_SAMPLES.find(f => f.id === id);
        if (!sample)
            throw new Error('Missing reader sample.');
        return structuredClone(sample);
    };
    if (label === 'Show') {
        const stack = clone('media-key');
        const explanation = clone('items-stacked');
        if (stack.section.kind !== 'content-section' || explanation.section.kind !== 'content-section')
            throw new Error('Show variants need canonical sections.');
        stack.section.layout = 'split-start';
        stack.section.block = explanation.section.block;
        return [{ id: 'keyed-stack', fixture: stack, caption: 'showcase-split' }];
    }
    if (label === 'Explain') {
        const fixture = clone('items-plain');
        if (fixture.section.kind !== 'content-section' || fixture.section.block?.type !== 'items')
            throw new Error('Plate features need items.');
        fixture.section.block.treatment = 'plate';
        return [{ id: 'features-plate', fixture, caption: 'plate features' }];
    }
    if (label === 'Compare') {
        const fixture = clone('matrix-points');
        if (fixture.section.kind !== 'content-section' || fixture.section.block?.type !== 'matrix')
            throw new Error('An unfeatured comparison needs a matrix.');
        delete fixture.section.block.featured;
        return [{ id: 'comparison-unfeatured', fixture, caption: 'points without a featured side' }];
    }
    return [];
}
function embeddedNative(fixture: CatalogFixture, prefix: string, resolved: ResolvedSectionedViewDocument): string {
    const html = renderResolvedReaderSample(fixture, resolved)
        .replace(/ href="\/catalog\/([a-z-]+\.html#example-[a-z-]+)"/g, ' href="$1"')
        .replace(/<h1(?=\s|>)/g, '<h2').replaceAll('</h1>', '</h2>');
    return namespaceNativeMarkup(html, prefix);
}
function recipeTable(): string {
    const aliases: Partial<Record<string, string>> = { features: "feature-grid", topics: "status-list (readiness/disposition badges)", faq: "faq", steps: "ordered-step-sequence" };
    const axes = ["arrangement", "order", "reveal", "treatment", "scale"];
    const rows = SECTIONED_VIEW_CONTENT_CONTRACT.recipes.map(recipe => {
        const definition = SECTIONED_VIEW_ITEM_RECIPES[recipe];
        const values = (value: object): string => Object.entries(value).map(([key, value]) => `${key}=${value}`).join(", ") || "—";
        return `<tr data-catalog-recipe="${recipe}"><th><a href="${READER_PAGES.find(page => page.label === readerPage(READER_SAMPLES.find(sample => sample.id === CATALOG_RECIPE_LINKS[recipe])!))!.id}.html#example-${CATALOG_RECIPE_LINKS[recipe]}">${recipe}</a></th><td data-recipe-fixed>${escape(values(definition.fixed))}</td><td data-recipe-defaults>${escape(values(definition.defaults ?? {}))}</td><td data-recipe-free>${escape([...axes, ...(["columns", "rows"].includes(String(definition.fixed.arrangement ?? definition.defaults?.arrangement)) ? ["columns"] : [])].filter(axis => !Object.hasOwn(definition.fixed, axis)).join(", "))}${definition.treatments === undefined ? "" : `<br />treatment: ${escape(definition.treatments.join(" / "))}`}</td><td data-recipe-slots>${escape(definition.slots.join(", ") || "—")}${definition.requiredSlot === undefined ? "" : `<br />required: ${escape(definition.requiredSlot)}`}</td><td>${escape(aliases[recipe] ?? "—")}</td></tr>`;
    }).join("");
    return `<div class="catalog-table-wrap" role="region" aria-label="Recipe reference" tabindex="0"><table class="catalog-table"><thead><tr><th>Recipe</th><th>Fixed axes</th><th>Defaults</th><th>Free axes</th><th>Compatible slots</th><th>Published alias</th></tr></thead><tbody>${rows}<tr data-catalog-recipe="comparison"><th><a href="compare.html#example-matrix-points">comparison</a></th><td>two sides</td><td>—</td><td>primary form, featured</td><td>points or visual, optional description lead</td><td>—</td></tr><tr data-catalog-recipe="prose"><th><a href="explain.html#example-recipes-prose">prose</a></th><td>ordered paragraphs</td><td>—</td><td>—</td><td>text or link spans; 1–8 paragraphs, at most 24 spans, 6 links and 1,200 characters each</td><td>—</td></tr></tbody></table></div>`;
}
export function buildCatalogFunctionPages(sheets: ContentCatalogStylesheets, options: DocumentLocaleOptions = {}): Array<{
    file: string;
    content: string;
}> {
    const nested = { designerTokens: `../${sheets.designerTokens}`, utilities: `../${sheets.utilities}`, brand: sheets.brand === null ? null : `../${sheets.brand}` };
    return READER_PAGES.map(definition => {
        const label = definition.label;
        const header = `<header class="catalog-nav"><a href="../content-catalog.html">Content catalog</a><h1>${label}</h1><p>${definition.purpose}</p>${nav(definition.id)}</header>`;
        let body = '';
        for (const sample of READER_SAMPLES.filter(fixture => readerPage(fixture) === label)) {
            const resolved = resolveReaderSampleDocument(sample);
            body += `<article class="catalog-example" id="example-${sample.id}" data-catalog-fixture="${sample.id}"><header class="catalog-note"><p data-catalog-caption>${label} › ${caption(sample, label, undefined, resolved)}</p></header><div data-catalog-native${label === 'Overview' ? ' data-catalog-composition' : ''}>${embeddedNative(sample, `sample-${definition.id}-${sample.id}`, resolved)}</div></article>`;
        }
        if (label === 'Overview')
            body += `<section class="catalog-note"><h2>Recipe reference</h2>${recipeTable()}</section>`;
        body += axisTable(definition);
        const cells = readerConfigCells(label);
        if (cells.length)
            body += `<div class="catalog-config-grid">${cells.map(cell => {
                const resolved = resolveReaderSampleDocument(cell.fixture);
                return `<article class="catalog-config-cell" data-catalog-config-cell="${cell.id}"><header><p data-config-caption>${label} › ${caption(cell.fixture, label, cell.caption, resolved)}</p></header><div data-config-native>${embeddedNative(cell.fixture, `config-${definition.id}-${cell.id}`, resolved)}</div></article>`;
            }).join('')}</div>`;
        if (label === 'Parts')
            body += `<section class="catalog-note"><h2>Complete examples</h2><ul><li><a href="show.html#example-say-media-stacked">Fields and review states</a></li><li><a href="show.html#example-media-key">Table, schedule, shares, and a specimen key</a></li><li><a href="show.html#example-frame-split-start">Files and source details</a></li><li><a href="show.html#example-media-record-three">Grouped record context</a></li><li><a href="show.html#example-items-badge-meta">Independent badge and metadata</a></li><li><a href="show.html#example-media-meter-previous">Meter history</a></li><li><a href="overview.html#example-recipes-nav-composition">Approval checks</a></li></ul></section>`;
        body += rules(label);
        const aliases = OTHER_KIND_LINKS.filter(link => published[link.kind] === label);
        if (aliases.length)
            body += `<section class="catalog-note"><h2>Published kinds</h2><ul>${aliases.map(link => `<li data-published-kind="${link.kind}"><a href="${link.href}">${link.kind}</a></li>`).join('')}</ul></section>`;
        return { file: `catalog/${definition.id}.html`, content: page(label, `${header}<main id="catalog-page">${body}</main>`, nested, options) };
    });
}
