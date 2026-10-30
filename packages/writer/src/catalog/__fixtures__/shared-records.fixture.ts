import common from "../records/common-labels.r1.en.json" with { type: "json" };
import signIn from "../records/sign-in.json" with { type: "json" };
import paging from "../records/admin-writer-paging.r1.en.json" with { type: "json" };
import type { WriterRecord } from "../../model/types.js";

/** Producer contract fixture: only explicitly declared common sources are added.
 * Production consumers must supply the same source; no legacy ID fallback occurs.
 */
export function withDeclaredCommonRecords(...envelopes: readonly { records: readonly unknown[]; externalRecords?: readonly { recordId: string; source: string; sourceContext: string }[] }[]): WriterRecord[] {
  const sources = new Map<string, readonly WriterRecord[]>([
    ["common-labels.r1.en.json", common.records as WriterRecord[]],
    ["sign-in.json", signIn.locales.en.records as WriterRecord[]],
    ["admin-writer-paging.r1.en.json", paging.records as WriterRecord[]],
  ]);
  const shared = new Map<string, WriterRecord>();
  for (const envelope of envelopes) for (const declaration of envelope.externalRecords ?? []) {
    const records = sources.get(declaration.source);
    if (!records) throw new Error(`Unexpected fixture source: ${declaration.source}`);
    const record = records.find(row => row.id === declaration.recordId);
    if (!record || record.context !== declaration.sourceContext) throw new Error(`Missing declared common record: ${declaration.recordId}`);
    shared.set(record.id, record as WriterRecord);
  }
  const local = envelopes.flatMap(envelope => envelope.records) as WriterRecord[];
  if (local.some(record => shared.has(record.id))) throw new Error("Shared source shadows a local record");
  return [...local, ...shared.values()];
}
