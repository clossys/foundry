import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup, render, within } from "@testing-library/react";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { loadBuildCatalog } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { componentSpecimenPreview } from "./component-specimens.js";

const hostModules = { "@clossys/designer/components": components, "@clossys/designer/charts": charts, "@clossys/designer/shell": shell };

/** The leaves a consumer reported throwing once it adopted Foundry's component library. */
const reported = ["native-action", "toolbar", "field", "number-field", "table", "grid-list", "tree", "meter", "logo", "chart-bar", "chart-line", "chart-area", "chart-status-strip", "chart-heatmap", "chart-range", "chart-sparkline", "chart-scatter", "chart-waterfall", "semantic-content", "navigation-tree", "resize-handle"].map(name => `components.${name}`);

/**
 * Every Foundry package-implemented leaf as a consumer sees it after adopting: resolve() stamps the consumer's own
 * id on `descriptor.source`, while `origin.source` keeps naming the library the component came from.
 */
function adoptedFoundryLeaves() {
  const slots = new Set(loadBuildCatalog().slots.map(slot => slot.id));
  return loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components))
    .filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && slots.has(fill.slot))
    .map(fill => {
      const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: { ...fill, source: "consumer-app" } } as unknown as ResolvedComponent;
      return { leaf: fill.slot, profile: { selectionHash: `selection-${fill.slot}`, components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved };
    });
}

it("server-renders every adopted Foundry leaf from designer samples, though resolve() rewrote descriptor.source", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const leaves = adoptedFoundryLeaves();
  expect(leaves.map(entry => entry.leaf)).toEqual(expect.arrayContaining(reported));
  const throws: Record<string, string> = {};
  for (const { leaf, profile } of leaves) {
    try { renderToString(<>{specimens.preview(leaf, profile)}</>); }
    catch (error) { throws[leaf] = error instanceof Error ? error.message : String(error); }
  }
  expect(throws).toEqual({});
  errors.mockRestore();
});

