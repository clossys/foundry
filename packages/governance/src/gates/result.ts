/**
 * The gate-result ternary.
 *
 * Every gate outcome this repository (or a consumer of it) produces is
 * exactly one of three states, never collapsed into a binary pass/fail:
 *
 *   `satisfied`     — evaluated, condition holds. Passes.
 *   `violated`      — evaluated, condition does not hold. Fails.
 *   `indeterminate` — could not evaluate. Fails CLOSED, and carries a
 *                     required, machine-readable reason drawn from a
 *                     gate's own declared vocabulary — never a freeform
 *                     string, and never silently promoted to `satisfied`.
 *
 * This is not a new idea introduced here. `foundry-check`'s own CLI
 * (`./cli.ts`) already ships exactly this ternary at the process-exit-code
 * boundary — 0 clean, 1 findings, 2 could not run — and its own header
 * comment already says "a gate that reports 'clean' after failing to run
 * is worse than no gate at all." `evaluateRatchet` (`./ratchet.ts`)
 * independently reinvented the identical three states as `status: "clean"
 * | "regression" | "invalid"`, and says so explicitly in its own doc
 * comment: "the three states map directly onto this repository's
 * three-state CLI exit contract." `checkTokenPurity` (`@vespeneventures/
 * ui`), `checkCopyTraceability` (`@vespeneventures/copy`), and
 * `checkFactsTraceability` (`@vespeneventures/strategy`) each independently
 * reinvented a THIRD shape of the same idea — an `unchecked: UncheckedItem[]`
 * list, non-empty meaning "cannot vouch for this scan," gating a `2` before
 * findings are even counted.
 *
 * Four independent inventions of the same three-state contract, inside one
 * repository, is exactly the shape #256 describes at cross-repository
 * scale: "nine repository-local fixes do not stop a tenth... gate result
 * grammar is this package's concern." This module is that grammar, named
 * once. It does not replace `foundry-check`'s exit codes, `evaluateRatchet`'s
 * `status`, or any `unchecked` list — those all still work exactly as
 * before, and retrofitting each of them onto this shared type is
 * deliberately left for its own follow-up (see this package's CHANGELOG).
 * What this module adds is: a name for the shape everything above already
 * independently converged on, so the NEXT gate — in this repository or a
 * consumer's — reuses it instead of reinventing a fifth time.
 *
 * Zero I/O, matching this package's own convention throughout `./gates`:
 * every function here is a pure function of already-collected data.
 */

/** The three states a gate result can be in. Never a fourth, never a boolean. */
export type GateVerdict = "satisfied" | "violated" | "indeterminate";

/** Evaluated cleanly and the condition holds. */
export interface SatisfiedGateResult {
  readonly verdict: "satisfied";
  /**
   * How many inputs were actually evaluated to reach this verdict. Required,
   * and must be a positive integer — see `gateSatisfied`'s own doc comment
   * for why this is enforced, not merely documented. Plays the same role
   * `TokenGateResult.candidatesScanned` and `FoundationReport.catalog.
   * entries.length` already play elsewhere in this repository: it is what
   * lets a reader tell "clean because nothing was wrong" apart from "clean
   * because nothing was looked at."
   */
  readonly evaluated: number;
}

/** Evaluated cleanly and the condition does NOT hold. */
export interface ViolatedGateResult<TFinding> {
  readonly verdict: "violated";
  /** What was wrong. Required to be non-empty — see `gateViolated`. */
  readonly findings: readonly TFinding[];
}

/**
 * Could not evaluate. This is the state #256 exists to make impossible to
 * silently drop: it must never collapse into `satisfied`, and it must
 * always carry a reason a machine can act on.
 */
export interface IndeterminateGateResult<TReason extends string = string> {
  readonly verdict: "indeterminate";
  /**
   * A machine-readable reason, drawn from a gate's own declared vocabulary.
   * See `createGateReasons` — the mechanism this module offers for "a gate
   * may accept specific indeterminate reasons, but only by naming them,
   * never by omission" (#256's own words): every reason a gate can ever
   * emit is enumerated in that gate's own source, and emitting an
   * undeclared reason is a thrown error, not a silently-accepted string.
   */
  readonly reason: TReason;
  /** Optional human-readable elaboration. Never a substitute for `reason` — see `gateIndeterminate`. */
  readonly detail?: string;
}

/** One gate's outcome: exactly one of the three states above. */
export type GateResult<TFinding, TReason extends string = string> =
  | SatisfiedGateResult
  | ViolatedGateResult<TFinding>
  | IndeterminateGateResult<TReason>;

