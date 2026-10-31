// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../catalog-core/stable.js";
import { importPatterns } from "./pattern.js";
import { sha256 } from "../catalog-core/digest.js";
import { PATTERN_RECIPES } from "../tokens/pattern.js";
describe("pattern candidate", () => {
  it("regenerates the exact descriptor from the shared recipes without upstream or conformance claims", () => {
    expect(readFileSync(new URL("../catalog/fills/foundry/assets.pattern.json", import.meta.url), "utf8")).toBe(stableStringify(importPatterns()[0]));
    expect(importPatterns()[0]!.$extensions["com.clossys.fill"]).toMatchObject({ author: "foundry", conforms: [], evidence: [], pin: { file: "src/tokens/pattern.ts", export: "PATTERN_RECIPES", sha256: sha256(stableStringify(PATTERN_RECIPES)) }, reads: { themes: ["themes.border.default", "themes.spacing.default"], assets: [] } });
  });
});
