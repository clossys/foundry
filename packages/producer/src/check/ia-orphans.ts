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
 * runner    = an agent `loop.*` slot, or a Director slot (the Director's reader, CHAT-DIR B1), whose own `consumedBy`
 *             ref names a Producer loop (`producer/<loop>`) is reached,
 *             and the walk stops there: an agent loop slot is terminal (no forward edge, no backward edge walked from
 *             it), so a slot name written inside a loop version (a step condition, an owner-pick rule) is never
 *             consumption (foundry-build-0048 CONSISTENCY fix r1)
 * orphans   = every slot folder minus reached minus Producer `loop.*` slots (exempt by design) minus the Producer seat
 *             slots `seat.<step>` placed in producer/ia.json: a seat seats a decide step of the pipeline, no publication
 *             consumes it, and `clossys seat` writes it with no refs (records/seat-slot.ts), so its tie to the IA is its
 *             placement. A seat folder producer/ia.json does not place is still an orphan.
 *
 * A folder with no readable `slot.json` is still a slot folder: it is reached only through the edges of others.
 *
 * publication-pending (foundry-build-0048 CONSISTENCY C2) = an unreached folder that the same edges reach from a
 * publication the installed Publisher package declares but the consumer has not seated. Declared: a publication its
 * IA (`@clossys/publisher`) assigns pages to, and whose package starter (`starters/<id>/publication.json`)
 * lists exactly those pages; its roots are every slot its starter's own default files name (frame, chrome, sections,
 * copy, meta). Seated: a publication either root form above names. A pending folder is listed (`pending`) and does not
 * fail the check; every other unreached folder stays an orphan. A starter whose files cannot be read declares nothing:
 * its folders stay orphans (no fallback). A package IA that cannot be read refuses (PublisherDataError): the check fails
 * naming it, never judging against an empty declared set.
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
import { isAgentLoop, isLoopAgent } from "../loop/agent-loops-ia.js";
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
 * default file reads. A publication that fails any part is left out (its folders are judged without it). The package
 * IA itself (`@clossys/publisher`) missing or unreadable throws PublisherDataError: there is no declaration
 * to judge by, so callers refuse rather than act on an empty list. Only a root with its own `packages/` folder that
 * holds no `packages/publisher/` declares no publication (it carries no Publisher package).
 */
export function declaredPublications(root: string): Map<string, string[]> {
  const publisher = (rel: string) => packagePath(root, `packages/publisher/${rel}`);
  const out = new Map<string, string[]>();
  // The package IA is the declaration itself: missing or unreadable, nothing can be judged, so it refuses (never an
  // empty list). The one root that declares none is a world carrying its own packages/ folder with no Publisher
  // package in it at all (a Foundry-shaped test world without @clossys/publisher, DECIDED D11); a consumer root always
  // reads the installed package, and an uninstalled one refuses.
  const directoryFile = publisher("src/catalog/ia/directory.json");
  const directory = readJson(directoryFile) as { slots?: Record<string, { kind?: unknown; publication?: unknown }> } | undefined;
  if (!directory || typeof directory !== "object" || !directory.slots || typeof directory.slots !== "object") {
    if (existsSync(join(root, "packages")) && !existsSync(packagePath(root, "packages/publisher"))) return out;
    throw new PublisherDataError(directoryFile);
  }
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

/** The installed Publisher package's IA (`@clossys/publisher`) is missing or unreadable: publications cannot be judged. */
export class PublisherDataError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`the Publisher package IA is missing or unreadable (${file}): declared publications cannot be judged; reinstall @clossys/publisher`);
    this.name = "PublisherDataError";
    this.file = file;
  }
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
    // An agent loop slot is terminal: its loop versions name the slots their steps act on and consume none, so it has
    // no forward edge; its own consumedBy edge (to the Producer loop it extends) is still recorded.
    const terminal = isAgentLoopKey(key);
    const edges = terminal ? [] : candidateEdges(folder.dir);
    if (folder.hasSlot && slotSchemaOf(folder.file) === SLOT_SCHEMA) {
      let slot: Slot | undefined;
      try { slot = readSlot(folder.file); } catch { slot = undefined; }
      for (const ref of [...(slot?.refs ?? []), ...(slot?.brief.inputs ?? [])]) {
        const target = slotOf(ref.to);
        if (!target) continue;
        if (WALKED.has(ref.rel)) { if (!terminal) edges.push(target); }
        else if (ref.rel === "consumedBy") backward.set(target, [...(backward.get(target) ?? []), key]);
      }
    }
    forward.set(key, edges);
  }
  return { forward, backward };
}

