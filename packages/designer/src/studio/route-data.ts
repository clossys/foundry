import { libraryHash, loadBuildCatalog, resolve, runtimeHash, runtimeSnapshot } from "../catalog-core/index.js";
import type { BuildCatalogData, CompositeCatalogData, CompositeResolved, ConsumerRuntimeManifest, RuntimeContent, RuntimeFillSelection, RuntimeCell, SurfaceCatalog } from "../catalog-core/index.js";
import type { DesignerAgentData } from "./system-canvas/inspector/types.js";
import type { FramePageHeader } from "../frame-page-header.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { checkWholeStudioInitialSession } from "./initial-session.js";
import type { WholeStudioInitialSession, WholeStudioInitialSnapshot } from "./initial-session.js";

/** Surface executable rules cannot be transported as JSON. A route catalog uses
 * finite installed candidates; a consumer with executable rules must retain its
 * existing local provider until those rules have a package-owned implementation. */
export type RouteCatalogData = Omit<CompositeCatalogData, "surfaces"> & {
  readonly surfaces?: Omit<SurfaceCatalog, "transforms" | "rules">;
};
export interface NativeRouteFrameData {
  readonly manifest: ConsumerRuntimeManifest;
  readonly cell: RuntimeCell;
  readonly frame: RuntimeFillSelection;
  readonly contents: readonly RuntimeContent[];
  readonly header: { readonly id: string; readonly data: Omit<FramePageHeader, "actions">; readonly brand?: { readonly href: string; readonly label: string } };
}
export interface DesignerRouteServerData extends NativeRouteFrameData {
  readonly catalog: RouteCatalogData;
  readonly contracts?: BuildCatalogData;
  readonly snapshot: WholeStudioInitialSnapshot;
  readonly initialSlotId?: string;
}
export interface DesignerRoutePageProps extends DesignerAgentData {
  /** Supplied by the client host; executable copy resolution is never serialized in serverData. */
  readonly copy: import("./copy-binding.js").StudioCopyBinding;
  readonly serverData: DesignerRouteServerData;
  readonly initialSession: WholeStudioInitialSession | undefined;
}
export function routeCatalog(data: RouteCatalogData): CompositeCatalogData {
  if (data.surfaces && (Object.hasOwn(data.surfaces, "transforms") || Object.hasOwn(data.surfaces, "rules"))) throw new TypeError("Finite route catalog cannot contain executable rule containers");
  const { surfaces, ...base } = data;
  return { ...base, ...(surfaces ? { surfaces: { ...surfaces, transforms: [], rules: [] } } : {}) };
}
/** Server-safe finite producer; it carries no source, materialization or lifecycle receipt. */
export function designerRouteServerData(input: Omit<DesignerRouteServerData, "catalog"> & { readonly catalog: CompositeCatalogData }): DesignerRouteServerData {
  if (input.catalog.surfaces && (input.catalog.surfaces.transforms.length || input.catalog.surfaces.rules.length)) throw new TypeError("Route catalog executable surface rules require a local package implementation");
  const { catalog, ...facts } = input;
  const { surfaces, ...base } = catalog;
  if (!surfaces) return runtimeSnapshot({ ...facts, catalog: base });
  const { transforms: _transforms, rules: _rules, ...finite } = surfaces;
  return runtimeSnapshot({ ...facts, catalog: { ...base, surfaces: finite } });
}
/** Reconstruct only the finite catalog, then use the original session checker. */
export function checkedDesignerRouteData(data: DesignerRouteServerData, initialSession: WholeStudioInitialSession) {
  const finite = runtimeSnapshot(data), catalog = routeCatalog(finite.catalog), contracts = finite.contracts ?? loadBuildCatalog();
  checkWholeStudioInitialSession(initialSession, catalog, contracts, finite.snapshot);
  const engine = { catalog, library: finite.snapshot.library, componentOptions: finite.snapshot.componentOptions, surfaceOptions: finite.snapshot.surfaceOptions };
  const profile = resolve(engine);
  if (finite.manifest.consumer !== profile.consumer || finite.manifest.libraryHash !== libraryHash(engine.library) || finite.manifest.selectionHash !== profile.selectionHash) throw new TypeError("Route manifest differs from the initial library and selection");
  if (!finite.cell || !finite.cell.theme?.trim() || !finite.cell.state?.trim() || !Number.isFinite(finite.cell.width) || finite.cell.width <= 0) throw new TypeError("Explicit selected route display cell required");
  const selected = profile.surfaces?.fills[finite.frame.leaf];
  const descriptors = finite.manifest.fills.filter(fill => fill.kind === "frame" && fill.leaf === finite.frame.leaf && fill.fill === finite.frame.fill && fill.config === finite.frame.config && fill.library === profile.consumer);
  if (!selected || descriptors.length !== 1 || selected.document.$extensions["com.clossys.fill"].id !== finite.frame.fill || runtimeHash(descriptors[0]!.surface) !== runtimeHash(surfaceRuntimeIdentity(selected))) throw new TypeError("Route frame differs from the current selected surface");
  const axes = finite.frame.members.map(member => member.split(".")[0]);
  if (new Set(axes).size !== axes.length || finite.frame.members.some(member => !descriptors[0]!.members.includes(member))) throw new TypeError("Route frame members differ from its selected descriptor");
  return { data: finite, catalog, contracts, profile };
}
