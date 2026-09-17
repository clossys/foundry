/**
 * Proposing the installed-position ledger, and refusing mutation without it.
 *
 * The ledger this module emits is a JOIN of two things it does not author:
 * the dispositions implied by the deterministic selection, and the position
 * records each role's own assessment proposed. `assertRoleAuthoredPositions`
 * re-checks the second half by reference identity before the ledger is
 * returned, so a position this module built, defaulted, normalized or merged
 * throws rather than shipping.
 *
 * A selected role that produced no assessment blocks the ledger outright.
 * There is no "assume not-applicable" path: deciding that a role is not
 * needed is that role's call or the decision owner's, never this module's.
 */
import { validateInstalledPositionLedger } from "../positions/index.js";
import { computeDigest } from "../policy/digest.js";
import { EXCLUSION_REASON } from "./selection.js";
import type { LedgerProposal, MutationApproval, MutationAuthorization, OnboardingFinding, OnboardingRun } from "./types.js";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }

/** The key a role's assessment uses to return the positions it proposes. */
export const PROPOSED_POSITIONS_KEY = "proposedPositions";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The content-addressed identity of one run. A decision owner approves this exact value, not a summary of it. */
export function onboardingRunDigest(run: OnboardingRun): string { return computeDigest(canonical(run)); }

/** Throws when a ledger carries a position object no role returned. */
export function assertRoleAuthoredPositions(positions: readonly unknown[], roleAuthored: ReadonlySet<unknown>): void {
  for (const position of positions) {
    if (!roleAuthored.has(position)) throw new Error("onboarding proposed a position no role assessment returned; only a role may propose its own positions");
  }
}

/**
 * Derives one complete installed-position ledger covering every active role.
 * Returns `ledger: null` with findings whenever the run cannot support one.
 */
export function proposeInstalledPositionLedger(run: OnboardingRun, activeRoles: readonly string[]): LedgerProposal {
  const findings: OnboardingFinding[] = [];
  if (run.state !== "satisfied") {
    findings.push({ rule: "ledger-blocked-by-run-state", path: "run.state", message: `a ${run.state} run cannot support an installed-position ledger; every selected role must have returned its own assessment first` });
  }
  const dispositions: unknown[] = [];
  const positions: unknown[] = [];
  const authored = new Set<unknown>();
  const selectionRules = new Map(run.selection.map((item) => [item.role, item] as const));
  const assessments = new Map(run.assessments.map((item) => [item.role, item] as const));

  for (const role of [...activeRoles].sort()) {
    const selection = selectionRules.get(role);
    if (selection === undefined) {
      findings.push({ rule: "role-not-in-selection", path: role, message: "an active role was never put to the selection rules; the ledger cannot dispose of it" });
      continue;
    }
    if (selection.outcome === "excluded") {
      dispositions.push({ package: role, disposition: "not-applicable", reason: EXCLUSION_REASON, positionIds: [] });
      continue;
    }
    const assessment = assessments.get(role);
    if (assessment === undefined || assessment.outcome !== "assessment-returned") {
      findings.push({ rule: "ledger-blocked-by-unassessed-role", path: role, message: `opened by rule "${selection.rule}" and did not return an assessment (${assessment?.outcome ?? "assessment-not-returned"}); no disposition can be derived for it` });
      continue;
    }
    const payload = assessment.assessment;
    const proposed = record(payload) ? payload[PROPOSED_POSITIONS_KEY] : undefined;
    if (!Array.isArray(proposed)) {
      findings.push({ rule: "role-assessment-without-proposed-positions", path: role, message: `the role's returned assessment has no \`${PROPOSED_POSITIONS_KEY}\` array; the ledger cannot invent one` });
      continue;
    }
    const ids: string[] = [];
    let readable = true;
    for (const position of proposed) {
      if (!record(position) || !text(position.id)) { readable = false; continue; }
      ids.push(position.id);
      authored.add(position);
      positions.push(position);
    }
    if (!readable) {
      findings.push({ rule: "role-assessment-position-unreadable", path: role, message: "the role returned a proposed position with no string id; the ledger cannot assign one" });
      continue;
    }
    dispositions.push(ids.length === 0
      ? { package: role, disposition: "not-applicable", reason: `Opened by rule "${selection.rule}"; the role's own assessment proposed no position.`, positionIds: [] }
      : { package: role, disposition: "open", reason: `Opened by rule "${selection.rule}"; the role's own assessment proposed ${ids.length} position(s).`, positionIds: ids });
  }

  if (findings.length > 0) return { ledger: null, findings };
  assertRoleAuthoredPositions(positions, authored);
  return { ledger: { schemaVersion: 1, dispositions, positions }, findings };
}

/**
 * The mutation gate. It authorizes nothing until the ledger validates — which
 * is what makes baseline, setpoint, authority, guardrails and escalation path
 * mandatory, because `validateInstalledPositionLedger` requires every one of
 * them on every open position — and until the engagement's own decision owner
 * has approved this exact run by digest.
 */
export function authorizeMutation(run: OnboardingRun, ledger: unknown, approval: unknown): MutationAuthorization {
  const findings: OnboardingFinding[] = [];
  const fail = (rule: string, path: string, message: string): void => { findings.push({ rule, path, message }); };
  if (run.state !== "satisfied") fail("mutation-blocked-by-run-state", "run.state", `mutation requires a satisfied run; this run is ${run.state}`);
  for (const gap of run.gaps) fail("mutation-blocked-by-gap", gap.role, `a selected role was not assessed (${gap.reason}); an unobserved role cannot be treated as an observed one`);
  if (ledger === null || ledger === undefined) fail("mutation-blocked-by-missing-ledger", "ledger", "no installed-position contract was produced for the decision owner to approve");
  else {
    const report = validateInstalledPositionLedger(ledger);
    for (const finding of report.findings) fail("mutation-blocked-by-invalid-ledger", finding.path, `${finding.rule}: ${finding.message}`);
  }
  if (!record(approval) || !text(approval.decisionOwner) || !text(approval.approvedRunDigest) || !text(approval.approvedAt)) {
    fail("mutation-blocked-by-missing-approval", "approval", "needs a decisionOwner, the approved run digest, and an approval instant");
    return { authorized: false, findings };
  }
  const supplied = approval as unknown as MutationApproval;
  if (supplied.decisionOwner !== run.engagement.decisionOwner) fail("mutation-blocked-by-wrong-approver", "approval.decisionOwner", "the approval was not given by this engagement's decision owner");
  if (supplied.approvedRunDigest !== onboardingRunDigest(run)) fail("mutation-blocked-by-stale-approval", "approval.approvedRunDigest", "the approval names a different run than the one supplied; re-approve the exact run");
  return { authorized: findings.length === 0, findings };
}
