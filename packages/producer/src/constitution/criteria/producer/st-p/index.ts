/**
 * The Producer seat criteria (ST-P) by id. `index.json` in this folder is the registry of record
 * (R15.3); this map is its static twin for synchronous certification, and agents.test.ts (not shipped) holds the two equal.
 */
import type { Criterion } from "../../core/types.js";
import { assigned, promptOwner } from "./seat.js";

export const PRODUCER_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "seat.assigned": assigned,
  "seat.prompt-owner": promptOwner,
});
