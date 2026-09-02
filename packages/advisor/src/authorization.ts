import type { AdvisorAssessment, AdvisorFinding, AssessmentBasis, ImmutablePackageRef } from "./types.js";

/** Every field an {@link AssessmentBasis} carries, including its freshness window. Stable field order; do not rely on it for anything other than iteration. */
export const BASIS_FIELDS = ["snapshotDigest", "grantDigest", "catalogDigest", "planDigest", "blockerDigest", "clearanceDigest", "conflictDigest", "baselineDigest", "completionDefinitionDigest", "assessedAt", "freshUntil"] as const;
/** The sha256 content-addressed digest fields of an {@link AssessmentBasis}, excluding its two timestamp fields. A caller deriving its own current basis from source material should digest exactly these fields to stay bound to Advisor's own contract instead of a hand-copied field list. */
export const BASIS_DIGEST_FIELDS = ["snapshotDigest", "grantDigest", "catalogDigest", "planDigest", "blockerDigest", "clearanceDigest", "conflictDigest", "baselineDigest", "completionDefinitionDigest"] as const;
function finding(rule: string, message: string): AdvisorFinding { return { rule, severity: "error", message }; }
function shapeFinding(rule: string, message: string, path: string): AdvisorFinding { return { rule, severity: "error", message, path }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function parseTimestamp(value: unknown): number { return typeof value === "string" ? Date.parse(value) : Number.NaN; }
/** Whether two assessment bases are field-for-field identical across every {@link BASIS_FIELDS} entry, including the freshness window. Digests are compared as opaque strings; this does not interpret or re-derive them. */
export function sameBasis(left: AssessmentBasis, right: AssessmentBasis): boolean { return BASIS_FIELDS.every((field) => left[field] === right[field]); }
/** Whether two string arrays hold the same values, ignoring order and without tolerating a duplicate on one side that isn't matched on the other. Neither input is mutated. */
export function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]); }
/** The canonical identity key for an immutable package reference: `name@version#integrity`. Two references with the same key are the exact same install candidate; use it with {@link sameStrings} to compare arrays of package references (for example, an authorization's `permittedPackages` against an approved work-item set) without writing a bespoke deep-equality check. */
export function packageKey(item: ImmutablePackageRef): string { return `${item.name}@${item.version}#${item.integrity}`; }

/** Validates authorization structure and time fields without needing a derived plan. */
export function validateExecutionAuthorizationShape(value: unknown, asOf: unknown, path = "engagement.executionAuthorization"): AdvisorFinding[] {
  if (!record(value)) return [shapeFinding("execution-authorization-shape", "Execution authorization must be an object.", path)];
  const findings: AdvisorFinding[] = [];
  if (typeof value.planDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.planDigest)) findings.push(shapeFinding("execution-authorization-plan-digest", "planDigest must be a sha256 content-addressed reference.", `${path}.planDigest`));
  const basis = value.assessmentBasis;
  if (!record(basis)) findings.push(shapeFinding("execution-authorization-basis-shape", "assessmentBasis must be an object of content-addressed digests.", `${path}.assessmentBasis`));
  else {
    for (const field of BASIS_DIGEST_FIELDS) if (typeof basis[field] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(basis[field] as string)) findings.push(shapeFinding("execution-authorization-basis-shape", `${field} must be a sha256 content-addressed reference.`, `${path}.assessmentBasis.${field}`));
    for (const field of ["assessedAt", "freshUntil"] as const) if (Number.isNaN(parseTimestamp(basis[field]))) findings.push(shapeFinding("execution-authorization-basis-shape", `${field} must be an interpretable timestamp.`, `${path}.assessmentBasis.${field}`));
    const assessedAt = parseTimestamp(basis.assessedAt); const freshUntil = parseTimestamp(basis.freshUntil); const current = parseTimestamp(asOf);
    if (![assessedAt, freshUntil].some(Number.isNaN) && freshUntil <= assessedAt) findings.push(shapeFinding("execution-authorization-basis-freshness", "assessmentBasis.freshUntil must be after assessedAt.", `${path}.assessmentBasis`));
    if (![assessedAt, freshUntil, current].some(Number.isNaN) && (current < assessedAt || current >= freshUntil)) findings.push(shapeFinding("execution-authorization-basis-stale", "assessmentBasis must cover the current asOf timestamp.", `${path}.assessmentBasis`));
  }
  if (!nonEmpty(value.sponsorRef)) findings.push(shapeFinding("execution-authorization-sponsor", "sponsorRef must be a non-empty string.", `${path}.sponsorRef`));
  if (!Array.isArray(value.permittedRepositoryIds) || value.permittedRepositoryIds.length === 0 || value.permittedRepositoryIds.some((item) => !nonEmpty(item))) findings.push(shapeFinding("execution-authorization-repositories", "permittedRepositoryIds must be a non-empty array of non-empty strings.", `${path}.permittedRepositoryIds`));
  if (!Array.isArray(value.permittedPackages) || value.permittedPackages.length === 0 || value.permittedPackages.some((item) => !record(item) || !nonEmpty(item.name) || !nonEmpty(item.version) || !nonEmpty(item.integrity))) findings.push(shapeFinding("execution-authorization-packages", "permittedPackages must be a non-empty array of immutable package references.", `${path}.permittedPackages`));
  if (!Array.isArray(value.permittedMutationSurfaces) || value.permittedMutationSurfaces.length === 0 || value.permittedMutationSurfaces.some((item) => !nonEmpty(item))) findings.push(shapeFinding("execution-authorization-mutations", "permittedMutationSurfaces must be a non-empty array of non-empty strings.", `${path}.permittedMutationSurfaces`));
  const grantedAt = parseTimestamp(value.grantedAt); const expiresAt = parseTimestamp(value.expiresAt); const current = parseTimestamp(asOf);
  if ([grantedAt, expiresAt].some(Number.isNaN)) findings.push(shapeFinding("execution-authorization-expiry", "grantedAt and expiresAt must be interpretable timestamps.", path));
  else if (expiresAt <= grantedAt || (!Number.isNaN(current) && (current < grantedAt || current >= expiresAt))) findings.push(shapeFinding("execution-authorization-expiry", "Authorization must be current at asOf and expire after it was granted.", path));
  return findings;
}

