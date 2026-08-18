/**
 * Compile-time proof that `EscapeRateMetric` (`./escape-rate.ts`) and
 * `UnobservedSurfaceMetric` (`./unobserved-surface.ts`) — the two metrics
 * this package reports, per issue #287 — cannot be combined into one score.
 *
 * Named `*.check.ts`, not `*.test.ts`, so it is part of the REAL `tsc` run
 * (`npm run typecheck`) rather than only transpiled, never type-checked, by
 * vitest — see this repository's contribution guide's "Type-level
 * assertions live in `.check.ts(x)` files" entry and
 * `packages/consent/src/audit-shape.check.ts` for the same pattern. Nothing
 * here is ever imported by `index.ts` or any runtime code; its only job is
 * to fail `tsc` if the structural separation regresses.
 *
 * WHAT "STRUCTURALLY IMPOSSIBLE TO COMBINE" MEANS HERE
 * -------------------------------------------------------
 * Both metrics carry plain `number` fields, so nothing stops arithmetic on
 * two numbers pulled out of them by hand — no type system prevents
 * `a.escapedCount + b.declaredCount`, and pretending otherwise would be
 * dishonest. What IS enforced structurally: the two report shapes share no
 * field name whatsoever (their only common member is the discriminant
 * `kind`, which holds two different literal strings), so there is no
 * shared accessor a combining function could be written against without
 * naming both shapes explicitly and choosing, by hand and in the open,
 * which fields to pull from each. There is no `.value` or `.score` either
 * type exposes that a generic combiner could close over. That is the
 * property this file proves and re-checks on every future edit to either
 * type: rename a field on one side to collide with the other's, and this
 * file's `NoSharedFieldName` check starts failing before anyone ships a
 * blended number.
 */
import type { EscapeRateMetric } from "./escape-rate.js";
import type { UnobservedSurfaceMetric } from "./unobserved-surface.js";

// The set intersection of the two metrics' own field names, computed at the
// type level. If this is ever anything other than `"kind"`, the two shapes
// have started sharing a field name — the seam a combining function would
// need — and `NoSharedFieldName` below stops compiling.
type SharedFieldNames = keyof EscapeRateMetric & keyof UnobservedSurfaceMetric;

type NoSharedFieldName = [SharedFieldNames] extends ["kind"] ? true : never;
export const theTwoMetricsShareNoFieldBesidesTheirDiscriminant: NoSharedFieldName = true;

// The discriminant itself never matches between the two shapes, so a
// caller who narrows a `EscapeRateMetric | UnobservedSurfaceMetric` union
// on `kind` can never mistake one for the other.
type DiscriminantsOverlap = EscapeRateMetric["kind"] extends UnobservedSurfaceMetric["kind"] ? true : false;
type DiscriminantsAreDistinct = DiscriminantsOverlap extends false ? true : never;
export const theTwoMetricsDiscriminantsAreDistinct: DiscriminantsAreDistinct = true;

// This package exports no function accepting both metric types at once.
// That is a fact about `index.ts`'s export list, not something provable at
// the type level from here — see `index.ts`'s own header, and
// `metrics-non-combination.test.ts` for the runtime-importable-surface
// version of the same claim.
