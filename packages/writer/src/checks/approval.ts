import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "../fingerprint.js";
import type { Block, PassageRef, PatternInstance, WriterLibrary, WriterRecord } from "../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";

const metadata = new Set(["id", "context", "status", "origin", "external", "approval", "translation"]);
const recordId = /^(?:lx|st|pt|ps|nr)\.[0-9a-hjkmnp-tv-z]{10}$/;

/** JSON data, with object member order independent of source-file formatting. */
function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(sorted(value));
}

function materializer(records: readonly WriterRecord[]) {
  const byId = new Map(records.map(record => [record.id, record]));
  const unresolved = (id: string) => ({ unresolved: id });
  const resolve = (id: string, seen: ReadonlySet<string>): unknown => {
    const target = byId.get(id as WriterRecord["id"]);
    return target ? payload(target, seen) : unresolved(id);
  };
  const part = (value: PatternInstance["parts"][string], seen: ReadonlySet<string>): unknown => {
    if ("text" in value) return value.text;
    return { ref: value.ref, resolved: resolve(value.ref.id, seen) };
  };
  const reference = (ref: PassageRef, seen: ReadonlySet<string>): unknown => {
    const target = byId.get(ref.id);
    if (!target) return { ...ref, resolved: unresolved(ref.id) };
    if (seen.has(target.id)) return { ...ref, resolved: { cycle: target.id } };
    if (ref.ref === "pattern" && ref.part !== undefined) {
      if (!("parts" in target) || !Object.hasOwn(target.parts, ref.part)) {
        return { ...ref, resolved: unresolved(`${ref.id}.${ref.part}`) };
      }
      return { ...ref, resolved: part(target.parts[ref.part]!, new Set([...seen, target.id])) };
    }
    return { ...ref, resolved: payload(target, seen) };
  };
  const refs = (value: PassageRef | PassageRef[], seen: ReadonlySet<string>): unknown =>
    Array.isArray(value) ? value.map(ref => reference(ref, seen)) : reference(value, seen);
  const block = (value: Block, seen: ReadonlySet<string>): unknown => ({
    ...value,
    ...(value.claim === undefined ? {} : { claim: { id: value.claim, resolved: resolve(value.claim, seen) } }),
    ...(value.children === undefined ? {} : { children: value.children.map(child => block(child, seen)) }),
  });
  const payload = (record: WriterRecord, ancestors: ReadonlySet<string>): unknown => {
    if (ancestors.has(record.id)) return { cycle: record.id };
    const seen = new Set([...ancestors, record.id]);
    // Preserve the existing String fingerprint contract, without JSON quotes.
    if ("text" in record) return record.text;
    const content: Record<string, unknown> = Object.fromEntries(Object.entries(record).filter(([key]) => !metadata.has(key)));
    if ("parts" in record) content.parts = Object.fromEntries(Object.entries(record.parts).map(([key, value]) => [key, part(value, seen)]));
    if ("fields" in record) content.fields = Object.fromEntries(Object.entries(record.fields).map(([key, value]) => [key, refs(value, seen)]));
    if ("regions" in record) content.regions = Object.fromEntries(Object.entries(record.regions).map(([region, fields]) => [region, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, refs(value, seen)]))]));
    if ("passages" in record) {
      content.passages = record.passages.map(id => ({ id, resolved: resolve(id, seen) }));
      if (record.chrome !== undefined) content.chrome = { id: record.chrome, resolved: resolve(record.chrome, seen) };
    }
    if ("blocks" in record) {
      if (recordId.test(record.title)) content.title = { id: record.title, resolved: resolve(record.title, seen) };
      content.blocks = record.blocks.map(value => block(value, seen));
    }
    return content;
  };
  const refText = (ref: PassageRef, ancestors: ReadonlySet<string>): string => {
    const target = byId.get(ref.id);
    if (!target) return `[unresolved:${ref.id}]`;
    if (ancestors.has(target.id)) return `[cycle:${target.id}]`;
    const seen = new Set([...ancestors, target.id]);
    if (ref.ref === "string" && "text" in target) return target.text;
    if (ref.ref === "term" && "kind" in target && target.kind === "term") return target.term;
    if (ref.ref === "pattern" && "parts" in target) {
      const keys = ref.part === undefined ? Object.keys(target.parts).sort() : [ref.part];
      return keys.map(key => {
        const value = target.parts[key];
        if (!value) return `[unresolved:${ref.id}.${key}]`;
        return "text" in value ? value.text : refText({ ref: "string", id: value.ref.id }, seen);
      }).join("\n");
    }
    return `[invalid-ref:${ref.ref}:${ref.id}]`;
  };
  return { payload, refText };
}

/** Actual referenced wording for field-level checks; no cross-locale fallback. */
export function resolveWriterRefText(ref: PassageRef, records: readonly WriterRecord[]): string {
  return materializer(records).refText(ref, new Set());
}

/** Semantic approval subject, including wording reached through local references. */
export function writerRecordText(record: WriterRecord, records: readonly WriterRecord[]): string {
  if ("text" in record) return record.text;
  return canonical(materializer(records).payload(record, new Set()));
}

export function writerRecordFingerprint(record: WriterRecord, records: readonly WriterRecord[]): string {
  return computeCopyFingerprint(writerRecordText(record, records));
}

/** New-library approvals require an owner record bound to the current subject. */
export function checkWriterApproval(library: WriterLibrary, _options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  for (const { tag: locale } of library.manifest.locales) {
    const content = library.locales[locale];
    if (!content) continue;
    for (const document of content.documents) findings.push({ code: "WR11", severity: "error", path: `${locale}/${document.path}`, locale, message: "Cannot validate Markdown narrative approval before narrative parsing (WR-NARR)." });
    for (const record of content.records) {
      if (record.status !== "approved") continue;
      const path = `${locale}/${content.files?.find(file => file.recordIds.includes(record.id))?.path ?? record.id}`;
      const issue = (field: string, message: string): void => { findings.push({ code: "WR11", severity: "error", path, locale, recordId: record.id, field, message }); };
      if (!record.approval) {
        issue("approval", "Approved record has no owner approval record.");
        continue;
      }
      if (record.approval.approvedBy !== "owner") issue("approval.approvedBy", "Delegate approval does not establish owner approval for a Writer library.");
      else if (record.approval.delegate !== undefined || record.approval.pendingOwnerReview !== undefined || record.approval.expiresAt !== undefined) issue("approval", "Owner approval must not contain delegate approval metadata.");
      if (record.approval.fingerprintAlgorithm !== COPY_FINGERPRINT_ALGORITHM) issue("approval.fingerprintAlgorithm", `Approval fingerprint algorithm must be ${COPY_FINGERPRINT_ALGORITHM}.`);
      if (record.approval.textFingerprint !== writerRecordFingerprint(record, content.records)) issue("approval.textFingerprint", "Approval is stale: its fingerprint does not match the current semantic content and referenced wording.");
    }
  }
  return findings;
}
