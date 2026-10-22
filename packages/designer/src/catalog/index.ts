/**
 * Internal barrel for the catalog manifests. Not a package export and not
 * re-exported from `src/index.ts`.
 */
export type * from "./types.js";
export { TOKEN_CATALOG, TOKEN_ENTRIES, TOKEN_EXCLUSIONS, TOKEN_GROUPS } from "./tokens.js";
export { ASSET_CATALOG, ASSET_ENTRIES, ASSET_GROUPS } from "./assets.js";
export { ICON_CATALOG, ICON_ENTRIES, ICON_GROUPS } from "./icons.js";
export { ATOM_CATALOG, ATOM_ENTRIES, ATOM_EXPORT_EXCLUSIONS, ATOM_GROUPS } from "./atoms.js";
export { BLOCK_CATALOG, BLOCK_ENTRIES, BLOCK_EXPORT_EXCLUSIONS, BLOCK_GROUPS } from "./blocks.js";

import { ASSET_CATALOG } from "./assets.js";
import { ATOM_CATALOG } from "./atoms.js";
import { BLOCK_CATALOG } from "./blocks.js";
import { ICON_CATALOG } from "./icons.js";
import { TOKEN_CATALOG } from "./tokens.js";

/** All five catalogs, in display order. */
export const CATALOGS = [TOKEN_CATALOG, ASSET_CATALOG, ICON_CATALOG, ATOM_CATALOG, BLOCK_CATALOG] as const;
