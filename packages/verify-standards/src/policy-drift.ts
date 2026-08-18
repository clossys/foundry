/**
 * The policy-drift check.
 *
 * Drift is the gap between what a repository *says* it enforces and what it
 * *actually* enforces. The whole value of the check is in refusing to let
 * the first stand in for the second — a declaration read back to itself
 * always agrees, which is why a drift checker that only reads declarations
 * is guaranteed green and worth nothing.
 *
 * So this check requires two independently-sourced inputs and will not
 * proceed without both:
 *
 *   - the **declared** standard: what the repository states it requires, in
 *     a document it owns and versions;
 *   - the **measured** live state: what the enforcing system actually has
 *     configured right now, read through whatever credential can read it.
 *
 * If the live half is missing, the verdict is `indeterminate` and the run
 * fails closed. That is not a placeholder for unfinished work — it is the
 * correct and permanent answer whenever the credential available to a run
 * cannot read the enforcement surface, which is a common and entirely
 * legitimate situation: the ambient token a CI job holds is usually scoped
 * to repository *contents*, and repository *administration* is a different
 * grant that a run may quite reasonably not have. A drift check that
 * reported "no drift" in that situation would be reporting on nothing.
 *
 * A SECOND, DIFFERENT KIND OF DRIFT
 * ----------------------------------
 * Enforcement rules are one surface. The other is a policy *document* whose
 * content is supposed to be stable — where drift means "this file is no
 * longer the file we agreed to." That is a content-addressing problem, and
 * `@vespeneventures/policy` already solves it: commit a digest, verify a
 * later-materialized copy against it byte-for-byte. This check accepts such
 * bindings alongside the rule comparison and uses that package rather than
 * hashing anything itself. A binding whose document was not materialized for
 * this run is `indeterminate` for the same reason as an unreadable live
 * state: a digest with nothing to compare against verifies nothing.
 *
 * WHAT THIS CHECK DOES NOT CONTAIN
 * ---------------------------------
 * No account's actual rule names, no repository names, no notion of which
 * enforcement provider a consumer uses, and no opinion about what a
 * repository ought to require. Requirements are opaque identifiers compared
 * for equality. Every value is the consuming repository's own.
 *
 * Zero I/O. Pure function of already-collected observations.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@vespeneventures/governance/gates";
import type { GateResult } from "@vespeneventures/governance/gates";
import { validateBindingShape, verifyBinding } from "@vespeneventures/policy";
import type { PolicyBinding } from "@vespeneventures/policy";
import type { CheckFinding } from "./types.js";

/**
 * One thing a repository requires, named by an opaque identifier. What the
 * identifier means — a required status check's context string, a protection
 * rule's name — is the consuming repository's business, not this package's.
 */
export interface PolicyRequirement {
  readonly id: string;
  /** Optional human-facing detail, carried into the report and never compared. */
  readonly detail?: string;
}

/** A policy document whose content is expected not to change, bound by digest. */
export interface PolicyDocumentExpectation {
  /** The commitment, in `@vespeneventures/policy`'s own shape. */
  readonly binding: PolicyBinding;
  /**
   * The document's content as materialized for this run. Absent means the
   * caller did not (or could not) produce it, which is `indeterminate` — a
   * digest with nothing to compare against verifies nothing.
   */
  readonly materializedContent?: string;
}

/** Everything the drift comparison reads. All caller-supplied. */
export interface PolicyDriftObservation {
  /** What the repository's own declared standard says it requires. */
  readonly declaredRequirements: readonly PolicyRequirement[];
  /**
   * What the enforcing system actually has configured, as measured for this
   * run. `undefined` means it could not be read — never "there are none".
   */
  readonly liveRequirements?: readonly PolicyRequirement[];
  /** How the live state was measured, for the report. Never interpreted. */
  readonly liveSource?: string;
  /**
   * Whether the live read was complete. A partial read (a truncated page, a
   * partially-authorized response) is `indeterminate`: requirements the
   * caller never saw are indistinguishable from requirements that are not
   * there.
   */
  readonly liveComplete?: boolean;
  /** Content-addressed policy documents to verify, if any. */
  readonly documents?: readonly PolicyDocumentExpectation[];
}

/** Consumer-owned choices about how strict the comparison is. */
export interface PolicyDriftOptions {
  /**
   * Whether a live requirement the declaration does not mention is
   * acceptable. Explicit boolean, no default. `false` is the stricter and
   * usually correct setting: an enforcement rule nobody declared is drift in
   * the other direction, and it is exactly how a rule gets added by hand and
   * then silently removed by hand with nothing to notice either event.
   */
  readonly allowUndeclaredLiveRequirements: boolean;
}

/** Every reason this check can decline to answer. */
export const policyDriftReasons = createGateReasons([
  "no-observation-supplied",
  "no-options-supplied",
  "empty-declaration",
  "live-state-unreadable",
  "live-state-incomplete",
  "binding-invalid",
  "document-not-materialized",
] as const);

export type PolicyDriftReason = (typeof policyDriftReasons.reasons)[number];

