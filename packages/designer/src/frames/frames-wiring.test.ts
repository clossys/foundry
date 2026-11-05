// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkWiring, foundryWiringExceptions, type WiringFinding, type WiringInput } from "../catalog-core/wiring.js";
import { DS_ATTR } from "../catalog-core/provenance-attrs.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import { InspectorFrame } from "./InspectorFrame.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "./right-panel-config.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { SiteFooter } from "../shell/SiteFooter.js";
import { SiteHeader } from "../shell/SiteHeader.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);


/**
 * WIRE-4: the frame layer composes components. `checkWiring` runs over every
 * source under `src/frames` and `src/shell`. Layout reads are proposed
 * `layout-geometry` rows in `catalog/rules/wiring-exceptions.json` (WL9
 * warnings). Everything else this unit could not remove inside its allowed
 * scope is enumerated in RESIDUALS below, each tagged with the NEED or owner
 * item that removes it: the list may only shrink, and a new finding fails.
 */
const pkg = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, pkg), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(new URL(dir, pkg), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);

interface ConsumptionFill { slot: string; sourceFiles?: string[] }
const fills = (report: string): ConsumptionFill[] => (JSON.parse(read(report)) as { fills: ConsumptionFill[] }).fills;
const local = (file: string): string => file.replace(/^packages\/designer\//, "");

/**
 * A file under `src/shell` that is the registered fill of a `components.*` slot
 * (and backs no `frames.*` fill) is a Component, which reads tokens freely (A5).
 * Derived from the generated consumption reports, never hand-listed.
 */
const frameFiles = new Set(fills("src/catalog/reports/sections-frames-consumption.json").filter(fill => fill.slot.startsWith("frames.")).flatMap(fill => (fill.sourceFiles ?? []).map(local)));
const componentFiles = new Set(fills("src/catalog/reports/components-consumption.json").flatMap(fill => (fill.sourceFiles ?? []).map(local)).filter(file => /^src\/(?:frames|shell)\//.test(file) && !frameFiles.has(file)));

const isSource = (path: string): boolean => /\.(?:tsx?|css)$/.test(path) && !/\.test\.tsx?$|\.check\.tsx$/.test(path);
const sources: WiringInput["sources"] = [...walk("src/frames"), ...walk("src/shell")]
  .filter(path => isSource(path) && !componentFiles.has(path))
  .map(path => ({ path, content: read(path), layer: "frames" as const }));

const run = (input: Partial<WiringInput> = {}) => checkWiring({
  sources,
  themes: JSON.parse(read("src/catalog/slots/themes.json")) as WiringInput["themes"],
  // `styles/theme.css` imports `theme-keys.css`; its `@theme inline` keys are what expand utilities into token reads.
  themeCss: read("styles/theme-keys.css"),
  exceptions: foundryWiringExceptions(),
  ...input,
});
const errors = (findings: readonly WiringFinding[], code: string) => findings.filter(row => row.code === code && row.severity === "error").map(row => `${row.file}:${row.line} ${row.evidence}`);

/**
 * Residuals: findings this unit could not remove inside its allowed scope. Shrink-only: each test
 * compares for equality, so a fix must delete its entry and a new finding fails.
 * "frame-geometry utilities": z-index, divider widths, page inset, region widths and tap minimums
 * still go through inline styles, because `compiled-css/class-scan.ts` drops `(--var)` utility
 * shorthand and a named `@utility` lives in `styles/theme-keys.css`, outside this unit.
 */
const LAYOUT_READ = /^themes\.spacing\./;
const WL2_RESIDUAL_READS: Record<string, string[]> = {
  // NEED-c frame chrome text/surface component
  "src/frames/AppFrame.specimen.tsx": ["themes.border.default", "themes.card.default", "themes.muted-foreground.default", "themes.muted-foreground.default", "themes.radius.default"],
  // NEED-c frame chrome text/surface component
  "src/frames/AppFrame.tsx": ["themes.background.default", "themes.border.default", "themes.foreground.default", "themes.primary.default", "themes.radius.default", "themes.ring.default"],
  // NEED-c frame chrome text/surface component
  "src/frames/FrameDock.tsx": ["themes.border.default", "themes.card.default", "themes.radius.default"],
  // NEED-c frame chrome text/surface component
  "src/frames/InspectorFrame.tsx": ["themes.border.default"],
  // NEED-c frame chrome text/surface component
  "src/frames/app-frame-layout.ts": ["themes.background.default", "themes.card.default"],
  // NEED-c frame chrome text/surface component
  "src/shell/NavDisclosure.tsx": ["themes.foreground.default", "themes.foreground.default", "themes.input.default", "themes.muted.default", "themes.primary.default"],
  // NEED-c frame chrome text/surface component
  "src/shell/Shell.tsx": ["themes.border.default", "themes.sidebar.default"],
  // NEED-c frame chrome text/surface component
  "src/shell/SiteFooter.tsx": ["themes.background.default", "themes.border.default", "themes.font-sans.default", "themes.foreground.default"],
  // NEED-c frame chrome text/surface component
  "src/shell/SiteHeader.tsx": ["themes.foreground.default", "themes.foreground.default"],
  // NEED-c frame chrome text/surface component
  "src/shell/SkipLink.tsx": ["themes.accent-foreground.default", "themes.primary.default", "themes.radius.default"],
  // NEED-c surface-ground: the packet admits only layout-geometry rows
  "src/shell/internal/shell-ground.ts": ["themes.background.default", "themes.border.default", "themes.border.default", "themes.card.default", "themes.foreground.default", "themes.foreground.default", "themes.foreground.default", "themes.muted-foreground.default"],
};
const WL3_RESIDUAL = [
  // NEED-c direction provider component: AppFrame passes `dir` through ModalContext/PopoverContext.
  "src/frames/AppFrame.tsx Headless-engine import react-aria-components above Components; compose a components.* leaf instead",
  // owner: the peer-version guard reads the engine's package.json, which WL3 counts as an engine import.
  "src/shell/index.ts Headless-engine import react-aria-components/package.json above Components; compose a components.* leaf instead",
];
const WL4_RESIDUAL_COUNTS: Record<string, { count: number; need: string }> = {
  "src/frames/AppFrame.tsx": { count: 5, need: "NEED-c frame-geometry utilities" },
  "src/frames/FrameStage.tsx": { count: 4, need: "NEED-c frame-geometry utilities" },
  "src/shell/NavDisclosure.tsx": { count: 4, need: "NEED-c frame-geometry utilities" },
  "src/shell/Shell.tsx": { count: 34, need: "NEED-c layout grid primitive and frame-geometry utilities" },
  "src/shell/SiteFooter.tsx": { count: 11, need: "NEED-c frame-geometry utilities; NEED-c Brandmark plate part for the home plate" },
  "src/shell/SiteHeader.tsx": { count: 10, need: "NEED-c frame-geometry utilities" },
  "src/shell/SkipLink.tsx": { count: 1, need: "NEED-c frame-geometry utilities" },
  "src/shell/internal/shell-vars.ts": { count: 18, need: "owner: fallback deletion breaks pins outside this unit (blocks ConsentBanner, frame-parity-controls, Brandmark golden)" },
};
const withoutLine = (row: string): string => row.replace(/^(\S+):\d+ /, "$1 ");
const countByFile = (rows: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) { const file = row.slice(0, row.indexOf(":")); counts[file] = (counts[file] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};
const residualReads = (findings: readonly WiringFinding[]): Record<string, string[]> => {
  const reads: Record<string, string[]> = {};
  for (const row of findings) if (row.code === "WL2" && row.severity === "error") (reads[row.file] ??= []).push(/reads (\S+) directly/.exec(row.evidence)![1]!);
  return Object.fromEntries(Object.entries(reads).map(([file, list]) => [file, list.sort()]));
};

describe("frames from components (WIRE-4)", () => {
  it("scans the frame layer and leaves only registered component fills to the component layer", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map(source => source.path)).toEqual(expect.arrayContaining(["src/frames/AppFrame.tsx", "src/frames/right-panel-config.ts", "src/shell/SiteHeader.tsx", "src/shell/internal/shell-vars.ts"]));
    expect([...componentFiles].sort()).toEqual(["src/shell/Brandmark.tsx", "src/shell/Toaster.tsx", "src/shell/internal/toast-queue.ts"]);
  });

  it("reads no token directly outside a layout-geometry row, apart from the NEED-tagged residual reads (WL2)", () => {
    expect(residualReads(run().findings)).toEqual(WL2_RESIDUAL_READS);
    for (const reads of Object.values(WL2_RESIDUAL_READS)) for (const read of reads) expect(read).not.toMatch(LAYOUT_READ);
  });

  it("imports no headless engine above Components, apart from the NEED-tagged residual imports (WL3)", () => {
    expect(errors(run().findings, "WL3").map(withoutLine).sort()).toEqual(WL3_RESIDUAL);
  });

  it("carries no raw value, var() fallback, JS layout constant or non-hand-off inline style beyond the NEED-tagged residual counts (WL4)", () => {
    expect(countByFile(errors(run().findings, "WL4"))).toEqual(Object.fromEntries(Object.entries(WL4_RESIDUAL_COUNTS).map(([file, row]) => [file, row.count])));
    expect(Object.keys(WL4_RESIDUAL_COUNTS)).not.toContain("src/frames/right-panel-config.ts");
  });

  it("keeps every wiring exception it relies on live, layout-geometry and proposed", () => {
    const result = run();
    expect(result.findings.filter(row => row.code === "WL9" && row.severity === "error")).toEqual([]);
    const rows = (foundryWiringExceptions() as { exceptions: { file: string; reasonCode: string; status: string }[] }).exceptions.filter(row => /^src\/(?:frames|shell)\//.test(row.file));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([row.reasonCode, row.status]).toEqual(["layout-geometry", "proposed"]);
    // Every remaining error is a WL2/WL3/WL4 residual, each pinned by its own test above.
    expect([...new Set(result.findings.filter(row => row.severity === "error").map(row => row.code))].sort()).toEqual(["WL2", "WL3", "WL4"]);
  });

  it("flags a reintroduced right-panel 280 as a JS layout constant (mutation)", () => {
    const mutated = sources.map(source => source.path !== "src/frames/right-panel-config.ts" ? source
      : { ...source, content: source.content.replace(/defaultValue: inspectorLength\([^)]*\)/, "defaultValue: 280") });
    expect(mutated.find(source => source.path === "src/frames/right-panel-config.ts")!.content).toContain("defaultValue: 280");
    const before = new Set(errors(run().findings, "WL4"));
    const added = errors(run({ sources: mutated }).findings, "WL4").filter(row => !before.has(row));
    expect(added).toEqual([expect.stringMatching(/^src\/frames\/right-panel-config\.ts:\d+ JS numeric layout constant APP_FRAME_RIGHT_PANEL_CONFIG = 280$/)]);
  });
});

describe("frame SSR keeps its landmarks and skip-link", () => {
  const appFrame: AppFrameProps = {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas" },
    account: { signedOutLabel: "Signed out", sections: [{ id: "access", entries: [{ id: "login", kind: "link", label: "Sign in", href: "#login" }] }] },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home" },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    children: createElement("p", null, "Route content"),
  };

  it("renders the app frame with a banner, navigation, one main and a skip-link to it", () => {
    const html = renderToString(createElement(AppFrame, appFrame));
    const main = /<main\b[^>]*\bid="([^"]+)"/.exec(html);
    expect(main).not.toBeNull();
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(/<header\b/);
    expect(html).toMatch(/<nav\b/);
    expect(html).toContain(`href="#${main![1]}"`);
    expect(html.indexOf(`href="#${main![1]}"`)).toBeLessThan(html.indexOf("<main"));
  });

  it("renders the site header and footer as their banner and contentinfo landmarks", () => {
    expect(renderToString(createElement(SiteHeader, { brand: createElement("span", null, "Atlas") }))).toMatch(/^<header\b/);
    expect(renderToString(createElement(SiteFooter, { secondary: createElement("p", null, "Footer") }))).toMatch(/<footer\b/);
  });

  it("stamps each frame root with its DOM provenance through dsAttrs", () => {
    const stamp = (leaf: string) => `${DS_ATTR.layer}="frames" ${DS_ATTR.leaf}="${leaf}" ${DS_ATTR.fill}="foundry/${leaf}"`;
    const roots: [string, string, RegExp][] = [
      ["frames.app-shell", renderToString(createElement(AppFrame, appFrame)), /<div\b[^>]*data-application-frame=""[^>]*>/],
      ["frames.site-header", renderToString(createElement(SiteHeader, { brand: createElement("span", null, "Atlas") })), /^<header\b[^>]*>/],
      ["frames.site-footer", renderToString(createElement(SiteFooter, { secondary: createElement("p", null, "Footer") })), /<footer\b[^>]*>/],
      ["frames.inspector", renderToString(createElement(InspectorFrame, { label: "Inspector", handleLabel: "Resize inspector", closeLabel: "Close", openLabel: "Open", ...APP_FRAME_RIGHT_PANEL_CONFIG, children: "Details" })), /<aside\b[^>]*>/],
    ];
    for (const [leaf, html, root] of roots) {
      expect(root.exec(html)?.[0], leaf).toContain(stamp(leaf));
      expect(html.match(/data-ds-layer="frames"/g), leaf).toHaveLength(1);
    }
  });
});
