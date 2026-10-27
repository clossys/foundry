/** @vitest-environment node */
/** One emitted consumer-library chain. SSR wiring proof, not browser or component qualification. */
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { packageBarrelExports, readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { applyLibraryChange, emit, libraryHash, resolve } from "./api.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, loadSectionRegistry } from "./index.js";
import { deriveIdentity } from "../catalog-assets/identity.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "./surface-library.js";
import type { CompositeEngineInput, CompositeEmitFile, FrameSlot } from "./types.js";
import type { SurfaceCandidateDocument } from "./surface-types.js";

const SECTION = "sections.call-to-action", FRAME = "frames.app-shell", GLYPH = "assets.icon-chevron-right";
// Adoption validates each change immediately: install the dependency before its parent.
const COMPONENTS = ["components.icon", "components.button", "components.logo"];
// The installed jsdom peer ships no declarations; keep this test's parser port explicit.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
let selected: CompositeEngineInput, temporary: string, sequence = 0;

beforeAll(async () => {
  temporary = await mkdtemp(join(import.meta.dirname, ".selected-chain-"));
  const components = loadComponentRegistry().slots.filter(slot => COMPONENTS.includes(slot.id));
  const surfaces = [...importFoundrySections().fills, ...importFoundryFrames().fills]
    .filter(doc => [SECTION, FRAME].includes(doc.$extensions["com.clossys.fill"].slot)) as unknown as SurfaceCandidateDocument[];
  const catalog = {
    values: loadCatalog(), components: { slots: components, fills: importFoundryComponents().fills.filter(doc => COMPONENTS.includes(doc.$extensions["com.clossys.fill"].slot)) },
    surfaces: { slots: [...loadSectionRegistry().slots.filter(slot => slot.id === SECTION), ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames" && slot.id === FRAME)], fills: surfaces, rules: [], transforms: [], materializations: [] },
  };
  const values = completedCatalogLibrary(catalog.values, { id: "selected-chain", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-27");
  const { source, adoptedAt, ...portion } = values;
  // Inspect real public export inventories. Runtime import below executes those exact exports;
  // absent component observations remain notices and are never invented to clear qualification.
  const exportsOf = (path: string) => packageBarrelExports(readFileSync(new URL(path, import.meta.url), "utf8")).values;
  const componentOptions = { packageExports: { "@clossys/designer/components": exportsOf("../components/index.ts"), "@clossys/designer/shell": exportsOf("../shell/index.ts") } };
  const surfaceOptions = { packages: await readSurfacePackageEvidence(surfaces), measurements: [] };
  const empty = { source, adoptedAt, values: portion, components: { fills: [], files: [] }, surfaces: { version: 1 as const, fills: [], files: [] } };
  const library = applyLibraryChange(catalog, empty, {
    baseHash: libraryHash(empty), changes: [
      ...COMPONENTS.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot, source: "foundry" } })),
      ...[SECTION, FRAME].map(slot => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: slot as `sections.${string}`, source: "foundry" } })),
    ],
  }, { componentOptions, surfaceOptions });
  selected = { catalog, library, componentOptions, surfaceOptions };
}, 120_000);
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

/** This page imports only emitted library entrypoints. No hand-built component, Section or Frame. */
const PAGE = `
import { createElement as h } from "react";
import { Button, Icon, Logo, LibraryProvider } from "./component-index";
import { CallToAction, AppShell } from "./surface-index";
export function page({ mark, frame, heading, action }) {
  return h(LibraryProvider, null, h(AppShell, frame,
    h(CallToAction, { title: heading, eyebrow: h(Logo, { src: mark, size: "sm" }),
      primaryAction: h(Button, { variant: "primary", size: "md" },
        h(Icon, { asset: "assets.icon-chevron-right", size: "sm", decorative: true }), action) })));
}
`;

