import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as definitions from "./tokens.js";
import * as publicTokens from "./index.js";
import { TOKENS, TOKEN_FAMILIES, type TokenDefinition } from "./tokens.js";
import { AA_LARGE, contrastPairsForTheme } from "./contrast-pairs.js";
import { checkTokenContrast } from "./contrast-gate.js";
import { parseRootDeclarations, parseDeclarationsForSelector } from "./internal/parse-css.js";

// Immutable pre-foundation inventory at dcf63518, independent of the candidate registry.
const legacyProperties = [
  "--color-surface-base",
  "--color-surface-sunken",
  "--color-surface-raised",
  "--color-surface-inverse",
  "--color-surface-inverse-raised",
  "--color-surface-aside",
  "--color-surface-selected",
  "--color-surface-glass",
  "--color-surface-glass-inverse",
  "--color-ink-primary",
  "--color-ink-secondary",
  "--color-ink-muted",
  "--color-ink-link",
  "--color-ink-on-inverse",
  "--color-ink-on-inverse-muted",
  "--color-ink-on-accent",
  "--color-line-base",
  "--color-line-strong",
  "--color-line-on-inverse",
  "--color-line-panel",
  "--color-accent",
  "--color-accent-text",
  "--color-accent-hover",
  "--color-accent-tint",
  "--color-accent-on-inverse",
  "--color-control-tonal",
  "--color-control-tonal-hover",
  "--color-control-tonal-inverse",
  "--color-control-tonal-inverse-hover",
  "--color-control-quiet",
  "--color-status-success",
  "--color-status-success-text",
  "--color-status-success-tint",
  "--color-status-warning",
  "--color-status-warning-text",
  "--color-status-warning-tint",
  "--color-status-danger",
  "--color-status-danger-text",
  "--color-status-danger-tint",
  "--color-status-info",
  "--color-status-info-text",
  "--color-status-info-tint",
  "--color-chart-surface",
  "--color-chart-grid",
  "--color-chart-axis",
  "--color-chart-axis-label",
  "--color-chart-categorical-1",
  "--color-chart-categorical-2",
  "--color-chart-categorical-3",
  "--color-chart-categorical-4",
  "--color-chart-categorical-5",
  "--color-chart-categorical-6",
  "--color-chart-categorical-7",
  "--color-chart-categorical-8",
  "--color-chart-sequential-100",
  "--color-chart-sequential-200",
  "--color-chart-sequential-300",
  "--color-chart-sequential-400",
  "--color-chart-sequential-500",
  "--color-chart-sequential-600",
  "--color-chart-sequential-700",
  "--color-chart-diverging-negative",
  "--color-chart-diverging-positive",
  "--color-chart-diverging-neutral",
  "--color-neutral-50",
  "--color-neutral-100",
  "--color-neutral-200",
  "--color-neutral-300",
  "--color-neutral-400",
  "--color-neutral-500",
  "--color-neutral-600",
  "--color-neutral-700",
  "--color-neutral-800",
  "--color-neutral-900",
  "--color-neutral-950",
  "--color-overlay-surface",
  "--color-overlay-border",
  "--color-overlay-scrim",
  "--color-skeleton-fill",
  "--text-display-xl",
  "--text-display-l",
  "--text-display-m",
  "--text-h0",
  "--text-h1",
  "--text-h2",
  "--text-h3",
  "--text-body-l",
  "--text-body",
  "--text-body-s",
  "--text-blockquote",
  "--text-caption",
  "--text-code-block",
  "--font-display",
  "--font-body",
  "--font-mono",
  "--tracking-tight",
  "--tracking-meta",
  "--tracking-nav",
  "--tracking-label",
  "--leading-display",
  "--leading-heading",
  "--spacing-xs",
  "--spacing-sm",
  "--spacing-md",
  "--spacing-lg",
  "--spacing-xl",
  "--spacing-2xl",
  "--spacing-3xl",
  "--spacing-4xl",
  "--spacing-5xl",
  "--spacing-6xl",
  "--ui-width-content-max",
  "--font-display-style",
  "--font-display-weight",
  "--font-display-stretch",
  "--font-display-scale-x",
  "--ui-width-display-max",
  "--ui-width-hero-wide",
  "--ui-width-prose-max",
  "--ui-width-wide-max",
  "--ui-width-form-max",
  "--ui-width-notice-max",
  "--ui-width-page-padding-x",
  "--ui-layout-sidebar-w",
  "--ui-layout-sidebar-rail-w",
  "--ui-layout-aside-w",
  "--ui-layout-drawer-w",
  "--ui-layout-tap-target",
  "--ui-density-pad",
  "--ui-density-gap",
  "--ui-density-row",
  "--ui-icon-sm",
  "--ui-icon-md",
  "--ui-icon-lg",
  "--ui-icon-stroke",
  "--ui-brandmark-height-sm",
  "--ui-brandmark-height-md",
  "--ui-brandmark-height-lg",
  "--ui-brandmark-gap-sm",
  "--ui-brandmark-gap-md",
  "--ui-brandmark-gap-lg",
  "--radius-sharp",
  "--radius-subtle",
  "--radius-default",
  "--radius-control",
  "--radius-pill",
  "--radius-surface",
  "--radius-panel",
  "--ui-border-hairline",
  "--ui-border-rule",
  "--ui-border-panel",
  "--ui-elevation-none",
  "--ui-elevation-raised",
  "--ui-elevation-floating",
  "--ui-elevation-panel",
  "--blur-glass",
  "--blur-notice",
  "--ui-ring-focus",
  "--ui-ring-on-inverse",
  "--ui-duration-instant",
  "--ui-duration-fast",
  "--ui-duration-default",
  "--ui-duration-deliberate",
  "--ui-duration-flash",
  "--ui-duration-overlay",
  "--ease-default",
  "--ease-decelerate",
  "--ease-accelerate",
  "--ease-bounce",
  "--ease-enter",
  "--ease-exit",
  "--ui-z-base",
  "--ui-z-sticky",
  "--ui-z-shell",
  "--ui-z-aside",
  "--ui-z-notice",
  "--ui-z-modal",
  "--ui-z-toast",
  "--ui-z-palette",
  "--ui-z-tooltip",
  "--breakpoint-mobile",
  "--breakpoint-mobile-lg",
  "--breakpoint-tablet",
  "--breakpoint-tablet-lg",
  "--breakpoint-desktop",
  "--breakpoint-wide",
  "--ui-scene-card-w",
  "--ui-alpha-disabled"
] as const;

