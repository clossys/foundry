/** Complete English admin copy; importing a draft does not approve or activate it. */
import { ADMIN_STUDIO_COPY_EN, type AdminStudioCopy, type AdminStudioCopyRecord } from "./admin-studio.js";
import { ADMIN_VOICE_COPY_EN, type AdminVoiceCopy, type AdminVoiceCopyRecord } from "./admin-voice.js";
import { ADMIN_META_COPY_EN, type AdminMetaCopy, type AdminMetaCopyRecord } from "./admin-meta.js";
import { ADMIN_WRITER_COPY_EN, type AdminRouteCopy } from "./admin-route-copy.js";
import { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
import { ADMIN_COMMON_COPY_EN } from "./admin-common.js";
export { ADMIN_COMMON_COPY_EN } from "./admin-common.js";
export { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
import { createCopyResolver, type CopyResolveOptions } from "./resolve.js";
export { ADMIN_WRITER_COPY_EN } from "./admin-route-copy.js";
export type { AdminRouteCopy } from "./admin-route-copy.js";

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

export interface AdminItemNameBinding {
  readonly cellId: string;
  readonly recordId: string;
  readonly target: string;
  readonly kind: "item-name";
}

const itemNames = new Map(ADMIN_STUDIO_COPY_EN.records.filter(record =>
  record.leaf === "strings.names" && (record.context.startsWith("designer.item.") || record.context.startsWith("director.item."))
).map(record => [record.id, record]));

/** Authenticate an item name against the shipped Writer source binding.
 * A context-shaped string alone grants no authority to name an item. */
export function getAdminItemNameBinding(id: string, copy: AdminCopy = ADMIN_COPY_EN): AdminItemNameBinding | undefined {
  const canonicalRecord = itemNames.get(id);
  const record = getAdminCopyRecord(id, copy);
  if (!canonicalRecord || !record || record.leaf !== canonicalRecord.leaf || record.context !== canonicalRecord.context) return undefined;
  const canonicalBindings = ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.recordId === id);
  const canonicalBinding = canonicalBindings[0];
  if (canonicalBindings.length !== 1 || !canonicalBinding || canonicalBinding.kind !== "item-name" || canonicalBinding.cellId !== canonicalRecord.context) return undefined;
  const directorTitle = canonicalRecord.context.startsWith("director.item.");
  if (directorTitle && (record.text !== canonicalRecord.text || !("role" in canonicalBinding) || canonicalBinding.role !== "heading"
    || !("sourceCellId" in canonicalBinding) || canonicalRecord.context !== `director.item.${canonicalBinding.sourceCellId}`)) return undefined;
  const envelopes = copy.envelopes.filter(envelope => envelope.records.some(row => row.id === id));
  if (!envelopes.length || envelopes.some(envelope => {
    if (!("bindings" in envelope)) return true;
    const bindings = envelope.bindings.filter(binding => binding.recordId === id);
    return bindings.length !== 1 || !bindings.every(binding => binding.kind === canonicalBinding.kind && binding.cellId === canonicalBinding.cellId && binding.target === canonicalBinding.target
      && (!directorTitle || "role" in binding && binding.role === "heading" && "sourceCellId" in binding && "sourceCellId" in canonicalBinding && binding.sourceCellId === canonicalBinding.sourceCellId));
  })) return undefined;
  return { ...canonicalBinding, kind: "item-name" };
}

/** Director card titles are headings; an action or link binding cannot name one. */
export interface AdminDirectorCellTitleBinding extends AdminItemNameBinding {
  readonly sourceCellId: string;
  readonly role: "heading";
}

/** Address the authored title by its exact public Director cell identity. */
export function getAdminDirectorCellTitleBinding(cellId: string, copy: AdminCopy = ADMIN_COPY_EN): AdminDirectorCellTitleBinding | undefined {
  const candidates = ADMIN_STUDIO_COPY_EN.bindings.filter(binding => "sourceCellId" in binding && binding.sourceCellId === cellId);
  const canonicalBinding = candidates[0];
  if (candidates.length !== 1 || !canonicalBinding || !("role" in canonicalBinding) || canonicalBinding.role !== "heading"
    || canonicalBinding.cellId !== `director.item.${cellId}` || !getAdminItemNameBinding(canonicalBinding.recordId, copy)) return undefined;
  return { ...canonicalBinding, kind: "item-name", sourceCellId: cellId, role: "heading" };
}

/** Resolve the bound heading through the same locale, ICU and approval policy. */
export function resolveAdminDirectorCellTitle(cellId: string, copy: AdminCopy = ADMIN_COPY_EN, options: AdminCopyResolveOptions = {}) {
  const binding = getAdminDirectorCellTitleBinding(cellId, copy);
  if (!binding) return undefined;
  const ref: AdminCopyRef = { id: binding.recordId };
  const resolved = resolveAdminCopyRef(ref, copy, options);
  return resolved ? { ...resolved, ref, binding, role: binding.role } : undefined;
}
/** Admin resolution shares the production approval policy; drafts require explicit preview. */
export type AdminCopyResolveOptions = Pick<CopyResolveOptions, "target" | "now" | "timeZone" | "approvalPlan" | "acceptDelegateInProduction">;

/** Missing records, unsupported locales and invalid ICU arguments remain Needs.
 * Omitted options retain the shared resolver's safe production default. */
export function resolveAdminCopyRef(ref: AdminCopyRef, copy: AdminCopy = ADMIN_COPY_EN, options: AdminCopyResolveOptions = {}) {
  if (ref.locale !== undefined && ref.locale !== "en") return undefined;
  const record = getAdminCopyRecord(ref.id, copy);
  const envelope = copy.envelopes.find(envelope => envelope.records.some(row => row.id === ref.id));
  if (!record || !envelope || envelope.locale !== "en") return undefined;
  if ((itemNames.has(ref.id) || record.context.startsWith("designer.item.") || record.context.startsWith("director.item.")) && !getAdminItemNameBinding(ref.id, copy)) return undefined;
  const resolve = createCopyResolver({
    id: "admin-copy",
    locale: envelope.locale,
    revision: String(envelope.revision),
    source: { kind: "generated", reference: "writer/admin-copy" },
    entries: [{ ...record, placeholders: "args" in record ? record.args?.map(arg => arg.name) : undefined }],
  }, { ...options, target: options.target ?? "production" });
  const resolution = resolve({ ...ref, locale: "en" });
  if (!resolution || !resolution.text.trim()) return undefined;
  return { ...resolution, servedLocale: "en" as const, status: record.status, activation: "none" as const };
}
