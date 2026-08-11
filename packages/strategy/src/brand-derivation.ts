/**
 * `BrandDerivation` and `checkBrandCoverage` — the part of the brand layer
 * that earns its keep. `BrandEssence` and `BrandAttribute` (see
 * `schema.ts`) are records: they say what the brand is. Neither one, by
 * itself, produces anything a build could check. This file is what turns
 * an attribute into an obligation: a claim that specific token slots and
 * specific voice rules must exist and must be filled in a way consistent
 * with that attribute.
 *
 * THE NAME-ONLY SEAM, AND WHY
 * ----------------------------
 * A `BrandDerivation` names token slots (`"--color-accent-primary"`) and
 * voice rules (a plain rule id) by PLAIN STRING, never by importing
 * `@vespeneventures/ui/tokens` or `@vespeneventures/copy/voice`. This is the exact
 * discipline `Market.factRefs`/`Audience.factRefs`/`Claim.factRef` already
 * use throughout this package and `@vespeneventures/copy/voice` — a string
 * naming a thing in another package's domain, resolved (or not) by
 * whoever holds both sides, never a typed import that would make this
 * package's own dependency graph reach into either one. That is also why
 * this package ships with **zero runtime dependencies**: importing
 * `tokens` here to validate a slot name for real would mean every consumer
 * of `strategy` who has never touched brand tokens now resolves `tokens`'
 * own dependency tree too.
 *
 * THE CHECKER'S SEAM — READ THIS BEFORE CALLING `checkBrandCoverage`
 * ---------------------------------------------------------------------
 * Because this package cannot import `tokens`, `checkBrandCoverage` cannot
 * look up "which slots are brandable" itself. It takes that list as an
 * argument (`brandableSlots: string[]`) instead. This is deliberate, not a
 * missing feature: the CALLER — a consumer repo that depends on both
 * `strategy` and `tokens`, or a later cross-package gate built with
 * visibility into both — is the one place that seam can be closed for
 * real, e.g. by passing `Object.values(TOKENS).filter(t =>
 * t.brandable).map(t => t.property)` from `@vespeneventures/ui/tokens`
 * itself. `checkBrandCoverage` only ever sees the two plain lists it's
 * handed; it has no way to tell a real, current, brandable-slot list from
 * a stale or empty one, which is exactly why the degenerate cases below
 * (an empty list either way) are treated as failures rather than silent
 * passes — see "Fails closed", below.
 *
 * THE CHECK ITSELF — BOTH DIRECTIONS, LIKE `tokens`' OWN COVERAGE TEST
 * -----------------------------------------------------------------------
 * `@vespeneventures/ui/tokens`' `brand-coverage.test.ts` checks two
 * directions against `brand-template.css`: every brandable token appears
 * in the template (direction 1), and the template names no token this
 * package doesn't declare (direction 2). `checkBrandCoverage` is the same
 * two-directional check, generalized to run against caller-supplied data
 * instead of a fixed file on disk:
 *
 *   1. Every slot in `brandableSlots` is named by at least one
 *      derivation's `tokenSlots` — a brandable slot with nothing behind it
 *      is undocumented brand intent (`slotsMissingDerivation`).
 *   2. Every slot named by some derivation's `tokenSlots` is present in
 *      `brandableSlots` — a derivation pointing at a slot that doesn't
 *      exist is a stale or typo'd reference (`unknownSlotsInDerivations`).
 *
 * FAILS CLOSED
 * -------------
 * A checker given nothing to check must never report the same shape as a
 * checker that checked everything and found it clean — that exact
 * confusion is the recurring defect this file is built against (see the
 * package README's "Fails closed" precedent in this repository's other
 * gates). `checkBrandCoverage` therefore treats BOTH degenerate inputs as
 * an explicit failure, never a vacuous pass:
 *
 *   - `brandableSlots.length === 0` — nothing to check against. Maybe the
 *     caller forgot to pass the real list, maybe `tokens` genuinely
 *     declared zero brandable slots; either way this function cannot tell
 *     the difference, so it cannot report success. `ok: false`,
 *     `reason: "no-slots-provided"`.
 *   - `derivations.length === 0` — nothing was derived at all. `ok: false`,
 *     `reason: "no-derivations-provided"`, and every brandable slot is
 *     reported missing (there is, truthfully, no derivation behind any of
 *     them).
 *
 * `slotsChecked` and `derivationsChecked` are always present in the
 * result, in every branch, specifically so "zero things were checked" and
 * "everything checked out fine" can never be told apart by a caller who
 * only glances at `ok`.
 */

