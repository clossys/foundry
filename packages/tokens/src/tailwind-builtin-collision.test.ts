import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";

/**
 * The bug class this test exists to prevent (see CHANGELOG.md for the
 * concrete incident: `--radius-s`, renamed to `--radius-subtle`).
 *
 * Four of this package's families — radius, spacing, text (font-size), and
 * font (font-family) — are named to match a real Tailwind v4 `@theme`
 * namespace exactly (`--radius-*`, `--spacing-*`, `--text-*`, `--font-*`),
 * so `theme.css` can wire them straight into Tailwind and get a matching
 * utility class for free. That's deliberate and desired for almost every
 * token in these families.
 *
 * The hazard is narrower and easy to miss: within each of those namespaces,
 * Tailwind ALSO hardcodes a small, fixed set of utility-class suffixes that
 * are produced by their own dedicated utility function, entirely
 * independent of the `@theme` scale. When a token's suffix happens to match
 * one of those hardcoded names, nothing errors and nothing warns — but the
 * compiled CSS is wrong, in one of two ways, both confirmed against a real
 * `@tailwindcss/cli@4.3.3` compile while building this test:
 *
 *   1. SPLIT CORNERS / SPLIT PROPERTY. Tailwind emits BOTH rules on the same
 *      selector — ours and its own builtin — and because they set
 *      DIFFERENT CSS properties, both apply. This is exactly what happened
 *      with `--radius-s`: Tailwind's builtin logical-direction utility
 *      already owns the class name `rounded-s`, so the compiled output was
 *
 *        .rounded-s {
 *          border-radius: var(--radius-s, 2px);        <- ours
 *          border-start-start-radius: 0.25rem;          <- Tailwind's
 *          border-end-start-radius: 0.25rem;            <- Tailwind's
 *        }
 *
 *      i.e. two corners at 2px, two corners at Tailwind's default 0.25rem —
 *      visually broken, and invisible unless you read the compiled CSS.
 *      Verified the same way for `--text-*` against an alignment keyword:
 *      a token literally named `--text-left` compiles `.text-left` to BOTH
 *      `text-align: left` (Tailwind's) and `font-size: <ours>` (ours) on
 *      the same rule.
 *
 *   2. SILENT FULL SHADOW. In other namespaces the token's own utility is
 *      shadowed entirely — Tailwind's hardcoded utility wins outright and
 *      our value never reaches the compiled CSS at all. Verified for
 *      `--font-*` against a font-weight keyword: a token literally named
 *      `--font-thin` compiles `.font-thin` to ONLY
 *      `font-family: <ours>` — Tailwind's builtin `font-thin`
 *      (`font-weight: 100`) is gone completely, not merged, not warned
 *      about.
 *
 * Either failure mode means: a consumer writes a perfectly ordinary
 * Tailwind class, expecting either our token's value or Tailwind's builtin
 * meaning, and gets neither cleanly — a silently wrong rule. This test
 * asserts no token in a Tailwind-namespaced family uses a suffix Tailwind
 * itself reserves in that namespace.
 */

interface ReservedFamily {
  /** The CSS custom property prefix for this family, e.g. "--radius-". */
  readonly tokenPrefix: string;
  /**
   * Tailwind utility class prefix(es) this namespace's `@theme` scale
   * feeds. Radius and font map to exactly one; spacing is a shared scale
   * that many utilities read from (padding, margin, width, gap, inset, ...),
   * so a few representative ones are listed for the failure message.
   */
  readonly exampleUtilityPrefixes: readonly string[];
  /**
   * Suffixes Tailwind v4 itself reserves in this namespace — verified
   * against a real `@tailwindcss/cli@4.3.3` compile, not just the docs.
   */
  readonly reserved: readonly string[];
  /** One-line description of the failure mode this namespace produces, for the assertion message. */
  readonly failureMode: string;
}

