import { CatalogError } from "./api.js";
import { stableStringify } from "./stable.js";
import { aliasOf, compare, cssText, flatten, leafOf, metaOf, modeValue, references, relativeOf } from "./model.js";
import type { CatalogData, DtcgToken, DtcgValue, FillDoc, Finding, LibraryData, Mode, Resolved, ResolvedMember, Slot } from "./types.js";

export interface EngineInput { catalog: CatalogData; library: LibraryData }
export interface Chosen { slot: Slot; fill: FillDoc; token: DtcgToken; via: ResolvedMember["via"] }
/** Only materialized consumer fills participate in engine resolution and checks. */
export function allFills(input: EngineInput): FillDoc[] {
  return [...input.library.fills].sort((a, b) => compare(metaOf(a).id, metaOf(b).id) || compare(stableStringify(a), stableStringify(b)));
}
export function assertInput(input: EngineInput): void {
  if (!Array.isArray(input.catalog.slots) || !Array.isArray(input.catalog.fills) || !Array.isArray(input.library.fills)) throw new CatalogError("schema: catalog expected slot and fill arrays");
  for (const [index, slot] of input.catalog.slots.entries()) if (!slot || typeof slot.id !== "string" || !slot.contract || !slot.contract.members || !Array.isArray(slot.contract.modes) || !Array.isArray(slot.requires)) throw new CatalogError(`schema: catalog.slots.${index} expected contract, modes and requires`);
  for (const [index, fill] of input.library.fills.entries()) {
    const meta = fill?.$extensions?.["com.clossys.fill"];
    if (!meta || typeof meta.id !== "string" || typeof meta.slot !== "string" || typeof meta.source !== "string" || !Array.isArray(meta.conforms) || !Array.isArray(meta.evidence)) throw new CatalogError(`schema: fills.${index} expected fill metadata`);
    if (meta.reads && (!Array.isArray(meta.reads.tokens) || !Array.isArray(meta.reads.assets) || [...meta.reads.tokens,...meta.reads.assets].some(read => typeof read !== "string"))) throw new CatalogError(`schema: fills.${index}.reads expected token and asset arrays of ids`);
  }

}
function selectionContext(input: EngineInput) {
  assertInput(input);
  const chosen: Record<string, Chosen> = {};
  const fills = allFills(input);
  const flattened = new Map<FillDoc, Record<string, DtcgToken>>();
  const slots = new Map(input.catalog.slots.map(slot => [slot.id, slot]));
  for (const fill of fills) {
    const slot = slots.get(metaOf(fill).slot);
    if (!slot || metaOf(fill).mode === "reference") continue;
    const tokens = flatten(fill); flattened.set(fill, tokens);
    for (const [id, token] of Object.entries(tokens)) {
      if (leafOf(id) !== slot.id || chosen[id]) continue;
      chosen[id] = { slot, fill, token, via: token.$extensions?.["com.clossys.origin"]?.kind ?? "authored" };
    }
  }
  return { chosen, notices: [] as Finding[], fills, flattened };
}
export function choose(input: EngineInput): { chosen: Record<string, Chosen>; notices: Finding[] } {
  const { chosen, notices } = selectionContext(input);
  return { chosen, notices };
}
/** A check owns a fresh selection and resolution; no caller evidence or previous call is reused. */
export function resolveForCheck(input: EngineInput) {
  const context = selectionContext(input);
  return { ...context, resolved: resolveSelection(input, context) };
}
export function resolve(input: EngineInput): Resolved {
  return resolveSelection(input, choose(input));
}
function resolveSelection(input: EngineInput, { chosen, notices }: { chosen: Record<string, Chosen>; notices: Finding[] }): Resolved {
  type Result = { value: DtcgValue; css: string; final: string; alias?: string };
  const deref = (id: string, mode: Mode, stack: readonly string[]): Result | undefined => {
    if (stack.includes(id) || stack.length > 16) return undefined;
    const entry = chosen[id]; if (!entry) return undefined;
    const token = entry.token; const actualMode = (entry.slot.contract.modes as readonly Mode[]).includes(mode) ? mode : "light";
    const value = modeValue(token, actualMode); const alias = aliasOf(value);
    if (alias) {
      const target = deref(alias, mode, [...stack, id]); if (!target) return undefined;
      const finalEntry = chosen[target.final];
      const emit = finalEntry?.slot.contract.kind === "token" ? finalEntry.slot.contract.emit?.[relativeOf(target.final)] : undefined;
      return { value: target.value, css: emit ? `var(${emit}, ${cssText(chosen[target.final]!.token.$type, target.value, chosen[target.final]!.token, actualMode === "light" || modeValue(chosen[target.final]!.token, "dark") === chosen[target.final]!.token.$value)})` : target.css, final: target.final, alias };
    }
    return { value, css: cssText(token.$type, value, token, actualMode === "light" || token.$extensions?.["com.clossys.modes"]?.dark === undefined), final: id };
  };
  const members: Record<string, ResolvedMember> = {};
  for (const id of Object.keys(chosen).sort(compare)) {
    const entry = chosen[id]!; const light = deref(id, "light", []); if (!light) continue;
    const dark = (entry.slot.contract.modes as readonly Mode[]).includes("dark") ? deref(id, "dark", []) : undefined;
    if ((entry.slot.contract.modes as readonly Mode[]).includes("dark") && !dark) continue;
    const emit = entry.slot.contract.kind === "token" ? entry.slot.contract.emit?.[relativeOf(id)] : undefined;
    const origin = entry.token.$extensions?.["com.clossys.origin"];
    const font = entry.token.$extensions?.["com.clossys.font"];
    members[id] = { slot: entry.slot.id, source: metaOf(entry.fill).source, fill: metaOf(entry.fill).id, via: entry.via, $type: entry.token.$type,
      value: { light: light.value, ...(dark ? { dark: dark.value } : {}) }, css: { light: light.css, ...(dark ? { dark: dark.css } : {}) },
      alias: { ...(light.alias ? { light: light.alias } : {}), ...(dark?.alias ? { dark: dark.alias } : {}) }, ...(emit ? { emit } : {}), ...(font ? { font } : {}), ...(origin ? { origin } : {}),
      ...(entry.slot.contract.kind === "asset" ? { reads: references(entry.token) } : {}) };
  }
  return { version: 1, consumer: input.library.source.id, selectionHash: profileHash(input.library), members, notices, ...(input.library.baseline ? { baseline: input.library.baseline } : {}) };
}
function profileHash(library: LibraryData): string {
  let hash = 0xcbf29ce484222325n;
  const ordered = { ...library, fills: [...library.fills].sort((a,b) => compare(metaOf(a).id,metaOf(b).id)) };
  for (const byte of new TextEncoder().encode(stableStringify(ordered))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `fnv1a64:${hash.toString(16).padStart(16,"0")}`;
}
export { profileHash as libraryHash };
