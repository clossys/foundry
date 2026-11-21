/**
 * `ia.orphans` (system.md 9): every consumer slot folder is reachable from a publication in
 * `clossys/agents/publisher/ia.json`. It walks consumer slot folders only (never the package tree).
 *
 * roots     = each publication's pages, chrome and release slots, for a publication either form names (the ones
 *             `clossys ia publisher/release.<pub> --kind release` takes as existing): a `publications` entry of
 *             publisher/ia.json, or a valid `publisher/publication.<pub>` slot record placed in its nodes and not retired (that slot
 *             and its release slot are roots; its pages and chrome are reached through its refs)
 * forward   = from a reached slot: its `refs` (input, uses, places), its `brief.inputs`, and the refs of its pinned
 *             candidate (header `refs` plus every `<agent>/<slot-id>` string, value or key, in a JSON candidate's content;
 *             a release manifest names its pins as keys)
 * backward  = a slot whose `consumedBy` ref names a reached slot is reached
 * orphans   = every slot folder minus reached minus Producer `loop.*` slots (exempt by design) minus the Producer seat
 *             slots `seat.<step>` placed in producer/ia.json: a seat seats a decide step of the pipeline, no publication
 *             consumes it, and `clossys seat` writes it with no refs (records/seat-slot.ts), so its tie to the IA is its
 *             placement. A seat folder producer/ia.json does not place is still an orphan.
 *
 * A folder with no readable `slot.json` is still a slot folder: it is reached only through the edges of others.
 *
 * publication-pending (foundry-build-0048 CONSISTENCY C2) = an unreached folder that the same edges reach from a
 * publication the installed Publisher package declares but the consumer has not seated. Declared: a publication its
 * IA (`src/catalog/ia/directory.json`) assigns pages to, and whose package starter (`starters/<id>/publication.json`)
 * lists exactly those pages; its roots are every slot its starter's own default files name (frame, chrome, sections,
 * copy, meta). Seated: a publication either root form above names. A pending folder is listed (`pending`) and does not
 * fail the check; every other unreached folder stays an orphan. A starter whose files cannot be read declares nothing:
 * its folders stay orphans (no fallback).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEATABLE_STARTERS } from "../cli/starter-plan.js";
import { placedIds } from "../constitution/context.js";
import { packagePath } from "../package-path.js";
import { LOOP_NAMES } from "../loop/names.js";
import { releaseSlotId } from "../release/paths.js";
import { SLOT_SCHEMA, consumerSlotFolders, readSlot, slotSchemaOf, treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import { slotReadIssues } from "../records/slot-current.js";
import { seatStepOf } from "../records/slot-model/types.js";
import type { Ref, Slot } from "../records/types.js";

export const IA_ORPHANS = "ia.orphans";

const SLOT_REF = /^(director|designer|writer|publisher|producer)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?:[/#:].*)?$/;
const WALKED: ReadonlySet<Ref["rel"]> = new Set(["input", "uses", "places"]);

const slotOf = (to: string): string | undefined => {
  const match = SLOT_REF.exec(to);
  return match ? `${match[1]}/${match[2]}` : undefined;
};

const PUBLICATION_SLOT = /^publication\.([a-z0-9][a-z0-9-]*)$/;

/** Whether a placed `publisher/<id>` folder holds a valid slot record (the ia verb's validator) that is not retired. */
function liveSlot(root: string, id: string): boolean {
  const file = join(root, "clossys", "agents", "publisher", id, "slot.json");
  if (!existsSync(file)) return false;
  let record: unknown;
  try { record = JSON.parse(readFileSync(file, "utf8")); } catch { return false; }
  return slotReadIssues(record, file).length === 0 && (record as { status?: unknown }).status !== "retired";
}

/**
 * The publication roots of the consumer: `publisher/<slot-id>` for every page, chrome and release slot a
 * `publications` entry names, and every placed, live `publisher/publication.<pub>` slot with its release slot.
 */
