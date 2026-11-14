/**
 * `clossys migrate citations-to-slots` (planner D2): a citation names a slot id and resolves through
 * that slot's pin when it is read (records/citations.ts), so the retired versioned form and the pin's
 * `recited` overlay are rewritten once:
 *
 * - every candidate's versioned citations of a known slot (`need.x@2`, `director:need.x@2`, in
 *   frontmatter `source.ref` and in text alike) become the slot citation (`need.x`,
 *   `director:need.x`). A token that names no slot of the model (a package version such as
 *   `react@18`, a path), or whose agent prefix names another agent's slot, stays as written;
 *   an apply marker or judgement id (`strategy:<cell>@<n>`, `Q<n>:<cell>@<n>`) is not a citation
 *   token and is never matched.
 * - every pin drops `recited`, and its sha256 is carried to its candidate's rewritten bytes when it
 *   matched those bytes before (or already matches the rewritten ones). The decision itself
 *   (candidate, decidedBy, basis, at, confirmed) is kept. A pin whose sha256 matches neither is a
 *   finding and keeps its sha256.
 *
 * Reads go through the one reader (records/slots.ts), writes through the one writer
 * (`rewriteCitationsInPlace`). Deterministic and idempotent: a second run plans nothing. The verb is
 * a dry run unless `--apply` is given.
 */
import { slotCitationsInText, type CitationAgent } from "@clossys/director";
import { sha256Hex } from "../records/hash.js";
import { listSlots, readCandidate, readSlotRecordText } from "../records/slots.js";
import { rewriteCitationsInPlace, type InPlaceRewrite } from "../records/slot-write.js";
import { jsonBytes, SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";

export interface CitationSlotChange {
  readonly agent: SlotAgent;
  readonly slot: string;
  readonly candidates: readonly InPlaceRewrite[];
  /** Versioned citations rewritten across the slot's candidates. */
  readonly citations: number;
  readonly pin?: { readonly before: string; readonly after: string; readonly recited: boolean; readonly rehashed: boolean };
}
export interface CitationAgentCounts {
  /** Candidates whose bytes change. */
  readonly candidates: number;
  /** Versioned citation tokens rewritten. */
  readonly citations: number;
  /** Pins that drop `recited`. */
  readonly pins: number;
  /** Pins whose sha256 is carried to rewritten candidate bytes. */
  readonly rehashed: number;
}
export interface CitationFinding { readonly agent: SlotAgent; readonly slot: string; readonly message: string }
export interface CitationsPlan {
  readonly changes: readonly CitationSlotChange[];
  readonly counts: Readonly<Record<SlotAgent, CitationAgentCounts>>;
  readonly totals: CitationAgentCounts;
  readonly findings: readonly CitationFinding[];
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The plan: every candidate and pin the codemod rewrites, with counts per agent. Reads only. */
export function planCitationsToSlots(consumer: string): CitationsPlan {
  const slotsOf = new Map(SLOT_AGENTS.map(agent => [agent, listSlots(consumer, agent)] as const));
  const owners = new Map<string, CitationAgent>();
  for (const [agent, slots] of slotsOf) for (const entry of slots) owners.set(entry.id, agent);
  const owner = (slot: string) => owners.get(slot);
  const changes: CitationSlotChange[] = [];
  const findings: CitationFinding[] = [];
  for (const [agent, slots] of slotsOf) for (const entry of slots) {
    const candidates: InPlaceRewrite[] = [];
    let citations = 0;
    const afterOf = new Map<string, { before: string; after: string }>();
    for (const name of entry.candidates) {
      let before: string;
      try { before = readCandidate(consumer, agent, entry.id, name).bytes; }
      catch (error) { findings.push({ agent, slot: entry.id, message: `${name} could not be read: ${(error as Error).message}` }); continue; }
      const rewritten = slotCitationsInText(before, owner);
      afterOf.set(name, { before, after: rewritten.text });
      if (rewritten.count) { candidates.push({ name, before, after: rewritten.text }); citations += rewritten.count; }
    }
    let pin: CitationSlotChange["pin"];
    const raw = readSlotRecordText(entry.dir, "pin.json");
    if (raw !== undefined) {
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = undefined; }
      if (!object(value)) findings.push({ agent, slot: entry.id, message: "pin.json is not a JSON object; left as it is" });
      else {
        const { recited, ...kept } = value;
        const recitedKey = Object.prototype.hasOwnProperty.call(value, "recited");
        void recited;
        const bytes = typeof kept.candidate === "string" ? afterOf.get(kept.candidate) : undefined;
        let rehashed = false;
        if (bytes && bytes.before !== bytes.after) {
          const from = sha256Hex(bytes.before), to = sha256Hex(bytes.after);
          if (kept.sha256 === from) { kept.sha256 = to; rehashed = true; }
          else if (kept.sha256 !== to) findings.push({ agent, slot: entry.id, message: `pin sha256 matches neither ${String(kept.candidate)} nor its rewritten bytes; sha256 left as it is` });
        }
        if (recitedKey || rehashed) pin = { before: raw, after: jsonBytes(kept), recited: recitedKey, rehashed };
      }
    }
    if (candidates.length || pin) changes.push({ agent, slot: entry.id, candidates, citations, ...(pin ? { pin } : {}) });
  }
  const zero = (): CitationAgentCounts => ({ candidates: 0, citations: 0, pins: 0, rehashed: 0 });
  const counts = Object.fromEntries(SLOT_AGENTS.map(agent => [agent, zero()])) as Record<SlotAgent, CitationAgentCounts>;
  const add = (into: CitationAgentCounts, change: CitationSlotChange): CitationAgentCounts => ({
    candidates: into.candidates + change.candidates.length,
    citations: into.citations + change.citations,
    pins: into.pins + (change.pin?.recited ? 1 : 0),
    rehashed: into.rehashed + (change.pin?.rehashed ? 1 : 0),
  });
  let totals = zero();
  for (const change of changes) { counts[change.agent] = add(counts[change.agent], change); totals = add(totals, change); }
  return { changes, counts, totals, findings };
}

/** Apply a plan through the one writer; each slot is refused alone when its records moved since the plan. */
export function applyCitationsToSlots(consumer: string, plan: CitationsPlan): CitationFinding[] {
  const refused: CitationFinding[] = [];
  for (const change of plan.changes) {
    try { rewriteCitationsInPlace(consumer, change.agent, change.slot, { candidates: change.candidates, ...(change.pin ? { pin: { before: change.pin.before, after: change.pin.after } } : {}) }); }
    catch (error) { refused.push({ agent: change.agent, slot: change.slot, message: (error as Error).message }); }
  }
  return refused;
}
