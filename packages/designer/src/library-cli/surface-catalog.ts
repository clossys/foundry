/**
 * Foundry's own Section and Frame contracts and candidates, as the composite surface catalog.
 *
 * The disk boundary and the CLI use the same catalog: hosts that pass a composite catalog without a
 * `surfaces` portion still read, check and save libraries that adopted Sections or Frames, because the
 * only contracts those fills can name are the ones this package ships.
 */
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, loadSectionRegistry, loadFoundrySurfaceHistory } from "../catalog-core/index.js";
import type { SurfaceCandidateDocument, SurfaceCatalog } from "../catalog-core/surface-types.js";
import type { FrameSlot } from "../catalog-core/types.js";

let cached: SurfaceCatalog | undefined;
export function foundrySurfaceCatalog(): SurfaceCatalog {
  cached ??= Object.freeze({
    slots: [...loadSectionRegistry().slots, ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames")],
    fills: [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as SurfaceCandidateDocument[],
    transforms: [], rules: [], materializations: [],
    packageHistory: loadFoundrySurfaceHistory(),
  });
  return cached;
}
