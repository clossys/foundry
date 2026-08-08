/**
 * `checkBrandFileCoverage` — the check every sibling contract package in
 * this repository ships and this one, until now, did not:
 * `@vespeneventures/voice` has `checkCopy`, `@vespeneventures/copy` has
 * `checkCopyTraceability`, `@vespeneventures/strategy` has
 * `checkFactsTraceability`, `@vespeneventures/compose` has
 * `validateComposeDocument`. This package shipped `TOKENS` — a vocabulary —
 * and `styles/brand-template.css` — a template — with nothing that answers
 * "did a consumer's real brand.css actually fill in the template correctly,
 * and did they typo a slot name while doing it?" `src/brand-coverage.test.ts`
 * answers that question only for THIS package's own
 * `styles/brand-template.css`; a consumer who copies that template into
 * their own project and edits it has no equivalent way to ask the same
 * question about their own file. This module is that equivalent,
 * generalized to run against caller-supplied data instead of one fixed file
 * this package ships.
 *
 * THE INPUT SHAPE — WHY `Record<string, string>`, NOT A CSS STRING
 * -------------------------------------------------------------------
 * `checkBrandFileCoverage` takes already-parsed custom-property
 * declarations (`--property-name` -> its declared value, as text), not raw
 * CSS. Two reasons, both arguments for keeping this function pure:
 *
 *   1. PARSING CSS IS A SEPARATE CONCERN WITH ITS OWN FAILURE MODE. A real
 *      `.css` file can contain constructs this package's hand-rolled reader
 *      cannot resolve (see `read-brand-css.ts`'s own header comment) — that
 *      reader reports those as `unchecked`, a signal this function has no
 *      way to reconstruct from a flat `Record`. Keeping the parse and the
 *      classification as two functions, the same split
 *      `@vespeneventures/copy` draws between `scan.ts` (extraction) and
 *      `copy-gate.ts` (the pure gate), and `@vespeneventures/strategy` draws
 *      between `scan.ts`/`reader.ts` and `facts-gate.ts`, means this
 *      function is trivially unit-testable against a hand-built object with
 *      no filesystem and no CSS syntax in the test fixtures at all.
 *   2. A `Record<string, string>` is also exactly what a consumer already
 *      has in hand in the one place most likely to want this check outside
 *      a CLI: a build script or test that already computed brand overrides
 *      as a plain object to pass to `@vespeneventures/render`'s
 *      `flattenTokens(overrides)` (see "AGREEMENT WITH `flattenTokens`"
 *      below) — the exact same shape, not a coincidence.
 *
 * WHY THIS IS `checkBrandFileCoverage`, NOT `checkBrandCoverage`
 * -------------------------------------------------------------------
 * `@vespeneventures/strategy` already exports a function literally named
 * `checkBrandCoverage`, checking a different thing: whether a
 * `BrandDerivation[]` (a strategy artifact naming token slots and voice
 * rules by plain string — see that package's `brand-derivation.ts`)
 * accounts for every brandable slot BY NAME, with no ability to look up
 * `@vespeneventures/tokens` itself (that package takes zero runtime
 * dependencies, on purpose — see its own header comment for why). This
 * function checks something one layer more concrete: whether a REAL CSS
 * file's declarations account for every brandable slot, typo-free, using
 * the real `TOKENS` registry this package owns. The two are complementary,
 * not redundant — `strategy`'s version asks "did the brand STRATEGY account
 * for this slot", this one asks "did the brand FILE actually declare it" —
 * but an identical name across two published packages a consumer might both
 * depend on would be a real ambiguity risk in a single pipeline, so this
 * one is named for the layer it actually checks (a CSS FILE's declarations,
 * not a strategy document's derivations) rather than reusing the name.
 * `strategy`'s export is unaffected — it shipped first and already has
 * consumers; this package's own export had none, so the free fix belongs
 * here. If you are looking for "does my BrandDerivation strategy account
 * for every token slot", that is `@vespeneventures/strategy`'s
 * `checkBrandCoverage`, not this function.
 *
 * THE THREE FINDING KINDS, AND WHY EACH ONE IS A FINDING NOT A SILENT SKIP
 * -------------------------------------------------------------------------
 *   1. `uncovered-brandable-slot` — a token this package marks
 *      `brandable: true` has no real (non-empty) declared value in
 *      `declarations`. This is the direction `brand-coverage.test.ts`'s
 *      first assertion already checks for this package's own template; here
 *      it runs against a real consumer file instead of a fixed fixture.
 *   2. `unknown-slot` — a declaration names a property that does not exist
 *      anywhere in `TOKENS` at all. Almost always a typo of a real slot
 *      name (`--color-surace-base` for `--color-surface-base`) or a stale
 *      reference to a token this package renamed/removed in a later
 *      version (see this package's own CHANGELOG for real examples of both
 *      — `--radius-s` -> `--radius-subtle` in `0.2.0`). Silently ignoring
 *      an unknown slot means the consumer's brand color for that role NEVER
 *      APPLIES — the property they declared has no reader anywhere in
 *      `tokens.css`'s cascade, `--color-surface-base` (or whatever they
 *      meant) keeps its unbranded default, and nothing else in this
 *      package's toolchain would ever say so. That is the single most
 *      damaging failure mode this checker exists to catch, which is why it
 *      is reported even though the CSS itself is perfectly valid.
 *   3. `non-brandable-override` — a declaration names a real token whose
 *      `brandable` is `false`: a structural scale (spacing, z-index,
 *      the neutral ramp, an internal alias) this package ships fixed
 *      regardless of brand. See "AGREEMENT WITH `flattenTokens`" below for
 *      why this MUST be a finding, not a silent accept.
 *
 * `unchecked` is a fourth, distinct list: a declaration key this function
 * was HANDED but that is not even shaped like a real CSS custom-property
 * name (`^--[a-zA-Z0-9-]+$`) at all, so it cannot be classified against
 * `TOKENS` as any of the three kinds above. In practice this only fires for
 * a caller-constructed `declarations` object with a malformed key — this
 * package's own `read-brand-css.ts` never produces one, since its own
 * declaration regex only ever captures that exact shape — but this
 * function does not trust its input any more than
 * `@vespeneventures/copy`'s `checkCopyRecord` trusts a typed argument it
 * did not itself produce (see that file's header comment, note #2): a key
 * this function cannot make sense of is reported, never dropped.
 *
 * AGREEMENT WITH `flattenTokens` — VERIFIED, NOT ASSUMED
 * ---------------------------------------------------------
 * `@vespeneventures/render`'s `flattenTokens(overrides)` already enforces
 * the exact two directions this function's `unknown-slot` and
 * `non-brandable-override` findings check, by THROWING
 * `RenderError("unknown-token-override", ...)` and
 * `RenderError("non-brandable-override", ...)` respectively (see
 * `packages/render/src/internal/tokens.ts`). Two independent checks in one
 * repository disagreeing about which slots a brand is allowed to touch
 * would be worse than either one alone — a brand override that this
 * function calls clean but `flattenTokens` then throws on (or vice versa)
 * is exactly the kind of drift a consumer discovers in production, not in
 * CI. `packages/render/src/internal/tokens-brand-file-coverage-agreement.test.ts`
 * (in `@vespeneventures/render`, not here — see that file's own header
 * comment for why the cross-check has to live on that side of the
 * dependency edge) asserts this directly: for every non-brandable token and
 * for a deliberately typo'd slot name, it feeds the SAME override object to
 * both this function and `flattenTokens`, and asserts one throws the
 * matching `RenderError` reason exactly when the other reports the matching
 * finding rule — not by inspecting either implementation, but by running
 * both against the same input and comparing outcomes.
 *
 * EMPTY VALUES DO NOT COUNT AS COVERAGE
 * ---------------------------------------
 * A declaration whose value is empty or all-whitespace (`--color-accent:
 * ;`) is exactly `styles/brand-template.css`'s own shipped, unfilled-in
 * shape for every required slot — see that file's own header comment:
 * "an empty one is invalid CSS and the property falls back to its
 * tokens.css default, silently." Treating an empty-valued declaration as
 * "covered" would make this function report a clean pass on a file that is,
 * functionally, still the unbound template — the exact "passes while
 * asserting nothing" failure mode this repository's other gates are built
 * against (see `@vespeneventures/copy`'s `checker.ts` header comment). An
 * empty-valued declaration is still recorded as `declarationsChecked` (it
 * IS a real declaration, syntactically) and its slot name is still checked
 * for the `unknown-slot`/`non-brandable-override` classifications above —
 * only COVERAGE treats it as absent.
 *
 * FAILS CLOSED
 * -------------
 * `ok` is `true` only when: at least one declaration or at least one
 * brandable slot was actually available to check (never a vacuous pass
 * from being handed nothing on both sides), AND zero findings, AND zero
 * unchecked entries. `declarationsChecked` and `brandableSlotsChecked` are
 * always populated, in every branch — including the zero-declarations
 * case — so a caller reading only those two numbers can tell "checked
 * nothing" apart from "checked everything and it was clean" without
 * inspecting `findings`/`unchecked` first. A `declarations` object with
 * zero entries is NOT a special-cased failure: it flows through the same
 * general logic as any other input, and — as long as the token registry
 * being checked against declares at least one brandable slot, true for the
 * real `TOKENS` — naturally produces one `uncovered-brandable-slot` finding
 * per brandable slot, which already fails `ok` on its own. See this file's
 * test suite, "the empty-declarations case", for this asserted directly —
 * and covered end to end, with a genuinely full brand file, by "a
 * genuinely clean run", which is what proves `ok: true` is actually
 * reachable, not just that failure is.
 */

