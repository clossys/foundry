import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog, loadComponentCompositionRules, loadComponentRegistry } from "@clossys/designer/catalog";
import { loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import { agentModule, agentRoot, hasCellTree, readCells } from "./cells.js";
import { defaultStudioTheme, themeCss, themeHash, type StudioTheme } from "./theme-default.js";
export { defaultStudioTheme, themeHash, type StudioTheme } from "./theme-default.js";

/** Read active cells through Designer's compiler without writing into the consumer. */
export async function studioTheme(root: string): Promise<StudioTheme> {
  try {
    const source = agentRoot(root, "designer");
    if (!await hasCellTree(source)) return defaultStudioTheme();
    const active = await readCells(root, "designer", true);
    if (!active.some(cell => cell.id.startsWith("tokens."))) return defaultStudioTheme();
    // The shared reader above checks the tree, active pointers and all ancestors.
    const handle = await open(join(source, "tree.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let tree: any;
    try { tree = JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
    const values = loadCatalog();
    let catalog: any = values;
    if (tree.meta?.metadata?.format === "composite-v1") {
      const surfaces = await agentModule("designer", "library-cli/surface-catalog.js");
      catalog = { values, components: { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills, rules: loadComponentCompositionRules() }, surfaces: surfaces.foundrySurfaceCatalog() };
    }
    const reader = await agentModule("designer", "library-cli/fs-library.js");
    // Designer owns this temporary projection and removes it in a finally block.
    const library = await reader.readLibraryFromCells(source, catalog);
    const tokens = "values" in library ? { ...library.values, source: library.source, adoptedAt: library.adoptedAt } : library;
    const css = themeCss(tokens);
    return { source: "consumer", css, hash: themeHash(css) };
  } catch {
    return { ...defaultStudioTheme(), message: "Consumer theme could not be compiled; using the Foundry theme" };
  }
}