/** One reportable drift. */
export interface PolicyDriftFinding extends CheckFinding {
  readonly rule: "requirement-missing" | "requirement-undeclared" | "document-drifted";
}

/** What the check concluded. */
export interface PolicyDriftReport {
  readonly result: GateResult<PolicyDriftFinding, PolicyDriftReason>;
  /** How many declared requirements and bound documents were actually compared. */
  readonly compared: number;
}

function finding(rule: PolicyDriftFinding["rule"], path: string, message: string): PolicyDriftFinding {
  return { rule, severity: "error", path, message };
}

/** Compares a repository's declared standard against its measured live state. */
export function checkPolicyDrift(
  observation: PolicyDriftObservation | undefined,
  options: PolicyDriftOptions,
): PolicyDriftReport {
  if (observation === undefined) {
    return {
      compared: 0,
      result: policyDriftReasons.indeterminate(
        "no-observation-supplied",
        "No policy-drift observation was supplied. Nothing was compared, so nothing agreed.",
      ),
    };
  }

  const documents = observation.documents ?? [];
  const declared = observation.declaredRequirements ?? [];

  if (declared.length === 0 && documents.length === 0) {
    return {
      compared: 0,
      result: policyDriftReasons.indeterminate(
        "empty-declaration",
        "The declared standard names no requirements and binds no documents. An empty standard is trivially satisfied " +
          "by any live state, which is indistinguishable from not checking at all.",
      ),
    };
  }

  const findings: PolicyDriftFinding[] = [];
  let compared = 0;

  if (declared.length > 0) {
    if (observation.liveRequirements === undefined) {
      return {
        compared: 0,
        result: policyDriftReasons.indeterminate(
          "live-state-unreadable",
          "The declared standard names requirements, and the live enforcement state could not be read" +
            (observation.liveSource === undefined ? "" : ` from ${observation.liveSource}`) +
            ". A declaration compared against itself always agrees.",
        ),
      };
    }
    if (observation.liveComplete !== true) {
      return {
        compared: 0,
        result: policyDriftReasons.indeterminate(
          "live-state-incomplete",
          "The live enforcement state was read only partially. A requirement the caller never saw looks exactly like " +
            "a requirement that is not configured.",
        ),
      };
    }

    const liveIds = new Set(observation.liveRequirements.map((requirement) => requirement.id));
    const declaredIds = new Set(declared.map((requirement) => requirement.id));
    for (const requirement of declared) {
      compared += 1;
      if (!liveIds.has(requirement.id)) {
        findings.push(
          finding(
            "requirement-missing",
            `declaredRequirements.${requirement.id}`,
            `The declared standard requires ${JSON.stringify(requirement.id)} and the live state does not have it` +
              (requirement.detail === undefined ? "." : `: ${requirement.detail}`),
          ),
        );
      }
    }
    if (!options.allowUndeclaredLiveRequirements) {
      for (const requirement of observation.liveRequirements) {
        compared += 1;
        if (!declaredIds.has(requirement.id)) {
          findings.push(
            finding(
              "requirement-undeclared",
              `liveRequirements.${requirement.id}`,
              `The live state enforces ${JSON.stringify(requirement.id)}, which the declared standard does not mention. ` +
                "An undeclared rule is one nobody agreed to and one nobody will notice being removed.",
            ),
          );
        }
      }
    }
  }

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index] as PolicyDocumentExpectation;
    const path = `documents[${index}]`;
    const shapeFindings = validateBindingShape(document.binding).filter((item) => item.severity === "error");
    if (shapeFindings.length > 0) {
      return {
        compared: 0,
        result: policyDriftReasons.indeterminate(
          "binding-invalid",
          `${path}: ${shapeFindings.map((item) => `${item.rule}: ${item.message}`).join("; ")}`,
        ),
      };
    }
    if (document.materializedContent === undefined) {
      return {
        compared: 0,
        result: policyDriftReasons.indeterminate(
          "document-not-materialized",
          `${path}: the document bound as ${JSON.stringify(document.binding.policyId)} was not materialized for this ` +
            "run, so its digest had nothing to be compared against.",
        ),
      };
    }
    compared += 1;
    const driftFindings = verifyBinding(document.binding, document.materializedContent).filter(
      (item) => item.severity === "error",
    );
    for (const item of driftFindings) {
      findings.push(
        finding(
          "document-drifted",
          `${path}.${item.path ?? "digest"}`,
          `${JSON.stringify(document.binding.policyId)} no longer matches its committed digest — ${item.message}`,
        ),
      );
    }
  }

  if (findings.length > 0) return { compared, result: gateViolated(findings) };
  if (compared === 0) {
    // Reachable when every declared requirement list was empty but documents
    // were present and all of them were skipped — defensive, and it fails
    // closed rather than constructing a satisfied result from nothing.
    return {
      compared,
      result: policyDriftReasons.indeterminate("empty-declaration", "Nothing was actually compared."),
    };
  }
  return { compared, result: gateSatisfied(compared) };
}
