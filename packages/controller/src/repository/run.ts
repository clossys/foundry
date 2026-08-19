/**
 * `runRepositoryProfileCheck` — the repository-profile runner (issue #321).
 *
 * This package shipped the contract (schema, validator, pure evaluators, the
 * exit-code ternary) but not the thing that actually RUNS it: locate a
 * declaration, observe the repository's real state, call the evaluators, map
 * the outcome to one of three verdicts, and say something a human can act
 * on. Five consumer repositories each wrote that runner by hand instead —
 * three of them sharing a filename with three different hashes, the other
 * two under different names. Every one of those five had to independently
 * get the same property right: a check that cannot run must not report
 * success. It has already shipped wrong once — one hand-written runner
 * parsed a declaration as JSON and handed it straight to its own evaluation
 * logic without validating the schema first, so a `commands` value that was
 * a string got iterated character by character, every character "evaluated"
 * to nothing, and the runner reported a clean result against a declaration
 * it had never actually understood.
 *
 * This module is the one place that decision is made, so it only needs to
 * be made correctly once.
 *
 * DISCOVERY IS INJECTED, NOT PERFORMED HERE. The five hand-written runners
 * differed mostly in HOW they observed reality: one shelled out to
 * `git ls-tree`, others read the filesystem directly, one cross-referenced a
 * manifest. This module takes those observations as already-collected,
 * caller-normalized data — `RepositoryRequirementObservation[]` and a root
 * direct-child listing — exactly the shapes `evaluateRepositoryRequirements`
 * and `evaluateRepositoryRoot` already accept. It performs no filesystem,
 * Git, process, or network I/O of its own: importing or calling this module
 * never shells out to anything, so it stays hermetically testable and keeps
 * working in a sandboxed CI runner with no shell or network access. Locating
 * and reading the declaration FILE itself remains the CLI wrapper's job
 * (`./run-cli.ts`), the same division `./cli.ts` already established for
 * `repository-check`.
 *
 * THE TERNARY IS DECIDED IN ONE PLACE. Every outcome is exactly one of
 * `satisfied` / `violated` / `indeterminate` (`@vespeneventures/controller/gates`'s
 * `GateResult`) — never a caller-assembled combination of a validator result
 * and an evaluator result that the caller has to fold into an exit code
 * itself. `main` in `./run-cli.ts` does nothing but call this function and
 * project its verdict through `gateResultToExitCode`.
 *
 * SCHEMA VALIDATION PRECEDES EVALUATION, UNCONDITIONALLY. `validateRepositoryProfile`
 * runs first, on the exact raw value the caller supplies, before this module
 * ever looks at `requirements` or `rootEntries`. A declaration that parses as
 * JSON but fails that validation returns `indeterminate` immediately — never
 * `satisfied`, and never routed into `evaluateRepositoryRequirements` or
 * `evaluateRepositoryRoot` at all. This is the direct fix for the defect
 * described above: there is no code path in this module that can reach an
 * evaluator with an unvalidated shape. `customAxes` (below) is folded in
 * only after this same schema check — there is likewise no code path that
 * reaches a custom axis for a schema-invalid declaration.
 *
 * CUSTOM AXES (issue #324). This module's built-in axes cover exactly two
 * things: the requirements axis and the root-vocabulary axis. Consumer
 * repositories also perform DERIVED cross-reference checks this package has
 * no concept of and must never learn — one checks `commands[].run` against
 * a manifest's real `scripts` map and `protectedPaths` against a live
 * path-matching predicate, clause by clause; another checks a `run` file
 * path exists on disk and that each `protectedPaths` entry's basename is
 * referenced in a set of governance files. Both are real evaluations only
 * the consumer can perform, over consumer-specific sources this package has
 * no business reading. `RepositoryProfileRunInput.customAxes` lets a caller
 * hand in the RESULT of that evaluation, already reduced to a `GateResult`,
 * and this module folds it through the exact same `foldGateResults` call —
 * and therefore the exact same indeterminate-beats-violated-beats-satisfied
 * precedence — as every built-in axis. The caller evaluates; this module
 * only folds, which is what keeps the ternary decided in ONE place even for
 * a check this module could never implement itself.
 */