import { TOKENS, type TokenDefinition } from "./tokens.js";

/** Why one `BrandFileCoverageFinding` was reported. See this file's header comment for the full reasoning behind each. */
export type BrandFileCoverageFindingRule = "uncovered-brandable-slot" | "unknown-slot" | "non-brandable-override";

export interface BrandFileCoverageFinding {
  rule: BrandFileCoverageFindingRule;
  /** The CSS custom-property name this finding is about, e.g. `"--color-surface-base"`. */
  slot: string;
  /** Human-readable explanation, safe to print directly in a CLI report. */
  message: string;
}

/** One `declarations` key that could not even be classified — see this file's header comment, "THE THREE FINDING KINDS". */
export interface BrandFileCoverageUnchecked {
  key: string;
  reason: string;
}

/**
 * Why `ok` is `false`, restated as a stable machine-readable label for a
 * caller that wants to branch on the KIND of failure without inspecting
 * `findings`/`unchecked` directly. `"nothing-to-check"` is the true
 * degenerate case — zero declarations AND a token registry with zero
 * brandable slots (only reachable via `options.tokens`; the real `TOKENS`
 * always has brandable slots) — see this file's header comment, "FAILS
 * CLOSED". `"coverage-gap"` covers every other non-`ok` case: at least one
 * real finding or unchecked entry.
 */
