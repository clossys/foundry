import commonSource from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import pageSource from "./catalog/records/admin-pages.r1.en.json" with { type: "json" };
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

const designerItemNames = new Map(ADMIN_STUDIO_COPY_EN.records.filter(record =>
  record.leaf === "strings.names" && record.context.startsWith("designer.item.")
).map(record => [record.id, record]));

const commonItemIds = new Set(commonSource.records.filter(record =>
  record.context.startsWith("designer.item.")
).map(record => record.id));

interface ExternalDeclaration { readonly recordId: string; readonly source: string; readonly sourceContext: string }
function declarations(envelope: AdminCopyEnvelope): readonly ExternalDeclaration[] {
  return "externalRecords" in envelope ? envelope.externalRecords as readonly ExternalDeclaration[] : [];
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function commonItemBinding(id: string, copy: AdminCopy): AdminItemNameBinding | undefined {
  const owners = commonSource.records.filter(row => row.id === id);
  const owner = owners[0], record = getAdminCopyRecord(id, copy);
  if (owners.length !== 1 || !owner || owner.leaf !== "strings.common" || !owner.context.startsWith("designer.item.")
    || !record || !same(record, owner)) return undefined;
  const usages = commonSource.usages.filter(row => row.recordId === id && row.source === "records/admin-studio.r1.en.json");
  const usage = usages[0];
  const bindings = ADMIN_STUDIO_COPY_EN.bindings.filter(row => row.recordId === id), binding = bindings[0];
  const declared = ADMIN_STUDIO_COPY_EN.externalRecords.filter(row => row.recordId === id), declaration = declared[0];
  if (usages.length !== 1 || !usage || usage.legacyRecordId !== id || usage.leaf !== "strings.names" || usage.context !== owner.context
    || bindings.length !== 1 || !binding || binding.kind !== "item-name" || binding.cellId !== owner.context
    || declared.length !== 1 || !declaration || declaration.source !== "common-labels.r1.en.json" || declaration.sourceContext !== owner.context) return undefined;
  const suppliedOwners = copy.envelopes.filter(envelope => envelope.records.some(row => row.id === id));
  if (suppliedOwners.length !== 1) return undefined;
  const suppliedOwner = suppliedOwners[0]!;
  if (suppliedOwner.version !== commonSource.version || suppliedOwner.revision !== commonSource.revision
    || suppliedOwner.state !== commonSource.state || suppliedOwner.activation !== commonSource.activation || suppliedOwner.locale !== commonSource.locale
    || suppliedOwner.records.filter(row => row.id === id).length !== 1 || !("bindings" in suppliedOwner) || suppliedOwner.bindings.length !== 0 || !("usages" in suppliedOwner) || !Array.isArray(suppliedOwner.usages)
    || !same((suppliedOwner.usages as typeof commonSource.usages).filter(row => row.recordId === id && row.source === usage.source), usages)) return undefined;
  const carriers = copy.envelopes.filter(envelope => "bindings" in envelope && envelope.bindings.some(row => row.recordId === id)
    || declarations(envelope).some(row => row.recordId === id && row.source === declaration.source));
  // Other current consumers may declare the owner, but only one Studio carrier
  // may supply item-name authority; its declaration and complete id binding set agree.
  const studioCarriers = carriers.filter(envelope => "bindings" in envelope && envelope.bindings.some(row => row.recordId === id && row.kind === "item-name"));
  if (studioCarriers.length !== 1) return undefined;
  const carrier = studioCarriers[0]!;
  if (carrier.version !== ADMIN_STUDIO_COPY_EN.version || carrier.revision !== ADMIN_STUDIO_COPY_EN.revision
    || carrier.state !== ADMIN_STUDIO_COPY_EN.state || carrier.activation !== ADMIN_STUDIO_COPY_EN.activation || carrier.locale !== ADMIN_STUDIO_COPY_EN.locale
    || !("sourceCommit" in carrier) || carrier.sourceCommit !== ADMIN_STUDIO_COPY_EN.sourceCommit
    || !("sourceFiles" in carrier) || !same(carrier.sourceFiles, ADMIN_STUDIO_COPY_EN.sourceFiles)
    || !("bindings" in carrier) || !same(carrier.bindings.filter(row => row.recordId === id), bindings)
    || !same(declarations(carrier).filter(row => row.recordId === id), declared) || carrier.records.some(row => row.id === id)) return undefined;
  return { ...binding, kind: "item-name" };
}

/** Current shipped Page alias authority, without a replacement copy store. */
export function getAdminPageItemNameAuthority(alias: string) {
  const id = pageSource.aliases[alias as keyof typeof pageSource.aliases];
  if (!id || !commonItemBinding(id, ADMIN_COPY_EN)) return undefined;
  const bindings = pageSource.bindings.filter(row => row.cellId === alias), binding = bindings[0];
  const declared = pageSource.externalRecords.filter(row => row.recordId === id), declaration = declared[0];
  if (bindings.length !== 1 || !binding || binding.recordId !== id || binding.kind !== "CopyRef" || declared.length !== 1 || !declaration
    || declaration.source !== "common-labels.r1.en.json" || declaration.sourceContext !== getAdminCopyRecord(id)?.context) return undefined;
  return { source: "admin-pages.r1.en.json", binding: { ...binding }, declaration: { ...declaration } };
}

/** Authenticate an item name against the shipped Writer source binding.
 * A context-shaped string alone grants no authority to name a Designer item. */
export function getAdminItemNameBinding(id: string, copy: AdminCopy = ADMIN_COPY_EN): AdminItemNameBinding | undefined {
  if (commonItemIds.has(id)) return commonItemBinding(id, copy);
  const canonicalRecord = designerItemNames.get(id);
  const record = getAdminCopyRecord(id, copy);
  if (!canonicalRecord || !record || record.leaf !== canonicalRecord.leaf || record.context !== canonicalRecord.context) return undefined;
  const canonicalBindings = ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.recordId === id);
  const canonicalBinding = canonicalBindings[0];
  if (canonicalBindings.length !== 1 || !canonicalBinding || canonicalBinding.kind !== "item-name" || canonicalBinding.cellId !== canonicalRecord.context) return undefined;
  const envelopes = copy.envelopes.filter(envelope => envelope.records.some(row => row.id === id));
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
  if ((designerItemNames.has(ref.id) || commonItemIds.has(ref.id) || record.context.startsWith("designer.item.")) && !getAdminItemNameBinding(ref.id, copy)) return undefined;
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
