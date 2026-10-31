import { studioModuleRequirements } from './studio-module-manifest.js';
import type { SurfaceDependency } from "@clossys/designer/catalog";
import { applyLibraryChange, emittedTokenProperties, libraryHash, loadCatalog, loadComponentCompositionRules, loadComponentRegistry, planComponentDefaults, planSurfaceDefaults, resolve, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK, type CompositeCatalogData, type CompositeEngineInput, type CompositeLibraryData, type LibraryData, type SurfaceSourceBundle } from "@clossys/designer/catalog";
import { installedHeadlessLibrary, loadCatalogBundles, prepareCatalogSurfaceDefaults } from "@clossys/designer/catalog-bundles";
import { agentModule } from "./cells.js";
import type { StudioDesignerLibrary } from "./theme.js";
import type { StudioSelectionLeaf } from "./selection.js";
import { DESIGNER_SPECIMEN_REQUIRED_LEAVES } from "./designer-specimen-requirements.js";
import { studioEvidence, studioSurfaceDefaults, type StudioReportSink } from './studio-render-policy.js';

const REQUIRED = ["frames.app-shell", "sections.band", "sections.section-header", "sections.content", "sections.article", "sections.empty-state", "components.badge", "components.disclosure", "components.icon", "components.link", "components.navigation-tree", "components.button", "components.rich-text", "components.semantic-content", "sections.record-detail", "sections.cards", "components.card", "components.table", ...DESIGNER_SPECIMEN_REQUIRED_LEAVES];
const meta = (fill: any) => fill.$extensions["com.clossys.fill"];

