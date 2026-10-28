import type { WriterLibrary, WriterRecord } from "../../model/types.js";
import type { WriterCheckOptions } from "../freeze.js";
import { writerTextFields, type WriterTextField } from "../length.js";

export interface WriterLintTarget {
  locale: string; recordId: string; field: string; path: string; text: string;
}

/** Lint displayed wording, keeping narrative assembly separate from field subjects. */
export function writerLintTargets(library: WriterLibrary, options: WriterCheckOptions = {}): WriterLintTarget[] {
  // Retired references cannot contribute wording to an active subject.
  const active: WriterLibrary = { ...library, locales: Object.fromEntries(Object.entries(library.locales).map(([locale, content]) =>
    [locale, { ...content, records: content.records.filter(record => record.status !== "retired") }])) };
  const rows = writerTextFields(active, options);
  const result: WriterLintTarget[] = [];
  for (const { tag: locale } of library.manifest.locales) {
    const content = active.locales[locale];
    if (!content) continue;
    const byId = new Map(content.records.map(record => [record.id, record]));
    const byRecord = new Map<string, WriterTextField[]>();
    for (const row of rows) {
      if (row.locale !== locale) continue;
      const group = byRecord.get(row.recordId) ?? [];
      group.push(row); byRecord.set(row.recordId, group);
    }
    const wording = (record: WriterRecord | undefined): string[] =>
      !record ? [] : record.origin === "external" ? ["\uFFFC"]
        : (byRecord.get(record.id) ?? []).map(row => row.externalLegal ? "\uFFFC" : row.text);
    for (const record of content.records) {
      if (record.origin === "external" || "kind" in record) continue;
      const fields = byRecord.get(record.id) ?? [];
      if ("text" in record || "parts" in record || "fields" in record) {
        for (const { limits: _limits, externalLegal, ...target } of fields) if (!externalLegal) result.push(target);
        continue;
      }
      let text: string[];
      if ("passages" in record) {
        const chrome = record.chrome === undefined ? undefined : byId.get(record.chrome);
        text = chrome && "regions" in chrome ? wording(chrome) : [];
        for (const id of record.passages) {
          const passage = byId.get(id);
          if (passage && "fields" in passage) text.push(...wording(passage));
        }
      } else if ("regions" in record || "blocks" in record) text = wording(record);
      else continue;
      const path = `${locale}/${content.files?.find(file => file.recordIds.includes(record.id))?.path ?? record.id}`;
      result.push({ locale, recordId: record.id, field: "assembled", path, text: text.join(" ") });
    }
  }
  return result;
}
