// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { componentFillId, componentMemberBinding, emitComponents } from "../catalog-core/emit-components.js";
import { DS_ATTR, dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentDescriptorHash, sortedComponentIds } from "../catalog-core/resolve-components.js";
import type { ComponentCandidate, ComponentCandidateDocument, ComponentFile, ComponentRule, ResolvedComponent, ResolvedComponents } from "../catalog-core/resolve-components.js";
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
function persistOne(doc: ComponentCandidateDocument, owned?: readonly ComponentFile[]): ComponentFile[] {
  const descriptor = Object.values(doc.components)[0]!;
  if (descriptor.impl.kind === "composed") return [];
  return persistDescriptor(fillId(doc), descriptor, owned ?? (descriptor.impl.kind === "source" ? outputs.get(fillId(doc)) ?? [] : []));
}
/**
 * A composition rule persists its template against the rule's own materialized files, under the origin
 * the product installs it with (changeset-components' compose op): composed, naming the rule. A rule id
 * is never an adopted fill id, so the leaf's provenance stamp names the consumer's own fill.
 */
function composedOrigin(rule: ComponentRule): ResolvedComponent["origin"] {
  return { kind: "composed", rule: rule.id, reads: sortedComponentIds(rule.inputs), inputsHash: `sha256:${"0".repeat(64)}` };
}
function persistDescriptor(fill: string, descriptor: ComponentCandidate, files: readonly ComponentFile[], composed?: ResolvedComponent["origin"]): ComponentFile[] {
  if (descriptor.impl.kind === "composed") throw new Error(`composed descriptor reached persist for ${fill}`);
  if (descriptor.impl.kind === "source" && !files.length) throw new Error(`no materialized output for ${fill}`);
  const origin: ResolvedComponent["origin"] = composed ?? { kind: "adopted", source: descriptor.source, fill, pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" };
  const component: ResolvedComponent = {
    slot: descriptor.slot, originKind: origin.kind, origin,
    impl: descriptor.impl as ResolvedComponent["impl"], propMap: structuredClone(descriptor.propMap),
    reads: { tokens: {}, assets: [], components: [] }, descriptor,
  };
  const profile: ResolvedComponents = {
    consumer: "pack-check", selectionHash: `sha256:${"0".repeat(64)}`,
    components: { [descriptor.slot]: component }, files: [...files],
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports: { ...thirdPartyExports(files), ...designerExports },
  };
  return emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs: {} } });
}

// The propMap refusals: parseBinding's pointer grammar and the generated adapter's member dispatch.
const PROPMAP_REFUSAL = /components: (?:unsupported propMap|unsupported member dispatch|unavailable package export) /;
function persistThrows(docs: readonly ComponentCandidateDocument[], owned?: (doc: ComponentCandidateDocument) => readonly ComponentFile[]): string[] {
  return docs.flatMap(doc => { try { persistOne(doc, owned?.(doc)); return []; } catch (error) { return [`${fillId(doc)}: ${(error as Error).message}`]; } });
}

/**
 * Every selectable fill, every source: imported packs, Foundry's own map (charts included) and every
 * composition rule's template. A fill is selectable when its slot is in the registry and its
 * materialization is not blocked (resolution refuses blockers before persist is ever reached).
 */
const selectable = bundles.componentFills.filter(doc => {
  const descriptor = Object.values(doc.components)[0]!;
  return slots.has(descriptor.slot) && !descriptor.blockers?.length;
});
const rules = loadComponentCompositionRules();
type Persisted = { id: string; source: string; slot: string; persist: () => void };
const everyFill: Persisted[] = [
  ...selectable.map(doc => ({ id: fillId(doc), source: doc.$extensions["com.clossys.fill"].source, slot: Object.values(doc.components)[0]!.slot, persist: () => persistOne(doc) })),
  ...rules.map(rule => ({ id: rule.id, source: "compose", slot: rule.slot, persist: () => persistDescriptor(rule.id, rule.template, rule.files, composedOrigin(rule)) })),
];
/**
 * Persisting one fill alone leaves out its sibling slots' files, so a relative import of another
 * slot's module is unresolvable here by construction; that one message is an isolation artifact,
 * not a persist refusal. Every other throw is what the product's whole-library persist would raise.
 */
