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

/** Caller-supplied evidence about the hub that appointed the subject repository. Starter performs no I/O to verify it. */
export interface StarterHubEvidence {
  readonly owner: string;
  readonly repository: string;
  readonly inventoried: boolean;
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
  /** Optional hub-inventory evidence supplied by the caller; absence changes nothing. */
  readonly hub?: StarterHubEvidence;
}

/** Metadata produced by the uncredentialed pull-request job. */
export interface SnapshotManifest {
  readonly schemaVersion: 1;
  readonly provider: "github-actions";
  readonly eventName: "pull_request";
  readonly repository: string;
  readonly pullRequestNumber: number;
  /** Canonical 40-lowercase-hex Git commit SHA-1 OID from GitHub. */
  readonly baseSha: string;
  /** Canonical 40-lowercase-hex Git commit SHA-1 OID from GitHub. */
  readonly headSha: string;
  readonly workflowRunId: string;
  readonly artifactName: string;
  /** Canonical 64-lowercase-hex SHA-256 digest of the snapshot manifest. */
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
  /** Canonical 40-lowercase-hex Git commit SHA-1 OID from GitHub. */
  readonly baseSha: string;
  readonly sourceWorkflowRunId: string;
  /** Canonical 40-lowercase-hex Git commit SHA-1 OID from GitHub. */
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

/** Which request identity a head-install proof names. */
export type HeadInstallRole = "starter" | "advisor" | "target";

/** One exact identity the head-install proof found installed from the pull-request head's own manifest and lockfile. */
export interface HeadInstallIdentity extends ExactPackage {
  readonly role: HeadInstallRole;
  readonly bin: string;
}

/** The observed fixed `npm ci --ignore-scripts` run over the staged pull-request head. */
export interface HeadInstallObservation {
  readonly attempted: boolean;
  readonly exitCode: number | null;
  readonly timedOut?: boolean;
}

/**
 * Inputs to the pure head-install evaluator. `request` is the protected-base
 * request; `headRequest` is the pull-request head's copy, read only as data.
 * `inputFindings` could not be established (indeterminate); `sourceViolations`
 * are known lockfile or manifest refusals (violated).
 */
export interface HeadInstallEvaluationInput {
  readonly request: unknown;
  readonly headRequest: unknown;
  readonly trustedEvent: unknown;
  /** The commit the trusted head checkout actually holds, or null when unreadable. */
  readonly headCommit: string | null;
  readonly inputFindings: readonly StarterFinding[];
  readonly sourceViolations: readonly StarterFinding[];
  readonly install?: HeadInstallObservation;
  readonly identityFindings?: readonly StarterFinding[];
}

/** The separate head-install proof report; it never replaces the protected-base `StarterReport`. */
export interface HeadInstallReport {
  readonly schemaVersion: 1;
  readonly kind: "head-install";
  readonly state: StarterState;
  readonly headSha: string | null;
  readonly baseSha: string | null;
  /** Present only when `state` is `satisfied`. */
  readonly proved: readonly HeadInstallIdentity[] | null;
  /** Request identities whose head pin differs from the protected base; null when the head request is unreadable. */
  readonly changedFromBase: readonly HeadInstallRole[] | null;
  readonly findings: readonly StarterFinding[];
}