/**
 * A non-exhaustive starter vocabulary of common indeterminate reasons, taken
 * directly from #256's own examples. Not a closed enum — see
 * `createGateReasons` for how a gate declares the exact, finite set of
 * reasons IT can emit, which may include some, all, or none of these, plus
 * reasons of its own.
 */
export const COMMON_INDETERMINATE_REASONS = Object.freeze([
  "missing-credential",
  "no-applicable-inputs",
  "tool-unavailable",
  "unreadable-input",
  "upstream-unavailable",
] as const);

export type CommonIndeterminateReason = (typeof COMMON_INDETERMINATE_REASONS)[number];

/**
 * Constructs a `satisfied` result. Deliberately the one place in this
 * module that can produce `verdict: "satisfied"` — every other constructor
 * below either fails closed or fails loud.
 *
 * `evaluated` must be a positive integer. This IS the meta-check #256 asks
 * for, made mechanical rather than advisory: "any gate whose implementation
 * can return a passing result on a code path that performed no evaluation
 * is itself a defect." A gate built on this function physically cannot
 * construct a passing result while claiming to have evaluated zero things
 * — the attempt throws, at the exact call site that would otherwise have
 * been the silent bug. This mirrors an existing convention in this same
 * package: `checkValueFreeSecretCatalog` and `checkCredentialInventory`
 * already refuse an empty catalog/inventory as an error finding, "so empty
 * coverage cannot report a false pass" — this function applies the
 * identical discipline one level up, to the gate-result contract itself.
 */
export function gateSatisfied(evaluated: number): SatisfiedGateResult {
  if (!Number.isInteger(evaluated) || evaluated <= 0) {
    throw new Error(
      `gateSatisfied: evaluated must be a positive integer (something must actually have been evaluated to ` +
        `report "satisfied"), got ${JSON.stringify(evaluated)}. A gate that reports satisfied without evaluating ` +
        `anything is exactly the defect #256 exists to catch.`,
    );
  }
  return { verdict: "satisfied", evaluated };
}

/**
 * Constructs a `violated` result. `findings` must be non-empty — a
 * violation reported with nothing wrong in it is not a violation, and
 * would be indistinguishable from a caller who meant `satisfied` and typed
 * the wrong verdict.
 */
export function gateViolated<TFinding>(findings: readonly TFinding[]): ViolatedGateResult<TFinding> {
  if (findings.length === 0) {
    throw new Error("gateViolated: findings must be non-empty — a violation with nothing wrong is not a violation.");
  }
  return { verdict: "violated", findings };
}

/**
 * Constructs an `indeterminate` result directly, with an unconstrained
 * reason type. Prefer `createGateReasons` for any real gate: it scopes
 * `reason` to a finite, declared vocabulary instead of an arbitrary string,
 * which is the actual mechanism #256 asks for ("only by naming them, never
 * by omission"). This function remains exported for the rare caller that
 * genuinely has no fixed vocabulary yet (e.g. relaying an upstream error
 * message as the reason verbatim) — it still enforces the one invariant
 * that can't be delegated to a vocabulary: `reason` must be a real,
 * non-empty string, never an empty placeholder standing in for "some
 * reason I didn't bother to name."
 */
export function gateIndeterminate<TReason extends string>(reason: TReason, detail?: string): IndeterminateGateResult<TReason> {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("gateIndeterminate: reason is required and must be a non-empty string.");
  }
  return detail === undefined ? { verdict: "indeterminate", reason } : { verdict: "indeterminate", reason, detail };
}

/** What `createGateReasons` returns: a constructor scoped to exactly the reasons it was given. */
export interface GateReasonVocabulary<TReasons extends readonly [string, ...string[]]> {
  /** The declared reasons, unchanged, for a caller that wants to enumerate them (e.g. in `--help` text). */
  readonly reasons: TReasons;
  /** Constructs an `indeterminate` result. Throws if `reason` was not declared to `createGateReasons`. */
  indeterminate(reason: TReasons[number], detail?: string): IndeterminateGateResult<TReasons[number]>;
  /** Type guard: is `reason` one of this gate's declared reasons? Never throws. */
  isDeclaredReason(reason: string): reason is TReasons[number];
}

/**
 * Declares the finite set of indeterminate reasons ONE gate may ever emit,
 * and returns a constructor scoped to exactly that set.
 *
 * This is the "naming, never omission" half of #256's proposal. Without
 * it, a gate's set of possible indeterminate reasons lives only in
 * whichever call sites happen to construct one — invisible as a whole,
 * easy to extend by accident with a new ad hoc string nobody reviewed as
 * a new failure mode. With it, the vocabulary is one array literal in the
 * gate's own source: reviewable, greppable, and enforced — emitting a
 * reason outside the declared set throws immediately, at the call site,
 * rather than quietly widening what "indeterminate" can mean for that gate.
 *
 * Mirrors `validateGateName`'s `options.verbs` escape hatch in
 * `@vespeneventures/conventions`: a small, named, per-caller-extensible
 * vocabulary, never a closed enum baked into this package for every
 * possible gate everywhere.
 */
