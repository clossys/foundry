import { CatalogError, type ChangeSet } from "./api.js";
import { aliasOf, assetReferences, compare, cssText, flatten, interpolateAsset, leafOf, metaOf, modeValue, references, relativeOf } from "./model.js";
import { libraryHash, resolve } from "./resolve.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { validateSelectionStrategy } from "./selection-strategy.js";
import { materializeRule, matchesRuleInputs } from "./rules.js";
import type { CatalogData, DtcgNode, DtcgToken, DtcgValue, FillDoc, LegacySelection, LibraryData, Mode, Origin, Resolved, Selection } from "./types.js";
export { libraryHash } from "./resolve.js";
export function originOf(token: DtcgToken): Origin | undefined { return token.$extensions?.["com.clossys.origin"]; }
/** The copied content excludes its provenance and the self-hash extension. */
export function tokenContent(token: DtcgToken): DtcgToken {
  const copy = structuredClone(token); if (copy.$extensions) {
    delete copy.$extensions["com.clossys.origin"]; delete copy.$extensions["com.clossys.materializedSha256"];
    if (Object.keys(copy.$extensions).length === 0) delete copy.$extensions;
  }
  return copy;
}
function put(root: Record<string, DtcgNode>, path: readonly string[], value: DtcgToken): void {
  let group = root;
  for (const part of path.slice(0,-1)) { if (!group[part]) group[part] = {}; group = group[part] as Record<string,DtcgNode>; }
  group[path[path.length-1]!] = structuredClone(value);
}
function writeFill(library: LibraryData, slot: string, values: Readonly<Record<string,DtcgToken>>, previous?: FillDoc): FillDoc {
  const root: Record<string,DtcgNode> = {};
  for (const [relative, token] of Object.entries(values).sort(([a],[b]) => compare(a,b))) put(root, [slot.split(".")[1]!, ...relative.split(".")], token);
  const originKinds = [...new Set(Object.values(values).map(originOf).filter((origin): origin is Origin => !!origin).map(origin => origin.kind))].sort(compare);
  const metadata = previous ? structuredClone(metaOf(previous)) : { id: `${library.source.id}/${slot}`, slot, source: library.source.id, mode: "implementation" as const, sourceAddress: `fills/${slot}.json`, relation: "same-contract" as const, builtOn: [], conforms: [], evidence: [], author: library.source.author, trust: "consumer" as const, license: library.source.license, status: "draft" as const };
  if (slot.startsWith("assets.")) {
    const dependencies = new Set(Object.values(values).flatMap(token => references(token).map(leafOf)));
    metadata.reads = { themes: [...dependencies].filter(id => id.startsWith("themes.")).sort(compare), assets: [...dependencies].filter(id => id.startsWith("assets.")).sort(compare) };
  }
  return { $extensions: { "com.clossys.fill": { ...metadata, id: `${library.source.id}/${slot}`, slot, source: library.source.id, mode: "implementation", originKinds } }, [slot.split(".")[0]!]: root } as unknown as FillDoc;
}
export function generateSelection(library: LibraryData): Selection {
  if (Object.hasOwn(library, "direction")) throw new CatalogError("selection: direction was removed; cite the designer.identity brief");
  if (library.strategy != null && validateSelectionStrategy(library.strategy).state === "invalid") throw new CatalogError("selection: invalid designer.identity brief provenance");
  return { version: 2, consumer: library.source.id, rubricVersion: library.rubricVersion ?? "unscored", strategy: library.strategy ? structuredClone(library.strategy) : null,
    slots: [...library.fills].sort((a,b) => compare(metaOf(a).slot,metaOf(b).slot)).map(fill => {
      const origins = Object.values(flatten(fill)).map(originOf).filter((origin): origin is Origin => !!origin);
      return { slot: metaOf(fill).slot, originKinds: [...new Set(origins.map(origin => origin.kind))].sort(compare), sources: [...new Set(origins.map(origin => origin.kind === "adopted" ? origin.source : library.source.id))].sort(compare), rationale: library.rationale?.[metaOf(fill).slot] ?? null };
    }) };
}
export function derivationInputsHash(catalog: CatalogData, library: LibraryData, inputs: readonly string[]): string {
  return derivationInputsHashFromResolved(resolve({catalog,library}), inputs);
}
/** Internal: the caller owns this freshly resolved profile for one synchronous operation. */
export function derivationInputsHashFromResolved(profile: Resolved, inputs: readonly string[]): string {
  return sha256(stableStringify(Object.fromEntries([...new Set(inputs)].sort(compare).map(id => {
    const member = profile.members[id]; if (!member) throw new CatalogError(`derive: input ${id} has no consumer value`);
    return [id, { $type: member.$type, value: member.value, css: member.css }];
  }))));
}
/** Cache lifetime is one check invocation, including its identity checks. */
export function createDerivationInputsHasher(profile: () => Resolved): (inputs: readonly string[]) => string {
  const hashes = new Map<string, string>();
  return inputs => {
    const ids = [...new Set(inputs)].sort(compare);
    const key = stableStringify(ids);
    let hash = hashes.get(key);
    if (hash === undefined) { hash = derivationInputsHashFromResolved(profile(), ids); hashes.set(key, hash); }
    return hash;
  };
}
export function applyLibraryChange(catalog: CatalogData, library: LibraryData, cs: ChangeSet): LibraryData {
  if (cs.baseHash !== libraryHash(library)) throw new CatalogError("changeset baseHash does not match library");
  const fills = new Map(library.fills.map(fill => [metaOf(fill).slot, structuredClone(fill)]));
  const claimChecks = (fill: FillDoc): FillDoc => {
    const meta = metaOf(fill); const requires = catalog.slots.find(slot => slot.id === meta.slot)?.requires ?? [];
    meta.conforms = [...new Set([...meta.conforms,...requires])].sort(compare);
    meta.evidence = [...meta.evidence,...requires.filter(clause => !meta.evidence.some(item => item.clause === clause)).map(clause => ({clause,check: clause === "dtcg#alias" ? "C2" as const : clause.startsWith("wcag-") ? "C9" as const : "C1" as const}))];
    return fill;
  };
  const current = (): LibraryData => ({ ...library, fills: [...fills.values()].sort((a,b) => compare(metaOf(a).id,metaOf(b).id)) });
  const candidateFor = (source: string, slot: string): FillDoc | undefined => catalog.fills.find(fill => metaOf(fill).source === source && metaOf(fill).slot === slot && metaOf(fill).mode !== "reference");
  const candidateValue = (source: string, id: string, mode: Mode, stack: readonly string[] = []): { value: DtcgValue; css: string } => {
    if (stack.includes(id) || stack.length > 16) throw new CatalogError(`adopt: alias cycle or depth at ${id}`);
    const candidate = candidateFor(source,leafOf(id)); const token = candidate && flatten(candidate)[id]; if (!token) throw new CatalogError(`adopt: ${source} has no alias target ${id}`);
    const value = modeValue(token,mode); const alias = aliasOf(value);
    return alias ? candidateValue(source,alias,mode,[...stack,id]) : { value, css: cssText(token.$type,value,token,mode === "light" || token.$extensions?.["com.clossys.modes"]?.dark === undefined) };
  };
  const visiting = new Set<string>();
  const adopt = (slot: string, source: string, requested?: readonly string[]): void => {
    const candidate = candidateFor(source,slot); if (!candidate) throw new CatalogError(`adopt: ${source} has no candidate for ${slot}`);
    if (!library.adoptedAt || !/^\d{4}-\d{2}-\d{2}$/.test(library.adoptedAt)) throw new CatalogError("adopt: library.adoptedAt must be YYYY-MM-DD");
    const key = `${source}/${slot}`; if (visiting.has(key)) throw new CatalogError(`adopt: alias cycle at ${key}`); visiting.add(key);
    const existing = fills.get(slot); const values = Object.fromEntries(Object.entries(existing ? flatten(existing) : {}).map(([id,token]) => [relativeOf(id),token]));
    const candidateMembers = flatten(candidate);
    const members = [...new Set(requested?.map(member => member.startsWith(`${slot}.`) ? member : `${slot}.${member}`) ?? Object.keys(candidateMembers))].sort(compare);
    for (let index=0; index<members.length; index++) {
      const id = members[index]!;
      const upstream = candidateMembers[id]; if (!upstream) throw new CatalogError(`adopt: ${key} does not provide ${id}`);
      const token = tokenContent(upstream); let transformed = false; let aliasOfMember: string | undefined;
      for (const ref of references(upstream)) {
        const targetSlot = leafOf(ref); if (targetSlot === slot && members.includes(ref)) continue;
        const owned = fills.get(targetSlot); const origins = owned ? Object.values(flatten(owned)).map(originOf) : [];
        const sameSource = !owned || origins.every(origin => origin?.kind === "adopted" && origin.source === source);
        if (sameSource) {
          if (targetSlot === slot) {
            if (!candidateMembers[ref]) throw new CatalogError(`adopt: ${source} has no alias target ${ref}`);
            members.push(ref);
          } else adopt(targetSlot,source);
        }
        else {
          for (const mode of ["light","dark"] as const) if (aliasOf(modeValue(token,mode)) === ref) {
            const literal = candidateValue(source,ref,mode).value;
            if (mode === "light") token.$value = structuredClone(literal);
            else if (token.$extensions?.["com.clossys.modes"]?.dark !== undefined) token.$extensions["com.clossys.modes"]!.dark = structuredClone(literal);
            transformed = true; aliasOfMember ??= ref;
          }
          const raw = token.$extensions?.["com.clossys.css"]?.raw;
          if (raw && token.$extensions?.["com.clossys.css"]?.reads?.includes(ref)) {
            // Preserve the upstream composite when its referenced leaf is owned differently.
            let text = raw;
            for (const [relative, css] of Object.entries(catalog.slots.find(slot => slot.id === targetSlot)?.contract.kind === "token" ? (catalog.slots.find(slot => slot.id === targetSlot)!.contract as import("./types.js").TokenContract).emit ?? {} : {})) {
              if (`${targetSlot}.${relative}` !== ref) continue;
              for (;;) {
                const start = text.indexOf(`var(${css}`); if (start < 0) break;
                let depth = 1; let end = start + 4; for (; end < text.length && depth; end++) { if (text[end] === "(") depth++; if (text[end] === ")") depth--; }
                text = text.slice(0,start) + candidateValue(source,ref,"light").css + text.slice(end);
              }
            }
            token.$value = text; token.$extensions!["com.clossys.css"] = { raw: text, reads: (token.$extensions!["com.clossys.css"]!.reads ?? []).filter(read => read !== ref) };
            transformed = true; aliasOfMember ??= ref;
          }
        }
      }
      const metadata = metaOf(candidate);
      const origin: Origin = { kind: "adopted", source, fill: metadata.id, member: id, ...(metadata.pin ? { pin: structuredClone(metadata.pin) } : {}), license: metadata.license, sha256: sha256(stableStringify(tokenContent(upstream))), adoptedAt: library.adoptedAt, ...(aliasOfMember ? { aliasOf: aliasOfMember } : {}) };
      token.$extensions = { ...token.$extensions, "com.clossys.origin": origin, ...(transformed ? { "com.clossys.materializedSha256": sha256(stableStringify(tokenContent(token))) } : {}) };
      values[relativeOf(id)] = token;
    }
    fills.set(slot,writeFill(library,slot,values,existing ?? candidate)); visiting.delete(key);
  };
  for (const change of cs.changes) {
    if (change.op === "remove") { fills.delete(change.slot); continue; }
    const slot = catalog.slots.find(slot => slot.id === change.slot); if (!slot) throw new CatalogError(`changeset: unknown slot ${change.slot}`);
    if (change.op === "adopt") { adopt(change.slot,change.source,change.members); continue; }
    if (change.op === "author") {
      const prior = fills.get(change.slot); const values = Object.fromEntries(Object.entries(prior ? flatten(prior) : {}).map(([id,token]) => [relativeOf(id),token]));
      for (const [relative, raw] of Object.entries(change.tokens)) { const token = tokenContent(raw); token.$extensions = { ...token.$extensions, "com.clossys.origin": { kind: "authored", license: originOf(raw)?.kind === "authored" ? (originOf(raw) as Extract<Origin,{kind:"authored"}>).license : library.source.license, ...(originOf(raw)?.kind === "authored" && (originOf(raw) as Extract<Origin,{kind:"authored"}>).note ? { note: (originOf(raw) as Extract<Origin,{kind:"authored"}>).note } : {}) } }; values[relative.startsWith(`${change.slot}.`) ? relativeOf(relative) : relative] = token; }
      fills.set(change.slot,claimChecks(writeFill(library,change.slot,values,prior))); continue;
    }
    const inputs = [...new Set(change.inputs)].sort(compare); const snapshot = current();
    const rule = materializeRule(catalog,snapshot,change.rule,change.slot);
    if (!matchesRuleInputs(rule,inputs)) throw new CatalogError(`derive: ${change.rule} differs from declared inputs`);
    const inputsHash = derivationInputsHash(catalog,snapshot,inputs); const profile = resolve({catalog,library:snapshot});
    const previous = fills.get(change.slot);
    const values: Record<string,DtcgToken> = Object.fromEntries(Object.entries(previous ? flatten(previous) : {}).map(([id,token]) => [relativeOf(id),token]));
    for (const [relative, template] of Object.entries(rule.values)) {
      for (const ref of references(template)) if (!inputs.includes(ref)) throw new CatalogError(`derive: ${change.rule} reads undeclared input ${ref}`);
      const token = tokenContent(template);
      const materialize = (value: DtcgValue,mode: Mode): DtcgValue => {
        const alias = aliasOf(value);
        const read = (id: string,text: boolean): DtcgValue | undefined => { if (!inputs.includes(id)) throw new CatalogError(`derive: ${change.rule} reads undeclared input ${id}`); const member = profile.members[id]; return member && (text ? member.css[mode] ?? member.css.light : member.value[mode] ?? member.value.light); };
        const resolved = alias ? read(alias,false) : interpolateAsset(value,read); if (resolved === undefined) throw new CatalogError(`derive: ${change.rule} has unresolved inputs`); return resolved;
      };
      token.$value = materialize(token.$value,"light");
      if (token.$extensions?.["com.clossys.modes"]?.dark !== undefined) token.$extensions["com.clossys.modes"]!.dark = materialize(token.$extensions["com.clossys.modes"]!.dark!,"dark");
      if (token.$extensions?.["com.clossys.css"]?.raw) token.$extensions["com.clossys.css"]!.raw = String(materialize(token.$extensions["com.clossys.css"]!.raw!,"light"));
      token.$extensions = { ...token.$extensions, "com.clossys.origin": { kind: "derived", rule: change.rule, inputs, inputsHash } }; values[relative] = token;
    }
    fills.set(change.slot,claimChecks(writeFill(library,change.slot,values,fills.get(change.slot))));
  }
  const result = current(); return { ...result, selection: generateSelection(result) };
}
/** v1 is a migration input only. Every legacy preference becomes an explicit adopted copy. */
export function migrateSelection(catalog: CatalogData, library: LibraryData, legacy: LegacySelection): LibraryData {
  if (legacy.version !== 1 || legacy.consumer !== library.source.id) throw new CatalogError("migration: invalid v1 selection");
  let result = library;
  for (const source of [...legacy.defaultChain].reverse()) {
    const changes = catalog.fills.filter(fill => metaOf(fill).source === source && metaOf(fill).mode !== "reference").map(fill => ({op:"adopt" as const,slot:metaOf(fill).slot,source}));
    result = applyLibraryChange(catalog,result,{baseHash:libraryHash(result),changes});
  }
  for (const pick of legacy.picks) result = applyLibraryChange(catalog,result,{baseHash:libraryHash(result),changes:[{op:"adopt",slot:pick.scope === "slot" ? pick.target : leafOf(pick.target),source:pick.source,...(pick.scope === "member" ? {members:[pick.target]} : {})}]});
  return result;
}