const ISOLATION_ARTIFACT = /^components: missing import \.\.?\//;
/** The refusal each fill raises on the persist path, or undefined when it persists. */
function refusalOf(fill: Persisted): string | undefined {
  try { fill.persist(); return undefined; } catch (error) { const message = (error as Error).message; return ISOLATION_ARTIFACT.test(message) ? undefined : message; }
}

/**
 * Fills the persist emitter still refuses, keyed by fill id, each with its reason (the refusal it
 * raises today, without the "components: " prefix). This list may only shrink: a listed fill that now persists fails the stale check
 * below until it is removed, and a refusal not listed here fails the main check.
 */
const KNOWN_REFUSED: Readonly<Record<string, string>> = {
  // rac-starter: import forms the emitter's source scanner does not accept.
  "rac-starter/components.form": "unsupported import syntax in components/form/Form.tsx",
  "rac-starter/components.toolbar": "unsupported import syntax in components/toolbar/Toolbar.tsx",
};

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
  // The import-grammar refusals on valid source: a namespace import of an observed package, or a trailing comma.
  // A sibling's sub-parts are not in the emitter-owned leaf entrypoint, which exports only the contract component.
  const CROSS_LEAF_REFUSAL = /components: (?:unavailable named import \w+|missing import) from \.\.\/[a-z-]+\/index$/;
  const IMPORT_GRAMMAR_REFUSAL = /components: (?:unsupported import syntax|unverified import syntax|unavailable named import {2}from)/;
  const refusal = (docs: readonly ComponentCandidateDocument[]): string => { try { persistTogether(docs); return ""; } catch (error) { return (error as Error).message; } };
  it("materializes no emitter-owned leaf entrypoint and no wildcard re-export", () => {
    expect(shadcn).toHaveLength(26);
    expect(shadcn.filter(doc => !materialized.has(Object.values(doc.components)[0]!.slot)).map(fillId)).toEqual([]);
    const files = shadcn.flatMap(doc => materialized.get(Object.values(doc.components)[0]!.slot)!);
    expect(files.filter(file => /^components\/[a-z][a-z0-9-]*\/index\.ts$/.test(file.path)).map(file => file.path)).toEqual([]);
    expect(files.filter(file => /\bexport\s*\*/.test(file.content)).map(file => file.path)).toEqual([]);
    expect(files.filter(file => /^components\/_parts\/[a-z-]+\/index\.ts$/.test(file.path) && !file.path.includes("/utils/")).every(file => /^export \{ [A-Za-z, ]+ \} from "\.\/[a-z-]+"\n$/.test(file.content))).toBe(true);
  });
  it("all 26 fills persisted together hit no entrypoint-ownership refusal", () => {
    expect(refusal([...shadcn, icon])).not.toMatch(OWNERSHIP_REFUSAL);
  });
  it("materialized sources take only a sibling's contract name from its emitter-owned entrypoint", () => {
    const contract = (leaf: string) => leaf.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
    const edges = [...materialized.values()].flat().flatMap(file => [...file.content.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(?:\.\.\/)+([a-z][a-z0-9-]*)\/index"/g)]
      .filter(match => match[2] !== "icon" && match[2] !== "_parts")
      .flatMap(match => match[1]!.split(",").map(name => name.trim()).filter(Boolean).filter(name => name !== contract(match[2]!)).map(name => `${file.path} -> ${match[2]}#${name}`)));
    expect(edges).toEqual([]);
  });
  it("all 26 fills persisted together hit no cross-leaf sub-part refusal", () => {
    expect(refusal([...shadcn, icon])).not.toMatch(CROSS_LEAF_REFUSAL);
  });
  it("all 26 fills persisted together hit no import-grammar refusal", () => {
    expect(refusal([...shadcn, icon])).not.toMatch(IMPORT_GRAMMAR_REFUSAL);
  });
  it.each(shadcn.map(doc => [Object.values(doc.components)[0]!.slot, doc] as const))("%s with the leaves it composes hits no entrypoint-ownership or import-grammar refusal", (_slot, doc) => {
    const bySlot = new Map([...shadcn, icon].map(other => [Object.values(other.components)[0]!.slot, other]));
    const composes = new Set<string>();
    const visit = (slot: string): void => { for (const next of Object.values(bySlot.get(slot)!.components)[0]!.reads.components) if (!composes.has(next)) { composes.add(next); visit(next); } };
    visit(Object.values(doc.components)[0]!.slot);
    expect(refusal([doc, ...shadcn.filter(other => composes.has(Object.values(other.components)[0]!.slot)), ...composes.has("components.icon") ? [icon] : []])).not.toMatch(OWNERSHIP_REFUSAL);
    expect(refusal([doc, ...shadcn.filter(other => composes.has(Object.values(other.components)[0]!.slot)), ...composes.has("components.icon") ? [icon] : []])).not.toMatch(IMPORT_GRAMMAR_REFUSAL);
  });
  // Next's Turbopack and jiti resolve a relative module only by its real name or by extension search,
  // so a `.js` request for a `.ts`/`.tsx` file is "Module not found". Every relative request is extensionless.
  it("persists no relative module specifier with a file extension: a leaf with _parts, its leaf index, and the component index", () => {
    const bySlot = new Map([...shadcn, icon].map(other => [Object.values(other.components)[0]!.slot, other]));
    const composes = new Set<string>(["components.select"]);
    const visit = (slot: string): void => { for (const next of Object.values(bySlot.get(slot)!.components)[0]!.reads.components) if (!composes.has(next)) { composes.add(next); visit(next); } };
    visit("components.select");
    const files = persistTogether([...composes].map(slot => bySlot.get(slot)!));
    const paths = files.map(file => file.path);
    expect(paths).toEqual(expect.arrayContaining(["component-index.ts", "components/select/index.ts", "components/select/select.tsx", "components/_parts/input-group/index.ts", "components/_parts/input-group/input-group.tsx", "components/_parts/utils/index.ts"]));
    const specifiers = files.filter(file => /\.tsx?$/.test(file.path)).flatMap(file => [...file.content.matchAll(/\b(?:from|import)\s*["'](\.\.?\/[^"']*)["']/g)].map(match => `${file.path} -> ${match[1]}`));
    for (const path of ["component-index.ts", "components/select/index.ts", "components/select/select.tsx", "components/_parts/input-group/index.ts", "components/_parts/input-group/input-group.tsx"]) expect(specifiers.some(row => row.startsWith(`${path} -> `)), path).toBe(true);
    expect(specifiers.filter(row => /\.(?:js|ts|tsx)$/.test(row))).toEqual([]);
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
  // Provenance: an installed composition's stamp names the consumer's own fill, never the rule id.
  // The rule id (`compose:<leaf>@<n>`) is not a `<source>/<leaf>` fill id and stays refused as one.
  it.each(rules.map(rule => [rule.slot, rule] as const))("%s: persists under its composed origin with a valid provenance stamp", (_slot, rule) => {
    const origin = composedOrigin(rule);
    // The stamp the emitter writes for this leaf: the consumer's own fill, a safe `<source>/<leaf>` id.
    const fill = componentFillId({ slot: rule.slot, origin }, "pack-check");
    expect(fill).toBe(`pack-check/${rule.slot}`);
    expect(dsAttrs("components", rule.slot, fill)[DS_ATTR.fill]).toBe(fill);
    // Persisted alone, the only refusal is the sibling-input isolation artifact, raised after every leaf is stamped.
    let refusal: string | undefined;
    try { persistDescriptor(rule.id, rule.template, rule.files, origin); } catch (error) { refusal = (error as Error).message; }
    expect(refusal === undefined || ISOLATION_ARTIFACT.test(refusal), refusal).toBe(true);
    // The rule id (`compose:<leaf>@<n>`) is not a fill id: forged into an adopted origin it is refused, as it must be.
    expect(() => dsAttrs("components", rule.slot, rule.id)).toThrow(`provenance: unsafe fill id ${rule.id}`);
    expect(() => persistDescriptor(rule.id, rule.template, rule.files)).toThrow(`provenance: unsafe fill id ${rule.id}`);
  });
  it("the fill-id check still refuses unsafe ids", () => {
    for (const unsafe of ["../etc/components.button", "a/../components.button", "a/b/components.button", "a\\components.button", "a/components.button\"", "a/components.button>", "a/components.button x", "/components.button", "a/components", ""]) {
      expect(() => dsAttrs("components", "components.button", unsafe), unsafe).toThrow("provenance: unsafe fill id");
    }
    expect(() => dsAttrs("components", "components.button", "shadcn@aria/components.button")).not.toThrow();
  });
});

describe("pack check: the asset Icon adapter persists with no asset-reading leaf selected", () => {
  // The Icon leaf always imports the consumer glyph module, so selecting Icon is what requires that module,
  // whether or not any other selected leaf reads an asset. This is not an isolation artifact: it is the
  // whole library of a consumer that selects Icon and nothing that reads an asset.
  const byId = (id: string) => bundles.componentFills.find(doc => fillId(doc) === id)!;
  it("emits the glyph module the Icon leaf imports, and no glyph provider", () => {
    const files = persistOne(byId("foundry/components.icon"));
    expect(files.find(file => file.path === "components/icon/index.ts")!.content).toContain('from "../../assets/glyphs"');
    expect(files.find(file => file.path === "assets/glyphs.ts")!.content).toBe("export const glyphs = {} as const;\n");
    expect(files.find(file => file.path === "component-index.ts")!.content).not.toContain("GlyphProvider");
  });
  it("emits no glyph module for a library without Icon whose leaves read no asset", () => {
    expect(persistOne(byId("foundry/components.button")).map(file => file.path)).not.toContain("assets/glyphs.ts");
  });
});

describe("pack check: every selectable fill from every source persists, except a shrinking known-refused list", () => {
  const bySource = (source: string) => everyFill.filter(fill => fill.source === source);
  it("covers every source: shadcn@aria, Foundry including charts, and every composition template", () => {
    expect(bySource("shadcn@aria")).toHaveLength(26);
    expect(bySource("foundry").length).toBeGreaterThanOrEqual(57);
    expect(bySource("foundry").filter(fill => fill.slot.startsWith("components.chart-")).length).toBeGreaterThanOrEqual(9);
    expect(bySource("compose").map(fill => fill.slot)).toContain("components.date-picker");
    expect(bySource("compose")).toHaveLength(rules.length);
    expect(new Set(everyFill.map(fill => fill.id)).size).toBe(everyFill.length);
  });
  it("no fill outside KNOWN_REFUSED is refused by the persist emitter", () => {
    const refused = everyFill.flatMap(fill => { const refusal = refusalOf(fill); return refusal === undefined || fill.id in KNOWN_REFUSED ? [] : [`${fill.id}: ${refusal}`]; });
    expect(refused).toEqual([]);
  });
  it("stale known-refused: every listed fill exists and is still refused (remove it once it persists)", () => {
    const ids = new Set(everyFill.map(fill => fill.id));
    expect(Object.keys(KNOWN_REFUSED).filter(id => !ids.has(id))).toEqual([]);
    const persisted = everyFill.filter(fill => fill.id in KNOWN_REFUSED && refusalOf(fill) === undefined).map(fill => fill.id);
    expect(persisted, "now persists; delete from KNOWN_REFUSED").toEqual([]);
    // Each reason is the refusal the fill raises today; a changed refusal is a changed entry.
    for (const fill of everyFill.filter(fill => fill.id in KNOWN_REFUSED)) expect(refusalOf(fill), fill.id).toBe(`components: ${KNOWN_REFUSED[fill.id]}`);
  });
});
