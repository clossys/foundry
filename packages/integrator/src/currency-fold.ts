import type { CurrencySeverity, PackageCurrency } from "./currency.js";
import { compareVersions } from "./semver.js";

/**
 * A second fold over the same `PackageCurrency[]` this package already
 * produces from `judgeCurrency` -- deliberately kept out of `./currency.ts`
 * so it never collides with concurrent work there, and deliberately kept a
 * pure fold over already-graded judgments rather than a third thing that
 * re-derives currency itself. `classifyCurrencyDistance` and `judgeCurrency`
 * still own grading; this module owns exactly one question `currencyVerdict`
 * cannot answer: grading a set of judgments AGAINST ANOTHER SET of judgments,
 * so a caller can tell what changed between the two, not just what the second
 * one says on its own.
 *
 * THE PROBLEM THIS EXISTS TO FIX. Every consumer that wires `currencyVerdict`
 * into a pull-request gate is grading that pull request's ABSOLUTE currency:
 * every entitled package's status right now, full stop. A pull request that
 * touches no dependency at all is blocked by drift some earlier, unrelated
 * change already introduced -- a release-workflow change, a security fix,
 * anything -- because the gate has no notion of "before this pull request"
 * to compare against. Worse, a registry's `latest` dist-tag moves during the
 * workday: the absolute verdict a pull request is graded against is not even
 * a fixed target, so no pull request can reliably converge on it. Both
 * failure modes have the same root cause -- grading the state instead of
 * the CHANGE -- and this module is the fix: a second scope, `introduced`,
 * that grades only what a change made worse, against a baseline captured at
 * the merge base, leaving pre-existing drift visible but never blocking.
 *
 * TWO SCOPES, ONE FOLD, so the policy is wrong in one place instead of ten.
 * Every consumer of this package currently hand-rolls its own
 * `check-currency.mjs` pass/fail policy; shipping the decision here removes
 * the choice of reimplementing it slightly differently in each one --
 * exactly the argument `currencyVerdict`'s own doc comment already makes for
 * shipping *that* fold instead of leaving it to callers.
 *
 *   - `absolute` is `currencyVerdict`'s existing semantics, generalized: any
 *     `behind` whose `severity` is in the caller-supplied `blockingSeverities`
 *     set is a violation, rather than `severity === "major"` being hardcoded.
 *     This is what a trunk or scheduled run uses -- there is no "before" to
 *     compare against for a run that isn't a proposed change, so grading the
 *     whole current state is the only honest question to ask.
 *   - `introduced` grades only what THIS change made worse, against a
 *     `baseline` set of statuses captured at the merge base. This is what a
 *     pull-request run uses. It reports two lists, never conflating them:
 *     `introduced` (this change's own doing -- blocking) and `inherited`
 *     (drift that already existed -- reported, so a pull request can still
 *     SEE the fleet's drift, but never blocking on account of it, because
 *     punishing a change for ground it did not cover is exactly the bug this
 *     module exists to fix).
 *
 * THE CRITICAL RULE, and the reason this file exists rather than being a
 * smaller patch to `currencyVerdict` itself: a baseline this fold cannot
 * read -- not supplied at all, or supplied as an explicit
 * `{ kind: "unreadable" }` marker because the caller tried and failed (a
 * shallow clone with no merge-base commit, a checkout that could not be
 * read) -- is reported as `indeterminate`, naming the baseline as the reason,
 * and NEVER folded into "nothing was introduced" and NEVER silently answered
 * with `absolute` grading instead. Both of those wrong answers are real
 * temptations: "no baseline, so nothing changed" fails OPEN, which inverts
 * `classifyCurrencyDistance`'s own law that an ungradable input is its own
 * `indeterminate` state, never guessed into a pass -- see that function's
 * doc comment in `./currency.ts` for the version-level version of exactly
 * this reasoning, reapplied here one level up, at the level of "was this
 * comparison even possible" rather than "was this version pair orderable".
 * "Fall back to `absolute`" is the other temptation, and it is wrong for a
 * different reason: it does not fail loudly, it quietly answers a *different
 * question* under the `introduced` name, so a caller who asked "did this
 * change make anything worse" gets back "is the fleet currently behind",
 * which is precisely the absolute-currency-blocks-an-unrelated-PR bug this
 * module exists to fix, now reintroduced silently inside its own fix. An
 * unread baseline is an unobserved surface, exactly like an unreachable
 * registry or an unparseable version elsewhere in this package, and an
 * unobserved surface is `indeterminate` -- never a pass, never a fail.
 *
 * WHAT COUNTS AS "MADE WORSE", per package name, once a readable baseline is
 * in hand:
 *
 *   - present in `statuses` as a blocking-severity `behind`, and absent from
 *     `baseline` entirely -- a dependency this change added that was already
 *     stale the moment it arrived -- is `introduced`.
 *   - present in both, graded `behind` in both, and `installedVersion` did
 *     not move -- pre-existing drift this change did not touch at all -- is
 *     `inherited`. This is the case that protects against the moving
 *     registry target described above: `latestVersion` can (and during a
 *     workday, will) drift out from under an untouched dependency, and this
 *     fold must never blame a change for a registry moving on its own.
 *   - present in both, graded `behind` in both, and `installedVersion`
 *     moved: a regression (the new version is older than the baseline's) is
 *     `introduced` outright; an advance that nonetheless lands at a *worse*
 *     graded severity (the bump was real, but not enough to keep pace with
 *     where `latest` had already moved to) is also `introduced`, because in
 *     both cases the version this change chose to install is the thing that
 *     made the grade worse, not the registry; an advance that still leaves
 *     the same or a better severity is `improved-but-behind`, folded as
 *     `inherited` -- partial progress must never be punished the same as a
 *     regression, or nobody will make partial progress.
 *   - `current` in `baseline` and a blocking-severity `behind` now is
 *     `introduced` -- the plainest case: this change is the only thing that
 *     could have moved it.
 *   - a name graded `absent-without-reason` now, whose baseline entry was
 *     anything other than `absent-without-reason` itself (added-and-then-
 *     removed without recording why, or a baseline in which it was never
 *     tracked as installed at all), is `introduced`; the same
 *     `absent-without-reason` on both sides is `inherited` -- an unexplained
 *     gap this change did not create is exactly as much pre-existing drift as
 *     a stale version, and is folded by the same rule.
 *
 * CARRIED THROUGH IN BOTH SCOPES:
 *
 *   - a `PackageCurrency` of state `"indeterminate"` (or `"unreachable"` /
 *     `"unauthenticated"`, the two other states `currencyVerdict` already
 *     treats as unjudged rather than judged-and-clean) anywhere in `statuses`
 *     makes the WHOLE fold `indeterminate`, never merely satisfied minus that
 *     one package -- a package this run could not grade at all was not
 *     graded current, was not graded behind, and was not graded introduced or
 *     inherited either. It was not graded, full stop, and `currencyVerdict`'s
 *     own precedence rule (indeterminate outranks violated) applies here
 *     unchanged: a run that could not evaluate part of its set must not
 *     report `violated` on the strength of the part it could.
 *   - the same three states, found on the BASELINE side for a name this run
 *     actually needs to classify, make the fold `indeterminate` for the same
 *     reason one level removed: whether today's drift on that name is
 *     `introduced` or `inherited` is unanswerable if the baseline's own
 *     judgment of that name could not be trusted, and guessing either way
 *     would be exactly the silent-pass or silent-fail this module's central
 *     law forbids.
 *   - `current` and `absent-with-reason` are untouched by this fold in
 *     either scope, the same way they are satisfied and never reported by
 *     `currencyVerdict` -- a decision on record, or nothing wrong to report,
 *     is not a finding.
 *   - a `behind` graded below `blockingSeverities` (patch or minor, by this
 *     fleet's usual policy, though the set is entirely caller-supplied) is
 *     never tracked by this fold at all, in either scope -- consistent with
 *     `currencyVerdict` folding those to `satisfied` today. Advisory drift a
 *     caller has decided never blocks a merge is not "introduced" or
 *     "inherited" drift either; it simply is not this fold's concern.
 */

