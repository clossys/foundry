import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import type { FillMeta, FrameSlot } from "../catalog-core/types.js";
import { stableStringify } from "../catalog-core/stable.js";
import { FOUNDRY_FRAME_GAPS, FOUNDRY_FRAME_MAP, type FoundryFrameMapping } from "./foundry-frames.map.js";
import { measuredSurfaceConsumption, type FoundrySurfaceConsumption } from "./foundry-surface-consumption.js";
export interface FoundryFrameDescriptor extends FoundrySurfaceConsumption {
  slot: string;
  members: readonly string[];
  propMap: Readonly<Record<string, string>>;
  slots: Readonly<Record<string, string>>;
  statePorts: Readonly<Record<string, string>>;
  impl: { kind: "package"; module: string; export: string };
}
export interface FoundryFrameFillDoc {
  $extensions: { "com.clossys.fill": FillMeta };
  frames: Readonly<Record<string, FoundryFrameDescriptor>>;
}
export interface FoundryFrameCoverage {
  slot: string;
  status: "candidate" | "subset" | "unavailable";
  supported: readonly string[];
  missing: readonly string[];
  missingSlots: readonly string[];
  missingRequiredSlots: readonly string[];
  missingStatePorts: readonly string[];
  notes: readonly string[];
}
export interface FoundryFrameInput {
  slots?: readonly FrameSlot[];
  mappings?: Readonly<Record<string, FoundryFrameMapping>>;
  /** Independent public barrel inventory keyed by package/subpath. */
  exports?: Readonly<Record<string, readonly string[]>>;
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);
/** Pure deterministic descriptors, with no inferred runtime or conformance evidence. */
export function importFoundryFrames(input: FoundryFrameInput = {}): { fills: readonly FoundryFrameFillDoc[]; coverage: readonly FoundryFrameCoverage[] } {
  const slots = input.slots ?? frameSlots as unknown as readonly FrameSlot[];
  const mappings = input.mappings ?? FOUNDRY_FRAME_MAP;
  const fills: FoundryFrameFillDoc[] = [], coverage: FoundryFrameCoverage[] = [];
  const seen = new Set<string>();
  for (const slot of [...slots].sort((a, b) => compare(a.id, b.id))) {
    if (slot.layer !== "frames" || slot.contract.kind !== "frame" || !/^frames\.[a-z][a-z0-9-]*$/.test(slot.id) || seen.has(slot.id)) throw new Error(`foundry-frames: invalid or duplicate slot ${slot.id}`);
    seen.add(slot.id);
    const leaf = slot.id.slice(7), contract = slot.contract, mapping = mappings[leaf];
    const validate = (values: Readonly<Record<string, string>>, allowed: readonly string[], kind: string): Record<string, string> => Object.fromEntries(Object.entries(values).sort(([a], [b]) => compare(a, b)).map(([key, value]) => {
      if (!allowed.includes(key) || !value.trim()) throw new Error(`foundry-frames: unknown or empty ${kind} ${slot.id}.${key}`);
      return [key, value];
    }));
    const members = mapping ? validate(mapping.members, contract.members.names, "member") : {};
    const slotMap = mapping ? validate(mapping.slots, contract.slots.map(item => item.id), "slot") : {};
    const statePorts = mapping ? validate(mapping.statePorts, contract.statePorts.map(item => item.id), "state port") : {};
    const supported = sorted(Object.keys(members)), missing = sorted(contract.members.names.filter(member => !supported.includes(member)));
    const missingSlots = sorted(contract.slots.filter(item => !Object.hasOwn(slotMap, item.id)).map(item => item.id));
    const missingRequiredSlots = sorted(contract.slots.filter(item => item.required && missingSlots.includes(item.id)).map(item => item.id));
    const missingStatePorts = sorted(contract.statePorts.filter(item => !Object.hasOwn(statePorts, item.id)).map(item => item.id));
    const incomplete = missing.length + missingSlots.length + missingStatePorts.length > 0;
    coverage.push({ slot: slot.id, status: !mapping ? "unavailable" : incomplete ? "subset" : "candidate", supported, missing, missingSlots, missingRequiredSlots, missingStatePorts, notes: [...(mapping?.notes ?? [FOUNDRY_FRAME_GAPS[leaf] ?? "No package implementation is available."]), "Descriptor only; anatomy, source, accessibility, contrast, layout and rendered conformance are unmeasured."] });
    if (!mapping) continue;
    const module = `${mapping.package}/${mapping.subpath}`;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(mapping.export) || (input.exports && !input.exports[module]?.includes(mapping.export))) throw new Error(`foundry-frames: unavailable package export ${module}#${mapping.export}`);
    const pin = { package: mapping.package, version: mapping.version, export: `./${mapping.subpath}#${mapping.export}` };
    fills.push({ $extensions: { "com.clossys.fill": { id: `foundry/${slot.id}`, slot: slot.id, source: "foundry", mode: "implementation", sourceAddress: pin.export, relation: incomplete ? "subset" : "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", pin, status: "draft", ...(incomplete ? { unmapped: sorted([...missing, ...missingSlots.map(id => `slot.${id}`), ...missingStatePorts.map(id => `state.${id}`)]) } : {}) } }, frames: { [leaf]: { slot: slot.id, members: supported, propMap: members, slots: slotMap, statePorts, impl: { kind: "package", module, export: mapping.export }, ...measuredSurfaceConsumption(slot.id, pin) } } });
  }
  for (const leaf of Object.keys(mappings)) if (!seen.has(`frames.${leaf}`)) throw new Error(`foundry-frames: mapping has no contract frames.${leaf}`);
  return { fills, coverage };
}
export function generatedFoundryFrameFiles(input: FoundryFrameInput = {}): Readonly<Record<string, string>> {
  const result = importFoundryFrames(input);
  return Object.fromEntries([...result.fills.map(fill => [fill.$extensions["com.clossys.fill"].slot + ".json", stableStringify(fill)]), ["frames.coverage.json", stableStringify({ source: "foundry", coverage: result.coverage })]]);
}
