/**
 * Publisher-owned sidecar: which page formats each Designer section slot may
 * be placed on. Designer owns the section contract; Publisher owns the
 * substrate, so the compatibility rule lives here and never edits Designer
 * files. The key set must equal Designer's `sections` slot ids (pinned by a
 * catalog-parity test).
 */
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
  "sections.specimen-swatch": "specimen",
  "sections.specimen-color-ramp": "specimen",
  "sections.specimen-type-ladder": "specimen",
  "sections.specimen-spacing-ladder": "specimen",
  "sections.specimen-radius-ladder": "specimen",
  "sections.specimen-motion-player": "specimen",
  "sections.specimen-asset-grid": "specimen",
  "sections.specimen-icon-grid": "specimen",
  "sections.specimen-variant-matrix": "specimen",
  "sections.specimen-section-viewports": "specimen",
  "sections.specimen-frame-viewports": "specimen",
  "sections.specimen-rich-passage": "specimen",
  "sections.specimen-copy-in-context": "specimen",
  "sections.specimen-page-viewports": "specimen",
  "sections.access-matrix": "data",
  "sections.account-summary": "data",
  "sections.activity-feed": "data",
  "sections.article": "long-form",
  "sections.audit-log": "data",
  "sections.band": "display",
  "sections.boundary-message": "utility",
  "sections.call-to-action": "display",
  "sections.cards": "display",
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
  "sections.legal-prose": "long-form",
  "sections.link-index": "long-form",
  "sections.logo-cloud": "display",
  "sections.logo-hero": "display",
  "sections.logo-mark": "display",
  "sections.media": "display",
  "sections.newsletter": "interactive",
  "sections.notices": "utility",
  "sections.page-header": "utility",
  "sections.pagination": "utility",
  "sections.people": "display",
  "sections.pricing": "display",
  "sections.record-detail": "data",
  "sections.resource-list": "data",
  "sections.section-header": "display",
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

/** Formats a Designer section may be placed on; `undefined` when the section is unknown to the sidecar. */
export function sectionFormats(section: string): readonly PageFormatId[] | undefined {
  const kind = SECTION_CLASSES[section];
  return kind === undefined ? undefined : SECTION_CLASS_FORMATS[kind];
}

export function isLongFormSection(section: string): boolean {
  return SECTION_CLASSES[section] === "long-form";
}
