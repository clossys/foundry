import { describe, expect, it } from "vitest";
import { synthetic, syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange, materializeSourceFill } from "./changeset-components.js";
import { componentLibraryHash } from "./resolve-components.js";

describe("standalone component changes", () => {
  it("adopts a descriptor pointer without package bytes and rejects stale or member-scoped operations", () => {
    const { catalog, library } = synthetic();
    const change = { op: "adopt" as const, slot: "components.button", source: "test-kit" };
    const result = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [change] });
    expect(result.files).toEqual([]); expect(result.fills[0]!.components.button!.origin.kind).toBe("adopted");
    expect(result.selection?.slots[0]?.sources).toEqual(["test-kit"]);
    expect(() => applyComponentLibraryChange(catalog, result, { baseHash: componentLibraryHash(library), changes: [change] })).toThrow(/baseHash/);
    expect(() => applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ ...change, members: [] }] })).toThrow(/slot-scope/);
    expect(library.fills).toEqual([]);
  });
  it("rejects unsafe, missing and unsupported source bundles", async () => {
    const input = syntheticSource();
    const transform = { id: "synthetic@1", run: () => ({ files: [input.file, input.notice], blockers: [] }) };
    const fetcher = async () => input.upstream.content;
    const bundle = await materializeSourceFill(input.candidate, fetcher, [transform]);
    const cs = { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt" as const, slot: input.candidate.slot, source: input.candidate.source }] };
    expect(() => applyComponentLibraryChange(input.catalog, input.library, cs)).toThrow(/bundle/);
    expect(applyComponentLibraryChange(input.catalog, input.library, cs, [bundle]).files).toHaveLength(2);
    await expect(materializeSourceFill(input.candidate, async () => "tampered", [transform])).rejects.toThrow(/upstream hash/);
    await expect(materializeSourceFill(input.candidate, fetcher, [])).rejects.toThrow(/transform/);
    const changed = structuredClone(bundle); changed.files[0]!.content += " ";
    expect(() => applyComponentLibraryChange(input.catalog, input.library, cs, [changed])).toThrow(/output hash/);
    const blocked = structuredClone(input.candidate); blocked.blockers = [{ code: "K4", message: "unresolved" }];
    await expect(materializeSourceFill(blocked, fetcher, [transform])).rejects.toThrow(/blocked/);
  });
  it("uses registered rules only, checks exact inputs and records composed provenance", () => {
    const { catalog, library, candidate } = synthetic();
    const adopted = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "adopt", slot: candidate.slot, source: candidate.source }] });
    const slot = "components.select";
    const extended = { ...catalog, slots: [...catalog.slots, { ...catalog.slots[0]!, id: slot }] };
    const cs = { baseHash: componentLibraryHash(adopted), changes: [{ op: "compose" as const, slot, rule: "compose:synthetic@1" }] };
    expect(() => applyComponentLibraryChange(extended, adopted, cs)).toThrow(/registered rule/);
    const next = applyComponentLibraryChange({ ...extended, rules: [{ id: "compose:synthetic@1", kind: "compose", slot, inputs: [candidate.slot], template: { ...candidate, slot, reads: { ...candidate.reads, components: [candidate.slot] }, composes: [candidate.slot] }, files: [] }] }, adopted, cs);
    expect(next.fills.find(doc => doc.components.select)!.components.select!.origin.kind).toBe("composed");
    expect(() => applyComponentLibraryChange(extended, next, { baseHash: componentLibraryHash(next), changes: [{ op: "remove", slot: candidate.slot }] })).toThrow(/dependent/);
  });
  it("authoring re-kinds an edited descriptor without inventing evidence", () => {
    const { catalog, library, candidate } = synthetic();
    const next = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "author", slot: candidate.slot, fill: candidate, files: [] }] });
    expect(next.fills[0]!.components.button!.origin).toEqual({ kind: "authored", license: "MIT" });
    expect(next.fills[0]!.$extensions["com.clossys.fill"].evidence).toEqual([]);
    expect(next.fills[0]!.$extensions["com.clossys.fill"].conforms).toEqual([]);
  });
});