import { CANONICAL_REPOSITORY_PROFILE_PATH } from "./types.js";
import type {
  RepositoryDeclarationLocationFinding,
  RepositoryList,
  RepositoryProfileV1,
  RepositoryProfileV2,
  RepositoryProfileV3,
  RepositoryRequirementFinding,
  RepositoryRequirementObservation,
  RepositoryRootFinding,
} from "./types.js";
import { validateRepositoryProfile } from "./validate.js";
import { evaluateRepositoryRequirements } from "./evaluate.js";
import { evaluateRepositoryRoot } from "./evaluate-root.js";
import {
  createGateReasons,
  foldGateResults,
  gateSatisfied,
  gateViolated,
  type GateResult,
} from "../gates/result.js";

/**
 * What the caller found (or didn't) at the declaration's location, BEFORE
 * any content has been examined. This module performs none of this
 * resolution itself — `./run-cli.ts` builds this from `locateRepositoryProfile`
 * plus a file read and a `JSON.parse`, the same way `./cli.ts` already does
 * for `repository-check` — but expressing it as data, rather than requiring
 * a caller to have already thrown or short-circuited, is what keeps this
 * function callable with a synthetic value in a test with no filesystem at
 * all.
 */
export type RepositoryProfileRunDeclarationState =
  | { readonly kind: "not-found" }
  | { readonly kind: "unreadable"; readonly detail: string }
  | { readonly kind: "invalid-json"; readonly detail: string }
  | { readonly kind: "parsed"; readonly path: string; readonly canonical: boolean; readonly value: unknown };

/**
 * A finding shape a custom axis's own findings may report through, for a
 * `violated` result. Structurally identical to every built-in finding shape
 * this module already emits (`rule` / `severity` / `path` / `message`) —
 * see `RepositoryRequirementFinding`, `RepositoryRootFinding`,
 * `RepositoryDeclarationLocationFinding` — but with an open `rule`: this
 * module has no concept of, and must never learn, any specific consumer's
 * own finding vocabulary (see `RepositoryProfileRunCustomAxis`).
 */
