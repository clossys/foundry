/**
 * The task-record check.
 *
 * A task record is the link between a proposed change and the tracked work
 * item that asked for it. The check asks one question — does this change
 * name a work item, in a shape that resolves to a real tracked item — and it
 * asks it about caller-supplied observations, never by reaching for a
 * tracker itself.
 *
 * THREE THINGS THIS SEPARATES THAT ARE EASY TO COLLAPSE
 * -----------------------------------------------------
 * 1. *No reference was given.* That is a real finding about the change:
 *    someone opened a change with no stated reason. `violated`.
 * 2. *A reference was given and does not resolve.* Also `violated` — but
 *    only when the caller actually looked and actually got an answer.
 * 3. *A reference was given and could not be looked up.* A tracker that
 *    returned a permission error, a reference pointing outside the scope the
 *    caller's credential can read, a lookup that was never attempted:
 *    `indeterminate`. A credential-scoped tracker commonly answers
 *    "not found" for an item that exists but is not visible, and treating
 *    that as proof of absence would fail changes for a reason that is about
 *    the credential rather than the change.
 *
 * STRUCTURAL EXEMPTIONS ARE PART OF THE CHECK, NOT AN ESCAPE HATCH
 * -----------------------------------------------------------------
 * Automated changes — a dependency bot's version bump, a release-automation
 * branch — have no work item and never will, because no person asked for
 * them individually. A check that fails them teaches its consumers to route
 * around it, which costs more than the check earns. So exemptions are
 * modelled as first-class policy: the consuming repository declares, as
 * data, which authors, branch prefixes, and labels are exempt, and an
 * exemption that fires is reported by name in the result rather than
 * disappearing into a silent pass. Nothing here has a default exemption; an
 * exemption this package invented would be an exemption no consumer chose.
 *
 * Zero I/O. Pure function of already-collected observations.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@vespeneventures/governance/gates";
import type { GateResult } from "@vespeneventures/governance/gates";
import type { CheckFinding } from "./types.js";

/** How a caller's attempt to resolve a referenced work item ended. */
export type TaskItemLookupOutcome =
  /** The item was read and is a tracked work item. */
  | "resolved"
  /** The item was read and is not a work item at all (e.g. it is another proposed change). */
  | "resolved-wrong-kind"
  /** The tracker answered, and the answer was "no such item, or not visible to this credential". */
  | "not-visible"
  /** The tracker could not be reached, or answered with an error. */
  | "unavailable"
  /** No lookup was made. */
  | "not-attempted";

/** What the caller found out about the referenced item, if anything. */
export interface TaskItemObservation {
  readonly outcome: TaskItemLookupOutcome;
  /** A human-facing title, when the tracker supplied one. Purely descriptive. */
  readonly title?: string;
  /** Free-text detail from the tracker, for the report. */
  readonly detail?: string;
}

/** Everything observed about one proposed change. All caller-supplied; none discovered here. */
export interface TaskRecordObservation {
  /** What triggered this run, in the caller's own vocabulary. */
  readonly eventKind: string;
  /** The change's description text, which is where a work-item reference is looked for. */
  readonly description: string;
  /** Opaque author identifier. */
  readonly authorId: string;
  /** The source branch name. */
  readonly headRef: string;
  /** Labels attached to the change. */
  readonly labels: readonly string[];
  /**
   * The scope the caller's tracker credential can read, opaque and compared
   * only for equality (case-insensitively). A reference naming a different
   * scope is `indeterminate`, never a finding.
   */
  readonly trackerScope: string;
  /** The caller's lookup result for whatever reference was extracted, if it made one. */
  readonly item?: TaskItemObservation;
}

/** The consuming repository's own requirements. Every field is required; nothing is defaulted. */
export interface TaskRecordPolicy {
  /** Event kinds this check is meaningful for. A run outside them is `indeterminate`, never a pass. */
  readonly applicableEventKinds: readonly string[];
  /** Literal labels whose presence exempts a change. May be empty. */
  readonly exemptLabels: readonly string[];
  /** Author-identifier suffixes that exempt a change (an automation marker). May be empty. */
  readonly exemptAuthorSuffixes: readonly string[];
  /** Branch-name prefixes that exempt a change. May be empty. */
  readonly exemptHeadRefPrefixes: readonly string[];
  /**
   * The literal field labels a work-item reference may be introduced by, e.g.
   * `["Work item"]`. Matched case-insensitively, with optional surrounding
   * emphasis markers, and escaped before use — a caller's label is data, and
   * data spliced unescaped into a pattern is a pattern the caller did not
   * write.
   */
  readonly recordLabels: readonly string[];
  /**
   * Whether the referenced item must have been confirmed to exist. `false`
   * checks the reference's shape only, and says so in the result rather than
   * implying more than it checked.
   */
  readonly requireResolvedItem: boolean;
}

