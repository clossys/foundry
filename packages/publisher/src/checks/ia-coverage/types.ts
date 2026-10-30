import type { ContentRegistry } from "../../content/model.js";
import type { ContentTree } from "../../content/taxonomy.js";
import type { CandidateStageEvidence, StageKey } from "../../content/stage-engine.js";
import type { StageStatus } from "../../content/stages.js";
import type { ReviewLibrarySnapshot } from "../../content/review/types.js";
import type { FormatIA, FormatLeaf } from "../../formats/contract.js";

/** Private check input/report, not a new content or lifecycle contract. */
export type FillState = "absent" | "draft" | "checked" | "approved";
export type Priority = "P0" | "P1" | "P2";
export interface Edge { from: string; to: string; kind: "uses" | "describes" | "inventory"; evidence: string }
export interface DesignerEntry { id: string; passageSchema?: string }
export interface WriterEntry { id: string; kind: "schema" | "record"; schema?: string; sectionId?: string; refs?: string[]; locales?: string[] }
export interface Finding { code: string; priority: Priority; subject: string; target?: string; message: string }
export interface CoverageInput {
  contentTree: ContentTree; declaredSlots: string[]; registry?: ContentRegistry;
  formatTree: FormatIA; formats: readonly FormatLeaf[];
  designer: DesignerEntry[]; writer: WriterEntry[];
  libraries: readonly ReviewLibrarySnapshot[]; evidence: readonly CandidateStageEvidence[];
  edges: Edge[]; needs: string[]; unavailable: ("writer" | "designer")[];
  diagnostics?: Finding[]; inputHashes?: Record<string, string>;
}
export interface Node {
  id: string; package: "publisher" | "designer" | "writer";
  kind: "slot" | "candidate" | "format" | "item" | "schema" | "record";
  registered: boolean; uses: string[]; usedBy: string[];
  admin: "reachable" | "unknown" | "unreachable";
}
export interface Leaf extends Node {
  kind: "slot" | "format"; path: { l1: string; l2: string } | null; state: FillState;
  stages?: Record<StageKey, StageStatus>; candidates?: string[];
}
export interface Board {
  id: string; layer: "slots" | "formats"; level: "L0" | "L1" | "L2";
  registeredLeaves: number; declaredLeaves: number; placementComplete: boolean;
}
export interface CoverageReport {
  schemaVersion: 1; kind: "publisher-ia-coverage";
  basis: { registryObserved: boolean; adminInputsComplete: boolean; connections: string; needs: string[]; inputHashes: Record<string, string>; scope: readonly string[] };
  boards: Board[]; leaves: Leaf[]; nodes: Node[]; edges: Edge[]; findings: Finding[];
  summary: {
    levels: Record<"L0" | "L1" | "L2" | "L3", number>;
    registered: number; states: Record<FillState, number>;
    layers: Record<"slots" | "formats", { L0: number; L1: number; L2: number; L3: number; registered: number; states: Record<FillState, number> }>;
    dangling: { from: string; to: string }[]; unresolved: { from: string; to: string }[];
    cycles: string[][]; orphans: string[]; unplaced: string[];
    priorities: Record<Priority, number>; admin: Record<Node["admin"], number>; excludedSlots: string[];
  };
}
export const ADMIN_ROUTES = ["/agents/designer", "/agents/writer", "/agents/publisher"] as const;
