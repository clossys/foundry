// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { componentMemberBinding, emitComponents } from "../catalog-core/emit-components.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import type { ComponentCandidateDocument, ComponentFile, ResolvedComponent, ResolvedComponents } from "../catalog-core/resolve-components.js";
import type { ComponentSlot } from "../catalog-core/types.js";

/**
 * Pack check: plan/check never parses a propMap, so a fill can pass a DRY selection and still
 * throw when a library is persisted. Every selectable component fill goes through the persist
 * emitter (emitComponents, component-index target) on its own, and none may throw.
 */
const bundles = loadCatalogBundles();
const slots = new Map((componentSlots as unknown as ComponentSlot[]).map(slot => [slot.id, slot]));
const outputs = new Map(bundles.sourceCandidates.map(candidate => [candidate.fill, candidate.outputFiles]));
// Package inventories are read from the real barrels, never from descriptor claims.
const barrel = (subpath: string): string[] => [...readFileSync(resolve(import.meta.dirname, `../${subpath}/index.ts`), "utf8").matchAll(/export\s*\{([^}]+)\}/g)]
  .flatMap(match => match[1]!.split(",").map(binding => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!)).filter(Boolean);
const designerExports = Object.fromEntries(["components", "charts", "shell"].map(subpath => [`@clossys/designer/${subpath}`, barrel(subpath)]));
// Third-party named imports inside copied source are not what this check measures; they are admitted as written.
function thirdPartyExports(files: readonly ComponentFile[]): Record<string, string[]> {
  const exports: Record<string, Set<string>> = {};
  for (const file of files) for (const match of file.content.matchAll(/\bimport\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"'.][^"']*)["']/g)) {
    if (match[2]!.startsWith("@clossys/designer")) continue;
    const names = exports[match[2]!] ??= new Set();
    for (const binding of match[1]!.split(",")) { const name = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]; if (name) names.add(name); }
  }
  return Object.fromEntries(Object.entries(exports).map(([module, names]) => [module, [...names].sort()]));
}
function fillId(doc: ComponentCandidateDocument): string { return doc.$extensions["com.clossys.fill"].id; }
function persistOne(doc: ComponentCandidateDocument, owned?: readonly ComponentFile[]): void {
  const descriptor = Object.values(doc.components)[0]!;
  if (descriptor.impl.kind === "composed") return;
  const files = owned ?? (descriptor.impl.kind === "source" ? outputs.get(fillId(doc)) ?? [] : []);
  if (descriptor.impl.kind === "source" && !files.length) throw new Error(`no materialized output for ${fillId(doc)}`);
  const component: ResolvedComponent = {
    slot: descriptor.slot, originKind: "adopted",
    origin: { kind: "adopted", source: descriptor.source, fill: fillId(doc), pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
    impl: descriptor.impl, propMap: structuredClone(descriptor.propMap),
    reads: { tokens: {}, assets: [], components: [] }, descriptor,
  };
  const profile: ResolvedComponents = {
    consumer: "pack-check", selectionHash: `sha256:${"0".repeat(64)}`,
    components: { [descriptor.slot]: component }, files,
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports: { ...thirdPartyExports(files), ...designerExports },
  };
  emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs: {} } });
}

// The propMap refusals: parseBinding's pointer grammar and the generated adapter's member dispatch.
const PROPMAP_REFUSAL = /components: (?:unsupported propMap|unsupported member dispatch|unavailable package export) /;
function persistThrows(docs: readonly ComponentCandidateDocument[], owned?: (doc: ComponentCandidateDocument) => readonly ComponentFile[]): string[] {
  return docs.flatMap(doc => { try { persistOne(doc, owned?.(doc)); return []; } catch (error) { return [`${fillId(doc)}: ${(error as Error).message}`]; } });
}

