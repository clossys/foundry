import { isDeepStrictEqual } from "node:util";
import type { CompositeCatalogData } from "@clossys/designer/catalog";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "../model.js";
import type { ConsumerLibrarySnapshot } from "../library.js";
import { parseContentRegistry, validateContentSlot, validateContentWorkspace } from "../validate.js";
import { computeContentDigest } from "../digest.js";
import { isSlotId } from "../taxonomy.js";
import { readConsumerLibrarySnapshot } from "./library.js";
import { joinStoreRevision, splitStoreRevision, type StoredRevision } from "./revision.js";
import type { CopyField } from "../composition.js";
import { optionalStoreJson, readStoreJson, storeEntries, storeRoot, storeSegment, writeStoreJson } from "./files.js";

export interface ContentStoreOptions {
  readonly designer: { readonly root: string; readonly catalog: CompositeCatalogData };
}
export interface LoadedContentStore {
  readonly registry: ContentRegistry;
  readonly libraries: readonly ConsumerLibrarySnapshot[];
}

const metadataKeys = ["id", "slotId", "origin", "state", "revision", "derivedFrom", "approval", "tags", "updatedAt"] as const;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function entries(root: string, name: string, kind: "file" | "directory"): Promise<string[]> {
  try { return await storeEntries(root, name, kind); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
function assertValid(findings: readonly { path: string; rule: string }[]): void {
  if (findings.length) throw new TypeError(findings.map(f => `${f.path}: ${f.rule}`).join("; "));
}

async function readRegistry(root: string): Promise<ContentRegistry> {
  const workspace = await readStoreJson(root, "workspace.json");
  assertValid(validateContentWorkspace(workspace));
  const slots: ContentSlot[] = [];
  for (const name of await entries(root, "_registry/slots", "file")) {
    const id = name.slice(0, -5);
    if (!name.endsWith(".json") || !isSlotId(id)) throw new TypeError("Invalid slot filename");
    const slot = await readStoreJson(root, `_registry/slots/${name}`);
    assertValid(validateContentSlot(slot));
    if ((slot as ContentSlot).id !== id) throw new TypeError("Slot filename and identity differ");
    slots.push(slot as ContentSlot);
  }
  const candidates: ContentCandidate[] = [];
  for (const slotId of await entries(root, "_registry/candidates", "directory")) {
    const slot = slots.find(value => value.id === slotId);
    if (!slot) throw new TypeError("Candidate directory has no slot");
    for (const id of await entries(root, `_registry/candidates/${slotId}`, "directory")) {
      storeSegment(id);
      const directory = `_registry/candidates/${slotId}/${id}`;
      const metadata = await readStoreJson(root, `${directory}/candidate.json`);
      if (!object(metadata) || Object.keys(metadata).some(key => !(metadataKeys as readonly string[]).includes(key))
        || metadata.id !== id || metadata.slotId !== slotId) throw new TypeError("Invalid candidate metadata");
      const names = await entries(root, directory, "file");
      const revisions = names.filter(name => /^r[1-9][0-9]*\.json$/.test(name));
      if (names.length !== revisions.length + 1 || metadata.revision !== `r${revisions.length}`) throw new TypeError("Invalid stored revision sequence");
      const history = [];
      for (let n = 1; n <= revisions.length; n++) {
        const revision = `r${n}`;
        if (!revisions.includes(`${revision}.json`)) throw new TypeError("Missing stored revision");
        const structure = await readStoreJson(root, `${directory}/${revision}.json`) as StoredRevision;
        if (!object(structure) || structure.revision !== revision) throw new TypeError("Revision filename and identity differ");
        const copies = Object.fromEntries(await Promise.all(slot.locales.map(async locale => [locale,
          await readStoreJson(root, `${storeSegment(locale)}/${slotId}/${id}/${revision}.copy.json`),
        ])));
        history.push(joinStoreRevision(structure, copies as Record<string, readonly CopyField[]>, slot.locales));
      }
      if (!history.length) throw new TypeError("Candidate has no revision");
      candidates.push({ ...history.at(-1)!.content, ...metadata, history } as unknown as ContentCandidate);
    }
  }
  slots.sort((a, b) => a.position.order - b.position.order || a.id.localeCompare(b.id));
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return parseContentRegistry({ workspace, slots, candidates });
}

/** Read-only content loading; registration evidence comes from the consumer's Designer library. */
export async function loadContentStore(input: string, options: ContentStoreOptions): Promise<LoadedContentStore> {
  const registry = await readRegistry(await storeRoot(input));
  const library = await readConsumerLibrarySnapshot(options.designer.root, options.designer.catalog);
  if (library.consumerId !== registry.workspace.consumerId) throw new TypeError("Designer and Publisher consumers differ");
  return { registry, libraries: [library] };
}

/** Agent persistence only. This records supplied data; it neither approves nor releases content. */
export async function writeContentStore(input: string, value: ContentRegistry): Promise<void> {
  const registry = parseContentRegistry(value);
  const root = await storeRoot(input, true);
  const plan = new Map<string, { value: unknown; immutable: boolean }>();
  plan.set("workspace.json", { value: registry.workspace, immutable: false });
  for (const slot of registry.slots) plan.set(`_registry/slots/${slot.id}.json`, { value: slot, immutable: false });
  for (const candidate of registry.candidates) {
    const slot = registry.slots.find(value => value.id === candidate.slotId)!;
    const directory = `_registry/candidates/${slot.id}/${storeSegment(candidate.id)}`;
    if (computeContentDigest(candidate) !== candidate.history.at(-1)?.digest) throw new TypeError("Snapshot the candidate before writing the store");
    for (const snapshot of candidate.history) {
      const split = splitStoreRevision(snapshot, slot.locales);
      plan.set(`${directory}/${snapshot.revision}.json`, { value: split.revision, immutable: true });
      for (const locale of slot.locales) plan.set(`${storeSegment(locale)}/${slot.id}/${candidate.id}/${snapshot.revision}.copy.json`, { value: split.copies[locale], immutable: true });
    }
    const metadata = Object.fromEntries(metadataKeys.filter(key => candidate[key] !== undefined).map(key => [key, candidate[key]]));
    plan.set(`${directory}/candidate.json`, { value: metadata, immutable: false });
  }
  if (await optionalStoreJson(root, "workspace.json") !== undefined) {
    const previous = await readRegistry(root);
    if (previous.workspace.consumerId !== registry.workspace.consumerId) throw new TypeError("Store consumer cannot change");
    for (const slot of previous.slots) if (!registry.slots.some(value => value.id === slot.id)) throw new TypeError("Stored slots cannot be silently removed");
    for (const candidate of previous.candidates) {
      const next = registry.candidates.find(value => value.id === candidate.id);
      if (!next || next.slotId !== candidate.slotId || next.history.length < candidate.history.length) throw new TypeError("Stored candidate history cannot be removed or moved");
    }
  }
  // Preflight every destination before changing any metadata or immutable snapshot.
  for (const [name, entry] of plan) {
    const previous = await optionalStoreJson(root, name);
    if (entry.immutable && previous !== undefined) {
      if (!isDeepStrictEqual(previous, entry.value)) throw new TypeError("Stored revision or locale copy is immutable");
      plan.delete(name);
    }
  }
  for (const immutable of [true, false]) for (const [name, entry] of plan) {
    if (entry.immutable === immutable) await writeStoreJson(root, name, entry.value, immutable);
  }
}