/** Compile the emitted relative-import closure; missing files/exports are real compiler failures. */
async function compile(files: readonly CompositeEmitFile[]) {
  const sources = new Map(files.map(file => [file.path, file.contents]));
  sources.set("page.tsx", PAGE);
  const result = await build({
    entryPoints: ["page.tsx"], bundle: true, format: "esm", platform: "node", packages: "external", write: false, logLevel: "silent",
    plugins: [{ name: "emitted-consumer-library", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind !== "entry-point" && !args.path.startsWith(".")) return { path: args.path, external: true };
        const target = posix.normalize(posix.join(args.importer ? posix.dirname(args.importer) : "", args.path));
        const path = [target, `${target}.ts`, `${target}.tsx`, target.replace(/\.js$/, ".ts")].find(path => sources.has(path));
        if (!path) throw new Error(`Unresolved emitted library reference: ${target}`);
        return { path, namespace: "emitted" };
      });
      builder.onLoad({ filter: /.*/, namespace: "emitted" }, args => ({ contents: sources.get(args.path)!, loader: args.path.endsWith("tsx") ? "tsx" : "ts" }));
    } }],
  });
  const path = join(temporary, `page-${sequence++}.mjs`);
  await writeFile(path, result.outputFiles[0]!.text);
  return await import(/* @vite-ignore */ pathToFileURL(path).href) as { page: (props: Record<string, unknown>) => ReactNode };
}

/** Same resolution, compilation, render and DOM oracle for the intact chain and every broken link. */
async function draw(input: CompositeEngineInput, changeOutput: (files: CompositeEmitFile[]) => void = () => {}) {
  const profile = resolve(input);
  const errors = profile.check.findings.filter(row => row.severity === "error");
  if (errors.length) throw new Error(`Selected library has unresolved references: ${JSON.stringify(errors)}`);
  expect(Object.keys(profile.components.components).sort(), "selected component set differs").toEqual([...COMPONENTS].sort());
  const files = emit(profile, ["css-brand", "css-scales", "component-index", "surface-index"]);
  changeOutput(files);
  const module = await compile(files);
  const mark = profile.values.members["assets.mark.reversed"]!.value.light;
  expect(typeof mark).toBe("string");
  const markUrl = `data:image/svg+xml,${encodeURIComponent(mark as string)}`;
  const app = specimenDataset.frames.app;
  const node = module.page({ mark: markUrl, heading: app.heading, action: app.body,
    frame: { brand: { markSrc: markUrl, navigationMark: { label: app.workspace } }, navigation: { tree: app.navigation, label: app.navigationLabel, activeId: app.activeId },
      account: { actor: app.actor, signedOutLabel: app.signedOutLabel, sections: [] }, commands: { ...app.commands, shortcutEnabled: false },
      theme: { preference: "light" }, themeControl: null, skipLabel: app.skipLabel } });
  const css = files.filter(file => file.path.endsWith(".css")).map(file => file.contents).join("\n");
  const html = renderToStaticMarkup(createElement("html", null, createElement("head", null, createElement("style", { "data-selected-library": profile.selectionHash }, css)), createElement("body", null, node)));
  const document = new JSDOM(html).window.document;
  const frame = document.querySelector(`[data-ds-leaf="${FRAME}"]`)!;
  expect(frame, "selected Frame must render").not.toBeNull();
  const frameEntry = surfaceEntryOf(profile.surfaces!.fills[FRAME]!.document);
  if (!isSurfacePackageEntry(frameEntry)) throw new Error("Selected Frame is no longer a package pointer");
  expect(frame.getAttribute("data-ds-fill")).toBe(frameEntry.origin!.fill);
  expect(frame.querySelectorAll("main")).toHaveLength(1);
  const section = frame.querySelector(`main [data-ds-leaf="${SECTION}"]`)!;
  expect(section, "selected Section must reach the Frame main slot").not.toBeNull();
  expect(section.querySelector("h2")!.textContent).toBe(app.heading);
  expect(section.querySelector("img")!.getAttribute("src")).toBe(markUrl);
  const button = section.querySelector('[data-ds-leaf="components.button"]')!;
  expect(button, "selected component must reach the Section action slot").not.toBeNull();
  expect(button.textContent).toBe(app.body);
  expect(button.getAttribute("data-ds-fill")).toBe("foundry/components.button");
  const icon = button.querySelector('[data-ds-leaf="components.icon"]')!;
  expect(icon, "selected asset adapter must render within the selected component").not.toBeNull();
  const glyph = Object.values(profile.values.members).find(member => member.slot === GLYPH)!;
  for (const [tag, attributes] of glyph.value.light as [string, Record<string, string>][]) {
    // React consumes a glyph's reconciliation key; its SVG paint/geometry attributes reach the DOM.
    const painted = Object.entries(attributes).filter(([key]) => key !== "key");
    expect([...icon.querySelectorAll(tag)].some(node => painted.every(([key, value]) => node.getAttribute(key) === value)), "rendered glyph must use consumer asset bytes").toBe(true);
  }
  const ink = profile.values.members["tokens.text-color.primary"]!;
  expect(document.querySelector("style")!.textContent).toContain(`${ink.emit}: ${ink.css.light};`);
  expect(document.querySelector("style")!.getAttribute("data-selected-library")).toBe(profile.selectionHash);
  return { html, document, mark, profile };
}

