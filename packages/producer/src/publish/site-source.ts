/**
 * Read-only loaders for the Publisher and Writer outputs the record suites and install read. Each reader goes
 * through the owning agent's own compiler or check where one exists; nothing is written
 * into the consumer root.
 */
import { join } from "node:path";
import type { WriterSlotBodyRecord } from "@clossys/writer/slot-body";
import { agentModule } from "../read/cells.js";
import { isAgentLoop } from "../loop/agent-loops.js";
import { readPinnedPublication } from "./pinned-publication.js";
import { writerDeclarationsText } from "./studio-defaults.js";
import { hasPinFile, hasSlotModel, listSlots, readCandidate, readIa, readSlot, slotCandidateIssues, viewPlacedAt } from "../records/slots.js";
import { parseFrontmatter } from "../records/slot-model/index.js";
import { contractCopyKeys, writerRowKey } from "../records/writer-copy.js";
import type { PageCopyBinding, PublisherInput, WriterInput, WriterRecord, WriterSectionBinding } from "@clossys/publisher/build";

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
/** Publisher: the pinned native publication (content map, route pack and page copy all come from pins and candidates). */
export async function readPublisher(root: string, publication?: string): Promise<PublisherInput> {
  const consumer = join(root, "clossys");
  if (!hasSlotModel(consumer) || !readIa(consumer, "publisher")) throw new Error("Publisher native IA is missing");
  return readNativePublisher(consumer, publication);
}

/** Copy bindings of a native page candidate (`slot → "cell#key"`) in the legacy bullet shape. */
function nativeCopy(copy: unknown): PageCopyBinding[] {
  if (!isRecord(copy)) return [];
  return Object.entries(copy).flatMap(([slot, ref]) => {
    if (typeof ref !== "string" || ref.indexOf("#") < 1) return [];
    const cell = ref.slice(0, ref.indexOf("#")), key = ref.slice(ref.indexOf("#") + 1);
    return [{ key: slot === key ? key : `${slot} = ${key}`, cell }];
  });
}

async function readNativePublisher(consumer: string, publication?: string): Promise<PublisherInput> {
  const entries = listSlots(consumer, "publisher");
  const ids = publication ? [publication]
    : entries.filter(entry => entry.pin && entry.id.startsWith("publication.")).map(entry => entry.id.slice("publication.".length));
  if (!ids.length) throw new Error("Publisher has no publication");
  const read = await Promise.all(ids.map(async id => ({ id, ...await readPinnedPublication(consumer, id) })));
  const chosen = publication ? read[0]! : read.find(row => typeof row.map.format === "string" && row.map.format.startsWith("web.")) ?? read[0]!;
  const cellOfEntry: Record<string, string> = {};
  const copy: Record<string, PageCopyBinding[]> = {};
  for (const entry of entries) {
    if (!entry.pin || !entry.id.startsWith("page.")) continue;
    const candidate = readCandidate(consumer, "publisher", entry.id, entry.pin.candidate);
    if (candidate.sha256 !== entry.pin.sha256) throw new Error(`Publisher candidate hash mismatch: ${entry.id}`);
    const page = JSON.parse(candidate.bytes) as { copy?: unknown; meta?: { entry?: { entryId?: unknown; publication?: unknown } } };
    const meta = page.meta?.entry;
    if (meta?.publication !== chosen.id || typeof meta.entryId !== "string") continue;
    cellOfEntry[meta.entryId] = entry.id;
    copy[entry.id] = nativeCopy(page.copy);
  }
  const routes = (isRecord(chosen.routePack) && Array.isArray(chosen.routePack.routes) ? chosen.routePack.routes : []) as PublisherInput["routes"];
  return { publicationId: chosen.map.publicationId, ...(typeof chosen.map.format === "string" ? { format: chosen.map.format } : {}),
    entries: chosen.map.entries as unknown as PublisherInput["entries"], routes, copy, cellOfEntry };
}

/**
 * The pinned Writer rows of every slot, read through the Writer's own slot-body parser. `keys[i]` is the key `rows[i]`
 * registers under, by the one rule of records/writer-copy.ts (`writerRowKey` over the slot's `contractCopyKeys`).
 */
