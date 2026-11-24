/**
 * `clossys migrate placement`: backfills the SLOT-CREATE decision on slots placed before placement recorded it.
 *
 * A new placement (`clossys ia --under`, cli/owner.ts) appends one `slot` ledger event with `decision: "create"` and
 * the `overlaps` placementOverlaps found. A slot placed before that code has no such event. For every placed slot of a
 * content agent whose ledger holds no `op: "slot"` event deciding reuse or create with an overlaps list, this appends
 * one: verb migrate, by producer, `decision: "create"`, `overlaps` from the same placementOverlaps over the agent's
 * placed slots (the slot itself excluded), marked `migration: "placement"`. No overlap reason and no owner sign are
 * invented: a non-empty list is recorded as found. A second run appends nothing.
 */
import { CONTENT_AGENTS, placementOverlaps, type ContentAgent, type Overlap } from "../records/request.js";
import { listSlots, readLedger, readSlot } from "../records/slots.js";
import { appendSlotDocEvent } from "../records/slot-write.js";
import { actionContractPath } from "../records/ledger.js";

export const PLACEMENT_MIGRATION = "placement";

export interface PlacementBackfill {
  readonly agent: ContentAgent;
  readonly slot: string;
  readonly overlaps: readonly Overlap[];
}
export interface PlacementPlan {
  /** Placed content-agent slots read. */
  readonly slots: number;
  /** The slots whose ledger records no reuse-or-create decision, in agent then IA order. */
  readonly pending: readonly PlacementBackfill[];
  readonly findings: readonly string[];
}

/** Whether a ledger event is the placement decision the L2 conform cell reads. */
export function isPlacementDecision(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const value = event as Record<string, unknown>;
  return value.op === "slot" && (value.decision === "reuse" || value.decision === "create") && Array.isArray(value.overlaps);
}

export function planPlacementBackfill(consumer: string): PlacementPlan {
  const pending: PlacementBackfill[] = [], findings: string[] = [];
  let slots = 0;
  for (const agent of CONTENT_AGENTS) {
    for (const entry of listSlots(consumer, agent)) {
      slots++;
      let events: readonly unknown[];
      try { events = readLedger(entry.dir, "slot")?.events ?? []; } catch (error) { findings.push(`${agent}/${entry.id}: ledger.json does not read: ${(error as Error).message}`); continue; }
      if (events.some(isPlacementDecision)) continue;
      let doc;
      try { doc = readSlot(consumer, agent, entry.id); } catch (error) { findings.push(`${agent}/${entry.id}: slot.json does not read: ${(error as Error).message}`); continue; }
      const self = `${agent}/${entry.id}`;
      const overlaps = placementOverlaps(consumer, agent, { slot: entry.id, kind: String(doc.kind), l1: entry.position.l1, l2: entry.position.l2, inputs: doc.inputs, contract: doc.contract })
        .filter(item => item.slot !== self);
      pending.push({ agent, slot: entry.id, overlaps });
    }
  }
  return { slots, pending, findings };
}

/** Appends one create decision per pending slot; returns the slots written. */
export function applyPlacementBackfill(consumer: string, plan: PlacementPlan, at: string): string[] {
  const written: string[] = [];
  for (const item of plan.pending) {
    appendSlotDocEvent(consumer, item.agent, item.slot, {
      by: "producer", at, verb: "migrate", skill: actionContractPath("producer", "migrate"),
      fields: { migration: PLACEMENT_MIGRATION, decision: "create", overlaps: item.overlaps.map(overlap => ({ ...overlap })) },
    });
    written.push(`${item.agent}/${item.slot}`);
  }
  return written;
}
