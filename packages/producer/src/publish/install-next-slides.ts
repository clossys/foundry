/**
 * `clossys publish --install --site <deck publication> --next <app dir> [--bind ...]`: a publication whose format is
 * `deck.16x9` installs as local React pages, one Next App Router page per slide (CP1-SLIDES).
 *
 * A deck page record places its slides as its sections, in order, on its frame: one section is one slide, the same
 * split `release slides --build` makes (`buildSlides`). Each deck entry of the content map therefore stands for one
 * page per section, served at `/<deck route>/<n>` (numbered from 1, Publisher's `slideRoutes`). The install map is
 * the deck's web projection: each slide is a page entry of its own (`<deck id>-<n>`), bound to the deck record's frame
 * with that one section, so the route files, the bound page modules and the bind projection are the ones every site
 * page gets. Each slide's route file mounts its bound page at a fixed 16:9 stage and links the previous and next
 * slides. The navigation carries slide numbers and arrow glyphs only, so no word in it needs a Writer key.
 *
 * A deck at `/` has no deck segment to number under, a slide id another entry already holds would serve two pages,
 * and a deck in more than one locale is not installed here: each is a blocking finding, never a fallback.
 */
import type { ContentMap, ContentMapEntry, ContentMapNode } from "@clossys/publisher/content-map";
import { NEXT_PAGE_EXPORT, NEXT_ROUTE_MARKER, relativeSpecifier, sectionInstances, type InstallFinding, type InstallPageRecord, type InstallPins } from "@clossys/publisher/install";
import { slideRoutes } from "@clossys/publisher/build";
import { designerPins, pageRecordFromCell, type TitledPageRecord } from "./install.js";

/** The content-map format a slide deck publication records. */
export const DECK_FORMAT = "deck.16x9";
/** The stage every slide renders at: the deck format's 16:9 canvas. */
export const SLIDE_ASPECT = { width: 16, height: 9 } as const;

/** One installed slide: a page of the install map. */
export interface DeckSlide {
  /** The slide's page id in the install map, `<deck id>-<n>`. */
  readonly id: string;
  /** The deck's content-map entry id (its Publisher page slot). */
  readonly deck: string;
  readonly n: number;
  readonly total: number;
  /** The served route, `/<deck route>/<n>`. */
  readonly route: string;
  readonly prev?: string;
  readonly next?: string;
}
/** Resolves an install-map page id to its page record; a deck's slides resolve to its record cut to one section. */
export type PageRecordOf = (id: string, pins: InstallPins, copy?: Readonly<Record<string, string>>) => Promise<TitledPageRecord>;
export interface DeckPlan {
  /** The install map: the deck's web projection, one page entry per slide. */
  readonly map: ContentMap;
  readonly slides: readonly DeckSlide[];
  readonly findings: readonly InstallFinding[];
  readonly recordOf: PageRecordOf;
}

export const isDeckPublication = (map: ContentMap): boolean => map.format === DECK_FORMAT;

const pathOf = (entry: { readonly path?: string; readonly slug?: string }) => entry.path ?? `/${entry.slug}`;

/**
 * One slide's page record: the deck record's frame with the one section at `index`. The section's instance binding
 * (`sections.hero#2`) becomes its binding as the slide's only instance, over the slot's shared binding, as the
 * binder reads them; the frame's and the page-wide copy stay as the deck record holds them.
 */
export function slideRecord(record: TitledPageRecord, index: number, id: string): TitledPageRecord {
  const instances = sectionInstances(record.sections);
  const instance = instances[index];
  if (!instance) throw new Error(`publish --install: deck ${record.id} has no slide ${index + 1}`);
  const keys = new Set(instances.map(row => row.key));
  const kept = Object.entries(record.bindings ?? {}).filter(([key]) => !keys.has(key));
  const own = record.bindings?.[instance.key], shared = instance.key === instance.slot ? undefined : record.bindings?.[instance.slot];
  const merged = own || shared ? {
    ...(own?.copy || shared?.copy ? { copy: { ...shared?.copy, ...own?.copy } } : {}),
    ...(own?.assets || shared?.assets ? { assets: { ...shared?.assets, ...own?.assets } } : {}),
  } : undefined;
  const bindings = Object.fromEntries([...kept, ...(merged ? [[instance.slot, merged] as const] : [])]);
  const { bindings: _bindings, ...rest } = record;
  return { ...rest, id, sections: [instance.slot], ...(Object.keys(bindings).length ? { bindings } : {}) };
}

/**
 * Plan a deck publication's install: read each deck record's slides, number them under the deck's route and return
 * the install map and the record resolver the bound install reads them through.
 */
