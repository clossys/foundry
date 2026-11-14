/**
 * Brief parsing shared by the Director criteria (ST-D). Pure: a brief is the body of a Director
 * candidate (`## Direction`, `## Because`, `## Watch`, each a list of `- ` lines) and its frontmatter
 * `source` (`{"kind": "derived", "ref": [...]}`), as `subjectOf` hands them over.
 */
import { isRecord, strings } from "../../core/lib.js";
import type { Subject } from "../../core/types.js";

export interface BriefSection { readonly heading: string; readonly lines: readonly string[]; readonly stray: readonly string[] }

/** The `## ` sections of a brief body, in order: their `- ` lines and any other non-empty lines (stray). */
export function briefSections(text: string): BriefSection[] {
  const out: { heading: string; lines: string[]; stray: string[] }[] = [];
  let current: { heading: string; lines: string[]; stray: string[] } | undefined;
  const preamble: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && !line.startsWith("###")) { out.push(current = { heading: heading[1]!, lines: [], stray: [] }); continue; }
    if (!line) continue;
    const bullet = /^-\s+(.+)$/.exec(line);
    if (!current) preamble.push(line);
    else if (bullet) current.lines.push(bullet[1]!.trim());
    else current.stray.push(line);
  }
  if (preamble.length) out.unshift({ heading: "", lines: [], stray: preamble });
  return out;
}

/** The lines of one section (the first with that heading), or undefined when the brief has none. */
export const sectionLines = (text: string, heading: string): readonly string[] | undefined => briefSections(text).find(section => section.heading === heading)?.lines;

/** A `Key: value` line: the key (a capitalised word or hyphenated words, then lower-case words) and the value. */
export function keyed(line: string): { key: string; value: string } | undefined {
  const match = /^([A-Z][A-Za-z-]*(?: [a-z][a-z-]*){0,3}):\s+(.+)$/.exec(line);
  return match ? { key: match[1]!, value: match[2]!.trim() } : undefined;
}

/** The value of a line: the text after its key when it has one, else the whole line. */
export const lineValue = (line: string): string => keyed(line)?.value ?? line;

/** The candidate's frontmatter source as an object, or the reason it is missing or unreadable. */
export function sourceOf(subject: Subject): { kind?: unknown; ref: string[] } | string {
  const fields = isRecord(subject.json) ? subject.json : undefined;
  const raw = fields?.source;
  if (raw === undefined) return "the frontmatter has no source";
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return "the frontmatter source is not JSON"; }
  }
  if (!isRecord(value)) return "the frontmatter source is not an object";
  return { kind: value.kind, ref: strings(value.ref) };
}

/** A slot id (`<l1>.<l2>.<leaf>` style, 2-4 dotted segments). */
export const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;
/** An evidence reference: a Director finding or evidence record id. */
export const EVIDENCE_REF = /^(?:finding|evidence):[a-z0-9][a-z0-9.-]*$/;
