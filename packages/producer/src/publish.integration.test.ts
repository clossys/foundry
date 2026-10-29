import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { applyLibraryChange, libraryHash } from "../../designer/src/catalog-core/api.js";
import { loadComponentRegistry, loadComponentCompositionRules } from "../../designer/src/catalog-core/index.js";
import { loadCatalogBundles } from "../../designer/src/catalog-bundles.js";
import { componentOf } from "../../designer/src/catalog-core/resolve-components.js";
import { syntheticSource } from "../../designer/src/catalog-core/__fixtures__/component-engine/synthetic.js";
import { componentIntegration } from "../../designer/src/catalog-core/__fixtures__/component-integration.js";
import { libraryFiles } from "../../designer/src/library-cli/fs-library.js";
import { libraryToCells } from "../../designer/src/library-cli/cells.js";
import { packageSurfaceLibrary } from "../../designer/src/library-cli/__fixtures__/package-surface-library.js";
import { migrateWriterCells } from "../../writer/src/cells/migrate.js";
import { contentMapToCells } from "../../publisher/src/content-map/cells.js";
import type { ContentMap } from "../../publisher/src/content-map/contract.js";
import { contentRouteFixture, withApprovedRouteCopy } from "../../publisher/src/web/__fixtures__/content-route.js";
import { createContentRouteManifest } from "../../publisher/src/web/content-route-manifest.js";
import { emitAppLocal, parseAppLocalJson, parseGeneratedText, verifyAppLocal, writeAppLocal, generatedText } from "@clossys/publisher/app-local";

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
  const library = applyLibraryChange(catalog, prior, { baseHash: libraryHash(prior), changes: ordered.map(fill => ({ portion: "components" as const, change: { op: "adopt" as const, slot: fill.slot, source: fill.source } })) }, { surfaceOptions: surfaces.options });
  return { catalog, library, componentOptions: undefined, surfaceOptions: surfaces.options };
}
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
  await cp(fileURLToPath(new URL("../../writer/src/cells/__fixtures__/generic-envelope.json", import.meta.url)), join(writerInput, "copy.json"));
  await migrateWriterCells(writerInput, join(root, "clossys/agents/writer"), { date: "2026-10-29" });
  await put(root, "apps/web/package.json", JSON.stringify({ private: true, dependencies: { "react-aria-components": "1.21.1", react: "19.3.0" } }));
  return { root, catalog: input.catalog, target: { app: "apps/web", publication: "example", format: "web.page.responsive" as const } };
}

import { publishTarget } from "./publish.js";

it("publishes a real active-cell target through the public emitter and checks without writes", async () => {
  const options = await fixture();
  await put(options.root, "clossys/clossys.config.ts", `import { defineConfig } from "@clossys/producer/config";
export default defineConfig({id:"example",archetype:"product",locales:{default:"en",supported:["en"]},targets:{site:${JSON.stringify(options.target)}}});
`);
  const before = await snapshot(options.root);
  const result = await publishTarget({ root: options.root, target: "site" });
  expect(result.exitCode).toBe(1);
  expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({kind:"missing",path:"package.json"})]));
  const after = await snapshot(options.root);
  for (const [path, metadata] of Object.entries(before)) expect(after[path], path).toEqual(metadata);
  for (const path of Object.keys(after).filter(path => !Object.hasOwn(before, path))) expect(path).toMatch(/^apps\/web\/src\/clossys\//);
  const dependencies = parseAppLocalJson(await readFile(join(result.output, "dependencies.json"), "utf8"));
  await put(options.root, "apps/web/package.json", JSON.stringify({private:true,dependencies}));
  const settled = await snapshot(options.root);
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), "publish", "--target", "site", "--check", "--json"], {cwd:options.root,encoding:"utf8"});
  expect(cli.error).toBeUndefined(); expect(cli.status,cli.stderr||cli.stdout).toBe(0);
  expect(JSON.parse(cli.stdout)).toMatchObject({exitCode:0,target:"site",check:true});
  expect(await publishTarget({ root: options.root, target: "site", check: true })).toMatchObject({exitCode:0,findings:[]});
  expect(await snapshot(options.root)).toEqual(settled);
  await writeFile(join(result.output,"nav.ts"), "// manual edit\n");
  const edited = await snapshot(options.root);
  expect(await publishTarget({ root: options.root, target: "site", check: true })).toMatchObject({exitCode:1,findings:expect.arrayContaining([expect.objectContaining({kind:"hand-edit",path:"nav.ts"})])});
  expect(await snapshot(options.root)).toEqual(edited);
  const treePath = join(options.root,"clossys/agents/publisher/tree.json");
  const tree = JSON.parse(await readFile(treePath,"utf8")); tree.meta.publications[0].routePack.version = 1;
  await writeFile(treePath,JSON.stringify(tree));
  const refusedBefore = await snapshot(options.root);
  const refused = spawnSync(process.execPath,[fileURLToPath(new URL("../dist/cli/index.js",import.meta.url)),"publish","--target","site","--check","--json"],{cwd:options.root,encoding:"utf8"});
  expect(refused.status,refused.stderr||refused.stdout).toBe(1);
  expect(JSON.parse(refused.stdout).message).toMatch(/native content route manifest version 2/);
  expect(await snapshot(options.root)).toEqual(refusedBefore);
}, 120_000);

it("supports only the exact internal Studio target without widening arbitrary package outputs", async () => {
  const options = await fixture();
  await mkdir(join(options.root,"packages/producer"),{recursive:true});
  await cp(join(options.root,"apps/web"),join(options.root,"packages/producer/studio"),{recursive:true});
  const target = {...options.target,app:"packages/producer/studio"};
  await put(options.root,"clossys/clossys.config.ts", `export default {id:"example",archetype:"product",locales:{default:"en",supported:["en"]},targets:{studio:${JSON.stringify(target)}}};`);
  const before = await snapshot(options.root);
  const result = await publishTarget({root:options.root,target:"studio"});
  expect(result.output).toBe(join(options.root,"packages/producer/studio/src/clossys"));
  expect(result.exitCode).toBe(1); // The fixture intentionally lacks some emitted third-party dependencies.
  const after = await snapshot(options.root);
  for (const [path,metadata] of Object.entries(before)) expect(after[path],path).toEqual(metadata);
  for (const path of Object.keys(after).filter(path => !Object.hasOwn(before,path))) expect(path).toMatch(/^packages\/producer\/studio\/src\/clossys\//);
  for (const app of ["packages/producer", "packages/other/studio", "packages/producer/studio-extra"]) {
    await expect(emitAppLocal({...options,target:{...target,app}})).rejects.toThrow(/web application target/);
  }
},120_000);
