/**
 * Surface expectations read from the catalog, never hand-counted: the Sections and Frames
 * IA leaves, and the Foundry importer's committed coverage (one row per leaf). A leaf whose
 * candidate is available and maps every required content slot and state port is a default.
 */
import sectionIA from "../../../catalog/ia/sections.json" with { type: "json" };
import frameIA from "../../../catalog/ia/frames.json" with { type: "json" };
import sectionCoverage from "../../../catalog/fills/foundry/sections.coverage.json" with { type: "json" };
import frameCoverage from "../../../catalog/fills/foundry/frames.coverage.json" with { type: "json" };

interface IANode { readonly leaves?: readonly string[]; readonly children?: readonly IANode[] }
export interface SurfaceCoverageRow { readonly slot: string; readonly status: string; readonly missingRequiredSlots: readonly string[]; readonly missingStatePorts?: readonly string[] }

const leavesOf = (nodes: readonly IANode[]): string[] => nodes.flatMap(node => [...(node.leaves ?? []), ...leavesOf(node.children ?? [])]);

/** Every IA leaf of the layer, in IA order. */
export const SECTION_LEAVES: readonly string[] = leavesOf(sectionIA.nodes as readonly IANode[]);
export const FRAME_LEAVES: readonly string[] = leavesOf(frameIA.nodes as readonly IANode[]);

export const SECTION_COVERAGE = sectionCoverage.coverage as readonly SurfaceCoverageRow[];
export const FRAME_COVERAGE = frameCoverage.coverage as readonly SurfaceCoverageRow[];

/** The importer's static contract rule, as its coverage records it. */
export const isCoverageDefault = (row: SurfaceCoverageRow): boolean =>
  row.status !== "unavailable" && !row.missingRequiredSlots.length && !(row.missingStatePorts ?? []).length;

export const SECTION_DEFAULTS: readonly string[] = SECTION_COVERAGE.filter(isCoverageDefault).map(row => row.slot);
export const FRAME_DEFAULTS: readonly string[] = FRAME_COVERAGE.filter(isCoverageDefault).map(row => row.slot);
/** Every Section and Frame the Foundry preference defaults: one adopt decision and one package surface each. */
export const SURFACE_DEFAULTS: readonly string[] = [...SECTION_DEFAULTS, ...FRAME_DEFAULTS];
/** Leaves the importer has no candidate for. */
export const SECTION_NO_CANDIDATE: readonly string[] = SECTION_COVERAGE.filter(row => row.status === "unavailable").map(row => row.slot);
/** Leaves whose candidate leaves a required content slot unmapped, with those slots. */
export const SECTION_INELIGIBLE: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  SECTION_COVERAGE.filter(row => row.status !== "unavailable" && row.missingRequiredSlots.length).map(row => [row.slot, row.missingRequiredSlots]));
export const FRAME_NOT_CHOSEN: readonly string[] = FRAME_COVERAGE.filter(row => !isCoverageDefault(row)).map(row => row.slot);
