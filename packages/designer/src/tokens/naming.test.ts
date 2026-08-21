import { describe, expect, it } from "vitest";
import { TOKENS, TOKEN_FAMILIES, type TokenFamily } from "./tokens.js";

/**
 * Every token in this package falls into exactly one of two naming cases
 * (see the README's "Naming convention" section and tokens.css's own header
 * comment for the full rationale):
 *
 *   1. Tailwind v4 has a `@theme` namespace for this kind of value — the
 *      property uses that namespace's exact prefix, unmodified, so
 *      `theme.css` can wire it into a matching Tailwind utility.
 *   2. Tailwind has no namespace for it — the property is prefixed `--ui-`
 *      instead, so it can't collide with a consumer's own custom
 *      properties. Nothing in this case generates a Tailwind utility.
 *
 * This test asserts every one of the 24 families sits in the case its
 * README family-prefix mapping below says it does, and that no property
 * name falls outside both cases (a bare, uncategorized name).
 */

const TAILWIND_NAMESPACE_PREFIX: Record<string, string> = {
  surface: "--color-surface-",
  ink: "--color-ink-",
  line: "--color-line-",
  accent: "--color-accent-",
  status: "--color-status-",
  chart: "--color-chart-",
  neutral: "--color-neutral-",
  overlay: "--color-overlay-",
  skeleton: "--color-skeleton-",
  text: "--text-",
  font: "--font-",
  tracking: "--tracking-",
  spacing: "--spacing-",
  radius: "--radius-",
  easing: "--ease-",
  breakpoint: "--breakpoint-",
};

const UI_NAMESPACE_PREFIX: Record<string, string> = {
  width: "--ui-width-",
  layout: "--ui-layout-",
  density: "--ui-density-",
  icon: "--ui-icon-",
  border: "--ui-border-",
  elevation: "--ui-elevation-",
  ring: "--ui-ring-",
  duration: "--ui-duration-",
  z: "--ui-z-",
  alpha: "--ui-alpha-",
};

/**
 * A property "matches" a family prefix either by starting with it
 * (`--color-surface-raised` under `--color-surface-`) OR by being the
 * prefix's own bare root with the trailing hyphen removed
 * (`--color-accent` under `--color-accent-` — the family's own un-suffixed
 * token, e.g. the accent color itself rather than one of its variants).
 */
function matchesFamilyPrefix(property: string, prefix: string): boolean {
  const root = prefix.endsWith("-") ? prefix.slice(0, -1) : prefix;
  return property === root || property.startsWith(prefix);
}

describe("naming: Tailwind-namespace vs --ui- prefix", () => {
  it("the two prefix tables together cover every declared family, with no overlap", () => {
    const tailwindFamilies = Object.keys(TAILWIND_NAMESPACE_PREFIX);
    const uiFamilies = Object.keys(UI_NAMESPACE_PREFIX);
    const overlap = tailwindFamilies.filter((f) => uiFamilies.includes(f));
    expect(overlap).toEqual([]);
    const covered = new Set([...tailwindFamilies, ...uiFamilies]);
    const missing = TOKEN_FAMILIES.filter((f) => !covered.has(f));
    expect(missing).toEqual([]);
  });

  it("every Tailwind-namespace family's tokens use that namespace's exact prefix", () => {
    const violations: string[] = [];
    for (const def of Object.values(TOKENS)) {
      const prefix = TAILWIND_NAMESPACE_PREFIX[def.family as TokenFamily];
      if (prefix === undefined) continue; // a --ui- family, checked below
      if (!matchesFamilyPrefix(def.property, prefix)) {
        violations.push(`${def.property} (family "${def.family}") does not start with "${prefix}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("every no-Tailwind-namespace family's tokens carry the --ui- prefix", () => {
    const violations: string[] = [];
    for (const def of Object.values(TOKENS)) {
      const prefix = UI_NAMESPACE_PREFIX[def.family as TokenFamily];
      if (prefix === undefined) continue; // a Tailwind-namespace family, checked above
      if (!def.property.startsWith("--ui-")) {
        violations.push(`${def.property} (family "${def.family}") is missing the --ui- prefix`);
      }
      if (!matchesFamilyPrefix(def.property, prefix)) {
        violations.push(`${def.property} (family "${def.family}") does not start with "${prefix}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no token is left bare — every property matches one of the two cases", () => {
    const allPrefixes = [...Object.values(TAILWIND_NAMESPACE_PREFIX), ...Object.values(UI_NAMESPACE_PREFIX)];
    const bare = Object.values(TOKENS)
      .map((def) => def.property)
      .filter((property) => !allPrefixes.some((prefix) => matchesFamilyPrefix(property, prefix)));
    expect(bare).toEqual([]);
  });

  it("no --ui- token accidentally also matches a Tailwind namespace prefix", () => {
    const tailwindPrefixes = Object.values(TAILWIND_NAMESPACE_PREFIX);
    const collisions = Object.values(TOKENS)
      .filter((def) => def.property.startsWith("--ui-"))
      .filter((def) => tailwindPrefixes.some((prefix) => def.property.startsWith(prefix)))
      .map((def) => def.property);
    expect(collisions).toEqual([]);
  });
});