/**
 * Which scope a fold call is asking for. See this module's own doc comment
 * above for the difference -- `absolute` grades the current state on its
 * own; `introduced` grades it against a `baseline`.
 */
export type CurrencyFoldScope = "absolute" | "introduced";

/**
 * The explicit "I tried and could not read this" marker for a baseline. Named
 * as its own shape, distinct from simply omitting `baseline`, so a caller
 * that attempted to capture a merge-base snapshot and failed (a shallow
 * clone with no merge-base commit reachable, a checkout it could not read)
 * has one obvious way to say so -- rather than being tempted to pass `[]`,
 * which this fold would otherwise have no way to distinguish from "the
 * merge base genuinely entitled to and installed nothing at all".
 */
export interface CurrencyBaselineUnreadable {
  readonly kind: "unreadable";
  /** Human-readable, e.g. "merge base commit not present in this shallow clone". */
  readonly reason: string;
}

/**
 * `introduced`'s baseline input: a real set of merge-base statuses, an
 * explicit unreadable marker, or omitted outright. All three are handled --
 * omission and the explicit marker both fold to `indeterminate`, never to
 * "nothing was introduced" and never to `absolute` grading under the
 * `introduced` name. See this module's own doc comment for why both of
 * those wrong answers are real temptations worth naming explicitly.
 */
