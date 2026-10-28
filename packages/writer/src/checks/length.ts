import { loadWriterCatalog } from "../catalog/ia/index.js";
import type { Block, PassageRef, WriterLibrary, WriterRecord } from "../model/types.js";
import { parseIcuMessage, type IcuNode } from "../icu/parse.js";
import { resolveWriterRefText } from "./approval.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";

export interface WriterTextLimits { maxChars?: number; maxWords?: number }
export interface WriterTextField {
  locale: string; recordId: string; field: string; path: string; text: string;
  limits: WriterTextLimits;
  /** External-origin wording is retained in source; it is neither shortened nor pseudo-localized. */
  externalLegal: boolean;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const legal = (record: WriterRecord): boolean => record.origin === "external";
const limits = (value: unknown): WriterTextLimits => object(value) ? { maxChars: count(value.maxChars), maxWords: count(value.maxWords) } : {};
const narrow = (base: WriterTextLimits, override: WriterTextLimits): WriterTextLimits => {
  const min = (a: number | undefined, b: number | undefined) => a === undefined ? b : b === undefined ? a : Math.min(a, b);
  return { maxChars: min(base.maxChars, override.maxChars), maxWords: min(base.maxWords, override.maxWords) };
};

/** Each row is a single independently bounded field, never metadata or a serialized record. */
export function writerTextFields(library: WriterLibrary, options: WriterCheckOptions = {}): WriterTextField[] {
  const catalog = options.catalog ?? loadWriterCatalog();
  const slots = new Map(catalog.slots.map(slot => [slot.id, slot]));
  const source = library.locales[library.manifest.defaultLocale]?.records ?? [];
  const sourceById = new Map(source.map(record => [record.id, record]));
  const fields: WriterTextField[] = [];
  for (const [locale, content] of Object.entries(library.locales)) {
    const byId = new Map(content.records.map(record => [record.id, record]));
    const refInfo = (ref: PassageRef): { text: string; externalLegal: boolean } | undefined => {
      const target = byId.get(ref.id);
      if (!target) return undefined; // Referential errors belong to WR3, not a made-up length.
      if (ref.ref === "string" && "text" in target || ref.ref === "term" && "kind" in target && target.kind === "term") {
        return { text: resolveWriterRefText(ref, content.records), externalLegal: legal(target) };
      }
      if (ref.ref !== "pattern" || !("parts" in target)) return undefined;
      const parts = ref.part === undefined ? Object.keys(target.parts).sort().map(key => target.parts[key]) : [target.parts[ref.part]];
      if (parts.some(part => !part || !("text" in part) && !(byId.get(part.ref.id) && "text" in byId.get(part.ref.id)!))) return undefined;
      // Bounded default: mixed authored/external containers are measured in full;
      // only wholly external records or reference subjects receive the exemption.
      return { text: resolveWriterRefText(ref, content.records), externalLegal: legal(target) || parts.every(part => !!part && !("text" in part) && legal(byId.get(part.ref.id)!)) };
    };
    for (const record of content.records) {
      const path = `${locale}/${content.files?.find(file => file.recordIds.includes(record.id))?.path ?? record.id}`;
      const add = (field: string, text: string, cap: WriterTextLimits = {}, exempt = legal(record)): void => {
        fields.push({ locale, recordId: record.id, field, path, text, limits: cap, externalLegal: exempt });
      };
      const contract = slots.get(record.leaf)?.contract;
      if ("text" in record) {
        const sourceRecord = sourceById.get(record.id);
        const sourceLimits = sourceRecord && "text" in sourceRecord ? sourceRecord.limits : undefined;
        const authored = record.limits;
        const effective = { maxChars: authored?.maxChars ?? sourceLimits?.maxChars, maxWords: authored?.maxWords ?? sourceLimits?.maxWords };
        add("text", record.text, narrow(limits(contract), effective));
      } else if ("parts" in record) {
        const items = object(contract?.parts) && Array.isArray(contract.parts.items) ? contract.parts.items : [];
        for (const [key, part] of Object.entries(record.parts)) {
          const cap = limits(items.find(item => object(item) && item.id === key));
          if ("text" in part) add(`parts.${key}`, part.text, cap);
          else { const resolved = refInfo({ ref: "string", id: part.ref.id }); if (resolved) add(`parts.${key}`, resolved.text, cap, legal(record) || resolved.externalLegal); }
        }
      } else if ("fields" in record) {
        const schema = slots.get(record.schema)?.contract.copy;
        const schemaFields = object(schema) && Array.isArray(schema.fields) ? schema.fields : [];
        for (const [key, value] of Object.entries(record.fields)) {
          const declaration = schemaFields.find(item => object(item) && item.key === key);
          const perLocale = object(declaration) && object(declaration.maxLength) ? declaration.maxLength : {};
          const sourceLocale = object(schema) && typeof schema.sourceLocale === "string" ? schema.sourceLocale : library.manifest.defaultLocale;
          const cap = count(perLocale[locale]) ?? count(perLocale[sourceLocale]);
          const refs = Array.isArray(value) ? value : [value];
          refs.forEach((ref, index) => {
            const resolved = refInfo(ref);
            if (resolved) add(`fields.${key}${Array.isArray(value) ? `[${index}]` : ""}`, resolved.text, { maxChars: cap }, legal(record) || resolved.externalLegal);
          });
        }
      } else if ("kind" in record && record.kind === "term") {
        add("term", record.term); record.forms.forEach((text, index) => add(`forms[${index}]`, text));
        if (record.alternative !== undefined) add("alternative", record.alternative);
      } else if ("kind" in record && record.kind === "claim") record.phrasings.forEach((text, index) => add(`phrasings[${index}]`, text));
      else if ("blocks" in record) {
        const title = byId.get(record.title as WriterRecord["id"]);
        if (title && "text" in title) add("title", title.text, {}, legal(record) || legal(title));
        else if (!/^(?:lx|st|pt|ps|nr)\.[0-9a-hjkmnp-tv-z]{10}$/.test(record.title)) add("title", record.title);
        const visit = (blocks: readonly Block[], prefix: string): void => blocks.forEach((block, index) => {
          if (block.text !== undefined) add(`${prefix}[${index}].text`, block.text);
          if (block.children) visit(block.children, `${prefix}[${index}].children`);
        });
        visit(record.blocks, "blocks");
      } else if ("regions" in record) {
        for (const [region, values] of Object.entries(record.regions)) for (const [key, value] of Object.entries(values)) {
          (Array.isArray(value) ? value : [value]).forEach((ref, index) => {
            const resolved = refInfo(ref);
            if (resolved) add(`regions.${region}.${key}${Array.isArray(value) ? `[${index}]` : ""}`, resolved.text, {}, legal(record) || resolved.externalLegal);
          });
        }
      }
    }
  }
  return fields;
}

/** Unicode code points and locale word boundaries; dynamic argument values are deliberately excluded. */
export function measureWriterText(text: string, locale: string): { chars: number; words: number } {
  const parsed = parseIcuMessage(text);
  let segmenter: Intl.Segmenter;
  try { segmenter = new Intl.Segmenter(locale, { granularity: "word" }); }
  catch { segmenter = new Intl.Segmenter(undefined, { granularity: "word" }); }
  const measure = (nodes: readonly IcuNode[]): { chars: number; words: number } => {
    let chars = 0, words = 0;
    for (const node of nodes) {
      if (node.kind === "literal") {
        chars += [...node.text].length;
        words += [...segmenter.segment(node.text)].filter(segment => segment.isWordLike).length;
      } else if (node.kind === "choice") {
        const branches = node.options.map(option => measure(option.nodes));
        chars += Math.max(0, ...branches.map(branch => branch.chars));
        words += Math.max(0, ...branches.map(branch => branch.words));
      }
    }
    return { chars, words };
  };
  // WR8 diagnoses malformed messages; treating their syntax as displayed wording would mislead.
  return parsed.issues.length ? { chars: 0, words: 0 } : measure(parsed.nodes);
}

export function writerTextOverflow(measured: { chars: number; words: number }, cap: WriterTextLimits): string[] {
  return [cap.maxChars !== undefined && measured.chars > cap.maxChars ? `${measured.chars} characters exceeds ${cap.maxChars}` : "",
    cap.maxWords !== undefined && measured.words > cap.maxWords ? `${measured.words} words exceeds ${cap.maxWords}` : ""].filter(Boolean);
}

export function checkWriterLength(library: WriterLibrary, options: WriterCheckOptions = {}): WriterCheckFinding[] {
  return writerTextFields(library, options).flatMap(row => {
    if (row.externalLegal) return [];
    const overflow = writerTextOverflow(measureWriterText(row.text, row.locale), row.limits);
    return overflow.length ? [{ code: "WR7" as const, severity: "error" as const, path: row.path, locale: row.locale, recordId: row.recordId, field: row.field,
      message: `Authored text ${overflow.join("; ")} (ICU literal text, worst choice branch; runtime argument values excluded).` }] : [];
  });
}
