import type { CapabilityCatalogue } from "./capability-catalogue.js";
import type { ComposedRole, ComposeKitResult } from "./composition.js";
import { ENGAGEMENT_CONTEXT_FIELD_IDS } from "./context.js";
import type { EngagementContext } from "./context.js";

/**
 * The kit output shape (issue #1176, owner redirect 2026-09-22): the
 * client's problem, which roles a composed kit staffs and why, what the
 * client gets, and how the roles hand off to each other. Matches
 * this repository's engagement-brief contract (issue #1176). This is a wave-1 type-and-transform
 * export only — writing it to `clossys/brief.json` in each staffed
 * repository is wave 2 (issues #1175, #1178); Advisor does not write files.
 */
export interface EngagementBriefRole {
  role: string;
  why: string;
  goal: { metric: string; direction: string };
  inputsFrom: readonly string[];
  outputsTo: readonly string[];
}

export interface EngagementBrief {
  schemaVersion: 1;
  /** The client's problem, in their own words. */
  problem: string;
  roles: readonly EngagementBriefRole[];
  /** Handoff order: a producer role always precedes the consumer whose need it satisfies. */
  sequence: readonly string[];
  /** What the client gets, one line per staffed role, grounded in that role's own boundary.owns. */
  deliverables: readonly string[];
  /**
   * A verbatim snapshot of the hub's `clossys/advisor/context.json` (issue
   * #1173 follow-up): how a role running in a product repository, with no
   * hub checkout, reads what the founder already answered. Refreshed by
   * re-applying the plan; absent means every field is unknown — read it
   * through {@link contextFromBrief}, never directly.
   */
  context?: EngagementContext;
}

function toBriefRole(role: ComposedRole): EngagementBriefRole {
  return { role: role.role, why: role.why, goal: role.goal, inputsFrom: role.inputsFrom, outputsTo: role.outputsTo };
}

/**
 * Builds the client-facing brief from a `composed` {@link ComposeKitResult}.
 * Deliverables are the composed roles' own `boundary.owns` text from the
 * catalogue — never invented copy. Throws only on a programmer error
 * (an indeterminate composition should be handled by the caller before
 * reaching for a brief; there is nothing to report otherwise).
 */
export function toEngagementBrief({
  problem,
  composed,
  catalogue,
  context,
}: {
  problem: string;
  composed: Extract<ComposeKitResult, { state: "composed" }>;
  catalogue: CapabilityCatalogue;
  /** The hub's engagement context, copied verbatim into the brief when supplied. */
  context?: EngagementContext;
}): EngagementBrief {
  const byRole = new Map(catalogue.roles.map((role) => [role.role, role]));
  const deliverables = composed.roles
    .map((role) => byRole.get(role.role)?.boundary.owns)
    .filter((owns): owns is string => typeof owns === "string" && owns.trim() !== "");

  return {
    schemaVersion: 1,
    problem,
    roles: composed.roles.map(toBriefRole),
    sequence: composed.sequence,
    deliverables,
    ...(context === undefined ? {} : { context: { schemaVersion: 1, fields: context.fields.map((field) => ({ ...field })) } }),
  };
}

/**
 * The engagement context a role reads before presenting any intake card
 * (issue #1173). A brief written without a context snapshot yields every
 * field unknown — never an invented answer — so the role sends the founder
 * to Advisor's own context card rather than asking under its own.
 */
export function contextFromBrief(brief: Pick<EngagementBrief, "context">): EngagementContext {
  if (brief.context !== undefined) return brief.context;
  return { schemaVersion: 1, fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id) => ({ id, state: "unknown" as const })) };
}
