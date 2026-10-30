import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot, FillMeta } from "../catalog-core/types.js";
import type { ComponentCandidate } from "../catalog-core/resolve-components.js";
import { stableStringify } from "../catalog-core/stable.js";
import { componentRacDeclaration } from "./component-rac.js";
import { FOUNDRY_COMPONENT_GAPS, FOUNDRY_COMPONENT_MAP } from "./foundry-components.map.js";
import type { FoundryComponentMapping, FoundryComponentSubpath } from "./foundry-components.map.js";
import foundrySourceReads from "./foundry-source-reads.json" with { type: "json" };

export interface FoundryComponentFillDoc {
  $extensions: { "com.clossys.fill": FillMeta };
  components: Readonly<Record<string, ComponentCandidate>>;
}
export interface FoundryComponentCoverage {
  slot: string;
  status: "candidate" | "subset" | "unavailable" | "blocked";
  supported: readonly string[];
  missing: readonly string[];
  notes: readonly string[];
}
export interface FoundryComponentImport {
  fills: readonly FoundryComponentFillDoc[];
  coverage: readonly FoundryComponentCoverage[];
}
export interface FoundryComponentImportInput {
  slots?: readonly ComponentSlot[];
  mappings?: Readonly<Record<string, FoundryComponentMapping>>;
  /** An independently read public barrel export inventory, when validating package pointers. */
  exports?: Readonly<Record<FoundryComponentSubpath, readonly string[]>>;
  /** Token slots each leaf's own module source consumes; defaults to the committed derivation (foundry-source-reads.json). */
  sourceReads?: Readonly<Record<string, readonly string[]>>;
}
const PACKAGE = "@clossys/designer";
const VERSION = "0.12.0";
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);

