/** Pure lookup over finding values, units and declared aliases. */
import type { Finding } from "./format/types.js";

export function evidenceKey(record: Finding): string { return record.id; }

export interface FactIndex<T extends Finding = Finding> {
  /** Every input record, keyed by its own `id`; indexes default to Finding. */
  byKey: Map<string, T>;
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
 * write down. Aliases are declared rather than derived: this function intentionally does NOT
 * try to invent "$4.2M"-style formatted variants of a number — only the
 * literal decimal/string/boolean form of `value` itself, plus whatever the
 * fact's own `aliases` array lists.
 */
function surfaceFormsOf(fact: Finding): string[] {
  const forms = new Set<string>();
  if (fact.value !== undefined) {
    forms.add(String(fact.value));
    if (fact.unit) forms.add(`${fact.value} ${fact.unit}`);
  }
  for (const alias of fact.aliases ?? []) forms.add(alias);
  return [...forms];
}

export function buildFactIndex<T extends Finding = Finding>(facts: readonly T[]): FactIndex<T> {
  const byKey = new Map<string, T>();
  const bySurfaceForm = new Map<string, string[]>();

  for (const fact of facts) {
    byKey.set(evidenceKey(fact), fact);
    for (const form of surfaceFormsOf(fact)) {
      const existing = bySurfaceForm.get(form);
      if (existing) existing.push(evidenceKey(fact));
      else bySurfaceForm.set(form, [evidenceKey(fact)]);
    }
  }

  return { byKey, bySurfaceForm };
}

/** `true` when `literal` matches some fact's registered value or alias, exactly. */
export function isTracedSurfaceForm<T extends Finding>(index: FactIndex<T>, literal: string): boolean {
  return index.bySurfaceForm.has(literal);
}
