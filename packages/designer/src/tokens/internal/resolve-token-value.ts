/**
 * `resolveTokenValue` — a generic `var(--property, ...)` ALIAS-CHAIN
 * walker over a TOKEN REGISTRY (`Record<string, TokenDefinition>`),
 * following `TokenDefinition.value` from entry to entry until it lands on
 * a literal color/length/whatever value, a property the registry does not
 * contain, or a cycle. Built for `contrast-gate.ts`, which needs the REAL
 * literal value behind a token like `--color-chart-surface` (whose own
 * `TOKENS` entry is `"var(--color-surface-raised, oklch(1 0 0))"`, not a
 * literal at all) before it can hand two colors to `color.ts`'s
 * `contrastRatio`.
 *
 * ============================================================================
 * NOT THE SAME THING AS `style-scan.ts`'s `resolveFallbackChain` — READ
 * THIS BEFORE ASSUMING THEY OVERLAP
 * ============================================================================
 *
 * Both functions peel through nested `var(...)` calls and both exist to
 * avoid a fragile "search the registry for a same-valued entry" shortcut —
 * but they walk two entirely different kinds of data, at two entirely
 * different times, to answer two entirely different questions:
 *
 *   - `style-scan.ts`'s `resolveFallbackChain(text, index)` walks SOURCE
 *     TEXT — an arbitrary position inside a real `.ts`/`.tsx` FILE's raw
 *     characters (a `style={{}}` object, a `cx(...)` call, a Tailwind
 *     arbitrary-value bracket, ...) — using paren-depth backward/forward
 *     scanning to answer "is the literal AT THIS CHARACTER OFFSET sitting
 *     inside some `var(--x, ...)` call's fallback slot, and if so, which
 *     `--x`?". Its input is a string of source code; there is no registry
 *     involved at all, and the answer is either a `--property` name or
 *     `undefined` (bare literal) — it never looks up what `--property`
 *     itself resolves to.
 *   - `resolveTokenValue(property, tokens)` (this file) walks a REGISTRY —
 *     `TOKENS` (or an equivalent `Record<string, TokenDefinition>`, e.g. a
 *     registry built from a real `tokens.css`'s parsed declarations) —
 *     starting from a `--property` NAME, not a text offset. It reads that
 *     entry's OWN declared `.value`, and if that whole value is itself
 *     nothing but a `var(--other, ...)` reference, it looks up `--other`'s
 *     entry in the SAME registry and repeats, walking property-to-property
 *     through the registry's own key space until it reaches a value that is
 *     not a whole-value alias. There is no source file and no character
 *     offset anywhere in this function's world.
 *
 * A concrete case that shows why conflating them would be wrong:
 * `atoms/Icon.tsx`'s `"var(--ui-icon-sm, var(--spacing-lg, 16px))"` is
 * SOURCE TEXT `resolveFallbackChain` resolves (its `16px` is `--spacing-lg`'s
 * fallback, structurally, at that exact character range). `--color-chart-
 * surface`'s registry entry, `"var(--color-surface-raised, oklch(1 0 0))"`,
 * is a REGISTRY VALUE `resolveTokenValue` resolves (walk to
 * `--color-surface-raised`, read ITS entry, which is a literal
 * `oklch(...)` — done). Neither function could stand in for the other:
 * `resolveFallbackChain` has no registry to consult even if it wanted to,
 * and `resolveTokenValue` has no source file or character offset to walk.
 *
 * ============================================================================
 * WHAT COUNTS AS A "WHOLE-VALUE ALIAS" HERE
 * ============================================================================
 *
 * This walker only follows a `.value` that is EXACTLY one `var(...)` call
 * with nothing else around it — `^var\(\s*--[\w-]+\s*(?:,\s*[\s\S]*)?\)$`,
 * trimmed — the same shape `styles/tokens.css`'s own alias tokens use
 * (`--color-chart-surface`, `--color-ink-on-accent`, `--color-overlay-
 * surface`, `--color-overlay-border`, `--color-skeleton-fill`,
 * `--color-chart-axis`, `--color-chart-axis-label`, `--color-chart-
 * diverging-*`). A COMPOSITE value that merely CONTAINS a `var(...)`
 * somewhere inside a larger value — `--ui-ring-focus`'s
 * `"0 0 0 2px var(--color-accent, oklch(0.4748 0 0))"`, or
 * `--ui-elevation-raised`'s `"0 1px 0 var(--color-line-base, ...)"` — is
 * NOT walked through: it is returned as-is, as this walker's terminal
 * value, because it is not itself a color value `color.ts` could parse
 * (`parseColorToLinearSRGB` expects a bare `oklch(...)` or 6-digit hex, not
 * a `box-shadow`-shaped string with one embedded). A contrast PAIR that
 * needs a token like that would need its own extraction step first — out
 * of scope for a generic alias walker, and out of scope for the pairs
 * `contrast-pairs.ts` ships today, none of which name a composite token.
 *
 * ============================================================================
 * CYCLE HANDLING — A FINDING, NEVER AN INFINITE LOOP
 * ============================================================================
 *
 * Every step appends the property just visited to a `chain`; before
 * following a new alias, this function checks whether the TARGET property
 * is already in that chain. If it is, the walk stops immediately and
 * reports `cycle: true` plus the full chain that closes the loop — nothing
 * here ever iterates more than `Object.keys(tokens).length + 1` times, so a
 * malformed or hand-edited registry (a consumer's own, most plausibly —
 * this package's real `TOKENS` has no cycle, and `parity.test.ts`/
 * `theme-parity.test.ts` would already be a strange place for one to slip
 * through unnoticed) can never hang a caller.
 */

