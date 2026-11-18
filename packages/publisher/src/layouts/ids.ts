// Arrangement models and the id shapes Publisher's render engines check against.
// The engine keys themselves live in ../engines/keys.ts: an engine is a render primitive, not a slot.
export const ARRANGEMENT_MODELS = ["page", "canvas", "paged", "panes"] as const;
export type ArrangementModel = (typeof ARRANGEMENT_MODELS)[number];
export const ENGINE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export const SECTION_ID = /^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export const ENGINE_CONFIG_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
