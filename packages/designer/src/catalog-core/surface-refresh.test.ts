// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyCompositeLibraryChange, compositeLibraryHash, resolveComposite } from "./library-components.js";
import { loadCatalog } from "./index.js";
import { adoptedSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { surfaceEntryOf, surfacePackageDescriptorHash, resolveSurfacePackageDescriptor } from "./surface-library.js";
import type { CompositeCatalogData, CompositeLibraryData, CompositeChangeSet, FrameSlot } from "./types.js";
import type { SurfacePackageDocument, SurfacePackageEntry, SurfacePackageOrigin } from "./surface-types.js";

const slot = "frames.reader";
const options = { surfaceOptions: { packages: [{ module: "@example/surface-kit/frames", version: "1.0.0", artifactSha256: "a".repeat(64), values: ["Reader"], types: [] }], measurements: [] } };
function fixture() {
  const contract: FrameSlot = { id: slot, layer: "frames", status: "draft", requires: [], contract: { kind: "frame", root: "div", landmarks: [], slots: [{ id: "main", required: true, accepts: "host-node" }], members: { mode: "closed", names: [] }, statePorts: [], rendering: "server", breakpoints: [], allowedReads: { themes: [], assets: [] } } };
  const candidate: SurfacePackageDocument = { $extensions: { "com.clossys.fill": { id: "foundry/frames.reader", slot, source: "foundry", mode: "implementation", sourceAddress: "fills/frames.reader.json", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", status: "draft", pin: { package: "@example/surface-kit", version: "1.0.0", export: "./frames#Reader" } } }, frames: { reader: { slot, members: [], propMap: {}, slots: { main: "children" }, statePorts: {}, impl: { kind: "package", module: "@example/surface-kit/frames", export: "Reader" } } } };
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: [], fills: [] }, surfaces: { slots: [contract], fills: [candidate as never], transforms: [], rules: [], materializations: [] } };
  const empty: CompositeLibraryData = { source: { id: "reader-consumer", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-26", values: { fills: [] }, components: { fills: [], files: [] } };
  const library = applyCompositeLibraryChange(catalog, empty, { baseHash: compositeLibraryHash(empty), changes: [{ portion: "surfaces", change: { op: "adopt", slot, source: "foundry" } }] }, options);
  const hash = surfacePackageDescriptorHash(candidate.frames!.reader!);
  catalog.surfaces!.packageHistory = { [hash]: [{ document: structuredClone(candidate), contract: structuredClone(contract) }] };
  candidate.frames!.reader!.slots = { main: "content" };
  const apply = (changes: CompositeChangeSet["changes"] = [{ portion: "surfaces", change: { op: "refresh", slot, source: "foundry" } }], baseHash = compositeLibraryHash(library)) => applyCompositeLibraryChange(catalog, library, { baseHash, changes }, options);
  return { catalog, candidate, library, apply };
}
const pointer = (library: CompositeLibraryData) => surfaceEntryOf(library.surfaces!.fills[0]!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };

describe("guarded held surface refresh", () => {
  it("re-resolves a stale held frame, preserves originals and records an ordered descriptor history", () => {
    const f = fixture(), before = structuredClone(f.library), from = pointer(f.library).origin.descriptorHash;
    expect(resolveComposite({ catalog: f.catalog, library: f.library, ...options }).surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", actualHash: from }));
    const next = f.apply(), to = surfacePackageDescriptorHash(f.candidate.frames!.reader!);
    expect(pointer(next).origin).toMatchObject({ source: "foundry", descriptorHash: to, history: [{ from, to }] });
    expect(pointer(next)).toMatchObject({ slots: { main: "content" } });
    expect(f.library).toEqual(before);
    expect(resolveComposite({ catalog: f.catalog, library: next, ...options }).surfaces!.check.ok).toBe(true);
    const again = applyCompositeLibraryChange(f.catalog, next, { baseHash: compositeLibraryHash(next), changes: [{ portion: "surfaces", change: { op: "refresh", slot, source: "foundry" } }] }, options);
    expect(compositeLibraryHash(again)).toBe(compositeLibraryHash(next));
    f.catalog.surfaces!.packageHistory = { ...f.catalog.surfaces!.packageHistory, [to]: [{ document: structuredClone(f.candidate), contract: structuredClone(f.catalog.surfaces!.slots[0]!) }] };
    f.candidate.frames!.reader!.slots = { main: "body" };
    const last = applyCompositeLibraryChange(f.catalog, next, { baseHash: compositeLibraryHash(next), changes: [{ portion: "surfaces", change: { op: "refresh", slot, source: "foundry" } }] }, options);
    expect(pointer(last).origin.history).toEqual([{ from, to }, { from: to, to: pointer(last).origin.descriptorHash }]);
    expect(surfaceEntryOf(resolveSurfacePackageDescriptor(f.catalog, slot, pointer(f.library).origin).document)).toEqual(f.catalog.surfaces!.packageHistory![from]![0]!.document.frames!.reader);
    expect(resolveSurfacePackageDescriptor(f.catalog, slot, pointer(next).origin).document.frames!.reader!.slots).toEqual({ main: "content" });
  });
  it.each(["adopt", "remove"] as const)("allows %s on a registered stale target", op => {
    const f = fixture(), before = structuredClone(f.library);
    const next = f.apply([{ portion: "surfaces", change: op === "adopt" ? { op, slot, source: "foundry" } : { op, slot } }]);
    expect(next.surfaces!.fills).toHaveLength(op === "remove" ? 0 : 1);
    expect(f.library).toEqual(before);
  });
  it.each(["adopt", "remove"] as const)("refuses %s of an authentic package target with foreign consumer metadata", op => {
    for (const change of [
      { id: "foreign/frames.reader" }, { source: "foreign" }, { sourceAddress: "fills/foreign.json" },
      { author: "foundry" }, { trust: "foundry" }, { status: "stable" }, { conforms: ["foreign"] },
      { evidence: [{ clause: "foreign", path: "foreign" }] }, { originKinds: ["authored"] },
    ]) {
      const f = fixture();
      Object.assign(f.library.surfaces!.fills[0]!.$extensions["com.clossys.fill"], change);
      const before = structuredClone(f.library);
      expect(() => f.apply([{ portion: "surfaces", change: op === "adopt" ? { op, slot, source: "foundry" } : { op, slot } }])).toThrow(/S1 consumer metadata differs/);
      expect(f.library).toEqual(before);
    }
  });
  it("refuses removing an authentic source target with foreign consumer metadata", () => {
    const { input } = adoptedSurface();
    input.library.surfaces!.fills[0]!.$extensions["com.clossys.fill"].id = "foreign/sections.synthetic";
    const before = structuredClone(input.library);
    expect(() => applyCompositeLibraryChange(input.catalog, input.library, { baseHash: compositeLibraryHash(input.library), changes: [{ portion: "surfaces", change: { op: "remove", slot: "sections.synthetic" } }] }, { surfaceOptions: input.surfaceOptions })).toThrow(/S1 consumer metadata differs/);
    expect(input.library).toEqual(before);
  });
  it.each(["missing", "ambiguous", "foreign", "fill", "package", "implementation", "descriptor", "consumer", "history", "source", "unknown", "cas"])("refuses %s without mutation", failure => {
    const f = fixture();
    if (failure === "missing") f.catalog.surfaces!.fills = [];
    if (failure === "ambiguous") f.catalog.surfaces!.fills = [f.candidate as never, f.candidate as never];
    if (failure === "foreign") f.candidate.$extensions["com.clossys.fill"].trust = "unpinned";
    if (failure === "fill") f.candidate.$extensions["com.clossys.fill"].id = "foreign/frames.reader";
    if (failure === "package") { f.candidate.$extensions["com.clossys.fill"].pin!.package = "@example/foreign-kit"; f.candidate.frames!.reader!.impl.module = "@example/foreign-kit/frames"; }
    if (failure === "implementation") { f.candidate.$extensions["com.clossys.fill"].pin!.export = "./frames#Foreign"; f.candidate.frames!.reader!.impl.export = "Foreign"; }
    const held = f.library.surfaces!.fills[0]! as unknown as SurfacePackageDocument;
    if (failure === "descriptor") held.frames!.reader!.slots = { main: "forged" };
    if (failure === "consumer") held.$extensions["com.clossys.fill"].source = "foreign";
    if (failure === "history") held.frames!.reader!.origin!.history = [{ from: "sha256:" + "a".repeat(64), to: "sha256:" + "b".repeat(64) }];
    const before = structuredClone(f.library);
    expect(() => failure === "source" || failure === "unknown" ? f.apply([{ portion: "surfaces", change: { op: "refresh", slot: failure === "unknown" ? "frames.unknown" : slot, source: failure === "source" ? "foreign" : "foundry" } }]) : f.apply(undefined, failure === "cas" ? "sha256:" + "0".repeat(64) : undefined)).toThrow();
    expect(f.library).toEqual(before);
  });
  it("retains a second registered stale hold and refuses a foreign hold without partial results", () => {
    const f = fixture();
    const other = structuredClone(f.candidate);
    other.$extensions["com.clossys.fill"].slot = "frames.other"; other.$extensions["com.clossys.fill"].id = "foundry/frames.other";
    other.frames = { other: { ...other.frames!.reader!, slot: "frames.other" } };
    f.catalog.surfaces!.slots = [...f.catalog.surfaces!.slots, { ...f.catalog.surfaces!.slots[0]!, id: "frames.other" }];
    f.catalog.surfaces!.fills = [...f.catalog.surfaces!.fills, other as never];
    // Stage a valid second held pointer while the first is current, then make both stale.
    const current = f.apply();
    const both = applyCompositeLibraryChange(f.catalog, current, { baseHash: compositeLibraryHash(current), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "frames.other", source: "foundry" } }] }, options);
    const oldFirst = surfacePackageDescriptorHash(f.candidate.frames!.reader!), oldOther = surfacePackageDescriptorHash(other.frames!.other!);
    f.catalog.surfaces!.packageHistory = { ...f.catalog.surfaces!.packageHistory, [oldFirst]: [{ document: structuredClone(f.candidate), contract: structuredClone(f.catalog.surfaces!.slots[0]!) }], [oldOther]: [{ document: structuredClone(other), contract: structuredClone(f.catalog.surfaces!.slots[1]!) }] };
    f.candidate.frames!.reader!.slots = { main: "newContent" }; other.frames!.other!.slots = { main: "newContent" };
    const refreshed = applyCompositeLibraryChange(f.catalog, both, { baseHash: compositeLibraryHash(both), changes: [{ portion: "surfaces", change: { op: "refresh", slot, source: "foundry" } }] }, options);
    expect(refreshed.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.other")).toEqual(both.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.other"));
    other.$extensions["com.clossys.fill"].id = "foreign/frames.other";
    const before = structuredClone(both);
    expect(() => applyCompositeLibraryChange(f.catalog, both, { baseHash: compositeLibraryHash(both), changes: [{ portion: "surfaces", change: { op: "refresh", slot, source: "foundry" } }, { portion: "surfaces", change: { op: "remove", slot: "frames.other" } }] }, options)).toThrow(/upstream candidate identity/);
    expect(both).toEqual(before);
  });
});
