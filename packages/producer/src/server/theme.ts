import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog, loadComponentCompositionRules, loadComponentRegistry } from "@clossys/designer/catalog";
import type { CatalogData, CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, LibraryData } from "@clossys/designer/catalog";
import { loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import { agentModule, agentRoot, hasCellTree, readCells, readStudioCells } from "./cells.js";
import { isSuspendedStudioError, reportStudioGate, type StudioReportSink } from './studio-render-policy.js';
import { defaultStudioTheme, themeCss, themeHash, type StudioTheme } from "./theme-default.js";
export { defaultStudioTheme, themeHash, type StudioTheme } from "./theme-default.js";

export interface StudioDesignerLibrary {
  catalog: CatalogData | CompositeCatalogData;
  library: LibraryData | CompositeLibraryData;
  activeIds: string[];
  componentOptions?: CompositeEngineInput["componentOptions"];
}

/** Validated Designer cells, projected by their owning compiler in isolation. */
export async function readStudioDesignerLibrary(root: string, report?: StudioReportSink): Promise<StudioDesignerLibrary | undefined> {
  const source = agentRoot(root, "designer");
  if (!await hasCellTree(source)) return undefined;
  const active = report ? await readStudioCells(root, 'designer', report, true) : await readCells(root, "designer", true);
  // The shared reader above checks the tree, active pointers and all ancestors.
  const handle = await open(join(source, "tree.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  let tree: any;
  try { tree = JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
  const freeze = report ? (finding: { message: string }) => report({ gate: 'LeafFreeze', blocking: false, state: 'reported', message: finding.message }) : undefined;
  const values = loadCatalog(freeze);
  let catalog: CatalogData | CompositeCatalogData = values;
  if (tree.meta?.metadata?.format === "composite-v1") {
    const surfaces = await agentModule("designer", "library-cli/surface-catalog.js");
    catalog = { values, components: { slots: loadComponentRegistry(freeze).slots, fills: loadCatalogBundles().componentFills, rules: loadComponentCompositionRules() }, surfaces: surfaces.foundrySurfaceCatalog(freeze) };
  }
  if (report) {
    // Preview authored data directly. This reads no generated projection, creates no
    // receipt and never proposes, activates or confirms a cell.
    const profile = await agentModule('designer', 'library-cli/cells.js');
    const format = await agentModule('director', 'cell-format/index.js');
    const fills = active.map(cell => {
      try { return profile.parseLibraryCell(cell.source, cell.path).fill; }
      catch (error) {
        if (!isSuspendedStudioError(error)) throw error;
        reportStudioGate(report, 'S1-S8/render-cell-confirmations', error);
        const parsed = format.parseDocument(cell.source), body = parsed.ok && format.tokenizeBody(parsed.value.body);
        const documents = body?.ok ? body.value.filter((token: { type: string }) => token.type === 'json') : [];
        if (documents.length !== 1 || documents[0].value?.$extensions?.['com.clossys.fill']?.slot !== cell.id) throw new Error('Studio cell has no unambiguous Fill source.');
        return documents[0].value;
      }
    });
    const metadata = tree.meta?.metadata, source = tree.meta?.source;
    if (!metadata || !source) throw new Error('Designer source metadata is missing.');
    if (metadata.format !== 'composite-v1') return { catalog, library: { ...metadata, source, fills } as LibraryData, activeIds: active.map(cell => cell.id) };
    const owned = tree.meta?.files ?? {};
    const files = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || typeof owned[path] !== 'string')) throw new Error('Designer owned source is missing.');
      return paths.map((path: string) => ({ path, content: owned[path] as string }));
    };
    const library: CompositeLibraryData = { source, ...(metadata.adoptedAt ? { adoptedAt: metadata.adoptedAt } : {}), values: { ...metadata.values, fills: fills.filter(fill => /^(tokens|assets)\./.test(fill.$extensions['com.clossys.fill'].slot)) }, components: { ...metadata.components, fills: fills.filter(fill => fill.$extensions['com.clossys.fill'].slot.startsWith('components.')), files: files(metadata.files) }, ...(metadata.surfaces ? { surfaces: { version: 1, fills: fills.filter(fill => /^(sections|frames)\./.test(fill.$extensions['com.clossys.fill'].slot)), files: files(metadata.surfaces.files) } } : {}) };
    return { catalog, library, activeIds: active.map(cell => cell.id), componentOptions: tree.meta?.componentOptions };
  }
  const reader = await agentModule("designer", "library-cli/fs-library.js");
  // Designer owns this temporary projection and removes it in a finally block.
  const library = await reader.readLibraryFromCells(source, catalog);
  return { catalog, library, activeIds: active.map(cell => cell.id), componentOptions: tree.meta?.componentOptions };
}

/** Read active cells through Designer's compiler without writing into the consumer. */
export async function studioTheme(root: string): Promise<StudioTheme> {
  try {
    const input = await readStudioDesignerLibrary(root);
    if (!input || !input.activeIds.some(id => id.startsWith("tokens."))) return defaultStudioTheme();
    const { library } = input;
    const tokens = "values" in library ? { ...library.values, source: library.source, adoptedAt: library.adoptedAt } : library;
    const css = themeCss(tokens);
    return { source: "consumer", css, hash: themeHash(css) };
  } catch {
    return { ...defaultStudioTheme(), message: "Consumer theme could not be compiled; using the Foundry theme" };
  }
}
