import type { DirectorStoreWriter } from "../store-io.js";

export const REPORT_CAPABILITIES = ["cell-quality", "coherence", "completion", "wont-claim", "review"] as const;
export type ReportCapability = typeof REPORT_CAPABILITIES[number];

/** CLI-only persistence through the injected store writer. Pure checks return the same object saved here. */
export function persistReport(root: string, writer: DirectorStoreWriter, capability: ReportCapability, report: unknown): void {
  if (!REPORT_CAPABILITIES.includes(capability)) throw new Error("Unknown report capability");
  writer.replace(root, `reports/${capability}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