export type CurrencyBaseline = readonly PackageCurrency[] | CurrencyBaselineUnreadable;

export interface AbsoluteCurrencyFoldInput {
  readonly scope: "absolute";
  readonly statuses: readonly PackageCurrency[];
  /** Which graded severities block a merge. Entirely caller-supplied -- this package grades, it never decides fleet policy. */
  readonly blockingSeverities: ReadonlySet<CurrencySeverity>;
}

export interface IntroducedCurrencyFoldInput {
  readonly scope: "introduced";
  readonly statuses: readonly PackageCurrency[];
  /** Omit entirely, or pass a `CurrencyBaselineUnreadable` marker, when no trustworthy merge-base snapshot exists -- both fold to `indeterminate`. */
  readonly baseline: CurrencyBaseline | undefined;
  readonly blockingSeverities: ReadonlySet<CurrencySeverity>;
}

export type CurrencyFoldInput = AbsoluteCurrencyFoldInput | IntroducedCurrencyFoldInput;

/**
 * One graded finding this fold reports, in either scope. A discriminated
 * union for the same reason `PackageCurrency` is one in `./currency.ts`: a
 * `behind` finding is the only kind with a `severity` and versions to report,
 * and an `absent-without-reason` finding has neither -- a wider shape with
 * every field optional would let a bug construct a nonsensical hybrid and
 * have it silently type-check.
 */
export type CurrencyFoldFinding =
  | {
      readonly kind: "behind";
      readonly name: string;
      readonly installedVersion: string;
      readonly latestVersion: string;
      readonly severity: CurrencySeverity;
    }
  | { readonly kind: "absent-without-reason"; readonly name: string };

/**
 * The result of one fold call, tagged by both `scope` and `verdict` so each
 * variant carries only the fields that combination can truthfully report --
 * `absolute`'s `violated` has no notion of "inherited" (there is no baseline
 * to inherit from), and `introduced`'s `satisfied` still carries `inherited`
 * findings, because a clean bill on THIS change is not the same claim as "the
 * fleet has no drift", and a pull request should be able to see the
 * difference even when it isn't the one blocked by it.
 */
export type CurrencyFoldResult =
  | { readonly scope: "absolute"; readonly verdict: "satisfied" }
  | { readonly scope: "absolute"; readonly verdict: "violated"; readonly violations: readonly CurrencyFoldFinding[] }
  | { readonly scope: "absolute"; readonly verdict: "indeterminate"; readonly reason: string }
  | { readonly scope: "introduced"; readonly verdict: "satisfied"; readonly inherited: readonly CurrencyFoldFinding[] }
  | {
      readonly scope: "introduced";
      readonly verdict: "violated";
      readonly introduced: readonly CurrencyFoldFinding[];
      readonly inherited: readonly CurrencyFoldFinding[];
    }
  | { readonly scope: "introduced"; readonly verdict: "indeterminate"; readonly reason: string };

