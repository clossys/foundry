import type { CapabilityCatalogue } from "./capability-catalogue.js";
import type { ComposedRole, ComposeKitResult } from "./composition.js";
import { ENGAGEMENT_CONTEXT_FIELD_IDS } from "./context.js";
import type { EngagementContext, EngagementContextField, EngagementContextFieldId } from "./context.js";
import { applyContextChoice } from "./context-questions.js";
import { contractFindings } from "./plan-contract.js";
import type { AdvisorFinding } from "./types.js";

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
   * A contract-shaped snapshot of the hub's `clossys/advisor/context.json`
   * (issue #1173 follow-up): how a role running in a product repository,
   * with no hub checkout, reads what the founder already answered. Exactly
   * one entry per field id, in the fixed field order, and a known value is
   * always one of that field's fixed choice ids. Refreshed by re-applying
   * the plan; absent means every field is unknown — read it through
   * {@link contextFromBrief}, never directly.
   */
  context?: EngagementContext;
}

/**
 * Validates a candidate brief against the shared brief contract,
 * `docs/contracts/engagement-brief.json` with its `context` snapshot's
 * `engagement-context.json` (issue #1475; in the public repository, not shipped in this package).
 * This package packs their content into a generated module at build
 * time. @clossys/launcher validates against the same files where it writes
 * `clossys/brief.json`, so a brief this accepts is a brief Launcher accepts.
 * Unknown fields are refused, and a known context value must be one of that
 * field's fixed choice ids. Never throws; every finding has the rule
 * `engagement-brief-contract`, and no message echoes a value from the brief,
 * which can carry founder text.
 */
export function validateEngagementBrief(value: unknown): AdvisorFinding[] {
  return contractFindings("engagement-brief.json", "engagement-brief-contract", "brief", value);
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
  /**
   * The hub's engagement context, snapshotted into the brief when supplied:
   * one entry per field id in the fixed field order, a field the context
   * does not carry written as unknown. Throws when a field id is not a
   * context field id or appears twice, or when a known field's value is not
   * one of that field's fixed choice ids (`applyContextChoice()` returns
   * `known` for it). The brief is committed in every staffed repository,
   * which may be public, so no founder text — prose or a slugified form of
   * it — ever goes in.
   */
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
    ...(context === undefined ? {} : { context: snapshotContext(context) }),
  };
}

/**
 * The only writer of a brief's snapshot. A known value is accepted only when
 * `applyContextChoice()` says it is one of that field's fixed choice ids: the
 * vocabulary is closed, so a shape check (a lowercase slug) would still let
 * a founder's sentence through once a caller slugified it.
 */
function snapshotContext(context: EngagementContext): EngagementContext {
  const ids = new Set<string>(ENGAGEMENT_CONTEXT_FIELD_IDS);
  const byId = new Map<EngagementContextFieldId, EngagementContextField>();
  for (const field of context.fields) {
    if (!ids.has(field.id)) {
      throw new TypeError(`engagement context field ${JSON.stringify(field.id)} is not a context field id (${ENGAGEMENT_CONTEXT_FIELD_IDS.join(", ")})`);
    }
    if (byId.has(field.id)) {
      throw new TypeError(`engagement context field "${field.id}" appears more than once; the contract allows exactly one entry per field id`);
    }
    byId.set(field.id, snapshotField(field));
  }
  return { schemaVersion: 1, fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id) => byId.get(id) ?? { id, state: "unknown" }) };
}

function snapshotField(field: EngagementContextField): EngagementContextField {
  if (field.state === "unknown") return { id: field.id, state: "unknown" };
  if (field.state !== "known" || typeof field.value !== "string" || applyContextChoice(field.id, field.value).kind !== "known") {
    // The value is deliberately not echoed: it may be exactly the founder text this check keeps out.
    throw new TypeError(`engagement context field "${field.id}" must be unknown, or known with one of that field's fixed choice ids -- never freeform or slugified text, because the brief is committed in every staffed repository`);
  }
  return { id: field.id, state: "known", value: field.value };
}

/**
 * The engagement context a role reads before presenting any intake card
 * (issue #1173). Always one entry per context field id, in the fixed field
 * order: a brief written without a snapshot, or a snapshot missing a field,
 * yields that field unknown — never an invented answer — so the role sends
 * the founder to Advisor's own context card rather than asking under its
 * own. Returns a copy; the brief's own snapshot is never handed out.
 */
export function contextFromBrief(brief: Pick<EngagementBrief, "context">): EngagementContext {
  // The brief is committed JSON in a product repository (`clossys/brief.json`),
  // so a person can hand-edit it, and snapshotContext()'s rules apply only
  // when the brief is written, not when it is read back. An entry that
  // fails those same rules here -- an invalid or missing value, extra keys,
  // or an id that appears more than once -- is read as unknown rather than
  // trusted or thrown. That is safe: unknown is exactly what a field the
  // brief never carries reads as, and it sends the founder back to
  // Advisor's own context card instead of an invented answer. A non-array
  // `fields` is treated the same way, as if it carried no entries at all.
  const rawFields: readonly unknown[] = Array.isArray(brief.context?.fields) ? brief.context.fields : [];
  const occurrences = new Map<string, number>();
  for (const entry of rawFields) {
    const id = typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined;
    if (typeof id === "string") occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  return {
    schemaVersion: 1,
    fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id): EngagementContextField => {
      if (occurrences.get(id) !== 1) return { id, state: "unknown" };
      const entry = rawFields.find((candidate) => typeof candidate === "object" && candidate !== null && (candidate as { id?: unknown }).id === id) as
        | { state?: unknown; value?: unknown }
        | undefined;
      if (entry?.state === "known" && typeof entry.value === "string" && applyContextChoice(id, entry.value).kind === "known") {
        return { id, state: "known", value: entry.value };
      }
      return { id, state: "unknown" };
    }),
  };
}
