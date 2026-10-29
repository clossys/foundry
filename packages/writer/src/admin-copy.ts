/** Complete English admin copy; importing a draft does not approve or activate it. */
import { ADMIN_STUDIO_COPY_EN, type AdminStudioCopy, type AdminStudioCopyRecord } from "./admin-studio.js";
import { ADMIN_VOICE_COPY_EN, type AdminVoiceCopy, type AdminVoiceCopyRecord } from "./admin-voice.js";
import { ADMIN_META_COPY_EN, type AdminMetaCopy, type AdminMetaCopyRecord } from "./admin-meta.js";
import { ADMIN_WRITER_COPY_EN, type AdminRouteCopy } from "./admin-route-copy.js";
import { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
import { ADMIN_COMMON_COPY_EN } from "./admin-common.js";
export { ADMIN_COMMON_COPY_EN } from "./admin-common.js";
export { ADMIN_CHAT_COPY_EN } from "./admin-chat.js";
export { ADMIN_PAGES_COPY_EN } from "./admin-pages.js";
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

const designerItemNames = new Map<string, AdminCopyRecord>([
  ...ADMIN_STUDIO_COPY_EN.records.filter(record => record.leaf === "strings.names" && record.context.startsWith("designer.item.")),
  ...ADMIN_COMMON_COPY_EN.records.filter(record => record.leaf === "strings.common" && record.context.startsWith("designer.item.")),
].map(record => [record.id, record]));

/** Authenticate an item name against the shipped Writer source binding.
 * A context-shaped string alone grants no authority to name a Designer item. */
export function getAdminItemNameBinding(id: string, copy: AdminCopy = ADMIN_COPY_EN): AdminItemNameBinding | undefined {
  const canonicalRecord = designerItemNames.get(id);
  const record = getAdminCopyRecord(id, copy);
  if (!canonicalRecord || !record || record.leaf !== canonicalRecord.leaf || record.context !== canonicalRecord.context) return undefined;
  const commonOwned = canonicalRecord.leaf === "strings.common";
  const canonicalBindings = ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.recordId === id && (!commonOwned || binding.kind === "item-name"));
  const canonicalBinding = canonicalBindings[0];
  if (canonicalBindings.length !== 1 || !canonicalBinding || canonicalBinding.kind !== "item-name" || canonicalBinding.cellId !== canonicalRecord.context) return undefined;
  const envelopes = copy.envelopes.filter(envelope => envelope.records.some(row => row.id === id));
  if (commonOwned) {
    const declarations = ADMIN_STUDIO_COPY_EN.externalRecords.filter(row => row.recordId === id);
    const declaration = declarations[0];
    if (declarations.length !== 1 || !declaration || declaration.source !== "common-labels.r1.en.json" || declaration.sourceContext !== canonicalRecord.context
      || !ADMIN_COMMON_COPY_EN.usages.some(row => row.recordId === id && row.context === canonicalRecord.context && row.leaf === "strings.names" && row.source === "records/admin-studio.r1.en.json")) return undefined;
    // The common owner retains the record; Studio retains its original binding.
    if (!envelopes.length || envelopes.some(envelope => !("bindings" in envelope) || envelope.bindings.some(binding => binding.recordId === id))) return undefined;
    const carriers = copy.envelopes.filter(envelope => "bindings" in envelope && envelope.bindings.some(binding => binding.recordId === id && (binding.kind === "item-name" || binding.cellId === canonicalRecord.context)));
    const carrier = carriers[0];
    if (carriers.length !== 1 || !carrier || !("bindings" in carrier) || !("externalRecords" in carrier) || !Array.isArray(carrier.externalRecords)) return undefined;
    const suppliedDeclarations = carrier.externalRecords.filter(row => row.recordId === id);
    if (suppliedDeclarations.length !== 1 || !suppliedDeclarations.every(row => row.source === declaration.source && row.sourceContext === declaration.sourceContext)) return undefined;
    const bindings = carrier.bindings.filter(binding => binding.recordId === id && (binding.kind === "item-name" || binding.cellId === canonicalRecord.context));
    if (bindings.length !== 1 || !bindings.every(binding => binding.kind === canonicalBinding.kind && binding.cellId === canonicalBinding.cellId && binding.target === canonicalBinding.target)) return undefined;
    return { ...canonicalBinding, kind: "item-name" };
  }
  if (!envelopes.length || envelopes.some(envelope => {
    if (!("bindings" in envelope)) return true;
    const bindings = envelope.bindings.filter(binding => binding.recordId === id);
    return bindings.length !== 1 || !bindings.every(binding => binding.kind === canonicalBinding.kind && binding.cellId === canonicalBinding.cellId && binding.target === canonicalBinding.target);
  })) return undefined;
  return { ...canonicalBinding, kind: "item-name" };
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
  if ((designerItemNames.has(ref.id) || record.context.startsWith("designer.item.")) && !getAdminItemNameBinding(ref.id, copy)) return undefined;
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