export async function planDeck(root: string, map: ContentMap, locales?: { readonly default: string; readonly all: readonly string[] }): Promise<DeckPlan> {
  const findings: InstallFinding[] = [];
  const pins = designerPins(root);
  const ids = new Set(map.entries.map(entry => entry.id));
  const entries: ContentMapNode[] = [];
  const slides: DeckSlide[] = [];
  const decks = new Map<string, string>();
  if (locales && locales.all.length > 1) findings.push({ code: "site-contract", slot: map.publicationId, detail: `${map.publicationId}: a ${DECK_FORMAT} publication installs in one locale; it records ${locales.all.join(", ")}` });
  for (const entry of map.entries) {
    if (entry.kind !== "page" && entry.kind !== "slide") { entries.push(entry); continue; }
    const path = pathOf(entry);
    const segments = path.split("/").filter(Boolean);
    const deck = segments.at(-1);
    if (deck === undefined) { findings.push({ code: "site-contract", slot: entry.id, detail: `${entry.id}: a deck route needs a segment to number its slides under (/<deck>/<n>); ${path} has none` }); continue; }
    let record: TitledPageRecord;
    try { record = await pageRecordFromCell(root, entry.id, pins); }
    catch (error) { findings.push({ code: "site-route-missing", slot: entry.id, detail: `${entry.id}: ${error instanceof Error ? error.message : String(error)}` }); continue; }
    if (!record.sections.length) { findings.push({ code: "site-contract", slot: entry.id, detail: `${entry.id}: a deck places at least one slide` }); continue; }
    let routes;
    try { routes = slideRoutes({ path: `/${[...segments.slice(0, -1), "<deck>", "<n>"].join("/")}`, deck, slides: record.sections.map(section => ({ role: section, section, html: "" })) }); }
    catch (error) { findings.push({ code: "site-contract", slot: entry.id, detail: `${entry.id}: ${error instanceof Error ? error.message : String(error)}` }); continue; }
    routes.forEach((route, index) => {
      const id = `${entry.id}-${route.n}`;
      if (ids.has(id)) { findings.push({ code: "site-route-duplicate", slot: entry.id, detail: `${entry.id}: slide ${route.n}'s page id ${id} is another entry's` }); return; }
      ids.add(id);
      decks.set(id, entry.id);
      const { slug: _slug, path: _path, pageConfig: _config, ...base } = entry as ContentMapEntry & { pageConfig?: string };
      entries.push({ ...base, id, kind: "page", order: entry.order * routes.length + index, path: route.path, source: { frameId: record.frame, sectionIds: [record.sections[index]!] } } as ContentMapEntry);
      slides.push({ id, deck: entry.id, n: route.n, total: routes.length, route: route.path, ...(index > 0 ? { prev: routes[index - 1]!.path } : {}), ...(index < routes.length - 1 ? { next: routes[index + 1]!.path } : {}) });
    });
  }
  const byId = new Map(slides.map(slide => [slide.id, slide]));
  const recordOf: PageRecordOf = async (id, pins, copy) => {
    const slide = byId.get(id);
    if (!slide) return pageRecordFromCell(root, id, pins, copy);
    return slideRecord(await pageRecordFromCell(root, slide.deck, pins, copy), slide.n - 1, id);
  };
  // The slides are web pages: the install map is the deck's web projection, so Next's static params project it.
  return { map: { ...map, format: "web.page.responsive", entries }, slides, findings, recordOf };
}

const literal = (value: unknown) => JSON.stringify(value);

/** A slide's route file: its bound page at the fixed 16:9 stage, with the previous and next slides linked. */
export function slideRouteModule(file: string, assembly: string, slide: DeckSlide): string {
  const link = (rel: "prev" | "next", href: string | undefined, text: string) => href === undefined
    ? `createElement("span", { "data-deck-link": ${literal(rel)}, "aria-hidden": true, style: link }, ${literal(text)})`
    : `createElement("a", { href: ${literal(href)}, rel: ${literal(rel)}, "data-deck-link": ${literal(rel)}, style: link }, ${literal(text)})`;
  return `${NEXT_ROUTE_MARKER}
import { createElement } from "react";
import { ${NEXT_PAGE_EXPORT} } from ${literal(relativeSpecifier(file, assembly))};

/** Slide ${slide.n} of ${slide.total} of deck ${slide.deck}, rendered at a fixed ${SLIDE_ASPECT.width}:${SLIDE_ASPECT.height} stage. */
const stage = { position: "relative", width: "min(100vw, calc(100vh * ${SLIDE_ASPECT.width} / ${SLIDE_ASPECT.height}))", aspectRatio: "${SLIDE_ASPECT.width} / ${SLIDE_ASPECT.height}", margin: "0 auto", overflow: "hidden" } as const;
const nav = { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "0.5rem", fontVariantNumeric: "tabular-nums" } as const;
const link = { minWidth: "2rem", textAlign: "center", color: "inherit" } as const;

export default function Page() {
  return createElement("div", { "data-deck": ${literal(slide.deck)}, "data-slide": ${slide.n}, "data-slides": ${slide.total} },
    createElement("div", { "data-deck-stage": "${SLIDE_ASPECT.width}:${SLIDE_ASPECT.height}", style: stage }, createElement(${NEXT_PAGE_EXPORT}, { page: ${literal(slide.id)} })),
    createElement("nav", { "data-deck-nav": "", style: nav },
      ${link("prev", slide.prev, "‹")},
      createElement("span", { "aria-current": "page" }, ${literal(`${slide.n} / ${slide.total}`)}),
      ${link("next", slide.next, "›")}));
}
`;
}

/** The install's route files with every slide's page route replaced by its staged slide route. */
export function stageSlideRoutes<Row extends { readonly file: string; readonly pageId: string; readonly kind: string; readonly content: string }>(files: readonly Row[], assembly: string, slides: readonly DeckSlide[]): Row[] {
  const byId = new Map(slides.map(slide => [slide.id, slide]));
  return files.map(row => {
    const slide = row.kind === "page" ? byId.get(row.pageId) : undefined;
    return slide ? { ...row, content: slideRouteModule(row.file, assembly, slide) } : row;
  });
}

export type { InstallPageRecord };
