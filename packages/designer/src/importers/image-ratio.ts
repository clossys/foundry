import type { FillDoc } from "../catalog-core/types.js";
/** Mathematical crop presets authored here; no claim of an upstream library import. */
export const IMAGE_RATIOS = Object.freeze({ square: { width: 1, height: 1 }, portrait: { width: 3, height: 4 }, landscape: { width: 4, height: 3 }, wide: { width: 16, height: 9 }, cinema: { width: 21, height: 9 }, share: { width: 191, height: 100 } });
export function importImageRatios(): FillDoc[] {
  return [{ $extensions: { "com.clossys.fill": {
    id: "foundry/assets.image-ratio", slot: "assets.image-ratio", source: "foundry", mode: "implementation",
    sourceAddress: "importers/image-ratio.ts", relation: "same-contract", builtOn: [], conforms: [], evidence: [],
    author: "foundry", trust: "foundry", license: "MIT", status: "draft", reads: { themes: [], assets: [] },
  } }, assets: { "image-ratio": Object.fromEntries(Object.entries(IMAGE_RATIOS).map(([name, ratio]) => [name, { $type: "rules", $value: { ...ratio } }])) } }];
}
