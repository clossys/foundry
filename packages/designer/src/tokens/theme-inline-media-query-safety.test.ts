import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { parseDeclarationsForSelector } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const themeCss = readFileSync(join(packageRoot, "styles", "theme.css"), "utf8");

const themeInline = parseDeclarationsForSelector(themeCss, "@theme inline");

/**
 * `styles/theme.css`'s `@theme inline { ... }` block deliberately declares
 * every entry as a self-reference, `--token: var(--token, <default>);` (see
 * the file's own header comment), so a consumer's brand.css override of the
 * plain custom property is still picked up by the generated Tailwind
 * utility. That pattern is correct and load-bearing for an ordinary
 * PROPERTY VALUE — `background-color: var(--color-accent, oklch(...))` is
 * valid CSS and resolves at paint time either way.
 *
 * It is fatal for exactly two Tailwind `@theme` namespaces: `--breakpoint-*`
 * and `--container-*`. `@theme inline` substitutes the declared VALUE
 * (whatever text follows the colon) directly into the generated utility's
 * MEDIA-QUERY CONDITION, not into a property value:
 *
 *   --breakpoint-tablet: var(--breakpoint-tablet, 768px);
 *   =>  @media (width >= var(--breakpoint-tablet, 768px)) { .tablet\:.. { .. } }
 *
 * A `@media`/`@container` condition cannot contain `var()` — browsers only
 * resolve custom properties inside property values, never inside an at-rule
 * prelude. Verified against a real `tailwindcss@4.3.3` compile while writing
 * this test:
 *   - `--breakpoint-*` self-referenced this way: Tailwind emits the media
 *     query text VERBATIM, producing literally invalid CSS
 *     (`@media (width >= var(--breakpoint-tablet, 768px))`) that fails to
 *     parse, taking every rule after it in the cascade down with it — the
 *     originally reported symptom was a consuming app's entire stylesheet
 *     failing to parse (every route 500s in dev) the moment it used any
 *     `tablet:`/`desktop:`/`wide:` utility.
 *   - `--container-*` self-referenced the same way: Tailwind can't resolve a
 *     numeric container-query length from a `var()` reference and silently
 *     emits NO rule at all for that variant — a different failure mode
 *     (silent omission vs. a parse-breaking media condition) but the same
 *     root cause and the same "never works" outcome for a consumer.
 *
 * This package ships no `--container-*` tokens today, but the guard below
 * covers the namespace anyway so a future one can't reintroduce this bug
 * silently.
 */
const MEDIA_QUERY_FAMILIES = ["breakpoint", "container"] as const;

describe("@theme inline entries that generate a media-query condition never contain var()", () => {
  it("every --breakpoint-*/--container-* entry in theme.css's @theme inline block is a literal value", () => {
    const violations: string[] = [];
    for (const [name, value] of themeInline) {
      const def = TOKENS[name as keyof typeof TOKENS];
      const family = def?.family;
      const isMediaQueryFamily =
        (family && (MEDIA_QUERY_FAMILIES as readonly string[]).includes(family)) ||
        MEDIA_QUERY_FAMILIES.some((f) => name.startsWith(`--${f}-`));
      if (!isMediaQueryFamily) continue;
      if (value.includes("var(")) {
        violations.push(
          `${name}: ${value} — a media-query condition cannot resolve var(), ` +
            "so this must be a literal length, not the self-referential form " +
            "the rest of this block uses",
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("covers every breakpoint token this package declares", () => {
    const breakpointNames = Object.values(TOKENS)
      .filter((def) => def.family === "breakpoint")
      .map((def) => def.property)
      .sort();
    expect(breakpointNames.length).toBeGreaterThan(0);
    const declaredInTheme = breakpointNames.filter((name) => themeInline.has(name));
    expect(declaredInTheme).toEqual(breakpointNames);
  });
});