import {
  isPlainObject,
  optionalStringArray,
  pushIssue,
  requireArrayOf,
  requireString,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

/**
 * One attribute's implications for the contracts a brand actually touches.
 * `attribute` names a `BrandAttribute.name` (see `schema.ts`) by plain
 * string — not cross-checked against a real attribute list here, the same
 * "shape only, no cross-entity lookup" discipline `Market.factRefs` and
 * `Audience.factRefs` already document above.
 *
 * `tokenSlots` and `voiceRules` are each optional on their own (a
 * derivation might affect only the visual layer or only the verbal one),
 * but at least one of the two must be non-empty — a derivation that names
 * neither implies nothing, and an attribute with no implications isn't a
 * derivation, it's just `BrandAttribute.evidence` restated.
 */
export interface BrandDerivation {
  attribute: string;
  /** CSS custom property names, e.g. `"--color-accent-primary"`. Referenced by NAME ONLY — see this file's header comment. */
  tokenSlots: string[];
  /** Voice rule ids (a consumer's own `@vespeneventures/copy/voice` glossary/claim ids). Referenced by NAME ONLY — see this file's header comment. */
  voiceRules: string[];
  /** What about the attribute forces these specific slots/rules — the actual derivation logic, in prose. */
  rationale: string;
}

function readBrandDerivation(value: unknown, path: string, issues: ValidationIssue[]): BrandDerivation | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const attribute = requireString(value.attribute, `${path}.attribute`, issues, { minLength: 1 });
  const tokenSlots = optionalStringArray(value.tokenSlots, `${path}.tokenSlots`, issues, { itemMinLength: 1 }) ?? [];
  const voiceRules = optionalStringArray(value.voiceRules, `${path}.voiceRules`, issues, { itemMinLength: 1 }) ?? [];
  const rationale = requireString(value.rationale, `${path}.rationale`, issues, { minLength: 10 });

  if (issues.length === start && tokenSlots.length === 0 && voiceRules.length === 0) {
    pushIssue(
      issues,
      path,
      "must name at least one tokenSlot or voiceRule — a derivation with no implications is not a derivation",
    );
  }

  if (issues.length > start) return undefined;
  return { attribute: attribute as string, tokenSlots, voiceRules, rationale: rationale as string };
}

/** Validates a single `BrandDerivation`. */
export function validateBrandDerivation(value: unknown): ValidationResult<BrandDerivation> {
  const issues: ValidationIssue[] = [];
  const derivation = readBrandDerivation(value, "(root)", issues);
  return derivation !== undefined ? { ok: true, value: derivation } : { ok: false, issues };
}

/** Validates the whole contents of a `brand-derivations.json` file: an array of `BrandDerivation`. */
export function validateBrandDerivations(value: unknown): ValidationResult<BrandDerivation[]> {
  const issues: ValidationIssue[] = [];
  const derivations = requireArrayOf(value, "(root)", issues, readBrandDerivation);
  return derivations !== undefined ? { ok: true, value: derivations } : { ok: false, issues };
}

// -------------------------------------------------------------- coverage

/**
 * Why a `BrandCoverageResult` is not `ok`, when it isn't. `"coverage-gap"`
 * is a REAL finding — some brandable slot has no derivation, or some
 * derivation names a slot that doesn't exist — over a genuine, non-empty
 * comparison. `"no-slots-provided"` and `"no-derivations-provided"` are
 * the OTHER kind of failure: nothing meaningful was compared at all. A
 * caller that only checks `result.ok` still fails correctly either way;
 * one that wants to tell "found a real gap" apart from "was handed nothing
 * to check" reads `reason`.
 */
export type BrandCoverageFailureReason = "no-slots-provided" | "no-derivations-provided" | "coverage-gap";

export interface BrandCoverageResult {
  ok: boolean;
  /** `brandableSlots.length`, always present — see this file's header comment, "Fails closed". */
  slotsChecked: number;
  /** `derivations.length`, always present, for the same reason. */
  derivationsChecked: number;
  /** Direction 1: every brandable slot named by no derivation's `tokenSlots`. */
  slotsMissingDerivation: string[];
  /** Direction 2: every slot named by some derivation's `tokenSlots` that isn't in `brandableSlots`. */
  unknownSlotsInDerivations: string[];
  /** Present exactly when `ok` is `false`. See `BrandCoverageFailureReason`. */
  reason?: BrandCoverageFailureReason;
}

/**
 * Checks whether `derivations` fully accounts for `brandableSlots`, in
 * both directions, and fails closed on either empty input. Pure — no I/O,
 * never throws. See this file's header comment for the seam
 * (`brandableSlots` is caller-supplied, since this package cannot import
 * `@vespeneventures/ui/tokens` to look it up) and for why the two degenerate
 * inputs are failures rather than vacuous passes.
 */
export function checkBrandCoverage(brandableSlots: string[], derivations: BrandDerivation[]): BrandCoverageResult {
  const slotsChecked = brandableSlots.length;
  const derivationsChecked = derivations.length;

  const brandableSet = new Set(brandableSlots);
  const namedSlots = new Set<string>();
  for (const derivation of derivations) {
    for (const slot of derivation.tokenSlots) namedSlots.add(slot);
  }

  const slotsMissingDerivation = brandableSlots.filter((slot) => !namedSlots.has(slot));
  const unknownSlotsInDerivations = [...namedSlots].filter((slot) => !brandableSet.has(slot));

  if (slotsChecked === 0) {
    return {
      ok: false,
      slotsChecked,
      derivationsChecked,
      slotsMissingDerivation,
      unknownSlotsInDerivations,
      reason: "no-slots-provided",
    };
  }

  if (derivationsChecked === 0) {
    return {
      ok: false,
      slotsChecked,
      derivationsChecked,
      slotsMissingDerivation,
      unknownSlotsInDerivations,
      reason: "no-derivations-provided",
    };
  }

  const ok = slotsMissingDerivation.length === 0 && unknownSlotsInDerivations.length === 0;
  return {
    ok,
    slotsChecked,
    derivationsChecked,
    slotsMissingDerivation,
    unknownSlotsInDerivations,
    reason: ok ? undefined : "coverage-gap",
  };
}
