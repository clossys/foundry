/** Generated source observations; no filesystem access enters the browser catalog. */
import measurements from "../catalog/surface-consumption.data.json" with { type: "json" };
import type { SurfaceConsumptionMeasurement } from "../catalog-core/surface-consumption.js";
import type { SurfacePackagePin } from "../catalog-core/surface-types.js";

export interface FoundrySurfaceConsumption {
  reads: { tokens: readonly string[]; assets: readonly string[] };
  composes: readonly string[];
  consumption: SurfaceConsumptionMeasurement;
}

/** Independent package facts. A caller's descriptor snapshot never supplies actual use. */
export function canonicalSurfaceConsumption(slot: string, impl: { kind: string; module?: string; export?: string }, pin?: unknown): SurfaceConsumptionMeasurement | undefined {
  const row = (measurements as unknown as Record<string, { pin: SurfacePackagePin; consumption: SurfaceConsumptionMeasurement }>)[slot];
  if (!row || impl.kind !== "package") return undefined;
  const [subpath, name] = row.pin.export.slice(2).split("#");
  if (impl.module !== `${row.pin.package}/${subpath}` || impl.export !== name) return undefined;
  if (pin !== undefined && (!pin || typeof pin !== "object" || (pin as SurfacePackagePin).package !== row.pin.package || (pin as SurfacePackagePin).version !== row.pin.version || (pin as SurfacePackagePin).export !== row.pin.export)) return undefined;
  return structuredClone(row.consumption);
}

export function measuredSurfaceConsumption(slot: string, pin: SurfacePackagePin): FoundrySurfaceConsumption {
  const row = (measurements as unknown as Record<string, { pin: SurfacePackagePin; consumption: SurfaceConsumptionMeasurement }>)[slot];
  if (!row || row.pin.package !== pin.package || row.pin.version !== pin.version || row.pin.export !== pin.export || row.consumption.scanStatus !== "lower-bound" || !row.consumption.sourceFiles.length)
    throw new Error(`surface consumption measurement unavailable for ${slot}`);
  return { reads: { tokens: [...row.consumption.scannedReads.tokens], assets: [...row.consumption.scannedReads.assets] }, composes: [...row.consumption.scannedComposes], consumption: structuredClone(row.consumption) };
}
