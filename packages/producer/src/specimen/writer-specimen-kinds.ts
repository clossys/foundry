/**
 * Writer specimen kinds: what a Writer brand cell produces, as display tables. Page-copy cells
 * produce strings (labelled rows); lexicon cells produce voice rules, claims or names, which carry
 * no `text` and so need their own kind. Each kind reads only the cell's parsed records. Its words
 * (table labels, columns, summaries, empty cells) are Writer copy references; record values stay data.
 */
import { copyRef, type CopyText } from "./copy-ref.js";

export type WriterSpecimenKind = "strings" | "voice" | "claims" | "naming";
export interface SpecimenRef { readonly label: string; readonly agent?: string; readonly slug?: string }
/** One table cell: text, an optional link, or a leaf status the client maps to the shared vocabulary. */
export interface SpecimenTableCell { readonly text: CopyText; readonly ref?: SpecimenRef; readonly status?: string }
export interface SpecimenTable {
  readonly id: string;
  readonly label: CopyText;
  readonly columns: readonly CopyText[];
  /** The column holding prose, kept readable when other columns carry long ids. */
  readonly prose?: number;
  readonly rows: readonly { readonly key: string; readonly cells: readonly SpecimenTableCell[] }[];
}
export interface WriterKindSpecimen {
  readonly kind: WriterSpecimenKind;
  readonly summary: CopyText;
  readonly tables: readonly SpecimenTable[];
  /** One or two short lines for the gallery card. */
  readonly excerpt: readonly CopyText[];
}

type Fields = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const AVOID = new Set(["avoid", "forbidden", "banned"]);
const PREFER = new Set(["preferred", "prefer", "use"]);

/** The lexicon kind a set of records produces, or `strings` when they are page copy. */
export function writerSpecimenKind(records: readonly Fields[]): WriterSpecimenKind {
  const kinds = records.map(record => text(record.kind));
  if (!kinds.length || records.some(record => typeof record.text === "string")) return "strings";
  if (kinds.every(kind => kind === "claim")) return "claims";
  if (kinds.every(kind => kind === "term") && records.every(record => text(record.termStatus) === "brand")) return "naming";
  if (kinds.some(kind => kind === "voice-rule") && kinds.every(kind => kind === "voice-rule" || kind === "term")) return "voice";
  return "strings";
}

const contextKey = (record: Fields, cellId: string) => {
  const context = text(record.context);
  return context.startsWith(`${cellId}.`) ? context.slice(cellId.length + 1) : context;
};
const rowKey = (record: Fields, index: number) => text(record.id) || `${index}`;

function voice(cellId: string, records: readonly Fields[]): WriterKindSpecimen {
  const rules = records.filter(record => text(record.kind) === "voice-rule" && text(record.value));
  const terms = records.filter(record => text(record.kind) === "term" && text(record.term));
  const avoid = terms.filter(record => AVOID.has(text(record.termStatus)));
  const prefer = terms.filter(record => PREFER.has(text(record.termStatus)));
  const termRow = (record: Fields, index: number) => ({
    key: rowKey(record, index),
    cells: [{ text: text(record.term) }, { text: strings(record.forms).join(", ") || copyRef("studio.contract-none") }, { text: text(record.reason) || copyRef("studio.no-reason-recorded") }],
  });
  const tables: SpecimenTable[] = [];
  if (rules.length) tables.push({
    id: "principles", label: copyRef("studio.principles"), columns: [copyRef("studio.rule"), copyRef("studio.do")], prose: 1,
    rows: rules.map((record, index) => ({ key: rowKey(record, index), cells: [{ text: text(record.rule) || contextKey(record, cellId) }, { text: text(record.value) }] })),
  });
  if (prefer.length) tables.push({ id: "do", label: copyRef("studio.do-preferred-words"), columns: [copyRef("studio.word"), copyRef("studio.forms"), copyRef("studio.why")], rows: prefer.map(termRow) });
  if (avoid.length) tables.push({ id: "dont", label: copyRef("studio.dont-avoided-words"), columns: [copyRef("studio.word"), copyRef("studio.also-avoid"), copyRef("studio.why")], rows: avoid.map(termRow) });
  return {
    kind: "voice", tables,
    summary: copyRef("studio.voice-summary", { principles: rules.length, preferred: prefer.length, avoided: avoid.length }),
    excerpt: [
      ...rules.slice(0, 1).map(record => text(record.value)),
      ...(avoid.length ? [copyRef("studio.avoid-terms", { terms: avoid.map(record => text(record.term)).join(", ") })] : []),
    ],
  };
}

