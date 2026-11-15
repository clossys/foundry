/**
 * `ia.orphans` (system.md 9): every consumer slot folder is reachable from a publication in
 * `clossys/agents/publisher/ia.json`. It walks consumer slot folders only (never the package tree).
 *
 * roots     = each publication's pages, chrome and release slots
 * forward   = from a reached slot: its `refs` (input, uses, places), its `brief.inputs`, and the refs of its pinned
 *             candidate (header `refs` plus every `<agent>/<slot-id>` string, value or key, in a JSON candidate's content;
 *             a release manifest names its pins as keys)
 * backward  = a slot whose `consumedBy` ref names a reached slot is reached
 * orphans   = every slot folder minus reached minus Producer `loop.*` slots (exempt by design)
 *
 * A folder with no readable `slot.json` is still a slot folder: it is reached only through the edges of others.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOT_SCHEMA, consumerSlotFolders, readSlot, slotSchemaOf, treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import type { Ref, Slot } from "../records/types.js";

export const IA_ORPHANS = "ia.orphans";

const SLOT_REF = /^(director|designer|writer|publisher|producer)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?:[/#:].*)?$/;
const WALKED: ReadonlySet<Ref["rel"]> = new Set(["input", "uses", "places"]);

const slotOf = (to: string): string | undefined => {
  const match = SLOT_REF.exec(to);
  return match ? `${match[1]}/${match[2]}` : undefined;
};

/** The publication roots of the consumer: `publisher/<slot-id>` for every page, chrome and release slot. */
export function publicationRoots(root: string): { roots: string[]; findings: TreeFinding[] } {
  const file = join(root, "clossys", "agents", "publisher", "ia.json");
  if (!existsSync(file)) return { roots: [], findings: [{ subject: "publisher/ia.json", detail: "missing: no publication roots" }] };
  let doc: { publications?: Record<string, { pages?: unknown; chrome?: unknown; release?: unknown }> };
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { roots: [], findings: [{ subject: "publisher/ia.json", detail: `not JSON: ${(error as Error).message}` }] }; }
  const roots: string[] = [];
  for (const publication of Object.values(doc.publications ?? {})) {
    const ids = [...asStrings(publication.pages), ...asStrings(publication.chrome), ...asStrings(publication.release)];
    for (const id of ids) roots.push(`publisher/${id}`);
  }
  return { roots, findings: [] };
}

function asStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function candidateEdges(dir: string): string[] {
  const pinFile = join(dir, "pin.json");
  if (!existsSync(pinFile)) return [];
  let candidate: unknown;
  try { candidate = (JSON.parse(readFileSync(pinFile, "utf8")) as { candidate?: unknown }).candidate; } catch { return []; }
  if (typeof candidate !== "string" || !candidate.endsWith(".json")) return [];
  const file = join(dir, "candidates", candidate);
  if (!existsSync(file)) return [];
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { return []; }
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") { const slot = slotOf(value); if (slot) out.push(slot); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { walk(key); walk(item); }
  };
  const header = (doc as { clossys?: { refs?: Ref[] } }).clossys;
  for (const ref of header?.refs ?? []) if (WALKED.has(ref.rel)) { const slot = slotOf(ref.to); if (slot) out.push(slot); }
  walk((doc as { content?: unknown }).content);
  return out;
}

export function runIaOrphans(root: string): TreeCheckResult {
  const folders = consumerSlotFolders(root);
  const { roots, findings } = publicationRoots(root);
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const folder of folders) {
    const key = `${folder.agent}/${folder.id}`;
    const edges = candidateEdges(folder.dir);
    if (folder.hasSlot && slotSchemaOf(folder.file) === SLOT_SCHEMA) {
      let slot: Slot | undefined;
      try { slot = readSlot(folder.file); } catch { slot = undefined; }
      for (const ref of [...(slot?.refs ?? []), ...(slot?.brief.inputs ?? [])]) {
        const target = slotOf(ref.to);
        if (!target) continue;
        if (WALKED.has(ref.rel)) edges.push(target);
        else if (ref.rel === "consumedBy") backward.set(target, [...(backward.get(target) ?? []), key]);
      }
    }
    forward.set(key, edges);
  }
  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const next = queue.pop()!;
    if (reached.has(next)) continue;
    reached.add(next);
    queue.push(...(forward.get(next) ?? []), ...(backward.get(next) ?? []));
  }
  for (const folder of folders) {
    const key = `${folder.agent}/${folder.id}`;
    if (reached.has(key) || (folder.agent === "producer" && folder.id.startsWith("loop."))) continue;
    findings.push({ subject: key, detail: folder.hasSlot ? "no consumedBy path ends at a publication in publisher/ia.json" : "slot folder with no slot.json, and nothing reachable places it" });
  }
  return treeResult(IA_ORPHANS, findings);
}

export const iaOrphans: TreeCheck = { id: IA_ORPHANS, run: runIaOrphans };
