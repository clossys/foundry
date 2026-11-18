/**
 * Publisher-owned sidecar: which page formats each Designer section slot may
 * be placed on. Designer owns the section contract; Publisher owns the
 * substrate, so the compatibility rule lives here and never edits Designer
 * files. The key set must equal Designer's live `sections` slot ids, its
 * retired ids excluded (pinned by a catalog-parity test); package extension sections are classed in
 * `extensions.ts` and resolve through the same lookup.
 */
import { EXTENSION_SECTION_CLASSES } from "./extensions.js";
import type { PageFormatId } from "./formats.js";

/** Section classes drive compatibility; `long-form` sections never go on a slide or canvas board. */
export type SectionClass = "display" | "long-form" | "interactive" | "data" | "utility" | "specimen";

export const SECTION_CLASS_FORMATS: Readonly<Record<SectionClass, readonly PageFormatId[]>> = Object.freeze({
  display: Object.freeze(["vertical-page", "slide", "canvas"] as const),
  "long-form": Object.freeze(["vertical-page"] as const),
  interactive: Object.freeze(["vertical-page"] as const),
  data: Object.freeze(["vertical-page", "canvas"] as const),
  utility: Object.freeze(["vertical-page", "canvas"] as const),
  specimen: Object.freeze(["vertical-page", "canvas"] as const),
});

/** Designer section slot id → Publisher section class. */
export const SECTION_CLASSES: Readonly<Record<string, SectionClass>> = Object.freeze({
  "sections.access-matrix": "data",
  "sections.account-summary": "data",
  "sections.activity-feed": "data",
  "sections.article": "long-form",
  "sections.audit-log": "data",
  "sections.band": "display",
  "sections.call-to-action": "display",
  "sections.chat": "interactive",
  "sections.column-mapper": "interactive",
  "sections.comparison": "display",
  "sections.consent": "interactive",
  "sections.content": "long-form",
  "sections.data-grid": "data",
  "sections.data-table": "data",
  "sections.empty-state": "utility",
  "sections.error-state": "utility",
  "sections.explorer": "data",
  "sections.faq": "long-form",
  "sections.features": "display",
  "sections.filter-builder": "interactive",
  "sections.form": "interactive",
  "sections.gallery": "display",
  "sections.hero": "display",
  "sections.link-index": "long-form",
  "sections.logo-cloud": "display",
  "sections.media": "display",
  "sections.notices": "utility",
  "sections.page-header": "utility",
  "sections.pagination": "utility",
  "sections.people": "display",
  "sections.pricing": "display",
  "sections.resource-list": "data",
  "sections.section-header": "display",
  "sections.sectioned-document": "long-form",
  "sections.settings": "interactive",
  "sections.sign-in-form": "interactive",
  "sections.stats": "display",
  "sections.status-list": "data",
  "sections.steps": "display",
  "sections.table-of-contents": "long-form",
  "sections.task-list": "data",
  "sections.testimonials": "display",
  "sections.timeline": "display",
  "sections.usage": "data",
  "sections.wizard": "interactive",
});

/** The class of a catalog or package extension section; `undefined` when neither registry knows it. */
export function sectionClass(section: string): SectionClass | undefined {
  return Object.hasOwn(SECTION_CLASSES, section) ? SECTION_CLASSES[section]
    : Object.hasOwn(EXTENSION_SECTION_CLASSES, section) ? EXTENSION_SECTION_CLASSES[section as `sections.${string}`]!.class : undefined;
}

/** Formats a Designer section may be placed on; `undefined` when the section is unknown to the sidecar. */
export function sectionFormats(section: string): readonly PageFormatId[] | undefined {
  const kind = sectionClass(section);
  return kind === undefined ? undefined : SECTION_CLASS_FORMATS[kind];
}

export function isLongFormSection(section: string): boolean {
  return sectionClass(section) === "long-form";
}
