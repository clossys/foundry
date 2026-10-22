/**
 * Coverage for the catalog manifests: each catalog's leaf ids are frozen (the
 * live manifest must equal the literal list below), and every real token,
 * glyph, atom and block this package declares or exports has exactly one
 * home. Changing a frozen list is a deliberate, reviewed edit.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ATOM_EXPORTS from "../atoms/index.js";
import * as BLOCK_EXPORTS from "../blocks/index.js";
import * as CHART_EXPORTS from "../charts/index.js";
import * as ICON_EXPORTS from "../icons/index.js";
import * as SHELL_EXPORTS from "../shell/index.js";
import { IDENTITY_VARIANT_ROLES } from "../tokens/identity-kit.js";
import { TOKENS } from "../tokens/tokens.js";
import {
  ASSET_ENTRIES,
  ATOM_ENTRIES,
  ATOM_EXPORT_EXCLUSIONS,
  BLOCK_ENTRIES,
  BLOCK_EXPORT_EXCLUSIONS,
  ICON_ENTRIES,
  TOKEN_ENTRIES,
  TOKEN_EXCLUSIONS,
} from "./index.js";
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

/** Frozen asset slot ids, 19. */
const FROZEN_ASSET_IDS: readonly string[] = [
  "logo.lockup.primary", "logo.lockup.on-dark", "logo.lockup.light", "logo.mark.primary", "logo.mark.mono",
  "logo.display.sm", "logo.display.md", "logo.display.lg",
  "favicon.svg", "favicon.ico", "app-icon.apple", "app-icon.192", "app-icon.512", "app-icon.maskable", "manifest",
  "imagery.ratios", "imagery.treatment", "imagery.alt", "imagery.budget",
];

/** Frozen glyph ids, 40. */
const FROZEN_ICON_IDS: readonly string[] = [
  "ChevronDown", "ChevronUp", "ChevronLeft", "ChevronRight", "ArrowRight", "ExternalLink",
  "Search", "X", "Check", "Settings", "List", "Grid3x3",
  "AlertTriangle", "CheckCircle", "XCircle", "Info",
  "Sun", "Moon", "Monitor",
  "User", "Users",
  "Home", "Building2", "Globe", "Landmark",
  "BookOpen", "FileText", "FileCheck", "Folder",
  "Calendar", "Clock",
  "CreditCard", "Receipt", "Briefcase",
  "ShieldCheck", "Lock", "Scale",
  "Box", "Layers", "Plug",
];

/** Frozen atom leaf ids, 78. */
const FROZEN_ATOM_IDS: readonly string[] = [
  "act.button", "act.icon-button", "act.menu", "act.toolbar", "act.toggle-button",
  "act.link", "act.breadcrumb", "reveal.tabs", "act.navigation-tree",
  "enter.text-field", "enter.textarea", "enter.search-field", "enter.token-field",
  "enter.checkbox", "enter.checkbox-group", "enter.switch", "enter.radio-group", "enter.segmented-control",
  "enter.select", "enter.combo-box", "enter.listbox", "enter.tag-field",
  "enter.number-field", "enter.slider",
  "enter.date-field", "enter.time-field", "enter.calendar", "enter.range-calendar", "enter.date-picker",
  "enter.date-range-picker",
  "enter.color-field", "enter.color-picker", "enter.color-area", "enter.color-slider", "enter.color-wheel",
  "depict.color-swatch", "enter.color-swatch-picker",
  "enter.file-trigger", "enter.drop-zone",
  "enter.field", "enter.form",
  "inform.badge", "inform.chip", "inform.meter", "group.table", "group.grid-list", "group.tree",
  "depict.text", "depict.kbd",
  "depict.avatar", "depict.icon", "depict.logomark",
  "depict.bar-chart", "depict.line-chart", "depict.sparkline", "depict.waterfall-chart", "depict.range-chart",
  "depict.scatter-chart", "depict.area-chart", "depict.heatmap", "depict.status-strip",
  "inform.banner", "inform.status-mark", "inform.toast",
  "inform.progress-bar", "inform.spinner", "inform.skeleton",
  "group.card", "group.separator", "reveal.disclosure", "reveal.accordion", "group.group", "enter.resize-handle",
  "reveal.dialog", "reveal.popover", "reveal.tooltip", "reveal.sheet", "reveal.preview-card",
];

