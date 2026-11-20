// Violation fixture for R-ENGINE-SIDE-DOOR: a package source file appends to the event log by hand.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export function logByHand(root, line) {
  appendFileSync(join(root, ".clossys", "events.jsonl"), `${line}\n`);
}