export function createGateReasons<const TReasons extends readonly [string, ...string[]]>(
  reasons: TReasons,
): GateReasonVocabulary<TReasons> {
  const known = new Set<string>(reasons);
  if (known.size !== reasons.length) {
    throw new Error(`createGateReasons: duplicate reason(s) declared: ${reasons.join(", ")}`);
  }
  const isDeclaredReason = (reason: string): reason is TReasons[number] => known.has(reason);
  return {
    reasons,
    isDeclaredReason,
    indeterminate: (reason, detail) => {
      if (!isDeclaredReason(reason)) {
        throw new Error(
          `createGateReasons: "${reason}" is not a declared reason for this gate. Declared reasons: ` +
            `${reasons.join(", ")}. An indeterminate result must name a reason from this gate's own declared ` +
            `vocabulary — never an ad hoc string invented at the call site.`,
        );
      }
      return gateIndeterminate(reason, detail);
    },
  };
}

/** Narrows a `GateResult` to `SatisfiedGateResult`. */
export function isSatisfied<TFinding, TReason extends string>(
  result: GateResult<TFinding, TReason>,
): result is SatisfiedGateResult {
  return result.verdict === "satisfied";
}

/** Narrows a `GateResult` to `ViolatedGateResult`. */
export function isViolated<TFinding, TReason extends string>(
  result: GateResult<TFinding, TReason>,
): result is ViolatedGateResult<TFinding> {
  return result.verdict === "violated";
}

/** Narrows a `GateResult` to `IndeterminateGateResult`. */
export function isIndeterminate<TFinding, TReason extends string>(
  result: GateResult<TFinding, TReason>,
): result is IndeterminateGateResult<TReason> {
  return result.verdict === "indeterminate";
}

/**
 * Combines multiple per-input `GateResult`s into one overall verdict for a
 * whole gate run.
 *
 * Precedence, most severe first: `indeterminate` beats `violated` beats
 * `satisfied` — the same fail-closed ordering `foundry-check`'s own report
 * already uses (coverage is printed, and the incomplete-coverage banner
 * shown, before findings are ever counted). `satisfied` is reachable only
 * when EVERY result was itself satisfied and `results` was non-empty — an
 * empty array is folded to `indeterminate`, never `satisfied`, for the same
 * reason `gateSatisfied` refuses `evaluated <= 0`: zero inputs is not
 * evidence of a clean pass, it is an unanswered question. `options.
 * emptyReason` is required, not defaulted, so that "what does it mean for
 * THIS gate to have nothing to evaluate" is always a reason its own author
 * named on purpose — never a generic fallback string this module chose for
 * them.
 */
export function foldGateResults<TFinding, TReason extends string>(
  results: readonly GateResult<TFinding, TReason>[],
  options: { readonly emptyReason: TReason; readonly emptyDetail?: string },
): GateResult<TFinding, TReason> {
  if (results.length === 0) {
    return gateIndeterminate(options.emptyReason, options.emptyDetail ?? "No inputs were evaluated.");
  }

  const indeterminates = results.filter(isIndeterminate<TFinding, TReason>);
  if (indeterminates.length > 0) {
    const first = indeterminates[0] as IndeterminateGateResult<TReason>;
    if (indeterminates.length === 1) {
      return gateIndeterminate(first.reason, first.detail);
    }
    const reasons = indeterminates.map((item) => item.reason).join(", ");
    return gateIndeterminate(first.reason, `${indeterminates.length} inputs were indeterminate: ${reasons}`);
  }

  const violations = results.flatMap((result) => (result.verdict === "violated" ? result.findings : []));
  if (violations.length > 0) {
    return gateViolated(violations);
  }

  const evaluated = results.reduce((sum, result) => sum + (result.verdict === "satisfied" ? result.evaluated : 0), 0);
  return gateSatisfied(evaluated);
}

/**
 * Folds a `GateResult` down to `foundry-check`'s own 0/1/2 exit-code
 * contract (see `./cli.ts`'s header comment, and AGENTS.md's "Gate CLIs
 * exit `0` clean / `1` findings / `2` could not run — `2` is not a variant
 * of failure").
 *
 * Deliberately takes no options and offers no override. AGENTS.md states
 * this repository's exit-code discipline unconditionally: "a check that
 * cannot run must fail (2), never pass (0)." There is therefore no
 * parameter here that could turn an `indeterminate` result into a `0` for
 * ANY reason, "accepted" or not — a gate that wants a specific
 * indeterminate reason to not BLOCK MERGE makes that a repository's own
 * branch-protection decision (is this check `required` at all), never a
 * knob inside the shared result type that could quietly launder a
 * fail-open exception into every consumer of this module at once.
 */
