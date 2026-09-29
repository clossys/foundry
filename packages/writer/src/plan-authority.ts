// Whether the bytes of an Advisor plan record authorize copy a delegate
// approved on production (issue #1586). The plan's optional
// `delegatedCopyApproval` declares that grant, and an approval binds the plan
// it grants for: this reads the field only through a latest decision that
// names the plan's own canonical digest. Two files define what is read, both
// in the public repository, not shipped in this package: the plan contract,
// docs/contracts/advisor-plan.json (see its DELEGATED COPY APPROVAL and
// APPROVAL BINDING sections), and the digest definition,
// docs/contracts/advisor-plan-digest.md.
//
// It is a pure function of the bytes: it reads no file, keeps nothing between
// calls and never looks at the clock, because a plan approval has no expiry
// of its own. It takes bytes, not a parsed object, because the digest is
// defined only over a plan that was read strictly, and an object a caller
// built can carry getters or proxies that answer validation, the digest and
// the scope check differently. What it does not prove is who wrote the
// decision, or where the bytes came from: see this package's README.

import { readContractDocument } from "./generated/contract-schema.generated.js";
import { planViolations } from "./plan-contract.js";
import { digestOfValidPlan } from "./plan-digest.js";
import type { PlanDocument } from "./plan-rules.js";

/** Why a plan's bytes did not authorize delegate-approved copy on production. */
export type PlanDelegateCopyRefusal =
  /** The argument is not a `Uint8Array` (a Node `Buffer` is one). */
  | "plan-not-bytes"
  /** The bytes are not strict JSON: not valid UTF-8, a byte order mark, a syntax error, or a key repeated at any depth. */
  | "plan-unreadable"
  /** The plan does not validate against the plan contract, schema and code rules. */
  | "plan-invalid"
  /** The plan does not declare `delegatedCopyApproval`. */
  | "delegated-copy-approval-absent"
  | "no-decisions"
  /** Defence in depth: a valid plan's decision times always parse. */
  | "decision-time-unparseable"
  /** A decision at the latest instant has not chosen "approved". */
  | "latest-decision-not-approved"
  /** A decision at the latest instant is an approval that names no sha256 digest. */
  | "approval-without-subject-digest"
  /** Decisions at the latest instant name different digests. */
  | "latest-decisions-disagree"
  /** The latest approval names a digest other than this plan's own. */
  | "subject-digest-mismatch";

/** What `planDelegateCopyAuthority()` decided. Frozen, and carries no plan text. */
export type PlanDelegateCopyAuthority =
  | {
      readonly authorized: true;
      /** The plan's canonical digest, which the latest approval names. */
      readonly planDigest: string;
      /** The plan's `delegatedCopyApproval.scopes`, copied; absent when the plan declares none, which covers every entry. */
      readonly scopes?: readonly string[];
    }
  | {
      readonly authorized: false;
      readonly refusal: PlanDelegateCopyRefusal;
      /** Only with "plan-invalid": each violation's rule and position, never a value. */
      readonly violations?: readonly { readonly rule: string; readonly path: string }[];
    };

const SUBJECT_DIGEST = /^sha256:[0-9a-f]{64}$/;

function refuse(refusal: PlanDelegateCopyRefusal, violations?: readonly { readonly rule: string; readonly path: string }[]): PlanDelegateCopyAuthority {
  if (violations === undefined) return Object.freeze({ authorized: false, refusal });
  return Object.freeze({ authorized: false, refusal, violations: Object.freeze(violations.map((violation) => Object.freeze({ rule: violation.rule, path: violation.path }))) });
}

/**
 * The positions of the decisions made at the latest instant, by `at` and
 * never by array position, in array order. Times are compared as instants
 * (`Date.parse`), so `2026-09-21T00:00:00Z` and `2026-09-21T02:00:00+02:00`
 * tie. Null when there are no decisions, or when any `at` does not parse to a
 * finite time, because then time cannot say which is latest. Exported for
 * tests, not from the package entry point.
 */