describe("pack check: every selectable component fill persists", () => {
  const fills = bundles.componentFills.filter(doc => slots.has(Object.values(doc.components)[0]!.slot));
  // Imported packs only: Foundry's own package map is checked by its importer and is not regenerated here.
  const imported = fills.filter(doc => doc.$extensions["com.clossys.fill"].source !== "foundry");
  it("emitComponents (persist path) refuses no imported pack fill's propMap", () => {
    expect(imported.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria")).toHaveLength(26);
    expect(imported.length).toBeGreaterThanOrEqual(33);
    expect(persistThrows(imported).filter(message => PROPMAP_REFUSAL.test(message))).toEqual([]);
  });
  it.each(bundles.componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria").map(doc => [Object.values(doc.components)[0]!.slot, doc] as const))("%s: every propMap value is a pointer and every other member is listed unmapped", (_slot, doc) => {
    const descriptor = Object.values(doc.components)[0]!;
    const meta = doc.$extensions["com.clossys.fill"];
    const contract = slots.get(descriptor.slot)!.contract.members;
    const required = contract.mode === "closed" ? contract.names : contract.required ?? [];
    const component = { slot: descriptor.slot, impl: descriptor.impl, descriptor } as unknown as ResolvedComponent;
    for (const [member, pointer] of Object.entries(descriptor.propMap)) expect(() => componentMemberBinding(component, member, pointer), `${descriptor.slot}.${member} = ${pointer}`).not.toThrow();
    expect(Object.keys(descriptor.propMap).sort()).toEqual([...descriptor.members].sort());
    expect([...Object.keys(descriptor.propMap), ...meta.unmapped].sort()).toEqual([...required].sort());
    expect(meta.unmapped.filter(member => member in descriptor.propMap)).toEqual([]);
    // The committed fill is what a consumer adopts; it must carry exactly these pointers and this unmapped list.
    const committed = JSON.parse(readFileSync(resolve(import.meta.dirname, `../catalog/fills/shadcn@aria/${descriptor.slot}.json`), "utf8")) as ComponentCandidateDocument;
    expect(Object.values(committed.components)[0]!.propMap).toEqual(descriptor.propMap);
    expect(committed.$extensions["com.clossys.fill"].unmapped).toEqual(meta.unmapped);
  });
});