const SEVERITY_RANK: Record<CurrencySeverity, number> = { patch: 1, minor: 2, major: 3 };

function behindFinding(status: Extract<PackageCurrency, { state: "behind" }>): CurrencyFoldFinding {
  return {
    kind: "behind",
    name: status.name,
    installedVersion: status.installedVersion,
    latestVersion: status.latestVersion,
    severity: status.severity,
  };
}

function foldAbsolute(input: AbsoluteCurrencyFoldInput): CurrencyFoldResult {
  const violations: CurrencyFoldFinding[] = [];
  for (const status of input.statuses) {
    switch (status.state) {
      // Unjudged, not judged-and-clean -- same precedence `currencyVerdict`
      // already applies: return the instant one is seen, regardless of what
      // else has or hasn't been scanned yet, so an indeterminate item found
      // anywhere in the set outranks a violation found anywhere else in it.
      case "indeterminate":
        return { scope: "absolute", verdict: "indeterminate", reason: `"${status.name}" could not be graded (${status.reason})` };
      case "unreachable":
        return { scope: "absolute", verdict: "indeterminate", reason: `"${status.name}" could not be reached to grade its currency` };
      case "unauthenticated":
        return { scope: "absolute", verdict: "indeterminate", reason: `"${status.name}" could not be authenticated for` };
      case "absent-without-reason":
        // Nothing about this is unexamined -- see `currencyVerdict`'s own
        // doc comment in `./currency.ts` for why this is a settled violation,
        // not a "could not tell".
        violations.push({ kind: "absent-without-reason", name: status.name });
        break;
      case "behind":
        if (input.blockingSeverities.has(status.severity)) violations.push(behindFinding(status));
        break;
      case "current":
      case "absent-with-reason":
        break;
    }
  }
  return violations.length === 0 ? { scope: "absolute", verdict: "satisfied" } : { scope: "absolute", verdict: "violated", violations };
}