/** Preserve authored selections; fill missing seats through Designer's default planners. */
interface SurfaceEvidenceProducer {
  specimenSurfaceEnvironment(input: CompositeEngineInput): Promise<{ input: CompositeEngineInput; dependencies: readonly SurfaceDependency[] }>;
  qualifySpecimenSurfaces(input: CompositeEngineInput): Promise<CompositeEngineInput>;
}
export async function prepareStudioSelection(stored?: StudioDesignerLibrary, sourceEvidence?: SurfaceEvidenceProducer, report?: StudioReportSink): Promise<{ input: CompositeEngineInput; leaves: StudioSelectionLeaf[]; surfaceBundles: readonly SurfaceSourceBundle[] }> {
  const bundles = loadCatalogBundles();
  const surfaceApi = await agentModule("designer", "library-cli/surface-catalog.js");
  const evidenceApi = await agentModule("designer", "library-cli/surface-package-evidence.js");
  // Source evidence generation uses the real independent compiler through this port.
  // The production default consumes only authenticated source-built certificates.
  const nativeEvidence = sourceEvidence ?? await agentModule("designer", "library-cli/qualify-specimen-surfaces.js");
  const decisionsApi = await agentModule("designer", "library-cli/apply-decisions.js");
  const composite = stored && "values" in stored.library;
  const original = stored?.library;
  const freeze = report ? (finding: { message: string }) => report({ gate: 'LeafFreeze', blocking: false, state: 'reported', message: finding.message }) : undefined;
  const valuesCatalog = stored && "values" in stored.catalog ? stored.catalog.values : stored?.catalog ?? loadCatalog(freeze);
  const catalog: CompositeCatalogData = stored && "values" in stored.catalog ? { ...stored.catalog, surfaces: stored.catalog.surfaces ?? surfaceApi.foundrySurfaceCatalog(freeze) } : { values: valuesCatalog as any, components: { slots: loadComponentRegistry(freeze).slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() }, surfaces: surfaceApi.foundrySurfaceCatalog(freeze) };
  const source = original?.source ?? { id: "studio", kind: "consumer" as const, author: "consumer" as const, license: "MIT", extends: "foundry" };
  const authored: CompositeLibraryData = composite ? structuredClone(original as CompositeLibraryData) : { source, adoptedAt: original?.adoptedAt ?? "2026-10-29", values: { fills: (original as LibraryData | undefined)?.fills ?? [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  authored.surfaces ??= { version: 1, fills: [], files: [] };
  const own = new Map<string, any>([...authored.values.fills, ...authored.components.fills, ...authored.surfaces.fills].map(fill => [meta(fill).slot, fill]));
  let values: LibraryData = { ...authored.values, source: authored.source, adoptedAt: authored.adoptedAt };
  const absentValues = catalog.values.slots.filter(slot => slot.layer === "themes" || slot.id.startsWith("assets.icon-")).filter(slot => !values.fills.some(fill => meta(fill).slot === slot.id));
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
  // Native surface slots are the source of eligible specimen seats, not a second leaf list.
  const specimenIds = surfaceCatalog.slots.flatMap(slot => /^sections\.specimen-[a-z][a-z0-9-]*$/.test(slot.id) ? [slot.id] : []);
  const needed = new Set([...REQUIRED, ...await studioModuleRequirements(), ...specimenIds]);
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
  if (componentDecisions.length) {
    // A component default does not need a passing surface ceremony in Studio.
    const { surfaces, ...componentsOnly } = library;
    const current = report ? componentsOnly : library;
    const changed = applyLibraryChange(catalog, current, decisionsApi.decisionChangeSet(catalog, current, componentDecisions, bundles.sourceBundles), { surfaceOptions });
    library = report ? { ...changed, surfaces } : changed;
  }
  const base = { catalog, library, componentOptions: stored?.componentOptions, surfaceOptions };
  const environment = report
    ? await studioEvidence('specimen-certificates', () => nativeEvidence.specimenSurfaceEnvironment(base), () => ({ input: base, dependencies: [] as readonly SurfaceDependency[] }), report)
    : await nativeEvidence.specimenSurfaceEnvironment(base);
  const surfaceRequest = {
    slots: surfaceCatalog.slots.filter(slot => needed.has(slot.id) && !own.has(slot.id)).map(slot => slot.id), preference: DEFAULT_COMPONENT_PREFERENCE,
  };
  const preparedSurfaces = report
    ? await studioEvidence('S1-S8', () => prepareCatalogSurfaceDefaults(environment.input, surfaceRequest, environment.dependencies), () => ({ input: environment.input, surfaceBundles: [] as readonly SurfaceSourceBundle[], plan: planSurfaceDefaults({ ...surfaceRequest, catalog: surfaceCatalog }) }), report)
    : await prepareCatalogSurfaceDefaults(environment.input, surfaceRequest, environment.dependencies);
  const preparedCatalog = preparedSurfaces.input.catalog;
  const surfaceChanges = preparedSurfaces.plan.decisions.map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot, source: row.source } }));
  if (surfaceChanges.length) library = report
    ? await studioSurfaceDefaults({ ...preparedSurfaces.input, library }, surfaceChanges, preparedSurfaces.surfaceBundles, report)
    : applyLibraryChange(preparedCatalog, library, { baseHash: libraryHash(library), changes: surfaceChanges, surfaceBundles: preparedSurfaces.surfaceBundles }, { componentOptions: environment.input.componentOptions, surfaceOptions: environment.input.surfaceOptions });
  const effective = new Map<string, any>([...library.values.fills, ...library.components.fills, ...library.surfaces!.fills].map(fill => [meta(fill).slot, fill]));
  const leaves: StudioSelectionLeaf[] = [...needed].sort().map(leaf => {
    const fill = effective.get(leaf);
    const descriptor: any = fill ? Object.values(fill.components ?? fill.sections ?? fill.frames ?? {})[0] : undefined;
    const selectedFill = descriptor?.origin?.fill ?? descriptor?.origin?.base?.fill ?? (fill ? meta(fill).id : undefined);
    return { leaf, source: own.has(leaf) ? "consumer" : fill ? "fallback" : "unavailable", ...(fill ? { fill: selectedFill } : {}), ...(!own.has(leaf) ? { message: fill ? report ? "Using the planned Studio default fill" : "NEED: not selected by this consumer; using a planned default fill" : "NEED: no eligible default fill" } : {}) };
  });
  const selected = { ...preparedSurfaces.input, library };
  const qualified = report ? await studioEvidence('specimen-certificates', () => nativeEvidence.qualifySpecimenSurfaces(selected), () => selected, report) : await nativeEvidence.qualifySpecimenSurfaces(selected);
  return { input: qualified, leaves, surfaceBundles: preparedSurfaces.surfaceBundles };
}
