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
 */

/** Reuses #1195's own five blocker kinds verbatim, so a later migration to loop.json is a rename, not a redesign. */
export type AdvisorBlockerKind = "missing-input" | "missing-authority" | "failing-evidence" | "unavailable-environment" | "contradiction";

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

export interface AdvisorPlanBlocker {
  kind: AdvisorBlockerKind;
  description: string;
  owner: string;
  dueDate?: string;
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
      ? plan.blockers.map((item) => `- [${item.kind}] ${item.description} (owner: ${item.owner}${item.dueDate ? `, due ${item.dueDate}` : ""})`)
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
