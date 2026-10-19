/** Compile-time contract for the public finite comparison lookup. */
import type { ATOM_COMPARISON, AtomComparison } from "../index.js";

type Assert<Condition extends true> = Condition;
type Comparisons = typeof ATOM_COMPARISON;

type FiniteKeys = Assert<string extends keyof Comparisons ? false : true>;
type ButtonComparison = Assert<Comparisons["act.button"] extends AtomComparison ? true : false>;
type EveryValue = Assert<Comparisons[keyof Comparisons] extends AtomComparison ? true : false>;

// @ts-expect-error Breadcrumb has no represented finite comparison.
type MissingComparison = Comparisons["act.breadcrumb"];
// @ts-expect-error A caller must narrow an arbitrary string to a represented key.
type UncheckedLookup = Comparisons[string];