export function publicationRoots(root: string): { roots: string[]; findings: TreeFinding[]; seated: Set<string> } {
  const file = join(root, "clossys", "agents", "publisher", "ia.json");
  const seated = new Set<string>();
  if (!existsSync(file)) return { roots: [], findings: [{ subject: "publisher/ia.json", detail: "missing: no publication roots" }], seated };
  let doc: { publications?: Record<string, { pages?: unknown; chrome?: unknown; release?: unknown }>; nodes?: unknown };
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { roots: [], findings: [{ subject: "publisher/ia.json", detail: `not JSON: ${(error as Error).message}` }], seated }; }
  const roots: string[] = [];
  for (const [name, publication] of Object.entries(doc.publications ?? {})) {
    seated.add(name);
    const ids = [...asStrings(publication.pages), ...asStrings(publication.chrome), ...asStrings(publication.release)];
    for (const id of ids) roots.push(`publisher/${id}`);
  }
  for (const id of placedIds(doc)) {
    const publication = PUBLICATION_SLOT.exec(id)?.[1];
    if (publication === undefined || !liveSlot(root, id)) continue;
    seated.add(publication);
    for (const slot of [id, releaseSlotId(root, publication)]) if (!roots.includes(`publisher/${slot}`)) roots.push(`publisher/${slot}`);
  }
  return { roots, findings: [], seated };
}

const readJson = (file: string): unknown => {
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
};

/**
 * The publications the installed Publisher package declares, each with the slots its starter's default files name:
 * a publication the package IA assigns pages to, whose starter lists exactly those pages and whose every listed
 * default file reads. A publication that fails any part is left out (its folders are judged without it).
 */
export function declaredPublications(root: string): Map<string, string[]> {
  const publisher = (rel: string) => packagePath(root, `packages/publisher/${rel}`);
  const out = new Map<string, string[]>();
  const directory = readJson(publisher("src/catalog/ia/directory.json")) as { slots?: Record<string, { kind?: unknown; publication?: unknown }> } | undefined;
  const pagesOf = new Map<string, string[]>();
  for (const [id, slot] of Object.entries(directory?.slots ?? {})) {
    if (slot?.kind !== "page" || typeof slot.publication !== "string") continue;
    pagesOf.set(slot.publication, [...(pagesOf.get(slot.publication) ?? []), id]);
  }
  for (const [publication, pages] of pagesOf) {
    const starter = readJson(publisher(`starters/${publication}/publication.json`)) as { id?: unknown; pages?: unknown; layouts?: unknown; chrome?: unknown; defaults?: unknown } | undefined;
    if (!starter || starter.id !== publication) continue;
    const listed = asStrings(starter.pages);
    if (listed.length !== pages.length || !pages.every(page => listed.includes(page))) continue;
    const defaults = asStrings(starter.defaults);
    const docs = defaults.map(rel => readJson(publisher(`defaults/${rel}`)));
    if (!defaults.length || docs.some(doc => doc === undefined)) continue;
    const slots = new Set<string>([...listed, ...asStrings(starter.layouts), ...asStrings(starter.chrome)].map(id => `publisher/${id}`));
    for (const doc of docs) for (const slot of slotRefsIn((doc as { content?: unknown }).content)) slots.add(slot);
    out.set(publication, [...slots]);
  }
  return out;
}

/** Every `<agent>/<slot-id>` string, value or key, in a JSON value. */
function slotRefsIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (item: unknown): void => {
    if (typeof item === "string") { const slot = slotOf(item); if (slot) out.push(slot); }
    else if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === "object") for (const [key, inner] of Object.entries(item)) { walk(key); walk(inner); }
  };
  walk(value);
  return out;
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
  const header = (doc as { clossys?: { refs?: Ref[] } }).clossys;
  for (const ref of header?.refs ?? []) if (WALKED.has(ref.rel)) { const slot = slotOf(ref.to); if (slot) out.push(slot); }
  out.push(...slotRefsIn((doc as { content?: unknown }).content));
  return out;
}

/** The seat slot ids producer/ia.json places (none when it is missing or unreadable). */
function placedSeats(root: string): Set<string> {
  const file = join(root, "clossys", "agents", "producer", "ia.json");
  if (!existsSync(file)) return new Set();
  try { return new Set(placedIds(JSON.parse(readFileSync(file, "utf8"))).filter(id => seatStepOf(id) !== undefined)); } catch { return new Set(); }
}

