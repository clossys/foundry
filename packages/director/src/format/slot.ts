/**
 * The flat slot model's Director records: `<root>/<slot-id>/{slot.json, candidates/<name>-v<n>.md, pin.json}`.
 * A pinned candidate is read as a `Cell` here, once, for every reader: Director's own
 * readStrategyRoot and the clossys CLI's pinned-set reader (@clossys/producer) both call
 * slotCandidateCell, so there is one candidate parser. Pins are written by `clossys pin`, never here.
 * A candidate cites Director slots by id (`<slot>` or `director:<slot>`, format/citation.ts); the reader
 * resolves each through the cited slot's pin, so a cell ref's version is the pinned version at read time.
 */
import { readBullet } from "../cell-format/markdown.js";
import { parseSlotCitation, versionedCitation, versionedCitationMessage } from "./citation.js";
import { pinIssues } from "./pin.js";
import { parseRef } from "./ref.js";
import type { Bullet, Cell, Ref } from "./types.js";

/** `<name>-v<n>.md`: a Director candidate file name; n is the candidate version. */
export const SLOT_CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.md$/;
const SECTIONS = { "## Direction": "direction", "## Because": "because", "## Watch": "watch" } as const;

/** A pin names one candidate of its slot by file name and by the sha256 of its bytes (the one pin schema, format/pin.ts). */
export interface SlotPin { candidate: string; sha256: string; decidedBy: string; basis: string; at: string; confirmed?: { by: string; ref: string; at: string } }

/**
 * pin.json against the one pin schema (format/pin.ts), the same verdict as @clossys/producer validatePin and
 * scripts/check-decisions.mjs. That a Director pin names a Markdown candidate is the store's rule, not the schema's.
 */
export function parseSlotPin(value: unknown): { ok: true; value: SlotPin } | { ok: false; message: string } {
  const issues = pinIssues(value);
  if (issues.length) return { ok: false, message: issues.join("; ") };
  const pin = value as SlotPin;
  return { ok: true, value: { candidate: pin.candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis, at: pin.at, ...(pin.confirmed ? { confirmed: { by: pin.confirmed.by, ref: pin.confirmed.ref, at: pin.confirmed.at } } : {}) } };
}

/** The candidate version a file name carries, or undefined for a name that is not a candidate. */
export function slotCandidateVersion(name: string): number | undefined {
  const match = SLOT_CANDIDATE_NAME.exec(name);
  return match ? Number(match[2]) : undefined;
}

/**
 * Whether a cell path names a pinned slot candidate (`…/<slot-id>/candidates/<name>-v<n>.md`).
 * Such a cell is active by its pin, which records who decided it (`decidedBy`, `basis`).
 */
export function isSlotCandidatePath(id: string, path: string): boolean {
  const prefix = `${id}/candidates/`;
  const at = path.lastIndexOf(prefix);
  return at >= 0 && (at === 0 || path[at - 1] === "/") && SLOT_CANDIDATE_NAME.test(path.slice(at + prefix.length));
}

/** Candidate frontmatter is one `key: <JSON value>` line per field between `---` lines. */
export function parseSlotCandidateDocument(bytes: string): { ok: true; value: { fields: Record<string, unknown>; body: string; firstLine: number } } | { ok: false; message: string } {
  if (!bytes.startsWith("---\n")) return { ok: false, message: "expected frontmatter opening ---" };
  const end = bytes.indexOf("\n---\n", 3);
  if (end < 0) return { ok: false, message: "expected frontmatter closing ---" };
  const fields: Record<string, unknown> = {};
  for (const line of bytes.slice(4, end).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*): (.*)$/.exec(line);
    if (!match) return { ok: false, message: `invalid frontmatter line "${line}"` };
    if (Object.hasOwn(fields, match[1]!)) return { ok: false, message: `duplicate frontmatter key ${match[1]}` };
    try { fields[match[1]!] = JSON.parse(match[2]!); } catch { return { ok: false, message: `frontmatter ${match[1]} is not a JSON value` }; }
  }
  const body = bytes.slice(end + 5);
  return { ok: true, value: { fields, body, firstLine: bytes.slice(0, bytes.length - body.length).split("\n").length } };
}

