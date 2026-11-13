export const LAYOUT_IDS = ["layouts.stack", "layouts.split", "layouts.sidebar-content", "layouts.bento", "layouts.staggered-grid"] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export const ARRANGEMENT_MODELS = ["page", "canvas", "paged", "panes"] as const;
export type ArrangementModel = (typeof ARRANGEMENT_MODELS)[number];
export const LAYOUT_ID = /^layouts\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export const SECTION_ID = /^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export const LAYOUT_CONFIG_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === "string" && LAYOUT_ID.test(value) && (LAYOUT_IDS as readonly string[]).includes(value);
}
