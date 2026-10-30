import { describe, expect, it } from "vitest";
import { checkDefaultCandidates, type DefaultCandidatesInput } from "./default-candidates-gate.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";

const head = "a".repeat(40);
function fixture(): DefaultCandidatesInput {
  const token = { id: "tokens.spacing", layer: "tokens", contract: { kind: "token", tier: "scale", $type: "dimension", members: { mode: "closed", names: ["4"] }, modes: ["light"] }, requires: [], status: "draft" };
  const component = { id: "components.button", layer: "components", contract: { kind: "component", root: "presentational", members: { mode: "closed", names: ["default"] }, props: [], allowedReads: { tokens: ["tokens.spacing"], assets: [] } }, requires: [], status: "draft" };
  const fill = (source: string) => ({ $extensions: { "com.clossys.fill": { id: `${source}/tokens.spacing`, slot: token.id, source, mode: "implementation", conforms: [], evidence: [], license: "MIT", status: "draft", author: "third-party", trust: "pinned-upstream", builtOn: [], sourceAddress: "fixture", relation: "same-contract" } }, tokens: { spacing: { "4": { $type: "dimension", $value: { value: 1, unit: "rem" } } } } });
  const descriptor = { slot: component.id, source: "foundry", root: "presentational", members: ["default"], props: [], propMap: { default: "./components#Button.default" }, reads: { tokens: ["tokens.spacing.4"], assets: [], components: [] }, composes: [], impl: { kind: "package", module: "@clossys/designer/components", export: "Button" }, license: "MIT", pin: { package: "@clossys/designer", version: "0.12.0", export: "./components#Button" }, deps: [] };
  const catalog = { values: { slots: [token], fills: [fill("shadcn@aria"), fill("foundry")], sources: [], standards: [], placements: [], retired: [] }, components: { slots: [component], fills: [{ $extensions: { "com.clossys.fill": { id: "foundry/components.button", slot: component.id, source: "foundry", mode: "implementation" } }, components: { button: descriptor } }], rules: [] }, surfaces: { slots: [], fills: [], rules: [], transforms: [], materializations: [] } } as unknown as CompositeCatalogData;
  return { catalog, buildCatalog: { slots: [token, component] } as DefaultCandidatesInput["buildCatalog"], defaultSources: { "tokens.spacing": "shadcn@aria", "components.button": "foundry" }, sourceHead: head, sourceHash: () => undefined };
}
function mutableDescriptor(input: DefaultCandidatesInput) {
  return Object.values(input.catalog.components.fills[0]!.components)[0]!;
}

