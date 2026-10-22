/**
 * Coverage for the catalog manifests: each catalog's leaf ids are frozen (the
 * live manifest must equal the literal list below), and every real token,
 * glyph, atom and block this package declares or exports has exactly one
 * home. Changing a frozen list is a deliberate, reviewed edit.
 */
import { describe, expect, it } from "vitest";
import { TOKENS } from "../tokens/tokens.js";
import { TOKEN_ENTRIES, TOKEN_EXCLUSIONS } from "./index.js";
import type { TokenId } from "./types.js";

/** Frozen token leaf ids, 168. */
const FROZEN_TOKEN_IDS: readonly string[] = [
  "--color-surface-base", "--color-surface-sunken", "--color-surface-raised", "--color-surface-inverse",
  "--color-surface-inverse-raised", "--color-surface-aside", "--color-surface-selected",
  "--color-surface-glass", "--color-surface-glass-inverse", "--color-ink-primary", "--color-ink-secondary",
  "--color-ink-muted", "--color-ink-link", "--color-ink-on-inverse", "--color-ink-on-inverse-muted",
  "--color-ink-on-primary", "--color-line-base", "--color-line-strong", "--color-line-on-inverse",
  "--color-line-panel", "--color-primary", "--color-primary-text", "--color-primary-hover",
  "--color-primary-tint", "--color-primary-on-inverse", "--color-control-tonal",
  "--color-control-tonal-hover", "--color-control-tonal-inverse", "--color-control-tonal-inverse-hover",
  "--color-control-quiet", "--color-status-success", "--color-status-success-text",
  "--color-status-success-tint", "--color-status-warning", "--color-status-warning-text",
  "--color-status-warning-tint", "--color-status-danger", "--color-status-danger-text",
  "--color-status-danger-tint", "--color-status-info", "--color-status-info-text",
  "--color-status-info-tint", "--color-overlay-scrim", "--color-focus-ring", "--color-focus-ring-inverse",
  "--color-neutral-50", "--color-neutral-100", "--color-neutral-200", "--color-neutral-300",
  "--color-neutral-400", "--color-neutral-500", "--color-neutral-600", "--color-neutral-700",
  "--color-neutral-800", "--color-neutral-900", "--color-neutral-950", "--color-chart-grid",
  "--color-chart-categorical-1", "--color-chart-categorical-2", "--color-chart-categorical-3",
  "--color-chart-categorical-4", "--color-chart-categorical-5", "--color-chart-categorical-6",
  "--color-chart-categorical-7", "--color-chart-categorical-8", "--color-chart-sequential-100",
  "--color-chart-sequential-200", "--color-chart-sequential-300", "--color-chart-sequential-400",
  "--color-chart-sequential-500", "--color-chart-sequential-600", "--color-chart-sequential-700",
  "--font-display", "--font-sans", "--font-mono", "--font-display--font-variation-settings",
  "--font-display--font-feature-settings", "--ui-display-weight", "--ui-display-style",
  "--ui-display-stretch", "--ui-display-scale-x", "--font-weight-normal", "--font-weight-medium",
  "--font-weight-semibold", "--text-xs", "--text-xs--line-height", "--text-sm", "--text-sm--line-height",
  "--text-base", "--text-base--line-height", "--text-lg", "--text-lg--line-height", "--text-xl",
  "--text-xl--line-height", "--text-2xl", "--text-2xl--line-height", "--text-3xl", "--text-3xl--line-height",
  "--text-4xl", "--text-4xl--line-height", "--text-5xl", "--text-5xl--line-height", "--text-6xl",
  "--text-6xl--line-height", "--text-7xl", "--text-7xl--line-height", "--tracking-tight", "--tracking-wider",
  "--tracking-widest", "--leading-tight", "--leading-snug", "--spacing", "--breakpoint-sm",
  "--breakpoint-md", "--breakpoint-lg", "--breakpoint-xl", "--breakpoint-2xl", "--container-content",
  "--container-reading", "--container-wide", "--container-form", "--container-notice",
  "--ui-layout-sidebar-w", "--ui-layout-sidebar-rail-w", "--ui-layout-aside-w", "--ui-layout-drawer-w",
  "--ui-layout-gutter", "--ui-layout-tap-target", "--radius-xs", "--radius-sm", "--radius-md",
  "--radius-panel", "--ui-border-hairline", "--ui-border-rule", "--ui-border-panel", "--ui-focus-width",
  "--ui-focus-offset", "--ui-icon-stroke", "--ui-icon-sm", "--ui-icon-md", "--ui-icon-lg", "--shadow-raised",
  "--shadow-floating", "--shadow-panel", "--blur-glass", "--blur-notice", "--ui-z-base", "--ui-z-sticky",
  "--ui-z-shell", "--ui-z-aside", "--ui-z-notice", "--ui-z-modal", "--ui-z-popover", "--ui-z-toast",
  "--ui-z-palette", "--ui-z-tooltip", "--ui-z-skip-link", "--ease-standard", "--ease-out", "--ease-in",
  "--ui-duration-instant", "--ui-duration-fast", "--ui-duration-default", "--ui-duration-deliberate",
  "--default-transition-duration", "--default-transition-timing-function", "--animate-spin",
  "--animate-pulse",
];

