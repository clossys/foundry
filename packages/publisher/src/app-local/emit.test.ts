import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { applyLibraryChange, libraryHash } from "../../../designer/src/catalog-core/api.js";
import { loadComponentRegistry, loadComponentCompositionRules } from "../../../designer/src/catalog-core/index.js";
import { loadCatalogBundles } from "../../../designer/src/catalog-bundles.js";
import { componentOf } from "../../../designer/src/catalog-core/resolve-components.js";
import { readActiveSourceLibrary } from "../../../designer/src/components/source-closure.js";
import { syntheticSource } from "../../../designer/src/catalog-core/__fixtures__/component-engine/synthetic.js";
import { componentIntegration } from "../../../designer/src/catalog-core/__fixtures__/component-integration.js";
import { libraryFiles } from "../../../designer/src/library-cli/fs-library.js";
import { libraryToCells } from "../../../designer/src/library-cli/cells.js";
import { packageSurfaceLibrary } from "../../../designer/src/library-cli/__fixtures__/package-surface-library.js";
import { migrateWriterCells } from "../../../writer/src/cells/migrate.js";
import { contentMapToCells } from "../content-map/cells.js";
import type { ContentMap } from "../content-map/contract.js";
import { contentRouteFixture, withApprovedRouteCopy } from "../web/__fixtures__/content-route.js";
import { createContentRouteManifest } from "../web/content-route-manifest.js";
import { emitAppLocal, parseAppLocalJson, parseGeneratedText, verifyAppLocal, writeAppLocal, generatedText } from "./index.js";
import { analyzeAppLocalSource, appLocalSourceResolver } from "./source.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
async function put(root: string, path: string, body: string) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
async function snapshot(root: string): Promise<Record<string, { hash: string; mtime: number }>> {
  const result: Record<string, { hash: string; mtime: number }> = {};
  async function walk(path: string) { for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(name);
    else result[name] = { hash: hash(await readFile(join(root, name), "utf8")), mtime: (await stat(join(root, name))).mtimeMs };
  } }
  await walk(""); return result;
}
async function selectedRuntime() {
  const bundles = loadCatalogBundles();
  const surfaces = await packageSurfaceLibrary();
  const catalog = { ...surfaces.catalog, components: { slots: loadComponentRegistry().slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() } };
  const selected = bundles.componentFills.map(componentOf).filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && !fill.blockers?.length);
  const remaining = [...selected], ordered: typeof selected = [];
  while (remaining.length) {
    const index = remaining.findIndex(fill => [...fill.reads.components, ...fill.composes].every(slot => ordered.some(prior => prior.slot === slot)));
    if (index < 0) throw new Error("Selected runtime fixture has an unresolved component dependency");
    ordered.push(...remaining.splice(index, 1));
  }
  const prior = surfaces.library;
  const packages = applyLibraryChange(catalog, prior, { baseHash: libraryHash(prior), changes: ordered.map(fill => ({ portion: "components" as const, change: { op: "adopt" as const, slot: fill.slot, source: fill.source } })) }, { surfaceOptions: surfaces.options });
  // SiteFrame's mobile navigation and the shadcn sidebar use the real Sheet source.
  // Adopt its authenticated bundle explicitly; package-only selection omits it.
  const sheet = bundles.componentFills.map(componentOf).find(fill => fill.slot === "components.sheet" && fill.source === "shadcn@aria")!;
  const library = applyLibraryChange(catalog, packages, { baseHash: libraryHash(packages), changes: [{ portion: "components", change: { op: "adopt", slot: sheet.slot, source: sheet.source } }], bundles: bundles.sourceBundles.filter(bundle => bundle.slot === sheet.slot) }, { surfaceOptions: surfaces.options });
  return { catalog, library, componentOptions: undefined, surfaceOptions: surfaces.options };
}
it("receipts the mobile Sheet dependency in active selection and keeps unrelated source outside the library", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-sheet-selection-")); roots.push(root);
  const input = await selectedRuntime(), library = join(root, "library"), cells = join(root, "cells");
  for (const [path, source] of libraryFiles(input.catalog, input.library, [], input.componentOptions, input.surfaceOptions)) await put(library, path, source);
  await libraryToCells(library, cells, { catalog: input.catalog, surfaceOptions: input.surfaceOptions, date: "2026-10-29" });
  const active = await readActiveSourceLibrary(cells, input.catalog, { surfaceOptions: input.surfaceOptions });
  const sheet = active.components.fills.map(componentOf).find(fill => fill.slot === "components.sheet")!;
  expect(sheet).toMatchObject({ impl: { kind: "source", export: "Sheet" }, origin: { kind: "adopted", source: "shadcn@aria" } });
  const resolve = appLocalSourceResolver(active, root, {});
  expect(active.components.files).toContainEqual(expect.objectContaining({ path: "components/sheet/sheet.tsx" }));
  const request = { specifier: "@clossys/designer/components", importer: undefined, names: ["Sheet", "SheetClose", "SheetTitle"], files: new Map<string, string>() };
  const facade = resolve(request);
  expect(facade).toMatchObject({ kind: "source" });
  if (facade.kind !== "source") throw new Error("Expected actual selected Sheet source");
  const forwarded = analyzeAppLocalSource(facade.module).find(imported => imported.specifier.includes("sheet/index"))!;
  expect(resolve({ ...forwarded, importer: facade.module, names: forwarded.names ?? [], files: request.files })).toMatchObject({ kind: "source", module: { ownerSlot: "components.sheet", origin: "installed" } });
  const unrelated = resolve({ ...request, names: ["Sidebar"] });
  if (unrelated.kind !== "source") throw new Error("Expected actual Sidebar forwarding source");
  const sidebar = analyzeAppLocalSource(unrelated.module).find(imported => imported.specifier.includes("sidebar/index"))!;
  expect(() => resolve({ ...sidebar, importer: unrelated.module, names: sidebar.names ?? [], files: request.files })).toThrow(/components\.sidebar.*outside selected library/);
}, 120_000);
let runtimeSelection: ReturnType<typeof selectedRuntime> | undefined;
async function fixture(serving = true) {
  const root = await mkdtemp(join(tmpdir(), "publisher-app-local-")); roots.push(root);
  const input = serving ? await (runtimeSelection ??= selectedRuntime()) : componentIntegration(true), selected = syntheticSource();
  if (!serving) input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } }], bundles: [{ slot: selected.candidate.slot, descriptorHash: selected.descriptorHash, upstream: [selected.upstream], files: [selected.file, selected.notice], transform: selected.candidate.transform!, blockers: [] }] });
  const library = join(root, "library");
  for (const [path, source] of libraryFiles(input.catalog, input.library, [], input.componentOptions, input.surfaceOptions)) await put(library, path, source);
  await libraryToCells(library, join(root, "clossys/agents/designer"), { catalog: input.catalog, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions, date: "2026-10-29" });
  const map: ContentMap = { version: 1, publicationId: "example", format: "web.page.responsive", entries: [{ id: "home", title: "Home", path: "/", kind: "page", order: 0, pin: { nav: true }, source: { frameId: "frames.auth-shell", sectionIds: ["sections.empty-state"] } }] };
  const content = contentRouteFixture();
  const routeInput = withApprovedRouteCopy({ ...content, registry: { ...content.registry, workspace: { ...content.registry.workspace, consumerId: input.library.source.id, locales: ["en"], deployTargets: [{ id: "site", repo: "example", app: "web", origin: "https://example.test" }] }, slots: content.registry.slots.map(slot => ({ ...slot, route: "/", meta: { canonical: "https://example.test/" } })) }, libraries: content.libraries.map(library => ({ ...library, consumerId: input.library.source.id })), publishing: { brand: "Example", manifest: { defaultLocale: "en", locales: [{ tag: "en", state: "active", dir: "ltr" }], fallback: {} }, bodyServedLocales: { en: ["en"] }, existingUrls: ["https://example.test/"] } });
  const manifest = createContentRouteManifest({ registry: routeInput.registry, locale: "en", loader: { file: "src/content-loader.ts", export: "loadContentRoute" } });
  await contentMapToCells(map, join(root, "clossys/agents/publisher"), { date: "2026-10-29", ...(serving ? { routePack: { ...manifest, packId: "example", routes: manifest.routes.map(route => ({ ...route, instanceId: "home", label: "Home" })) } } : {}) });
  if (serving) await put(root, "apps/web/src/content-loader.ts", `const input = ${JSON.stringify(routeInput)} as const;\nexport async function loadContentRoute() { return input; }\n`);
  const writerInput = join(root, "writer-input");
  await mkdir(writerInput);
  await cp(fileURLToPath(new URL("../../../writer/src/cells/__fixtures__/generic-envelope.json", import.meta.url)), join(writerInput, "copy.json"));
  await migrateWriterCells(writerInput, join(root, "clossys/agents/writer"), { date: "2026-10-29" });
  await put(root, "apps/web/package.json", JSON.stringify({ private: true, dependencies: { "react-aria-components": "1.21.1", react: "19.3.0" } }));
  return { root, catalog: input.catalog, target: { app: "apps/web", publication: "example", format: "web.page.responsive" as const } };
}
it("requires active checked serving Route metadata before a normal target can succeed", async () => {
  const options = await fixture(false), before = await snapshot(options.root);
  await expect(emitAppLocal(options)).rejects.toThrow(/serving.*Route|Route.*serving/i);
  expect(await snapshot(options.root)).toEqual(before);
});
it("emits real selected source, active copy, theme and publication data entirely in memory", async () => {
  const options = await fixture(), before = await snapshot(options.root);
  const emitted = await emitAppLocal(options);
  expect(await snapshot(options.root)).toEqual(before);
  for (const name of ["theme.css", "copy/en.ts", "routes.ts", "nav.ts", "dependencies.json", ".manifest.json"]) expect(emitted.files[name], name).toBeTypeOf("string");
  const button = Object.keys(emitted.files).find(path => /\/Button(?:-[a-f0-9]+)?\.tsx$/.test(path));
  expect(button).toBeTypeOf("string");
  expect(parseGeneratedText(emitted.files[button!]!).body).toContain('from "react-aria-components"');
  expect(parseGeneratedText(emitted.files["site/app/page.tsx"]!).body).toContain("await loadContentRoute()");
  expect(parseGeneratedText(emitted.files["copy/en.ts"]!).body).toContain("Continue");
  expect(parseGeneratedText(emitted.files["theme.css"]!).body).toContain("--");
  expect(parseAppLocalJson(emitted.files["dependencies.json"]!)).toMatchObject({ react: "19.3.0", "react-aria-components": "1.21.1", "tailwind-merge": "^3.7.0" });
  for (const body of Object.values(emitted.files)) expect(body).not.toContain("@clossys/");
  const manifest = parseAppLocalJson(emitted.files[".manifest.json"]!) as Record<string, string>;
  expect(Object.keys(manifest).sort()).toEqual(Object.keys(emitted.files).filter(path => path !== ".manifest.json").sort());
  for (const [path, source] of Object.entries(emitted.files)) {
    expect(source).toMatch(/^\/\* generated by clossys publish; do not edit\nclossys-digest: sha256:[a-f0-9]{64}\n\*\/\n/);
    const parsed = parseGeneratedText(source); expect(parsed.digest).toBe(hash(parsed.body));
    if (path !== ".manifest.json") expect(manifest[path]).toBe(hash(source));
  }
}, 120_000);
it("uses active cells instead of stale compiled output and ignores later draft versions", async () => {
  const options = await fixture();
  const file = join(options.root, "clossys/agents/publisher/cells/page.home/v1.md");
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace("title: Home", "title: Current home"));
  await writeFile(file.replace("v1.md", "v2.md"), source.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace(/^confirmed:.*\n/m, "").replace("title: Home", "title: Draft home"));
  const emitted = await emitAppLocal(options);
  expect(emitted.files["routes.ts"]).toContain("Current home"); expect(emitted.files["routes.ts"]).not.toContain("Draft home");
}, 120_000);
it("classifies missing, stale, hand edits, extra and first-party imports without changing hashes or mtimes", async () => {
  const options = await fixture(), expected = await emitAppLocal(options), directory = expected.outDir;
  await put(options.root, "apps/web/package.json", JSON.stringify({ private: true, dependencies: expected.dependencies }));
  await writeAppLocal(directory, expected);
  expect(await verifyAppLocal(directory, expected)).toEqual([]);
  await rm(join(directory, "theme.css"));
  await writeFile(join(directory, "routes.ts"), generatedText("export const routes = [];\n"));
  await writeFile(join(directory, "nav.ts"), expected.files["nav.ts"]! + "// manual edit\n");
  await writeFile(join(directory, "extra.ts"), generatedText("export {};\n"));
  await writeFile(join(directory, "toString"), generatedText("export {};\n"));
  await writeFile(join(directory, "copy/en.ts"), expected.files["copy/en.ts"]! + 'import "@clossys/writer";\n');
  const before = await snapshot(options.root), findings = await verifyAppLocal(directory, expected);
  expect(await snapshot(options.root)).toEqual(before);
  expect(findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "missing", path: "theme.css" }), expect.objectContaining({ kind: "stale", path: "routes.ts" }),
    expect.objectContaining({ kind: "hand-edit", path: "nav.ts" }), expect.objectContaining({ kind: "extra", path: "extra.ts" }),
    expect.objectContaining({ kind: "clossys-import", path: "copy/en.ts" }), expect.objectContaining({ kind: "extra", path: "toString" }),
  ]));
}, 120_000);
it("refuses target/output traversal before writing and detects first-party app dependencies", async () => {
  const options = await fixture();
  await expect(emitAppLocal({ ...options, target: { ...options.target, app: "../outside" } })).rejects.toThrow();
  await expect(emitAppLocal({ ...options, outDir: "../outside" })).rejects.toThrow();
  const expected = await emitAppLocal(options); await writeAppLocal(expected.outDir, expected);
  await put(options.root, "apps/web/package.json", JSON.stringify({ dependencies: { "@clossys/writer": "0.6.0" } }));
  expect(await verifyAppLocal(expected.outDir, expected)).toContainEqual(expect.objectContaining({ kind: "clossys-import" }));
}, 120_000);
