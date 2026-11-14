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
 * - the pinned candidate's line anchors (`<ref>@<n>#L<line>`, Writer `directorSources`), which keep a
 *   version, are first re-addressed to the version the pin's `recited` overlay gave them
 *   (`reciteLineAnchors`): readers saw the overlaid bytes, and once `recited` is gone the anchors
 *   must still name those lines.
 * - every pin drops `recited`, and its sha256 is carried to its candidate's rewritten bytes when it
 *   matched those bytes before (or already matches the rewritten ones). The decision itself
 *   (candidate, decidedBy, basis, at, confirmed) is kept. A pin whose sha256 matches neither is a
 *   finding and keeps its sha256.
 *
 * Reads go through the one reader (records/slots.ts), writes through the one writer
 * (`rewriteCitationsInPlace`). Deterministic and idempotent: a second run plans nothing. The verb is
 * a dry run unless `--apply` is given. An apply records one `migrated` event per rewritten file in
 * `<consumer>/evidence/migrations.json`, which is what lets R08.2 accept the in-place change.
 */
import { reciteLineAnchors, slotCitationsInText, type CitationAgent } from "@clossys/director";
import { sha256Hex } from "../records/hash.js";
import { listSlots, readCandidate, readSlotRecordText } from "../records/slots.js";
import { appendMigrationEvents, rewriteCitationsInPlace, type InPlaceRewrite, type RewrittenFile } from "../records/slot-write.js";
import { jsonBytes, SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";

export interface CitationSlotChange {
  readonly agent: SlotAgent;
  readonly slot: string;
  readonly candidates: readonly InPlaceRewrite[];
  /** Versioned citations rewritten across the slot's candidates. */
  readonly citations: number;
  /** Line anchors of the pinned candidate re-addressed to the pin's recited version. */
  readonly anchors: number;
  readonly pin?: { readonly before: string; readonly after: string; readonly recited: boolean; readonly rehashed: boolean };
}
export interface CitationAgentCounts {
  /** Candidates whose bytes change. */
  readonly candidates: number;
  /** Versioned citation tokens rewritten. */
  readonly citations: number;
  /** Line anchors re-addressed to a dropped recite's version. */
  readonly anchors: number;
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
    let citations = 0, anchors = 0;
    const raw = readSlotRecordText(entry.dir, "pin.json");
    let value: unknown;
    if (raw !== undefined) { try { value = JSON.parse(raw); } catch { value = undefined; } }
    const recite = object(value) && object(value.recited) && object(value.recited.cites) ? { candidate: value.candidate, cites: value.recited.cites } : undefined;
    const afterOf = new Map<string, { before: string; after: string }>();
    for (const name of entry.candidates) {
      let before: string;
      try { before = readCandidate(consumer, agent, entry.id, name).bytes; }
      catch (error) { findings.push({ agent, slot: entry.id, message: `${name} could not be read: ${(error as Error).message}` }); continue; }
      const anchored = recite?.candidate === name ? reciteLineAnchors(before, agent, recite.cites) : { text: before, count: 0 };
      const rewritten = slotCitationsInText(anchored.text, owner);
      afterOf.set(name, { before, after: rewritten.text });
      if (rewritten.count || anchored.count) { candidates.push({ name, before, after: rewritten.text }); citations += rewritten.count; anchors += anchored.count; }
    }
    let pin: CitationSlotChange["pin"];
    if (raw !== undefined) {
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
    if (candidates.length || pin) changes.push({ agent, slot: entry.id, candidates, citations, anchors, ...(pin ? { pin } : {}) });
  }
  const zero = (): CitationAgentCounts => ({ candidates: 0, citations: 0, anchors: 0, pins: 0, rehashed: 0 });
  const counts = Object.fromEntries(SLOT_AGENTS.map(agent => [agent, zero()])) as Record<SlotAgent, CitationAgentCounts>;
  const add = (into: CitationAgentCounts, change: CitationSlotChange): CitationAgentCounts => ({
    candidates: into.candidates + change.candidates.length,
    citations: into.citations + change.citations,
    anchors: into.anchors + change.anchors,
    pins: into.pins + (change.pin?.recited ? 1 : 0),
    rehashed: into.rehashed + (change.pin?.rehashed ? 1 : 0),
  });
  let totals = zero();
  for (const change of changes) { counts[change.agent] = add(counts[change.agent], change); totals = add(totals, change); }
  return { changes, counts, totals, findings };
}

/** Who applied the codemod and when, for its `migrated` events. */
export interface CitationsApply { readonly by: string; readonly at: string }

/**
 * Apply a plan through the one writer; each slot is refused alone when its records moved since the
 * plan. Every file a slot's rewrite changed is recorded as one `migrated` event in the migration
 * manifest (records/migrations.ts), the provenance R08.2 accepts for this format-only rewrite.
 */
export function applyCitationsToSlots(consumer: string, plan: CitationsPlan, record: CitationsApply = { by: "planner", at: new Date().toISOString() }): CitationFinding[] {
  const refused: CitationFinding[] = [];
  for (const change of plan.changes) {
    let touched: RewrittenFile[];
    try { touched = rewriteCitationsInPlace(consumer, change.agent, change.slot, { candidates: change.candidates, ...(change.pin ? { pin: { before: change.pin.before, after: change.pin.after } } : {}) }, record); }
    catch (error) { refused.push({ agent: change.agent, slot: change.slot, message: (error as Error).message }); continue; }
    if (touched.length) appendMigrationEvents(consumer, "citations-to-slots", touched, record);
  }
  return refused;
}