function claims(cellId: string, records: readonly Fields[]): WriterKindSpecimen {
  const rows = records.map((record, index) => {
    const strategy = (record.strategy ?? {}) as Fields;
    const source = text(strategy.cell);
    const version = typeof strategy.version === "number" ? strategy.version : undefined;
    // An unsourced claim that needs a citation has nothing behind it: the shared `missing` status.
    const unsupported = !source && record.requiresCitation === true;
    const evidence: SpecimenTableCell = source
      ? { text: `${source}${version === undefined ? "" : ` v${version}`}`, ref: { label: source, agent: "director", slug: source } }
      : { text: copyRef(unsupported ? "studio.citation-required-no-source" : "studio.no-citation-required"), ...(unsupported ? { status: "missing" } : {}) };
    return {
      key: rowKey(record, index),
      cells: [
        { text: contextKey(record, cellId), status: text(record.status) || "draft" },
        { text: strings(record.phrasings).join("\n") || copyRef("studio.no-phrasing-recorded") },
        evidence,
      ],
    };
  });
  const sourced = records.filter(record => text(((record.strategy ?? {}) as Fields).cell)).length;
  const cited = records.filter(record => record.requiresCitation === true).length;
  return {
    kind: "claims",
    tables: rows.length ? [{ id: "claims", label: copyRef("studio.claims"), columns: [copyRef("studio.claim"), copyRef("studio.phrasing"), copyRef("studio.evidence")], prose: 1, rows }] : [],
    summary: copyRef("studio.claims-summary", { claims: records.length, cited, sourced }),
    excerpt: records.slice(0, 2).map(record => strings(record.phrasings)[0] ?? "").filter(Boolean),
  };
}

/** A name's usage rule: its recorded rule, then its casing, or the explicit empty state. */
const usage = (rule: string, casing: string): CopyText => casing
  ? copyRef(rule ? "studio.usage-rule-casing" : "studio.casing", rule ? { rule, casing } : { casing })
  : rule || copyRef("studio.no-usage-rule-recorded");

function naming(cellId: string, records: readonly Fields[]): WriterKindSpecimen {
  const rows = records.map((record, index) => {
    const casing = text(record.casing);
    const rule = text(record.reason);
    return {
      key: rowKey(record, index),
      cells: [
        { text: contextKey(record, cellId) },
        { text: text(record.term) },
        { text: strings(record.forms).join(", ") || copyRef("studio.contract-none") },
        { text: usage(rule && rule !== text(record.term) ? rule : "", casing) },
      ],
    };
  });
  const names = [...new Set(records.map(record => text(record.term)).filter(Boolean))];
  return {
    kind: "naming",
    tables: rows.length ? [{ id: "names", label: copyRef("studio.names"), columns: [copyRef("studio.use"), copyRef("studio.name"), copyRef("studio.forms"), copyRef("studio.usage-rule")], prose: 3, rows }] : [],
    summary: copyRef("studio.naming-summary", { names: names.length, rules: records.length }),
    excerpt: names.length ? [names.join(" · ")] : [],
  };
}

/** The specimen of a lexicon cell, or undefined when its records are page copy (strings). */
export function writerKindSpecimen(cellId: string, records: readonly Fields[]): WriterKindSpecimen | undefined {
  const kind = writerSpecimenKind(records);
  if (kind === "voice") return voice(cellId, records);
  if (kind === "claims") return claims(cellId, records);
  if (kind === "naming") return naming(cellId, records);
  return undefined;
}
