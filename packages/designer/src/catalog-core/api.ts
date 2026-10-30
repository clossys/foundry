import type { CatalogData, Finding, LibraryData } from "./types.js";

export type { CatalogData, CheckCode, Finding, LibraryData } from "./types.js";

export interface CheckResult { ok: boolean; findings: readonly Finding[] }
export type LibraryOperation =
  | { op: "adopt"; slot: string; source: string; members?: readonly string[] }
  | { op: "author"; slot: string; tokens: Readonly<Record<string, import("./types.js").DtcgToken>> }
  | { op: "derive"; slot: string; rule: string; inputs: readonly string[] }
  | { op: "remove"; slot: string };
export type ChangeSet = { baseHash: string; changes: readonly LibraryOperation[] };
export type EmitTarget = "css-brand" | "css-scales" | "css-fonts" | "tailwind-theme" | "notices";
export interface EmitOptions {
  selectors?: { light: string; mediaDark: string; dark: string };
  full?: boolean;
  extraVars?: boolean;
  header?: boolean;
}
export interface EmitFile { path: "brand.css" | "scales.css" | "fonts.css" | "theme.css" | "notices.json"; contents: string }

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

import { resolve as resolveValues } from "./resolve.js";
import { check as checkValues } from "./check.js";
import { emit as emitValues } from "./emit.js";
import { applyLibraryChange as applyValueChange, libraryHash as valueLibraryHash } from "./library.js";
import { applyCompositeLibraryChange, checkComposite, compositeLibraryHash, emitComposite, resolveComposite } from "./library-components.js";
import type { EngineInput } from "./resolve.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeCheckResult, CompositeEmitFile, CompositeEmitTarget, CompositeEngineInput, CompositeLibraryData, CompositeResolved, Resolved } from "./types.js";

function isCompositeLibrary(library: LibraryData | CompositeLibraryData): library is CompositeLibraryData { return "values" in library; }
function isCompositeInput(input: EngineInput | CompositeEngineInput): input is CompositeEngineInput { return isCompositeLibrary(input.library); }
export function resolve(input: CompositeEngineInput): CompositeResolved;
export function resolve(input: EngineInput): Resolved;
export function resolve(input: EngineInput | CompositeEngineInput): Resolved | CompositeResolved {
  return isCompositeInput(input) ? resolveComposite(input) : resolveValues(input);
}
export function check(input: CompositeEngineInput): CompositeCheckResult;
export function check(input: Parameters<typeof checkValues>[0]): CheckResult;
export function check(input: Parameters<typeof checkValues>[0] | CompositeEngineInput): CheckResult | CompositeCheckResult {
  return isCompositeInput(input) ? checkComposite(input) : checkValues(input);
}
export function emit(profile: CompositeResolved, targets: readonly CompositeEmitTarget[], options?: EmitOptions): CompositeEmitFile[];
export function emit(profile: Resolved, targets: readonly EmitTarget[], options?: EmitOptions): EmitFile[];
export function emit(profile: Resolved | CompositeResolved, targets: readonly CompositeEmitTarget[], options: EmitOptions = {}): CompositeEmitFile[] {
  if ("values" in profile) return emitComposite(profile, targets, options);
  if (targets.some(target => target === "component-index" || target === "components-consumption" || target === "surface-index" || target === "surfaces-consumption")) throw new CatalogError("emit: component targets require a composite profile");
  return emitValues(profile, targets as readonly EmitTarget[], options);
}
export function applyLibraryChange(catalog: CompositeCatalogData, library: CompositeLibraryData, cs: CompositeChangeSet, options?: import("./surface-types.js").SurfaceApplyOptions): CompositeLibraryData;
export function applyLibraryChange(catalog: CatalogData, library: LibraryData, cs: ChangeSet): LibraryData;
export function applyLibraryChange(catalog: CatalogData | CompositeCatalogData, library: LibraryData | CompositeLibraryData, cs: ChangeSet | CompositeChangeSet, options?: import("./surface-types.js").SurfaceApplyOptions): LibraryData | CompositeLibraryData {
  if (isCompositeLibrary(library)) {
    if (!("values" in catalog) || cs.changes.some(operation => !("portion" in operation))) throw new CatalogError("composite: explicit catalog and operation portions required");
    return applyCompositeLibraryChange(catalog, library, cs as CompositeChangeSet, options);
  }
  if ("values" in catalog || cs.changes.some(operation => "portion" in operation)) throw new CatalogError("changeset: incompatible portions");
  return applyValueChange(catalog, library, cs as ChangeSet);
}
export function libraryHash(library: LibraryData | CompositeLibraryData): string {
  return isCompositeLibrary(library) ? compositeLibraryHash(library) : valueLibraryHash(library);
}
export { consumptionReport } from "./relationships.js";
export type { ConsumptionReport, ConsumptionLeaf } from "./relationships.js";
export { generateSelection, migrateSelection } from "./library.js";
export { sha256 } from "./digest.js";
