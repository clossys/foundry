/**
 * Writer specimen kinds: what a Writer brand cell produces, as display tables. Page-copy cells
 * produce strings (labelled rows); lexicon cells produce voice rules, claims or names, which carry
 * no `text` and so need their own kind. Each kind reads only the cell's parsed records.
 */
export type WriterSpecimenKind = "strings" | "voice" | "claims" | "naming";
export interface SpecimenRef { readonly label: string; readonly agent?: string; readonly slug?: string }
/** One table cell: text, an optional link, or a leaf status the client maps to the shared vocabulary. */
export interface SpecimenTableCell { readonly text: string; readonly ref?: SpecimenRef; readonly status?: string }
export interface SpecimenTable {
  readonly id: string;
  readonly label: string;
  readonly columns: readonly string[];
  /** The column holding prose, kept readable when other columns carry long ids. */
  readonly prose?: number;
  readonly rows: readonly { readonly key: string; readonly cells: readonly SpecimenTableCell[] }[];
}
export interface WriterKindSpecimen {
  readonly kind: WriterSpecimenKind;
  readonly summary: string;
  readonly tables: readonly SpecimenTable[];
  /** One or two short lines for the gallery card. */
  readonly excerpt: readonly string[];
}

type Fields = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const humanize = (value: string) => value.replace(/[-_.]+/g, " ").trim().replace(/^\w/, letter => letter.toUpperCase());
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
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
    cells: [{ text: text(record.term) }, { text: strings(record.forms).join(", ") || "None" }, { text: text(record.reason) || "No reason recorded" }],
  });
  const tables: SpecimenTable[] = [];
  if (rules.length) tables.push({
    id: "principles", label: "Principles", columns: ["Rule", "Do"], prose: 1,
    rows: rules.map((record, index) => ({ key: rowKey(record, index), cells: [{ text: humanize(text(record.rule) || contextKey(record, cellId)) }, { text: text(record.value) }] })),
  });
  if (prefer.length) tables.push({ id: "do", label: "Do: preferred words", columns: ["Word", "Forms", "Why"], rows: prefer.map(termRow) });
  if (avoid.length) tables.push({ id: "dont", label: "Don't: avoided words", columns: ["Word", "Also avoid", "Why"], rows: avoid.map(termRow) });
  return {
    kind: "voice", tables,
    summary: `${plural(rules.length, "principle", "principles")}, ${plural(prefer.length, "preferred word", "preferred words")} and ${plural(avoid.length, "avoided word", "avoided words")}.`,
    excerpt: [
      ...rules.slice(0, 1).map(record => text(record.value)),
      ...(avoid.length ? [`Avoid: ${avoid.map(record => text(record.term)).join(", ")}`] : []),
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
      : { text: unsupported ? "Citation required, no source recorded" : "No citation required", ...(unsupported ? { status: "missing" } : {}) };
    return {
      key: rowKey(record, index),
      cells: [
        { text: humanize(contextKey(record, cellId)), status: text(record.status) || "draft" },
        { text: strings(record.phrasings).join("\n") || "No phrasing recorded" },
        evidence,
      ],
    };
  });
  const sourced = records.filter(record => text(((record.strategy ?? {}) as Fields).cell)).length;
  const cited = records.filter(record => record.requiresCitation === true).length;
  return {
    kind: "claims",
    tables: rows.length ? [{ id: "claims", label: "Claims", columns: ["Claim", "Phrasing", "Evidence"], prose: 1, rows }] : [],
    summary: `${plural(records.length, "claim", "claims")}: ${cited} require a citation, ${sourced} have a recorded Director source.`,
    excerpt: records.slice(0, 2).map(record => strings(record.phrasings)[0] ?? "").filter(Boolean),
  };
}

function naming(cellId: string, records: readonly Fields[]): WriterKindSpecimen {
  const rows = records.map((record, index) => {
    const casing = text(record.casing);
    const rule = text(record.reason);
    return {
      key: rowKey(record, index),
      cells: [
        { text: humanize(contextKey(record, cellId)) },
        { text: text(record.term) },
        { text: strings(record.forms).join(", ") || "None" },
        { text: [rule && rule !== text(record.term) ? rule : "", casing ? `Casing: ${casing}` : ""].filter(Boolean).join(" ") || "No usage rule recorded" },
      ],
    };
  });
  const names = [...new Set(records.map(record => text(record.term)).filter(Boolean))];
  return {
    kind: "naming",
    tables: rows.length ? [{ id: "names", label: "Names", columns: ["Use", "Name", "Forms", "Usage rule"], prose: 3, rows }] : [],
    summary: `${plural(names.length, "name", "names")} across ${plural(records.length, "usage rule", "usage rules")}.`,
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
