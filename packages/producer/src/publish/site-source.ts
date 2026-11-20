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
import { parseFrontmatter, validateCandidate } from "../records/slot-model/index.js";
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

/** The pinned Writer rows of every slot, read through the Writer's own slot-body parser. */
export async function pinnedWriterRows(consumer: string): Promise<{ rows: WriterSlotBodyRecord[]; locales: string[] }> {
  const entries = listSlots(consumer, "writer");
  const parser = await agentModule("writer", "slot-body.js");
  const rows: WriterSlotBodyRecord[] = [];
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
    if (slotCandidateIssues(consumer, "writer", entry.id, candidate.name, candidate.raw).length) throw new Error(`Invalid Writer candidate: ${entry.id}`);
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) throw new Error(`Invalid Writer candidate envelope: ${entry.id}`);
    rows.push(...parser.parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales));
    for (const locale of parsed.value.fields.locales as string[]) selectedLocales.add(locale);
  }
  return { rows, locales: [...selectedLocales].sort() };
}

/**
 * The consumer's pinned Writer copy. Explicit native declarations (`declarations.json`) add
 * aliases and section bindings; without them the pinned rows are the whole Writer input.
 */
export async function readWriter(root: string): Promise<WriterInput & { locale: string; native?: { rows: WriterSlotBodyRecord[]; declarations: Record<string, unknown> } }> {
  const consumer = join(root, "clossys");
  if (!readIa(consumer, "writer")) throw new Error("Writer native IA is missing");
  // Aliased or irregular declarations are refused by the one reader.
  const declarationText = writerDeclarationsText(consumer);
  const { rows, locales } = await pinnedWriterRows(consumer);
  if (declarationText !== undefined) {
    const api = await agentModule("writer", "declarations.js");
    const declarations = api.parseWriterDeclarations(declarationText);
    // Without pinned locales, declarations still select an explicit locale and validate every target.
    const available = locales.length ? locales : Object.keys(declarations.locales).sort();
    const locale = available.includes("en") ? "en" : available[0]!;
    const selected = api.projectWriterDeclarations(declarations, locale, { completeRecords: rows });
    const records = rows.filter(row => row.locale === locale && typeof row.record.text === "string").map(row => row.record as WriterRecord);
    return { ...selected, locale, records, native: { rows, declarations } };
  }
  const locale = locales.includes("en") ? "en" : locales[0];
  if (!locale) throw new Error("Writer has no pinned locale");
  const records = rows.filter(row => row.locale === locale && typeof row.record.text === "string").map(row => row.record as WriterRecord);
  return { locale, aliases: {}, records, sections: [], native: { rows, declarations: {} } };
}
