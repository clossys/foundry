import type { CatalogData, CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, LibraryData } from "@clossys/designer/catalog";
import { readConsumerTheme } from "../read/theme-pins.js";
import type { StudioTheme } from "./theme-default.js";
export { defaultStudioTheme, themeHash, type StudioTheme } from "./theme-default.js";

/** A Designer catalog and library for the Studio engine selection. */
export interface StudioDesignerLibrary {
  catalog: CatalogData | CompositeCatalogData;
  library: LibraryData | CompositeLibraryData;
  activeIds: string[];
  componentOptions?: CompositeEngineInput["componentOptions"];
}

/**
 * The consumer's brand stylesheet from its pinned `themes.*` Designer slots. A consumer with no
 * Designer slot model, or no pinned theme slot, is unbranded (the package default theme, reported as
 * such); pinned theme slots that do not compile are a visible error, never a silent fallback.
 * Resolution and projection live in `../read/theme-pins.ts` and `@clossys/designer/build/theme`.
 */
export async function studioTheme(root: string): Promise<StudioTheme> {
  return readConsumerTheme(root);
}
