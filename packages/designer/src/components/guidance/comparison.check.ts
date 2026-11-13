/** Compile-time contract for the public finite comparison lookup. */
import type { COMPONENT_COMPARISON, ComponentComparison } from "../index.js";

type Assert<Condition extends true> = Condition;
type Comparisons = typeof COMPONENT_COMPARISON;

type FiniteKeys = Assert<string extends keyof Comparisons ? false : true>;
type ButtonComparison = Assert<Comparisons["act.button"] extends ComponentComparison ? true : false>;
type EveryValue = Assert<Comparisons[keyof Comparisons] extends ComponentComparison ? true : false>;

// @ts-expect-error Breadcrumb has no represented finite comparison.
type MissingComparison = Comparisons["act.breadcrumb"];
// @ts-expect-error A caller must narrow an arbitrary string to a represented key.
type UncheckedLookup = Comparisons[string];
