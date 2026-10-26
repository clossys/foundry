import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCompiledCssSources } from "./scan-sources.js";

/**
 * The compiled-CSS scanner skips class tokens that start with `-` or `[`,
 * contain parentheses, or carry a bracket before the end, so an arbitrary
 * value written that way ships no rule at all. These named utilities replace
 * every such token the visual pass added; each must be defined in
 * theme-keys.css, used by its source, visible to the scanner, and present in
 * the generated CSS that ships.
 */
const packageRoot = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");

interface Replacement {
  readonly name: string;
  readonly declarations: readonly RegExp[];
  readonly source: string;
  readonly retired: readonly string[];
  /** Theme files ship through utilities.css (compiled by the consumer), not compiled.css. */
  readonly shipsIn: "compiled" | "utilities";
}

const REPLACEMENTS: readonly Replacement[] = [
  { name: "frame-main-bleed", declarations: [/&:has\(\[data-frame-bleed\]\)\s*\{\s*padding: 0;/], source: "src/frames/AppFrame.tsx", retired: ["has-[[data-frame-bleed]]:p-0"], shipsIn: "compiled" },
  { name: "frame-nav-width", declarations: [/inline-size: 0;/, /@media \(width >= 1024px\)\s*\{\s*inline-size: var\(--ui-layout-sidebar-w\);/], source: "src/frames/app-frame-layout.ts", retired: ["tablet-lg:[inline-size:var(--ui-layout-sidebar-w)]"], shipsIn: "compiled" },
  { name: "frame-panel-width", declarations: [/inline-size: 0;/, /@media \(width >= 1024px\)\s*\{\s*inline-size: var\(--frame-panel-w\);/], source: "src/frames/app-frame-layout.ts", retired: ["tablet-lg:[inline-size:var(--frame-panel-w)]"], shipsIn: "compiled" },
  { name: "frame-region-closed", declarations: [/inline-size: 0;/], source: "src/frames/app-frame-layout.ts", retired: ["[inline-size:0]"], shipsIn: "compiled" },
  { name: "first-child-shrink", declarations: [/& > :first-child\s*\{\s*min-width: 0;/], source: "src/frames/FrameDock.tsx", retired: ["[&>:first-child]:min-w-0"], shipsIn: "compiled" },
  { name: "prompt-actions-bleed", declarations: [/margin-inline: calc\(var\(--spacing-lg, 16px\) \* -1\);/, /margin-block-end: calc\(var\(--spacing-lg, 16px\) \* -1\);/], source: "src/blocks/library-board/CandidatePromptDialog.tsx", retired: ["-mx-lg", "-mb-lg"], shipsIn: "compiled" },
  { name: "canvas-domain-rail", declarations: [/width: var\(--ui-layout-sidebar-rail-w\);/, /writing-mode: vertical-rl;/], source: "src/studio/CanvasDomain.tsx", retired: ["w-[var(--ui-layout-sidebar-rail-w)]", "[writing-mode:vertical-rl]"], shipsIn: "compiled" },
  { name: "canvas-map-rail-height", declarations: [/height: var\(--ui-layout-sidebar-rail-w\);/], source: "src/components/CanvasMap.tsx", retired: ["h-[var(--ui-layout-sidebar-rail-w)]"], shipsIn: "compiled" },
  { name: "candidate-variant-min-inline", declarations: [/min-width: var\(--ui-control-h-lg\);/], source: "src/studio/CandidateCell.tsx", retired: ["min-w-[var(--ui-control-h-lg)]"], shipsIn: "compiled" },
  { name: "calendar-cell-size", declarations: [/width: var\(--ui-control-h-sm, 32px\);/, /height: var\(--ui-control-h-sm, 32px\);/], source: "src/components/Calendar.tsx", retired: ["size-[var(--ui-control-h-sm,32px)]"], shipsIn: "compiled" },
  { name: "canvas-caption-zoom-floor", declarations: [/font-size: max\(1em, calc\(var\(--text-caption\) \/ var\(--canvas-zoom, 1\)\)\);/], source: "src/blocks/canvas/CanvasLod.tsx", retired: ["text-[length:max(1em,calc(var(--text-caption)/var(--canvas-zoom,1)))]"], shipsIn: "compiled" },
  { name: "popover-arrow-rotate", declarations: [/\[data-placement="bottom"\] \*\)\s*\{\s*rotate: 180deg;/, /\[data-placement="left"\] \*\)\s*\{\s*rotate: -90deg;/, /\[data-placement="right"\] \*\)\s*\{\s*rotate: 90deg;/], source: "src/components/Popover.tsx", retired: ["group-data-[placement=bottom]:rotate-180", "group-data-[placement=left]:-rotate-90", "group-data-[placement=right]:rotate-90"], shipsIn: "compiled" },
  { name: "motion-tier-fast", declarations: [/--tw-duration: var\(--ui-duration-fast, 120ms\);/, /transition-duration: var\(--ui-duration-fast, 120ms\);/], source: "src/theme/ThemeToggle.tsx", retired: ["duration-(--ui-duration-fast)"], shipsIn: "utilities" },
];

/** Plain Tailwind variants that replace bracketed ones: the bare `data-*` form is scanner-visible. */
const VARIANT_REPLACEMENTS = [
  { name: "group-data-hovered:bg-accent", source: "src/components/Table.tsx", retired: "group-data-[hovered]:bg-accent" },
  { name: "group-data-resizing:bg-accent", source: "src/components/Table.tsx", retired: "group-data-[resizing]:bg-accent" },
  { name: "group-data-focus-visible:bg-accent", source: "src/components/Table.tsx", retired: "group-data-[focus-visible]:bg-accent" },
];

function utilityBlock(themeKeys: string, name: string): string {
  const start = themeKeys.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = themeKeys.indexOf("{", start); i < themeKeys.length; i++) {
    if (themeKeys[i] === "{") depth++;
    else if (themeKeys[i] === "}" && --depth === 0) return themeKeys.slice(start, i + 1);
  }
  return "";
}

const escapeClass = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

describe("named replacements for scanner-invisible arbitrary classes", () => {
  const themeKeys = read("styles/theme-keys.css");
  const compiled = read("styles/compiled.css");
  const utilities = read("styles/utilities.css");
  const candidates = new Set(scanCompiledCssSources(packageRoot).candidates);

  it.each(REPLACEMENTS)("$name is defined in theme-keys.css with the declarations the arbitrary class meant", ({ name, declarations }) => {
    const block = utilityBlock(themeKeys, name);
    expect(block, `@utility ${name}`).not.toBe("");
    for (const declaration of declarations) expect(block).toMatch(declaration);
  });

  it.each(REPLACEMENTS)("$name replaces the retired token in its source and ships", ({ name, source, retired, shipsIn }) => {
    const text = read(source);
    expect(text).toMatch(new RegExp(`["\\s]${name}["\\s]`));
    for (const token of retired) expect(text).not.toContain(token);
    if (shipsIn === "compiled") {
      expect(candidates.has(name), `${name} scanned`).toBe(true);
      expect(compiled).toContain(`.${escapeClass(name)}`);
    } else {
      expect(utilities).toMatch(new RegExp(`(^|[\\s"])${name}([\\s"]|$)`, "m"));
    }
  });

  it.each(VARIANT_REPLACEMENTS)("$name replaces $retired and ships in compiled.css", ({ name, source, retired }) => {
    const text = read(source);
    expect(text).toContain(name);
    expect(text).not.toContain(retired);
    expect(candidates.has(name), `${name} scanned`).toBe(true);
    expect(compiled).toContain(`.${escapeClass(name)}`);
  });
});