/** Frozen block leaf ids, 84. */
const FROZEN_BLOCK_IDS: readonly string[] = [
  "say.hero", "say.page-header", "say.section-header", "say.section-intro", "say.takeaway", "say.chapter",
  "items.features", "items.statement", "items.feature-grid",
  "say.testimonial", "say.testimonial-set", "items.logo-cloud", "items.people-grid",
  "say.media-figure", "items.media-gallery",
  "prose.article", "items.faq", "items.legacy-faq", "say.info-tip",
  "items.steps", "items.ordered-step-sequence", "items.timeline",
  "say.lockup",
  "items.specimen-stack", "say.specimen", "matrix.specimen-panel", "say.anatomy-callouts", "matrix.scene",
  "items.raw", "items.item", "items.cards", "items.task-list",
  "matrix.raw", "matrix.comparison", "matrix.pricing",
  "items.stat", "items.stat-grid", "items.status-list", "items.usage-meter",
  "matrix.data-table", "matrix.detail", "items.record-ledger", "matrix.grouped-table", "items.resource-list",
  "matrix.data-grid",
  "items.event-item", "items.activity-feed", "matrix.audit-log",
  "matrix.panel", "matrix.drawer", "matrix.resizable-pane", "matrix.catalog-workspace",
  "form.form", "form.newsletter-band", "form.form-wizard", "form.field-group", "form.file-field",
  "form.column-mapper", "form.settings-section", "form.save-bar", "matrix.access-matrix", "form.chat",
  "items.link-index", "items.topics", "items.nav-grid",
  "items.app-navigation", "form.account-menu", "form.command-menu", "items.page-bar",
  "items.tree", "items.explorer", "prose.table-of-contents", "form.toolbar", "form.bulk-action-bar",
  "form.pagination", "form.load-more", "form.filter-builder",
  "say.empty-state", "say.error-state", "form.confirm-dialog", "form.consent-banner",
  "say.notice-stack", "form.refresh-status", "items.notification-center",
  "matrix.catalog-browser",
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

describe("icon catalog coverage", () => {
  const ids = ICON_ENTRIES.map((entry) => entry.id);
  const exported = Object.keys(ICON_EXPORTS);

  it("matches the frozen id list exactly, 40 glyphs", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(FROZEN_ICON_IDS).toHaveLength(40);
    expect(ids).toHaveLength(40);
    expect([...ids].sort()).toEqual([...FROZEN_ICON_IDS].sort());
  });

  it("places every exported glyph exactly once, and nothing else", () => {
    expect(exported.length).toBeGreaterThan(0);
    expect([...exported].sort()).toEqual([...ids].sort());
  });

  it("vendors each exported glyph's own data", () => {
    const glyphs = ICON_EXPORTS as unknown as Record<string, unknown>;
    for (const entry of ICON_ENTRIES) expect(entry.nodes, entry.id).toBe(glyphs[entry.id]);
  });
});

describe("asset catalog coverage", () => {
  const ids = ASSET_ENTRIES.map((entry) => entry.id);

  it("matches the frozen id list exactly, 19 slots", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(FROZEN_ASSET_IDS).toHaveLength(19);
    expect(ids).toHaveLength(19);
    expect([...ids].sort()).toEqual([...FROZEN_ASSET_IDS].sort());
  });

  it("gives every identity-kit role a slot", () => {
    const roles = new Set(ASSET_ENTRIES.map((entry) => entry.role));
    expect(IDENTITY_VARIANT_ROLES.filter((role) => !roles.has(role))).toEqual([]);
  });

  it("carries exactly the brandmark tokens the token catalog moved here", () => {
    const moved = Object.entries(TOKEN_EXCLUSIONS)
      .filter(([, reason]) => reason.includes("assets catalog"))
      .map(([id]) => id);
    const carried = ASSET_ENTRIES.flatMap((entry) => entry.display?.tokens ?? []);
    expect(moved).toHaveLength(6);
    expect(duplicates(carried)).toEqual([]);
    expect([...carried].sort()).toEqual([...moved].sort());
  });

  it("keeps display metrics on display slots only, and files off rule slots", () => {
    for (const entry of ASSET_ENTRIES) {
      expect(entry.display !== undefined, entry.id).toBe(entry.kind === "display");
      if (entry.kind !== "file") expect(entry.files, entry.id).toEqual([]);
    }
  });
});

