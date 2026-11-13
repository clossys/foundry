/** Public access to the existing English Studio record; its draft state is retained. */
import source from "./catalog/records/admin-studio.r1.en.json" with { type: "json" };

import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";

/** The complete shipped envelope, including bindings and review evidence. */
export type AdminStudioCopy = DeepReadonly<typeof source>;
/** One unchanged Studio string record, addressed by its existing opaque id. */
export type AdminStudioCopyRecord = AdminStudioCopy["records"][number];

/** Package access does not approve or activate these records. */
export const ADMIN_STUDIO_COPY_EN: AdminStudioCopy = freezeAdminCopy(source);

/** Read a record for host-owned Writer binding; unknown ids have no fallback. */
export function getAdminStudioCopyRecord(id: string): AdminStudioCopyRecord | undefined {
  return ADMIN_STUDIO_COPY_EN.records.find(record => record.id === id);
}
