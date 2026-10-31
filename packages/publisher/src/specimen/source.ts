/**
 * Record store adapter for the specimen renderer.
 *
 * `adaptElementRecord` is the only place that knows the on-disk record shape. It reads the
 * minimal fields (id, version, kind, payload path, preview.json) and tolerates a fuller
 * schema around them, so the record schema can grow without touching the renderer.
 *
 * On disk a record is an immutable directory `<root>/<id>/v<n>/` holding `element.json`,
 * `preview.json` and the payload file `element.json` names.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SPECIMEN_CONTAINERS, SPECIMEN_KINDS, SPECIMEN_TEXT_ROLES } from "./types.js";
import type { SpecimenCopy, SpecimenFile, SpecimenKind, SpecimenPreview, SpecimenRecord, SpecimenRecordSource, SpecimenTheme } from "./types.js";

/** Element ids are path-like (`slot/element`), never absolute, never dotted segments. */
export const SPECIMEN_ID = /^[A-Za-z0-9@][A-Za-z0-9@._-]*(?:\/[A-Za-z0-9@][A-Za-z0-9@._-]*)*$/;
const VERSION_DIR = /^v([1-9]\d{0,5})$/;
const VAR_NAME = /^[a-z][a-z0-9-]*$/;

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
export const validSpecimenId = (id: string): boolean => id.length <= 200 && SPECIMEN_ID.test(id) && !id.split("/").some(part => part === "." || part === "..");

/** Record kinds from a fuller schema, mapped onto the specimen renderer that shows them. */
const KIND_ALIASES: Readonly<Record<string, SpecimenKind>> = {
  component: "visual", components: "visual", section: "visual", sections: "visual", frame: "visual", frames: "visual",
  page: "visual", block: "visual", ui: "visual", "registry:ui": "visual", "registry:block": "visual", "registry:component": "visual",
  copy: "text", writer: "text", cell: "text", "registry:text": "text",
  table: "data", chart: "data", dataset: "data", theme: "data", "registry:theme": "data", tokens: "data",
  asset: "media", assets: "media", image: "media", icon: "media", logo: "media", video: "media",
  director: "flow", route: "flow", journey: "flow",
};

export function specimenKindOf(element: Record<string, any>): SpecimenKind {
  for (const value of [element.specimen, element.kind, element.layer, element.type]) {
    if (typeof value !== "string") continue;
    if ((SPECIMEN_KINDS as readonly string[]).includes(value)) return value as SpecimenKind;
    const alias = KIND_ALIASES[value];
    if (alias) return alias;
  }
  throw new Error(`element ${String(element.id)}: unknown kind ${JSON.stringify(element.kind)}`);
}

function positiveInt(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : undefined;
}

function adaptCopy(value: unknown): Record<string, SpecimenCopy> | undefined {
  if (!isRecord(value)) return undefined;
  const copy: Record<string, SpecimenCopy> = {};
  for (const [key, row] of Object.entries(value)) {
    const text = typeof row === "string" ? row : isRecord(row) && typeof row.text === "string" ? row.text : undefined;
    if (text === undefined) continue;
    const role = isRecord(row) && (SPECIMEN_TEXT_ROLES as readonly string[]).includes(row.role) ? row.role : undefined;
    const limits = isRecord(row) ? (isRecord(row.limits) ? row.limits : row) : {};
    const maxChars = positiveInt(limits.maxChars, 100_000), maxLines = positiveInt(limits.maxLines, 1000);
    copy[key] = { text, ...(role ? { role } : {}), ...(maxChars ? { maxChars } : {}), ...(maxLines ? { maxLines } : {}) };
  }
  return copy;
}

export function adaptPreview(value: unknown): SpecimenPreview {
  if (!isRecord(value)) return {};
  const container = (SPECIMEN_CONTAINERS as readonly string[]).includes(value.container) ? value.container
    : isRecord(value.container) && (SPECIMEN_CONTAINERS as readonly string[]).includes(value.container.kind) ? value.container.kind : undefined;
  const width = positiveInt(value.width, 3840) ?? positiveInt(value.defaults?.width, 3840);
  const theme = typeof value.theme === "string" ? value.theme : typeof value.defaults?.theme === "string" ? value.defaults.theme : undefined;
  const fixtures = isRecord(value.fixtures) ? value.fixtures : isRecord(value.props) ? value.props : undefined;
  const copy = adaptCopy(value.copy);
  return {
    ...(fixtures ? { fixtures } : {}), ...(copy ? { copy } : {}), ...(container ? { container } : {}),
    ...(theme ? { theme } : {}), ...(width ? { width } : {}),
    ...(typeof value.entry === "string" ? { entry: value.entry } : {}),
    ...(typeof value.export === "string" ? { export: value.export } : {}),
  };
}

