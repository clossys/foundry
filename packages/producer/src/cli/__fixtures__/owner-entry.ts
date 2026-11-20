/** Tests import the owner queue entry writer from here; it lives in src/pipeline/owner-entry.ts, which the package ships. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { entryFile } from "../../pipeline/owner-entry.js";

export * from "../../pipeline/owner-entry.js";

/** Write any bytes at a queue entry path (`{}`, an untyped object, non-JSON), for the refusals, and return its `--by` ref. */
export function bareEntry(consumer: string, queue: string, id: string, bytes = `${JSON.stringify({ id, kind: "queue-entry" })}\n`): string {
  const file = entryFile(consumer, queue, id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return `owner:queue.${queue}#${id}`;
}
