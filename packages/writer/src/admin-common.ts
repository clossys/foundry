import source from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import signIn from "./catalog/records/sign-in.json" with { type: "json" };
import paging from "./catalog/records/admin-writer-paging.r1.en.json" with { type: "json" };
import studio from "./catalog/records/admin-studio.r1.en.json" with { type: "json" };
import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";
import type { StringRecord } from "./model/types.js";

type CommonCopy = Omit<typeof source, "records" | "externalRecords" | "bindings"> & {
  records: readonly StringRecord[];
  bindings: readonly typeof studio.bindings[number][];
};

/** A shared record keeps Studio item-name authority only when its current
 * owner, original usage and retained Studio binding all identify that item. */
export const COMMON_STUDIO_ITEM_NAMES = freezeAdminCopy(studio.externalRecords.filter(declaration =>
  declaration.source === "common-labels.r1.en.json" && declaration.sourceContext.startsWith("designer.item.")
).map(declaration => {
  const records = source.records.filter(record => record.id === declaration.recordId);
  const record = records[0];
  const usages = source.usages.filter(usage => usage.recordId === declaration.recordId
    && usage.legacyRecordId === declaration.recordId && usage.source === "records/admin-studio.r1.en.json"
    && usage.leaf === "strings.names" && usage.context === declaration.sourceContext);
  const bindings = studio.bindings.filter(binding => binding.recordId === declaration.recordId);
  const binding = bindings[0];
  if (records.length !== 1 || !record || record.leaf !== "strings.common" || record.context !== declaration.sourceContext
    || usages.length !== 1 || bindings.length !== 1 || !binding || binding.kind !== "item-name" || binding.cellId !== record.context) {
    throw new Error(`Invalid shared Studio item name: ${declaration.recordId}`);
  }
  return { record, binding };
}));

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
export const ADMIN_COMMON_COPY_EN: DeepReadonly<CommonCopy> = freezeAdminCopy({ ...local,
  records: [...source.records, ...shared].sort((a, b) => a.id.localeCompare(b.id)),
  bindings: [...source.bindings, ...COMMON_STUDIO_ITEM_NAMES.map(({ binding }) => binding)],
} as CommonCopy);
export function getAdminCommonCopyRecord(id: string): DeepReadonly<import("./model/types.js").StringRecord> | undefined {
  return ADMIN_COMMON_COPY_EN.records.find(record => record.id === id);
}
