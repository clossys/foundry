/**
 * A pinned publication, read through the one slot-model reader (`records/slots.ts`) and
 * projected by Publisher's pure `projectPinnedPublication`. `consumer` is the `clossys/`
 * folder. Publisher opens no files; there is no second reader and no legacy fallback.
 */
import { projectPinnedPublication, type PinnedPublication } from "@clossys/publisher/content-map";
import { readAgentFile, readCandidate, readSlotRecordText } from "../records/slots.js";
import { slotDir } from "../records/slot-model/index.js";
import { WRITER_KEY, writerCopy } from "../records/writer-copy.js";

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

/**
 * A pinned publication with its titles resolved through the Writer: every content-map entry title
 * (a page record's `title`, a tree group's `name`) and every route label is a Writer key the
 * projection turns into the pinned text. A literal title is refused: what a person reads in a
 * title, a tab, a trail or the document title comes from a Writer key, never from a record.
 */
export function resolvePublicationTitles(consumer: string, pinned: PinnedPublication): PinnedPublication {
  const copy = writerCopy(consumer);
  const title = (owner: string, value: unknown): string => {
    if (typeof value !== "string" || !WRITER_KEY.test(value)) throw new Error(`Publication ${pinned.map.publicationId}: ${owner} has a literal title ${JSON.stringify(value)}; a title is a Writer key`);
    return copy.text(value);
  };
  const entries = pinned.map.entries.map(entry => ({ ...entry, title: title(entry.id, entry.title) }));
  const map = { ...pinned.map, entries } as PinnedPublication["map"];
  if (!pinned.routePack) return { ...pinned, map };
  const routes = (pinned.routePack.routes as readonly Record<string, unknown>[]).map(route => ({ ...route, label: title(String(route.instanceId), route.label) }));
  return { ...pinned, map, routePack: { ...pinned.routePack, routes } } as PinnedPublication;
}