/** An agent's own loop slot (`<agent>/loop.<name>`, never a Producer one): the walk reaches it and stops there. */
export const isAgentLoopKey = (key: string): boolean => {
  const slash = key.indexOf("/");
  return slash > 0 && isLoopAgent(key.slice(0, slash)) && isAgentLoop(key.slice(slash + 1));
};

/**
 * Every key the graph reaches from `from`, through forward edges and consumedBy edges read backward, never entering
 * `skip`. An agent loop slot is reached but not walked from (terminal).
 */
export function walkGraph(graph: ConsumerGraph, from: readonly string[], skip: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length) {
    const next = queue.pop()!;
    if (seen.has(next) || skip.has(next)) continue;
    seen.add(next);
    if (isAgentLoopKey(next)) continue;
    queue.push(...(graph.forward.get(next) ?? []), ...(graph.backward.get(next) ?? []));
  }
  return seen;
}

/**
 * The loop runner as a consumer (foundry-build-0048 CONSISTENCY D5 option 3): the Producer loops it runs,
 * `producer/<loop>` for every loop name. The runner consumes an agent `loop.*` slot only through that slot's own
 * recorded `consumedBy` edge to one of them (an agent loop slot names the Producer loop it extends), and nothing
 * further: the runner consumes no other slot, and nothing is exempt (CONSISTENCY fix r1).
 */
export const RUNNER_ROOTS: readonly string[] = LOOP_NAMES.map(loop => `producer/${loop}`);

/**
 * The Director's reader as a consumer (CHAT-DIR ruling B1, recorded the way D5 option 3 records the runner): the
 * Director reads every strategy cell it holds, in the scope loop's scope-director step (`producer/loop.scope`).
 * `clossys ia director --adopt` writes this consumedBy edge on each Director leaf it places (ia-sync.ts adoptedCurrent);
 * the runner reaches a Director slot through it and stops there, as at an agent loop slot.
 */
export const DIRECTOR_READER_EDGE = { to: "producer/loop.scope/package:scope-v1.json", rel: "consumedBy" } as const satisfies Ref;
const isDirectorCellKey = (key: string): boolean => key.startsWith("director/") && !isAgentLoopKey(key);

/** The agent loop slots and Director cells the runner consumes: each one whose own consumedBy edge names a Producer loop. Terminal. */
export function runnerReach(graph: ConsumerGraph): Set<string> {
  return new Set(RUNNER_ROOTS.flatMap(runner => (graph.backward.get(runner) ?? []).filter(key => isAgentLoopKey(key) || isDirectorCellKey(key))));
}

/**
 * The slot keys a seated publication reaches in the consumer, plus the agent loop slots the runner consumes (the walk
 * ia.orphans judges by). The runner's slots are added as they are, never walked from.
 */
export function publicationReach(root: string, graph: ConsumerGraph = consumerGraph(root)): { reached: Set<string>; findings: TreeFinding[]; seated: Set<string> } {
  const { roots, findings, seated } = publicationRoots(root);
  const reached = walkGraph(graph, roots);
  for (const key of runnerReach(graph)) reached.add(key);
  return { reached, findings, seated };
}

export function runIaOrphans(root: string): TreeCheckResult {
  const folders = consumerSlotFolders(root);
  const seats = placedSeats(root);
  const graph = consumerGraph(root, folders);
  const { reached, findings, seated } = publicationReach(root, graph);
  const walk = (from: readonly string[], skip: ReadonlySet<string>) => walkGraph(graph, from, skip);
  // Folders a declared, unseated publication reaches through the same edges, by publication (CONSISTENCY C2).
  const waiting = new Map<string, string[]>();
  let declared: Map<string, string[]>;
  try { declared = declaredPublications(root); } catch (error) {
    // Unreadable Publisher package data fails the check by name; no folder is judged pending against nothing.
    if (!(error instanceof PublisherDataError)) throw error;
    findings.push({ subject: "@clossys/publisher", detail: error.message });
    declared = new Map();
  }
  for (const [publication, slots] of declared) {
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