const expectedNew = {
  "--ui-control-h-sm": ["32px", "control"],
  "--ui-control-h-md": ["var(--ui-layout-tap-target, 44px)", "control"],
  "--ui-control-h-lg": ["52px", "control"],
  "--ui-control-row-h": ["36px", "control"],
  "--ui-control-mark": ["16px", "control"],
  "--ui-control-switch-w": ["36px", "control"],
  "--ui-control-switch-h": ["20px", "control"],
  "--ui-control-switch-thumb": ["14px", "control"],
  "--ui-border-focus": ["2px", "border"],
  "--ui-focus-offset": ["2px", "ring"],
  "--color-focus-ring": ["var(--color-accent, oklch(0.4748 0 0))", "ring"],
  "--color-focus-ring-on-inverse": ["var(--color-ink-on-inverse, oklch(0.9702 0 0))", "ring"],
  "--ui-z-skip-link": ["100", "z"],
  "--ui-motion-shift": ["4px", "spacing"],
  "--ui-radius-overlay": ["var(--radius-control, 6px)", "radius"],
  "--ui-state-hover-alpha": ["0.08", "alpha"],
  "--ui-state-pressed-alpha": ["0.14", "alpha"],
  "--ui-duration-loading-delay": ["150ms", "duration"],
  "--ui-duration-loading-min": ["400ms", "duration"],
  "--ui-duration-loading-long": ["10000ms", "duration"],
  "--ui-z-progress": ["90", "z"],
  "--ui-alpha-stale": ["0.7", "alpha"],
  "--ui-duration-tooltip-delay": ["500ms", "duration"],
  "--ui-duration-tooltip-close": ["300ms", "duration"],
  "--ui-layout-toast-w": ["24rem", "layout"],
  "--ui-table-row-comfortable": ["48px", "density"],
  "--ui-table-row-compact": ["36px", "density"],
  "--ui-duration-confirm-hold": ["2000ms", "duration"],
  "--ui-table-max-block-default": ["min(70vh, 40rem)", "layout"],
} as const;
const css = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const root = parseRootDeclarations(css);

