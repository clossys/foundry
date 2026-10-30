import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectSourceClosure, mergeSourceDependencyRanges, readActiveSourceLibrary } from "@clossys/designer/components/source-closure";
import { emit, resolve as resolveValues, loadCatalog, loadComponentRegistry, loadComponentCompositionRules, loadSectionRegistry, loadBuildCatalog, importFoundryFrames, importFoundrySections, loadFoundrySurfaceHistory } from "@clossys/designer/catalog";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "@clossys/designer/catalog";
import { loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import type { SourceModule } from "@clossys/designer/components/source-closure";
import { projectNavigation } from "../content-map/projections.js";
import { emitContentRoutePage } from "../web/content-route-source.js";
import { readServingPublication } from "./cell-routes.js";
import { appLocalHash, generatedText } from "./format.js";
import { containedAppLocalPath, noAppLocalSymlink, safeAppLocalPath } from "./files.js";
import { analyzeAppLocalSource, appLocalSourceResolver, printAppLocalSource } from "./source.js";

export interface AppLocalTarget {
  readonly app: string;
  readonly format: "web.page.responsive";
  readonly publication: string;
}
export interface EmitAppLocalOptions {
  readonly root: string;
  readonly target: AppLocalTarget;
  readonly outDir?: string;
  /** Optional selected catalog bundles; the default is Designer's installed catalog. */
  readonly catalog?: CompositeCatalogData;
}
export interface AppLocalEmission {
  readonly outDir: string;
  readonly appDir: string;
  readonly files: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
}
function defaultCatalog(): CompositeCatalogData {
  return { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills, rules: loadComponentCompositionRules() }, surfaces: {
    slots: [...loadSectionRegistry().slots, ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames")],
    fills: [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as NonNullable<CompositeCatalogData["surfaces"]>["fills"], transforms: [], rules: [], materializations: [], packageHistory: loadFoundrySurfaceHistory(),
  } };
}
async function writerProjection(root: string): Promise<Record<string, unknown>> {
  const entry = fileURLToPath(import.meta.resolve("@clossys/writer"));
  const module = await import(pathToFileURL(join(dirname(entry), "cells/compile.js")).href) as { compileWriterCells(root: string, out?: string, options?: { format: "library" }): Promise<{ files: Record<string, unknown> }> };
  if (typeof module.compileWriterCells !== "function") throw new Error("Installed Writer cell compiler is unavailable");
  return (await module.compileWriterCells(root, undefined, { format: "library" })).files;
}
const literal = (value: unknown): string => JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
/** Read active cells and resolve real selected source entirely in memory. This never compiles into a consumer directory. */
export async function emitAppLocal(options: EmitAppLocalOptions): Promise<AppLocalEmission> {
  const { target } = options, root = resolve(options.root);
  if (target.format !== "web.page.responsive" || !/^apps\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(target.app)) throw new Error("A web application target under apps/ is required");
  safeAppLocalPath(target.app);
  const appDir = containedAppLocalPath(root, target.app), defaultOut = join(appDir, "src/clossys");
  const outDir = options.outDir === undefined ? defaultOut : isAbsolute(options.outDir) ? resolve(options.outDir) : containedAppLocalPath(root, options.outDir);
  const outputRelative = relative(appDir, outDir);
  if (!outputRelative || outputRelative === ".." || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative)) throw new Error("Generated output must stay inside the selected app");
  await noAppLocalSymlink(appDir); await noAppLocalSymlink(outDir);
  const catalog = options.catalog ?? defaultCatalog();
  const library = await readActiveSourceLibrary(join(root, "clossys/agents/designer"), catalog) as CompositeLibraryData;
  if (!("components" in library)) throw new Error("App-local source emission requires a selected composite Designer library");
  const { map, manifest } = await readServingPublication(join(root, "clossys/agents/publisher"), target.publication, library.source.id);
  if (map.format !== target.format) throw new Error("Publication and target formats differ");
  const writer = await writerProjection(join(root, "clossys/agents/writer"));
  const app = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  const ranges: Record<string, string> = {};
  for (const document of library.components.fills) for (const fill of Object.values(document.components)) for (const dependency of fill.deps) if (!dependency.registryItem) {
    ranges[dependency.name] = mergeSourceDependencyRanges(ranges[dependency.name], dependency.version);
  }
  const appRanges = { ...app.dependencies, ...app.devDependencies, ...app.peerDependencies, ...app.optionalDependencies } as Record<string, string>;
  const additionalEntries: SourceModule[] = [
    { path: "routes.ts", content: `export const publication = ${literal(map)} as const;\nexport const routes = publication.entries;\n` },
    { path: "nav.ts", content: `export const navigation = ${literal(Object.fromEntries(map.entries.filter(entry => entry.kind === "page").map(entry => [entry.id, projectNavigation(map, entry.id)])))} as const;\n` },
  ];
  const locales = new Map<string, unknown[]>();
  for (const [path, records] of Object.entries(writer)) {
    const locale = /^([^/]+)\/[^/]+\/cells\.json$/.exec(path)?.[1];
    if (locale && Array.isArray(records)) { safeAppLocalPath(locale); if (locale.includes("/")) throw new Error("Invalid locale"); locales.set(locale, [...(locales.get(locale) ?? []), ...records]); }
  }
  if (!locales.size) throw new Error("Active Writer library has no locale records");
  for (const [locale, records] of locales) additionalEntries.push({ path: `copy/${locale}.ts`, content: `export const records = ${literal(records)} as const;\nexport default records;\n` });
  for (const route of manifest.routes) {
    safeAppLocalPath(route.source.file);
    additionalEntries.push({ path: route.source.file, content: emitContentRoutePage(route) });
  }
  const valueLibrary = { source: library.source, ...library.values };
  const styles = emit(resolveValues({ catalog: catalog.values, library: valueLibrary }), ["css-brand", "css-scales", "css-fonts"]);
  additionalEntries.push({ path: "theme.css", content: styles.map(file => file.contents).join("\n") });
  const sourceRanges = { ...appRanges, ...ranges };
  for (const name of Object.keys(ranges)) if (appRanges[name] !== undefined) sourceRanges[name] = mergeSourceDependencyRanges(ranges[name], appRanges[name]!);
  const sourceResolver = appLocalSourceResolver(library, appDir, sourceRanges);
  const selected = new Set(library.components.fills.flatMap(document => Object.values(document.components).map(fill => fill.slot)));
  const closure = collectSourceClosure({ library, additionalEntries, analyze: analyzeAppLocalSource, resolve: request => {
    const result = sourceResolver(request);
    if (result.kind === "source" && result.module.ownerSlot !== undefined && !selected.has(result.module.ownerSlot)) throw new Error(`Source component is outside selected library: ${result.module.ownerSlot} (${result.module.path})`);
    return result;
  }, transformSource: printAppLocalSource });
  const files: Record<string, string> = {};
  for (const file of closure.files) files[file.path] = generatedText(file.content);
  files["dependencies.json"] = generatedText(`${JSON.stringify(closure.dependencies, null, 2)}\n`);
  files[".manifest.json"] = generatedText(`${JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, source]) => [path, appLocalHash(source)])), null, 2)}\n`);
  return { outDir, appDir, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), dependencies: closure.dependencies };
}
