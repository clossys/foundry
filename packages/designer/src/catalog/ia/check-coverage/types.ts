/** Private report schema: catalog ids remain independent of all display paths. */
export type Layer = "tokens" | "assets" | "components" | "sections" | "frames";
export type FillState = "absent" | "draft" | "checked" | "approved";
export type Priority = "P0" | "P1" | "P2";
export interface Placement {
  layer: Layer;
  nodes: { id: string; label: string; children: { id: string; label: string; leaves: string[] }[] }[];
  crossReferences?: { node: string; leaves: string[] }[];
}
export interface Fill {
  id: string; leaf: string; hash: string;
  checks?: { sourceHash: string; results: { code: string; passed: boolean }[] }[];
  signoff?: { by: string; date: string; ref: string };
}
export interface Edge {
  from: string; to: string; evidence: string;
  /** A schema's reverse ownership pointer is validated, but is not a consumption cycle. */
  kind?: "consumes" | "describes";
}
export interface ExternalNode { id: string; package: "writer" | "publisher"; kind: string }
export interface CoverageInput {
  placements: Placement[];
  slots: { id: string; layer: Layer }[];
  fills: Fill[];
  edges: Edge[];
  external?: ExternalNode[];
  adminRoots: string[];
  adminInputsComplete: boolean;
  needs?: string[];
  unavailablePackages?: ("writer" | "publisher")[];
  diagnostics?: Finding[];
}
export interface Finding { code: string; priority: Priority; subject: string; target?: string; message: string }
export interface Board {
  id: string; layer: Layer; level: "L0" | "L1" | "L2";
  declaredLeaves: number; registeredLeaves: number;
}
export interface Leaf {
  id: string; layer: Layer; path: { l1: string; l2: string } | null;
  registered: boolean; state: FillState; fills: string[];
  uses: string[]; usedBy: string[]; admin: "reachable" | "unreachable" | "unknown";
}
export interface CoverageReport {
  schemaVersion: 1;
  basis: { inputMode?: "catalog" | "supplied-snapshot"; inputsHash?: string; connections: "declared-and-reported"; adminInputsComplete: boolean; needs: string[] };
  boards: Board[]; leaves: Leaf[]; external: ExternalNode[]; edges: Edge[]; findings: Finding[];
  summary: {
    levels: Record<"L0" | "L1" | "L2" | "L3", number>;
    states: Record<FillState, number>;
    layers: Record<Layer, { L0: number; L1: number; L2: number; L3: number; registered: number; states: Record<FillState, number> }>;
    priorities: Record<Priority, number>;
    dangling: { from: string; to: string }[]; unresolved: { from: string; to: string }[]; orphans: string[]; cycles: string[][];
    admin: Record<"reachable" | "unreachable" | "unknown", number>;
  };
}
