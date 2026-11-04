/** On-disk paths and canonical bytes for the slot model. Pure; no clock, no I/O. */
import { join } from "node:path";
import { CANDIDATES_DIR, IA_FILE, PIN_FILE, SLOT_FILE, type SlotAgent } from "./types.js";

/** `<consumer>/agents` — the consumer root is the `clossys/` workspace folder. */
export const agentsDir = (consumer: string) => join(consumer, "agents");
export const agentDir = (consumer: string, agent: SlotAgent) => join(consumer, "agents", agent);
export const iaPath = (consumer: string, agent: SlotAgent) => join(agentDir(consumer, agent), IA_FILE);

/**
 * Relative folder of a slot inside its agent folder: the slot id, flat. Grouping
 * lives only in ia.json (and slot.json `ia`), so regrouping never moves a file.
 */
export const slotRel = (slot: string) => slot;
export const slotDir = (consumer: string, agent: SlotAgent, slot: string) => join(agentDir(consumer, agent), slot);
/** Entries of an agent folder that start with `_` (e.g. `_evidence`) are never slot folders. */
export const isNonSlotEntry = (name: string) => name.startsWith("_");
export const slotFile = (dir: string) => join(dir, SLOT_FILE);
export const pinFile = (dir: string) => join(dir, PIN_FILE);
export const candidatesDir = (dir: string) => join(dir, CANDIDATES_DIR);

/** Agent-level files beside ia.json that a current reader owns (never slot folders, never orphans). */
export const AGENT_FILES: Readonly<Record<SlotAgent, readonly string[]>> = {
  director: [], designer: [],
  // Reader: producer/src/publish/site-source.ts readWriter (Writer key declarations).
  writer: ["declarations.json"],
  publisher: [],
};

/** Canonical JSON bytes: two-space indent, trailing newline, insertion key order. */
export const jsonBytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Deep key-sorted copy for order-insensitive comparison. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Candidate file name for a kind-appropriate extension. */
export const candidateName = (name: string, version: number, ext: "md" | "json") => `${name}-v${version}.${ext}`;