export function latestDecisionIndices(decisions: readonly { readonly at: string }[]): number[] | null {
  if (decisions.length === 0) return null;
  const times = decisions.map((decision) => Date.parse(decision.at));
  if (!times.every(Number.isFinite)) return null;
  // A reduce, not Math.max(...times): spreading a very long list into arguments throws a RangeError.
  const latest = times.reduce((highest, time) => (time > highest ? time : highest), Number.NEGATIVE_INFINITY);
  const indices: number[] = [];
  times.forEach((time, index) => {
    if (time === latest) indices.push(index);
  });
  return indices;
}

/** True for a real `Uint8Array` (a Node `Buffer` is one), never a `DataView`, another typed array or a proxy. */
export function isPlanBytes(value: unknown): value is Uint8Array {
  try {
    return value instanceof Uint8Array && ArrayBuffer.isView(value);
  } catch {
    return false; // instanceof throws on a revoked proxy
  }
}

/**
 * Whether the bytes of a plan record authorize delegate-approved copy on
 * production. Checks run in this order and the first that fails refuses:
 *
 * 1. the argument is a `Uint8Array` (`plan-not-bytes`);
 * 2. the bytes are strict JSON (`plan-unreadable`);
 * 3. the plan validates against the plan contract, R1-R12 included
 *    (`plan-invalid`, with each violation's rule and position);
 * 4. the plan declares `delegatedCopyApproval` (`delegated-copy-approval-absent`);
 * 5-9. the plan's latest decision, found by time and never by array
 *    position, has chosen "approved" and names one sha256 `subjectDigest`.
 *    When several decisions share the latest instant, every one is examined:
 *    the outcome does not depend on their order;
 * 10. that digest equals the plan's own canonical digest, computed here from
 *    the same bytes (`subject-digest-mismatch`). The digest covers
 *    `delegatedCopyApproval`, so a declaration added, removed or edited after
 *    the approval leaves the plan unapproved for this purpose.
 *
 * Never throws for a bad argument and never echoes plan text. The result and
 * everything in it is frozen, and copied from the bytes, which are copied
 * before they are read.
 */
export function planDelegateCopyAuthority(planBytes: Uint8Array | unknown): PlanDelegateCopyAuthority {
  if (!isPlanBytes(planBytes)) return refuse("plan-not-bytes");
  // A copy, so nothing the caller does to its buffer during or after this call changes what is read.
  const bytes = new Uint8Array(planBytes);

  let value: unknown;
  try {
    value = readContractDocument(bytes);
  } catch {
    return refuse("plan-unreadable");
  }

  const violations = planViolations(value);
  if (violations.length > 0) return refuse("plan-invalid", violations);
  const plan = value as PlanDocument;

  if (!Object.hasOwn(plan, "delegatedCopyApproval")) return refuse("delegated-copy-approval-absent");
  if (plan.decisions.length === 0) return refuse("no-decisions");

  const latestIndices = latestDecisionIndices(plan.decisions);
  if (latestIndices === null) return refuse("decision-time-unparseable");
  const latest = latestIndices.map((index) => plan.decisions[index]!);
  if (latest.some((decision) => decision.chosen !== "approved")) return refuse("latest-decision-not-approved");

  const subjects = latest.map((decision) => (Object.hasOwn(decision, "subjectDigest") ? decision.subjectDigest : undefined));
  if (subjects.some((subject) => typeof subject !== "string" || !SUBJECT_DIGEST.test(subject))) return refuse("approval-without-subject-digest");
  if (subjects.some((subject) => subject !== subjects[0])) return refuse("latest-decisions-disagree");

  let digest: string;
  try {
    digest = digestOfValidPlan(plan as unknown as Readonly<Record<string, unknown>>);
  } catch {
    return refuse("plan-invalid", []);
  }
  if (subjects[0] !== digest) return refuse("subject-digest-mismatch");

  const declaration = plan.delegatedCopyApproval!;
  if (!Object.hasOwn(declaration, "scopes") || declaration.scopes === undefined) return Object.freeze({ authorized: true, planDigest: digest });
  return Object.freeze({ authorized: true, planDigest: digest, scopes: Object.freeze([...declaration.scopes]) });
}
