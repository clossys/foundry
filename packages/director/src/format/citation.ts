/**
 * Citations name slot ids (planner D2). A record cites `<slot>` (a slot of its own agent) or
 * `<agent>:<slot>`; it never names a version. What a citation means is the cited slot's pinned
 * candidate, resolved when the citation is read (compile and derive time): Director's store through
 * its own pins, @clossys/producer's `resolveCitation` through the slot model. A re-pin upstream
 * therefore re-addresses every citation at once and opens no downstream candidate work; the
 * downstream derive and check steps re-run on the moved pin instead (the cascade).
 *
 * The retired `<slot>@<n>` form is recognised only to be refused (`versionedCitation`) and to be
 * rewritten once by `clossys migrate citations-to-slots`.
 */

export const CITATION_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type CitationAgent = typeof CITATION_AGENTS[number];
/** A slot id: `<layer>.<name>` with one to three dotted segments after the first (the slot model's SLOT_ID). */
export const CITATION_SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;
const SLOT_SOURCE = "[a-z][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*){1,3}";
const AGENT_SOURCE = `(?:(${CITATION_AGENTS.join("|")}):)?`;

/** One citation: a slot id, and the agent that owns it when the citation names one. */
export interface SlotCitation { readonly agent?: CitationAgent; readonly slot: string }
/** A retired versioned citation (`[<agent>:]<slot>@<n>`) as written. */
export interface VersionedCitation extends SlotCitation { readonly version: number; readonly text: string }

const WHOLE = new RegExp(`^${AGENT_SOURCE}(${SLOT_SOURCE})$`);
const WHOLE_VERSIONED = new RegExp(`^${AGENT_SOURCE}(${SLOT_SOURCE})@([1-9][0-9]*)$`);
/**
 * Every versioned citation token in free text (frontmatter, bullets, JSON string values). A token
 * starts at a word boundary that is not part of a path, package scope or another id, so `npm/x@1.2.3`
 * and `@scope/x@1` never match, nor does `x@18` inside `x@18.3.1`; a sentence's closing period ends a
 * token. A match still names a slot only when that slot exists (callers check).
 */
export const VERSIONED_CITATION_IN_TEXT = new RegExp(`(?<![A-Za-z0-9._:/@-])${AGENT_SOURCE}(${SLOT_SOURCE})@([1-9][0-9]*)(?![0-9]|\\.[0-9])`, "g");

/**
 * A line anchor, not a citation: a line number only means something in the bytes of one version, so a
 * versioned ref followed by `#L<n>` / `#direction-L<n>`, or written as `{"ref": "<ref>", "line": <n>}`
 * (Writer `directorSources`), keeps its version until the Writer and Designer packages move line anchors.
 */
export function isLineAnchor(text: string, index: number, token: string): boolean {
  const after = text.slice(index + token.length, index + token.length + 32);
  return /^#(?:direction-)?L[1-9]/.test(after) || (/"ref"\s*:\s*"$/.test(text.slice(Math.max(0, index - 16), index)) && /^"\s*,\s*"line"\s*:/.test(after));
}

/** A whole-string slot citation (`<slot>` or `<agent>:<slot>`), or undefined. A versioned citation is not one. */
export function parseSlotCitation(text: string): SlotCitation | undefined {
  const match = WHOLE.exec(text);
  if (!match) return undefined;
  return match[1] ? { agent: match[1] as CitationAgent, slot: match[2]! } : { slot: match[2]! };
}

/** A whole-string retired versioned citation, or undefined. */
export function versionedCitation(text: string): VersionedCitation | undefined {
  const match = WHOLE_VERSIONED.exec(text);
  if (!match) return undefined;
  return { ...(match[1] ? { agent: match[1] as CitationAgent } : {}), slot: match[2]!, version: Number(match[3]), text };
}

/** Every retired versioned citation token in free text, in order; line anchors (`isLineAnchor`) are not citations. */
export function versionedCitationsInText(text: string): VersionedCitation[] {
  return [...text.matchAll(VERSIONED_CITATION_IN_TEXT)].filter(match => !isLineAnchor(text, match.index, match[0])).map(match => ({ ...(match[1] ? { agent: match[1] as CitationAgent } : {}), slot: match[2]!, version: Number(match[3]), text: match[0] }));
}

/**
 * `text` with every versioned citation of a known slot rewritten to its slot citation (`need.x@2` ->
 * `need.x`, `writer:copy.y@3` -> `writer:copy.y`), and how many were rewritten. `owner` names the
 * agent that owns a slot id, or undefined for a token that is no slot (a package version, a path):
 * that token, one whose agent prefix names another agent, and a line anchor stay as written. Idempotent.
 */
export function slotCitationsInText(text: string, owner: (slot: string) => CitationAgent | undefined): { text: string; count: number } {
  let count = 0;
  const rewritten = text.replace(VERSIONED_CITATION_IN_TEXT, (token: string, agent: string | undefined, slot: string, _version: string, index: number, whole: string) => {
    if (isLineAnchor(whole, index, token)) return token;
    const owned = owner(slot);
    if (!owned || (agent !== undefined && agent !== owned)) return token;
    count++;
    return agent ? `${agent}:${slot}` : slot;
  });
  return { text: rewritten, count };
}

/**
 * `text` (a pinned candidate of `agent`) with each line anchor re-addressed to the version its pin's
 * retired `recited` overlay gave it (`cites`: `<agent>:<slot>` -> version), and how many moved. The
 * overlay re-addressed every versioned ref of the pinned bytes when they were read; a pointer-only
 * recite attested that the cited lines are unchanged in that version. `slotCitationsInText` turns the
 * citations into slot ids but keeps line anchors, so the codemod writes this first and the anchors
 * still name the lines readers saw once `recited` is dropped. A bare ref names `agent`'s own slot, as
 * the overlay read it. Idempotent.
 */
export function reciteLineAnchors(text: string, agent: CitationAgent, cites: Readonly<Record<string, unknown>>): { text: string; count: number } {
  let count = 0;
  const rewritten = text.replace(VERSIONED_CITATION_IN_TEXT, (token: string, cited: string | undefined, slot: string, version: string, index: number, whole: string) => {
    if (!isLineAnchor(whole, index, token)) return token;
    const to = cites[`${cited ?? agent}:${slot}`];
    if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to === Number(version)) return token;
    count++;
    return `${cited ? `${cited}:` : ""}${slot}@${to}`;
  });
  return { text: rewritten, count };
}

/** `<agent>:<slot>`, or the bare slot for a citation that names no agent. */
export function formatSlotCitation(citation: SlotCitation): string {
  return citation.agent ? `${citation.agent}:${citation.slot}` : citation.slot;
}

/** The message every reader gives a versioned citation it refuses. */
export function versionedCitationMessage(text: string): string {
  return `versioned citation ${text}: a citation names a slot id and resolves through that slot's pin (clossys migrate citations-to-slots)`;
}