/** Every reason this check can decline to answer. */
export const taskRecordReasons = createGateReasons([
  "no-observation-supplied",
  "no-policy-supplied",
  "policy-invalid",
  "not-applicable-event",
  "item-lookup-not-attempted",
  "item-lookup-unavailable",
  "item-not-visible",
  "item-outside-tracker-scope",
] as const);

export type TaskRecordReason = (typeof taskRecordReasons.reasons)[number];

/** One reportable problem with a change's task record. */
export interface TaskRecordFinding extends CheckFinding {
  readonly rule: "task-record-missing" | "task-record-unparseable" | "task-record-wrong-kind";
}

/** A work-item reference pulled out of a change description. */
export interface ParsedTaskReference {
  /** The reference exactly as written. */
  readonly raw: string;
  /** The tracker scope it names, defaulting to the observation's own scope for a bare number. */
  readonly scope: string;
  /** The item's number within that scope. */
  readonly number: string;
}

function finding(rule: TaskRecordFinding["rule"], path: string, message: string): TaskRecordFinding {
  return { rule, severity: "error", path, message };
}

/** Escapes a caller-supplied literal so it can appear safely inside a pattern. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pulls the first work-item reference out of a change description.
 *
 * Accepts `Work item: #12`, `**Work item:** #12`, and `Work item #12`, for
 * whichever labels the policy declared. Trailing sentence punctuation is
 * stripped, because a reference at the end of a sentence is still a
 * reference and failing it teaches nothing.
 */
export function extractTaskReferenceText(description: string, recordLabels: readonly string[]): string | undefined {
  if (typeof description !== "string") return undefined;
  for (const label of recordLabels) {
    const pattern = new RegExp(`\\*{0,2}${escapeLiteral(label)}:?\\*{0,2}\\s*(\\S+)`, "i");
    const match = pattern.exec(description);
    const captured = match?.[1];
    if (captured !== undefined) {
      const trimmed = captured.replace(/[.,;:)\]]+$/, "");
      if (trimmed !== "") return trimmed;
    }
  }
  return undefined;
}

/**
 * Parses a work-item reference into a scope and a number.
 *
 * Three accepted shapes: a tracker URL ending `/<scope-owner>/<scope-name>/
 * issues/<n>`, a qualified `<owner>/<name>#<n>`, and a bare `#<n>` or `<n>`
 * resolved against the observation's own scope. The URL form deliberately
 * does not pin a host: this package endorses no tracker vendor, and a host
 * literal here would be exactly the vendor-shaped knowledge the sibling
 * packages' charters refuse.
 */
