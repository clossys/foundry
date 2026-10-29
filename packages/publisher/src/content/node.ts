import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainPublisherContent } from "./cli/index.js";

/** Node-only revision snapshots and SHA-256 integrity checks. */
export { candidateRevisionContent, computeContentDigest } from "./digest.js";
export { createContentRevision, appendContentRevision, validateContentRevisionIntegrity } from "./revisions.js";
export { checkContentApproval, checkContentActivation } from "./approval.js";
export type { ContentApprovalPurpose } from "./approval.js";
export { loadContentStore, writeContentStore } from "./store/index.js";
export type { ContentStoreOptions, LoadedContentStore } from "./store/index.js";
export { readConsumerLibrarySnapshot } from "./store/library.js";
export { createContentOwnerApproval } from "./approval.js";
export { prepareContentRelease, computeReleaseDigest } from "./release/prepare.js";
export { writeContentRelease } from "./store/release.js";
export type { ReleaseInput, ReleaseManifest, TargetBuildManifest, HandoverReceipt, ReleaseBundle, ReleaseResult } from "./release/types.js";
export { mainPublisherContent } from "./cli/index.js";
export type { PublisherCommand, PublisherCommandInput, PublisherCommandResult } from "./cli/types.js";

function isPublisherContentEntry(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isPublisherContentEntry()) {
  const result = await mainPublisherContent(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = result.exitCode;
}
export { localePathFor, buildLocaleRoutePlan, buildSitemapAlternates } from "./hreflang.js";
export type { PublisherLocaleManifest, LocaleRouteOptions, LocaleRouteFinding, HreflangAlternate, LocalePageMetadata, LocaleRoutePlan, SitemapLocaleEntry } from "./hreflang.js";

/** Publisher-owned site identity records and surface drift checks (Node only). */
export { SITE_IDENTITY_FILE, readSiteIdentity, validateSiteIdentity, copyEntriesFromRegistry, resolveBrandTaglines, checkSiteIdentityDrift } from "../site-identity/index.js";
export type { SiteIdentity, SiteIdentityRead, SiteIdentityReadIssue, BrandIdentity, BrandLegalEntity, BrandTagline, CopyEntryLike, ResolvedTagline, SiteIdentityDriftKind, SiteIdentityDriftFinding, SiteIdentityDriftOptions, SiteIdentityDriftState, SiteIdentityDriftResult, SiteIdentitySurface } from "../site-identity/index.js";