/** Payload files: a shadcn registry item's `files[]`, or the payload itself as one file. */
function payloadFiles(path: string, raw: string): SpecimenFile[] {
  if (!path.endsWith(".json")) return [{ path, content: raw }];
  let item: unknown;
  try { item = JSON.parse(raw); } catch { throw new Error(`payload ${path} is not valid JSON`); }
  if (!isRecord(item) || !Array.isArray(item.files)) return [];
  return item.files.filter((file: unknown): file is Record<string, any> => isRecord(file) && typeof file.path === "string" && typeof file.content === "string")
    .map(file => ({ path: file.path, content: file.content, ...(typeof file.type === "string" ? { type: file.type } : {}) }));
}

function hashFiles(files: readonly { name: string; bytes: string }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) hash.update(file.name).update("\0").update(file.bytes).update("\0");
  return hash.digest("hex");
}

/** Read a file named by a record, refusing anything outside the record directory. */
async function readInside(dir: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error(`payload path ${name} leaves the record`);
  const root = await realpath(dir);
  const target = await realpath(resolve(root, name));
  const inside = relative(root, target);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`payload path ${name} leaves the record`);
  return readFile(target, "utf8");
}

/** Adapt one record directory (`<id>/v<n>/`) into the renderer's minimal record. */
export async function adaptElementRecord(dir: string): Promise<SpecimenRecord> {
  const elementRaw = await readFile(join(dir, "element.json"), "utf8");
  const element = JSON.parse(elementRaw);
  if (!isRecord(element) || typeof element.id !== "string" || !validSpecimenId(element.id)) throw new Error(`${dir}: element.json needs a valid id`);
  const version = positiveInt(element.version, 999_999);
  if (!version) throw new Error(`${element.id}: element.json needs a positive integer version`);
  const kind = specimenKindOf(element);
  const payloadPath = typeof element.payload === "string" ? element.payload : isRecord(element.payload) && typeof element.payload.path === "string" ? element.payload.path : undefined;
  if (!payloadPath) throw new Error(`${element.id}: element.json names no payload`);
  let previewRaw = "";
  try { previewRaw = await readFile(join(dir, "preview.json"), "utf8"); } catch { /* preview.json is optional */ }
  const raw = await readInside(dir, payloadPath);
  return {
    id: element.id, version, kind,
    payload: { path: payloadPath, raw, files: payloadFiles(payloadPath, raw) },
    preview: adaptPreview(previewRaw ? JSON.parse(previewRaw) : {}),
    contentHash: hashFiles([{ name: "element.json", bytes: elementRaw }, { name: "preview.json", bytes: previewRaw }, { name: payloadPath, bytes: raw }]),
  };
}

function cssVarMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const vars: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    const key = name.replace(/^--/, "");
    // Values become CSS text: no declaration, block or markup breakouts.
    if (VAR_NAME.test(key) && typeof raw === "string" && !/[;{}<>\\]/.test(raw)) vars[key] = raw.trim();
  }
  return vars;
}

/** A theme from a shadcn `registry:theme` item (or any item carrying `cssVars`). */
export function adaptTheme(id: string, raw: string, contentHash: string): SpecimenTheme | undefined {
  let item: unknown;
  try { item = JSON.parse(raw); } catch { return undefined; }
  if (!isRecord(item) || !isRecord(item.cssVars)) return undefined;
  const light = cssVarMap(item.cssVars.light);
  if (!light) return undefined;
  const theme = cssVarMap(item.cssVars.theme), dark = cssVarMap(item.cssVars.dark);
  return { id, light, contentHash, ...(theme ? { theme } : {}), ...(dark ? { dark } : {}) };
}

async function isDir(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export interface DirectorySourceOptions {
  /** Record roots, searched in order; the first root holding an id wins. */
  readonly roots: readonly string[];
  /** Theme id used when neither the URL nor the record names one. */
  readonly defaultTheme?: string;
}

/** A read-only source over record directories on disk. */
export function directoryRecordSource(options: DirectorySourceOptions): SpecimenRecordSource {
  const roots = options.roots.map(root => resolve(root));
  async function versionsOf(id: string): Promise<{ dir: string; version: number }[]> {
    for (const root of roots) {
      const base = join(root, ...id.split("/"));
      if (!base.startsWith(root + sep) || !await isDir(base)) continue;
      const versions = (await readdir(base)).map(name => ({ name, match: VERSION_DIR.exec(name) }))
        .filter(row => row.match).map(row => ({ dir: join(base, row.name), version: Number(row.match![1]) }));
      if (versions.length) return versions.sort((a, b) => b.version - a.version);
    }
    return [];
  }
  async function read(id: string, version?: number): Promise<SpecimenRecord | undefined> {
    if (!validSpecimenId(id)) return undefined;
    const versions = await versionsOf(id);
    const row = version === undefined ? versions[0] : versions.find(candidate => candidate.version === version);
    if (!row || !await isDir(row.dir)) return undefined;
    const record = await adaptElementRecord(row.dir);
    if (record.id !== id || record.version !== row.version) throw new Error(`${row.dir}: element.json says ${record.id}@${record.version}`);
    return record;
  }
  return {
    read,
    async theme(id = options.defaultTheme) {
      if (!id) return undefined;
      const record = await read(id);
      return record ? adaptTheme(record.id, record.payload.raw, record.contentHash) : undefined;
    },
  };
}
