import type { ContentAssetContract, SectionedViewAssetMedia } from "./index.js";
const contract = { width: 1600, height: 900, aspectRatio: "16:9", format: "image/png", loading: "lazy" } satisfies ContentAssetContract;
const meaningful: SectionedViewAssetMedia = { type: "asset", assetId: "example.image", purpose: "meaningful", alt: { id: "example.alt" }, contract };
const decorative: SectionedViewAssetMedia = { type: "asset", assetId: "example.image", purpose: "decorative", contract };
// @ts-expect-error Meaningful media requires approved alt copy.
const missing: SectionedViewAssetMedia = { type: "asset", assetId: "example.image", purpose: "meaningful", contract };
// @ts-expect-error Decorative media cannot carry meaningful alt copy.
const conflicting: SectionedViewAssetMedia = { ...decorative, alt: { id: "example.alt" } };
// @ts-expect-error Decorative media cannot introduce a focusable video player.
const hiddenVideo: SectionedViewAssetMedia = { ...decorative, contract: { ...contract, format: "video/mp4" } };
// @ts-expect-error Alt is a CopyRef, never raw text.
const rawAlt: SectionedViewAssetMedia = { ...meaningful, alt: "Description" };
// @ts-expect-error The format set is closed.
const format: ContentAssetContract = { ...contract, format: "image/gif" };
// @ts-expect-error The loading policy is closed.
const loading: ContentAssetContract = { ...contract, loading: "idle" };
// @ts-expect-error Consumer content carries no arbitrary style.
const styled: SectionedViewAssetMedia = { ...meaningful, style: { color: "red" } };
void [meaningful, decorative, missing, conflicting, hiddenVideo, rawAlt, format, loading, styled];
