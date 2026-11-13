import type { WriterCatalog } from "../../catalog/ia/index.js";
import type { WriterLibrary, WriterRecord } from "../../model/types.js";

export interface DesignerCatalogShape {
  readonly slots: readonly { readonly id: string; readonly contract: Readonly<Record<string, unknown>>; readonly requires?: readonly string[] }[];
  readonly standards?: readonly { readonly id: string; readonly clauses: readonly { readonly id: string }[] }[];
}
export interface ConnectionSnapshot {
  readonly nodes: readonly { readonly id: string; readonly uses: readonly string[] }[];
  readonly adminRoots: readonly string[];
  /** Completeness is a caller declaration, not inferred from a partial route inventory. */
  readonly completeAdminGraph: boolean;
}
export interface CoverageInput {
  readonly catalog: WriterCatalog;
  readonly designer: DesignerCatalogShape;
  readonly library?: WriterLibrary;
  /** Shipped sample records prove presence, never consumer validation or approval. */
  readonly catalogRecords?: readonly { readonly locale: string; readonly records: readonly WriterRecord[] }[];
  readonly connections?: ConnectionSnapshot;
}
export type FillState = "absent" | "draft" | "checked" | "approved";
export interface CoverageFinding {
  readonly id: string;
  readonly code: string;
  readonly priority: "P0" | "P1" | "P2";
  readonly subject: string;
  readonly detail: string;
}
export interface CoverageEdge { readonly from: string; readonly to: string; readonly kind: "requires" | "record" | "schema" | "external" }
export interface CoverageLeaf {
  readonly id: string;
  readonly layer: string;
  readonly paths: readonly string[][];
  readonly state: FillState;
  readonly uses: readonly string[];
  readonly usedBy: readonly string[];
  readonly adminPage: boolean | null;
  readonly priority: "P1" | "P2" | null;
  readonly records: readonly { readonly id: string; readonly locale: string; readonly state: FillState; readonly reasons: readonly string[] }[];
}
export interface CoverageReport {
  readonly schemaVersion: 1;
  readonly source: "writer";
  readonly summary: { readonly levels: Readonly<Record<"L0" | "L1" | "L2" | "L3", number>>; readonly states: Readonly<Record<FillState, number>>; readonly admin: { readonly reachable: number; readonly unreachable: number; readonly unknown: number } };
  readonly boards: readonly { readonly layer: string; readonly groups: readonly { readonly id: string; readonly level: number; readonly parent: string; readonly leaves: readonly string[] }[] }[];
  readonly leaves: readonly CoverageLeaf[];
  readonly edges: readonly CoverageEdge[];
  readonly pairs: readonly { readonly section: string; readonly passage: string; readonly resolved: boolean }[];
  readonly findings: readonly CoverageFinding[];
  readonly dangling: readonly CoverageEdge[];
  readonly orphans: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly needs: readonly string[];
}
