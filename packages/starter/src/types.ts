/** The three outcomes retained from the installed package and Advisor CLIs. */
export type StarterState = "satisfied" | "violated" | "indeterminate";
export type PackageManager = "npm" | "pnpm";
export type StarterPhase = "foundation" | "activation";

/** An exact public npm package identity; ranges, tags, and local paths have no shape here. */
export interface ExactPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

/** The only target invocation supported by v1: one captured JSON input. */
export interface TargetPackage extends ExactPackage {
  readonly bin: string;
  readonly invocation: "single-json-input";
}

/** Consumer-owned protected-base request. It never contains a command, shell fragment, or CLI path. */
export interface StarterRequest {
  readonly schemaVersion: 1;
  readonly phase: StarterPhase;
  readonly packageManager: PackageManager;
  readonly snapshot: {
    readonly repository: string;
    readonly maxAgeMs: number;
  };
  readonly starter: ExactPackage & { readonly bin: "foundry-starter" };
  readonly advisor: ExactPackage & { readonly bin: "advisor-execution-readiness" };
  readonly target: TargetPackage;
  readonly evidence: {
    readonly assessment: string;
    readonly targetInput: string;
  };
}

/** Metadata produced by the uncredentialed pull-request job. */
export interface SnapshotManifest {
  readonly schemaVersion: 1;
  readonly provider: "github-actions";
  readonly eventName: "pull_request";
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly workflowRunId: string;
  readonly artifactName: string;
  readonly digest: string;
  readonly capturedAt: string;
  readonly files: readonly SnapshotFile[];
}

export interface SnapshotFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

/** Facts supplied by the trusted workflow-run event, not by pull-request code. */
export interface TrustedEvent {
  readonly schemaVersion: 1;
  readonly provider: "github-actions";
  readonly eventName: "workflow_run";
  readonly repository: string;
  readonly baseSha: string;
  readonly sourceWorkflowRunId: string;
  readonly sourceHeadSha: string;
  readonly artifactName: string;
  readonly sourceConclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required";
}

/** A fixed adapter's observed install completion. It is written by the caller workflow, never inferred from a skipped step. */
export interface InstallReceipt {
  readonly schemaVersion: 1;
  readonly packageManager: PackageManager;
  readonly attempted: boolean;
  readonly exitCode: 0 | 1 | 2;
}

/** Captured raw process result. The evaluator checks JSON state and exit code agree. */
export interface ProcessObservation {
  readonly attempted: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  /** The subprocess exceeded Starter's fixed deadline; it is not a violation report. */
  readonly timedOut?: boolean;
  readonly currentAsOf?: string;
}

export interface StarterFinding {
  readonly rule: string;
  readonly message: string;
}

export interface StarterReport {
  readonly state: StarterState;
  readonly phase: StarterPhase | null;
  readonly findings: readonly StarterFinding[];
  readonly advisor: StarterState | null;
  readonly target: StarterState | null;
}

export interface StarterEvaluationInput {
  readonly request: unknown;
  readonly snapshot: unknown;
  readonly trustedEvent: unknown;
  readonly install: unknown;
  readonly now: string;
  readonly advisor?: ProcessObservation;
  readonly target?: ProcessObservation;
}
