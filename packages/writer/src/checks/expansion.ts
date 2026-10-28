import { parseIcuMessage, type IcuNode } from "../icu/parse.js";
import type { WriterLibrary } from "../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";
import { measureWriterText, writerTextFields, writerTextOverflow, type WriterTextLimits } from "./length.js";

export interface WriterPseudoField {
  recordId: string; field: string; path: string; text: string; limits: WriterTextLimits;
  original: { chars: number; words: number }; expanded: { chars: number; words: number };
  overflow: string[]; actualOverflow: string[];
}
export interface WriterPseudoReport {
  schemaVersion: 1; kind: "writer-pseudo"; locale: "en-XA"; measurement: string;
  locales: { sourceLocale: string; factor: number; fields: WriterPseudoField[] }[];
  findings: WriterCheckFinding[];
}
const boundedFactor = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 4;
const accents: Readonly<Record<string, string>> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
const quoteLiteral = (text: string, inPlural: boolean): string => text.replace(inPlural ? /[{}#']+/g : /[{}']+/g, syntax => {
  const escaped = syntax.replace(/'/g, "''");
  return syntax.replace(/'/g, "") ? `'${escaped}'` : escaped;
});

/** Pseudo copy is a derived diagnostic, never another content locale or an approval subject. */
function pseudoMessage(text: string, factor: number): string | undefined {
  const parsed = parseIcuMessage(text);
  if (parsed.issues.length) return undefined; // WR8 owns malformed or unsupported syntax.
  const render = (nodes: readonly IcuNode[], inPlural = false): string => nodes.map(node => {
    if (node.kind === "literal") {
      const characters = [...node.text];
      const expanded = characters.map(character => accents[character] ?? character).join("");
      const padding = node.text.trim() ? "·".repeat(Math.ceil(characters.length * factor) - characters.length) : "";
      return quoteLiteral(expanded + padding, inPlural);
    }
    if (node.kind === "pound") return "#";
    if (node.kind === "argument") return node.type === "argument" ? `{${node.name}}` : `{${node.name}, ${node.type}${node.style === undefined ? "" : `, ${node.style}`}}`;
    return `{${node.name}, ${node.type}, ${node.type !== "select" && node.offset ? `offset:${node.offset} ` : ""}${node.options.map(option => `${option.selector} {${render(option.nodes, inPlural || node.type !== "select")}}`).join(" ")}}`;
  }).join("");
  return render(parsed.nodes);
}

export function writerPseudoLocale(library: WriterLibrary, options: WriterCheckOptions = {}): WriterPseudoReport {
  const findings: WriterCheckFinding[] = [];
  const fields = writerTextFields(library, options);
  const locales = Object.entries(library.locales).map(([sourceLocale, content]) => {
    const configs = content.records.filter(record => "kind" in record && record.kind === "format" && record.format === "expansion" && record.status !== "retired");
    const invalid = (path: string, message: string): void => { findings.push({ code: "WR9", severity: "error", path, locale: sourceLocale, message }); };
    let factor = 1.35;
    if (configs.length > 1) invalid(`${sourceLocale}/lexicon`, "Expansion requires at most one non-retired locale format record with value { factor: number }.");
    for (const record of configs) {
      if (!("value" in record) || typeof record.value !== "object" || record.value === null || Array.isArray(record.value)
        || Object.keys(record.value).length !== 1 || !boundedFactor((record.value as Record<string, unknown>).factor)) {
        invalid(`${sourceLocale}/${record.id}`, "Expansion format value must contain only factor, a finite number from 1 through 4.");
      } else if (configs.length === 1) factor = record.value.factor as number;
    }
    if (options.pseudoFactor !== undefined) {
      if (!boundedFactor(options.pseudoFactor)) invalid("options.pseudoFactor", "Pseudo expansion factor must be a finite number from 1 through 4.");
      else factor = options.pseudoFactor;
    }
    const expandedFields = fields.filter(row => row.locale === sourceLocale && !row.externalLegal).flatMap(row => {
      const text = pseudoMessage(row.text, factor);
      if (text === undefined) return [];
      const original = measureWriterText(row.text, sourceLocale), expanded = measureWriterText(text, sourceLocale);
      const actualOverflow = writerTextOverflow(original, row.limits), overflow = writerTextOverflow(expanded, row.limits);
      // A field that already fails WR7 is not a newly discovered expansion failure.
      if (overflow.length && !actualOverflow.length) findings.push({ code: "WR9", severity: "error", path: row.path, locale: sourceLocale, recordId: row.recordId, field: row.field,
        message: `en-XA pseudo expansion at factor ${factor}: ${overflow.join("; ")} (authored ICU literals; runtime argument values excluded).` });
      return [{ recordId: row.recordId, field: row.field, path: row.path, text, limits: row.limits, original, expanded, overflow, actualOverflow }];
    });
    return { sourceLocale, factor, fields: expandedFields };
  });
  return { schemaVersion: 1, kind: "writer-pseudo", locale: "en-XA", measurement: "Unicode code points and locale word boundaries in authored ICU literal text; worst choice branch; runtime argument values excluded", locales, findings };
}

export function checkWriterExpansion(library: WriterLibrary, options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings = writerPseudoLocale(library, options).findings;
  for (const declaration of library.manifest.locales) {
    if (declaration.dir !== "rtl") continue;
    const content = library.locales[declaration.tag];
    if (!content) continue;
    for (const record of content.records) {
      if (!("frame" in record)) continue;
      const evidence = options.designerLibraries?.flatMap(designer => designer.frames).filter(frame => frame.id === record.frame.frameId) ?? [];
      if (evidence.length === 0 || evidence.some(frame => frame.logicalProperties !== true)) findings.push({
        code: "WR9", severity: "error", locale: declaration.tag, recordId: record.id, field: "frame.frameId",
        path: `${declaration.tag}/${content.files?.find(file => file.recordIds.includes(record.id))?.path ?? record.id}`,
        message: `RTL narrative frame ${record.frame.frameId} requires explicit Designer logicalProperties: true evidence.`,
      });
    }
  }
  return findings;
}
