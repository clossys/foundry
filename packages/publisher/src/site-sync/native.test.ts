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
import { emitAppLocal, parseAppLocalJson, parseGeneratedText, verifyAppLocal, writeAppLocal, generatedText } from "../app-local/index.js";

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
  const selected = bundles.componentFills.map(componentOf).filter(fill => (fill.source === "foundry" && fill.impl.kind === "package" || fill.slot === "components.sheet") && !fill.blockers?.length);
  const remaining = [...selected], ordered: typeof selected = [];
  while (remaining.length) {
    const index = remaining.findIndex(fill => [...fill.reads.components, ...fill.composes].every(slot => ordered.some(prior => prior.slot === slot)));
    if (index < 0) throw new Error("Selected runtime fixture has an unresolved component dependency");
    ordered.push(...remaining.splice(index, 1));
  }
  const prior = surfaces.library;
  const library = applyLibraryChange(catalog, prior, { baseHash: libraryHash(prior), bundles: bundles.sourceBundles, changes: ordered.map(fill => ({ portion: "components" as const, change: { op: "adopt" as const, slot: fill.slot, source: fill.source } })) }, { surfaceOptions: surfaces.options });
  return { catalog, library, componentOptions: undefined, surfaceOptions: surfaces.options };
}
let runtimeSelection: ReturnType<typeof selectedRuntime> | undefined;
export async function appLocalFixture(serving = true) {
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

import { runSiteSyncCli } from "./cli.js";
it("runs the real emitter through the command's write/check/hand-edit flow and ignores draft cells", async () => {
  const fixture = await appLocalFixture();
  const hosts = "components/_consumer/src/hosts.tsx";
  // Consumer-owned adapters enter the emitter closure through the serving loader.
  await writeFile(join(fixture.root, "apps/web/src/hosts.tsx"), [
    'export { SiteFrame } from "@clossys/designer/frames";',
    'export { ConsentExperience as ConsentHost } from "@clossys/publisher/web/consent";',
    'export { EmptyState as NotFound } from "@clossys/designer/blocks/server";',
    "",
  ].join("\n"));
  const loader = join(fixture.root, "apps/web/src/content-loader.ts");
  await writeFile(loader, `import "./hosts";\n${await readFile(loader, "utf8")}`);
  const cell = join(fixture.root, "clossys/agents/publisher/cells/page.home/v1.md"), original = await readFile(cell, "utf8");
  await writeFile(cell.replace("v1.md", "v2.md"), original.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace(/^confirmed:.*\n/m, "").replace("title: Home", "title: Draft must be invisible"));
  const expected = await emitAppLocal(fixture);
  await writeFile(join(fixture.root, "apps/web/package.json"), JSON.stringify({ name: "example-co-site", dependencies: expected.dependencies }));
  const host = {
    locale: "en", frame: { file: hosts, export: "SiteFrame", props: { skipLabel: "Example Co." } },
    consent: { file: hosts, export: "ConsentHost" }, notFound: { file: hosts, export: "NotFound", props: { title: "Example Co." } },
    security: { contact: "https://example.test/contact", expires: "2027-10-29T00:00:00Z" }, formSubmit: "/api/contact",
  };
  await mkdir(join(fixture.root, "clossys/agents/publisher"), { recursive: true });
  await writeFile(join(fixture.root, "clossys/agents/publisher/site-identity.json"), JSON.stringify({ canonicalOrigin: "https://example.test" }));
  await writeFile(join(fixture.root, "clossys/clossys.config.ts"), `export default ${JSON.stringify({ targets: { site: fixture.target } })};\nexport const siteSyncHost = ${JSON.stringify(host)};\n`);
  const write = await runSiteSyncCli(["--root", fixture.root]);
  expect(write, write.message).toMatchObject({ exitCode: 0, findings: [] });
  expect((await runSiteSyncCli(["--root", fixture.root, "--check"])).exitCode).toBe(0);
  const generated = join(fixture.root, "apps/web/src/clossys/routes.ts");
  expect(await readFile(generated, "utf8")).not.toContain("Draft must be invisible");
  const page = join(fixture.root, "apps/web/app/page.tsx");
  await writeFile(page, `${await readFile(page, "utf8")}// hand edit\n`);
  expect(await runSiteSyncCli(["--root", fixture.root, "--check"])).toMatchObject({ exitCode: 1, findings: expect.arrayContaining([expect.objectContaining({ kind: "hand-edit", path: "app/page.tsx" })]) });
}, 120_000);
