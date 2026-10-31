/**
 * Read-only loaders for the Publisher and Writer outputs the record suites and install read. Each reader goes
 * through the owning agent's own compiler or check where one exists; nothing is written
 * into the consumer root.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentModule, agentRoot, readCells } from "../server/cells.js";
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

/** Writer: the compiled locale files (records, aliases) and its section bindings. */
export async function readWriter(root: string): Promise<WriterInput & { locale: string }> {
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
