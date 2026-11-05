import { buildSurfaceConsumption, type SurfaceConsumptionMeasurement } from "../../surface-consumption.js";
import { sha256 } from "../../digest.js";
import type { SurfacePackageEvidence } from "../../surface-types.js";

/**
 * SYNTHETIC @example/surface-kit@1.0.0 artifact. Its source consumption is measured by the same scanner as
 * Foundry's generated package measurements, so the S8 check runs against an observation, not an exemption.
 */
export const READER_SOURCE = { path: "frames/Reader.tsx", content: "export function Reader({ children }: { children?: React.ReactNode }) {\n  return <div>{children}</div>;\n}\n" };

export function measuredReader(): SurfaceConsumptionMeasurement {
  const fill = "example/frames.reader";
  const row = buildSurfaceConsumption({
    themes: [], assets: [], components: [], sections: [], themeCss: "",
    frames: [{ id: "frames.reader", contract: { allowedReads: { themes: [], assets: [] }, composes: [] } }],
    fills: [{ id: fill, slot: "frames.reader", source: "example" }],
    sourceScans: [{ fill, files: [READER_SOURCE] }],
  }).fills[0]!;
  if (row.scanStatus !== "lower-bound") throw new Error("example Reader measurement unavailable");
  return { scanStatus: row.scanStatus, sourceFiles: [{ path: READER_SOURCE.path, sha256: sha256(READER_SOURCE.content) }], scannedReads: row.scannedReads, scannedComposes: row.scannedComposes };
}

/** Installed-artifact evidence for the synthetic kit, carrying the measured Reader consumption. */
export function exampleSurfaceKitEvidence(): SurfacePackageEvidence {
  return { module: "@example/surface-kit/frames", version: "1.0.0", artifactSha256: "a".repeat(64), values: ["Reader"], types: [], consumption: { Reader: measuredReader() } };
}

/** The descriptor's derived fields, equal to the measurement (reads and composes are never authored). */
export function measuredReaderFields() {
  const consumption = measuredReader();
  return { reads: { themes: [...consumption.scannedReads.themes], assets: [...consumption.scannedReads.assets] }, composes: [...consumption.scannedComposes], consumption };
}
