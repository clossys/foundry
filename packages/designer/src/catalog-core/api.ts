import type { CatalogData, Finding, LibraryData, Pick, Resolved, Selection } from "./types.js";

export type { CatalogData, CheckCode, Finding, LibraryData } from "./types.js";

export interface CheckResult { ok: boolean; findings: readonly Finding[] }
export type ChangeSet = { baseHash: string; changes: readonly ({ op: "set"; pick: Pick } | { op: "clear"; scope: Pick["scope"]; target: string })[] };
export type EmitTarget = "css-brand" | "css-scales" | "css-fonts" | "tailwind-theme";
export interface EmitOptions {
  selectors?: { light: string; mediaDark: string; dark: string };
  full?: boolean;
  extraVars?: boolean;
  header?: boolean;
}
export interface EmitFile { path: "brand.css" | "scales.css" | "fonts.css" | "theme.css"; contents: string }

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export function resolve(_input: { catalog: CatalogData; library: LibraryData; selection: Selection }): Resolved {
  throw new Error("not implemented: S0-b");
}
export function check(_input: {
  catalog: CatalogData; library: LibraryData; selection: Selection; resolved?: Resolved; fileExists?: (path: string) => boolean;
}): CheckResult {
  throw new Error("not implemented: S0-b");
}
export function emit(_resolved: Resolved, _targets: readonly EmitTarget[], _options?: EmitOptions): EmitFile[] {
  throw new Error("not implemented: S0-b");
}
export function applyChangeSet(_selection: Selection, _changes: ChangeSet): Selection {
  throw new Error("not implemented: S0-b");
}
export function selectionHash(_selection: Selection): string {
  throw new Error("not implemented: S0-b");
}
