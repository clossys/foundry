/**
 * F3 re-point: once a consumer carries `agents/<agent>/ia.json`, Studio's
 * inventory reads the slot model instead of tree.json/cells. The response keeps
 * the old AgentCells shape: the tree is the IA (every slot listed, empty ones
 * included), `active` is the pin, and each slot's newest candidate is its row.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { candidatesDir } from "../records/slot-model/index.js";
import { listSlots, readIa } from "../records/slots.js";
import type { SlotAgent } from "../records/slot-model/index.js";
import type { AgentCells, CellSummary } from "./contract.js";

const versionOf = (name: string) => Number(/-v(\d+)\.(md|json)$/.exec(name)?.[1] ?? 0);

export function slotInventory(consumer: string, agent: SlotAgent, packageName: string): AgentCells {
  const ia = readIa(consumer, agent);
  if (!ia) return { agent, packageName, state: "missing", cells: [], message: "Agent slots are not initialized" };
  const entries = listSlots(consumer, agent);
  const active: Record<string, number> = {};
  const cells: CellSummary[] = [];
  const publications: Record<string, unknown>[] = [];
  const pageMeta = new Map<string, Record<string, any>>();
  for (const entry of entries) {
    if (entry.pin) active[entry.id] = versionOf(entry.pin.candidate);
    const latest = entry.candidates.at(-1);
    if (!latest) continue;
    const path = relative(consumer, join(candidatesDir(entry.dir), latest)).split(sep).join("/");
    let fields: Record<string, unknown> = { slot: entry.id, candidate: latest, pinned: entry.pin?.candidate ?? null };
    if (agent === "publisher" && latest.endsWith(".json")) {
      const doc = JSON.parse(readFileSync(join(candidatesDir(entry.dir), latest), "utf8"));
      if (doc.schema === "clossys.page/1") {
        fields = { ...fields, ...(doc.meta?.entry?.fields ?? {}), title: doc.title, ...(doc.path === undefined ? { slug: doc.slug } : { path: doc.path }), ...(doc.frame ? { frame: doc.frame, sections: doc.sections } : {}) };
        if (doc.meta?.entry) pageMeta.set(entry.id, doc.meta.entry);
      } else if (doc.schema === "clossys.publication/1" && entry.pin) {
        publications.push({ id: entry.id.slice("publication.".length), format: doc.format, entryOrder: doc.entryOrder, ...(doc.meta?.header ?? {}), ...(doc.routePack === undefined ? {} : { routePack: doc.routePack }) });
      }
    }
    cells.push({ id: entry.id, version: versionOf(latest), status: entry.pin?.candidate === latest ? "active" : "draft", path, fields });
  }
  for (const pub of publications) {
    const entryIds: Record<string, string> = {}, entryMeta: Record<string, unknown> = {};
    for (const [page, meta] of pageMeta) if (meta.publication === pub.id) {
      if (typeof meta.entryId === "string") entryIds[page] = meta.entryId;
      if (meta.entryMeta !== undefined) entryMeta[page] = meta.entryMeta;
    }
    Object.assign(pub, { entryIds, entryMeta });
  }
  const tree = {
    schemaVersion: 1,
    tree: ia.nodes.map(node => ({ id: node.id, name: node.label, children: node.children.map(child => ({ id: child.id, name: child.label, cells: [...child.slots] })) })),
    active, retired: [],
    ...(agent === "publisher" ? { meta: { publications } } : {}),
  };
  return { agent, packageName, state: "ready", tree, cells };
}