/** Ids that appear more than once in a list. */
function duplicates(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

/** Every alias a token value or per-mode value names. */
function aliases(value: unknown): TokenId[] {
  if (!value || typeof value !== "object") return [];
  if ("alias" in value) return [(value as { alias: TokenId }).alias];
  return Object.values(value).flatMap(aliases);
}

describe("token catalog coverage", () => {
  const ids = TOKEN_ENTRIES.map((entry) => entry.id);

  it("matches the frozen id list exactly, 168 leaves", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(FROZEN_TOKEN_IDS).toHaveLength(168);
    expect(ids).toHaveLength(168);
    expect([...ids].sort()).toEqual([...FROZEN_TOKEN_IDS].sort());
  });

  it("accounts for every declared token exactly once: as a leaf, a previous id or an exclusion", () => {
    const declared = Object.keys(TOKENS);
    expect(declared.length).toBeGreaterThan(0);
    const homes = [
      ...ids.filter((id) => id in TOKENS),
      ...TOKEN_ENTRIES.flatMap((entry) => entry.previousIds),
      ...Object.keys(TOKEN_EXCLUSIONS),
    ];
    expect(duplicates(homes)).toEqual([]);
    expect(declared.filter((id) => !homes.includes(id))).toEqual([]);
    expect(homes.filter((id) => !(id in TOKENS))).toEqual([]);
  });

  it("names only catalog leaves in aliases, fallbacks and contrast pairs", () => {
    const known = new Set<string>(ids);
    const named = TOKEN_ENTRIES.flatMap((entry) => [
      ...aliases(entry.reference),
      ...aliases(entry.fallback),
      ...entry.pairs.flatMap((pair) => [pair.fg, pair.bg, ...aliases(pair.over)]),
    ]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !known.has(id))).toEqual([]);
  });

  it("keeps per-mode references and fallbacks in step with the mode shape", () => {
    for (const entry of TOKEN_ENTRIES) {
      const perMode = entry.modes === "per-mode";
      expect("light" in entry.reference, entry.id).toBe(perMode);
      if (entry.fallback) expect("light" in entry.fallback, entry.id).toBe(perMode);
    }
  });

  it("parks exactly the data colours", () => {
    const parked = TOKEN_ENTRIES.filter((entry) => entry.tier === "parked");
    expect(parked.map((entry) => entry.l2)).toEqual(Array(16).fill("data"));
    for (const entry of TOKEN_ENTRIES) expect(entry.lifecycle === "parked", entry.id).toBe(entry.tier === "parked");
  });

  it("puts only Tailwind namespace keys in the theme", () => {
    for (const entry of TOKEN_ENTRIES) expect(entry.inTheme, entry.id).toBe(!entry.id.startsWith("--ui-"));
  });
});
