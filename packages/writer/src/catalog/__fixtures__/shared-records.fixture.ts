import common from "../records/common-labels.r1.en.json" with { type: "json" };
import type { WriterRecord } from "../../model/types.js";

/** Producer contract fixture: only explicitly declared common sources are added.
 * Production consumers must supply the same source; no legacy ID fallback occurs.
 */
export function withDeclaredCommonRecords(...envelopes: readonly { records: readonly unknown[]; externalRecords?: readonly { recordId: string; source: string; sourceContext: string }[] }[]): WriterRecord[] {
  const shared = new Map<string, WriterRecord>();
  for (const envelope of envelopes) for (const declaration of envelope.externalRecords ?? []) {
    if (declaration.source !== "common-labels.r1.en.json") throw new Error(`Unexpected fixture source: ${declaration.source}`);
    const record = common.records.find(row => row.id === declaration.recordId);
    if (!record || record.context !== declaration.sourceContext) throw new Error(`Missing declared common record: ${declaration.recordId}`);
    shared.set(record.id, record as WriterRecord);
  }
  const local = envelopes.flatMap(envelope => envelope.records) as WriterRecord[];
  if (local.some(record => shared.has(record.id))) throw new Error("Shared source shadows a local record");
  return [...local, ...shared.values()];
}
