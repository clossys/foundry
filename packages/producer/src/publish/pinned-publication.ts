/**
 * A pinned publication, read through the one slot-model reader (`records/slots.ts`) and
 * projected by Publisher's pure `projectPinnedPublication`. `consumer` is the `clossys/`
 * folder. Publisher opens no files; there is no second reader and no legacy fallback.
 */
import { projectPinnedPublication, type PinnedPublication } from "@clossys/publisher/content-map";
import { readAgentFile, readCandidate, readSlotRecordText } from "../records/slots.js";
import { slotDir } from "../records/slot-model/index.js";

export type { PinnedPublication };

export async function readPinnedPublication(consumer: string, publicationId: string): Promise<PinnedPublication> {
  return projectPinnedPublication({
    ia: () => readAgentFile(consumer, "publisher", "ia.json"),
    record: (id, file) => readSlotRecordText(slotDir(consumer, "publisher", id), file),
    candidate: (id, name) => {
      try { return readCandidate(consumer, "publisher", id, name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
  }, publicationId);
}
