// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { loadCatalogBundles } from "../catalog-bundles.js";
import { componentMemberBinding, emitComponents } from "../catalog-core/emit-components.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import type { ComponentCandidate, ComponentCandidateDocument, ComponentFile, ResolvedComponent, ResolvedComponents } from "../catalog-core/resolve-components.js";
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
function persistOne(doc: ComponentCandidateDocument): void {
  const descriptor = Object.values(doc.components)[0]!;
  if (descriptor.impl.kind === "composed") return;
  persistDescriptor(fillId(doc), descriptor, descriptor.impl.kind === "source" ? outputs.get(fillId(doc)) ?? [] : []);
}
// A composition rule persists its template against the rule's own materialized files.
function persistDescriptor(fill: string, descriptor: ComponentCandidate, files: readonly ComponentFile[]): void {
  if (descriptor.impl.kind === "composed") throw new Error(`composed descriptor reached persist for ${fill}`);
  if (descriptor.impl.kind === "source" && !files.length) throw new Error(`no materialized output for ${fill}`);
  const component: ResolvedComponent = {
    slot: descriptor.slot, originKind: "adopted",
    origin: { kind: "adopted", source: descriptor.source, fill, pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
    impl: descriptor.impl as ResolvedComponent["impl"], propMap: structuredClone(descriptor.propMap),
    reads: { tokens: {}, assets: [], components: [] }, descriptor,
  };
  const profile: ResolvedComponents = {
    consumer: "pack-check", selectionHash: `sha256:${"0".repeat(64)}`,
    components: { [descriptor.slot]: component }, files: [...files],
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports: { ...thirdPartyExports(files), ...designerExports },
  };
  emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs: {} } });
}

// The propMap refusals: parseBinding's pointer grammar and the generated adapter's member dispatch.
const PROPMAP_REFUSAL = /components: (?:unsupported propMap|unsupported member dispatch|unavailable package export) /;
function persistThrows(docs: readonly ComponentCandidateDocument[]): string[] {
  return docs.flatMap(doc => { try { persistOne(doc); return []; } catch (error) { return [`${fillId(doc)}: ${(error as Error).message}`]; } });
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
  ...rules.map(rule => ({ id: rule.id, source: "compose", slot: rule.slot, persist: () => persistDescriptor(rule.id, rule.template, rule.files) })),
];
/** The propMap-class refusal each fill raises on the persist path, or undefined when it persists. */
function refusalOf(fill: Persisted): string | undefined {
  try { fill.persist(); return undefined; } catch (error) { const message = (error as Error).message; return PROPMAP_REFUSAL.test(message) ? message : undefined; }
}

/**
 * Fills the persist emitter still refuses, keyed by fill id, each with its reason (the refusal it
 * raises today). This list may only shrink: a listed fill that now persists fails the stale check
 * below until it is removed, and a refusal not listed here fails the main check.
 */
const KNOWN_REFUSED: Readonly<Record<string, string>> = {
  // Foundry charts: ChartFrame part pointers and the multi-axis sparkline dispatch.
  "foundry/components.chart-area": "unsupported propMap components.chart-area.axes",
  "foundry/components.chart-bar": "unsupported propMap components.chart-bar.legend",
  "foundry/components.chart-heatmap": "unsupported propMap components.chart-heatmap.axes",
  "foundry/components.chart-line": "unsupported propMap components.chart-line.legend",
  "foundry/components.chart-range": "unsupported propMap components.chart-range.legend",
  "foundry/components.chart-scatter": "unsupported propMap components.chart-scatter.axes",
  "foundry/components.chart-sparkline": "unsupported member dispatch axes",
  "foundry/components.chart-status-strip": "unsupported propMap components.chart-status-strip.axes",
  "foundry/components.chart-waterfall": "unsupported propMap components.chart-waterfall.axes",
  // Foundry components: pointers outside parseBinding's grammar, or members the adapter cannot dispatch.
  "foundry/components.breadcrumbs": "unsupported propMap components.breadcrumbs.current",
  "foundry/components.color-picker": "unsupported propMap components.color-picker.part.area",
  "foundry/components.combo-box": "unsupported member dispatch allows-custom",
  "foundry/components.date-field": "unsupported propMap components.date-field.value.time",
  "foundry/components.dialog": "unsupported member dispatch dismissable",
  "foundry/components.disclosure": "unsupported propMap components.disclosure.scope.group",
  "foundry/components.file-trigger": "unsupported member dispatch accept",
  "foundry/components.grid-list": "unsupported propMap components.grid-list.layout.list",
  "foundry/components.menu": "unsupported propMap components.menu.presentation.inline",
  "foundry/components.meter": "unsupported member dispatch emphasis",
  "foundry/components.native-action": "unsupported propMap components.native-action.state.focus-visible",
  "foundry/components.number-field": "unsupported member dispatch format",
  "foundry/components.popover": "unsupported member dispatch placement",
  "foundry/components.search-field": "unsupported propMap components.search-field.part.clear",
  "foundry/components.slider": "unsupported propMap components.slider.selection.range",
  "foundry/components.table": "unsupported member dispatch selection",
  "foundry/components.tag-group": "unsupported member dispatch removable",
  "foundry/components.toast": "unsupported propMap components.toast.action",
  "foundry/components.tooltip": "unsupported member dispatch placement",
  "foundry/components.tree": "unsupported member dispatch expand",
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
    for (const [id, reason] of Object.entries(KNOWN_REFUSED)) expect(reason, id).toMatch(/^unsupported (?:propMap|member dispatch) /);
  });
});