export function parseTaskReference(raw: string, defaultScope: string): ParsedTaskReference | undefined {
  const match =
    /^(?:https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)|([^/#\s]+)\/([^/#\s]+)#(\d+)|#?(\d+))$/.exec(raw);
  if (!match) return undefined;
  const [, urlOwner, urlName, urlNumber, shortOwner, shortName, shortNumber, bareNumber] = match;
  const scope =
    urlOwner !== undefined && urlName !== undefined
      ? `${urlOwner}/${urlName}`
      : shortOwner !== undefined && shortName !== undefined
        ? `${shortOwner}/${shortName}`
        : defaultScope;
  const number = urlNumber ?? shortNumber ?? bareNumber;
  if (number === undefined || scope.trim() === "") return undefined;
  return { raw, scope, number };
}

/** Why a change was exempt, when it was. Reported so an exemption is never invisible. */
export interface TaskRecordExemption {
  readonly kind: "label" | "author" | "head-ref";
  readonly matched: string;
}

/** What the check concluded, alongside the verdict. */
export interface TaskRecordReport {
  readonly result: GateResult<TaskRecordFinding, TaskRecordReason>;
  /** Set when a declared structural exemption fired. */
  readonly exemption?: TaskRecordExemption;
  /** The reference that was parsed out, when one was. */
  readonly reference?: ParsedTaskReference;
}

function validatePolicy(policy: TaskRecordPolicy): string | undefined {
  if (policy.applicableEventKinds.length === 0) {
    return "applicableEventKinds is empty, so this check could never apply to anything.";
  }
  const lists: readonly (readonly [string, readonly string[]])[] = [
    ["applicableEventKinds", policy.applicableEventKinds],
    ["exemptLabels", policy.exemptLabels],
    ["exemptAuthorSuffixes", policy.exemptAuthorSuffixes],
    ["exemptHeadRefPrefixes", policy.exemptHeadRefPrefixes],
    ["recordLabels", policy.recordLabels],
  ];
  for (const [name, values] of lists) {
    if (!Array.isArray(values)) return `${name} must be an array.`;
    for (const value of values) {
      if (typeof value !== "string" || value.trim() === "") {
        // An empty exemption entry matches every author and every branch. It
        // reads as an oversight and behaves as a repository-wide waiver.
        return `${name} contains an empty entry, which would match everything.`;
      }
    }
  }
  if (policy.recordLabels.length === 0) {
    return "recordLabels is empty, so no reference could ever be recognised.";
  }
  if (typeof policy.requireResolvedItem !== "boolean") {
    return "requireResolvedItem must be an explicit boolean.";
  }
  return undefined;
}

function findExemption(observation: TaskRecordObservation, policy: TaskRecordPolicy): TaskRecordExemption | undefined {
  const label = policy.exemptLabels.find((candidate) => observation.labels.includes(candidate));
  if (label !== undefined) return { kind: "label", matched: label };
  const suffix = policy.exemptAuthorSuffixes.find((candidate) => observation.authorId.endsWith(candidate));
  if (suffix !== undefined) return { kind: "author", matched: suffix };
  const prefix = policy.exemptHeadRefPrefixes.find((candidate) => observation.headRef.startsWith(candidate));
  if (prefix !== undefined) return { kind: "head-ref", matched: prefix };
  return undefined;
}

/** Evaluates one change's task record against the consuming repository's policy. */
export function checkTaskRecord(
  observation: TaskRecordObservation | undefined,
  policy: TaskRecordPolicy | undefined,
): TaskRecordReport {
  if (observation === undefined) {
    return {
      result: taskRecordReasons.indeterminate(
        "no-observation-supplied",
        "No change observation was supplied. Absence of a change is not a change with a valid record.",
      ),
    };
  }
  if (policy === undefined) {
    return {
      result: taskRecordReasons.indeterminate(
        "no-policy-supplied",
        "No task-record policy was supplied. This package holds no default requirements, and will not invent one.",
      ),
    };
  }
  const policyProblem = validatePolicy(policy);
  if (policyProblem !== undefined) {
    return { result: taskRecordReasons.indeterminate("policy-invalid", policyProblem) };
  }
  if (!policy.applicableEventKinds.includes(observation.eventKind)) {
    return {
      result: taskRecordReasons.indeterminate(
        "not-applicable-event",
        `This check applies to ${policy.applicableEventKinds.join(", ")} and this run observed ` +
          `${JSON.stringify(observation.eventKind)}. Nothing was evaluated, so nothing passed.`,
      ),
    };
  }

  const exemption = findExemption(observation, policy);
  if (exemption !== undefined) {
    // One thing was evaluated and held: the declared exemption rule itself.
    // It is named in the report, so this can never read as an ordinary pass.
    return { result: gateSatisfied(1), exemption };
  }

  const raw = extractTaskReferenceText(observation.description, policy.recordLabels);
  if (raw === undefined) {
    return {
      result: gateViolated([
        finding(
          "task-record-missing",
          "description",
          `No ${policy.recordLabels.map((label) => `"${label}:"`).join(" or ")} reference appears in the change description.`,
        ),
      ]),
    };
  }

  const reference = parseTaskReference(raw, observation.trackerScope);
  if (reference === undefined) {
    return {
      result: gateViolated([
        finding(
          "task-record-unparseable",
          "description",
          `${JSON.stringify(raw)} is not a recognised work-item reference (#12, owner/name#12, or a tracker URL).`,
        ),
      ]),
    };
  }

  if (reference.scope.toLowerCase() !== observation.trackerScope.toLowerCase()) {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-outside-tracker-scope",
        `${reference.scope}#${reference.number} is outside ${observation.trackerScope}, which is the only scope this ` +
          "run's credential is stated to read. The reference's shape is valid; whether the item exists is unknown.",
      ),
    };
  }

  if (!policy.requireResolvedItem) {
    // One thing was evaluated: the reference's shape. The report says so; it
    // never implies the item was confirmed to exist.
    return { result: gateSatisfied(1), reference };
  }

  const item = observation.item;
  if (item === undefined || item.outcome === "not-attempted") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-lookup-not-attempted",
        `The policy requires ${reference.scope}#${reference.number} to resolve, and no lookup was attempted.`,
      ),
    };
  }
  if (item.outcome === "unavailable") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-lookup-unavailable",
        `The tracker could not answer for ${reference.scope}#${reference.number}` +
          (item.detail === undefined ? "." : `: ${item.detail}`),
      ),
    };
  }
  if (item.outcome === "not-visible") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-not-visible",
        `${reference.scope}#${reference.number} was not visible to this run's credential. A scoped credential answers ` +
          "the same way for an item that does not exist and an item it may not read, so this is not treated as proof " +
          "of absence.",
      ),
    };
  }
  if (item.outcome === "resolved-wrong-kind") {
    return {
      reference,
      result: gateViolated([
        finding(
          "task-record-wrong-kind",
          "description",
          `${reference.scope}#${reference.number} resolved, but is not a tracked work item` +
            (item.detail === undefined ? "." : `: ${item.detail}`),
        ),
      ]),
    };
  }

  // Two things were evaluated: the reference's shape, and the item it names.
  return { result: gateSatisfied(2), reference };
}
