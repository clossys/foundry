/** Authentic upstream package descriptors and contracts, retained across catalog revisions. */
import packageHistory from "../catalog/surface-package-history.json" with { type: "json" };
import { runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import type { SurfaceCatalog } from "../catalog-core/surface-types.js";

/** Each read returns a deeply frozen copy; callers cannot change future historical lookups. */
export function loadFoundrySurfaceHistory(): NonNullable<SurfaceCatalog["packageHistory"]> {
  return runtimeSnapshot(packageHistory.descriptors) as unknown as NonNullable<SurfaceCatalog["packageHistory"]>;
}