export type BrandFileCoverageFailureReason = "nothing-to-check" | "coverage-gap";

export interface BrandFileCoverageReport {
  ok: boolean;
  /** `Object.keys(declarations).length` — always present, including when `declarations` is `{}`. See this file's header comment, "FAILS CLOSED". */
  declarationsChecked: number;
  /** The number of `brandable: true` entries in the token registry checked against (the real `TOKENS` unless `options.tokens` overrides it) — always present, for the same reason as `declarationsChecked`. */
  brandableSlotsChecked: number;
  findings: BrandFileCoverageFinding[];
  /** See this file's header comment, "THE THREE FINDING KINDS" — a fourth, distinct bucket for a `declarations` key this function could not even classify. */
  unchecked: BrandFileCoverageUnchecked[];
  /** Present exactly when `ok` is `false`. */
  reason?: BrandFileCoverageFailureReason;
}

export interface BrandFileCoverageCheckOptions {
  /**
   * The token registry to check `declarations` against. Defaults to this
   * package's own `TOKENS`. Exposed as an option — not hardwired — for two
   * reasons: a test can substitute a small fixture registry instead of
   * exercising the real 154-entry one for every case (see this file's own
   * test suite), and a future caller checking a deliberately narrowed or
   * forked token set is not blocked from doing so. Unlike
   * `@vespeneventures/strategy`'s own `checkBrandCoverage`, which is FORCED
   * to take its vocabulary as a plain `string[]` because that package
   * cannot import this one at all (see that function's header comment,
   * "THE CHECKER'S SEAM"), this module lives inside the package that OWNS
   * `TOKENS` — so the real registry is the sensible default, and this
   * option exists for substitution, not because there is no other way to
   * reach the data.
   */
  tokens?: Readonly<Record<string, TokenDefinition>>;
}

