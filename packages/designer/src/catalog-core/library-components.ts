/** Typed facade composition; value and component engines retain their own schemas. */
import { CatalogError, type EmitOptions, type EmitTarget } from "./api.js";
import { check as checkValues } from "./check.js";
import { resolve as resolveValues, libraryHash as valueLibraryHash } from "./resolve.js";
import { applyLibraryChange as applyValueChange } from "./library.js";
import { applyComponentLibraryChange } from "./changeset-components.js";
import { componentLibraryHash, resolveComponents } from "./resolve-components.js";
import { emit as emitValues, emittedTokenProperties } from "./emit.js";
import { emitComponents } from "./emit-components.js";
import { inspectGlyph } from "../catalog-assets/svg.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import type { ComponentCheckInput } from "./check-components.js";
import type { ComponentLibrary } from "./resolve-components.js";
import type { ComponentEmitTarget } from "./emit-components.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeCheckResult, CompositeEmitFile, CompositeEmitTarget, CompositeEngineInput, CompositeLibraryData, CompositeResolved, LibraryData, Resolved } from "./types.js";

import { surfacePortionHash, applySurfaceOperation, surfaceOf } from "./surface-library.js";
import { resolveSurfaces } from "./surface-check.js";
import { emitSurfaces } from "./surface-emit.js";
import type { SurfaceApplyOptions } from "./surface-types.js";
function portions(library: CompositeLibraryData): { values: LibraryData; components: ComponentLibrary } {
  if (library.source.kind !== "consumer" || library.source.author !== "consumer") throw new CatalogError("composite: one consumer source required");
  return {
    values: { ...library.values, source: library.source, adoptedAt: library.adoptedAt },
    components: { ...library.components, source: library.source, adoptedAt: library.adoptedAt },
  };
}
export function compositeLibraryHash(library: CompositeLibraryData): string {
  const owned = portions(library);
  return `sha256:${sha256(stableStringify({ values: valueLibraryHash(owned.values), components: componentLibraryHash(owned.components), ...(library.surfaces === undefined ? {} : { surfaces: surfacePortionHash(library.surfaces) }) }))}`;
}
/** Values come only from this freshly resolved consumer; catalog candidates are never consulted. */
function componentValues(profile: Resolved): ComponentCheckInput["tokens"] {
  const literal = (id: string, mode: "light" | "dark", seen: readonly string[] = []): string => {
    const member = profile.members[id];
    if (!member || seen.includes(id)) throw new CatalogError("composite: unresolved consumer token alias");
    // An explicit dark value ends alias traversal. A light-only contract may
    // still alias another token: retain the requested mode, as the value engine does.
    const alias = member.alias[mode] ?? (member.value[mode] === undefined ? member.alias.light : undefined);
    return alias ? literal(alias, mode, [...seen, id]) : member.css[mode] ?? member.css.light;
  };
  return Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, {
    property: output.property, light: literal(id, "light"),
    ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }),
  }]));
}
function componentProfile(input: CompositeEngineInput, values: Resolved) {
  const owned = portions(input.library);
  return resolveComponents({ ...input.componentOptions, catalog: input.catalog.components, library: owned.components,
    values: { tokens: componentValues(values), assets: [...new Set(Object.values(values.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort() },
  });
}
export function checkComposite(input: CompositeEngineInput): CompositeCheckResult {
  const owned = portions(input.library);
  const values = resolveValues({catalog:input.catalog.values,library:owned.values});
  const findings:CompositeCheckResult["findings"][number][]=[...checkValues({catalog:input.catalog.values,library:owned.values,fileExists:input.fileExists}).findings];
  let components:ReturnType<typeof componentProfile>|undefined;
  try {components=componentProfile(input,values);findings.push(...components.check.findings);}
  catch(error){if(!(error instanceof CatalogError))throw error;findings.push({code:"R",rule:"components",severity:"error",subject:input.library.source.id,message:error.message});}
  if(input.library.surfaces!==undefined){
    if(!components)findings.push({code:"S4",rule:"surfaces",severity:"error",subject:input.library.source.id,message:"Selected component resolution unavailable"});
    else try {const profile:CompositeResolved={consumer:input.library.source.id,selectionHash:compositeLibraryHash(input.library),values,components,check:{ok:!findings.some(finding=>finding.severity==="error"),findings}};findings.push(...resolveSurfaces(input,profile)!.check.findings);}
    catch(error){if(!(error instanceof CatalogError))throw error;const code=/surfaces: (S[1-8])/.exec(error.message)?.[1] as import("./surface-types.js").SurfaceFinding["code"]|undefined;findings.push({code:code??"S1",rule:"surfaces",severity:"error",subject:input.library.source.id,message:error.message});}
  }
  return {ok:!findings.some(finding=>finding.severity==="error"),findings};
}
/** The value and component halves of a composite resolution; they read only the values and components portions. */
interface PortionResolution { values: Resolved; components: ReturnType<typeof componentProfile>; findings: CompositeCheckResult["findings"] }
function computePortions(input: CompositeEngineInput): PortionResolution {
  const owned = portions(input.library);
  const values = resolveValues({ catalog: input.catalog.values, library: owned.values });
  const components = componentProfile(input, values);
  return { values, components, findings: [...checkValues({ catalog: input.catalog.values, library: owned.values, fileExists: input.fileExists }).findings, ...components.check.findings] };
}
/**
 * Everything the probe-independent part of a portion resolution reads besides the library: the value and component
 * catalogs and each of their fields, and the component options and each of theirs. Compared by identity, so a catalog
 * or option field replaced in place is a different input.
 * Catalogs are build-time data, loaded once and never mutated deeper than a replaced top-level field.
 */
function portionReads(input: CompositeEngineInput): readonly unknown[] {
  const { values, components } = input.catalog, options = input.componentOptions;
  return [values, ...Object.values(values), components, ...Object.values(components), options, ...(options ? Object.values(options) : [])];
}
interface PortionEntry {
  readonly digest: string; readonly reads: readonly unknown[];
  readonly values: Resolved; readonly components: ReturnType<typeof componentProfile>;
  /** The value check without a file probe: it reads nothing but the library and catalog, so it is kept too. */
  unprobed?: CompositeCheckResult["findings"];
}
/** Few distinct catalogs or options ever resolve one library object; older entries are dropped. */
const PORTION_ENTRIES = 4;
const portionCache = new WeakMap<CompositeLibraryData, readonly PortionEntry[]>();
/**
 * One value and component resolution per library digest: keyed by the library object and re-checked against its
 * digest, so a library changed in place, or another library, never reuses a result, and by everything else that
 * resolution reads. A file probe's answer is never kept: with `fileExists` the value check runs afresh on every call,
 * so evidence deleted or added between two calls is seen, whatever callback asks.
 */
function resolvePortions(input: CompositeEngineInput, digest = compositeLibraryHash(input.library)): PortionResolution {
  const reads = portionReads(input);
  // Entries for another digest describe this object before an in-place change: they can never be read again.
  const entries = (portionCache.get(input.library) ?? []).filter(entry => entry.digest === digest);
  let entry = entries.find(entry => entry.reads.length === reads.length && entry.reads.every((read, index) => read === reads[index]));
  if (!entry) {
    const owned = portions(input.library);
    const values = resolveValues({ catalog: input.catalog.values, library: owned.values });
    entry = { digest, reads, values, components: componentProfile(input, values) };
    portionCache.set(input.library, [entry, ...entries].slice(0, PORTION_ENTRIES));
  }
  const valueCheck = { catalog: input.catalog.values, library: portions(input.library).values };
  const valueFindings = input.fileExists ? checkValues({ ...valueCheck, fileExists: input.fileExists }).findings : (entry.unprobed ??= checkValues(valueCheck).findings);
  return { values: entry.values, components: entry.components, findings: [...valueFindings, ...entry.components.check.findings] };
}
function resolveCompositeFrom(input: CompositeEngineInput, { values, components, findings }: PortionResolution, selectionHash = compositeLibraryHash(input.library)): CompositeResolved {
  const profile: CompositeResolved = { consumer: input.library.source.id, selectionHash, values, components,
    check: { ok: !findings.some(finding => finding.severity === "error"), findings: [...findings] } };
  const surfaces=resolveSurfaces(input,profile);
  if(surfaces){profile.surfaces=surfaces;profile.check={ok:profile.check.ok&&surfaces.check.ok,findings:[...findings,...surfaces.check.findings]};}
  return profile;
}
export function resolveComposite(input: CompositeEngineInput): CompositeResolved {
  const digest = compositeLibraryHash(input.library);
  return resolveCompositeFrom(input, resolvePortions(input, digest), digest);
}
/**
 * The library an empty change set yields, without applying one: what
 * `applyCompositeLibraryChange(catalog, library, { baseHash: compositeLibraryHash(library), changes: [] }, options)`
 * returns (deep-equal, with the same hash: each owned portion without its own source and date), throwing where that
 * apply throws. The apply's closing check resolves a library with surface fills; `resolveResult` lets the caller
 * resolve the result with its own engine input instead, so its later evaluation shares that one resolution. Only
 * when that throws does the apply's own check run, so an error is always the apply's.
 */
export function committedCompositeLibrary(catalog: CompositeCatalogData, library: CompositeLibraryData, options?: SurfaceApplyOptions, resolveResult?: (result: CompositeLibraryData) => unknown): CompositeLibraryData {
  const { values, components } = portions(library);
  const { source: _valueSource, adoptedAt: _valueDate, ...valuePortion } = values;
  const { source: _componentSource, adoptedAt: _componentDate, ...componentPortion } = components;
  const result: CompositeLibraryData = { ...library, values: valuePortion, components: componentPortion };
  if (result.surfaces?.fills.length) {
    if (!options) throw new CatalogError("surfaces: S8 explicit resolution options required");
    let resolved = false;
    if (resolveResult) try { resolveResult(result); resolved = true; } catch { /* The apply's own check below decides. */ }
    if (!resolved) { const final = { catalog, library: result, componentOptions: options.componentOptions, surfaceOptions: options.surfaceOptions }; resolveComposite(final); }
  }
  return result;
}
/** One CAS, ordered dispatch, and no observable partial result on failure. */
export function applyCompositeLibraryChange(catalog: CompositeCatalogData, library: CompositeLibraryData, cs: CompositeChangeSet, options?: SurfaceApplyOptions): CompositeLibraryData {
  if (cs.baseHash !== compositeLibraryHash(library)) throw new CatalogError("composite: changeset baseHash differs");
  let staged = structuredClone(library);
  let { values, components } = portions(staged);
  // Value and component resolution reads only those two portions, which surface operations never change:
  // resolve them once and reuse the result until a values or components operation replaces either portion.
  let resolved: { values: LibraryData; components: ComponentLibrary; portions: PortionResolution } | undefined;
  const current = (input: CompositeEngineInput): PortionResolution => {
    if (resolved?.values !== values || resolved.components !== components) resolved = { values, components, portions: computePortions(input) };
    return resolved.portions;
  };
  for (const operation of cs.changes) {
    if (operation.portion === "values") {
      values = applyValueChange(catalog.values, values, { baseHash: valueLibraryHash(values), changes: [operation.change] });
    } else if (operation.portion === "components") {
      components = applyComponentLibraryChange(catalog.components, components, { baseHash: componentLibraryHash(components), changes: [operation.change] }, cs.bundles);
    } else if(operation.portion === "surfaces") {
      if(operation.change.op!=="remove"&&!options)throw new CatalogError("surfaces: S8 explicit resolution options required");
      const {source:_vs,adoptedAt:_vd,...vp}=values;const {source:_cs,adoptedAt:_cd,...cp}=components;
      staged={...staged,values:vp,components:cp};
      // Only refresh may replace its exact held package pointer before checking current provenance.
      // The refresh operation validates its old identity and the new upstream join itself.
      if (operation.change.op === "refresh") {
        const unsurfaced = { catalog, library: { ...staged, surfaces: undefined }, componentOptions: options?.componentOptions, surfaceOptions: options?.surfaceOptions };
        const profile = resolveCompositeFrom(unsurfaced, current(unsurfaced));
        staged = applySurfaceOperation(catalog, staged, operation.change, [], profile, options!.surfaceOptions);
        resolveSurfaces({ ...unsurfaced, library: staged }, profile, false);
        continue;
      }
      const {surfaces:_deferred,...withoutSurfaces}=staged;
      const pending={catalog,library:staged,componentOptions:options?.componentOptions,surfaceOptions:options?.surfaceOptions};
      const unsurfaced={...pending,library:withoutSurfaces};
      const profile=resolveCompositeFrom(unsurfaced,current(unsurfaced));
      profile.surfaces=resolveSurfaces(pending,profile,false);
      staged=applySurfaceOperation(catalog,staged,operation.change,cs.surfaceBundles??[],profile,options?.surfaceOptions??{packages:[],measurements:[]});
    } else throw new CatalogError("composite: unknown portion");
  }
  const { source: _valueSource, adoptedAt: _valueDate, ...valuePortion } = values;
  const { source: _componentSource, adoptedAt: _componentDate, ...componentPortion } = components;
  const result={...staged,values:valuePortion,components:componentPortion};
  if(result.surfaces?.fills.length){if(!options)throw new CatalogError("surfaces: S8 explicit resolution options required");const final={catalog,library:result,componentOptions:options.componentOptions,surfaceOptions:options.surfaceOptions};resolveCompositeFrom(final,current(final));}
  return result;
}
const valueTargets = new Set<string>(["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"]);
const componentTargets = new Set<string>(["component-index", "components-consumption", "notices"]);
export function emitComposite(profile: CompositeResolved, targets: readonly CompositeEmitTarget[], options: EmitOptions = {}): CompositeEmitFile[] {
  const code = targets.some(target => target !== "notices" && target !== "components-consumption" && target !== "surfaces-consumption");
  if (code && (!profile.check.ok || profile.check.findings.some(finding => finding.severity === "error") || !profile.components.check.ok || profile.components.check.findings.some(finding => finding.severity === "error"))) throw new CatalogError("composite: checked observations or value findings failed");
  if (!/^sha256:[a-f0-9]{64}$/.test(profile.selectionHash) || profile.consumer !== profile.values.consumer || profile.consumer !== profile.components.consumer) throw new CatalogError("composite: invalid profile identity");
  for (const target of targets) if (!valueTargets.has(target) && !componentTargets.has(target) && target!=="surface-index" && target!=="surfaces-consumption") throw new CatalogError("composite: unknown emit target");
  const files: CompositeEmitFile[] = emitValues(profile.values, targets.filter((target): target is EmitTarget => valueTargets.has(target)), options);
  // S2's leaf key icon-close becomes the component contract id assets.icon-close.
  const glyphs: Record<string, unknown> = {};
  for (const member of Object.values(profile.values.members).filter(member => member.$type === "glyph" && member.slot.startsWith("assets.icon-"))) {
    const leafKey = member.slot.slice("assets.".length);
    const assetId = `assets.${leafKey}`;
    inspectGlyph(member.value.light);
    if (assetId in glyphs) throw new CatalogError("composite: ambiguous consumer glyph");
    glyphs[assetId] = member.value.light;
  }
  for (const file of emitComponents({ ...profile.components, selectionHash: profile.selectionHash }, targets.filter((target): target is ComponentEmitTarget => componentTargets.has(target)), { glyphModule: { path: "adapters/glyphs.ts", glyphs } })) files.push({ path: file.path, contents: file.content });
  const valueNotice = files.find(file => file.path === "notices.json");
  const componentNotice = files.find(file => file.path === "notices/components.json");
  if (valueNotice && componentNotice) {
    const values: unknown = JSON.parse(valueNotice.contents);
    const components: unknown = JSON.parse(componentNotice.contents);
    valueNotice.contents = stableStringify({ version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, values, components });
  }
  if(profile.surfaces){
    if(code&&(!profile.surfaces.check.ok||profile.surfaces.check.findings.some(row=>row.severity==="error")))throw new CatalogError("surfaces: S8 inconsistent checked evidence");
    files.push(...emitSurfaces(profile.surfaces,targets));
    const surfaceNotice=files.find(file=>file.path==="notices/surfaces.json");
    if(valueNotice&&surfaceNotice){const previous=JSON.parse(valueNotice.contents);valueNotice.contents=stableStringify({...previous,surfaces:JSON.parse(surfaceNotice.contents)});}
  }else if(targets.some(target=>target==="surface-index"||target==="surfaces-consumption"))throw new CatalogError("surfaces: portion not opted in");
  const unique = new Map<string, CompositeEmitFile>();
  for (const file of files) {
    if (unique.has(file.path)) throw new CatalogError("composite: emitted files collide");
    unique.set(file.path, file);
  }
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
}
