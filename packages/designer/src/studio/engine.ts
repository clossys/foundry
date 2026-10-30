import * as catalog from "../catalog-core/index.js";

/** The engine seam uses consumer libraries for every resolution and emission. */
export type StudioEngine = Pick<typeof catalog, "loadCatalog" | "resolve" | "check" | "emit" | "applyLibraryChange" | "libraryHash" | "generateSelection">;
export const studioEngine: StudioEngine = catalog;