/** The consumer's slot graph as ia.orphans walks it: forward edges by slot key, and the consumedBy edges read backward. */
export interface ConsumerGraph { readonly forward: ReadonlyMap<string, readonly string[]>; readonly backward: ReadonlyMap<string, readonly string[]> }
export function consumerGraph(root: string, folders: ReturnType<typeof consumerSlotFolders> = consumerSlotFolders(root)): ConsumerGraph {
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
  return { forward, backward };
}

/** Every key the graph reaches from `from`, through forward edges and consumedBy edges read backward, never entering `skip`. */
export function walkGraph(graph: ConsumerGraph, from: readonly string[], skip: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length) {
    const next = queue.pop()!;
    if (seen.has(next) || skip.has(next)) continue;
    seen.add(next);
    queue.push(...(graph.forward.get(next) ?? []), ...(graph.backward.get(next) ?? []));
  }
  return seen;
}

/**
 * The loop runner as a consumer (foundry-build-0048 CONSISTENCY D5 option 3): the Producer loops it runs,
 * `producer/<loop>` for every loop name. A slot is consumed by the runner only through its own recorded
 * `consumedBy` edge to one of them (an agent loop slot names the Producer loop it extends); nothing is exempt.
 */
export const RUNNER_ROOTS: readonly string[] = LOOP_NAMES.map(loop => `producer/${loop}`);

/** The slot keys a seated publication or the loop runner reaches in the consumer (the walk ia.orphans judges by). */
export function publicationReach(root: string, graph: ConsumerGraph = consumerGraph(root)): { reached: Set<string>; findings: TreeFinding[]; seated: Set<string> } {
  const { roots, findings, seated } = publicationRoots(root);
  return { reached: walkGraph(graph, [...roots, ...RUNNER_ROOTS]), findings, seated };
}

export function runIaOrphans(root: string): TreeCheckResult {
  const folders = consumerSlotFolders(root);
  const seats = placedSeats(root);
  const graph = consumerGraph(root, folders);
  const { reached, findings, seated } = publicationReach(root, graph);
  const walk = (from: readonly string[], skip: ReadonlySet<string>) => walkGraph(graph, from, skip);
  // Folders a declared, unseated publication reaches through the same edges, by publication (CONSISTENCY C2).
  const waiting = new Map<string, string[]>();
  for (const [publication, slots] of declaredPublications(root)) {
    if (seated.has(publication)) continue;
    for (const key of walk(slots, reached)) waiting.set(key, [...(waiting.get(key) ?? []), publication]);
  }
  const pending: TreeFinding[] = [];
  for (const folder of folders) {
    const key = `${folder.agent}/${folder.id}`;
    if (reached.has(key) || (folder.agent === "producer" && (folder.id.startsWith("loop.") || seats.has(folder.id)))) continue;
    const seat = folder.agent === "producer" && seatStepOf(folder.id) !== undefined;
    const publications = seat ? undefined : waiting.get(key);
    if (publications) { pending.push({ subject: key, detail: `publication-pending: ${publications.map(pendingRemedy).join("; ")}` }); continue; }
    findings.push({ subject: key, detail: seat ? "seat slot folder producer/ia.json does not place" : folder.hasSlot ? "no consumedBy path ends at a publication in publisher/ia.json" : "slot folder with no slot.json, and nothing reachable places it" });
  }
  return { ...treeResult(IA_ORPHANS, findings), ...(pending.length ? { pending } : {}) };
}

/** What a pending folder waits on: the declared publication and the verb that seats it, where one does. */
const pendingRemedy = (publication: string): string =>
  `waits on publication ${publication}, declared by the Publisher package and not seated${SEATABLE_STARTERS.includes(publication) ? ` (clossys init --starters ${publication})` : " (no verb seats it yet)"}`;

export const iaOrphans: TreeCheck = { id: IA_ORPHANS, run: runIaOrphans };
