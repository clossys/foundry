/**
 * Copy parsing shared by the Writer criteria (ST-W1, ST-W2). Pure: a Writer candidate body is one
 * `## <locale>` section per locale, each a run of `### <key>` entries whose first line is the
 * `<!-- {"id": "<key>", ...} -->` meta comment and whose value is plain text or one fenced json block.
 */
import { AGENT_HANDOFFS } from "../../../../agent-lists.generated.js";
import { isRecord, strings } from "../../core/lib.js";
import type { Subject } from "../../core/types.js";

export interface CopyEntry {
  readonly locale: string;
  readonly key: string;
  /** The meta comment, parsed; a string when it is missing or unreadable. */
  readonly meta: Record<string, unknown> | string;
  /** The value text: plain lines joined with newlines, or the fenced block's inside. */
  readonly value: string;
  /** Whether the value is one fenced json block. */
  readonly fenced: boolean;
  /** The fenced block parsed; a string when it does not parse; undefined for plain values. */
  readonly json?: unknown;
}

export interface CopyBody { readonly locales: readonly string[]; readonly entries: readonly CopyEntry[]; readonly stray: readonly string[] }

/** The locale sections and entries of a Writer body; loose lines outside an entry are `stray`. */
export function parseCopy(text: string): CopyBody {
  const locales: string[] = [];
  const entries: CopyEntry[] = [];
  const stray: string[] = [];
  let locale: string | undefined;
  let open: { key: string; lines: string[] } | undefined;
  const close = () => {
    if (!open || locale === undefined) return;
    const lines = [...open.lines];
    while (lines.length && !lines[0]!.trim()) lines.shift();
    let meta: Record<string, unknown> | string = "has no meta comment";
    const first = /^<!--\s*(\{.*\})\s*-->$/.exec(lines[0]?.trim() ?? "");
    if (first) {
      try { const parsed = JSON.parse(first[1]!) as unknown; meta = isRecord(parsed) ? parsed : "meta comment is not an object"; } catch { meta = "meta comment is not JSON"; }
      lines.shift();
    }
    const body = lines.join("\n").trim();
    const fence = /^```json\s*\n([\s\S]*?)\n```$/.exec(body);
    let json: unknown;
    if (fence) { try { json = JSON.parse(fence[1]!) as unknown; } catch { json = "the json block does not parse"; } }
    entries.push({ locale, key: open.key, meta, value: fence ? fence[1]! : body, fenced: Boolean(fence), ...(fence ? { json } : {}) });
    open = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const h2 = /^##\s+(\S.*?)\s*$/.exec(raw);
    const h3 = /^###\s+(\S.*?)\s*$/.exec(raw);
    if (h2 && !raw.startsWith("###")) { close(); locale = h2[1]!; locales.push(locale); continue; }
    if (h3) { close(); if (locale === undefined) stray.push(raw.trim()); else open = { key: h3[1]!, lines: [] }; continue; }
    if (open) open.lines.push(raw);
    else if (raw.trim()) stray.push(raw.trim());
  }
  close();
  return { locales, entries, stray };
}

/** The candidate's frontmatter locales, or undefined when it names none. */
export function localesOf(subject: Subject): string[] | undefined {
  const raw = isRecord(subject.json) ? subject.json.locales : undefined;
  if (typeof raw !== "string") return Array.isArray(raw) ? strings(raw) : undefined;
  try { return strings(JSON.parse(raw)); } catch { return undefined; }
}

/** The candidate's frontmatter source as an object, or the reason it is missing or unreadable. */
export function sourceOf(subject: Subject): { kind?: unknown; ref: string[] } | string {
  const raw = isRecord(subject.json) ? subject.json.source : undefined;
  if (raw === undefined) return "the frontmatter has no source";
  let value: unknown = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { return "the frontmatter source is not JSON"; } }
  if (!isRecord(value)) return "the frontmatter source is not an object";
  return { kind: value.kind, ref: strings(value.ref) };
}

/**
 * The candidate's frontmatter provenance as an object, or the reason it is missing or unreadable. `provenance` names
 * what the copy derives from without reading it as an input (`provenance.voice`: the pinned Director voice), so neither
 * the Writer inputs rule nor R07.1 counts it; `source.ref` stays the slot's cited inputs.
 */
export function provenanceOf(subject: Subject): Record<string, unknown> | string {
  const raw = isRecord(subject.json) ? subject.json.provenance : undefined;
  if (raw === undefined) return "the frontmatter has no provenance";
  let value: unknown = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { return "the frontmatter provenance is not JSON"; } }
  return isRecord(value) ? value : "the frontmatter provenance is not an object";
}

/** The slot a candidate's frontmatter names, for messages; undefined when it names none. */
export function slotOf(subject: Subject): string | undefined {
  const slot = isRecord(subject.json) ? subject.json.slot : undefined;
  return typeof slot === "string" && slot ? slot : undefined;
}

/** A slot id (2-4 dotted segments). */
export const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;
/** The agents a Writer copy citation may name: the agents that hand off to Writer, then Writer itself. */
const WRITER_CITED = [...AGENT_HANDOFFS.filter(([, to]) => to === "writer").map(([from]) => from), "writer"];
/** A copy citation `<agent>:<slot>[#<key>]` or a finding. */
export const UPSTREAM_REF = new RegExp(String.raw`^(?:(?:${WRITER_CITED.join("|")}):[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}(?:#[a-z0-9][a-z0-9.-]*)?|(?:finding|evidence):[a-z0-9][a-z0-9.-]*)$`);
/** A copy reference inside a narrative: `<writer slot>#<key>`. */
export const COPY_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*$/;
