/** The Publisher-owned site identity record and pure surface drift check. */
export { SITE_IDENTITY_FILE, readSiteIdentity, validateSiteIdentity, copyEntriesFromRegistry, resolveBrandTaglines } from "./identity.js";
export type { SiteIdentity, SiteIdentityRead, BrandIdentity, BrandLegalEntity, BrandTagline, CopyEntryLike, ResolvedTagline } from "./identity.js";
export { checkSiteIdentityDrift } from "./drift.js";
export type { SiteIdentityDriftKind, SiteIdentityDriftFinding, SiteIdentityDriftOptions, SiteIdentityDriftState, SiteIdentityDriftResult, SiteIdentitySurface } from "./drift.js";
export type { SiteIdentityReadIssue } from "./json-file.js";
