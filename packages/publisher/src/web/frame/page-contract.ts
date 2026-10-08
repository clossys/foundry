import type { SitePageLayer } from "./types.js";

function freezeRows(rows: readonly SitePageLayer[]): readonly SitePageLayer[] {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

/**
 * The page-assembly contract as data: the nine layers of a page, the package
 * that owns each and who mounts it. Deeply frozen. `implementationScope`
 * records how far the site-frame work implements each layer; it is a
 * statement of scope, not evidence that a layer ships.
 */
export const SITE_PAGE_LAYERS: readonly SitePageLayer[] = freezeRows([
  { id: 1, name: "Request edge", owner: "Bouncer", mountOwner: "Bouncer", implementationScope: "contract-only" },
  { id: 2, name: "Document and head", owner: "Publisher", mountOwner: "Publisher", implementationScope: "supplier" },
  { id: 3, name: "Providers and runtime", owner: "Their owning packages", mountOwner: "Publisher names provider mount points", implementationScope: "contract-only" },
  { id: 4, name: "Shell and chrome", owner: "Designer", mountOwner: "Publisher frame", implementationScope: "this-unit" },
  { id: 5, name: "View", owner: "Publisher shipped views and registry", mountOwner: "Publisher frame", implementationScope: "this-unit" },
  { id: 6, name: "Per-page head", owner: "Publisher", mountOwner: "Publisher pageHead", implementationScope: "this-unit" },
  { id: 7, name: "Machine surfaces", owner: "Publisher", mountOwner: "Publisher", implementationScope: "contract-only" },
  { id: 8, name: "System states", owner: "Publisher views", mountOwner: "Publisher frame", implementationScope: "this-unit" },
  { id: 9, name: "Forms and APIs", owner: "Their owning form/API packages", mountOwner: "Explicit package adapter", implementationScope: "out-of-scope" },
]);
