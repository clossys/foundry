/**
 * Compile-time-only assertions about the three structural rules this package
 * exists to hold. Named `.check.ts` rather than `.test.ts` on purpose: a
 * type-level assertion written inside a test file asserts nothing, because
 * this package's tsconfig excludes test files from the real `tsc` run and
 * vitest only transpiles them — so the assertion can never fail, and, the
 * more dangerous half, never signals that the guarded contract has changed
 * underneath it. See this repository's contribution guide, "Type-level
 * assertions live in `.check.ts(x)` files", and
 * `scripts/check-typechecked-assertions.mjs`.
 *
 * Nothing imports this file at runtime; it has no runtime footprint at all.
 *
 * RULE 1 — A REASON TO KEEP SOMETHING NAMES WHAT THE PERSON DID.
 * Every `HoldingBasis` variant carries a `sourceEventId: string`, so a
 * holding cannot be justified by anything except an act of theirs. There is
 * no basis meaning "we could not tell", "legacy", or "imported". This is the
 * metric — unjustifiable holdings — made unconstructable rather than merely
 * measured, and it is asserted here so that adding a
 * `{ kind: "grandfathered" }` variant fails the BUILD rather than quietly
 * widening what counts as a reason.
 *
 * RULE 2 — THE BOUNDARY RULE IS A TYPE, NOT A CONVENTION.
 * An instruction constrains us; an understanding only informs us.
 * `BeliefUse` has exactly two modes, and the constraining one requires a
 * `confirmation` KEY — required, explicitly nullable. So "this belief
 * constrains behaviour" cannot be written without the author confronting
 * whether the person was ever asked: they either supply a confirmation or
 * write `null` on purpose. `null` is the state `checkAttribution` reports as
 * `belief-constrains-without-confirmation` and `decideHolding` returns
 * `unjustifiable` for. What is impossible is the third shape — a constraint
 * where the question simply never came up.
 *
 * RULE 3 — NO COLLABORATOR IS OPTIONAL, AND NO ABSENCE HAS A DEFAULT.
 * `HeldItem` and `HoldingInputs` both have zero optional keys. A field that
 * can be left off is a field something downstream will fill in, and a
 * defaulted provenance is a holding that justifies itself. Adding a single
 * `?` to either type fails the build here.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE
 * ----------------------------------------
 * There is no assertion that any judgement type lacks an indeterminate
 * variant, and there must never be one. This package's gates output
 * JUDGEMENTS, and "I could not check" is the most important thing a
 * judgement can say. `Provenance`, `ReachRead`, `SourceRead`,
 * `DisclosureReach` and `DeletionEffect` all carry an explicit
 * could-not-tell value, and the assertions below pin those values IN rather
 * than out. Eliminating indeterminacy is right for an act that either
 * happened or did not; it is wrong for a judgement, where it produces a gate
 * that reports a clean bill for work it never did.
 */

import type { BeliefUse, DeletionEffect, DisclosureReach, HeldItem, Provenance } from "./schema.js";
import type { HoldingBasis, HoldingInputs, ReachRead, SourceRead } from "./contract.js";

type Assert<T extends true> = T;
type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;

/** The keys of `T` that may be omitted. `never` is the only acceptable answer for the types below. */
type OptionalKeys<T> = { [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never }[keyof T];

// RULE 1. Every reason to keep something names the source event it came from.
// A variant without one stops compiling here before it can reach a consumer.
type _EveryBasisNamesItsSourceEvent = Assert<HoldingBasis extends { sourceEventId: string } ? true : false>;

// RULE 1, the closed list. Widening it is a deliberate act that comes through
// this file, which is what stops "held because it was already there" from
// being added as a sixth quiet variant.
type _BasisKindsArePinned = Assert<
  Equal<
    HoldingBasis["kind"],
    "authored" | "saved" | "observed" | "belief-informs" | "belief-confirmed-as-instruction" | "succession"
  >
>;

// RULE 1, the succession case specifically. Inheritance must name the event in
// which the subject named the successor — a successor nobody was named by is
// an assumption, and it has no shape to be written in.
type _SuccessionNamesTheEventThatCreatedIt = Assert<
  Extract<HoldingBasis, { kind: "succession" }> extends { sourceEventId: string; successorSubjectId: string } ? true : false
>;

// RULE 2. Exactly two modes. "Advises", "nudges" and "weights" are all
// constraints wearing a softer word, and none of them is expressible.
type _BeliefUseHasTwoModes = Assert<Equal<BeliefUse["mode"], "informs" | "constrains">>;

// RULE 2, the load-bearing half. A bare `{ mode: "constrains" }` is NOT a
// value of the type: the confirmation key is required, so the author must
// either supply one or write `null` deliberately.
type _ConstrainingRequiresTheConfirmationKey = Assert<{ mode: "constrains" } extends BeliefUse ? false : true>;

// RULE 2, the other half. `null` MUST remain writable, because an inference
// that crossed the line without anyone asking is the exact state
// `checkAttribution` exists to report. Making it unconstructable would delete
// the finding rather than the defect.
type _UnconfirmedConstraintStaysRepresentable = Assert<{ mode: "constrains"; confirmation: null } extends BeliefUse ? true : false>;

// RULE 3. Nothing about a held item, and nothing `decideHolding` needs, may
// be omitted — so there is nothing for a `??` to fill in.
type _HeldItemHasNoOptionalKeys = Assert<Equal<OptionalKeys<HeldItem>, never>>;
type _HoldingInputsHaveNoOptionalKeys = Assert<Equal<OptionalKeys<HoldingInputs>, never>>;

// INDETERMINACY IS PINNED IN, NOT OUT. Each of these unions must keep its
// could-not-tell value. Removing one would not simplify the model; it would
// force a real "I could not check" to be recorded as one of the answers this
// package is supposed to be able to distinguish it from.
type _ProvenanceKeepsIndeterminate = Assert<{ kind: "indeterminate"; namedReason: string } extends Provenance ? true : false>;
type _ReachKeepsUnknown = Assert<{ status: "unknown"; namedReason: string } extends ReachRead ? true : false>;
type _SourceKeepsUnknown = Assert<{ status: "unknown"; namedReason: string } extends SourceRead ? true : false>;
type _ReachValuesKeepUnknown = Assert<"unknown" extends DisclosureReach ? true : false>;
type _DeletionEffectsKeepUnknown = Assert<"unknown" extends DeletionEffect ? true : false>;

// An indeterminate provenance must NAME why. "We do not know" is an answer,
// never the absence of one, so a bare `{ kind: "indeterminate" }` is not a
// value of the type. Same for a holding that traces to nothing.
type _IndeterminacyIsNamed = Assert<{ kind: "indeterminate" } extends Provenance ? false : true>;
type _AbsenceIsNamed = Assert<{ kind: "none" } extends Provenance ? false : true>;

export type { Assert, Equal, OptionalKeys };
