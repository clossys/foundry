import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { WRITER_LAYERS, isWriterLayer } from "../catalog-core/ids.js";
import { validateWriterManifest, validateWriterRecord } from "../model/validate.js";
import type { RecordId, WriterLayer, WriterLibrary, WriterLoadResult, WriterLocaleContent, WriterManifest, WriterRecord, WriterShapeIssue } from "../model/types.js";

/** Read a consumer-owned library without following links or resolving manifest references. */
export function loadWriterLibrary(root: string): WriterLoadResult {
  const issues: WriterShapeIssue[] = [];
  const base = resolve(root);
  const issue = (code: WriterShapeIssue["code"], path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const result = (library: WriterLibrary | null): WriterLoadResult => ({
    library: issues.length ? null : library,
    issues,
    exitCode: issues.some(item => item.code === "load") ? 2 : issues.length ? 1 : 0,
  });
  const display = (path: string): string => relative(base, path).split(sep).join("/") || ".";
  const inspect = (path: string): ReturnType<typeof lstatSync> | null => {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        issue("load", display(path), "Symbolic links are not allowed in a Writer library.");
        return null;
      }
      return stat;
    } catch {
      issue("load", display(path), "Unable to inspect library entry.");
      return null;
    }
  };
  const entries = (path: string): string[] => {
    try { return readdirSync(path).sort(); }
    catch {
      issue("load", display(path), "Unable to read library directory.");
      return [];
    }
  };
  const source = (path: string): string | undefined => {
    let descriptor: number | undefined;
    let bytes: Buffer;
    try {
      // O_NOFOLLOW also protects the final component if it changes after inspection.
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(descriptor).isFile()) {
        issue("load", display(path), "Library source must be a regular file.");
        return undefined;
      }
      bytes = readFileSync(descriptor);
    } catch {
      issue("load", display(path), "Unable to read library source.");
      return undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch {
      issue("WR1", display(path), "Library source must contain valid UTF-8.");
      return undefined;
    }
  };
  const json = (path: string): unknown => {
    const text = source(path);
    if (text === undefined) return undefined;
    try { return JSON.parse(text) as unknown; }
    catch { issue("WR1", display(path), "Library source must contain valid JSON."); return undefined; }
  };

  // Inspect each existing ancestor before any directory read, including the root itself.
  let ancestor = parse(base).root;
  for (const segment of base.slice(ancestor.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, segment);
    const stat = inspect(ancestor);
    if (!stat) return result(null);
    if (!stat.isDirectory()) {
      issue("load", display(ancestor), "Library root must be a directory.");
      return result(null);
    }
  }
  const manifestPath = join(base, "writer.json");
  const manifestStat = inspect(manifestPath);
  if (!manifestStat) return result(null);
  if (!manifestStat.isFile()) {
    issue("WR1", "writer.json", "Manifest must be a JSON file.");
    return result(null);
  }
  const value = json(manifestPath);
  if (value === undefined) return result(null);
  issues.push(...validateWriterManifest(value, "writer.json"));
  if (issues.length) return result(null);
  const manifest = value as WriterManifest;
  const locales: Record<string, WriterLocaleContent> = Object.create(null) as Record<string, WriterLocaleContent>;
  for (const locale of manifest.locales) locales[locale.tag] = { records: [], documents: [], files: [] };

  const loadLayer = (path: string, layer: WriterLayer, content: WriterLocaleContent, ids: Set<string>): void => {
    for (const name of entries(path)) {
      const file = join(path, name);
      const stat = inspect(file);
      if (!stat) continue;
      if (!stat.isFile()) {
        issue("WR1", display(file), "Layer entries must be regular JSON files or narrative Markdown files.");
        continue;
      }
      const localPath = `${layer}/${name}`;
      if (layer === "narratives" && name.endsWith(".md")) {
        const text = source(file);
        if (text !== undefined) content.documents.push({ path: localPath, source: text });
        continue;
      }
      if (!name.endsWith(".json")) {
        issue("WR1", display(file), "Unsupported layer file extension.");
        continue;
      }
      const data = json(file);
      if (data === undefined) continue;
      const singleNarrative = layer === "narratives" && data !== null && typeof data === "object" && !Array.isArray(data);
      if (!singleNarrative && !Array.isArray(data)) {
        issue("WR1", display(file), "Record files must contain an array; narratives may also contain one object.");
        continue;
      }
      const values: unknown[] = singleNarrative ? [data] : data as unknown[];
      const recordIds: RecordId[] = [];
      for (const [index, record] of values.entries()) {
        const recordPath = `${display(file)}${singleNarrative ? "" : `[${index}]`}`;
        const findings = validateWriterRecord(record, layer, recordPath);
        issues.push(...findings);
        if (findings.length) continue;
        const valid = record as WriterRecord;
        if (ids.has(valid.id)) {
          issue("WR1", `${recordPath}.id`, "Record id is duplicated within this locale.");
          continue;
        }
        ids.add(valid.id);
        recordIds.push(valid.id);
        content.records.push(valid);
      }
      content.files!.push({ path: localPath, recordIds });
    }
  };
  const loadLocale = (path: string, content: WriterLocaleContent): void => {
    const ids = new Set<string>();
    const layers = new Map<WriterLayer, string>();
    for (const name of entries(path)) {
      const entry = join(path, name);
      const stat = inspect(entry);
      if (!stat) continue;
      if (!isWriterLayer(name) || !stat.isDirectory()) {
        issue("WR1", display(entry), "Locale entries must be known layer directories.");
        continue;
      }
      layers.set(name, entry);
    }
    for (const layer of WRITER_LAYERS) {
      const layerPath = layers.get(layer);
      if (layerPath) loadLayer(layerPath, layer, content, ids);
    }
  };
  const found = new Set<string>();
  for (const name of entries(base)) {
    if (name === ".generated" || name === "writer.json") continue;
    const entry = join(base, name);
    const stat = inspect(entry);
    if (!stat) continue;
    if (!Object.hasOwn(locales, name) || !stat.isDirectory()) {
      issue("WR1", display(entry), "Root entries must be declared locale directories or writer.json.");
      continue;
    }
    found.add(name);
    loadLocale(entry, locales[name]!);
  }
  if (!found.has(manifest.defaultLocale)) issue("WR1", manifest.defaultLocale, "Default locale directory is missing or unavailable.");
  return result({ manifest, locales });
}
