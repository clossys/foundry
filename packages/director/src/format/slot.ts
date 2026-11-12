/**
 * The flat slot model's Director records: `<root>/<slot-id>/{slot.json, candidates/<name>-v<n>.md, pin.json}`.
 * A pinned candidate is read as a `Cell` here, once, for every reader: Director's own
 * readStrategyRoot and the clossys CLI's pinned-set reader (@clossys/producer) both call
 * slotCandidateCell, so there is one candidate parser. Pins are written by `clossys pin`, never here.
 */
import { readBullet } from "../cell-format/markdown.js";
import { parseRef } from "./ref.js";
import type { Bullet, Cell, Ref } from "./types.js";

/** `<name>-v<n>.md`: a Director candidate file name; n is the candidate version. */
export const SLOT_CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.md$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SECTIONS = { "## Direction": "direction", "## Because": "because", "## Watch": "watch" } as const;

/** A pin names one candidate of its slot by file name and by the sha256 of its bytes. */
export interface SlotPin { candidate: string; sha256: string; decidedBy: string; basis: string; at: string; recited?: SlotRecite }
/**
 * A pointer-only update in place (`clossys migrate recite`): the pinned candidate's meaning is unchanged,
 * only the upstream versions it cites moved. `cites` maps `<agent>:<slot>` to the version the record now
 * cites; readers see the pinned bytes with those refs re-addressed (recitedBytes). The pin keeps its
 * candidate, basis and decider; no new version is written.
 */
export interface SlotRecite { by: string; at: string; cites: Record<string, number>; reason?: string }
const CITE_KEY = /^(director|designer|writer|publisher):([a-z0-9][a-z0-9.-]*)$/;

/** The structural shape of a pin's `recited` field, or a message. */
export function parseSlotRecite(value: unknown): { ok: true; value: SlotRecite } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, message: "recited must be {by, at, cites, reason?}" };
  const recite = value as Record<string, unknown>;
  for (const key of Object.keys(recite)) if (!["by", "at", "cites", "reason"].includes(key)) return { ok: false, message: `recited has unknown key ${key}` };
  if (typeof recite.by !== "string" || !/^(?:agent:[a-z][a-z0-9.-]*|planner(?::.+)?)$/.test(recite.by)) return { ok: false, message: "recited.by must be agent:<seat> or planner[:<ref>]" };
  if (typeof recite.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(recite.at) || !Number.isFinite(Date.parse(recite.at))) return { ok: false, message: "recited.at must be an ISO timestamp" };
  if (typeof recite.cites !== "object" || recite.cites === null || Array.isArray(recite.cites) || !Object.keys(recite.cites).length) return { ok: false, message: "recited.cites must map <agent>:<slot> to a version" };
  for (const [key, version] of Object.entries(recite.cites)) {
    if (!CITE_KEY.test(key)) return { ok: false, message: `recited.cites key ${key} is not <agent>:<slot>` };
    if (!Number.isInteger(version) || (version as number) < 1) return { ok: false, message: `recited.cites ${key} must be a version >= 1` };
  }
  if (recite.reason !== undefined && (typeof recite.reason !== "string" || !recite.reason.trim())) return { ok: false, message: "recited.reason must be a non-empty string" };
  return { ok: true, value: { by: recite.by, at: recite.at, cites: { ...(recite.cites as Record<string, number>) }, ...(recite.reason ? { reason: recite.reason as string } : {}) } };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The pinned bytes as the record now cites: every `<agent>:<slot>@<n>` ref (and, for the slot's own agent,
 * a bare `<slot>@<n>`) re-addressed to the version `recited.cites` names. Bytes are hashed against the pin
 * before this; the overlay is what readers parse.
 */
export function recitedBytes(bytes: string, agent: string, recited: Pick<SlotRecite, "cites"> | undefined): string {
  if (!recited) return bytes;
  let out = bytes;
  for (const [key, version] of Object.entries(recited.cites)) {
    const [cited, slot] = key.split(":") as [string, string];
    const prefix = cited === agent ? `(?:${cited}:)?` : `${cited}:`;
    out = out.replace(new RegExp(`(?<![a-z0-9.:-])(${prefix}${escape(slot)})@[1-9][0-9]*(?![0-9])`, "g"), `$1@${version}`);
  }
  return out;
}

/** The structural shape of pin.json; `decidedBy` and `basis` are recorded by `clossys pin`. */
export function parseSlotPin(value: unknown): { ok: true; value: SlotPin } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, message: "Expected a pin object" };
  const pin = value as Record<string, unknown>;
  if (typeof pin.candidate !== "string" || !SLOT_CANDIDATE_NAME.test(pin.candidate)) return { ok: false, message: "Expected candidate <name>-v<n>.md" };
  if (typeof pin.sha256 !== "string" || !SHA256.test(pin.sha256)) return { ok: false, message: "Expected a lowercase hex sha256" };
  for (const key of ["decidedBy", "basis"] as const) if (typeof pin[key] !== "string" || !pin[key]) return { ok: false, message: `Expected a ${key} string` };
  if (typeof pin.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(pin.at) || !Number.isFinite(Date.parse(pin.at))) return { ok: false, message: "Expected an ISO at timestamp" };
  let recited: SlotRecite | undefined;
  if (pin.recited !== undefined) {
    const parsed = parseSlotRecite(pin.recited);
    if (!parsed.ok) return parsed;
    recited = parsed.value;
  }
  return { ok: true, value: { candidate: pin.candidate, sha256: pin.sha256, decidedBy: pin.decidedBy as string, basis: pin.basis as string, at: pin.at, ...(recited ? { recited } : {}) } };
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
  const lists: Record<"direction" | "because" | "watch", Bullet[]> = { direction: [], because: [], watch: [] };
  let section: keyof typeof lists | undefined;
  body.split("\n").forEach((text, index) => {
    if (text.startsWith("## ")) { section = SECTIONS[text.trim() as keyof typeof SECTIONS]; return; }
    if (!section) return;
    const bullet = readBullet(text, firstLine + index) as Bullet | undefined;
    if (bullet) lists[section].push(bullet);
  });
  if (!lists.direction.length) throw new Error(`${input.path}: no Direction bullets`);
  const source = fields.source as { ref?: unknown } | undefined;
  // Finding and cell refs are cites; URLs, paths and session refs (the slot model keeps no sessions) are not.
  const cites: Ref[] = (Array.isArray(source?.ref) ? source!.ref as unknown[] : []).flatMap(ref => {
    const parsed = typeof ref === "string" ? parseRef(ref) : undefined;
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
