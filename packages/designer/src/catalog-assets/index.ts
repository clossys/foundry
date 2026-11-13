export { AssetValidationError, inspectSvg, inspectGlyph, glyphSvg } from './svg.js';
export { createConsumerIdentitySeeds, instantiateIdentityRule, identityRuleDefinition, deriveIdentity, checkIdentityDerivations, IDENTITY_RULES } from './identity.js';
export type { IdentityRuleId } from './identity.js';
export { checkAssetProfile, authorImageRatios, assetCoverageReport } from './check.js';
export type { AssetFinding, AssetCheckCode, ImageRecord } from './check.js';
export { emitGlyphModule, emitIdentityFiles, assetNotices } from './emit.js';
export type { AssetFile } from './emit.js';
export { withAssetCatalog } from './catalog.js';
export { isImageResource, isVideoResource, VIDEO_REDUCED_MOTION } from './media.js';
export type { ImageResource, ImageSource, VideoResource } from './media.js';
export { IMAGE_RATIOS } from '../importers/image-ratio.js';

export { BACKDROP_GRAPHIC_REFERENCE, BACKDROP_GRAPHIC_SLOT, BACKDROP_GRAPHIC_PATTERNS, backdropGraphic, backdropGraphicFromResolved, isBackdropGraphicRecipe } from "./backdrop-graphic.js";
export type { BackdropGraphicPattern, BackdropGraphicArtifact, BackdropGraphicRecipe, BackdropGraphicTokens } from "./backdrop-graphic.js";
