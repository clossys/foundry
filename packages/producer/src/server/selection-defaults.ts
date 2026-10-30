import { studioModuleRequirements } from './studio-module-manifest.js';
import { applyLibraryChange, emittedTokenProperties, libraryHash, loadCatalog, loadComponentCompositionRules, loadComponentRegistry, planComponentDefaults, planSurfaceDefaults, resolve, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK, type CompositeCatalogData, type CompositeEngineInput, type CompositeLibraryData, type LibraryData } from "@clossys/designer/catalog";
import { installedHeadlessLibrary, loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import { agentModule } from "./cells.js";
import type { StudioDesignerLibrary } from "./theme.js";
import type { StudioSelectionLeaf } from "./selection.js";

const REQUIRED = ["frames.app-shell", "sections.band", "sections.section-header", "sections.content", "sections.article", "sections.empty-state", "components.badge", "components.disclosure", "components.icon", "components.link", "components.navigation-tree", "components.button", "components.rich-text", "components.semantic-content", "sections.record-detail", "components.card", "components.table"];
const meta = (fill: any) => fill.$extensions["com.clossys.fill"];

/** Preserve authored selections; fill missing seats through Designer's default planners. */
export async function prepareStudioSelection(stored?: StudioDesignerLibrary): Promise<{ input: CompositeEngineInput; leaves: StudioSelectionLeaf[] }> {
  const bundles = loadCatalogBundles();
  const surfaceApi = await agentModule("designer", "library-cli/surface-catalog.js");
  const evidenceApi = await agentModule("designer", "library-cli/surface-package-evidence.js");
  const decisionsApi = await agentModule("designer", "library-cli/apply-decisions.js");
  const composite = stored && "values" in stored.library;
  const original = stored?.library;
  const valuesCatalog = stored && "values" in stored.catalog ? stored.catalog.values : stored?.catalog ?? loadCatalog();
  const catalog: CompositeCatalogData = stored && "values" in stored.catalog ? { ...stored.catalog, surfaces: stored.catalog.surfaces ?? surfaceApi.foundrySurfaceCatalog() } : { values: valuesCatalog as any, components: { slots: loadComponentRegistry().slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() }, surfaces: surfaceApi.foundrySurfaceCatalog() };
  const source = original?.source ?? { id: "studio", kind: "consumer" as const, author: "consumer" as const, license: "MIT", extends: "foundry" };
  const authored: CompositeLibraryData = composite ? structuredClone(original as CompositeLibraryData) : { source, adoptedAt: original?.adoptedAt ?? "2026-10-29", values: { fills: (original as LibraryData | undefined)?.fills ?? [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  authored.surfaces ??= { version: 1, fills: [], files: [] };
  const own = new Map<string, any>([...authored.values.fills, ...authored.components.fills, ...authored.surfaces.fills].map(fill => [meta(fill).slot, fill]));
  let values: LibraryData = { ...authored.values, source: authored.source, adoptedAt: authored.adoptedAt };
  const absentValues = catalog.values.slots.filter(slot => slot.layer === "tokens" || slot.id.startsWith("assets.icon-")).filter(slot => !values.fills.some(fill => meta(fill).slot === slot.id));
  const changes = absentValues.flatMap(slot => {
    const offers = catalog.values.fills.filter(fill => meta(fill).slot === slot.id && meta(fill).mode !== "reference");
    const fill = ["foundry", "tailwind-default"].map(source => offers.find(fill => meta(fill).source === source)).find(Boolean) ?? offers[0];
    return fill ? [{ op: "adopt" as const, slot: slot.id, source: meta(fill).source }] : [];
  });
  if (changes.length) values = applyLibraryChange(catalog.values, values, { baseHash: libraryHash(values), changes });
  const profile = resolve({ catalog: catalog.values, library: values });
  const literal = (id: string, mode: "light" | "dark", seen = new Set<string>()): string => {
    if (seen.has(id) || !profile.members[id]) throw new Error("Unresolved selected token");
    seen.add(id); const member = profile.members[id]!;
    const alias = member.alias[mode] ?? (member.value[mode] === undefined ? member.alias.light : undefined);
    return alias ? literal(alias, mode, seen) : member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, property]) => [id, { property: property.property, light: literal(id, "light"), ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))];
  const componentPlan = planComponentDefaults({ catalog: catalog.components, slots: catalog.components.slots.map(slot => slot.id), tokens, assets, installedRac: installedHeadlessLibrary(), bundles: bundles.sourceBundles, preference: DEFAULT_COMPONENT_PREFERENCE, picks: DEFAULT_COMPONENT_PICKS, fallback: DEFAULT_COMPONENT_FALLBACK });
  const surfaceCatalog = catalog.surfaces!;
  const surfacePlan = planSurfaceDefaults({ catalog: surfaceCatalog as any, slots: surfaceCatalog.slots.map(slot => slot.id), preference: DEFAULT_COMPONENT_PREFERENCE });
  const candidates = new Map<string, any>([...catalog.components.fills, ...surfaceCatalog.fills].map(fill => [meta(fill).id, fill]));
  const defaults = new Map<string, any>([...componentPlan.rows, ...surfacePlan.rows].flatMap(row => row.fill && candidates.has(row.fill) ? [[row.slot, candidates.get(row.fill)] as const] : []));
  const needed = new Set([...REQUIRED, ...await studioModuleRequirements()]);
  const visit = (leaf: string) => {
    const fill = own.get(leaf) ?? defaults.get(leaf); if (!fill) return;
    const descriptor: any = Object.values(fill.components ?? fill.sections ?? fill.frames ?? {})[0];
    for (const dependency of [...descriptor?.composes ?? [], ...descriptor?.reads?.components ?? [], ...descriptor?.parts ?? []]) if (/^(components|sections|frames)\./.test(dependency) && !needed.has(dependency)) { needed.add(dependency); visit(dependency); }
  };
  for (const leaf of [...needed]) visit(leaf);
  // Registered compositions require their planned inputs even without a direct candidate.
  for (const row of componentPlan.decisions) if (needed.has(row.slot) && "reads" in row) for (const leaf of row.reads) if (!needed.has(leaf)) { needed.add(leaf); visit(leaf); }
  let library: CompositeLibraryData = { ...authored, values: { ...values } };
  delete (library.values as any).source; delete (library.values as any).adoptedAt;
  const surfaceOptions = { packages: await evidenceApi.readSurfacePackageEvidence(surfaceCatalog.fills), measurements: [] };
  const componentDecisions = componentPlan.decisions.filter(row => needed.has(row.slot) && !own.has(row.slot));
  if (componentDecisions.length) library = applyLibraryChange(catalog, library, decisionsApi.decisionChangeSet(catalog, library, componentDecisions, bundles.sourceBundles), { surfaceOptions });
  const surfaceChanges = surfacePlan.decisions.filter(row => needed.has(row.slot) && !own.has(row.slot)).map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot, source: row.source } }));
  if (surfaceChanges.length) library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: surfaceChanges }, { surfaceOptions });
  const effective = new Map<string, any>([...library.values.fills, ...library.components.fills, ...library.surfaces!.fills].map(fill => [meta(fill).slot, fill]));
  const leaves: StudioSelectionLeaf[] = [...needed].sort().map(leaf => {
    const fill = effective.get(leaf);
    const descriptor: any = fill ? Object.values(fill.components ?? fill.sections ?? fill.frames ?? {})[0] : undefined;
    const selectedFill = descriptor?.origin?.fill ?? descriptor?.origin?.base?.fill ?? (fill ? meta(fill).id : undefined);
    return { leaf, source: own.has(leaf) ? "consumer" : fill ? "fallback" : "unavailable", ...(fill ? { fill: selectedFill } : {}), ...(!own.has(leaf) ? { message: fill ? "NEED: not selected by this consumer; using a planned default fill" : "NEED: no eligible default fill" } : {}) };
  });
  return { input: { catalog, library, componentOptions: stored?.componentOptions, surfaceOptions }, leaves };
}
