import type { ComposeDocument } from "../core/index.js";
import type { StructuredDocument } from "../document/types.js";
import type { CompanyOverviewLength } from "../templates/overviewTemplate.js";
import { COMPANY_OVERVIEW_TEMPLATES } from "../templates/overviewTemplate.js";
import { PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS, PITCH_DECK_SLIDE_ORDER } from "../templates/deckTemplate.js";
import type { SlidesDeckInput } from "../slides/index.js";
import type { MaterialsIndexEntry } from "../materials/index.js";
import { previewCopyString } from "./fixture-copy-registry.js";

/**
 * Fixture `StructuredDocument`s for the materials mini-site's company
 * overviews (#1206/#1207) — one per `CompanyOverviewLength`, its section
 * order taken verbatim from `COMPANY_OVERVIEW_TEMPLATES` (this file never
 * re-derives or reorders that structure), its prose from
 * `fixture-copy-registry.ts` by id.
 */
const ref = (id: string) => ({ id });

export function buildOverviewDocument(length: CompanyOverviewLength): StructuredDocument {
  const sectionIds = COMPANY_OVERVIEW_TEMPLATES[length];
  return {
    id: `publisher-preview-overview-${length}`,
    title: ref(`preview.overview.title.${length}`),
    sections: sectionIds.map((sectionId) => ({
      kind: "section",
      id: sectionId,
      level: 2,
      heading: ref(`preview.overview.${sectionId}.heading`),
      blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(`preview.overview.${sectionId}.body`) }] }],
    })),
  };
}

export const COMPANY_OVERVIEW_LENGTHS: readonly CompanyOverviewLength[] = ["short", "medium", "long"];

/**
 * Fixture `SlidesDeckInput` for the pitch deck (#1206/#1207) — slide order
 * taken verbatim from `PITCH_DECK_SLIDE_ORDER`; prose from the copy
 * registry by id, one heading/body pair per slide id.
 */
function deckSlide(id: string): ComposeDocument {
  return {
    id,
    channel: "slides",
    template: "content-slide",
    meta: { channel: "slides", aspect: "16:9" },
    layout: {
      slots: [
        { key: "heading", element: "heading", frame: { x: 0.08, y: 0.14, w: 0.84, h: 0.22 }, required: true },
        { key: "body", element: "body", frame: { x: 0.08, y: 0.42, w: 0.84, h: 0.4 } },
      ],
    },
    bindings: [
      { slot: "heading", copyId: `preview.deck.${id}.heading` },
      { slot: "body", copyId: `preview.deck.${id}.body` },
    ],
  };
}

export function buildPitchDeck(): SlidesDeckInput {
  return {
    id: "publisher-preview-pitch-deck",
    slides: PITCH_DECK_SLIDE_ORDER.map((id) => deckSlide(id)),
  };
}

export { PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS };

/**
 * Fixture entries for the materials index (#1206: "lists every overview
 * and deck version with its status, version, and last-published time").
 * `href`s below are this preview gallery's own flat output filenames — see
 * `render-launch-pack-gallery.ts`, which writes each entry's page at
 * exactly the path named here.
 */
export function buildMaterialsIndexEntries(): MaterialsIndexEntry[] {
  const lastPublishedAt = "2026-09-01T00:00:00.000Z";
  return [
    {
      id: "overview-short",
      title: previewCopyString("preview.materials.index.overview-short.title"),
      kind: "overview",
      status: "published",
      condition: "current",
      version: "v0.1",
      lastPublishedAt,
      href: "materials-overview-short.html",
    },
    {
      id: "overview-medium",
      title: previewCopyString("preview.materials.index.overview-medium.title"),
      kind: "overview",
      status: "published",
      condition: "current",
      version: "v0.1",
      lastPublishedAt,
      href: "materials-overview-medium.html",
    },
    {
      id: "overview-long",
      title: previewCopyString("preview.materials.index.overview-long.title"),
      kind: "overview",
      status: "published",
      condition: "current",
      version: "v0.1",
      lastPublishedAt,
      href: "materials-overview-long.html",
    },
    {
      id: "pitch-deck",
      title: previewCopyString("preview.materials.index.pitch-deck.title"),
      kind: "deck",
      status: "published",
      condition: "current",
      version: "v0.1",
      lastPublishedAt,
      href: "materials-pitch-deck.html",
    },
    {
      id: "pitch-deck-partner",
      title: previewCopyString("preview.materials.index.pitch-deck-partner.title"),
      kind: "deck",
      status: "published",
      condition: "current",
      version: "v0.1",
      lastPublishedAt,
      href: "materials-pitch-deck-partner.html",
    },
  ];
}
