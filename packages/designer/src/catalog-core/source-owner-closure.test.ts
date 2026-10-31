// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prepareSourceOwnerClosure, loadCatalogBundles } from "../catalog-bundles.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { synthetic, syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { componentDescriptorHash, componentOf } from "./resolve-components.js";
import { runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import { generateSelection } from "./library.js";
import { adoptedSurface, syntheticDerivation } from "./__fixtures__/surface-engine/synthetic.js";
import type { CompositeEngineInput, CompositeLibraryOperation, FillDoc, Slot } from "./types.js";

function fixture(): CompositeEngineInput {
  const s = synthetic(), source = { id: "example", kind: "consumer" as const, author: "consumer" as const, license: "MIT" };
  s.candidate.reads = { themes: [], assets: [], components: [] };
  const slots: Slot[] = ["spacing", "radius"].map(name => ({ id: `themes.${name}`, layer: "themes", status: "draft", requires: [], contract: { kind: "token", tier: "scale", $type: "dimension", modes: ["light"], members: { mode: "open", pattern: "^[a-z]+$" } } }));
  const doc: FillDoc = { $extensions: { "com.clossys.fill": { id: "test-kit/themes.spacing", slot: "themes.spacing", source: "test-kit", mode: "implementation", sourceAddress: "synthetic.json", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft" } }, themes: { spacing: { base: { $type: "dimension", $value: { value: 4, unit: "px" } } } } };
  const catalog = { values: { slots, fills: [doc], sources: [{ id: "test-kit", kind: "base" as const, author: "third-party" as const, license: "MIT" }], rules: [{ id: "synthetic:radius", slot: "themes.radius", inputs: ["themes.spacing.base"], values: { base: { $type: "dimension" as const, $value: "{themes.spacing.base}" } } }], placements: [], retired: [], standards: [] }, components: s.catalog };
  let input: CompositeEngineInput = { catalog, library: { source, adoptedAt: "2026-10-25", values: { fills: [] }, components: { fills: [], files: [] } } };
  const change = (operation: CompositeLibraryOperation) => { input = { ...input, library: applyLibraryChange(catalog, input.library, { baseHash: libraryHash(input.library), changes: [operation] }) }; };
  change({ portion: "values", change: { op: "adopt", slot: "themes.spacing", source: "test-kit" } });
  change({ portion: "values", change: { op: "author", slot: "themes.spacing", tokens: { extra: { $type: "dimension", $value: { value: 8, unit: "px" } } } } });
  change({ portion: "values", change: { op: "derive", slot: "themes.radius", rule: "synthetic:radius", inputs: ["themes.spacing.base"] } });
  change({ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } });
  return input;
}
function associated(input = fixture()) {
  const result = prepareSourceOwnerClosure(input);
  expect(result.status, result.status === "pending" ? JSON.stringify(result.needs) : "").toBe("associated");
  if (result.status !== "associated") throw new Error("SYNTHETIC association unavailable");
  return result;
}
function pending(input: CompositeEngineInput) {
  const result = prepareSourceOwnerClosure(input);
  expect(result.status).toBe("pending"); expect(result).not.toHaveProperty("sourceHashes");
  if (result.status !== "pending") throw new Error("Expected pending");
  expect(result.needs.length).toBeGreaterThan(0); return result;
}

describe("complete source-owner record association", () => {
  it("includes adopted, authored and derived actual members, detached originals and separate installed hash domains", () => {
    const input = fixture(), before = runtimeHash(input.library), result = associated(input);
    expect(result.records.filter(record => record.kind === "value-member")).toHaveLength(3);
    expect(result.records.filter(record => record.kind === "component")).toHaveLength(1);
    expect(new Set(result.records.filter(record => record.kind !== "offer").map(record => record.origin?.kind))).toEqual(new Set(["adopted", "authored", "derived"]));
    const own = result.records.find(record => record.kind === "component")!;
    expect(own.upstream).toEqual({ fill: "test-kit/components.button", slot: "components.button" });
    const installed = componentOf(input.library.components.fills[0]!);
    expect(installed.source).toBe("example");
    expect(own.origin).toMatchObject({ kind: "adopted", sha256: componentDescriptorHash(installed) });
    expect(componentDescriptorHash(installed)).not.toBe(componentDescriptorHash(componentOf(input.catalog.components.fills[0]!)));
    expect(result.libraryHash).toBe(libraryHash(input.library)); expect(result.selectionHash).toBe(resolve(input).selectionHash);
    expect(result.runtimeQualification).toBe("unavailable"); expect(runtimeHash(input.library)).toBe(before);
    expect(Object.isFrozen(own.document)).toBe(true); expect(own.document).not.toBe(input.library.components.fills[0]);
    for (const [source, records] of Object.entries(result.bySource)) expect(result.sourceHashes[source]).toBe(runtimeHash(records));
  });

  it("joins exact upstream fill and slot instead of rewritten consumer IDs, slots or labels [mutant: slot-only]", () => {
    const input = fixture(), other = structuredClone(input.catalog.components.fills[0]!);
    other.$extensions["com.clossys.fill"].id = "another/components.button"; other.$extensions["com.clossys.fill"].source = "another"; other.components.button!.source = "another";
    input.catalog.components.fills = [other, ...input.catalog.components.fills];
    expect(associated(input).records.find(record => record.kind === "component")!.candidate).toEqual(input.catalog.components.fills[1]);
    input.catalog.components.fills = [other]; pending(input);
    const duplicate = fixture(); duplicate.catalog.components.fills = [...duplicate.catalog.components.fills, duplicate.catalog.components.fills[0]!]; pending(duplicate);
    const wrong = fixture(); componentOf(wrong.catalog.components.fills[0]!).source = "foreign"; pending(wrong);
  });

  it("retains all four component origins with exact registered recursive inputs [mutant: missing-rule-input]", () => {
    const input = fixture(), template = componentOf(input.catalog.components.fills[0]!);
    const slot = input.catalog.components.slots[0]!;
    input.catalog.components.slots = [slot, ...["authored", "derived", "composed"].map(name => ({ ...slot, id: `components.${name}` }))];
    const derive = { ...structuredClone(template), slot: "components.derived", reads: { themes: [], assets: [], components: ["components.button"] }, composes: ["components.button"] };
    const compose = { ...structuredClone(derive), slot: "components.composed", reads: { themes: [], assets: [], components: ["components.derived"] }, composes: ["components.derived"] };
    input.catalog.components.rules = [{ id: "synthetic:derive", kind: "derive", slot: derive.slot, inputs: ["components.button"], template: derive, files: [] }, { id: "synthetic:compose", kind: "compose", slot: compose.slot, inputs: ["components.derived"], template: compose, files: [] }];
    for (const change of [{ op: "author" as const, slot: "components.authored", fill: { ...structuredClone(template), slot: "components.authored" }, files: [] }, { op: "derive" as const, slot: derive.slot, rule: "synthetic:derive", inputs: ["components.button"] }, { op: "compose" as const, slot: compose.slot, rule: "synthetic:compose" }]) input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change }] });
    const result = associated(input), records = result.records.filter(record => record.kind === "component");
    expect(new Set(records.map(record => record.origin!.kind))).toEqual(new Set(["adopted", "authored", "derived", "composed"]));
    const composed = records.find(record => record.slot === compose.slot)!;
    expect(composed.rule).toEqual(input.catalog.components.rules[1]);
    expect(composed.inputRecords[0]!.inputRecords[0]!.slot).toBe("components.button");
    const duplicate = { ...input, library: structuredClone(input.library) };
    const duplicateInput = structuredClone(duplicate.library.components.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "components.button")!);
    duplicateInput.$extensions["com.clossys.fill"].id = "example/components.duplicate-button";
    duplicate.library.components.fills = [...duplicate.library.components.fills, duplicateInput];
    expect(pending(duplicate).needs.some(need => need.message.includes("duplicate whole-leaf implementation"))).toBe(true);
    input.catalog.components.rules = []; pending(input);
  });

  it("revokes on stale upstream, installed content or partial membership without advertising partial hashes [mutant: stale/partial]", () => {
    for (const mutate of [
      (input: CompositeEngineInput) => { input.catalog.values.fills = []; },
      (input: CompositeEngineInput) => { input.catalog.values.fills[0]!.themes!.spacing = {}; },
      (input: CompositeEngineInput) => { componentOf(input.library.components.fills[0]!).props = []; },
      (input: CompositeEngineInput) => { input.library.values.fills[0]!.themes!.spacing = { base: { $type: "dimension", $value: { value: 99, unit: "px" } } }; },
      (input: CompositeEngineInput) => { input.catalog.values.rules = []; },
    ]) { const input = fixture(); mutate(input); pending(input); }
  });

  it("binds consumer-owned edits, authored members, catalog membership and current selection [mutant: dropped-authored]", () => {
    const input = fixture(), first = associated(input);
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "themes.spacing", tokens: { extra: { $type: "dimension", $value: { value: 12, unit: "px" } } } } }] });
    const changed = associated(input); expect(changed.sourceHashes.example).not.toBe(first.sourceHashes.example); expect(changed.selectionHash).not.toBe(first.selectionHash);
    input.library.values.rationale = { "themes.spacing": "Use the authored spacing choice." };
    pending(input); // A caller cannot silently leave generated selection stale.
    input.library.values.selection = generateSelection({ ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt });
    expect(associated(input).selectionHash).not.toBe(changed.selectionHash);
    const rawDelete = fixture(); const spacing = rawDelete.library.values.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "themes.spacing")!.themes!.spacing as Record<string, unknown>; delete spacing.extra;
    rawDelete.library.values.selection = generateSelection({ ...rawDelete.library.values, source: rawDelete.library.source, adoptedAt: rawDelete.library.adoptedAt });
    expect(pending(rawDelete).needs.some(need => need.message === "provenance: example/themes.spacing originKinds does not summarize its members")).toBe(true);
    const less = fixture();
    less.library = applyLibraryChange(less.catalog, less.library, { baseHash: libraryHash(less.library), changes: [
      { portion: "values", change: { op: "remove", slot: "themes.spacing" } },
      { portion: "values", change: { op: "adopt", slot: "themes.spacing", source: "test-kit", members: ["base"] } },
    ] });
    const reduced = associated(less);
    expect(reduced.records.some(record => record.kind === "value-member" && record.member === "themes.spacing.base")).toBe(false);
    expect(reduced.records.filter(record => record.kind === "value-member")).toHaveLength(first.records.filter(record => record.kind === "value-member").length - 1);
    expect(reduced.sourceHashes.example).not.toBe(first.sourceHashes.example);
    const offer = fixture(); offer.catalog.values.fills = []; pending(offer);
  });

  it("preserves exact blocked offers and their bytes while refusing altered descriptors or missing bytes [mutant: missing-byte]", () => {
    const input = fixture(), bundle = loadCatalogBundles(); input.catalog.components.fills = [...input.catalog.components.fills, ...bundle.componentFills];
    const result = associated(input), blocked = bundle.sourceCandidates.find(candidate => candidate.status === "blocked")!;
    expect(result.records.find(record => record.kind === "offer" && record.fill === blocked.fill)!.evidence).toEqual(blocked);
    expect(result).not.toHaveProperty("renderers");
    const source = input.catalog.components.fills.find(doc => doc.$extensions["com.clossys.fill"].id === blocked.fill)!;
    componentOf(source).props = [...componentOf(source).props, "SYNTHETIC-stale"];
    pending(input);
  });

  it("requires every actual authored output and notice byte, rejecting duplicates, extras and stale receipts [mutant: missing-byte]", () => {
    const input = fixture(), source = syntheticSource(); source.candidate.reads = { themes: [], assets: [], components: [] };
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "author", slot: "components.button", fill: source.candidate, files: [source.file, source.notice] } }] });
    const result = associated(input);
    expect(result.records.find(record => record.kind === "component")!.files).toEqual([source.file, source.notice]);
    for (const files of [[source.file], [source.notice], [source.file, { ...source.notice, content: "changed notice" }], [source.file, source.notice, source.file], [source.file, source.notice, { path: "components/button/extra.ts", content: "SYNTHETIC" }]]) pending({ ...input, library: { ...input.library, components: { ...input.library.components, files } } });
  });

  it("preserves valid adopted literalization and its distinct upstream/member self hashes", () => {
    const input = fixture(), up = input.catalog.values.fills[0]!;
    const radius: FillDoc = { $extensions: { "com.clossys.fill": { ...up.$extensions["com.clossys.fill"], id: "test-kit/themes.radius", slot: "themes.radius" } }, themes: { radius: { base: { $type: "dimension", $value: { value: 4, unit: "px" } } } } };
    up.themes!.spacing = { base: { $type: "dimension", $value: "{themes.radius.base}" } };
    input.catalog.values.fills = [up, radius]; input.library.values = { fills: [] };
    for (const change of [{ op: "author" as const, slot: "themes.radius", tokens: { base: { $type: "dimension" as const, $value: { value: 8, unit: "px" } } } }, { op: "adopt" as const, slot: "themes.spacing", source: "test-kit" }]) input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "values", change }] });
    const record = associated(input).records.find(record => record.kind === "value-member" && record.slot === "themes.spacing")!;
    expect(record.kind).toBe("value-member");
    if (record.kind === "value-member" && record.origin?.kind === "adopted") {
      expect(record.token.$extensions!["com.clossys.materializedSha256"]).not.toBe(record.origin.sha256);
      expect(record.origin.aliasOf).toBe("themes.radius.base");
    }
  });

  it("retains selected surface source, receipt, rule and inputs independently of unavailable runtime measurement", () => {
    const fixture = adoptedSurface(), { input } = fixture;
    const first = associated(input), surface = first.records.find(record => record.kind === "surface")!;
    expect(surface.files).toEqual(input.library.surfaces!.files);
    expect(surface.transform).not.toHaveProperty("run");
    expect(surface.transform!.source).toEqual(fixture.transform.source);
    expect(surface.transform!.source).not.toBe(fixture.transform.source);
    expect(Object.isFrozen(surface.transform!.source)).toBe(true);
    expect(() => runtimeSnapshot(first)).not.toThrow();
    expect(surface.findings.some(finding => finding.code === "S8" && finding.severity === "error")).toBe(true);
    expect(first.runtimeQualification).toBe("unavailable");
    const duplicate = { ...input, library: structuredClone(input.library) };
    const duplicateSurface = structuredClone(duplicate.library.surfaces!.fills[0]!);
    duplicateSurface.$extensions["com.clossys.fill"].id = "example/sections.duplicate-synthetic";
    duplicate.library.surfaces!.fills = [...duplicate.library.surfaces!.fills, duplicateSurface];
    expect(pending(duplicate).needs.some(need => need.message.includes("S1 duplicate ownership"))).toBe(true);
    const derived = syntheticDerivation(fixture);
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "surfaces", change: { op: "derive", slot: derived.bundle.slot, rule: derived.rule.identity.id, inputs: derived.rule.inputs } }], surfaceBundles: [derived.bundle] }, { surfaceOptions: input.surfaceOptions! });
    const next = associated(input).records.find(record => record.kind === "surface")!;
    expect(next.origin!.kind).toBe("derived"); expect(next.rule).toMatchObject({ identity: derived.rule.identity, source: derived.rule.source });
    expect(next.rule).not.toHaveProperty("run");
    expect(next.rule!.source).not.toBe(derived.rule.source);
    expect(Object.isFrozen(next.rule!.source)).toBe(true);
    expect(() => runtimeSnapshot(next)).not.toThrow();
    expect(next.inputRecords.some(record => record.member === "themes.foreground.default")).toBe(true);
    input.library.surfaces!.files = input.library.surfaces!.files.slice(1); pending(input);
  });
});
