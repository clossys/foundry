/** Section-owned callable parts. These are ports of the section, never component leaves. */
export const SPECIMEN_RENDER_PARTS = {
  "sections.specimen-variant-matrix": ["renderComponentState"],
  "sections.specimen-section-viewports": ["renderSurface", "renderViewport"],
  "sections.specimen-frame-viewports": ["renderSurface", "renderViewport"],
  "sections.specimen-copy-in-context": ["renderContent"],
  "sections.specimen-page-viewports": ["renderViewport"],
} as const;
export type SpecimenRenderPartName = typeof SPECIMEN_RENDER_PARTS[keyof typeof SPECIMEN_RENDER_PARTS][number];
export type SpecimenRenderPartId = { [Section in keyof typeof SPECIMEN_RENDER_PARTS]: `${Section}#${typeof SPECIMEN_RENDER_PARTS[Section][number]}` }[keyof typeof SPECIMEN_RENDER_PARTS];