export interface RepositoryProfileRunCustomFinding {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/**
 * One caller-supplied, ALREADY-EVALUATED axis result (issue #324). This is
 * the mechanism for a derived cross-reference check the shared contract has
 * no concept of — `commands[].run` against a manifest's real `scripts` map,
 * `protectedPaths` against a live path-matching predicate, or any other
 * repository-specific comparison a consumer alone can perform. THE CALLER
 * EVALUATES; THIS MODULE ONLY FOLDS — exactly the same division of labor
 * `requirementObservations` and `rootObservedEntries` already establish for
 * discovery. This module never learns what `name` means, never inspects a
 * manifest, workflow file, or governance document, and performs no I/O to
 * produce or validate the comparison itself — only to validate the SHAPE of
 * what it was handed.
 *
 * `name` exists so a caller reading an `indeterminate` or `violated` result
 * downstream can tell which custom axis was responsible — see
 * `REPOSITORY_PROFILE_RUN_REASONS`'s `custom-axis-indeterminate` and
 * `custom-axis-invalid` reasons, both of which quote it back in `detail`.
 */
export interface RepositoryProfileRunCustomAxis {
  readonly name: string;
  readonly result: GateResult<RepositoryProfileRunCustomFinding, string>;
}

/**
 * Everything this function needs. `declaration` is the one thing a caller
 * cannot avoid resolving through I/O; `requirementObservations` and
 * `rootObservedEntries` are the injected discovery this module never
 * performs itself.
 *
 * `rootObservedEntries` is `undefined` when root discovery was never
 * attempted, deliberately distinct from `[]` (root discovery ran and found
 * nothing). Collapsing the two would turn "I never looked" into "I looked
 * and the root is empty" — which, for a profile that declares any `required`
 * root entry, is a false `violated` where the honest answer is
 * `indeterminate`. `requirementObservations` needs no equivalent split:
 * `RepositoryRequirementObservation`'s own `state` already carries `unknown`
 * as a first-class value, and `evaluateRepositoryRequirements` already folds
 * an entirely absent observation to that same `unknown` state per
 * requirement — an empty array is already indistinguishable, in its effect,
 * from "nothing was observed."
 *
 * `customAxes` is optional and defaults to empty — every existing caller
 * that never supplies it keeps working, unchanged, with identical results
 * (issue #324). Each entry is one already-evaluated `GateResult` a caller
 * produced for a derived cross-reference check this module has no way to
 * express itself (see `RepositoryProfileRunCustomAxis`). Every custom axis
 * folds through the exact same `foldGateResults` call, and therefore the
 * exact same precedence, as the built-in requirements and root axes:
 * `indeterminate` beats `violated` beats `satisfied`. A custom axis whose
 * `result` is not itself a well-formed `GateResult` is never ignored and
 * never treated as `satisfied` — it folds to `indeterminate` under the
 * `custom-axis-invalid` reason, the same fail-closed treatment every other
 * malformed input in this module already receives.
 */
export interface RepositoryProfileRunInput {
  readonly declaration: RepositoryProfileRunDeclarationState;
  readonly requirementObservations: RepositoryList<RepositoryRequirementObservation>;
  readonly rootObservedEntries: RepositoryList<string> | undefined;
  readonly customAxes?: RepositoryList<RepositoryProfileRunCustomAxis>;
}

/** Every reason `runRepositoryProfileCheck` can ever report as `indeterminate`, declared once. */
export const REPOSITORY_PROFILE_RUN_REASONS = createGateReasons([
  "declaration-not-found",
  "declaration-unreadable",
  "declaration-invalid-json",
  "declaration-schema-invalid",
  "requirements-conflicting",
  "requirements-unknown",
  "requirements-input-invalid",
  "root-observations-missing",
  "root-input-invalid",
  "custom-axis-invalid",
  "custom-axis-indeterminate",
] as const);

export type RepositoryProfileRunIndeterminateReason = (typeof REPOSITORY_PROFILE_RUN_REASONS.reasons)[number];

/**
 * The fixed `source` a single-profile run wraps its requirements in when
 * calling `evaluateRepositoryRequirements` (see `requirementsAxisResult`
 * below). A repository-scoped requirement observation must name this exact
 * string as its `source` to match. This is deliberately a fixed constant,
 * not the declaration's resolved file path: a caller building discovery
 * observations should never need to know, or reproduce, exactly how this
 * runner located the declaration on disk.
 */
export const REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE = "declaration";

/** Every finding shape this runner can surface, unified under one type for a caller that just wants to print them. */
export type RepositoryProfileRunFinding =
  | RepositoryDeclarationLocationFinding
  | RepositoryRequirementFinding
  | RepositoryRootFinding
  | RepositoryProfileRunCustomFinding;

/** The complete result: the shared three-state ternary, never a fourth or a boolean. */
export type RepositoryProfileRunResult = GateResult<RepositoryProfileRunFinding, RepositoryProfileRunIndeterminateReason>;

type ValidatedProfile = RepositoryProfileV1 | RepositoryProfileV2 | RepositoryProfileV3;

function hasRequirements(profile: ValidatedProfile): profile is RepositoryProfileV2 | RepositoryProfileV3 {
  return "requirements" in profile;
}

function hasRootEntries(profile: ValidatedProfile): profile is RepositoryProfileV3 {
  return "rootEntries" in profile;
}

function nonCanonicalLocationFinding(path: string): RepositoryDeclarationLocationFinding {
  return {
    rule: "declaration-non-canonical-location",
    severity: "error",
    path: "$",
    message: `A repository declaration was found at "${path}", not the canonical "${CANONICAL_REPOSITORY_PROFILE_PATH}". Move it there.`,
  };
}

/**
 * Evaluates upward requirements from a single already-validated profile
 * against caller-injected observations. Requirements are wrapped as one
 * synthetic declaration (`source` is `REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE`
 * — there is exactly one declaration in a single-profile run) purely to
 * reuse `evaluateRepositoryRequirements`'s existing multi-declaration shape
 * rather than duplicating its grouping and status logic here.
 */
function requirementsAxisResult(
  source: string,
  requirements: RepositoryProfileV2["requirements"],
  observations: RepositoryList<RepositoryRequirementObservation>,
): GateResult<RepositoryProfileRunFinding, RepositoryProfileRunIndeterminateReason> | undefined {
  if (requirements.length === 0) return undefined;

  const evaluation = evaluateRepositoryRequirements({
    declarations: [{ source, requirements }],
    observations,
  });

  switch (evaluation.status) {
    case "satisfied":
      return gateSatisfied(evaluation.requirements.length);
    case "unsatisfied":
      return gateViolated(evaluation.findings);
    case "conflicting":
      // Unreachable today: `validateRepositoryProfile` already rejects a
      // duplicate (scope, id) pair within one profile, and a single
      // declaration can never conflict with itself. Handled explicitly
      // anyway — an exhaustive switch over `evaluation.status` is the whole
      // point of not reinventing this mapping ad hoc at every call site.
      return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
        "requirements-conflicting",
        "The declared requirements have no mutually compatible accepted value.",
      );
    case "unknown": {
      const unresolved = evaluation.requirements
        .filter((result) => result.status === "unknown")
        .map((result) => `${result.scope}/${result.id}${result.source ? ` (${result.source})` : ""}`);
      return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
        "requirements-unknown",
        `No conclusive observation was supplied for: ${unresolved.join(", ")}. Supply a requirement ` +
          `observation — even an explicit "unknown" one — for every declared requirement.`,
      );
    }
    case "invalid":
      return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
        "requirements-input-invalid",
        "The injected requirement observations could not themselves be validated.",
      );
    default: {
      const unhandled: never = evaluation.status;
      throw new Error(`runRepositoryProfileCheck: unknown requirements evaluation status ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Evaluates the exact-root vocabulary from a single already-validated
 * profile against a caller-injected direct-child listing. `observedEntries
 * === undefined` means root discovery never ran; when the profile declares
 * any root entries at all, that is reported as `indeterminate`, never
 * silently skipped and never evaluated as an empty root.
 */
function rootAxisResult(
  rootEntries: RepositoryProfileV3["rootEntries"],
  observedEntries: RepositoryList<string> | undefined,
): GateResult<RepositoryProfileRunFinding, RepositoryProfileRunIndeterminateReason> | undefined {
  if (rootEntries.length === 0) return undefined;
  if (observedEntries === undefined) {
    return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
      "root-observations-missing",
      "The profile declares a root vocabulary but no root discovery was supplied.",
    );
  }

  const evaluation = evaluateRepositoryRoot({ rootEntries, observedEntries });

  switch (evaluation.status) {
    case "satisfied":
      return gateSatisfied(evaluation.entries.length);
    case "nonconforming":
      return gateViolated(evaluation.findings);
    case "invalid":
      return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
        "root-input-invalid",
        "The injected root observations could not themselves be validated.",
      );
    default: {
      const unhandled: never = evaluation.status;
      throw new Error(`runRepositoryProfileCheck: unknown root evaluation status ${JSON.stringify(unhandled)}`);
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural check for one custom-axis finding — the shape a `violated`
 * custom axis's own `findings` must conform to. Deliberately shallow (an
 * open `rule`, no known vocabulary to check it against — see
 * `RepositoryProfileRunCustomFinding`): this module cannot know a specific
 * consumer's own finding vocabulary, only that the four required fields are
 * present and of the right primitive type.
 */
function isValidCustomFinding(value: unknown): value is RepositoryProfileRunCustomFinding {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.rule) &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.path === "string" &&
    isNonEmptyString(value.message)
  );
}

/**
 * Structural check that an unknown value is a well-formed `GateResult` —
 * the same three shapes `gateSatisfied`/`gateViolated`/`gateIndeterminate`
 * construct, checked here at runtime because a custom axis arrives as data
 * from a caller this module cannot trust to have gone through those
 * constructors (or even to be written in TypeScript at all). This is the
 * enforcement behind issue #324's requirement 3: a custom axis that fails
 * this check is malformed, and `customAxisResult` below folds it to
 * `indeterminate` — never ignored, never `satisfied`.
 */
function isValidCustomAxisGateResult(value: unknown): value is GateResult<RepositoryProfileRunCustomFinding, string> {
  if (!isPlainObject(value)) return false;
  switch (value.verdict) {
    case "satisfied":
      return Number.isInteger(value.evaluated) && (value.evaluated as number) > 0;
    case "violated":
      return Array.isArray(value.findings) && value.findings.length > 0 && value.findings.every(isValidCustomFinding);
    case "indeterminate":
      return isNonEmptyString(value.reason);
    default:
      return false;
  }
}

/**
 * Folds one caller-supplied `RepositoryProfileRunCustomAxis` into this
 * runner's own `GateResult` shape. THIS FUNCTION EVALUATES NOTHING — the
 * caller already decided `satisfied` / `violated` / `indeterminate` for its
 * own derived cross-reference check; this only validates the SHAPE of what
 * it was handed and re-labels an `indeterminate` axis with which one it was
 * (requirement 5 — legible provenance), so the eventual `foldGateResults`
 * call downstream can treat it exactly like a built-in axis.
 *
 * A malformed axis — `name` not a non-empty string, or `result` not itself
 * a well-formed `GateResult` (see `isValidCustomAxisGateResult`) — is
 * `indeterminate` under `custom-axis-invalid`, never `satisfied` and never
 * dropped. Silently ignoring a malformed axis would reintroduce exactly the
 * defect issue #324 exists to prevent: a real check with nowhere to report,
 * silently read as passing.
 */
function customAxisResult(
  axis: RepositoryProfileRunCustomAxis,
): GateResult<RepositoryProfileRunFinding, RepositoryProfileRunIndeterminateReason> {
  const candidate = axis as unknown;
  const name = isPlainObject(candidate) ? candidate.name : undefined;
  const result = isPlainObject(candidate) ? candidate.result : undefined;
  const validName = isNonEmptyString(name);

  if (!validName || !isValidCustomAxisGateResult(result)) {
    return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
      "custom-axis-invalid",
      `${validName ? `Custom axis "${name}"` : "A custom axis"} did not supply a valid GateResult — verdict must ` +
        `be "satisfied" with a positive integer "evaluated", "violated" with non-empty "findings" each shaped ` +
        `{ rule, severity, path, message }, or "indeterminate" with a non-empty "reason". A malformed custom ` +
        `axis is never ignored and never treated as satisfied.`,
    );
  }

  switch (result.verdict) {
    case "satisfied":
      return gateSatisfied(result.evaluated);
    case "violated":
      return gateViolated(result.findings);
    case "indeterminate":
      return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
        "custom-axis-indeterminate",
        `Custom axis "${name}" reported indeterminate (${result.reason}${result.detail ? `: ${result.detail}` : ""}).`,
      );
    default: {
      const unhandled: never = result;
      throw new Error(`runRepositoryProfileCheck: unknown custom axis verdict ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The runner. One call: locate-and-read the declaration (already resolved by
 * the caller into `input.declaration`), validate its schema, and — only for
 * a schema-valid declaration — evaluate its declared requirements and root
 * vocabulary against the caller's injected discovery. Returns exactly one
 * `GateResult`.
 *
 * `not-found` and a non-canonical declaration location are reported as
 * `violated`, not `indeterminate`: both are fully, conclusively determined
 * facts (the whole tree was searched; the file is exactly where it is), not
 * missing evidence. A malformed declaration (unreadable, not valid JSON, or
 * valid JSON that fails schema validation) is `indeterminate`: nothing
 * conclusive can be evaluated from it, and — the specific defect this
 * function exists to make structurally impossible — it is never routed into
 * `evaluateRepositoryRequirements` or `evaluateRepositoryRoot` regardless.
 */
export function runRepositoryProfileCheck(input: RepositoryProfileRunInput): RepositoryProfileRunResult {
  const { declaration } = input;

  if (declaration.kind === "not-found") {
    return gateViolated<RepositoryProfileRunFinding>([{
      rule: "declaration-not-found",
      severity: "error",
      path: "$",
      message: `No repository declaration was found. Author one at the canonical location "${CANONICAL_REPOSITORY_PROFILE_PATH}".`,
    }]);
  }
  if (declaration.kind === "unreadable") {
    return REPOSITORY_PROFILE_RUN_REASONS.indeterminate("declaration-unreadable", declaration.detail);
  }
  if (declaration.kind === "invalid-json") {
    return REPOSITORY_PROFILE_RUN_REASONS.indeterminate("declaration-invalid-json", declaration.detail);
  }

  // declaration.kind === "parsed" from here on. Schema validation ALWAYS
  // runs next, unconditionally, before anything below ever reads
  // `requirements` or `rootEntries` off the raw value.
  const schemaFindings = validateRepositoryProfile(declaration.value);
  if (schemaFindings.length > 0) {
    return REPOSITORY_PROFILE_RUN_REASONS.indeterminate(
      "declaration-schema-invalid",
      `The declaration at "${declaration.path}" does not conform to the repository profile schema ` +
        `(${schemaFindings.length} finding${schemaFindings.length === 1 ? "" : "s"}: ` +
        `${schemaFindings.map((finding) => finding.rule).join(", ")}). Evaluation was not attempted against ` +
        `an unvalidated declaration.`,
    );
  }

  const profile = declaration.value as ValidatedProfile;
  const axisResults: Array<GateResult<RepositoryProfileRunFinding, RepositoryProfileRunIndeterminateReason>> = [];

  if (!declaration.canonical) {
    axisResults.push(gateViolated<RepositoryProfileRunFinding>([nonCanonicalLocationFinding(declaration.path)]));
  }
  if (hasRequirements(profile)) {
    const result = requirementsAxisResult(
      REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
      profile.requirements,
      input.requirementObservations,
    );
    if (result) axisResults.push(result);
  }
  if (hasRootEntries(profile)) {
    const result = rootAxisResult(profile.rootEntries, input.rootObservedEntries);
    if (result) axisResults.push(result);
  }
  // Custom axes (issue #324) fold in last, but through the exact same array
  // and the exact same `foldGateResults` call below as every built-in axis
  // — there is no separate precedence for them. Pushed BEFORE the
  // `axisResults.length === 0` short circuit so a caller-supplied custom
  // axis is never silently dropped even when the declaration itself has no
  // built-in requirements or root entries to evaluate (e.g. a bare v1
  // profile with one custom axis attached).
  for (const axis of input.customAxes ?? []) {
    axisResults.push(customAxisResult(axis));
  }

  if (axisResults.length === 0) {
    // A valid, canonically located declaration that declares nothing to
    // evaluate (a bare v1 profile, or v2/v3 with empty `requirements`/
    // `rootEntries`) and no custom axes were supplied either. The
    // declaration itself is the one thing evaluated — same reasoning
    // `evaluateRatchet`'s "clean" case uses for `gateSatisfied(1)`.
    return gateSatisfied(1);
  }

  // `foldGateResults` would fold a genuinely empty array to `indeterminate`;
  // `axisResults` is never empty here (guarded above), so `emptyReason` is
  // unreachable. Supplied anyway because `foldGateResults` requires one.
  return foldGateResults(axisResults, { emptyReason: "declaration-schema-invalid" });
}
