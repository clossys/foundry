/**
 * @vespeneventures/verify-standards — one repository-standards gate,
 * published as a package so a fix reaches every consumer through the same
 * dependency machinery every other real dependency already uses.
 *
 * Four checks are bundled — a secret-scan attempt, a change's task record,
 * its review evidence, and drift between a declared standard and the live
 * state enforcing it. Each is a pure function of observations the caller
 * collected, each returns the `satisfied` / `violated` / `indeterminate`
 * ternary from `@vespeneventures/governance/gates`, and the run folds to a
 * `0` / `1` / `2` exit code that nothing can override.
 *
 * A fifth thing is checked that is not about the repository at all: whether
 * this build is old enough to be untrustworthy. See `./version.ts`.
 *
 * Zero I/O in the library. The `verify-standards` executable reads exactly
 * one caller-named file through an injected port and nothing else.
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