/** A real CSS custom-property name: `--` followed by one or more letters, digits, or hyphens. */
const CUSTOM_PROPERTY_NAME_RE = /^--[a-zA-Z0-9-]+$/;

/**
 * Checks `declarations` — a flat map of CSS custom-property name to its
 * declared value text, e.g. from `read-brand-css.ts`'s `readBrandCss` or
 * `parseBrandDeclarations`, or hand-built by a caller/test — against the
 * token registry's `brandable` slots, in both directions, plus the
 * non-brandable-override rule `@vespeneventures/render`'s `flattenTokens`
 * already enforces. Pure: no I/O, never throws, and makes no assumption
 * about how `declarations` was produced beyond the type signature. See
 * this file's header comment for the full design rationale, including why
 * this is named `checkBrandFileCoverage` rather than reusing
 * `@vespeneventures/strategy`'s own, differently-scoped `checkBrandCoverage`.
 */
export function checkBrandFileCoverage(
  declarations: Record<string, string>,
  options: BrandFileCoverageCheckOptions = {},
): BrandFileCoverageReport {
  const tokens = options.tokens ?? TOKENS;

  const declarationsChecked = Object.keys(declarations).length;
  const brandableSlots = Object.values(tokens)
    .filter((def) => def.brandable)
    .map((def) => def.property);
  const brandableSlotsChecked = brandableSlots.length;

  const findings: BrandFileCoverageFinding[] = [];
  const unchecked: BrandFileCoverageUnchecked[] = [];

  // Every declared slot with a real (non-empty) value, classified as
  // brandable-and-known — the set direction 1 (coverage) below is measured
  // against. A slot declared TWICE (impossible from a `Record`'s own keys,
  // but kept as a Set for clarity/symmetry with the emptiness check) still
  // only needs to appear once here.
  const coveredSlots = new Set<string>();
  // Slots that WERE declared, brandable, and known, but with an empty
  // value — tracked separately purely to make the "uncovered" message
  // below more specific (declared-but-blank vs. never mentioned at all);
  // both still land in the same `uncovered-brandable-slot` finding bucket.
  const declaredButEmptySlots = new Set<string>();

  for (const [name, rawValue] of Object.entries(declarations)) {
    if (!CUSTOM_PROPERTY_NAME_RE.test(name)) {
      unchecked.push({
        key: name,
        reason: `"${name}" is not shaped like a CSS custom-property name ("--" followed by letters/digits/hyphens), so it cannot be classified against the token registry`,
      });
      continue;
    }

    const def = Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : undefined;

    if (def === undefined) {
      findings.push({
        rule: "unknown-slot",
        slot: name,
        message: `"${name}" is not a token this package declares — almost always a typo of a real slot name; as declared, this brand override will never apply, silently`,
      });
      continue;
    }

    if (!def.brandable) {
      findings.push({
        rule: "non-brandable-override",
        slot: name,
        message: `"${name}" is a structural (non-brandable) token; overriding it is not allowed — matches @vespeneventures/render's flattenTokens, which throws "non-brandable-override" for the same slot`,
      });
      continue;
    }

    if (rawValue.trim().length > 0) {
      coveredSlots.add(name);
    } else {
      declaredButEmptySlots.add(name);
    }
  }

  // Direction 1 (coverage): every brandable slot that never ended up in
  // `coveredSlots`, whether because it was never declared at all or because
  // it was declared with an empty value — see this file's header comment,
  // "EMPTY VALUES DO NOT COUNT AS COVERAGE".
  for (const slot of brandableSlots) {
    if (coveredSlots.has(slot)) continue;
    const declaredEmpty = declaredButEmptySlots.has(slot);
    findings.push({
      rule: "uncovered-brandable-slot",
      slot,
      message: declaredEmpty
        ? `"${slot}" is declared but with an empty value, which is not a real override — it silently falls back to tokens.css's default; fill it in or remove the declaration`
        : `"${slot}" is brandable but has no declaration in the given brand CSS — it will silently use tokens.css's unbranded default`,
    });
  }

  const somethingToCheck = declarationsChecked > 0 || brandableSlotsChecked > 0;
  const ok = somethingToCheck && findings.length === 0 && unchecked.length === 0;

  return {
    ok,
    declarationsChecked,
    brandableSlotsChecked,
    findings,
    unchecked,
    reason: ok ? undefined : somethingToCheck ? "coverage-gap" : "nothing-to-check",
  };
}
