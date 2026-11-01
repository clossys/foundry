/**
 * Read-only loaders for the Publisher and Writer outputs the record suites and install read. Each reader goes
 * through the owning agent's own compiler or check where one exists; nothing is written
 * into the consumer root.
 */
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WriterSlotBodyRecord } from "@clossys/writer/slot-body";
import { agentModule, agentRoot, readCells } from "../server/cells.js";
import { listSlots, readCandidate, readIa, readSlot } from "../records/slots.js";
import { parseFrontmatter, pinFile, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";
import type { PageCopyBinding, PublisherInput, WriterInput, WriterRecord, WriterSectionBinding } from "./site-plan.js";

const COPY_BULLET = /^- ([^:]+): writer:([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)$/;
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
async function json(path: string): Promise<any> { return JSON.parse(await readFile(path, "utf8")); }

/** Copy bullets of one Publisher page cell, in authored order (Publisher's own grammar). */
export function pageCopy(source: string): PageCopyBinding[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => line === "## Copy");
  if (start < 0) return [];
  const copy: PageCopyBinding[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const match = COPY_BULLET.exec(line);
    if (match) copy.push({ key: match[1]!.trim(), cell: match[2]! });
  }
  return copy;
}

/** Publisher: its compiler checks the generated outputs against the active cells, then those outputs are read. */
export async function readPublisher(root: string, publication?: string): Promise<PublisherInput> {
  const base = agentRoot(root, "publisher");
  const compiler = await agentModule("publisher", "content-map/cells.js");
  const { maps } = await compiler.compileContentMaps(base, { check: true });
  const map = publication ? maps.find((row: any) => row.publicationId === publication) : maps.find((row: any) => row.format?.startsWith("web.")) ?? maps[0];
  if (!map) throw new Error(publication ? `Publisher has no publication ${publication}` : "Publisher has no publication");
  const tree = await json(join(base, "tree.json"));
  const meta = (tree.meta?.publications ?? []).find((row: any) => row.id === map.publicationId) ?? {};
  let routes: PublisherInput["routes"] = [];
  if (isRecord(meta.routePack)) routes = (await json(join(base, "route-pack", `${map.publicationId}.json`))).routes ?? [];
  const cellOfEntry: Record<string, string> = {};
  for (const [cell, entry] of Object.entries(meta.entryIds ?? {})) if (typeof entry === "string") cellOfEntry[entry] = cell;
  const cells = await readCells(root, "publisher", true);
  const copy: Record<string, PageCopyBinding[]> = {};
  for (const cell of cells) if (Object.values(cellOfEntry).includes(cell.id)) copy[cell.id] = pageCopy(cell.source);
  return { publicationId: map.publicationId, ...(typeof map.format === "string" ? { format: map.format } : {}), entries: map.entries, routes, copy, cellOfEntry };
}

/** Explicit native declarations opt in; consumers awaiting authored declarations retain compiled locales. */
export async function readWriter(root: string): Promise<WriterInput & { locale: string; native?: { rows: WriterSlotBodyRecord[]; declarations: Record<string, unknown> } }> {
  const consumer = join(root, "clossys");
  const path = join(agentRoot(root, "writer"), "declarations.json");
  const declarationFile = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (declarationFile) {
    if (!readIa(consumer, "writer")) throw new Error("Writer native IA is missing");
    if (!declarationFile.isFile() || declarationFile.isSymbolicLink()) throw new Error("Expected a regular Writer declarations file");
    const entries = listSlots(consumer, "writer");
    const parser = await agentModule("writer", "slot-body.js");
    const rows: WriterSlotBodyRecord[] = [];
    const selectedLocales = new Set<string>();
    for (const entry of entries) {
      if (!entry.pin) {
        if (existsSync(pinFile(entry.dir))) throw new Error(`Invalid Writer pin: ${entry.id}`);
        continue;
      }
      const doc = readSlot(consumer, "writer", entry.id);
      if (validateSlotDoc(doc).length || doc.id !== entry.id || doc.agent !== "writer" || doc.kind !== "strings"
        || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) {
        throw new Error(`Invalid Writer slot: ${entry.id}`);
      }
      const candidate = readCandidate(consumer, "writer", entry.id, entry.pin.candidate);
      if (candidate.sha256 !== entry.pin.sha256) throw new Error(`Writer candidate hash mismatch: ${entry.id}`);
      if (validateCandidate(doc.kind, entry.id, candidate.name, candidate.bytes).length) throw new Error(`Invalid Writer candidate: ${entry.id}`);
      const parsed = parseFrontmatter(candidate.bytes);
      if (!parsed.ok) throw new Error(`Invalid Writer candidate envelope: ${entry.id}`);
      rows.push(...parser.parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales));
      for (const locale of parsed.value.fields.locales as string[]) selectedLocales.add(locale);
    }
    const api = await agentModule("writer", "declarations.js");
    const declarations = api.parseWriterDeclarations(await readFile(path, "utf8"));
    const locales = [...selectedLocales].sort();
    // Without pinned locales, declarations still select an explicit locale and validate every target.
    const available = locales.length ? locales : Object.keys(declarations.locales).sort();
    const locale = available.includes("en") ? "en" : available[0]!;
    const selected = api.projectWriterDeclarations(declarations, locale, { completeRecords: rows });
    const records = rows.filter(row => row.locale === locale && typeof row.record.text === "string").map(row => row.record as WriterRecord);
    return { ...selected, locale, records, native: { rows, declarations } };
  }
  const compiled = join(agentRoot(root, "writer"), "compiled");
  const locales = (await readdir(compiled, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const locale = locales.includes("en") ? "en" : locales[0];
  if (!locale) throw new Error("Writer has no compiled locale");
  const aliases: Record<string, string> = {}, records: WriterRecord[] = [];
  let sections: WriterSectionBinding[] = [];
  for (const file of (await readdir(join(compiled, locale))).filter(name => name.endsWith(".json")).sort()) {
    const value = await json(join(compiled, locale, file));
    if (file === "section-bindings.json") { sections = Array.isArray(value) ? value : []; continue; }
    if (isRecord(value.aliases)) for (const [alias, id] of Object.entries(value.aliases)) if (typeof id === "string") aliases[alias] = id;
    for (const record of Array.isArray(value.records) ? value.records : []) if (typeof record?.id === "string" && typeof record.text === "string") records.push({ id: record.id, context: record.context, text: record.text });
  }
  return { locale, aliases, records, sections };
}