describe("atom catalog coverage", () => {
  const ids = ATOM_ENTRIES.map((entry) => entry.id);
  const leafExports = ATOM_ENTRIES.flatMap((entry) => (entry.export === null ? [] : [entry.export]));
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("matches the frozen id list exactly, 78 leaves", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(FROZEN_ATOM_IDS).toHaveLength(78);
    expect(ids).toHaveLength(78);
    expect([...ids].sort()).toEqual([...FROZEN_ATOM_IDS].sort());
  });

  it("places every atom and chart export exactly once: as a leaf or an exclusion", () => {
    const exported = [...Object.keys(ATOM_EXPORTS), ...Object.keys(CHART_EXPORTS)];
    expect(duplicates(exported)).toEqual([]);
    const accounted = [...leafExports.filter((name) => name !== "Toaster"), ...Object.keys(ATOM_EXPORT_EXCLUSIONS)];
    expect(duplicates(accounted)).toEqual([]);
    expect([...exported].sort()).toEqual([...accounted].sort());
  });

  it("registers the shell's toast once, from the shell entry", () => {
    expect(Object.keys(SHELL_EXPORTS)).toContain("Toaster");
    expect(leafExports.filter((name) => name === "Toaster")).toHaveLength(1);
  });

  it("counts 47 leaves on the default branch (9 parked), 14 in flight and 17 gaps", () => {
    const count = (status: string) => ATOM_ENTRIES.filter((entry) => entry.status === status).length;
    expect([count("main"), count("parked"), count("in-flight"), count("gap")]).toEqual([38, 9, 14, 17]);
  });

  it("gives built leaves an export and real files, and unbuilt leaves neither", () => {
    for (const entry of ATOM_ENTRIES) {
      const built = entry.status === "main" || entry.status === "parked";
      expect(entry.export !== null, entry.id).toBe(built);
      expect(entry.files.length > 0, entry.id).toBe(built);
      for (const file of entry.files) expect(existsSync(join(packageRoot, file)), file).toBe(true);
    }
  });

  it("parks exactly the charts", () => {
    for (const entry of ATOM_ENTRIES) {
      expect(entry.status === "parked", entry.id).toBe(entry.l2 === "charts");
      expect(entry.disposition === "park", entry.id).toBe(entry.l2 === "charts");
    }
  });
});

describe("block catalog coverage", () => {
  const ids = BLOCK_ENTRIES.map((entry) => entry.id);
  const byId = new Map(BLOCK_ENTRIES.map((entry) => [entry.id, entry]));

  it("matches the frozen id list exactly, 85 leaves", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(FROZEN_BLOCK_IDS).toHaveLength(85);
    expect(ids).toHaveLength(85);
    expect([...ids].sort()).toEqual([...FROZEN_BLOCK_IDS].sort());
  });

  it("places every blocks export exactly once: as a leaf or an exclusion", () => {
    const exported = Object.keys(BLOCK_EXPORTS);
    const leafExports = BLOCK_ENTRIES.flatMap((entry) => (entry.export === null ? [] : [entry.export]));
    const accounted = [...leafExports, ...Object.keys(BLOCK_EXPORT_EXCLUSIONS)];
    expect(duplicates(accounted)).toEqual([]);
    expect([...exported].sort()).toEqual([...accounted].sort());
  });

  it("points every recipe at a built leaf with its own export", () => {
    for (const entry of BLOCK_ENTRIES) {
      if (entry.recipeOf === undefined) continue;
      const host = byId.get(entry.recipeOf);
      expect(host?.export, entry.id).toEqual(expect.any(String));
      expect(host?.recipeOf, entry.id).toBeUndefined();
    }
  });

  it("names successors that are live leaves", () => {
    for (const entry of BLOCK_ENTRIES) {
      if (entry.successor === undefined) continue;
      expect(byId.get(entry.successor)?.lifecycle, entry.id).toBe("draft");
    }
  });

  it("counts 4 deprecated, 58 draft and built, 23 not built", () => {
    const deprecated = BLOCK_ENTRIES.filter((entry) => entry.lifecycle === "deprecated").length;
    const draftBuilt = BLOCK_ENTRIES.filter((entry) => entry.lifecycle === "draft" && entry.built !== "no").length;
    const notBuilt = BLOCK_ENTRIES.filter((entry) => entry.built === "no").length;
    expect([deprecated, draftBuilt, notBuilt]).toEqual([4, 58, 23]);
  });

  it("marks exactly the four leaves with exact specimens as stable candidates", () => {
    const candidates = BLOCK_ENTRIES.filter((entry) => entry.stableCandidate).map((entry) => entry.id);
    expect([...candidates].sort()).toEqual(["form.form", "prose.article", "say.empty-state", "say.page-header"]);
  });
});