export async function pinnedWriterRows(consumer: string): Promise<{ rows: WriterSlotBodyRecord[]; keys: string[]; locales: string[] }> {
  const entries = listSlots(consumer, "writer");
  const parser = await agentModule("writer", "slot-body.js");
  const rows: WriterSlotBodyRecord[] = [];
  const keys: string[] = [];
  const selectedLocales = new Set<string>();
  for (const entry of entries) {
    // An adopted agent loop slot (clossys init, clossys loop) holds no copy: loop.agent-standard judges it, never this reader.
    if (isAgentLoop(entry.id)) continue;
    if (!entry.pin) {
      if (hasPinFile(entry.dir)) throw new Error(`Invalid Writer pin: ${entry.id}`);
      continue;
    }
    const doc = readSlot(consumer, "writer", entry.id);
    if (!viewPlacedAt(doc, entry.id, "writer", entry.position) || doc.kind !== "strings") {
      throw new Error(`Invalid Writer slot: ${entry.id}`);
    }
    // The view: the copy as published, never its clossys header; the file bytes are what the slot's rules judge.
    const candidate = readCandidate(consumer, "writer", entry.id, entry.pin.candidate);
    if (candidate.sha256 !== entry.pin.sha256) throw new Error(`Writer candidate hash mismatch: ${entry.id}`);
    // Judged by its slot as stored (a candidate/1 header under slot/2, the int2 rules under slot/1), read through its view.
    if (slotCandidateIssues(consumer, "writer", entry.id, candidate.name, candidate.raw).length) throw new Error(`Invalid Writer candidate: ${entry.id}`);
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) throw new Error(`Invalid Writer candidate envelope: ${entry.id}`);
    const declared = contractCopyKeys(entry.dir);
    for (const row of parser.parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales)) {
      rows.push(row);
      keys.push(writerRowKey(entry.id, row.record.id, declared));
    }
    for (const locale of parsed.value.fields.locales as string[]) selectedLocales.add(locale);
  }
  return { rows, keys, locales: [...selectedLocales].sort() };
}

/**
 * Install's Writer copy by key in one locale: each pinned row under its registered key (`pinnedWriterRows` `keys`, so a
 * contract key two slots hold is `<slot>.<key>` in each), aliases to them, and a row's context when no alias names it.
 * A context that is the row's own id (its `### <id>` heading) is never a second, bare key: that would undo the slot's key.
 */
export function writerKeyedCopy(writer: { readonly aliases: Readonly<Record<string, string>>; readonly native?: { readonly rows: readonly WriterSlotBodyRecord[]; readonly keys: readonly string[] } }, locale: string): Record<string, string> {
  const rows = writer.native?.rows ?? [], keys = writer.native?.keys ?? [];
  const held = rows.flatMap((row, index) => row.locale === locale && typeof row.record.text === "string" ? [{ key: keys[index]!, record: row.record as { id: string; text: string; context?: unknown } }] : []);
  const copy: Record<string, string> = {};
  for (const { key, record } of held) copy[key] = record.text;
  for (const [alias, id] of Object.entries(writer.aliases)) if (Object.hasOwn(copy, id)) copy[alias] = copy[id]!;
  for (const { record } of held) if (typeof record.context === "string" && record.context && record.context !== record.id && !Object.hasOwn(copy, record.context)) copy[record.context] = record.text;
  return copy;
}

/**
 * The consumer's pinned Writer copy. Explicit native declarations (`declarations.json`) add
 * aliases and section bindings; without them the pinned rows are the whole Writer input.
 */
export async function readWriter(root: string): Promise<WriterInput & { locale: string; native?: { rows: WriterSlotBodyRecord[]; keys: string[]; declarations: Record<string, unknown> } }> {
  const consumer = join(root, "clossys");
  if (!readIa(consumer, "writer")) throw new Error("Writer native IA is missing");
  // Aliased or irregular declarations are refused by the one reader.
  const declarationText = writerDeclarationsText(consumer);
  const { rows, keys, locales } = await pinnedWriterRows(consumer);
  if (declarationText !== undefined) {
    const api = await agentModule("writer", "declarations.js");
    const declarations = api.parseWriterDeclarations(declarationText);
    // Without pinned locales, declarations still select an explicit locale and validate every target.
    const available = locales.length ? locales : Object.keys(declarations.locales).sort();
    const locale = available.includes("en") ? "en" : available[0]!;
    const selected = api.projectWriterDeclarations(declarations, locale, { completeRecords: rows });
    const records = rows.filter(row => row.locale === locale && typeof row.record.text === "string").map(row => row.record as WriterRecord);
    return { ...selected, locale, records, native: { rows, keys, declarations } };
  }
  const locale = locales.includes("en") ? "en" : locales[0];
  if (!locale) throw new Error("Writer has no pinned locale");
  const records = rows.filter(row => row.locale === locale && typeof row.record.text === "string").map(row => row.record as WriterRecord);
  return { locale, aliases: {}, records, sections: [], native: { rows, keys, declarations: {} } };
}
