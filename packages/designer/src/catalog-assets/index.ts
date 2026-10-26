export { AssetValidationError, inspectSvg, inspectGlyph, glyphSvg } from './svg.js';
export { createConsumerIdentitySeeds, instantiateIdentityRule, identityRuleDefinition, deriveIdentity, checkIdentityDerivations, IDENTITY_RULES } from './identity.js';
export type { IdentityRuleId } from './identity.js';
export { checkAssetProfile, authorImageRatios, assetCoverageReport } from './check.js';
export type { AssetFinding, AssetCheckCode, ImageRecord } from './check.js';
export { emitGlyphModule, emitIdentityFiles, assetNotices } from './emit.js';
export type { AssetFile } from './emit.js';
export { withAssetCatalog } from './catalog.js';
