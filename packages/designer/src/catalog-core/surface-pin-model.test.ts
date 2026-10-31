// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyCompositeLibraryChange, compositeLibraryHash, resolveComposite } from "./library-components.js";
import { loadCatalog } from "./index.js";
import { surfaceEntryOf, surfacePackageDescriptorHash } from "./surface-library.js";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "./types.js";
import type { SurfaceCatalog, SurfacePackageDocument, SurfacePackageEntry, SurfacePackageOrigin } from "./surface-types.js";

const options = { surfaceOptions: { packages: [{ module: "@example/surface-kit/frames", version: "1.0.0", artifactSha256: "a".repeat(64), values: ["Reader"], types: [] }], measurements: [] } };
const pointer = (library: CompositeLibraryData, slot = "frames.reader") => surfaceEntryOf(library.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };
function fixture() {
  const contract: FrameSlot = { id: "frames.reader", layer: "frames", status: "draft", requires: [], contract: { kind: "frame", root: "div", landmarks: [], slots: [{ id: "main", required: true, accepts: "host-node" }], members: { mode: "closed", names: [] }, statePorts: [], rendering: "server", breakpoints: [], allowedReads: { themes: [], assets: [] } } };
  const candidate: SurfacePackageDocument = { $extensions: { "com.clossys.fill": { id: "foundry/frames.reader", slot: "frames.reader", source: "foundry", mode: "implementation", sourceAddress: "./frames#Reader", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", status: "draft", pin: { package: "@example/surface-kit", version: "1.0.0", export: "./frames#Reader" } } }, frames: { reader: { slot: "frames.reader", members: [], propMap: {}, slots: { main: "children" }, statePorts: {}, impl: { kind: "package", module: "@example/surface-kit/frames", export: "Reader" } } } };
  const oldHash = surfacePackageDescriptorHash(candidate.frames!.reader!);
  const registration = { document: structuredClone(candidate), contract: structuredClone(contract) };
  const surfaces: SurfaceCatalog & { packageHistory: Record<string, typeof registration[]> } = { slots: [contract], fills: [candidate as never], transforms: [], rules: [], materializations: [], packageHistory: { [oldHash]: [registration] } };
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: [], fills: [] }, surfaces };
  const empty: CompositeLibraryData = { source: { id: "reader-consumer", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-26", values: { fills: [] }, components: { fills: [], files: [] } };
  const apply = (library: CompositeLibraryData, change: Parameters<typeof applyCompositeLibraryChange>[2]["changes"][number]) => applyCompositeLibraryChange(catalog, library, { baseHash: compositeLibraryHash(library), changes: [change] }, options);
  const library = apply(empty, { portion: "surfaces", change: { op: "adopt", slot: "frames.reader", source: "foundry" } });
  candidate.frames!.reader!.slots = { main: "content", progress: "progress" };
  candidate.frames!.reader!.statePorts = { loading: "loading" };
  contract.contract.slots = [...contract.contract.slots, { id: "progress", required: false, accepts: "host-node" }];
  contract.contract.statePorts = [{ id: "loading", type: "boolean" }];
  return { catalog, surfaces, contract, candidate, library, oldHash, registration, apply };
}

describe("authenticated historical package surface pins", () => {
  it("resolves the exact old contract and reports actionable drift instead of throwing", () => {
    const f = fixture();
    const result = resolveComposite({ catalog: f.catalog, library: f.library, ...options });
    expect(result.surfaces!.check.ok).toBe(true);
    expect(result.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", subject: "frames.reader", expectedHash: surfacePackageDescriptorHash(f.candidate.frames!.reader!), actualHash: f.oldHash, nextOperation: { op: "refresh", slot: "frames.reader", source: "foundry" } }));
    expect(pointer(f.library).origin.descriptorHash).toBe(f.oldHash);
  });
  it("lets a different surface be adopted while preserving a legitimate stale hold", () => {
    const f = fixture(), other = structuredClone(f.registration.document);
    other.$extensions["com.clossys.fill"].id = "foundry/frames.other"; other.$extensions["com.clossys.fill"].slot = "frames.other";
    other.frames = { other: { ...other.frames!.reader!, slot: "frames.other" } };
    f.surfaces.fills = [...f.surfaces.fills, other as never];
    f.surfaces.slots = [...f.surfaces.slots, { ...f.registration.contract, id: "frames.other" }];
    const before = structuredClone(pointer(f.library));
    const next = f.apply(f.library, { portion: "surfaces", change: { op: "adopt", slot: "frames.other", source: "foundry" } });
    expect(pointer(next)).toEqual(before);
    expect(pointer(next, "frames.other").origin.fill).toBe("foundry/frames.other");
  });
  it("refuses an unregistered historical body even when its held self-hash matches", () => {
    const f = fixture(); delete f.surfaces.packageHistory[f.oldHash];
    const before = structuredClone(f.library);
    expect(() => f.apply(f.library, { portion: "surfaces", change: { op: "refresh", slot: "frames.reader", source: "foundry" } })).toThrow(/registered|historical|upstream/);
    expect(f.library).toEqual(before);
  });
  it("requires full old pin context inside a same-hash history bucket", () => {
    const f = fixture();
    const anotherVersion = structuredClone(f.registration);
    anotherVersion.document.$extensions["com.clossys.fill"].pin!.version = "2.0.0";
    f.surfaces.packageHistory[f.oldHash]!.push(anotherVersion);
    expect(resolveComposite({ catalog: f.catalog, library: f.library, ...options }).surfaces!.check.ok).toBe(true);
    f.surfaces.packageHistory[f.oldHash] = [anotherVersion];
    expect(() => f.apply(f.library, { portion: "surfaces", change: { op: "refresh", slot: "frames.reader", source: "foundry" } })).toThrow(/registered|historical|upstream/);
  });
  it("refuses an ambiguous full identity, a malformed archive, and forged transition history", () => {
    for (const kind of ["ambiguous", "archive", "history"]) {
      const f = fixture();
      if (kind === "ambiguous") f.surfaces.packageHistory[f.oldHash]!.push(structuredClone(f.registration));
      if (kind === "archive") f.surfaces.packageHistory[f.oldHash]![0]!.document.frames!.reader!.slots = { main: "forged" };
      if (kind === "history") {
        const held = f.library.surfaces!.fills[0]! as unknown as SurfacePackageDocument;
        held.frames!.reader!.origin!.history = [{ from: "sha256:" + "f".repeat(64), to: f.oldHash }];
      }
      expect(() => f.apply(f.library, { portion: "surfaces", change: { op: "refresh", slot: "frames.reader", source: "foundry" } }), kind).toThrow();
    }
  });
  it("reports version-only drift even with equal body hashes and still requires installed package evidence", () => {
    const f = fixture();
    f.candidate.frames!.reader!.slots = { main: "children" }; f.candidate.frames!.reader!.statePorts = {};
    f.contract.contract = structuredClone(f.registration.contract.contract);
    f.candidate.$extensions["com.clossys.fill"].pin!.version = "2.0.0";
    const resolved = resolveComposite({ catalog: f.catalog, library: f.library, ...options });
    expect(resolved.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S2", actualHash: f.oldHash, expectedHash: f.oldHash, actualPin: expect.objectContaining({ version: "1.0.0" }), expectedPin: expect.objectContaining({ version: "2.0.0" }) }));
    const missingEvidence = resolveComposite({ catalog: f.catalog, library: f.library, surfaceOptions: { packages: [], measurements: [] } });
    expect(missingEvidence.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S4", severity: "error" }));
  });
  it("refuses malformed or foreign historical contracts with a catalog fault instead of a TypeError", () => {
    for (const change of [
      (row: Record<string, unknown>) => { row.contract = null; },
      (row: Record<string, unknown>) => { row.id = "frames.foreign"; },
      (row: Record<string, unknown>) => { row.layer = "sections"; },
      (row: Record<string, unknown>) => { (row.contract as Record<string, unknown>).kind = "section"; },
      (row: Record<string, unknown>) => { (row.contract as Record<string, unknown>).slots = null; },
      (row: Record<string, unknown>) => { (row.contract as Record<string, unknown>).members = {}; },
      (row: Record<string, unknown>) => { (row.contract as Record<string, unknown>).statePorts = [null]; },
    ]) {
      const f = fixture(); change(f.registration.contract as unknown as Record<string, unknown>);
      expect(() => resolveComposite({ catalog: f.catalog, library: f.library, ...options })).toThrow(/surfaces: S[12]/);
    }
  });

});
