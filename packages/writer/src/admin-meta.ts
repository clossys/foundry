/** Public access to the existing English Meta record; its draft state is retained. */
import source from "./catalog/records/admin-meta.r1.en.json" with { type: "json" };

import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";

/** The complete shipped envelope, including bindings and review evidence. */
export type AdminMetaCopy = DeepReadonly<typeof source>;
/** One unchanged Meta string record, addressed by its existing opaque id. */
export type AdminMetaCopyRecord = AdminMetaCopy["records"][number];

/** Package access does not approve or activate these records. */
export const ADMIN_META_COPY_EN: AdminMetaCopy = freezeAdminCopy(source);

/** Read a record for host-owned Writer binding; unknown ids have no fallback. */
export function getAdminMetaCopyRecord(id: string): AdminMetaCopyRecord | undefined {
  return ADMIN_META_COPY_EN.records.find(record => record.id === id);
}