const RESERVED_FAMILIES: Record<string, ReservedFamily> = {
  radius: {
    tokenPrefix: "--radius-",
    exampleUtilityPrefixes: ["rounded-"],
    // "none" and "full" are already Tailwind's own radius keywords (a brand
    // that wants "square corners" or "pill" already has `--radius-sharp`
    // and `--radius-pill` for exactly that reason — never reintroduce
    // Tailwind's own spelling). The rest are the logical + physical corner
    // utilities: single-letter logical sides (s/e/t/r/b/l), two-letter
    // logical corners (ss/se/ee/es), and two-letter physical corners
    // (tl/tr/br/bl).
    reserved: [
      "none", "full",
      "s", "e", "t", "r", "b", "l",
      "ss", "se", "ee", "es",
      "tl", "tr", "br", "bl",
    ],
    failureMode:
      "generates a Tailwind builtin logical/physical-corner or none/full radius utility " +
      "of the same name — compiled output carries both rules on one selector, " +
      "corrupting some corners to Tailwind's default instead of this token's value",
  },
  spacing: {
    tokenPrefix: "--spacing-",
    exampleUtilityPrefixes: ["w-", "m-", "gap-", "inset-", "p-"],
    // Verified: --spacing-auto and --spacing-px both produced a SECOND,
    // conflicting declaration of the same CSS property (e.g. `margin: auto;
    // margin: <ours>;` on one `.m-auto` rule) for at least w-/m-/inset-/gap-.
    reserved: ["px", "auto", "full"],
    failureMode:
      "generates a Tailwind builtin spacing keyword utility (at least one of " +
      "w-/m-/gap-/inset- reserves this suffix) — the compiled rule declares the " +
      "same CSS property twice, so whichever declaration Tailwind happens to " +
      "order last silently wins instead of this token's value being the only one",
  },
  text: {
    tokenPrefix: "--text-",
    exampleUtilityPrefixes: ["text-"],
    reserved: [
      // text-align
      "left", "center", "right", "justify", "start", "end",
      // text-wrap
      "wrap", "nowrap", "balance", "pretty",
      // text-overflow
      "ellipsis", "clip",
      // text-color keyword shorthands — a different Tailwind theme axis
      // (--color-*) but the SAME "text-<word>" class name space as the
      // font-size scale this family maps to; verified `--text-black`
      // compiles `.text-black` to Tailwind's `color: var(--color-black)`
      // only, never this package's font-size value.
      "inherit", "current", "transparent", "black", "white",
    ],
    failureMode:
      "generates a Tailwind builtin text-align/text-wrap/text-overflow/text-color " +
      "utility of the same name — for align/wrap/overflow the compiled rule carries " +
      "both this token's font-size AND Tailwind's builtin property on one selector; " +
      "for the color keywords Tailwind's color utility wins outright and this " +
      "token's value never reaches the compiled CSS",
  },
  font: {
    tokenPrefix: "--font-",
    exampleUtilityPrefixes: ["font-"],
    // Verified: --font-thin compiles `.font-thin` to ONLY `font-family: <ours>` —
    // Tailwind's builtin font-weight-100 utility is shadowed completely, not merged.
    reserved: [
      "thin", "extralight", "light", "normal", "medium",
      "semibold", "bold", "extrabold", "black",
    ],
    failureMode:
      "generates a Tailwind builtin font-weight utility of the same name — Tailwind's " +
      "font-weight utility wins outright, so the class silently sets font-weight " +
      "instead of font-family and this token's value never reaches the compiled CSS",
  },
};

describe("no token collides with a Tailwind builtin utility name", () => {
  for (const [family, spec] of Object.entries(RESERVED_FAMILIES)) {
    it(`--${family}-* tokens avoid Tailwind's reserved ${family} suffixes`, () => {
      const violations: string[] = [];
      for (const def of Object.values(TOKENS)) {
        if (def.family !== family) continue;
        if (!def.property.startsWith(spec.tokenPrefix)) continue; // covered by naming.test.ts
        const suffix = def.property.slice(spec.tokenPrefix.length);
        if (spec.reserved.includes(suffix)) {
          const exampleClasses = spec.exampleUtilityPrefixes.map((p) => `${p}${suffix}`).join(", ");
          violations.push(
            `${def.property} uses the reserved suffix "${suffix}": Tailwind already reserves ` +
              `${exampleClasses} — this token ${spec.failureMode}. Rename the token to a role name ` +
              `Tailwind doesn't already use (see CHANGELOG.md: --radius-s -> --radius-subtle for precedent).`,
          );
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it("covers every family this package maps onto a Tailwind @theme namespace", () => {
    // Guards the test itself: if a future token family is added under one of
    // these four Tailwind namespaces, this list must grow with it, or new
    // tokens in that family would go unchecked.
    expect(Object.keys(RESERVED_FAMILIES).sort()).toEqual(["font", "radius", "spacing", "text"]);
  });
});
