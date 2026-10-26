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
