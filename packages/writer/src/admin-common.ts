import source from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";
import type { AdminRouteCopy } from "./admin-route-copy.js";

/** Shared canonical drafts; legacy ID lookup belongs to the authoritative alias reader. */
export const ADMIN_COMMON_COPY_EN: AdminRouteCopy = freezeAdminCopy(source as AdminRouteCopy);
export function getAdminCommonCopyRecord(id: string): DeepReadonly<import("./model/types.js").StringRecord> | undefined {
  return ADMIN_COMMON_COPY_EN.records.find(record => record.id === id);
}
