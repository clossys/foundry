import source from "./catalog/records/admin-pages.r1.en.json" with { type: "json" };
import { freezeAdminCopy } from "./admin-copy-core.js";
import type { AdminRouteCopy } from "./admin-route-copy.js";

/** Page cells retain their semantic aliases and declare shared-record sources explicitly. */
export const ADMIN_PAGES_COPY_EN = freezeAdminCopy(source as typeof source & AdminRouteCopy);
