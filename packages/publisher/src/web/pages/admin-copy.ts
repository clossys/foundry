import { createAdminCopy, getAdminCopyRecord, resolveAdminCopyRef } from "@clossys/writer/admin-copy";
import type { AdminCopyRef, AdminRouteCopy } from "@clossys/writer/admin-copy";
import type { StringRecord } from "@clossys/writer";
import { runtimeHash, runtimeSnapshot } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson } from "@clossys/designer/catalog";
import type { ContentRef } from "../../core/instance-binding.js";
import type { RegisteredPageLoaders } from "../registered-route-query.js";

export type AdminPageCopyRef = AdminCopyRef;
export interface AdminPageCopyDocument extends AdminRouteCopy {
  readonly aliases?: Readonly<Record<string, string>>;
  readonly externalRecords?: readonly { readonly recordId: string; readonly source: string; readonly sourceContext: string }[];
}
/** Produced by prepareAdminPageCopyEnvelopes in the server-only check entry. */
export interface AdminPageCopyEnvelope { readonly source: string; readonly envelope: AdminPageCopyDocument }
interface CheckedEnvelope extends AdminRouteCopy {
  readonly source: string; readonly hash: string; readonly aliases: Readonly<Record<string, string>>;
  readonly externalRecords: readonly { readonly recordId: string; readonly source: string; readonly sourceContext: string }[];
}
export interface AdminPageCopyProof {
  readonly cellId: string; readonly recordId: string; readonly revision: number; readonly locale: string;
  readonly status: string; readonly activation: string; readonly envelopeHash: string;
  readonly bindingSource: string; readonly bindingEnvelopeHash: string; readonly recordSource: string;
  readonly mode: "writer-icu-preview" | "writer-literal-preview";
}
export interface ResolvedAdminPageCopy { readonly ref: AdminPageCopyRef; readonly text: string; readonly provenance: AdminPageCopyProof }
declare const copyBrand: unique symbol;
export interface AdminPageCopy {
  (ref: string | AdminPageCopyRef, values?: AdminPageCopyRef["values"]): string;
  readonly [copyBrand]: true;
  readonly locale: string;
  resolve(ref: AdminPageCopyRef): ResolvedAdminPageCopy;
  provenance(): readonly ResolvedAdminPageCopy[];
}
const sources = new WeakSet<object>();
const contentProofs = new WeakMap<object, Map<string, string>>();
const recordObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function checkedEnvelope(input: AdminPageCopyEnvelope): CheckedEnvelope {
  const value = runtimeSnapshot(input.envelope);
  if (!input.source?.trim() || !recordObject(value) || typeof value.version !== "number" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.state !== "string" || typeof value.locale !== "string" || typeof value.activation !== "string" || !Array.isArray(value.records) || !Array.isArray(value.bindings)) throw new TypeError("Writer copy envelope metadata is malformed");
  const records = value.records;
  if (records.some(record => !record || typeof record.id !== "string" || typeof record.text !== "string" || typeof record.context !== "string" || !["draft", "approved", "retired"].includes(record.status))) throw new TypeError("Typed Writer string-record shape is malformed");
  const bindings = value.bindings.map(binding => {
    if (!recordObject(binding) || typeof binding.cellId !== "string" || typeof binding.recordId !== "string" || typeof binding.target !== "string" || typeof binding.kind !== "string") throw new TypeError("Writer binding metadata is malformed");
    return { cellId: binding.cellId, recordId: binding.recordId, target: binding.target, kind: binding.kind };
  });
  const aliases: Record<string, string> = {};
  if (value.aliases !== undefined) {
    if (!recordObject(value.aliases)) throw new TypeError("Writer aliases must be a record");
    for (const [alias, id] of Object.entries(value.aliases)) { if (typeof id !== "string") throw new TypeError("Writer alias must identify a record"); aliases[alias] = id; }
  }
  const externalRecords = value.externalRecords === undefined ? [] : Array.isArray(value.externalRecords) ? value.externalRecords.map(external => {
    if (!recordObject(external) || typeof external.recordId !== "string" || typeof external.source !== "string" || typeof external.sourceContext !== "string") throw new TypeError("Writer external record declaration is malformed");
    return { recordId: external.recordId, source: external.source, sourceContext: external.sourceContext };
  }) : (() => { throw new TypeError("Writer external records must be a list"); })();
  return { source: input.source, hash: runtimeHash(value), version: value.version, revision: value.revision, state: value.state, locale: value.locale, activation: value.activation, records, bindings, aliases, externalRecords };
}
export function assertAdminPageCopy(copy: unknown): asserts copy is AdminPageCopy {
  if (typeof copy !== "function" || !sources.has(copy)) throw new TypeError("Admin pages require a real Writer copy source, not a text callback");
}
/** Explicit draft-preview resolution. Writer retains draft status/activation;
 * no approved registry, English store or caller-authored resolution is invented. */
