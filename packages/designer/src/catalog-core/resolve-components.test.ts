import { describe, expect, it } from "vitest";
import { synthetic } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange } from "./changeset-components.js";
import { componentLibraryHash, resolveComponents } from "./resolve-components.js";

describe("standalone component resolution", () => {
  it("reads only consumer fills, reports missing observations and refuses hand edits", () => {
    const input = synthetic();
    const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
    const resolve = (fills = input.catalog.fills) => resolveComponents({ catalog: { ...input.catalog, fills }, library, values: { tokens: input.check.tokens, assets: input.check.assets }, evidence: { ...input.check, observations: {} } });
    const result = resolve();
    expect(result.components["components.button"]!.impl).toEqual(input.candidate.impl);
    expect(result.check.ok).toBe(false); expect(result.check.findings.some(finding => /unavailable/.test(finding.message))).toBe(true);
    expect(resolve([])).toEqual(result);
    library.fills[0]!.components.button!.propMap["size.md"] = "Button.size=lg";
    expect(() => resolve()).toThrow(/hand-edit/);
  });
  it("fails closed for missing lower-layer reads and required consumer components", () => {
    const input = synthetic();
    expect(() => resolveComponents({ catalog: input.catalog, library: input.library, values: { tokens: {}, assets: [] }, requiredMembers: { "components.button": ["size.md"] } })).toThrow(/missing component/);
    const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
    expect(() => resolveComponents({ catalog: input.catalog, library, values: { tokens: {}, assets: [] } })).toThrow(/unresolved token/);
  });
});
