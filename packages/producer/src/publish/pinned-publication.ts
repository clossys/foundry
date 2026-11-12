/**
 * A pinned publication, read through the one slot-model reader (`records/slots.ts`) and
 * projected by Publisher's pure `projectPinnedPublication`. `consumer` is the `clossys/`
 * folder. Publisher opens no files; there is no second reader and no legacy fallback.
 */
import { projectPinnedPublication, type PinnedPublication } from "@clossys/publisher/content-map";
import { recitedBytes } from "@clossys/director";
import { listSlots, readAgentFile, readCandidate, readPin, readSlotRecordText } from "../records/slots.js";
import { slotDir } from "../records/slot-model/index.js";
import { WRITER_KEY, writerCopy } from "../records/writer-copy.js";

export type { PinnedPublication };

export async function readPinnedPublication(consumer: string, publicationId: string): Promise<PinnedPublication> {
  return projectPinnedPublication({
    ia: () => readAgentFile(consumer, "publisher", "ia.json"),
    record: (id, file) => readSlotRecordText(slotDir(consumer, "publisher", id), file),
    candidate: (id, name) => {
      // The pinned candidate as it now cites (a pointer-only re-cite re-addresses refs; the sha stays the raw one).
      try { const read = readCandidate(consumer, "publisher", id, name), pin = readPin(consumer, "publisher", id); return pin?.candidate === name ? { ...read, bytes: recitedBytes(read.bytes, "publisher", pin.recited) } : read; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
  }, publicationId);
}

/**
 * A pinned publication with its titles resolved through the Writer: every content-map entry title
 * (a page record's `title`, a tree group's `name`) and every route label is a Writer key the
 * projection turns into the pinned text. Every name in the pinned publication tree is a Writer key
 * too. A literal title or tree name is refused, and so is a key the pinned Writer copy does not
 * register: what a person reads in a title, a tab, a trail or the document title comes from a
 * Writer key, never from a record. Any namespace the consumer's Writer registers is a key.
 */
export function resolvePublicationTitles(consumer: string, pinned: PinnedPublication): PinnedPublication {
  const copy = writerCopy(consumer);
  const publicationId = pinned.map.publicationId;
  const refuse = (what: string, value: unknown): never => {
    if (typeof value === "string" && WRITER_KEY.test(value)) throw new Error(`Publication ${publicationId}: ${what} names ${JSON.stringify(value)}, which no pinned Writer string registers`);
    throw new Error(`Publication ${publicationId}: ${what} is a literal ${JSON.stringify(value)}; it must be a Writer key`);
  };
  const title = (owner: string, value: unknown): string => {
    if (typeof value !== "string" || !copy.has(value)) return refuse(`${owner} title`, value);
    return copy.text(value);
  };
  for (const node of pinnedTreeNodes(consumer, publicationId)) if (typeof node.name !== "string" || !copy.has(node.name)) refuse(`tree node ${node.id} name`, node.name);
  const entries = pinned.map.entries.map(entry => ({ ...entry, title: title(entry.id, entry.title) }));
  const map = { ...pinned.map, entries } as PinnedPublication["map"];
  if (!pinned.routePack) return { ...pinned, map };
  const routes = (pinned.routePack.routes as readonly Record<string, unknown>[]).map(route => ({ ...route, label: title(String(route.instanceId), route.label) }));
  return { ...pinned, map, routePack: { ...pinned.routePack, routes } } as PinnedPublication;
}

/** Every node of the pinned publication's tree snapshot (`meta.tree`), root first. */
function pinnedTreeNodes(consumer: string, publicationId: string): { id: unknown; name: unknown }[] {
  const entry = listSlots(consumer, "publisher").find(row => row.id === `publication.${publicationId}`);
  if (!entry?.pin) return [];
  const read = readCandidate(consumer, "publisher", entry.id, entry.pin.candidate);
  if (read.sha256 !== entry.pin.sha256) throw new Error(`Publication ${publicationId}: the pinned publication candidate drifted from its pin`);
  const tree = (JSON.parse(read.bytes) as { meta?: { tree?: unknown } }).meta?.tree;
  const nodes: { id: unknown; name: unknown }[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const { id, name, children } = node as { id?: unknown; name?: unknown; children?: unknown };
    nodes.push({ id, name });
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  walk(tree);
  return nodes;
}
