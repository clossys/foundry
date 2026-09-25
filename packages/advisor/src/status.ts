import { contractFindings } from "./plan-contract.js";
import { planRuleViolations } from "./plan-rules.js";
import type { AdvisorFinding } from "./types.js";

/**
 * `clossys/advisor/STATUS`, a generated Markdown file (issue #1175,
 * scope-change comment 2026-09-22 superseding this issue's original
 * separate `PLAN` document): the plan lives as the "Recommended next"
 * section of the same fixed five-section status document every role
 * keeps, once Controller's loop engine (#1195) installs. That engine
 * does not exist yet, so this package renders the STATUS document
 * itself in the meantime from its own `AdvisorPlan` record — never a
 * second vocabulary, so the eventual migration to `loop.json` is a
 * rename, not a redesign. This package still performs no file or
 * network I/O: the Advisor skill writes this renderer's output
 * verbatim.
 *
 * Section order and names are fixed and match #1195 exactly: Mandate,
 * Where we are, Recommended next, Decisions, Blockers.
 *
 * BLOCKER SHAPE (owner direction on #1187, 2026-09-23: order-dependent
 * work may carry no local copy of a shared definition once that
 * definition is on `main`): `AdvisorPlanBlocker` is field-for-field the
 * same shape as the Controller role's own `Blocker` record, defined for
 * issue #1237 in Controller's own loop module (its shared contract,
 * `docs/contracts/loop.json`, is a real file in this repository's tree
 * but does not ship with this package) --
 * `capabilityId`, `kind`, `owner`, `nextAction: { who, how, byWhen }`,
 * `since` -- so `clossys/advisor/plan.json`'s blocker records and
 * `clossys/<role>/loop.json`'s are the same shape read two ways, never
 * two shapes that merely share five kind strings. This package still
 * carries no runtime dependency on the Controller package: the shape is
 * duplicated structurally (TypeScript has no cross-package interface
 * import without a dependency), not the *values* -- the owner-per-kind
 * mapping stays owned by Controller; the plan contract
 * checks membership and required fields, never a hardcoded
 * owner-per-kind mapping, so this file has nothing further to keep in
 * sync if Controller's own mapping ever changes.
 *
 * #1237 has since landed on `main` (the loop engine, issues
 * #1195/#1194/#1228). The plan record itself is now defined once, in
 * `docs/contracts/advisor-plan.json` (issue #1475), which this package
 * packs at build time and `validateAdvisorPlan()` below validates
 * against; @clossys/launcher validates against the same file. Its blocker
 * kinds are kept equal to `ADVISOR_BLOCKER_KINDS` by a test. A build- or
 * test-time structural comparison against `docs/contracts/loop.json`'s own
 * Blocker remains open, tracked in the #1175 plan-file-contract follow-up.
 */

/** Reuses #1195's own five blocker kinds verbatim, so a later migration to loop.json is a rename, not a redesign. */
export type AdvisorBlockerKind = "missing-input" | "missing-authority" | "failing-evidence" | "unavailable-environment" | "contradiction";

/** Every `AdvisorBlockerKind` value, in the fixed order #1195/#1237 declare them. A test keeps this equal to the plan contract's own `blockerKind` list. */
export const ADVISOR_BLOCKER_KINDS: readonly AdvisorBlockerKind[] = [
  "missing-input",
  "missing-authority",
  "failing-evidence",
  "unavailable-environment",
  "contradiction",
];

export interface AdvisorPlanMandate {
  /** The client's problem, in their own words. */
  problem: string;
  primaryProblemId: string;
  roles: readonly string[];
}

export interface AdvisorPlanNextAction {
  action: string;
  owner: string;
  due?: string;
}

export interface AdvisorPlanDecision {
  at: string;
  recommended: string;
  chosen: string;
  by: string;
  /**
   * On an approving decision, the digest of the exact change the approver
   * was shown (`sha256:` and 64 lowercase hex digits). An approval without it
   * binds nothing.
   */
  subjectDigest?: string;
}

/** A kit Advisor recommends for this plan. `verdict` has one value for now; a later one widens it. */
export interface AdvisorPlanKit {
  id: string;
  source: "preset" | "composed";
  verdict: "recommended";
}

/** Which roles work in one repository, named by its repository inventory id. */
export interface AdvisorPlanStaffing {
  repository: string;
  roles: readonly string[];
}

/** One exact package act: one version and one sha512 integrity value, never a range or a tag. */
export interface AdvisorPlanPackageAct {
  planItem: string;
  /** One of `staffing[].repository`, spelled exactly the same. */
  repository: string;
  act: "install" | "pin-starter";
  name: string;
  /** An exact release version such as `1.2.3`, with no prerelease or build suffix. */
  version: string;
  /** One `sha512-` integrity value. */
  integrity: string;
  placement: "dependencies" | "devDependencies";
}

/** Where the exact versions in `packages` came from. */
export interface AdvisorPlanResolution {
  snapshotDigest: string;
}