describe("default candidates gate", () => {
  it("measures actual registered descriptor reads and accepts the explicit default source", () => {
    const result = checkDefaultCandidates(fixture());
    expect(result.exitCode).toBe(0);
    expect(result.report.counts).toMatchObject({ registeredSurfaces: 1, checkedSlots: 1, checkedReads: 1 });
    expect(result.report.checkedReads[0]).toMatchObject({ surface: "components.button", read: "tokens.spacing.4", slot: "tokens.spacing", source: "shadcn@aria" });
  });
  it("fails a single removed default while a different-source candidate remains; restoration passes", () => {
    const input = fixture(), original = input.catalog.values.fills;
    input.catalog.values.fills = original.filter(doc => doc.$extensions["com.clossys.fill"].source !== "shadcn@aria");
    const result = checkDefaultCandidates(input);
    expect(input.catalog.values.fills).toHaveLength(1);
    expect(result.exitCode).toBe(1);
    expect(result.report.missing).toEqual([{ slot: "tokens.spacing", source: "shadcn@aria", surfaces: ["components.button"], reads: ["tokens.spacing.4"], reasons: ["no implementation candidate in the default source"] }]);
    input.catalog.values.fills = original;
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
  });
  it("discovers a new registered surface's missing read without a surface allowlist", () => {
    const input = fixture();
    const added = structuredClone(input.catalog.components.slots[0]!);
    added.id = "components.new-surface";
    const doc = structuredClone(input.catalog.components.fills[0]!);
    doc.$extensions["com.clossys.fill"].id = "foundry/components.new-surface";
    doc.$extensions["com.clossys.fill"].slot = added.id;
    const entry = Object.values(doc.components)[0]!;
    entry.slot = added.id;
    const extra = structuredClone(input.buildCatalog.slots[0]!); extra.id = "tokens.new-spacing";
    entry.reads.tokens = ["tokens.new-spacing.4"];
    doc.components = { "new-surface": entry };
    input.catalog.components.slots = [...input.catalog.components.slots, added];
    input.catalog.components.fills = [...input.catalog.components.fills, doc];
    input.buildCatalog.slots = [...input.buildCatalog.slots, added, extra];
    input.catalog.values.slots = [...input.catalog.values.slots, extra as typeof input.catalog.values.slots[number]];
    input.defaultSources = { ...input.defaultSources, [extra.id]: "shadcn@aria" };
    const result = checkDefaultCandidates(input);
    expect(result.exitCode).toBe(1);
    expect(result.report.missing[0]).toMatchObject({ slot: extra.id, surfaces: [added.id] });
  });
  it.each(["tokens.unknown", "tokens.spacing.nonexistent", "tokens.spacing.4."])("rejects unknown or malformed read %s", read => {
    const input = fixture(); mutableDescriptor(input).reads.tokens = [read];
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
  });
  it("rejects absent source policy instead of choosing another source", () => {
    const input = fixture(); input.defaultSources = {};
    expect(checkDefaultCandidates(input)).toMatchObject({ exitCode: 2, report: { invalid: ["MISSING_POLICY tokens.spacing: default source definition is missing"] } });
  });
  it("rejects missing read evidence and empty inventories", () => {
    const input = fixture(); delete (mutableDescriptor(input) as { reads?: unknown }).reads;
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
    const empty = fixture(); empty.catalog.components.fills = [];
    expect(checkDefaultCandidates(empty).exitCode).toBe(2);
  });
  it("does not count blocked or empty executable candidates", () => {
    const input = fixture();
    mutableDescriptor(input).reads.components = ["components.button"];
    mutableDescriptor(input).blockers = [{ code: "K4", message: "blocked" }];
    expect(checkDefaultCandidates(input)).toMatchObject({ exitCode: 1, report: { missing: [expect.objectContaining({ slot: "components.button" })] } });
    mutableDescriptor(input).blockers = [];
    mutableDescriptor(input).members = [];
    expect(checkDefaultCandidates(input).exitCode).toBe(1);
  });
  it("accepts an executable component with no member axes when its native contract requires none", () => {
    const input = fixture(), entry = mutableDescriptor(input);
    entry.reads.components = ["components.button"];
    entry.members = [];
    entry.propMap = {};
    input.catalog.components.slots[0]!.contract.members = { mode: "closed", names: [] };
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
    input.catalog.components.slots[0]!.contract.members = { mode: "closed", names: ["default"] };
    expect(checkDefaultCandidates(input).exitCode).toBe(1);
  });
  it("requires current source bytes for attached lower-bound evidence", () => {
    const input = fixture(), entry = mutableDescriptor(input) as unknown as Record<string, unknown>;
    entry.consumption = { scanStatus: "lower-bound", sourceFiles: [{ path: "src/button.tsx", sha256: "b".repeat(64) }], scannedReads: { tokens: ["tokens.spacing"], assets: [], components: [] }, scannedComposes: [] };
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
    input.sourceHash = () => "b".repeat(64);
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
    input.sourceHash = () => "c".repeat(64);
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
  });
  it("does not turn permitted contract reads into observed surface reads", () => {
    const input = fixture();
    input.catalog.components.slots[0]!.contract.allowedReads.tokens = ["tokens.unread"];
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
  });
  it("rejects a lost registered surface descriptor unless native coverage explicitly declares it unavailable", () => {
    const input = fixture(), added = structuredClone(input.catalog.components.slots[0]!);
    added.id = "components.unimplemented";
    input.buildCatalog.slots = [...input.buildCatalog.slots, added];
    input.catalog.components.slots = [...input.catalog.components.slots, added];
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
    input.surfaceCoverage = [{ slot: added.id, status: "unavailable" }];
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
    input.surfaceCoverage = [{ slot: added.id, status: "candidate" }];
    expect(checkDefaultCandidates(input).exitCode).toBe(2);
  });
  it("rejects a value whose native type differs from the registered token contract", () => {
    const input = fixture(), fill = input.catalog.values.fills[0]!;
    const group = fill.tokens!.spacing as unknown as Record<string, { $type: string; $value: unknown }>;
    group["4"] = { $type: "color", $value: "#ffffff" };
    expect(checkDefaultCandidates(input).exitCode).toBe(1);
  });
  it("uses the native adoption/check path for full slot coverage, beyond the observed member", () => {
    const input = fixture();
    const slot = input.catalog.values.slots[0]!;
    if (slot.contract.members.mode === "closed") slot.contract.members.names = ["4", "8"];
    const result = checkDefaultCandidates(input);
    expect(result.exitCode).toBe(1);
    expect(result.report.missing[0]!.reasons).toContain("required native member is absent: tokens.spacing.8");
    expect(result.report.missing[0]!.reasons.some(reason => reason.startsWith("C4:"))).toBe(true);
  });
  it("accepts selectable derived value candidates under the native adoption semantics", () => {
    const input = fixture();
    input.catalog.values.fills[0]!.$extensions["com.clossys.fill"].mode = "derived";
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
  });
  it("does not count a reference candidate as a default implementation", () => {
    const input = fixture();
    input.catalog.values.fills[0]!.$extensions["com.clossys.fill"].mode = "reference";
    expect(checkDefaultCandidates(input).exitCode).toBe(1);
  });
  it("mutation proof: removing semantic content from its default source fails and restoration passes", () => {
    const input = fixture(), button = mutableDescriptor(input);
    const contract = structuredClone(input.catalog.components.slots[0]!); contract.id = "components.semantic-content";
    const semantic = structuredClone(button); semantic.slot = contract.id; semantic.reads = { tokens: [], assets: [], components: [] };
    semantic.impl = { kind: "package", module: "@clossys/designer/components", export: "SemanticContent" };
    semantic.pin = { package: "@clossys/designer", version: "0.12.0", export: "./components#SemanticContent" };
    const doc = (source: string) => ({ $extensions: { "com.clossys.fill": { ...input.catalog.components.fills[0]!.$extensions["com.clossys.fill"], id: `${source}/${contract.id}`, slot: contract.id, source } }, components: { "semantic-content": { ...semantic, source } } });
    input.buildCatalog.slots = [...input.buildCatalog.slots, contract];
    input.catalog.components.slots = [...input.catalog.components.slots, contract];
    input.catalog.components.fills = [...input.catalog.components.fills, doc("foundry"), doc("alternate")];
    button.reads.components = [contract.id];
    input.defaultSources = { ...input.defaultSources, [contract.id]: "foundry" };
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
    const original = input.catalog.components.fills;
    input.catalog.components.fills = original.filter(candidate => candidate.$extensions["com.clossys.fill"].id !== `foundry/${contract.id}`);
    expect(checkDefaultCandidates(input)).toMatchObject({ exitCode: 1, report: { missing: [expect.objectContaining({ slot: contract.id, source: "foundry", surfaces: ["components.button"] })] } });
    expect(input.catalog.components.fills.some(candidate => candidate.$extensions["com.clossys.fill"].id === `alternate/${contract.id}`)).toBe(true);
    input.catalog.components.fills = original;
    expect(checkDefaultCandidates(input).exitCode).toBe(0);
  });
  it("includes native section/frame compositions and asset reads across every layer", () => {
    const input = fixture();
    const contract = (id: string, layer: string) => ({ id, layer, contract: { kind: layer === "sections" ? "section" : "frame", members: { mode: "closed", names: [] } }, status: "draft", requires: [] });
    const section = contract("sections.example", "sections"), frame = contract("frames.example", "frames");
    const asset = { id: "assets.example", layer: "assets", contract: { kind: "asset", valueKind: "svg", members: { mode: "closed", names: ["default"] }, modes: ["light"] }, status: "draft", requires: [] };
    input.buildCatalog.slots = [...input.buildCatalog.slots, section, frame, asset] as DefaultCandidatesInput["buildCatalog"]["slots"];
    input.catalog.values.slots = [...input.catalog.values.slots, asset] as DefaultCandidatesInput["catalog"]["values"]["slots"];
    input.defaultSources = { ...input.defaultSources, [section.id]: "foundry", [frame.id]: "foundry", [asset.id]: "foundry" };
    const metadata = (id: string, exported: string) => ({ ...input.catalog.values.fills[1]!.$extensions["com.clossys.fill"], id: `foundry/${id}`, slot: id, pin: { package: "@clossys/designer", version: "0.12.0", export: `./blocks#${exported}` } });
    input.catalog.surfaces!.slots = [section, frame] as unknown as NonNullable<typeof input.catalog.surfaces>["slots"];
    input.catalog.surfaces!.fills = [
      { $extensions: { "com.clossys.fill": metadata(section.id, "ExampleSection") }, sections: { example: { slot: section.id, source: "foundry", slotMap: {}, propMap: {}, configs: {}, parts: [], impl: { kind: "package", module: "@clossys/designer/blocks", export: "ExampleSection" }, license: "MIT", pin: metadata(section.id, "ExampleSection").pin, notes: [], reads: { tokens: [], assets: [] }, composes: ["components.button"] } } },
      { $extensions: { "com.clossys.fill": metadata(frame.id, "ExampleFrame") }, frames: { example: { slot: frame.id, members: [], propMap: {}, slots: {}, statePorts: {}, impl: { kind: "package", module: "@clossys/designer/blocks", export: "ExampleFrame" }, reads: { tokens: ["tokens.spacing.4"], assets: [] }, composes: [section.id] } } },
    ] as unknown as NonNullable<typeof input.catalog.surfaces>["fills"];
    mutableDescriptor(input).reads.assets = [asset.id];
    const result = checkDefaultCandidates(input);
    expect(result.report.invalid).toEqual([]);
    expect(result.exitCode).toBe(1);
    expect(result.report.missing[0]).toMatchObject({ slot: asset.id, surfaces: ["components.button"] });
    expect(new Set(result.report.checkedReads.map(row => row.slot))).toEqual(new Set(["tokens.spacing", "assets.example", "components.button", "sections.example"]));
    expect(result.report.counts.registeredSurfaces).toBe(3);
  });
});