export function createAdminPageCopy(input: { readonly locale: string; readonly envelopes: readonly AdminPageCopyEnvelope[] }): AdminPageCopy {
  if (!input.locale?.trim()) throw new TypeError("Writer locale is required");
  const all = input.envelopes.map(checkedEnvelope);
  if (!all.some(envelope => envelope.locale === input.locale)) throw new TypeError("Writer has no envelope for the requested locale");
  const stores = new Map([...new Set(all.map(envelope => envelope.locale))].map(locale => [locale, createAdminCopy(all.filter(envelope => envelope.locale === locale))]));
  const resolutions: ResolvedAdminPageCopy[] = [];
  const resolve = (reference: AdminPageCopyRef): ResolvedAdminPageCopy => {
    if (!reference || typeof reference.id !== "string" || Object.keys(reference).some(key => !["id", "locale", "values"].includes(key))
      || reference.values !== undefined && (!recordObject(reference.values) || Object.values(reference.values).some(value => !(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))))) throw new TypeError("Writer CopyRef is malformed");
    const locale = reference.locale ?? input.locale, envelopes = all.filter(envelope => envelope.locale === locale), store = stores.get(locale);
    if (!store) throw new TypeError("Writer CopyRef locale has no source envelope");
    const aliases = envelopes.filter(envelope => Object.hasOwn(envelope.aliases, reference.id));
    if (aliases.length > 1) throw new TypeError("Writer alias is declared more than once");
    const aliasOwner = aliases[0], recordId = aliasOwner?.aliases[reference.id] ?? reference.id;
    const declarations = aliasOwner?.externalRecords.filter(row => row.recordId === recordId) ?? [];
    const matches = envelopes.flatMap(envelope => {
      const record = envelope.records.find(row => row.id === recordId);
      if (!record || aliasOwner && aliasOwner !== envelope && !declarations.some(row => row.source === envelope.source && row.sourceContext === record.context)) return [];
      const bindingOwner = aliasOwner ?? envelope;
      const binding = bindingOwner.bindings.find(row => row.recordId === recordId && row.kind === "CopyRef" && row.cellId === (aliasOwner ? reference.id : record.context));
      return binding ? [{ envelope, record, binding, bindingOwner }] : [];
    });
    if (matches.length !== 1) throw new TypeError(`Writer CopyRef requires one bound record: ${reference.id}`);
    const { envelope, record, binding, bindingOwner } = matches[0]!;
    const ref = { ...reference, id: record.id, locale };
    const result = resolveAdminCopyRef(ref, store);
    const literal = !result && locale !== "en" && Object.keys(ref.values ?? {}).length === 0 && !record.args?.length && !/[{}]/.test(record.text) ? getAdminCopyRecord(record.id, store) : undefined;
    if (record.status === "retired" || result && result.servedLocale !== locale || !result && !literal) throw new TypeError(`Writer refused CopyRef or ICU arguments: ${reference.id}`);
    const resolved = runtimeSnapshot({ ref, text: result?.text ?? record.text, provenance: { cellId: binding.cellId, recordId: record.id, revision: envelope.revision, locale, status: record.status, activation: "none", mode: result ? "writer-icu-preview" as const : "writer-literal-preview" as const, envelopeHash: envelope.hash, bindingSource: bindingOwner.source, bindingEnvelopeHash: bindingOwner.hash, recordSource: envelope.source } });
    resolutions.push(resolved); return resolved;
  };
  const copy = Object.assign((ref: string | AdminPageCopyRef, values?: AdminPageCopyRef["values"]) => resolve(typeof ref === "string" ? { id: ref, ...(values ? { values } : {}) } : ref).text,
    { locale: input.locale, resolve, provenance: () => Object.freeze([...resolutions]) }) as AdminPageCopy;
  sources.add(copy); contentProofs.set(copy, new Map()); return Object.freeze(copy);
}
export function writerCopy(ref: AdminPageCopyRef): RuntimeJson { return { $copy: { id: ref.id, ...(ref.locale === undefined ? {} : { locale: ref.locale }), ...(ref.values === undefined ? {} : { values: ref.values }) } }; }
/** Technical data is explicit and validated; it cannot replace a UI label. */
export function adminTechnicalData(kind: "id" | "href" | "locale" | "date" | "message", value: string): RuntimeJson { return { $data: { kind, value } }; }
const technicalKeys = new Set(["id", "key", "href", "anchor", "kind", "type", "tone", "role", "dir", "locale", "icon", "leafId", "sourceId", "state", "align", "ref", "action", "intent"]);
const labelKeys = new Set(["label", "text", "heading", "description", "title", "placeholder", "emptyTitle", "emptyDescription", "showAll", "previous", "next", "summary", "noResults"]);
export function resolveAdminPageValue(copy: AdminPageCopy, value: RuntimeJson, mode: ContentRef["kind"], path = "value"): RuntimeJson {
  assertAdminPageCopy(copy);
  const walk = (value: RuntimeJson, key: string, path: string): RuntimeJson => {
    if (typeof value === "string") {
      if (technicalKeys.has(key) && value.trim() === value && !/\s/.test(value)) return value;
      throw new TypeError(`Writer CopyRef required for displayed ${path}`);
    }
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((child, index) => walk(child, "", `${path}.${index}`));
    const object = value as Readonly<Record<string, RuntimeJson>>;
    if (Object.hasOwn(value, "$copy")) {
      if (Object.keys(value).length !== 1) throw new TypeError("Writer CopyRef marker has unknown fields");
      return copy.resolve(object.$copy as unknown as AdminPageCopyRef).text;
    }
    if (Object.hasOwn(value, "$data")) {
      const data = object.$data as { kind?: string; value?: string };
      if (Object.keys(value).length !== 1 || !data || typeof data.value !== "string" || labelKeys.has(key) || mode === "copy" && !technicalKeys.has(key)) throw new TypeError("Technical data cannot replace Writer UI copy");
      const valid = data.kind === "id" ? /^[\w.:-]+$/.test(data.value) : data.kind === "href" ? /^(?:\/|#|https?:\/\/)/.test(data.value)
        : data.kind === "locale" ? /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})*$/.test(data.value) : data.kind === "date" ? Number.isFinite(Date.parse(data.value)) : data.kind === "message" && key === "content";
      if (!valid) throw new TypeError(`Invalid technical data at ${path}`); return data.value;
    }
    if (typeof object.kind === "string" && typeof object.ref === "string" && ["copy", "records", "region", "action", "media"].includes(object.kind)) {
      if (Object.keys(object).some(key => !["kind", "ref"].includes(key))) throw new TypeError("Typed content reference contains unbound fields");
      return value;
    }
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child, name, `${path}.${name}`)]));
  };
  return walk(value, "", `${mode}.${path}`);
}
export function adminPageContent(copy: AdminPageCopy, reference: RuntimeContent["reference"], value: RuntimeJson): RuntimeContent {
  const resolved = resolveAdminPageValue(copy, value, reference.kind, reference.ref);
  const hash = runtimeHash(resolved);
  contentProofs.get(copy)!.set(JSON.stringify([reference.kind, reference.ref]), hash);
  return { reference, value: resolved, hash };
}
export function assertAdminPageContent(copy: AdminPageCopy, content: RuntimeContent): void {
  assertAdminPageCopy(copy);
  if (content.hash !== runtimeHash(content.value) || contentProofs.get(copy)?.get(JSON.stringify([content.reference.kind, content.reference.ref])) !== content.hash) throw new TypeError("Item fields require Writer-resolved content provenance");
}
export interface AdminPageLoaders {
  chunk: RegisteredPageLoaders["chunk"];
  item: RegisteredPageLoaders["item"];
  search(query: string): Promise<readonly { readonly l0: string; readonly anchor?: string; readonly href?: string; readonly label: AdminPageCopyRef; readonly kind: string }[]>;
}
/** Every consumer display value is resolved before entering the page cache. */
export function bindAdminPageLoaders(copy: AdminPageCopy, loaders: AdminPageLoaders): RegisteredPageLoaders {
  assertAdminPageCopy(copy);
  const bind = (value: RuntimeContent) => {
    if (value.hash !== runtimeHash(value.value)) throw new TypeError("Writer-bound loader content hash differs");
    if (contentProofs.get(copy)?.get(JSON.stringify([value.reference.kind, value.reference.ref])) === value.hash) return value;
    return adminPageContent(copy, value.reference, value.value);
  };
  return {
    chunk: async args => (await loaders.chunk(args)).map(bind),
    search: async query => (await loaders.search(query)).map(hit => ({ ...hit, label: copy(hit.label) })),
    item: async (l0, id) => { const item = await loaders.item(l0, id); return item ? { record: resolveAdminPageValue(copy, item.record, "records", "item"), content: item.content.map(bind) } : undefined; },
  };
}
