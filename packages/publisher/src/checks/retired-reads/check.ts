/**
 * Retired-id read check (foundry-build-0037). A retired id is recorded once, in the retired data that retires it; any
 * other mention of it in the Publisher package is a live read and fails. There is no baseline and no allowlist.
 *
 * Retired ids: Designer's `src/catalog/retired.json` plus the in-place retirements of its IA extensions, and
 * Publisher's `src/catalog/retired.json`.
 *
 * The scan fails closed. Only output folders at the package root are skipped. Retired data is exempt from the id scan
 * only in three shapes, each checked by content and never by name alone:
 *   - a `retired.json` registry: a non-empty array of entries with string id, retiredAt, decidedBy and reason;
 *   - `.json` data under a `retired/` folder (never source);
 *   - a `*.leaf-freeze.json` signed record whose leaf ids are all retired (a record of retirements, never edited).
 * A JSON document that marks itself retired gets no exemption: it is scanned like any other file.
 *
 * Three more rules close the ways around the scan:
 *   - a live read: any file that names the path of exempt retired data (other than a registry) or of a self-marked
 *     retired document, by import, read or path literal, fails, because that data would be read as live input;
 *   - an alias: a retired `<namespace>.<name>` used as the bare `"<name>"` string in a file under a `<namespace>/`
 *     folder fails, because that is the retired leaf under a new spelling;
 *   - an empty retired set, or a missing Designer or Publisher list, throws.
 * The registries are the one exempt data that may be read: reading them is how code learns what is retired.
 * Known limit: ids or paths assembled at run time (concatenation, template literals) are not visible to a text scan.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHER_RETIRED, loadDesignerCatalog } from "../../catalog/ia/tree.js";

export const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export type RetiredReadKind = "id" | "alias" | "retired-data-read";
export interface RetiredRead { readonly file: string; readonly line: number; readonly id: string; readonly kind?: RetiredReadKind }

/** Both lists are required: losing either one throws instead of shrinking what the scan can see. */
export function retiredIdsFrom(designerIds: Iterable<string>, publisher: readonly { readonly id: string }[]): ReadonlySet<string> {
  const designer = [...designerIds];
  if (!designer.length) throw new TypeError("No Designer retired ids loaded; the retired data is unavailable");
  if (!publisher.length) throw new TypeError("No Publisher retired ids loaded; the retired data is unavailable");
  return new Set([...designer, ...publisher.map(entry => entry.id)]);
}

/** Every retired id Publisher must not read: Designer's and Publisher's own. */
export function retiredIds(): ReadonlySet<string> {
  return retiredIdsFrom(loadDesignerCatalog().retired, PUBLISHER_RETIRED);
}

/** Output folders, skipped only at the package root and never at any depth. */
const ROOT_OUTPUT = new Set(["node_modules", "dist", "build", "out", ".next", "coverage", ".turbo", ".cache", ".git"]);
const TEXT = /\.(?:[cm]?[jt]sx?|json|md|css|html|txt|ya?ml|snap)$/;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const parse = (source: string): unknown => { try { return JSON.parse(source); } catch { return undefined; } };

/** A top-level `retired` marker of retiredAt, decidedBy and reason: the document says it is retired. */
export function marksItselfRetired(value: unknown): boolean {
  if (!object(value) || !object(value.retired)) return false;
  return ["retiredAt", "decidedBy", "reason"].every(key => text((value.retired as Record<string, unknown>)[key]));
}

const isRegistry = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  && value.every(entry => object(entry) && ["id", "retiredAt", "decidedBy", "reason"].every(key => text(entry[key])));

