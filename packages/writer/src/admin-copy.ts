/** Complete English admin copy; importing a draft does not approve or activate it. */
import { ADMIN_STUDIO_COPY_EN, type AdminStudioCopy, type AdminStudioCopyRecord } from "./admin-studio.js";
import { ADMIN_VOICE_COPY_EN, type AdminVoiceCopy, type AdminVoiceCopyRecord } from "./admin-voice.js";
import { ADMIN_META_COPY_EN, type AdminMetaCopy, type AdminMetaCopyRecord } from "./admin-meta.js";
import { ADMIN_WRITER_COPY_EN, type AdminRouteCopy } from "./admin-route-copy.js";
import { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
import common from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import { freezeAdminCopy } from "./admin-copy-core.js";
export { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
import { IntlMessageFormat } from "intl-messageformat";
export { ADMIN_WRITER_COPY_EN } from "./admin-route-copy.js";
export type { AdminRouteCopy } from "./admin-route-copy.js";

export const ADMIN_COMMON_COPY_EN = freezeAdminCopy(common);
export type AdminCopyEnvelope = AdminStudioCopy | AdminVoiceCopy | AdminMetaCopy | AdminRouteCopy | typeof ADMIN_COMMON_COPY_EN;
export type AdminCopyRecord = AdminStudioCopyRecord | AdminVoiceCopyRecord | AdminMetaCopyRecord | AdminRouteCopy["records"][number] | typeof ADMIN_COMMON_COPY_EN["records"][number];

/** Original envelopes retain their evidence; records are addressed once per id. */
export interface AdminCopy {
  readonly envelopes: readonly AdminCopyEnvelope[];
  readonly records: readonly AdminCopyRecord[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

/** Equal duplicate records collapse; conflicting content never silently wins. */
export function createAdminCopy(envelopes: readonly AdminCopyEnvelope[]): AdminCopy {
  const records = new Map<string, AdminCopyRecord>();
  for (const envelope of envelopes) {
    for (const record of envelope.records) {
      const existing = records.get(record.id);
      if (existing && JSON.stringify(canonical(existing)) !== JSON.stringify(canonical(record))) {
        throw new Error(`Conflicting admin copy record: ${record.id}`);
      }
      if (!existing) records.set(record.id, record);
    }
  }
  return Object.freeze({ envelopes: Object.freeze([...envelopes]), records: Object.freeze([...records.values()]) });
}

export const ADMIN_COPY_EN: AdminCopy = createAdminCopy([ADMIN_STUDIO_COPY_EN, ADMIN_VOICE_COPY_EN, ADMIN_META_COPY_EN, ADMIN_WRITER_COPY_EN, ADMIN_CHAT_COPY_EN, ADMIN_COMMON_COPY_EN]);

/** Read the complete source without manufacturing approval or activation evidence. */
export function getAdminCopy(): AdminCopy {
  return ADMIN_COPY_EN;
}

/** Unknown ids have no fallback; the host owns Writer binding and presentation. */
export function getAdminCopyRecord(id: string, copy: AdminCopy = ADMIN_COPY_EN): AdminCopyRecord | undefined {
  return copy.records.find(record => record.id === id);
}

export interface AdminCopyRef {
  readonly id: string;
  readonly locale?: string;
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}
/** Explicit draft-review display, separate from approved production resolution.
 * Missing records, unsupported locales and invalid ICU arguments remain Needs. */
export function resolveAdminCopyRef(ref: AdminCopyRef, copy: AdminCopy = ADMIN_COPY_EN) {
  if (ref.locale !== undefined && ref.locale !== "en") return undefined;
  const record = getAdminCopyRecord(ref.id, copy);
  if (!record || record.status === "retired") return undefined;
  try {
    const formatted = new IntlMessageFormat(record.text, "en").format(ref.values);
    if (typeof formatted !== "string" || !formatted.trim()) return undefined;
    return { ref: { ...ref, locale: "en" }, text: formatted, servedLocale: "en" as const, status: record.status, activation: "none" as const };
  } catch { return undefined; }
}