describe("pack check: shadcn@aria materialized sources persist through the real emitter", () => {
  // As a product persist does: shadcn@aria fills selected together, with the materializer's exact
  // output bytes, beside the package Icon leaf the rewritten sources compose.
  const shadcn = bundles.componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria");
  const icon = bundles.componentFills.find(doc => doc.$extensions["com.clossys.fill"].id === "foundry/components.icon")!;
  const materialized = new Map(bundles.sourceBundles.map(bundle => [bundle.slot, bundle.files]));
  function resolved(doc: ComponentCandidateDocument): ResolvedComponent {
    const descriptor = Object.values(doc.components)[0]!;
    return {
      slot: descriptor.slot, originKind: "adopted",
      origin: { kind: "adopted", source: descriptor.source, fill: fillId(doc), pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
      impl: descriptor.impl, propMap: structuredClone(descriptor.propMap),
      reads: { tokens: {}, assets: [...descriptor.reads.assets], components: [...descriptor.reads.components] }, descriptor,
    };
  }
  function persistTogether(docs: readonly ComponentCandidateDocument[]): ComponentFile[] {
    const files = new Map<string, ComponentFile>();
    for (const doc of docs) for (const file of materialized.get(Object.values(doc.components)[0]!.slot) ?? []) {
      const previous = files.get(file.path);
      if (previous && previous.content !== file.content) throw new Error(`materialized bytes differ at ${file.path}`);
      files.set(file.path, file);
    }
    const owned = [...files.values()];
    const profile: ResolvedComponents = {
      consumer: "pack-check", selectionHash: `sha256:${"0".repeat(64)}`,
      components: Object.fromEntries(docs.map(doc => [Object.values(doc.components)[0]!.slot, resolved(doc)])), files: owned,
      check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
      packageExports: { ...thirdPartyExports(owned), ...designerExports },
    };
    // Glyph geometry is not what this check measures: each read asset gets one valid stand-in path.
    const glyphs = Object.fromEntries(docs.flatMap(doc => Object.values(doc.components)[0]!.reads.assets).map(asset => [asset, [["path", { d: "M4 12h16" }]]]));
    return emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs } });
  }
  // The entrypoint-ownership refusals: a materialized file at an emitter-owned leaf index, or a wildcard re-export.
  // Later closure findings (third-party inventories, glyph provider, import syntax) are measured elsewhere.
  const OWNERSHIP_REFUSAL = /components: (?:generated entrypoint conflicts with materialized source|wildcard (?:source )?exports)/;
  const refusal = (docs: readonly ComponentCandidateDocument[]): string => { try { persistTogether(docs); return ""; } catch (error) { return (error as Error).message; } };
  it("materializes no emitter-owned leaf entrypoint and no wildcard re-export", () => {
    expect(shadcn).toHaveLength(26);
    expect(shadcn.filter(doc => !materialized.has(Object.values(doc.components)[0]!.slot)).map(fillId)).toEqual([]);
    const files = shadcn.flatMap(doc => materialized.get(Object.values(doc.components)[0]!.slot)!);
    expect(files.filter(file => /^components\/[a-z][a-z0-9-]*\/index\.ts$/.test(file.path)).map(file => file.path)).toEqual([]);
    expect(files.filter(file => /\bexport\s*\*/.test(file.content)).map(file => file.path)).toEqual([]);
    expect(files.filter(file => /^components\/_parts\/[a-z-]+\/index\.ts$/.test(file.path) && !file.path.includes("/utils/")).every(file => /^export \{ [A-Za-z, ]+ \} from "\.\/[a-z-]+\.js"\n$/.test(file.content))).toBe(true);
  });
  it("all 26 fills persisted together hit no entrypoint-ownership refusal", () => {
    expect(refusal([...shadcn, icon])).not.toMatch(OWNERSHIP_REFUSAL);
  });
  it.each(shadcn.map(doc => [Object.values(doc.components)[0]!.slot, doc] as const))("%s with the leaves it composes hits no entrypoint-ownership refusal", (_slot, doc) => {
    const bySlot = new Map([...shadcn, icon].map(other => [Object.values(other.components)[0]!.slot, other]));
    const composes = new Set<string>();
    const visit = (slot: string): void => { for (const next of Object.values(bySlot.get(slot)!.components)[0]!.reads.components) if (!composes.has(next)) { composes.add(next); visit(next); } };
    visit(Object.values(doc.components)[0]!.slot);
    expect(refusal([doc, ...shadcn.filter(other => composes.has(Object.values(other.components)[0]!.slot)), ...composes.has("components.icon") ? [icon] : []])).not.toMatch(OWNERSHIP_REFUSAL);
  });
});

describe("pack check: every registered composition template persists", () => {
  // A rule template is not a bundled fill: its owned bytes are the rule's files, and its pointers bind into its own entry.
  const rules = loadComponentCompositionRules();
  const doc = (rule: (typeof rules)[number]) => ({ $extensions: { "com.clossys.fill": { id: `${rule.template.source}/${rule.slot}`, source: rule.template.source, slot: rule.slot } }, components: { [rule.slot.slice(11)]: rule.template } }) as unknown as ComponentCandidateDocument;
  it("covers every registered composition", () => {
    expect(rules.map(rule => rule.slot)).toEqual(["components.date-picker", "components.file-trigger"]);
  });
  it.each(rules.map(rule => [rule.slot, rule] as const))("%s: every composed propMap value is a pointer the persist emitter accepts", (_slot, rule) => {
    const component = { slot: rule.slot, impl: rule.template.impl, descriptor: rule.template } as unknown as ResolvedComponent;
    for (const [member, pointer] of Object.entries(rule.template.propMap)) expect(() => componentMemberBinding(component, member, pointer), `${rule.slot}.${member} = ${pointer}`).not.toThrow();
    expect(Object.keys(rule.template.propMap).sort()).toEqual([...rule.template.members].sort());
    expect(persistThrows([doc(rule)], () => rule.files).filter(message => PROPMAP_REFUSAL.test(message))).toEqual([]);
  });
});
