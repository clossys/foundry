/** On-disk paths and canonical bytes for the slot model. Pure; no clock, no I/O. */
import { join } from "node:path";
import { CANDIDATES_DIR, IA_FILE, PIN_FILE, SLOT_FILE, type SlotAgent, type SlotPosition } from "./types.js";

/** `<consumer>/agents` — the consumer root is the `clossys/` workspace folder. */
export const agentsDir = (consumer: string) => join(consumer, "agents");
export const agentDir = (consumer: string, agent: SlotAgent) => join(consumer, "agents", agent);
export const iaPath = (consumer: string, agent: SlotAgent) => join(agentDir(consumer, agent), IA_FILE);

/** Relative folder of a slot inside its agent folder: `<L1>/<L2>/<slot>`. */
export const slotRel = (position: Pick<SlotPosition, "l1" | "l2">, slot: string) => `${position.l1}/${position.l2}/${slot}`;
export const slotDir = (consumer: string, agent: SlotAgent, position: Pick<SlotPosition, "l1" | "l2">, slot: string) => join(agentDir(consumer, agent), position.l1, position.l2, slot);
export const slotFile = (dir: string) => join(dir, SLOT_FILE);
export const pinFile = (dir: string) => join(dir, PIN_FILE);
export const candidatesDir = (dir: string) => join(dir, CANDIDATES_DIR);

/** Legacy store entries that may sit beside the slot folders until F8 deletes them. */
export const LEGACY_ENTRIES: Readonly<Record<SlotAgent, readonly string[]>> = {
  director: ["tree.json", "cells", "compile.json", "findings", "compiled"],
  designer: ["tree.json", "cells", "compile.json", "compiled"],
  writer: ["tree.json", "cells", "compile.json", "compiled"],
  publisher: ["tree.json", "cells", "compile.json", "content-map", "route-pack", "compiled"],
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
