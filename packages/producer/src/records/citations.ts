/**
 * Citations are slot ids (planner D2): a record cites `<agent>:<slot>` (or a bare `<slot>`), never a
 * version. `resolveCitation` is the one resolver every citation reader uses: it reads the cited slot's
 * pin through the shared slot reader (`slots.ts`) when the citation is read, at compile and derive
 * time, so the cited meaning is whatever that slot pins now. A re-pin upstream re-addresses every
 * citation at once and opens no downstream candidate work: the downstream derive and check steps take
 * the upstream pins as inputs, so they re-run on the moved pin (the cascade, `repinCascade`).
 *
 * The retired versioned form `<slot>@<n>` is recognised here only to be reported (it resolves to
 * nothing) and rewritten once by `clossys migrate citations-to-slots`.
 */
import { parseSlotCitation, versionedCitation, type SlotCitation } from "@clossys/director";
import { CANDIDATE_NAME, type PinDoc, type SlotAgent } from "./slot-model/index.js";
import { slotIndex, type SlotEntry } from "./slots.js";

/** A citation resolved through the cited slot's pin. */
export interface ResolvedCitation {
  readonly agent: SlotAgent;
  readonly slot: string;
  /** The pinned candidate's file name. */
  readonly candidate: string;
  /** The pinned candidate's version (from its file name). */
  readonly version: number;
  /** The pinned candidate's sha256, as its pin records it. */
  readonly sha256: string;
  readonly pin: PinDoc;
}

/** A citation string as a slot citation, or undefined (a URL, a path, a finding, or the retired versioned form). */
export function parseCitation(text: string): SlotCitation | undefined {
  return parseSlotCitation(text);
}

/** Whether a citation string is the retired versioned form `[<agent>:]<slot>@<n>`. */
export function isVersionedCitation(text: string): boolean {
  return versionedCitation(text) !== undefined;
}

/**
 * The pinned candidate a citation names: `<agent>:<slot>` or a bare `<slot>` (slot ids are unique
 * across agents), resolved through that slot's current pin. Undefined when the text is not a slot
 * citation, names a slot that does not exist or belongs to another agent, or the slot has no valid pin.
 * `index` lets a caller resolving many citations read the slot model once (`citationResolver`).
 */
export function resolveCitation(consumer: string, slotId: string, index: ReadonlyMap<string, SlotEntry> = slotIndex(consumer)): ResolvedCitation | undefined {
  const citation = parseSlotCitation(slotId);
  if (!citation) return undefined;
  const entry = index.get(citation.slot);
  if (!entry || (citation.agent !== undefined && citation.agent !== entry.agent) || !entry.pin) return undefined;
  return { agent: entry.agent, slot: entry.id, candidate: entry.pin.candidate, version: Number(CANDIDATE_NAME.exec(entry.pin.candidate)?.[2] ?? 0), sha256: entry.pin.sha256, pin: entry.pin };
}

/** `resolveCitation` over one read of the slot model, for a reader that resolves many citations. */
export function citationResolver(consumer: string): (slotId: string) => ResolvedCitation | undefined {
  const index = slotIndex(consumer);
  return slotId => resolveCitation(consumer, slotId, index);
}

/** One `source.ref` entry of a candidate that cites a slot of `agent`. */
export interface SourceCitation {
  readonly slot: string;
  /** The entry as written. */
  readonly ref: string;
  /** The entry is the retired versioned form; it resolves to nothing. */
  readonly versioned: boolean;
}

/** The `<agent>:<slot>` citations a candidate's frontmatter `source.ref` names, versioned ones flagged. */
export function sourceCitations(fields: Readonly<Record<string, unknown>>, agent: SlotAgent): SourceCitation[] {
  const source = fields.source as { ref?: unknown } | undefined;
  const refs = Array.isArray(source?.ref) ? source!.ref as unknown[] : [];
  return refs.flatMap((ref): SourceCitation[] => {
    if (typeof ref !== "string") return [];
    const citation = parseSlotCitation(ref);
    if (citation?.agent === agent) return [{ slot: citation.slot, ref, versioned: false }];
    const versioned = versionedCitation(ref);
    return versioned?.agent === agent ? [{ slot: versioned.slot, ref, versioned: true }] : [];
  });
}
