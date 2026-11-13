/**
 * Internal barrel for the catalog manifests. Not a package export and not
 * re-exported from `src/index.ts`.
 */
export type * from "./types.js";
export { TOKEN_CATALOG, TOKEN_ENTRIES, TOKEN_EXCLUSIONS, TOKEN_GROUPS } from "./tokens.js";
export { ASSET_CATALOG, ASSET_ENTRIES, ASSET_GROUPS } from "./assets.js";
export { ICON_CATALOG, ICON_ENTRIES, ICON_GROUPS } from "./icons.js";
export { COMPONENT_CATALOG, COMPONENT_ENTRIES, COMPONENT_EXPORT_EXCLUSIONS } from "./components.js";
export { BLOCK_CATALOG, BLOCK_ENTRIES, BLOCK_EXPORT_EXCLUSIONS } from "./blocks.js";

import { ASSET_CATALOG } from "./assets.js";
import { COMPONENT_CATALOG } from "./components.js";
import { BLOCK_CATALOG } from "./blocks.js";
import { ICON_CATALOG } from "./icons.js";
import { TOKEN_CATALOG } from "./tokens.js";

/** All five catalogs, in display order. */
export const CATALOGS = [TOKEN_CATALOG, ASSET_CATALOG, ICON_CATALOG, COMPONENT_CATALOG, BLOCK_CATALOG] as const;