/** Who does it, how, and by when. Field-for-field the same as the Controller role's own `NextAction` record -- named distinctly here only to avoid colliding with this file's own plan-level `AdvisorPlanNextAction`, which is a different concept (the one pending step for the whole plan, not one blocker's). */
export interface AdvisorBlockerNextAction {
  who: string;
  how: string;
  /** ISO 8601 date or datetime. Escalation is measured against this. */
  byWhen: string;
}

/**
 * One capability at rest with exactly one next action (#1195: "a
 * blocked capability rests with exactly one next action"). Field-for-
 * field the same shape as Controller's own `Blocker`.
 */
export interface AdvisorPlanBlocker {
  capabilityId: string;
  kind: AdvisorBlockerKind;
  owner: string;
  nextAction: AdvisorBlockerNextAction;
  /** ISO 8601 datetime the blocker was recorded. */
  since: string;
}

export interface AdvisorPlan {
  schemaVersion: 1;
  asOf: string;
  mandate: AdvisorPlanMandate;
  whereWeAre: readonly string[];
  /** `null` once nothing is pending. */
  recommendedNext: AdvisorPlanNextAction | null;
  decisions: readonly AdvisorPlanDecision[];
  blockers: readonly AdvisorPlanBlocker[];
  /** Optional. The kits recommended for this plan. */
  kits?: readonly AdvisorPlanKit[];
  /** Optional. Which roles work in which repository. */
  staffing?: readonly AdvisorPlanStaffing[];
  /** Optional. The exact package acts this plan authorizes; present only with `resolution`. */
  packages?: readonly AdvisorPlanPackageAct[];
  /** Optional. Present exactly when `packages` is. */
  resolution?: AdvisorPlanResolution;
}

function section(title: string, body: readonly string[]): string {
  return [`## ${title}`, "", ...body, ""].join("\n");
}

/**
 * Validates a candidate plan against the shared plan contract,
 * `docs/contracts/advisor-plan.json` (issue #1475; in the public repository, not shipped in this package).
 * This package packs its content into a generated module at build time.
 * That contract is the one definition of this
 * record: @clossys/launcher validates against the same file before it
 * applies an approved plan, so the two packages cannot drift apart. Every
 * object in it is closed, so an unknown field is refused, never ignored.
 *
 * Never throws; returns every finding it can locate rather than stopping at
 * the first one, matching this package's other validators
 * (`validateAdvisorAssessmentInput`, `validateKitProposal`). A schema
 * finding has the rule `advisor-plan-contract`; `path` names the field at
 * fault when there is one (for example `blockers[0].nextAction.byWhen`; a
 * plan that is not an object has none), and `message` says what is wrong
 * with it without echoing its value.
 *
 * Once the schema passes, the contract's code rules R1-R8 run too (issue
 * #1178; see `planRuleViolations()`): staffing and package entries that
 * repeat, and joins between staffing, the mandate and packages. Each of
 * those findings has the rule `advisor-plan-rule-r1` to `-r8` and a `path`.
 */
export function validateAdvisorPlan(value: unknown): AdvisorFinding[] {
  const findings = contractFindings("advisor-plan.json", "advisor-plan-contract", "plan", value);
  if (findings.length > 0) return findings;
  return planRuleViolations(value as AdvisorPlan).map((violation) => ({
    rule: `advisor-plan-rule-${violation.rule.toLowerCase()}`,
    severity: "error",
    message: `plan.${violation.path} ${violation.message} (rule ${violation.rule})`,
    path: violation.path,
  }));
}

/**
 * Pure markdown renderer, deterministic in both content and section
 * order. Never reads or writes a file; the caller decides where the
 * result goes.
 */
export function renderAdvisorStatus(plan: AdvisorPlan): string {
  const mandateLines = [
    plan.mandate.problem,
    "",
    `Staffed roles: ${plan.mandate.roles.length > 0 ? plan.mandate.roles.join(", ") : "none yet"}.`,
  ];
  const whereWeAreLines = plan.whereWeAre.length > 0 ? plan.whereWeAre.map((item) => `- ${item}`) : ["Nothing recorded yet."];
  const recommendedNextLines = plan.recommendedNext
    ? [`${plan.recommendedNext.action} (owner: ${plan.recommendedNext.owner}${plan.recommendedNext.due ? `, due ${plan.recommendedNext.due}` : ""})`]
    : ["Nothing pending."];
  const decisionLines =
    plan.decisions.length > 0
      ? plan.decisions.map((item) => `- ${item.at} — recommended: ${item.recommended}; chosen: ${item.chosen} (by ${item.by})`)
      : ["None recorded yet."];
  const blockerLines =
    plan.blockers.length > 0
      ? plan.blockers.map(
          (item) =>
            `- [${item.kind}] ${item.capabilityId} — next: ${item.nextAction.who} ${item.nextAction.how} by ${item.nextAction.byWhen} (owner: ${item.owner}, since ${item.since})`,
        )
      : ["None."];

  return [
    "# Advisor status",
    "",
    section("Mandate", mandateLines),
    section("Where we are", whereWeAreLines),
    section("Recommended next", recommendedNextLines),
    section("Decisions", decisionLines),
    section("Blockers", blockerLines),
  ].join("\n");
}