/** Compile one materialized source bundle (the vendored shadcn@aria rewrite) and return its entry module's exports. */
function vendoredModule(files: readonly { path: string; content: string }[], entry: string, dependency: (leaf: string) => unknown): Record<string, unknown> {
  // Compile in Node: jsdom's Uint8Array realm is incompatible with esbuild.
  const bundled = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from "node:fs";
    import { posix } from "node:path";
    import { build } from "esbuild";
    const data = JSON.parse(readFileSync(0, "utf8"));
    const files = new Map(data.files.map(file => [file.path, file.content]));
    const find = path => [path, path.replace(/\\.js$/, ".ts"), path.replace(/\\.js$/, ".tsx"), path + ".ts", path + ".tsx", path + "/index.ts"].find(candidate => files.has(candidate));
    const result = await build({ entryPoints: [data.entry], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", packages: "external", logLevel: "silent", plugins: [{
      name: "vendored-source",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.kind === "entry-point") return { path: args.path, namespace: "vendored" };
          if (!args.path.startsWith(".")) return { path: args.path, external: true };
          const path = find(posix.normalize(posix.join(posix.dirname(args.importer), args.path)));
          if (path) return { path, namespace: "vendored" };
          const leaf = /(?:^|\\/)components\\/([a-z][a-z0-9-]*)\\/index(?:\\.js)?$/.exec(posix.join(posix.dirname(args.importer), args.path))?.[1];
          return leaf ? { path: "leaf:" + leaf, external: true } : { errors: [{ text: "unresolved " + args.path }] };
        });
        builder.onLoad({ filter: /.*/, namespace: "vendored" }, args => ({ contents: files.get(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
      },
    }] });
    process.stdout.write(result.outputFiles[0].text);
  `], { input: JSON.stringify({ files, entry }), encoding: "utf8" });
  const module = { exports: {} as Record<string, unknown> };
  const host = createRequire(import.meta.url);
  const require = (specifier: string) => specifier.startsWith("leaf:") ? dependency(specifier.slice(5)) : host(specifier);
  new Function("require", "exports", "module", bundled)(require, module.exports, module);
  return module.exports;
}

/** Every shadcn@aria leaf as a consumer adopts it: its materialized source, keyed by the entry its descriptor names. */
function adoptedShadcnLeaves() {
  const bundles = loadCatalogBundles();
  const slots = new Set(loadBuildCatalog().slots.map(slot => slot.id));
  const fills = bundles.componentFills.flatMap(doc => Object.values(doc.components)).filter(fill => fill.source === "shadcn@aria" && fill.impl.kind === "source" && slots.has(fill.slot));
  const modules: Record<string, Record<string, unknown>> = {};
  const bundleOf = (slot: string) => bundles.sourceBundles.find(candidate => candidate.slot === slot && candidate.transform === "shadcn-aria-rewrite@1");
  // Dependency leaves a consumer adopted at their current source: shadcn@aria's own vendored files, else Foundry's package.
  const shipped = new Map(fills.flatMap(fill => bundleOf(fill.slot)!.files).map(file => [file.path, file]));
  const leaves = fills.map(fill => {
    const entry = (fill.impl as { entry: string }).entry;
    modules[entry] = vendoredModule([...shipped.values()], entry, () => components);
    const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "shadcn@aria" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: { ...fill, source: "consumer-app" } } as unknown as ResolvedComponent;
    return { leaf: fill.slot, profile: { selectionHash: `selection-${fill.slot}`, components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved };
  });
  return { leaves, modules, slotCount: loadBuildCatalog().slots.filter(slot => bundles.componentFills.some(doc => Object.values(doc.components).some(fill => fill.source === "shadcn@aria" && fill.slot === slot.id))).length };
}

it("binds and server-renders every adopted shadcn@aria leaf from its vendored source, or names why it cannot", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { leaves, modules, slotCount } = adoptedShadcnLeaves();
  expect(leaves.length).toBe(slotCount);
  const specimens = componentSpecimenPreview({ modules: { ...hostModules, ...modules } });
  const outcome: Record<string, string> = {};
  for (const { leaf, profile } of leaves) {
    const bound = specimens.bind(leaf, profile);
    if ("refusal" in bound) { outcome[leaf] = `refused:${bound.refusal.code}:${bound.refusal.detail}`; continue; }
    try {
      const html = renderToString(<>{specimens.preview(leaf, profile)}</>);
      const reason = /data-specimen-unavailable="([^"]+)"/.exec(html)?.[1];
      expect(html, leaf).not.toMatch(/="NaN"/);
      outcome[leaf] = html.includes("data-specimen-error") ? "specimen-error" : reason ? `unavailable:${reason}` : "live";
    } catch (error) { outcome[leaf] = `throws:${error instanceof Error ? error.message : String(error)}`; }
  }
  const bad = Object.fromEntries(Object.entries(outcome).filter(([, state]) => state !== "live" && !state.startsWith("unavailable:")));
  expect(bad).toEqual({});
  // Every leaf draws, the Dialog included: its own non-modal DialogContent part draws in place, not a modal.
  expect(Object.entries(outcome).filter(([, state]) => state !== "live")).toEqual([]);
  // The menu draws open in place through the module's own InlineMenu, with no Popover, so it server-renders.
  const menu = renderToString(<>{specimens.preview("components.menu", leaves.find(entry => entry.leaf === "components.menu")!.profile)}</>);
  expect(menu).toContain("Archive item");
  expect(menu).toMatch(/role="menu"/);
  // Compound leaves draw the designer sample through their own vendored parts, not the leaf label.
  for (const [leaf, text] of [["components.tabs", "Summary content"], ["components.breadcrumbs", "Overview"], ["components.disclosure", "Returns"], ["components.radio-group", "Yearly"], ["components.card", "Card title"]] as const) {
    expect(renderToString(<>{specimens.preview(leaf, leaves.find(entry => entry.leaf === leaf)!.profile)}</>), leaf).toContain(text);
  }
  expect(errors.mock.calls.map(call => String(call[0])).filter(message => /NaN/.test(message))).toEqual([]);
  errors.mockRestore();
}, 120_000);

it("draws the non-modal shadcn@aria overlays open in the browser, inside the specimen cell", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { leaves, modules } = adoptedShadcnLeaves();
  const specimens = componentSpecimenPreview({ modules: { ...hostModules, ...modules } });
  for (const [leaf, text, slot] of [["components.popover", "Popover content", "popover-content"], ["components.tooltip", "Tooltip content", "tooltip-content"]] as const) {
    const { container } = render(<>{specimens.preview(leaf, leaves.find(entry => entry.leaf === leaf)!.profile)}</>);
    const host = container.querySelector("[data-specimen-overlay-host]")!;
    expect(await within(host as HTMLElement).findByText(text), leaf).toBeTruthy();
    expect(host.querySelector(`[data-slot="${slot}"]`), leaf).not.toBeNull();
    expect(container.querySelector("[data-specimen-error]"), leaf).toBeNull();
    cleanup();
  }
  errors.mockRestore();
}, 120_000);

/** Elements outside the cell that are hidden from assistive technology or inert, and whether the page's scroll is locked. */
function pageOutside(cell: Element) {
  const hidden = [document.documentElement, document.body, ...document.body.querySelectorAll<HTMLElement>("*")]
    .filter(node => !cell.contains(node) && (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("inert") || (node as HTMLElement & { inert?: boolean }).inert === true))
    .map(node => node.outerHTML.slice(0, 80));
  return { hidden, scrollLocked: document.documentElement.style.overflow === "hidden" || document.body.style.overflow === "hidden" };
}

it("draws the shadcn@aria DialogContent open in its cell, without hiding, scroll-locking or trapping the page", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { leaves, modules } = adoptedShadcnLeaves();
  const specimens = componentSpecimenPreview({ modules: { ...hostModules, ...modules } });
  const { container } = render(<><button type="button">Outside</button>{specimens.preview("components.dialog", leaves.find(entry => entry.leaf === "components.dialog")!.profile)}</>);
  const cell = container.querySelector("[data-component-specimens='components.dialog']")!;
  const host = cell.querySelector<HTMLElement>("[data-specimen-contained-host='dialog']")!;
  expect(host).not.toBeNull();
  expect(await within(host).findByText("Dialog content")).toBeTruthy();
  expect(within(host).getByRole("dialog", { name: "Dialog title" })).toHaveAttribute("data-slot", "dialog");
  expect(within(host).getByRole("button", { name: "Close" })).toBeTruthy();
  // The vendored module's own inner part draws: no ModalOverlay or Modal is mounted anywhere.
  expect(document.querySelector("[data-slot='dialog-overlay'], [data-slot='dialog-content']")).toBeNull();
  expect(cell.querySelector("[data-specimen-error], [data-specimen-unavailable]")).toBeNull();
  expect(pageOutside(cell)).toEqual({ hidden: [], scrollLocked: false });
  const outside = within(container).getByRole("button", { name: "Outside" });
  outside.focus();
  expect(document.activeElement).toBe(outside);
  cleanup();
  errors.mockRestore();
}, 120_000);
