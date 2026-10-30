import { isRenderAsset } from "../internal/assets.js";
import type { ComposeFinding } from "./types.js";

/** Closed metadata contract for consumer-owned content in the canonical media slot. */
export const CONTENT_ASSET_FORMATS = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml", "video/mp4", "video/webm"] as const);
export const CONTENT_ASSET_RATIOS = Object.freeze(["1:1", "4:3", "3:4", "16:9"] as const);
export interface ContentAssetContract {
  width: number;
  height: number;
  aspectRatio: typeof CONTENT_ASSET_RATIOS[number];
  format: typeof CONTENT_ASSET_FORMATS[number];
  loading: "lazy" | "eager";
}
export interface ContentAssetReport { ok: boolean; findings: ComposeFinding[] }
const imageFormats = new Set<string>(CONTENT_ASSET_FORMATS.filter(format => format.startsWith("image/")));
const videoFormats = new Set<string>(CONTENT_ASSET_FORMATS.filter(format => format.startsWith("video/")));
function finding(rule: string, path: string, message: string): ComposeFinding { return { rule: `content-asset-${rule}`, severity: "error", path, message }; }
function plainData(value: unknown, ancestors = new Set<object>()): boolean {
  if (typeof value === "function" || typeof value === "symbol") return false;
  if (value === null || typeof value !== "object") return true;
  if (ancestors.has(value)) return false;
  if (![Object.prototype, null, ...(Array.isArray(value) ? [Array.prototype] : [])].includes(Object.getPrototypeOf(value))) return false;
  ancestors.add(value);
  if (Array.isArray(value)) for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) || !plainData(descriptor.value, ancestors)) return false;
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) return false;
  }
  ancestors.delete(value);
  return true;
}
function report(findings: ComposeFinding[]): ContentAssetReport { return { ok: findings.length === 0, findings }; }
/** Checks declared metadata only; no bytes, browser, resolver or style source is read. */
export function checkContentAssetContract(value: unknown): ContentAssetReport {
  try {
    const keys = ["width", "height", "aspectRatio", "format", "loading"];
    if (value === null || typeof value !== "object" || Array.isArray(value) || !plainData(value) || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return report([finding("shape", "", "Expected a closed width, height, aspectRatio, format and loading declaration.")]);
    const contract = value as ContentAssetContract;
    const findings: ComposeFinding[] = [];
    for (const key of ["width", "height"] as const) if (!Number.isSafeInteger(contract[key]) || contract[key] <= 0) findings.push(finding("dimensions", key, "Intrinsic dimensions must be positive safe integers."));
    if (!(CONTENT_ASSET_RATIOS as readonly unknown[]).includes(contract.aspectRatio)) findings.push(finding("ratio", "aspectRatio", "Unsupported aspect ratio."));
    else if (findings.length === 0) {
      const [width, height] = contract.aspectRatio.split(":").map(Number);
      if (BigInt(contract.width) * BigInt(height!) !== BigInt(contract.height) * BigInt(width!)) findings.push(finding("ratio", "aspectRatio", "Declared dimensions must match the aspect ratio without cropping."));
    }
    if (!(CONTENT_ASSET_FORMATS as readonly unknown[]).includes(contract.format)) findings.push(finding("format", "format", "Unsupported declared MIME format."));
    if (contract.loading !== "lazy" && contract.loading !== "eager") findings.push(finding("loading", "loading", "Loading must be lazy or eager."));
    return report(findings);
  } catch { return report([finding("shape", "", "The declaration could not be read as data.")]); }
}
/** Compares a resolved fill's metadata to its slot; does not certify the referenced file. */
export function checkContentAssetFill(contract: unknown, asset: unknown, assetId: string): ContentAssetReport {
  const declared = checkContentAssetContract(contract);
  if (!declared.ok) return declared;
  try {
    if (!plainData(asset) || !isRenderAsset(asset)) return report([finding("fill", "assetId", "The asset did not resolve to paintable image or video data.")]);
    const expected = contract as ContentAssetContract;
    const findings: ComposeFinding[] = [];
    if (typeof assetId !== "string" || assetId.trim() === "" || (asset as { id?: unknown }).id !== assetId) findings.push(finding("id", "assetId", "The resolved asset id must match the requested slot asset id."));
    if (asset.width !== expected.width || asset.height !== expected.height) findings.push(finding("dimensions", "assetId", "Resolved intrinsic dimensions do not match the slot declaration."));
    if (asset.type === "image") {
      if (!imageFormats.has(expected.format) || asset.mimeType !== expected.format || asset.sources?.some(source => !Number.isSafeInteger(source.width) || source.width <= 0 || !imageFormats.has(source.format ?? ""))) findings.push(finding("format", "assetId", "The image and responsive sources must declare supported MIME formats matching the fallback declaration."));
    } else {
      if (!videoFormats.has(expected.format) || !asset.sources.some(source => source.mimeType === expected.format) || asset.sources.some(source => !videoFormats.has(source.mimeType))) findings.push(finding("format", "assetId", "The video sources must use supported MIME formats and include the declared format."));
      if (asset.captions === undefined || asset.captions.length === 0 || asset.autoplay === true) findings.push(finding("accessibility", "assetId", "Content video requires captions and user-controlled playback."));
    }
    return report(findings);
  } catch { return report([finding("fill", "assetId", "The resolved fill could not be read as data.")]); }
}
