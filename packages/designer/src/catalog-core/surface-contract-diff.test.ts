// @vitest-environment node
import { describe, expect, it } from "vitest";
import { surfaceContractDiff, surfaceEntryOf, surfacePackageDescriptorHash, resolveSurfacePackageDescriptor } from "./surface-library.js";
import { foundrySurfaceCatalog } from "../library-cli/surface-catalog.js";
import { loadFoundrySurfaceHistory } from "./index.js";
import type { SurfacePackageEntry, SurfacePackageFrameEntry, SurfacePackageOrigin, SurfacePackageSectionEntry } from "./surface-types.js";
import type { CompositeCatalogData } from "./types.js";
import type { FrameSlot } from "./types.js";

const frame: SurfacePackageFrameEntry = { slot: "frames.reader", members: ["mode.old", "mode.keep"], propMap: { "mode.old": "old", "mode.keep": "keep" }, slots: { main: "children", old: "old" }, statePorts: { old: "old", keep: "keep" }, impl: { kind: "package", module: "@example/kit/frames", export: "Reader" } };
describe("surface refresh contract diff and descriptor retention", () => {
  it("flags removal of declared but unmapped contract members and slots", () => {
    const before: FrameSlot = { id: frame.slot, layer: "frames", status: "draft", requires: [], contract: { kind: "frame", root: "div", landmarks: [], slots: [{ id: "main", required: true, accepts: "host-node" }, { id: "unmapped", required: false, accepts: "host-node" }], members: { mode: "closed", names: ["declared-only"] }, statePorts: [{ id: "declared-state", type: "boolean" }], rendering: "server", breakpoints: [], layers: [], allowedReads: { tokens: [], assets: [] } } };
    const after = structuredClone(before);
    after.contract.members.names = [];
    after.contract.slots = after.contract.slots.filter(slot => slot.id !== "unmapped");
    after.contract.statePorts = [];
    const diff = surfaceContractDiff(frame, frame, { before, after });
    expect(diff).toMatchObject({ fromHash: surfacePackageDescriptorHash(frame), toHash: surfacePackageDescriptorHash(frame), removed: { members: ["declared-only"], slots: ["unmapped"], statePorts: ["declared-state"] }, breaking: true });
    const mapped = { ...frame, slots: { ...frame.slots, unmapped: "extra" } };
    // Either a declared removal or an implemented removal must remain visible.
    expect(surfaceContractDiff(mapped, mapped, { before, after }).removed.slots).toEqual(["unmapped"]);
    expect(surfaceContractDiff(mapped, frame, { before, after: before }).removed.slots).toEqual(["unmapped"]);
  });
  it("flags any frame member, slot or state port removal as breaking and orders additions", () => {
    const next: SurfacePackageFrameEntry = { ...frame, members: ["mode.z", "mode.keep", "mode.a"], propMap: { "mode.keep": "keep" }, slots: { main: "content", extra: "extra" }, statePorts: { keep: "keep", extra: "extra" } };
    expect(surfaceContractDiff(frame, next)).toEqual({ fromHash: surfacePackageDescriptorHash(frame), toHash: surfacePackageDescriptorHash(next), added: { members: ["mode.a", "mode.z"], slots: ["extra"], statePorts: ["extra"] }, removed: { members: ["mode.old"], slots: ["old"], statePorts: ["old"] }, breaking: true });
    for (const field of ["members", "slots", "statePorts"] as const) {
      const one = structuredClone(frame);
      if (field === "members") { one.members = ["mode.keep"]; one.propMap = { "mode.keep": "keep" }; }
      else delete (one[field] as Record<string, string>).old;
      expect(surfaceContractDiff(frame, one).breaking, field).toBe(true);
    }
  });
  it("uses section propMap and slotMap keys and does not invent frame state ports", () => {
    const section: SurfacePackageSectionEntry = { slot: "sections.reader", source: "foundry", slotMap: { title: "title" }, propMap: { "mode.old": "old" }, configs: {}, parts: [], impl: { kind: "package", module: "@example/kit/blocks", export: "Reader" }, license: "MIT", pin: { package: "@example/kit", version: "1.0.0", export: "./blocks#Reader" }, notes: [] };
    expect(surfaceContractDiff(section, { ...section, propMap: { "mode.new": "new" }, slotMap: { body: "body" } })).toMatchObject({ added: { members: ["mode.new"], slots: ["body"], statePorts: [] }, removed: { members: ["mode.old"], slots: ["title"], statePorts: [] }, breaking: true });
  });
  it("reports mapping-only hash transitions and empty no-op diffs without false removals", () => {
    const changed = surfaceContractDiff(frame, { ...frame, slots: { ...frame.slots, main: "content" } });
    expect(changed.fromHash).not.toBe(changed.toHash);
    expect(changed.breaking).toBe(false);
    expect(surfaceContractDiff(frame, frame)).toEqual({ fromHash: surfacePackageDescriptorHash(frame), toHash: surfacePackageDescriptorHash(frame), added: { members: [], slots: [], statePorts: [] }, removed: { members: [], slots: [], statePorts: [] }, breaking: false });
  });
  it("retains all 62 current upstream descriptors and the exact original app-shell after candidates advance", () => {
    const surfaces = structuredClone(foundrySurfaceCatalog());
    const current = [...surfaces.fills];
    surfaces.fills = [];
    const catalog = { surfaces } as CompositeCatalogData;
    expect(current).toHaveLength(62);
    for (const doc of current) {
      const entry = surfaceEntryOf(doc) as SurfacePackageEntry, meta = doc.$extensions["com.clossys.fill"];
      const identity = { source: meta.source, fill: meta.id, pin: meta.pin!, license: meta.license, descriptorHash: surfacePackageDescriptorHash(entry) };
      const archived = resolveSurfacePackageDescriptor(catalog, entry.slot, identity);
      expect(archived.document).toEqual(doc);
      expect(archived.contract.id).toBe(entry.slot);
    }
    const identity: Pick<SurfacePackageOrigin, "source" | "fill" | "pin" | "license" | "descriptorHash"> = { source: "foundry", fill: "foundry/frames.app-shell", pin: { package: "@clossys/designer", version: "0.12.0", export: "./frames#AppFrame" }, license: "MIT", descriptorHash: "sha256:b740aea8605c3bbbdb3f1c817031a0693965920b2efae0573c312f8c1043a4ed" };
    const legacy = resolveSurfacePackageDescriptor(catalog, "frames.app-shell", identity);
    expect(legacy.document.frames!["app-shell"]!.statePorts).not.toHaveProperty("main-state");
    expect(legacy.contract.contract.kind).toBe("frame");
    expect(surfacePackageDescriptorHash(surfaceEntryOf(legacy.document) as SurfacePackageEntry)).toBe(identity.descriptorHash);
  });
  it("returns independent deeply frozen public history and current/historical descriptor snapshots", () => {
    const history = loadFoundrySurfaceHistory(), again = loadFoundrySurfaceHistory();
    const digest = "sha256:b740aea8605c3bbbdb3f1c817031a0693965920b2efae0573c312f8c1043a4ed";
    expect(history).toEqual(again); expect(history).not.toBe(again);
    expect(() => { history[digest]![0]!.contract.contract.members.names = ["poison"]; }).toThrow(TypeError);
    const surfaces = structuredClone(foundrySurfaceCatalog()), catalog = { surfaces } as CompositeCatalogData;
    const current = surfaces.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!;
    const old = history[digest]![0]!.document;
    for (const document of [current, old]) {
      const entry = surfaceEntryOf(document) as SurfacePackageEntry, meta = document.$extensions["com.clossys.fill"];
      const identity = { source: meta.source, fill: meta.id, pin: meta.pin!, license: meta.license, descriptorHash: surfacePackageDescriptorHash(entry) };
      const snapshot = resolveSurfacePackageDescriptor(catalog, entry.slot, identity);
      expect(snapshot.document).not.toBe(document);
      expect(() => { snapshot.contract.contract.members.names = ["poison"]; }).toThrow(TypeError);
      expect(() => { snapshot.document.frames!["app-shell"]!.propMap = { poison: "poison" }; }).toThrow(TypeError);
      expect(resolveSurfacePackageDescriptor(catalog, entry.slot, identity)).toEqual(snapshot);
    }
    expect(loadFoundrySurfaceHistory()).toEqual(again);
  });
});