/** How retired data is exempt from the id scan, or null when the file is scanned. Shape decides, never the name. */
export function retiredDataKind(path: string, source: string, ids: ReadonlySet<string>): "registry" | "retired-folder" | "freeze" | null {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1)!;
  if (!name.endsWith(".json")) return null;
  const value = parse(source);
  if (value === undefined) return null;
  if (name === "retired.json" && isRegistry(value)) return "registry";
  if (parts.slice(0, -1).includes("retired")) return "retired-folder";
  if (name.endsWith(".leaf-freeze.json") && object(value) && Array.isArray(value.leafIds) && value.leafIds.length > 0
    && value.leafIds.every(id => typeof id === "string" && ids.has(id))) return "freeze";
  return null;
}

/** True for the retired data that records retirements; everything else is scanned. */
export function isRetiredData(path: string, source: string, ids: ReadonlySet<string> = retiredIds()): boolean {
  return retiredDataKind(path, source, ids) !== null;
}

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!(dir === root && ROOT_OUTPUT.has(entry.name))) walk(path); }
      else if (entry.isFile() && TEXT.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A retired id is read where it appears whole: not inside a longer id, path segment or dotted name. */
export function retiredPattern(ids: ReadonlySet<string>): RegExp {
  const alternatives = [...ids].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join("|");
  return new RegExp(`(?<![A-Za-z0-9_.-])(${alternatives})(?![A-Za-z0-9_-])`, "g");
}

const QUOTED = /(["'`])([^"'`\n]+?)\1/g;
const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/** Root-relative spellings a path literal may take for one package file: as itself and as its built copy. */
function spellings(file: string): string[] {
  const out = [file];
  if (file.startsWith("src/")) out.push(`dist/${file.slice(4)}`);
  return out;
}

/** Every live read of a retired id under `root`, in file and line order. */
export function findRetiredReads(root: string = publisherRoot, ids: ReadonlySet<string> = retiredIds()): RetiredRead[] {
  if (!ids.size) throw new TypeError("No retired ids loaded; the retired data is unavailable");
  const pattern = retiredPattern(ids);
  const scanned: { file: string; source: string }[] = [];
  const guarded = new Map<string, string>(); // spelling -> root-relative retired data file that must not be read live
  for (const path of files(root)) {
    const source = readFileSync(path, "utf8");
    const file = relative(root, path).split(sep).join("/");
    const kind = retiredDataKind(file, source, ids);
    if (kind !== "registry" && (kind !== null || (file.endsWith(".json") && marksItselfRetired(parse(source))))) {
      for (const spelling of spellings(file)) guarded.set(spelling, file);
    }
    if (kind === null) scanned.push({ file, source });
  }
  const aliases = new Map<string, Map<string, string>>(); // namespace -> bare name -> retired id
  for (const id of ids) {
    const dot = id.indexOf(".");
    if (dot <= 0 || dot === id.length - 1) continue;
    const namespace = id.slice(0, dot), name = id.slice(dot + 1);
    if (!aliases.has(namespace)) aliases.set(namespace, new Map());
    aliases.get(namespace)!.set(name, id);
  }
  const reads: RetiredRead[] = [];
  for (const { file, source } of scanned) {
    source.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(pattern)) reads.push({ file, line: index + 1, id: match[1]!, kind: "id" });
    });
    const folders = file.split("/").slice(0, -1);
    const names = folders.flatMap(folder => aliases.has(folder) ? [aliases.get(folder)!] : []);
    for (const match of source.matchAll(QUOTED)) {
      const literal = match[2]!;
      for (const map of names) {
        const id = map.get(literal);
        if (id) reads.push({ file, line: lineOf(source, match.index!), id, kind: "alias" });
      }
      const target = literal.startsWith("./") || literal.startsWith("../")
        ? posix.normalize(posix.join(posix.dirname(file), literal))
        : literal.replace(/^\/+/, "");
      const spelling = guarded.has(target) ? target : [...guarded.keys()].find(known => target.endsWith(`/${known}`));
      if (spelling) reads.push({ file, line: lineOf(source, match.index!), id: guarded.get(spelling)!, kind: "retired-data-read" });
    }
  }
  return reads.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
}
