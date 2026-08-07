/**
 * `buildFactIndex` — pure. Turns a `Fact[]` into the lookup structure
 * `checkFactsTraceability` (see `facts-gate.ts`) matches prose against.
 * No I/O, no filesystem knowledge; `readStrategy` (see `reader.ts`) is what
 * produces the `Fact[]` this function takes as input.
 */

import type { Fact } from "./schema.js";

export interface FactIndex {
  /** Every fact, keyed by its own `key` — `undefined` for a key that isn't in the set. */
  byKey: Map<string, Fact>;
  /**
   * Every literal string a prose claim may legitimately match, mapped to
   * the fact key(s) that surface form belongs to. A surface form shared by
   * two facts (rare, but not forbidden — two facts can coincidentally
   * stringify to the same digits) maps to both keys, so a match against it
   * still counts as traced without this index having to pick one
   * arbitrarily.
   */
  bySurfaceForm: Map<string, string[]>;
}

/**
 * The literal strings `fact` is allowed to appear as in prose: its own
 * `aliases` verbatim, plus a small set of default stringifications derived
 * directly from `value` — never a guess at a rendering the author didn't
 * write down. See `schema.ts`'s `FactSchema` doc comment for why `aliases`
 * is declared rather than derived: this function intentionally does NOT
 * try to invent "$4.2M"-style formatted variants of a number — only the
 * literal decimal/string/boolean form of `value` itself, plus whatever the
 * fact's own `aliases` array lists.
 */
function surfaceFormsOf(fact: Fact): string[] {
  const forms = new Set<string>();
  if (typeof fact.value === "object") {
    // Money: the bare amount, and "<amount> <currency>".
    forms.add(String(fact.value.amount));
    forms.add(`${fact.value.amount} ${fact.value.currency}`);
  } else {
    forms.add(String(fact.value));
  }
  for (const alias of fact.aliases ?? []) forms.add(alias);
  return [...forms];
}

export function buildFactIndex(facts: Fact[]): FactIndex {
  const byKey = new Map<string, Fact>();
  const bySurfaceForm = new Map<string, string[]>();

  for (const fact of facts) {
    byKey.set(fact.key, fact);
    for (const form of surfaceFormsOf(fact)) {
      const existing = bySurfaceForm.get(form);
      if (existing) existing.push(fact.key);
      else bySurfaceForm.set(form, [fact.key]);
    }
  }

  return { byKey, bySurfaceForm };
}

/** `true` when `literal` matches some fact's registered value or alias, exactly. */
export function isTracedSurfaceForm(index: FactIndex, literal: string): boolean {
  return index.bySurfaceForm.has(literal);
}
