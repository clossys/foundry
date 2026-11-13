/**
 * Addresses for Studio previews of structured Foundry Sections and Frames. Data
 * only, and none of it held here: every export points into the one shared
 * synthetic dataset (specimen-dataset.ts), and surface-preview-samples.tsx renders
 * each real block export with it. Preview content, never adoption or conformance
 * evidence.
 */
import { specimenDataset } from "./specimen-dataset.js";

export type { SampleOrder } from "./specimen-dataset.js";

const { sections, frames } = specimenDataset;

export const comparisonSample = sections.comparison;
export const contentSample = sections.content;
export const dataTableSample = sections.dataTable;

/**
 * The sample states a host can ask every package preview for (vf35). `default` is the ordinary sample; the
 * others render only for an export whose own props support that state, and every other export stays default.
 */
export const SURFACE_SAMPLE_STATES = ["default", "empty", "loading", "error", "long-content"] as const;
export type SurfaceSampleState = typeof SURFACE_SAMPLE_STATES[number];

/**
 * Copy for the non-default sample states (vf35): empty, loading, error and long content. Only exports whose
 * own props support a state use it (surface-preview-samples.tsx); every other export keeps its default sample.
 */
export const surfaceStateSample = sections.states;
export const formSample = sections.form;
export const pricingSample = sections.pricing;
export const resourceListSample = sections.resourceList;
export const statusListSample = sections.statusList;
export const taskListSample = sections.taskList;
export const sheetSample = sections.sheet;
/** vf34: the app sidebar frame (AppNavigation). Kept in its own block. */
export const appSidebarSample = frames.appSidebar;
export const chatSample = sections.chat;
export const explorerSample = sections.explorer;
export const heroSample = sections.hero;
export const newsletterSample = sections.newsletter;
export const commandSample = sections.command;
export const appFrameSample = frames.app;