export function gateResultToExitCode(result: GateResult<unknown, string>): 0 | 1 | 2 {
  switch (result.verdict) {
    case "satisfied":
      return 0;
    case "violated":
      return 1;
    case "indeterminate":
      return 2;
    default: {
      const unhandled: never = result;
      throw new Error(`gateResultToExitCode: unknown verdict ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The meta-check #256 calls for, offered as a reusable regression-test
 * primitive: "any gate whose implementation can return a passing result on
 * a code path that performed no evaluation is itself a defect."
 *
 * This package is zero-I/O and cannot read another repository's source
 * files to prove a property about arbitrary code — there is no general
 * static analysis this module could perform that would be sound over code
 * it has never seen. What it CAN do, and what actually catches the two live
 * instances that motivated this issue, is make it trivial for any gate
 * built on `GateResult` to assert this property about ITSELF in one line of
 * its own test suite: call the gate's real evaluating function with an
 * input engineered to produce no real evaluation (an empty candidate list,
 * an unconfigured consumer, a missing tool) and assert the verdict is never
 * `"satisfied"`. This is the same discipline `scripts/test-gates.mjs`
 * already documents for the safety gates — "a gate that passes its own
 * positive case proves very little; a gate that fails to catch planted
 * contamination is the only failure mode that matters" — applied to the
 * result contract itself rather than to one specific gate's rules.
 *
 * `evaluate` is the gate's real function, unmodified. `input` is a value
 * the caller has already reasoned should produce no evaluation. Throws
 * (rather than returning a boolean) so a failure reads as a normal, located
 * test failure with a message naming the actual defect, not a bare
 * `expect(false).toBe(true)`.
 */
export function assertNeverVacuouslySatisfied<TInput, TFinding, TReason extends string>(
  evaluate: (input: TInput) => GateResult<TFinding, TReason>,
  input: TInput,
): void {
  const result = evaluate(input);
  if (result.verdict === "satisfied") {
    throw new Error(
      "assertNeverVacuouslySatisfied: the gate under test reported \"satisfied\" for an input engineered to " +
        "produce no real evaluation. A gate that can pass without evaluating anything is exactly the defect " +
        "#256 exists to catch — the input should instead have produced \"indeterminate\" with a named reason.",
    );
  }
}

/**
 * A minimal structural shape covering `evaluateRatchet`'s own `RatchetResult`
 * (`./ratchet.ts`), without importing it directly — this keeps `result.ts`
 * usable standalone and avoids coupling the shared type to one specific
 * gate's exact exported shape. Any object with this shape folds the same
 * way, including `RatchetResult` itself.
 */
interface RatchetLikeResult<TFinding> {
  readonly status: "clean" | "regression" | "invalid";
  readonly findings: readonly TFinding[];
}

/**
 * Proof, not assertion, that #256's ternary already existed at
 * `evaluateRatchet`'s boundary and only needed lifting into this shared
 * type — exactly what this issue asked to be checked before inventing
 * anything new. `evaluateRatchet`'s own doc comment already states the
 * mapping this function encodes: `"clean" -> 0`, `"regression" -> 1`,
 * `"invalid" -> 2`. This function makes that mapping real, reusable code
 * instead of parallel prose, without changing `evaluateRatchet`'s own
 * return type — retrofitting every existing gate in this package onto
 * `GateResult` directly is a separate, larger, and potentially
 * breaking change (see this package's `CHANGELOG.md`), deliberately left
 * out of this addition.
 */
export function gateResultFromRatchet<TFinding>(
  result: RatchetLikeResult<TFinding>,
): GateResult<TFinding, "ratchet-invalid-input"> {
  switch (result.status) {
    case "clean":
      // A clean ratchet result is satisfied by definition of having run —
      // `evaluated: 1` names "the ratchet comparison itself" as the one
      // thing evaluated; `evaluateRatchet` does not expose a finer-grained
      // count of what `current` was counting.
      return gateSatisfied(1);
    case "regression":
      return gateViolated(result.findings);
    case "invalid":
      return gateIndeterminate("ratchet-invalid-input", "evaluateRatchet could not evaluate its current/baseline input");
    default: {
      const unhandled: never = result.status;
      throw new Error(`gateResultFromRatchet: unknown ratchet status ${JSON.stringify(unhandled)}`);
    }
  }
}
