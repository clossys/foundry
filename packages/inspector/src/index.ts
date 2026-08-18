/**
 * @vespeneventures/inspector — the gate that judges a change before it
 * lands, published as a package so a fix reaches every consumer through the
 * same dependency machinery every other real dependency already uses.
 *
 * Formerly two packages (`verify-standards` and `secret-scan`; see #283).
 * This module — the package root — is the judge: four checks bundled here —
 * a secret-scan attempt, a change's task record, its review evidence, and
 * drift between a declared standard and the live state enforcing it. Each is
 * a pure function of observations the caller collected, each returns the
 * `satisfied` / `violated` / `indeterminate` ternary from
 * `@vespeneventures/controller/gates`, and the run folds to a `0` / `1` / `2`
 * exit code that nothing can override.
 *
 * A fifth thing is checked that is not about the repository at all: whether
 * this build is old enough to be untrustworthy. See `./version.ts`.
 *
 * The `./secret-scan` subpath is the *mechanism* half — acquiring a verified
 * `gitleaks` binary and, now, actually running it — kept structurally apart
 * from the judge above. `checkSecretScan` here evaluates a record of an
 * attempt; it was never able to tell whether the record is honest, only
 * whether it is self-consistent, and that is unchanged. What is new is that
 * this package can now produce a genuine attempt itself, for a caller who
 * wants one, rather than requiring every caller to hand-roll a collector
 * script around a binary from somewhere else. See `./secret-scan/attempt.ts`.
 *
 * Zero I/O in this module. The `inspector` executable reads exactly one
 * caller-named file through an injected port and nothing else; the
 * `./secret-scan` subpath is the one place in this package that does real
 * I/O, and it is isolated there rather than folded into the judge.
 */

export { STANDARDS_CHECKS } from "./types.js";
export type { CheckFinding, StandardsCheckName, StandardsFinding, StandardsReportRow } from "./types.js";

export { MINIMUM_SAFE_VERSION, checkVersionFloor, compareVersions, lowestSatisfyingVersion, parseVersion, versionFloorFindings, versionFloorReasons } from "./version.js";
export type { ParsedVersion, VersionFloorFinding, VersionFloorInput, VersionFloorReport } from "./version.js";

export { checkSecretScan, secretScanReasons } from "./secret-scan.js";
export type { SecretScanFinding, SecretScanHit, SecretScanObservation, SecretScanPolicy, SecretScanReason, SecretScanScope } from "./secret-scan.js";

export { TASK_ITEM_LOOKUP_OUTCOMES, checkTaskRecord, extractTaskReferenceText, parseTaskReference, taskRecordReasons } from "./task-record.js";
export type { ParsedTaskReference, TaskItemLookupOutcome, TaskItemObservation, TaskRecordExemption, TaskRecordFinding, TaskRecordObservation, TaskRecordPolicy, TaskRecordReason, TaskRecordReport } from "./task-record.js";

export { checkReviewEvidence, reviewEvidenceReasons } from "./review-evidence.js";
export type { ReviewEvidenceFinding, ReviewEvidenceOptions, ReviewEvidenceReason, ReviewEvidenceReport } from "./review-evidence.js";

export { checkPolicyDrift, policyDriftReasons } from "./policy-drift.js";
export type { PolicyDocumentExpectation, PolicyDriftFinding, PolicyDriftObservation, PolicyDriftOptions, PolicyDriftReason, PolicyDriftReport, PolicyRequirement } from "./policy-drift.js";

export { VERIFY_STANDARDS_INPUTS_VERSION, inputsReasons, selectionReasons, verifyStandards } from "./verify.js";
export type { StandardsRowReport, VerifyStandardsInputs, VerifyStandardsOptions, VerifyStandardsReport } from "./verify.js";

export { CliInputError, USAGE, main, parseArgs, renderReport } from "./cli.js";
export type { CliPort } from "./cli.js";
