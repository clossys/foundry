/**
 * Compile-time-only assertions about the two structural rules this package
 * exists to hold. Named `.check.ts` rather than `.test.ts` on purpose: a
 * type-level assertion written inside a test file asserts nothing, because
 * this package's tsconfig excludes test files from the real `tsc` run and
 * vitest only transpiles them — so the assertion can never fail, and, the
 * more dangerous half, never signals that the guarded contract has changed
 * underneath it.
 *
 * Nothing imports this file at runtime; it has no runtime footprint at all.
 *
 * RULE 1 — NO COLLABORATOR IS OPTIONAL.
 * The defect this package repays is `(await config.policy?.(message)) ?? {
 * outcome: "allow" }`: an optional collaborator that defaults to a positive
 * outcome. The OPTIONALITY is what makes the default reachable, so the
 * assertion is on the optionality, not on the default. `OutcomeInputs` must
 * have zero optional keys, forever — a future edit adding a single `?` to
 * any field of it fails the build here.
 *
 * RULE 2 — NEITHER COLLAPSE IS EXPRESSIBLE.
 * `DeliveryBasis` is pinned to exactly three variants, every one of them a
 * positive reason to send, so "we could not tell, so we sent it" has no
 * value to be written as. `VerdictRefusalGrounds` is pinned to exactly two,
 * so "we could not tell, so we refused" has none either — the only refusal
 * available for an undecidable request is `handoff-unplaceable`, which
 * carries the hand-off record it failed to place. Widening either union is
 * a deliberate act that has to come through this file.
 */

import type { DeliveryBasis, GroundsReadiness, HumanAvailability, OutcomeInputs, VerdictRefusalGrounds } from "./contract.js";

type Assert<T extends true> = T;
type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;

/** The keys of `T` that may be omitted. `never` is the only acceptable answer for `OutcomeInputs`. */
type OptionalKeys<T> = { [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never }[keyof T];

// RULE 1. Every collaborator is required; there is nothing to leave off, and
// therefore nothing for a `??` to fill in.
type _NoOptionalCollaborators = Assert<Equal<OptionalKeys<OutcomeInputs>, never>>;

// RULE 2a. Three delivery bases, all positive. No "indeterminate", no
// "assumed", no "default" — so an undecidable read has no delivery to
// become.
type _DeliveryBasesArePositive = Assert<
  Equal<DeliveryBasis["kind"], "standing-granted" | "owed" | "owed-against-standing-refusal">
>;

// RULE 2b. Two refusal grounds. The second carries the hand-off, so an
// undecidable request cannot become a refusal that lost the fact a person
// was needed.
type _RefusalGroundsAreTwo = Assert<Equal<VerdictRefusalGrounds["kind"], "standing-refusal" | "handoff-unplaceable">>;

// An unplaceable refusal carries the whole hand-off record, not a flag: the
// record has to survive to reach the placement gate.
type _UnplaceableCarriesTheRecord = Assert<
  Extract<VerdictRefusalGrounds, { kind: "handoff-unplaceable" }> extends { unplaced: { handoff: { handoffId: string } } } ? true : false
>;

// An unavailable human must NAME why. "No human" is an answer, never the
// absence of one, so a bare `{ available: false }` is not a value of the type.
type _UnavailabilityIsNamed = Assert<{ available: false } extends HumanAvailability ? false : true>;

// Grounds that are not ready must name why, for the same reason.
type _GroundsGapIsNamed = Assert<{ ready: false } extends GroundsReadiness ? false : true>;

export type { Assert, Equal, OptionalKeys };