function foldIntroduced(input: IntroducedCurrencyFoldInput): CurrencyFoldResult {
  if (input.baseline === undefined) {
    return {
      scope: "introduced",
      verdict: "indeterminate",
      reason: "no baseline was supplied -- an `introduced` fold cannot tell what this change made worse without a merge-base snapshot to compare against, and reporting nothing introduced would fail open",
    };
  }
  if ("kind" in input.baseline) {
    // `Array.isArray`'s type guard does not narrow a `readonly T[]` union
    // member reliably; the shape check above (a real array never has a
    // `kind` property) does, and is exactly the discriminant
    // `CurrencyBaselineUnreadable` was given one for.
    return { scope: "introduced", verdict: "indeterminate", reason: `baseline could not be read: ${input.baseline.reason}` };
  }
  const baseline = input.baseline;

  // Same unjudged-not-clean precedence as `foldAbsolute`, checked first and
  // for the whole run: a package this run itself could not grade was not
  // graded introduced, was not graded inherited, was not graded anything.
  for (const status of input.statuses) {
    if (status.state === "indeterminate") {
      return { scope: "introduced", verdict: "indeterminate", reason: `"${status.name}" could not be graded (${status.reason})` };
    }
    if (status.state === "unreachable") {
      return { scope: "introduced", verdict: "indeterminate", reason: `"${status.name}" could not be reached to grade its currency` };
    }
    if (status.state === "unauthenticated") {
      return { scope: "introduced", verdict: "indeterminate", reason: `"${status.name}" could not be authenticated for` };
    }
  }

  const baselineByName = new Map(baseline.map((entry) => [entry.name, entry] as const));
  const introduced: CurrencyFoldFinding[] = [];
  const inherited: CurrencyFoldFinding[] = [];

  for (const status of input.statuses) {
    if (status.state === "absent-without-reason") {
      const base = baselineByName.get(status.name);
      if (base !== undefined && (base.state === "indeterminate" || base.state === "unreachable" || base.state === "unauthenticated")) {
        return {
          scope: "introduced",
          verdict: "indeterminate",
          reason: `baseline judgment for "${status.name}" (${base.state}) could not be read, so whether this absence is newly introduced cannot be told`,
        };
      }
      if (base !== undefined && base.state === "absent-without-reason") {
        inherited.push({ kind: "absent-without-reason", name: status.name });
      } else {
        // Absent from the baseline entirely, or the baseline had it
        // installed / opted out with a reason -- either way, this run is
        // the first to report it as an unexplained gap.
        introduced.push({ kind: "absent-without-reason", name: status.name });
      }
      continue;
    }

    if (status.state !== "behind") continue; // current / absent-with-reason: nothing to report, in either scope
    if (!input.blockingSeverities.has(status.severity)) continue; // advisory severities are not this fold's concern, in either scope

    const finding = behindFinding(status);
    const base = baselineByName.get(status.name);

    if (base === undefined) {
      introduced.push(finding); // a dependency this change added, already stale on arrival
      continue;
    }
    if (base.state === "indeterminate" || base.state === "unreachable" || base.state === "unauthenticated") {
      return {
        scope: "introduced",
        verdict: "indeterminate",
        reason: `baseline judgment for "${status.name}" (${base.state}) could not be read, so whether this drift is newly introduced cannot be told`,
      };
    }
    if (base.state === "current") {
      introduced.push(finding); // the plainest case: only this change could have moved it
      continue;
    }
    if (base.state === "absent-with-reason" || base.state === "absent-without-reason") {
      introduced.push(finding); // the baseline never tracked this name as a graded install at all
      continue;
    }

    // base.state === "behind" from here: the real delta comparison.
    let versionDelta: number;
    try {
      versionDelta = compareVersions(status.installedVersion, base.installedVersion);
    } catch {
      return {
        scope: "introduced",
        verdict: "indeterminate",
        reason: `installed version for "${status.name}" could not be compared between the baseline and this run`,
      };
    }

    if (versionDelta === 0) {
      // installedVersion did not move. Whatever `latestVersion` has done
      // since -- including moving further away, which the registry does on
      // its own during a workday -- is not this change's doing.
      inherited.push(finding);
    } else if (versionDelta < 0) {
      introduced.push(finding); // a regression: this change is the only thing that could have done that
    } else if (SEVERITY_RANK[status.severity] > SEVERITY_RANK[base.severity]) {
      // installedVersion advanced, but the grade still got worse -- the
      // version this change chose to install did not keep pace with where
      // `latest` had already moved to. The bump was real; it just wasn't
      // enough, and that is still this change's outcome to own.
      introduced.push(finding);
    } else {
      inherited.push(finding); // improved-but-behind: partial progress, never punished
    }
  }

  if (introduced.length === 0) return { scope: "introduced", verdict: "satisfied", inherited };
  return { scope: "introduced", verdict: "violated", introduced, inherited };
}

/**
 * THE fold: `(input) -> CurrencyFoldResult`, dispatched on `input.scope`. Pure
 * and offline -- no network, no filesystem, nothing beyond comparing the
 * `PackageCurrency[]` values a caller already computed (via `judgeCurrency`,
 * for both `statuses` and, for `introduced`, a second call against the merge
 * base for `baseline`). Never throws: every input this function cannot trust
 * is reported as `indeterminate`, with a named, human-readable `reason`,
 * exactly like every other fold in this package.
 */
export function foldCurrencyDelta(input: CurrencyFoldInput): CurrencyFoldResult {
  return input.scope === "absolute" ? foldAbsolute(input) : foldIntroduced(input);
}

/** Process exit code for a result: the same fleet-wide 0/1/2 ternary `currencyVerdictToExitCode` and `supersessionResultToExitCode` already establish. */
export function currencyFoldResultToExitCode(result: CurrencyFoldResult): 0 | 1 | 2 {
  if (result.verdict === "satisfied") return 0;
  if (result.verdict === "violated") return 1;
  return 2;
}