/** Pure descriptor generation: no source copying, install inspection or accessibility claims. */
export function importFoundryComponents(input: FoundryComponentImportInput = {}): FoundryComponentImport {
  const slots = input.slots ?? componentSlots as unknown as readonly ComponentSlot[];
  const mappings = input.mappings ?? FOUNDRY_COMPONENT_MAP;
  const sourceReads: Readonly<Record<string, readonly string[]>> = input.sourceReads ?? foundrySourceReads;
  const fills: FoundryComponentFillDoc[] = [];
  const coverage: FoundryComponentCoverage[] = [];
  const seen = new Set<string>();
  for (const slot of [...slots].sort((a, b) => compare(a.id, b.id))) {
    if (slot.layer !== "components" || slot.contract.kind !== "component" || !/^components\.[a-z][a-z0-9-]*$/.test(slot.id) || seen.has(slot.id)) throw new Error(`foundry-components: invalid or duplicate slot ${slot.id}`);
    seen.add(slot.id);
    const leaf = slot.id.slice("components.".length);
    const members = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
    const mapping = mappings[leaf];
    if (!mapping) {
      coverage.push({ slot: slot.id, status: "unavailable", supported: [], missing: sorted(members), notes: [FOUNDRY_COMPONENT_GAPS[leaf] ?? "No package implementation is available."] });
      continue;
    }
    if (!/^[A-Z][A-Za-z0-9]*$/.test(mapping.export) || !["components", "charts", "shell"].includes(mapping.subpath)) throw new Error(`foundry-components: invalid export for ${slot.id}`);
    const propMap: Record<string, string> = {};
    for (const member of Object.keys(mapping.propMap).sort(compare)) {
      const known = slot.contract.members.mode === "closed" ? members.includes(member) : new RegExp(slot.contract.members.pattern).test(member);
      if (!known || !mapping.propMap[member]?.trim()) throw new Error(`foundry-components: unknown or empty member ${slot.id}.${member}`);
      propMap[member] = mapping.propMap[member]!;
    }
    const supported = sorted(Object.keys(propMap));
    const missing = sorted(members.filter(member => !supported.includes(member)));
    // Inventory includes alternate member-dispatched exports (IconButton, Textarea, Brandmark, toast).
    if (input.exports) {
      const pointers = [`./${mapping.subpath}#${mapping.export}`, ...Object.values(propMap)];
      for (const pointer of pointers) {
        const target = /^\.\/(components|charts|shell)#([A-Za-z][A-Za-z0-9]*)/.exec(pointer);
        if (!target || !input.exports[target[1] as FoundryComponentSubpath].includes(target[2]!)) throw new Error(`foundry-components: unavailable package export ${pointer}`);
      }
    }
    const composes = sorted(mapping.composes ?? []);
    const tokenReads = sorted(slot.contract.allowedReads.tokens);
    // Frozen reads are checked against what the component's own source consumes (foundry-source-reads.json).
    // An omission is recorded, not yet enforced: the fix is widening the slot contract's allowedReads.
    const omitted = sorted((sourceReads[leaf] ?? []).filter(read => !tokenReads.includes(read)));
    const blockers = mapping.blockers ?? [];
    const pin = { package: PACKAGE, version: VERSION, export: `./${mapping.subpath}#${mapping.export}` };
    const descriptor: ComponentCandidate = {
      slot: slot.id, source: "foundry", root: slot.contract.root, members: supported,
      props: sorted(mapping.props), propMap,
      // Contract bindings are declarations. Source scans and runtime observations remain separate.
      reads: { tokens: tokenReads, assets: sorted(mapping.assets ?? (leaf === "button" ? ["assets.icon-chevron-right"] : [])), components: composes },
      composes, impl: { kind: "package", module: `${PACKAGE}/${mapping.subpath}`, export: mapping.export },
      ...(blockers.length ? { blockers: structuredClone(blockers) } : {}),
      license: "MIT", pin, deps: [
        { name: "react", version: ">=18", license: "MIT" },
        { name: "tailwind-merge", version: "^3.7.0", license: "MIT" },
        ...(mapping.subpath === "charts" || leaf === "native-action" ? [] : [
          { name: "react-aria-components", version: "^1.19.0", license: "Apache-2.0" },
        ]),
      ],
    };
    // This package declares react-aria-components as a peer, so every package descriptor it ships is a RAC peer (CC3).
    descriptor.rac = componentRacDeclaration(descriptor, { peer: true });
    fills.push({ $extensions: { "com.clossys.fill": {
      id: `foundry/${slot.id}`, slot: slot.id, source: "foundry", mode: "implementation",
      sourceAddress: pin.export, relation: missing.length ? "subset" : "same-contract", builtOn: composes,
      conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", pin, status: "draft",
      ...(missing.length ? { unmapped: missing } : {}),
    }, ...(leaf === "semantic-content" ? { "com.clossys.default": { tier: "Custom", reason: "no shadcn@aria item" } } : {}) }, components: { [leaf]: descriptor } });
    coverage.push({ slot: slot.id, status: blockers.length ? "blocked" : missing.length ? "subset" : "candidate", supported, missing,
      notes: [...(mapping.notes ?? []), ...blockers.map(blocker => blocker.message),
        ...(omitted.length ? [`Frozen reads omit source-consumed ${omitted.join(", ")}; the contract's allowedReads must widen before this is enforced.`] : []), "Descriptor only; source, accessibility, contrast and consumer runtime conformance are unmeasured."] });
  }
  for (const leaf of Object.keys(mappings)) if (!seen.has(`components.${leaf}`)) throw new Error(`foundry-components: mapping has no contract components.${leaf}`);
  return { fills, coverage };
}

/** Exact local artifacts, returned as bytes so callers control filesystem writes. */
export function generatedFoundryComponentFiles(input: FoundryComponentImportInput = {}): Readonly<Record<string, string>> {
  const result = importFoundryComponents(input);
  return Object.fromEntries([
    ...result.fills.map(fill => [fill.$extensions["com.clossys.fill"].slot + ".json", stableStringify(fill)]),
    ["components.coverage.json", stableStringify({ source: "foundry", package: PACKAGE, version: VERSION, coverage: result.coverage })],
  ]);
}
