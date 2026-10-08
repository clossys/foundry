import type { SitePageLayer } from "./types.js";

function freezeRows(rows: readonly SitePageLayer[]): readonly SitePageLayer[] {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row, deferred: Object.freeze([...row.deferred]) })));
}

/**
 * The page-assembly contract as data: the nine layers of a page, the package
 * that owns each, who mounts it, what this Publisher release does for it and
 * which named parts are deferred. Deeply frozen. A statement of scope, not
 * evidence that a consumer has adopted a layer.
 */
export const SITE_PAGE_LAYERS: readonly SitePageLayer[] = freezeRows([
  { id: 1, name: "Request edge", owner: "Bouncer", mountOwner: "Bouncer", implementationScope: "contract-only", deferred: [] },
  {
    id: 2,
    name: "Document and head",
    owner: "Publisher",
    mountOwner: "Publisher",
    implementationScope: "supplier",
    deferred: ["document function (html, body, lang, dir, fonts, theme bootstrap, viewport)"],
  },
  {
    id: 3,
    name: "Providers and runtime",
    owner: "Their owning packages (telemetry contracts: Observer)",
    mountOwner: "Publisher names provider mount points",
    implementationScope: "contract-only",
    deferred: ["provider mount points"],
  },
  {
    id: 4,
    name: "Shell and chrome",
    owner: "Designer",
    mountOwner: "Publisher frame",
    implementationScope: "implemented",
    deferred: ["signature slot (defineSiteSignature)", "consent card", "locale switcher", "backdrop"],
  },
  {
    id: 5,
    name: "View",
    owner: "Publisher shipped views and registry",
    mountOwner: "Publisher frame",
    implementationScope: "implemented",
    deferred: ["chrome-free LandingView, MarketingView, CollectionView, DocumentView, LegalView, ContactView, PackReviewView, BrandGuideView and SystemAuditView"],
  },
  { id: 6, name: "Per-page head", owner: "Publisher", mountOwner: "Publisher pageHead", implementationScope: "contract-only", deferred: ["pageHead"] },
  {
    id: 7,
    name: "Machine surfaces",
    owner: "Publisher",
    mountOwner: "Publisher",
    implementationScope: "contract-only",
    deferred: ["robots", "sitemap from the route manifest", "web manifest", "icons", "health"],
  },
  {
    id: 8,
    name: "System states",
    owner: "Publisher views",
    mountOwner: "Publisher frame",
    implementationScope: "implemented",
    deferred: ["loading state", "degraded state", "frame-aware ErrorView root"],
  },
  { id: 9, name: "Forms and APIs", owner: "Their owning form/API packages", mountOwner: "Explicit package adapter", implementationScope: "out-of-scope", deferred: [] },
]);