export interface SlotCandidateInput {
  /** The slot id (= catalog cell id). */
  id: string;
  /** The candidate version, from its file name. */
  version: number;
  /** Calendar date the pin was made (the pin's `at`, YYYY-MM-DD). */
  updated: string;
  /** Reported path of the candidate file. */
  path: string;
  bytes: string;
  /**
   * The pinned version of a cited Director slot, or undefined when it has no pin. A citation resolves
   * through it when the candidate is read; an unresolved one is kept as `{cell, version: 0}` (cites a
   * slot with no pin), which no cell matches, so the checks report it dangling.
   */
  resolve?: (slot: string) => number | undefined;
}

/**
 * A pinned candidate as an active Cell: Direction, Because and Watch bullets, finding and cell refs of
 * `source.ref` as cites, `feeds`, `functions` and `note` from frontmatter. Throws `<path>: <reason>`
 * when the candidate cannot be read as a cell.
 */
export function slotCandidateCell(input: SlotCandidateInput): Cell {
  const parsed = parseSlotCandidateDocument(input.bytes);
  if (!parsed.ok) throw new Error(`${input.path}: ${parsed.message}`);
  const { fields, body, firstLine } = parsed.value;
  if (fields.slot !== undefined && fields.slot !== input.id) throw new Error(`${input.path}: frontmatter slot disagrees with its slot folder`);
  const cite = (text: string): Ref | undefined | null => citationRef(text, input);
  const lists: Record<"direction" | "because" | "watch", Bullet[]> = { direction: [], because: [], watch: [] };
  let section: keyof typeof lists | undefined;
  body.split("\n").forEach((text, index) => {
    if (text.startsWith("## ")) { section = SECTIONS[text.trim() as keyof typeof SECTIONS]; return; }
    if (!section) return;
    const bullet = readBullet(text, firstLine + index) as Bullet | undefined;
    if (bullet) lists[section].push({ ...bullet, refs: bulletRefs(bullet.text, cite) });
  });
  if (!lists.direction.length) throw new Error(`${input.path}: no Direction bullets`);
  const source = fields.source as { ref?: unknown } | undefined;
  // Finding and Director slot citations are cites; URLs, paths, other agents' slots and session refs (the slot model keeps no sessions) are not.
  const cites: Ref[] = (Array.isArray(source?.ref) ? source!.ref as unknown[] : []).flatMap(ref => {
    const parsed = typeof ref === "string" ? cite(ref) : undefined;
    return parsed && parsed.kind !== "msg" ? [parsed] : [];
  });
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    id: input.id, version: input.version, status: "active", updated: input.updated,
    cites, feeds: strings(fields.feeds), functions: strings(fields.functions),
    ...(typeof fields.note === "string" ? { note: fields.note } : {}),
    direction: lists.direction, because: lists.because, watch: lists.watch, path: input.path,
  };
}

/**
 * One citation of a Director candidate as a Ref: a finding or session ref as written, a Director slot id
 * resolved to its pinned version. Undefined for text that is no citation; null for another agent's slot.
 * A versioned citation is refused: the model carries no cited version.
 */
function citationRef(text: string, input: SlotCandidateInput): Ref | undefined | null {
  if (versionedCitation(text)) throw new Error(`${input.path}: ${versionedCitationMessage(text)}`);
  const slot = parseSlotCitation(text);
  if (slot) {
    if (slot.agent !== undefined && slot.agent !== "director") return null;
    return { kind: "cell", ref: { cell: slot.slot, version: input.resolve?.(slot.slot) ?? 0 } };
  }
  const ref = parseRef(text);
  return ref && ref.kind !== "cell" ? ref : undefined;
}

/** A bullet's trailing parenthesised citation list, when every entry is a citation; prose parentheses stay prose. */
function bulletRefs(text: string, cite: (text: string) => Ref | undefined | null): Ref[] {
  const suffix = /\(([^()]*)\)[.!?]?$/.exec(text);
  if (!suffix) return [];
  const parts = suffix[1]!.split(",").map(part => part.trim());
  // A versioned token anywhere in the list is refused even beside prose.
  for (const part of parts) if (versionedCitation(part)) cite(part);
  const refs = parts.map(cite);
  return refs.every((ref): ref is Ref => ref !== undefined && ref !== null) ? refs : [];
}
