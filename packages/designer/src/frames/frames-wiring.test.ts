// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkWiring, foundryWiringExceptions, type WiringFinding, type WiringInput } from "../catalog-core/wiring.js";
import { FRAMES_WIRING_RESIDUALS_SCHEMA, RESIDUAL_CODES, frameLayerComponentFiles, frameLayerSources, frameLayerWiringInput, framesWiringResiduals, residualGrowth, residualsOf, type FramesWiringResidualReport } from "../catalog-core/frames-wiring-residuals.js";
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
 * source under `src/frames` and `src/shell` (registered component fills excluded).
 * Layout reads are proposed `layout-geometry` rows in
 * `catalog/rules/wiring-exceptions.json` (WL9 warnings). The WL2/WL3/WL4 findings
 * that remain are generated, never hand-pinned: `scripts/frames-wiring-residuals.mjs`
 * writes them to `src/catalog/reports/frames-wiring-residuals.json`, this test
 * requires the live scan to equal that report, and the generator refuses to write
 * a report that grows. They wait on NEED-c frame chrome text/surface, frame-geometry
 * utilities, layout grid, direction provider and surface-ground components, and on
 * the owner's shell-vars fallback and engine peer-version guard items.
 */
const pkg = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, pkg), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(new URL(dir, pkg), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const reader = { read, walk };

const componentFiles = frameLayerComponentFiles(reader);
const sources = frameLayerSources(reader);
const run = (input: Partial<WiringInput> = {}) => checkWiring({ ...frameLayerWiringInput(reader, foundryWiringExceptions()), ...input });
const errors = (findings: readonly WiringFinding[], code: string) => findings.filter(row => row.code === code && row.severity === "error").map(row => `${row.file}:${row.line} ${row.evidence}`);
const committed = JSON.parse(read("src/catalog/reports/frames-wiring-residuals.json")) as FramesWiringResidualReport;
const LAYOUT_READ = /^themes\.spacing\./;
const ofCode = (code: string) => committed.residuals.filter(row => row.code === code);

describe("frames from components (WIRE-4)", () => {
  it("scans the frame layer and leaves only registered component fills to the component layer", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map(source => source.path)).toEqual(expect.arrayContaining(["src/frames/AppFrame.tsx", "src/frames/right-panel-config.ts", "src/shell/SiteHeader.tsx", "src/shell/internal/shell-vars.ts"]));
    expect([...componentFiles].sort()).toEqual(["src/shell/Brandmark.tsx", "src/shell/Toaster.tsx", "src/shell/internal/toast-queue.ts"]);
  });

  it("reports exactly the generated WL2/WL3/WL4 residuals, and the generated report is current", () => {
    expect(committed.schema).toBe(FRAMES_WIRING_RESIDUALS_SCHEMA);
    expect(residualsOf(run().findings)).toEqual(committed.residuals);
    expect(framesWiringResiduals({ read, walk, checkWiring, exceptions: foundryWiringExceptions() })).toEqual(committed);
  });

  it("reads no layout token directly: layout reads stay layout-geometry exception rows (WL2)", () => {
    for (const row of ofCode("WL2")) expect(/reads (\S+) directly/.exec(row.evidence)?.[1], `${row.file} ${row.evidence}`).not.toMatch(LAYOUT_READ);
  });

  it("keeps the right-panel config free of WL4 findings", () => {
    expect(ofCode("WL4").map(row => row.file)).not.toContain("src/frames/right-panel-config.ts");
  });

  it("refuses to regenerate a residual report that grows (mutation)", () => {
    const mutated = sources.map(source => source.path !== "src/frames/AuthFrame.tsx" ? source
      : { ...source, content: `${source.content}\nimport { Button as AriaButton } from "react-aria-components";\nexport const leak = AriaButton;\n` });
    const next = residualsOf(run({ sources: mutated }).findings);
    expect(residualGrowth(committed.residuals, next)).toEqual([expect.objectContaining({ code: "WL3", file: "src/frames/AuthFrame.tsx" })]);
    expect(residualGrowth(committed.residuals, committed.residuals.slice(1))).toEqual([]);
  });

  it("keeps every wiring exception it relies on live, layout-geometry and proposed", () => {
    const result = run();
    expect(result.findings.filter(row => row.code === "WL9" && row.severity === "error")).toEqual([]);
    const rows = (foundryWiringExceptions() as { exceptions: { file: string; reasonCode: string; status: string }[] }).exceptions.filter(row => /^src\/(?:frames|shell)\//.test(row.file));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([row.reasonCode, row.status]).toEqual(["layout-geometry", "proposed"]);
    // Every remaining error is a generated WL2/WL3/WL4 residual.
    expect([...new Set(result.findings.filter(row => row.severity === "error").map(row => row.code))].sort()).toEqual([...RESIDUAL_CODES]);
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