function actualTheme(theme: "light" | "dark"): Record<string, TokenDefinition> {
  const declarations = new Map(root);
  if (theme === "dark") {
    for (const [property, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]'))
      declarations.set(property, value);
  }
  return Object.fromEntries([...declarations].map(([property, value]) => [property, { ...TOKENS[property]!, property, value }]));
}

const requiredPairs = [
  ["focus-ring-on-base", "--color-focus-ring", "--color-surface-base"],
  ["focus-ring-on-sunken", "--color-focus-ring", "--color-surface-sunken"],
  ["focus-ring-on-raised", "--color-focus-ring", "--color-surface-raised"],
  ["focus-ring-on-overlay", "--color-focus-ring", "--color-overlay-surface"],
  ["focus-ring-on-inverse-inverse", "--color-focus-ring-on-inverse", "--color-surface-inverse"],
  ["focus-ring-on-inverse-inverse-raised", "--color-focus-ring-on-inverse", "--color-surface-inverse-raised"],
  ["focus-ring-against-accent-fill", "--color-focus-ring", "--color-surface-base"],
  ["selected-indicator-tabs", "--color-accent", "--color-surface-base"],
  ["selected-indicator-radio", "--color-accent", "--color-surface-raised"],
  ["selected-indicator-checkbox", "--color-accent", "--color-surface-raised"],
  ["selected-indicator-switch-on", "--color-accent", "--color-surface-base"],
] as const;

describe("R2 foundations exact shared-token contract", () => {
  it("adds exactly the prescribed 29 to the immutable 188, without renaming legacy identities", () => {
    expect(legacyProperties).toHaveLength(188);
    expect(Object.keys(expectedNew)).toHaveLength(29);
    const actionProperties = ["--color-action", "--color-action-hover", "--color-action-pressed", "--color-action-on-inverse", "--color-action-on-inverse-hover", "--color-ink-on-action"];
    const dockProperties = ["--ui-layout-dock-min-block", "--ui-layout-dock-default-block", "--ui-layout-dock-max-block"];
    const expected = [...legacyProperties, ...Object.keys(expectedNew), ...actionProperties, ...dockProperties].sort();
    expect(Object.keys(TOKENS).sort()).toEqual(expected);
    expect([...root.keys()].sort()).toEqual(expected);
    expect(expected).toHaveLength(226);
    expect(TOKEN_FAMILIES).toHaveLength(32);
  });

  it.each(Object.entries(expectedNew))("declares %s with its assigned role and theme-invariant default", (property, [value, family]) => {
    expect(root.get(property), "literal curated CSS default").toBe(value);
    expect(TOKENS[property]).toEqual({ property, value, family, brandable: false, themeDependent: false });
  });

  it("keeps rejected keys and theme-engine defaults outside the curated registry", () => {
    for (const property of ["--ui-z-popover", "--ui-z-consent", "--ui-sheet-vvh", "--ui-sheet-kb", "--ui-radius-control", "--default-transition-duration", "--default-transition-timing-function"]) {
      expect(root.has(property), property).toBe(false);
      expect(Object.hasOwn(TOKENS, property), property).toBe(false);
    }
  });

  it("provides internal mirrors without adding a public barrel export", () => {
    const internal = definitions as unknown as Record<string, unknown>;
    expect(internal.UI_Z_PROGRESS).toBe("var(--ui-z-progress, 90)");
    expect(internal.UI_ALPHA_STALE).toBe("var(--ui-alpha-stale, 0.7)");
    expect(internal.UI_Z_SKIP_LINK).toBe("var(--ui-z-skip-link, 100)");
    expect(internal.TOOLTIP_DELAY_MS).toBe(500);
    expect(internal.TOOLTIP_CLOSE_DELAY_MS).toBe(300);
    for (const name of ["UI_Z_PROGRESS", "UI_ALPHA_STALE", "UI_Z_SKIP_LINK", "TOOLTIP_DELAY_MS", "TOOLTIP_CLOSE_DELAY_MS"])
      expect(Object.hasOwn(publicTokens, name), name).toBe(false);
  });
});

describe("R2 focus and selected-state contrast policy", () => {
  it.each(["light", "dark"] as const)("checks the actual %s aliases without exceptions or lowered floors", theme => {
    const policy = contrastPairsForTheme(theme);
    const selected = requiredPairs.map(([id, foreground, background]) => {
      const matches = policy.filter(pair => pair.id === id);
      expect(matches, id).toHaveLength(1);
      expect(matches[0]).toMatchObject({ id, foreground, background, minimumRatio: AA_LARGE });
      expect(matches[0]?.exception, id).toBeUndefined();
      return matches[0]!;
    });
    const result = checkTokenContrast(selected, { tokens: actualTheme(theme) });
    expect(result.pairsChecked).toBe(requiredPairs.length);
    expect(result.unchecked).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