/**
 * Validates authority against the exact evidence-derived plan. This module is
 * deliberately types-only: assessment and session callers share it without
 * provider I/O or an import cycle.
 */
export function validateExecutionAuthorization(authorization: unknown, assessment: AdvisorAssessment, asOf: string): AdvisorFinding[] {
  if (!record(authorization)) return [finding("execution-authorization-shape", "Execution authorization must be an object.")];
  const findings: AdvisorFinding[] = [];
  const plan = assessment.firstWavePlan;
  const basis = plan.basis;
  if (plan.state !== "ready-for-sponsor-approval" || assessment.preWork.state !== "satisfied") findings.push(finding("execution-authorization-readiness", "Authorization requires an evidence-derived plan whose pre-work is satisfied and ready for sponsor approval."));
  if (basis === null || authorization.planDigest !== basis.planDigest || !record(authorization.assessmentBasis) || !sameBasis(authorization.assessmentBasis as unknown as AssessmentBasis, basis)) findings.push(finding("execution-authorization-basis", "Authorization must bind the exact current plan digest and assessment basis."));
  if (!nonEmpty(authorization.sponsorRef) || ["advisor", "@clossys/advisor"].includes(authorization.sponsorRef.toLowerCase())) findings.push(finding("execution-authorization-sponsor", "Authorization must name an accountable sponsor other than Advisor."));
  const grantedAt = parseTimestamp(authorization.grantedAt); const expiresAt = parseTimestamp(authorization.expiresAt); const current = parseTimestamp(asOf); const assessedAt = basis === null ? Number.NaN : parseTimestamp(basis.assessedAt); const freshUntil = basis === null ? Number.NaN : parseTimestamp(basis.freshUntil);
  if ([grantedAt, expiresAt, current, assessedAt, freshUntil].some(Number.isNaN) || grantedAt < assessedAt || current < grantedAt || current >= expiresAt || expiresAt > freshUntil || current >= freshUntil) findings.push(finding("execution-authorization-expiry", "Authorization must be granted within, current during, and expire no later than the assessment basis freshness window."));
  const expectedRepos = [...new Set(plan.workItems.map((item) => item.targetRepositoryId))]; const expectedPackages = [...new Set(plan.workItems.map((item) => packageKey(item.package)))]; const expectedMutations = [...new Set(plan.workItems.flatMap((item) => item.mutationSurfaces))];
  if (!Array.isArray(authorization.permittedRepositoryIds) || authorization.permittedRepositoryIds.some((item) => !nonEmpty(item)) || !sameStrings(authorization.permittedRepositoryIds as readonly string[], expectedRepos)) findings.push(finding("execution-authorization-repositories", "Authorization repositories must exactly equal the approved work-item repositories."));
  if (!Array.isArray(authorization.permittedPackages) || authorization.permittedPackages.some((item) => !record(item) || !nonEmpty(item.name) || !nonEmpty(item.version) || !nonEmpty(item.integrity)) || !sameStrings((authorization.permittedPackages as readonly ImmutablePackageRef[]).map(packageKey), expectedPackages)) findings.push(finding("execution-authorization-packages", "Authorization packages must exactly equal immutable approved package references."));
  if (!Array.isArray(authorization.permittedMutationSurfaces) || authorization.permittedMutationSurfaces.some((item) => !nonEmpty(item)) || !sameStrings(authorization.permittedMutationSurfaces as readonly string[], expectedMutations)) findings.push(finding("execution-authorization-mutations", "Authorization mutation surfaces must exactly equal approved work-item mutation surfaces."));
  return findings;
}
