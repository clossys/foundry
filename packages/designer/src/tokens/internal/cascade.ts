/**
 * A minimal, test-only CSS selector matcher and specificity calculator —
 * NOT part of this package's public API (see the note atop
 * `internal/parse-css.ts`). It exists so `src/dark-mode-cascade.test.ts`
 * can simulate how a real browser resolves the light/dark cascade this
 * package ships, rather than asking a reader to trust a comment.
 *
 * Deliberately narrow: it understands exactly the four selector "atoms"
 * this package's dark-mode cascade uses — `:root`, `[data-brand-bound]`,
 * `[data-theme="light"|"dark"]`, and `:not([data-theme="light"|"dark"])` —
 * and throws on anything else, so a selector this module can't account for
 * fails loudly (as a test failure) instead of silently scoring as
 * specificity 0.
 */

export type ThemeAttr = "light" | "dark" | undefined;

/** The subset of DOM/media state this package's selectors can key off. */
export interface CascadeState {
  readonly brandBound: boolean;
  readonly dataTheme: ThemeAttr;
}

type Atom =
  | { readonly kind: "root" }
  | { readonly kind: "brand-bound" }
  | { readonly kind: "theme-attr"; readonly value: "light" | "dark" }
  | { readonly kind: "not-theme-attr"; readonly value: "light" | "dark" };

const ATOM_PATTERNS: ReadonlyArray<{ re: RegExp; build: (m: RegExpMatchArray) => Atom }> = [
  { re: /^:root/, build: () => ({ kind: "root" }) },
  { re: /^\[data-brand-bound\]/, build: () => ({ kind: "brand-bound" }) },
  {
    re: /^\[data-theme="(light|dark)"\]/,
    build: (m) => ({ kind: "theme-attr", value: m[1] as "light" | "dark" }),
  },
  {
    re: /^:not\(\[data-theme="(light|dark)"\]\)/,
    build: (m) => ({ kind: "not-theme-attr", value: m[1] as "light" | "dark" }),
  },
];

/** Tokenize a selector into atoms, or throw if any part of it isn't one of the four known shapes. */
function tokenize(selector: string): Atom[] {
  let rest = selector;
  const atoms: Atom[] = [];
  while (rest.length > 0) {
    const hit = ATOM_PATTERNS.find((p) => p.re.test(rest));
    if (!hit) {
      throw new Error(
        `cascade.tokenize: selector ${JSON.stringify(selector)} has an unrecognized remainder ${JSON.stringify(rest)} — this test module only understands :root, [data-brand-bound], [data-theme="..."], and :not([data-theme="..."]).`,
      );
    }
    const match = rest.match(hit.re)!;
    atoms.push(hit.build(match));
    rest = rest.slice(match[0].length);
  }
  return atoms;
}

/**
 * CSS specificity, restricted to this package's vocabulary: `:root`,
 * `[attr]`, and `:not([attr])` are all specificity class "c" (the
 * pseudo-class/attribute/class tier) at weight 1 each — there is no id,
 * inline style, or type selector anywhere in this package's own CSS, so
 * a plain atom count is the real, correct specificity, not a simplification.
 */
export function specificity(selector: string): number {
  return tokenize(selector).length;
}

/** Does `selector` match an element in `state`? (`:root` always matches — nothing here simulates any other element.) */
export function selectorMatches(selector: string, state: CascadeState): boolean {
  return tokenize(selector).every((atom) => {
    switch (atom.kind) {
      case "root":
        return true;
      case "brand-bound":
        return state.brandBound;
      case "theme-attr":
        return state.dataTheme === atom.value;
      case "not-theme-attr":
        return state.dataTheme !== atom.value;
    }
  });
}

/** One CSS rule as this test module needs to reason about it: a selector, whether it sits inside `@media (prefers-color-scheme: dark)`, its position in the source (for cascade tie-breaks), and the value it declares for the one property under test. */
export interface CascadeRule {
  readonly selector: string;
  readonly insideDarkMedia: boolean;
  readonly sourceIndex: number;
  readonly value: string;
}

/**
 * Resolve which of `rules` wins for a simulated element/media state, using
 * real cascade rules: only rules whose selector matches AND (if
 * `insideDarkMedia`) whose media condition is satisfied are candidates;
 * among candidates, highest specificity wins, and a tie is broken by
 * source order (the later declaration wins) — exactly as a real browser
 * resolves two declarations of equal specificity for the same property.
 * Returns `undefined` if no rule matches (never expected for the light
 * default, which has no gate at all).
 */
export function resolveCascade(
  rules: readonly CascadeRule[],
  state: CascadeState & { readonly osDark: boolean },
): CascadeRule | undefined {
  const candidates = rules.filter(
    (rule) => (!rule.insideDarkMedia || state.osDark) && selectorMatches(rule.selector, state),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, rule) => {
    const ruleSpec = specificity(rule.selector);
    const bestSpec = specificity(best.selector);
    if (ruleSpec > bestSpec) return rule;
    if (ruleSpec === bestSpec && rule.sourceIndex > best.sourceIndex) return rule;
    return best;
  });
}
