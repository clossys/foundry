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
 * issue #1237 in Controller's own loop module (its shared contract is
 * `docs/contracts/loop.json`, not yet in this repository's tree) --
 * `capabilityId`, `kind`, `owner`, `nextAction: { who, how, byWhen }`,
 * `since` -- so `clossys/advisor/plan.json`'s blocker records and
 * `clossys/<role>/loop.json`'s are the same shape read two ways, never
 * two shapes that merely share five kind strings. This package still
 * carries no runtime dependency on the Controller package: the shape is
 * duplicated structurally (TypeScript has no cross-package interface
 * import without a dependency), not the *values* -- the owner-per-kind
 * mapping stays owned by Controller; `validateAdvisorPlan()` below
 * checks membership and required fields, never a hardcoded
 * owner-per-kind mapping, so this file has nothing further to keep in
 * sync if Controller's own mapping ever changes.
 *
 * `docs/contracts/loop.json` is not yet in this repository's `main` (it
 * ships with #1237, still open) or on this branch, so the check below
 * cannot read it directly and instead checks the shape #1237's PR
 * verified against the real file. Once #1237 lands, this should be
 * replaced with a direct read of `docs/contracts/loop.json` -- tracked
 * in the #1175 plan-file-contract follow-up.
 */

/** Reuses #1195's own five blocker kinds verbatim, so a later migration to loop.json is a rename, not a redesign. */
export type AdvisorBlockerKind = "missing-input" | "missing-authority" | "failing-evidence" | "unavailable-environment" | "contradiction";

/** Every `AdvisorBlockerKind` value, in the fixed order #1195/#1237 declare them. Kept here so validation never hardcodes the list twice. */
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
}

function section(title: string, body: readonly string[]): string {
  return [`## ${title}`, "", ...body, ""].join("\n");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Structural validation for an `AdvisorPlan`, most of all its
 * `blockers[]` -- required fields present, `kind` a real
 * `AdvisorBlockerKind`, `nextAction` carrying all three of `who` /
 * `how` / `byWhen`. Never throws; returns every finding it can locate
 * rather than stopping at the first one, matching this package's other
 * validators (`validateAdvisorAssessmentInput`, `validateKitProposal`).
 */
export function validateAdvisorPlan(value: unknown): AdvisorFinding[] {
  const findings: AdvisorFinding[] = [];
  if (typeof value !== "object" || value === null) {
    return [{ rule: "plan-not-an-object", severity: "error", message: "plan must be an object" }];
  }
  const plan = value as Partial<AdvisorPlan>;

  if (plan.schemaVersion !== 1) {
    findings.push({ rule: "plan-schema-version", severity: "error", message: `schemaVersion must be 1, got ${JSON.stringify(plan.schemaVersion)}`, path: "schemaVersion" });
  }
  if (!isNonEmptyString(plan.asOf)) {
    findings.push({ rule: "plan-as-of", severity: "error", message: "asOf must be a nonempty ISO 8601 datetime", path: "asOf" });
  }
  if (!plan.mandate || typeof plan.mandate !== "object") {
    findings.push({ rule: "plan-mandate", severity: "error", message: "mandate is required", path: "mandate" });
  }
  if (!Array.isArray(plan.whereWeAre)) {
    findings.push({ rule: "plan-where-we-are", severity: "error", message: "whereWeAre must be an array", path: "whereWeAre" });
  }
  if (!Array.isArray(plan.decisions)) {
    findings.push({ rule: "plan-decisions", severity: "error", message: "decisions must be an array", path: "decisions" });
  }
  if (!Array.isArray(plan.blockers)) {
    findings.push({ rule: "plan-blockers", severity: "error", message: "blockers must be an array", path: "blockers" });
    return findings;
  }

  plan.blockers.forEach((blocker, index) => {
    const path = `blockers[${index}]`;
    if (typeof blocker !== "object" || blocker === null) {
      findings.push({ rule: "blocker-not-an-object", severity: "error", message: "each blocker must be an object", path });
      return;
    }
    const record = blocker as Partial<AdvisorPlanBlocker>;
    if (!isNonEmptyString(record.capabilityId)) {
      findings.push({ rule: "blocker-capability-id", severity: "error", message: "capabilityId is required", path: `${path}.capabilityId` });
    }
    if (!ADVISOR_BLOCKER_KINDS.includes(record.kind as AdvisorBlockerKind)) {
      findings.push({ rule: "blocker-kind", severity: "error", message: `kind must be one of ${ADVISOR_BLOCKER_KINDS.join(", ")}, got ${JSON.stringify(record.kind)}`, path: `${path}.kind` });
    }
    if (!isNonEmptyString(record.owner)) {
      findings.push({ rule: "blocker-owner", severity: "error", message: "owner is required", path: `${path}.owner` });
    }
    if (!isNonEmptyString(record.since)) {
      findings.push({ rule: "blocker-since", severity: "error", message: "since is required", path: `${path}.since` });
    }
    const nextAction = record.nextAction;
    if (typeof nextAction !== "object" || nextAction === null) {
      findings.push({ rule: "blocker-next-action", severity: "error", message: "nextAction is required", path: `${path}.nextAction` });
    } else {
      const action = nextAction as Partial<AdvisorBlockerNextAction>;
      if (!isNonEmptyString(action.who)) findings.push({ rule: "blocker-next-action-who", severity: "error", message: "nextAction.who is required", path: `${path}.nextAction.who` });
      if (!isNonEmptyString(action.how)) findings.push({ rule: "blocker-next-action-how", severity: "error", message: "nextAction.how is required", path: `${path}.nextAction.how` });
      if (!isNonEmptyString(action.byWhen)) findings.push({ rule: "blocker-next-action-by-when", severity: "error", message: "nextAction.byWhen is required", path: `${path}.nextAction.byWhen` });
    }
  });

  return findings;
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
