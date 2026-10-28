import type { PublisherBoardCopyResolver } from "./copy.js";
import type { CopyField } from "../composition.js";
import type { ContentRegistry } from "../model.js";
import type { CandidateStageEvidence, StageKey, StageReport } from "../stage-engine.js";
import type { StageStatus } from "../stages.js";
import type { ContentTree } from "../taxonomy.js";

export interface PublisherBoardNeed {
  readonly target: "writer" | "designer" | "publisher";
  readonly ref: string;
  readonly detail: string;
}
export interface PublisherBoardInput {
  readonly registry: ContentRegistry;
  readonly locale: string;
  readonly copy: readonly CopyField[];
  /** Host-configured Writer callback; required for ref-only copy fields. */
  readonly copyResolver?: PublisherBoardCopyResolver;
  readonly tree?: ContentTree;
  readonly evidence?: readonly CandidateStageEvidence[];
}
export interface PublisherBoardRow {
  /** Identity joins use immutable slot/candidate IDs, never display placement. */
  readonly id: string;
  readonly slotId: string;
  readonly candidateId: string | null;
  readonly slotLabel: string;
  readonly candidateLabel: string;
  readonly revision: string | null;
  readonly active: boolean;
  readonly report: StageReport | null;
  readonly cells: Readonly<Record<StageKey, { readonly status: StageStatus | null; readonly label: string }>>;
}
export interface PublisherBoardGroup {
  readonly id: string;
  readonly l2: string;
  readonly label: string;
  readonly rows: readonly PublisherBoardRow[];
}
export interface PublisherBoardLane {
  readonly id: string;
  readonly label: string;
  readonly groups: readonly PublisherBoardGroup[];
}
export interface PublisherBoardModel {
  readonly locale: string;
  readonly ready: boolean;
  readonly needs: readonly PublisherBoardNeed[];
  readonly labels: {
    readonly title: string;
    readonly canvas: string;
    readonly instructions: string;
    readonly empty: string;
    readonly slot: string;
    readonly candidate: string;
    readonly stages: Readonly<Record<StageKey, string>>;
  };
  readonly lanes: readonly PublisherBoardLane[];
}