describe("selected library → Tokens → Assets → Components → Sections → Frames → page", { timeout: 120_000 }, () => {
  it("renders the emitted selected chain with consumer token CSS and derived identity/glyph assets", async () => {
    await draw(structuredClone(selected));
  });

  it.each([
    ["Library", /unresolved|missing|selected component set/i],
    ["Tokens", /tokens\.text-color|unresolved/i],
    ["Assets", /assets\.icon-chevron-right|glyph module/i],
    ["Components", /components\.icon|selected component set/i],
    ["Sections", /CallToAction/],
    ["Frames", /AppShell/],
  ] as const)("kills a broken %s link through the same chain oracle", async (layer, reason) => {
    const input = structuredClone(selected);
    if (layer === "Library") input.library = { ...input.library, values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
    if (layer === "Tokens") input.library.values.fills = input.library.values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== "tokens.text-color");
    if (layer === "Assets") input.library.values.fills = input.library.values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== GLYPH);
    if (layer === "Components") input.library.components.fills = input.library.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== "components.icon");
    if (layer === "Sections" || layer === "Frames") input.library.surfaces!.fills = input.library.surfaces!.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== (layer === "Sections" ? SECTION : FRAME));
    const failure = await draw(input).then(() => undefined, (error: unknown) => error);
    expect(failure, `${layer} mutation must fail the connected chain`).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toMatch(reason);
    console.info(`[chain mutation ${layer}] ${message.replace(/\s+/g, " ").slice(0, 480)}`);
  });

  it("refuses an unresolved emitted import instead of drawing a package fallback", async () => {
    await expect(draw(structuredClone(selected), files => {
      const index = files.findIndex(file => file.path === "components/icon/index.ts");
      expect(index, "selected Icon facade must exist before breaking its import").toBeGreaterThanOrEqual(0);
      files.splice(index, 1);
    })).rejects.toThrow(/Unresolved emitted library reference/);
  });

  it("renders changed consumer glyph bytes rather than the package default asset", async () => {
    const input = structuredClone(selected);
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: GLYPH, tokens: { default: { $type: "glyph", $value: [["path", { d: "M3 4h17v15H3z" }]] } } } }] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
    const updated = await draw(input);
    expect(updated.document.querySelector('main [data-ds-leaf="components.icon"] path')!.getAttribute("d")).toBe("M3 4h17v15H3z");
  });

  it("propagates a consumer token change through derived artwork to the actual rendered page", async () => {
    const initial = await draw(structuredClone(selected)), input = structuredClone(selected);
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.text-color", tokens: { "on-inverse": { $type: "color", $value: "#fefefe", $extensions: { "com.clossys.css": { raw: "#fefefe" }, "com.clossys.modes": { dark: initial.profile.values.members["tokens.text-color.on-inverse"]!.value.dark! } } } } } }] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
    // Derived assets retain their old input commitment until the producer is explicitly run.
    await expect(draw(input)).rejects.toThrow(/stale|unresolved/i);
    const { source, adoptedAt, ...values } = deriveIdentity(input.catalog.values, { ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt });
    input.library = { ...input.library, source, adoptedAt, values };
    const updated = await draw(input);
    expect(updated.mark).not.toBe(initial.mark);
    expect(updated.document.querySelector("main img")!.getAttribute("src")).not.toBe(initial.document.querySelector("main img")!.getAttribute("src"));
  });
});