import type { TokenDefinition } from "../tokens.js";

function isWhitespaceCode(code: number): boolean {
  return code === 0x0009 || code === 0x000a || code === 0x000b || code === 0x000c || code === 0x000d ||
    code === 0x0020 || code === 0x00a0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function skipWhitespace(value: string, from: number): number {
  let index = from;
  while (index < value.length && isWhitespaceCode(value.charCodeAt(index))) index++;
  return index;
}

function isPropertyCharacter(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f || code === 0x2d || (code >= 0x61 && code <= 0x7a);
}

/**
 * Parses a value that is nothing but one `var(--property, ...)` call.
 * The fallback remains opaque, matching the old contract, but the prefix is
 * consumed exactly once with no regex backtracking over attacker-sized text.
 */
function wholeValueAlias(value: string): string | undefined {
  const text = value.trim();
  if (!text.startsWith("var(")) return undefined;
  let index = skipWhitespace(text, 4);
  const propertyStart = index;
  if (text[index] !== "-" || text[index + 1] !== "-") return undefined;
  index += 2;
  const suffixStart = index;
  while (index < text.length && isPropertyCharacter(text.charCodeAt(index))) index++;
  if (index === suffixStart) return undefined;
  const property = text.slice(propertyStart, index);
  index = skipWhitespace(text, index);
  if (text[index] === ")" && index === text.length - 1) return property;
  if (text[index] !== ",") return undefined;
  index = skipWhitespace(text, index + 1);
  return text.endsWith(")") && index <= text.length - 1 ? property : undefined;
}

export interface ResolvedTokenValue {
  /** The starting property this resolution was requested for. */
  readonly requested: string;
  /**
   * The final literal value once every whole-value alias has been
   * followed — `undefined` when resolution stopped early (a missing
   * property, or a cycle; see `missingProperty`/`cycle`).
   */
  readonly value: string | undefined;
  /**
   * Every property visited, in walk order, starting with `requested` and
   * ending with either the property whose value is `value` (the literal),
   * the property that could not be found (`missingProperty`), or the
   * property that closes a cycle (`cycle`).
   */
  readonly chain: readonly string[];
  /**
   * Set when a property named partway through the chain (by an earlier
   * entry's own `var(...)` reference) has no entry in `tokens` at all —
   * an unresolvable alias, reported as a finding by `contrast-gate.ts`,
   * never silently treated as "no value".
   */
  readonly missingProperty?: string;
  /**
   * Set when following the chain would revisit a property already in
   * `chain` — the alias loop, reported as a finding rather than walked
   * forever. Names the property that would have closed the loop.
   */
  readonly cycle?: string;
}

/**
 * Resolves `property`'s real literal value by walking `tokens` — starting
 * at `tokens[property]`, following `.value` through the registry's own key
 * space for as long as each `.value` is itself nothing but a whole-value
 * `var(--other, ...)` reference (see this file's header). Never throws:
 * an unknown starting `property`, a missing property partway through the
 * chain, or a cycle are all reported on the returned `ResolvedTokenValue`,
 * not thrown — the same "a decline path is data, never an exception a
 * caller must remember to catch" discipline this package's other gates
 * hold to (`checkBrandFileCoverage`'s `unchecked`, `checkTokenPurity`'s
 * `unchecked`).
 */
export function resolveTokenValue(
  property: string,
  tokens: Readonly<Record<string, TokenDefinition>>,
): ResolvedTokenValue {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = property;

  for (;;) {
    if (seen.has(current)) {
      return { requested: property, value: undefined, chain, cycle: current };
    }
    seen.add(current);
    chain.push(current);

    const entry = Object.prototype.hasOwnProperty.call(tokens, current) ? tokens[current] : undefined;
    if (entry === undefined) {
      return { requested: property, value: undefined, chain, missingProperty: current };
    }

    const alias = wholeValueAlias(entry.value);
    if (alias === undefined) {
      return { requested: property, value: entry.value, chain };
    }

    current = alias;
  }
}
