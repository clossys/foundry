/** Public access to the existing English Voice record; its draft state is retained. */
import source from "./catalog/records/admin-voice.r1.en.json" with { type: "json" };

import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";

/** The complete shipped envelope, including its original review evidence. */
export type AdminVoiceCopy = DeepReadonly<typeof source>;
/** One unchanged Voice string record, addressed by its existing opaque id. */
export type AdminVoiceCopyRecord = AdminVoiceCopy["records"][number];

/** Package access does not approve or activate these records. */
export const ADMIN_VOICE_COPY_EN: AdminVoiceCopy = freezeAdminCopy(source);

/** Read a record for host-owned Writer binding; unknown ids have no fallback. */
export function getAdminVoiceCopyRecord(id: string): AdminVoiceCopyRecord | undefined {
  return ADMIN_VOICE_COPY_EN.records.find(record => record.id === id);
}
