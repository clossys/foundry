/**
 * The Designer's read of Producer's queue (foundry-build-0048 U8, Q1). The Designer keeps no request store of its own:
 * a missing capability is a clossys.queue-entry/2 entry Producer records and routes (`clossys request`), and dogfood
 * only reads the open entries about Designer slots to link its findings to them. Producer owns and validates the
 * queue; this reader takes a well-formed open entry about a Designer slot and skips anything else (a queue-entry/1
 * fix in the same folder, another agent's entry, a file that does not parse), and it never writes.
 *
 * An entry can hold more than one raise: when a raise dedupes onto open work (same kind, target and requester),
 * Producer carries its content into that entry as a later `raised` event (clossys migrate requests does this for the
 * legacy needs it merges). Each such event's why (its detail without the migration note, raiseWhyOf, the Director's one shared format) links a
 * finding to the entry as well, so a merged need is never orphaned.
 */
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { raiseWhyOf } from "@clossys/director";
import type { DogfoodRequest } from "../catalog-core/dogfood.js";

const KINDS = ["slot", "change", "fix"] as const;
const DESIGNER_TARGET = /^designer\/[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
const isDirectory = async (path: string) => { try { return (await fs.lstat(path)).isDirectory(); } catch { return false; } };

/** The consumer folder (the one holding agents/producer) at or above `root`, if any. */
export async function queueConsumerOf(root: string): Promise<string | undefined> {
  for (let dir = root; ; dir = dirname(dir)) {
    if (await isDirectory(join(dir, "agents", "producer"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The open clossys.queue-entry/2 entries about Designer slots under `<consumer>/agents/producer/queue.<kind>/entries`, by id. */
export async function readQueueRequests(consumer: string): Promise<DogfoodRequest[]> {
  const out: DogfoodRequest[] = [];
  for (const kind of KINDS) {
    const dir = join(consumer, "agents", "producer", `queue.${kind}`, "entries");
    if (!await isDirectory(dir)) continue;
    for (const name of (await fs.readdir(dir)).filter(each => each.endsWith(".json")).sort()) {
      let doc: Record<string, unknown> | null;
      try { doc = JSON.parse(await fs.readFile(join(dir, name), "utf8")) as Record<string, unknown> | null; } catch { continue; }
      if (!doc || doc.schema !== "clossys.queue-entry/2" || doc.kind !== kind || doc.status !== "open") continue;
      if (typeof doc.id !== "string" || typeof doc.why !== "string" || typeof doc.target !== "string" || !DESIGNER_TARGET.test(doc.target)) continue;
      const whys = new Set([doc.why]);
      for (const event of Array.isArray(doc.events) ? doc.events.slice(1) : []) {
        const { op, detail } = (event ?? {}) as { op?: unknown; detail?: unknown };
        if (op !== "raised" || typeof detail !== "string") continue;
        whys.add(raiseWhyOf(detail));
      }
      for (const why of whys) out.push({ id: doc.id, why });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
