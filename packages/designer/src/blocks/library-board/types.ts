import type { StudioActionsProps } from "./OpenWithActions.js";
export interface PendingCandidate { id: string; slot: string; label: string; source: string; variants: readonly string[] }
export type CandidateCheckResult = { status: "checked"; candidates: readonly PendingCandidate[] } | { status: "unavailable" | "failed" };
export interface CandidateWorkflow {
  guidelines?: Readonly<Record<string, readonly string[]>>;
  returnStep: string;
  actions?: Omit<StudioActionsProps, "promptContext" | "taskPrompt">;
  checkCandidates?(slot: string): Promise<CandidateCheckResult>;
}
export interface LibraryBoardLabels {
  board: { changeSelection: string; done: string; notChosen: string; choose: string; askAgent: string; custom: string; create: string; refresh: string; promptTitle: string; promptInstruction: string; returnStep: string; copy: string; copied: string; copyFailed: string; close: string; checkCandidates: string; checking: string; candidatesUnavailable: string; candidatesFailed: string; pendingSelection: string; noNewCandidates: string };
  matrix: { label: string; leaf: string };
  stageLabel: string; previewUnavailable: string;
  useSource(source: string, target: string): string;
  checkSummary(errors: number, notices: number): string;
  /** Neutral count of fills awaiting runtime qualification; a default English line is used when absent. */
  runtimePending?: (count: number) => string;
}
