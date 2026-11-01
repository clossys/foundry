/**
 * F3 re-point: once a consumer carries `agents/<agent>/ia.json`, Studio's
 * inventory reads the slot model instead of tree.json/cells. The response keeps
 * the old AgentCells shape: the tree is the IA (every slot listed, empty ones
 * included), `active` is the pin, and each row shows that pin or the newest draft.
 */
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { candidatesDir, pinFile, validateCandidate } from "../records/slot-model/index.js";
import { listSlots, readCandidate, readIa, readSlot } from "../records/slots.js";
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
    // A present but malformed pin must not turn into an unpinned draft selection.
    if (!entry.pin && existsSync(pinFile(entry.dir))) throw new Error(`Invalid pin: ${entry.id}`);
    const selected = entry.pin?.candidate ?? entry.candidates.at(-1);
    if (!selected) continue;
    const candidate = readCandidate(consumer, agent, entry.id, selected);
    if (entry.pin) {
      if (candidate.sha256 !== entry.pin.sha256) throw new Error(`Candidate hash mismatch: ${entry.id}`);
      if (validateCandidate(readSlot(consumer, agent, entry.id).kind, entry.id, selected, candidate.bytes).length) throw new Error(`Invalid pinned candidate: ${entry.id}`);
      active[entry.id] = versionOf(selected);
    }
    const path = relative(consumer, join(candidatesDir(entry.dir), selected)).split(sep).join("/");
    let fields: Record<string, unknown> = { slot: entry.id, candidate: selected, pinned: entry.pin?.candidate ?? null };
    if (agent === "publisher" && selected.endsWith(".json")) {
      const doc = JSON.parse(candidate.bytes);
      if (doc.schema === "clossys.page/1") {
        fields = { ...fields, ...(doc.meta?.entry?.fields ?? {}), title: doc.title, ...(doc.path === undefined ? { slug: doc.slug } : { path: doc.path }), ...(doc.frame ? { frame: doc.frame, sections: doc.sections } : {}) };
        if (doc.meta?.entry) pageMeta.set(entry.id, doc.meta.entry);
      } else if (doc.schema === "clossys.publication/1" && entry.pin) {
        publications.push({ id: entry.id.slice("publication.".length), format: doc.format, entryOrder: doc.entryOrder, ...(doc.meta?.header ?? {}), ...(doc.routePack === undefined ? {} : { routePack: doc.routePack }) });
      }
    }
    cells.push({ id: entry.id, version: versionOf(selected), status: entry.pin ? "active" : "draft", path, fields });
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
