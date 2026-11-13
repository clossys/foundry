import { COPY_FINGERPRINT_ALGORITHM } from "../fingerprint.js";
import type { WriterLibrary, WriterLocaleContent, WriterRecord } from "../model/types.js";
import { writerRecordFingerprint } from "./approval.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";

/** All declared locales, including planned locales, need their own content. */
export function checkWriterCoverage(library: WriterLibrary, _options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  const sourceLocale = library.manifest.defaultLocale;
  const source = library.locales[sourceLocale];
  const issue = (locale: string, path: string, field: string, message: string, recordId?: string): void => {
    findings.push({ code: "WR10", severity: "error", locale, path: `${locale}/${path}`, field, message, ...(recordId === undefined ? {} : { recordId }) });
  };
  const location = (content: WriterLocaleContent, record: WriterRecord): string => content.files?.find(file => file.recordIds.includes(record.id))?.path ?? record.id;
  if (!source) {
    issue(sourceLocale, "", "locales", "Default locale content is missing; coverage cannot be evaluated.");
    return findings;
  }
  if (source.records.length === 0 && source.documents.length === 0) issue(sourceLocale, "", "records", "Default locale has no content; coverage cannot be established.");
  const sourceById = new Map(source.records.map(record => [record.id, record]));
  for (const { tag: locale } of library.manifest.locales) {
    const target = library.locales[locale];
    if (!target) {
      issue(locale, "", "locales", "Declared locale content is missing; fallback does not satisfy coverage.");
      continue;
    }
    for (const document of target.documents) issue(locale, document.path, "documents", "Cannot validate Markdown narrative coverage or provenance before narrative parsing (WR-NARR).");
    for (const record of target.records) {
      if (record.status !== "approved") issue(locale, location(target, record), "status", `Record is ${record.status}; declared locale coverage requires approved content.`, record.id);
    }
    if (locale === sourceLocale) continue;
    const targetById = new Map(target.records.map(record => [record.id, record]));
    for (const record of source.records) {
      const translated = targetById.get(record.id);
      if (!translated) {
        issue(locale, location(source, record), "records", "Source record is missing from this declared locale.", record.id);
        continue;
      }
      if (translated.leaf !== record.leaf) issue(locale, location(target, translated), "leaf", "Translated record must retain its default-locale source leaf.", translated.id);
      const sourceKind = "kind" in record ? record.kind : undefined;
      const targetKind = "kind" in translated ? translated.kind : undefined;
      if (targetKind !== sourceKind) issue(locale, location(target, translated), "kind", "Translated Lexicon record must retain its default-locale source kind.", translated.id);
      if (!translated.translation) issue(locale, location(target, translated), "translation", "Translation provenance is missing; currency cannot be evaluated.", translated.id);
      else {
        if (translated.translation.fingerprintAlgorithm !== COPY_FINGERPRINT_ALGORITHM) issue(locale, location(target, translated), "translation.fingerprintAlgorithm", `Translation fingerprint algorithm must be ${COPY_FINGERPRINT_ALGORITHM}.`, translated.id);
        if (translated.translation.sourceFingerprint !== writerRecordFingerprint(record, source.records)) issue(locale, location(target, translated), "translation.sourceFingerprint", "Translation is stale: source semantic content or referenced wording has changed.", translated.id);
      }
    }
    for (const record of target.records) if (!sourceById.has(record.id)) issue(locale, location(target, record), "records", "Orphan record has no counterpart in the default locale.", record.id);
    // File identity matters independently of record identity, including empty files.
    if (source.files !== undefined && target.files !== undefined) {
      const sourceFiles = new Map(source.files.map(file => [file.path, file]));
      const targetFiles = new Map(target.files.map(file => [file.path, file]));
      for (const file of source.files) {
        const mirrored = targetFiles.get(file.path);
        if (!mirrored) issue(locale, file.path, "files", "Source file is missing from this declared locale.");
        else {
          const ids = new Set(mirrored.recordIds);
          for (const id of file.recordIds) if (targetById.has(id) && !ids.has(id)) issue(locale, file.path, "files", "Record must mirror its default-locale source file.", id);
        }
      }
      for (const file of target.files) {
        const mirrored = sourceFiles.get(file.path);
        if (!mirrored) issue(locale, file.path, "files", "Orphan file has no counterpart in the default locale.");
        else {
          const ids = new Set(mirrored.recordIds);
          for (const id of file.recordIds) if (sourceById.has(id) && !ids.has(id)) issue(locale, file.path, "files", "Record is in a different file from its default-locale counterpart.", id);
        }
      }
    }
    const sourceDocuments = new Set(source.documents.map(document => document.path));
    const targetDocuments = new Set(target.documents.map(document => document.path));
    for (const path of sourceDocuments) if (!targetDocuments.has(path)) issue(locale, path, "documents", "Source Markdown narrative file is missing from this declared locale.");
    for (const path of targetDocuments) if (!sourceDocuments.has(path)) issue(locale, path, "documents", "Orphan Markdown narrative file has no counterpart in the default locale.");
  }
  return findings;
}
