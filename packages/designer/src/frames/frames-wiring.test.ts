// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkWiring, foundryWiringExceptions, type WiringFinding, type WiringInput } from "../catalog-core/wiring.js";
import { frameLayerComponentFiles, frameLayerSources, frameLayerWiringInput, framesWiringResiduals, residualsOf } from "../catalog-core/frames-wiring-residuals.js";
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
 * source under `src/frames` and `src/shell` (registered component fills excluded)
 * and must report no WL2/WL3/WL4 error at all: there is no committed residual
 * report and no budget that only shrinks. Colour comes from component-owned
 * paint (`GROUND_PAINT`, button and link class exports), layout from named
 * utilities in `styles/theme-keys.css`, and engine primitives from Components.
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

describe("frames from components (WIRE-4)", () => {
  it("scans the frame layer and leaves only registered component fills to the component layer", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map(source => source.path)).toEqual(expect.arrayContaining(["src/frames/AppFrame.tsx", "src/frames/right-panel-config.ts", "src/shell/SiteHeader.tsx", "src/shell/internal/shell-vars.ts"]));
    expect([...componentFiles].sort()).toEqual(["src/shell/Brandmark.tsx", "src/shell/Toaster.tsx", "src/shell/internal/toast-queue.ts"]);
  });

  it("reports no WL2/WL3/WL4 finding anywhere in the frame layer", () => {
    expect(residualsOf(run().findings)).toEqual([]);
    expect(framesWiringResiduals({ read, walk, checkWiring, exceptions: foundryWiringExceptions() })).toEqual([]);
  });

  it("keeps no committed residual report to baseline against", () => {
    expect(() => read("src/catalog/reports/frames-wiring-residuals.json")).toThrow();
    expect(read("scripts/frames-wiring-residuals.mjs")).not.toMatch(/--write|writeFileSync/);
  });

  it("fails on a reintroduced engine import, colour read or layout read (mutation)", () => {
    const mutated = sources.map(source => source.path !== "src/frames/AuthFrame.tsx" ? source
      : { ...source, content: `${source.content}\nimport { Button as AriaButton } from "react-aria-components";\nexport const leak = AriaButton;\nexport const ink = "text-muted-foreground gap-md";\n` });
    const codes = residualsOf(run({ sources: mutated }).findings).map(row => `${row.code} ${row.file}`);
    expect(codes).toEqual(expect.arrayContaining(["WL2 src/frames/AuthFrame.tsx", "WL3 src/frames/AuthFrame.tsx"]));
  });

  it("relies on no wiring exception: the committed exception list is empty", () => {
    expect((foundryWiringExceptions() as { exceptions: unknown[] }).exceptions).toEqual([]);
    const result = run();
    expect(result.findings.filter(row => row.code === "WL9")).toEqual([]);
    expect(result.findings.filter(row => row.severity === "error")).toEqual([]);
  });

  it("fails on a reintroduced spacing-token read in a frame (mutation)", () => {
    const mutated = sources.map(source => source.path !== "src/shell/Shell.tsx" ? source
      : { ...source, content: `${source.content}\nexport const pad = "calc(var(--spacing) * 2)";\n` });
    expect(residualsOf(run({ sources: mutated }).findings).map(row => `${row.code} ${row.file} ${row.evidence}`))
      .toEqual([expect.stringMatching(/^WL2 src\/shell\/Shell\.tsx frames reads themes\.spacing\.default directly/)]);
  });

  // checkWiring does not resolve t-shirt spacing utilities (`p-md`, `focus:start-sm`) to a themes read, so
  // the frame layer is held to named layout utilities here: every t-shirt step lives in theme-keys.css.
  const TSHIRT = /(?<![\w-])(?:[\w-]+:)*-?(?:p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|bottom|start|end|left|right|scroll-m|scroll-p|w|h|size|min-w|min-h|max-w|max-h|translate-x|translate-y|indent)-(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl)(?![\w-])|--spacing-(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/g;
  const tshirt = (list: typeof sources) => list.filter(source => !source.path.includes("/__fixtures__/")).flatMap(source => (source.content.match(TSHIRT) ?? []).map(hit => `${source.path} ${hit}`));

  it("names no t-shirt spacing step in a frame-layer source", () => {
    expect(tshirt(sources)).toEqual([]);
    const mutated = sources.map(source => source.path !== "src/frames/FrameDock.tsx" ? source : { ...source, content: `${source.content}\nconst gap = "gap-md";\n` });
    expect(tshirt(mutated)).toEqual(["src/frames/FrameDock.tsx gap-md"]);
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
