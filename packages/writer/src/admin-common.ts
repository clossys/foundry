import source from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import signIn from "./catalog/records/sign-in.json" with { type: "json" };
import paging from "./catalog/records/admin-writer-paging.r1.en.json" with { type: "json" };
import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";
import type { StringRecord } from "./model/types.js";

type CommonCopy = Omit<typeof source, "records" | "externalRecords"> & { records: readonly StringRecord[] };

/** Shared canonical drafts from the owners validated by the native record gate. */
const owners = new Map<string, { locale: string; records: readonly StringRecord[] }>([
  ["sign-in.json", { locale: "en", records: signIn.locales.en.records.filter(record => "text" in record) as StringRecord[] }],
  ["admin-writer-paging.r1.en.json", { locale: paging.locale, records: paging.records as StringRecord[] }],
]);
const shared = source.externalRecords.map(declaration => {
  const owner = owners.get(declaration.source);
  const matches = owner?.locale === source.locale ? owner.records.filter(record => record.id === declaration.recordId) : [];
  const record = matches[0];
  if (matches.length !== 1 || !record || record.context !== declaration.sourceContext || record.leaf !== "strings.common") {
    throw new Error(`Invalid common copy source: ${declaration.recordId}`);
  }
  return record;
});
// Keep the existing complete common facade; the raw sources retain one owner per id.
const { externalRecords: _declarations, ...local } = source;
export const ADMIN_COMMON_COPY_EN: DeepReadonly<CommonCopy> = freezeAdminCopy({ ...local, records: [...source.records, ...shared].sort((a, b) => a.id.localeCompare(b.id)) } as CommonCopy);
export function getAdminCommonCopyRecord(id: string): DeepReadonly<import("./model/types.js").StringRecord> | undefined {
  return ADMIN_COMMON_COPY_EN.records.find(record => record.id === id);
}
