import type { FillDoc } from "../catalog-core/types.js";
import { PATTERN_RECIPES, PATTERN_TOKEN_READS } from "../tokens/pattern.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
/** Foundry pattern candidate generated from the shared token-only recipes; no upstream library import. */
export function importPatterns(): FillDoc[] {
  return [{ $extensions: { "com.clossys.fill": {
    id: "foundry/assets.pattern", slot: "assets.pattern", source: "foundry", mode: "implementation",
    sourceAddress: "importers/pattern.ts", relation: "same-contract", builtOn: [], conforms: [], evidence: [],
    author: "foundry", trust: "foundry", license: "MIT", pin: { file: "src/tokens/pattern.ts", export: "PATTERN_RECIPES", sha256: sha256(stableStringify(PATTERN_RECIPES)) }, status: "draft", reads: { themes: [...PATTERN_TOKEN_READS], assets: [] },
  } }, assets: { pattern: Object.fromEntries(Object.entries(PATTERN_RECIPES).map(([name, recipe]) => [name, { $type: "rules", $value: { ...recipe } }])) } }];
}
