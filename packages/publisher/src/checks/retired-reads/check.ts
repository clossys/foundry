/**
 * Retired-id read check (foundry-build-0037). A retired id is recorded once, in the retired data that retires it; any
 * other mention of it in the Publisher package is a live read and fails. There is no baseline and no allowlist.
 *
 * Retired ids: Designer's catalog registry plus the in-place retirements of its IA extension (ia/slides.json), and
 * Publisher's catalog registry. A missing Designer or Publisher list, a missing Designer IA extension, or an empty set
 * throws instead of shrinking what the scan can see.
 *
 * The scan fails closed. Every regular file under the root is read, whatever its name or extension; only output folders
 * at the package root are skipped. A file that is not valid UTF-8, a symlink, or any other non-file entry is reported as
 * `unscannable`, never skipped. Retired data is exempt from the id scan only in three shapes, each checked by place and
 * content, never by name alone:
 *   - the registry: a `retired.json` at a path the policy declares, holding a non-empty array of entries with exactly
 *     the string keys id, retiredAt, decidedBy, reason and optional replacedBy. A `retired.json` anywhere else is
 *     `registry-misplaced`; one at a declared path with any other shape is `registry-schema`. Either is scanned like
 *     any file and guarded like other retired data;
 *   - `.json` data under a `retired/` folder (never source);
 *   - a `*.leaf-freeze.json` signed record whose leaf ids are all retired (a record of retirements, never edited).
 * A JSON document that marks itself retired gets no exemption: it is scanned like any other file.
 *
 * Three more rules close the ways around the scan:
 *   - a live read: a path literal that names guarded retired data (exempt data other than the registry, a self-marked
 *     retired document, a misplaced or malformed registry) fails. A literal matches when its trailing path segments
 *     agree with the guarded file's, so the file name alone suffices; a `${...}` interpolation in a folder segment
 *     matches any text, and consecutive comma-separated literals (join or resolve arguments) are joined into one path;
 *   - the registry is read only by the policy's declared readers: any other file whose import, require or path literal
 *     resolves exactly to a declared registry fails as `registry-read`. Docs (.md) may name it;
 *   - an alias: a retired `<namespace>.<name>` used as the bare `"<name>"` string in a file under a `<namespace>/`
 *     folder fails, because that is the retired leaf under a new spelling.
 * The scan is lexical. Known limit: ids or paths assembled at run time by concatenation or computed values are not
 * visible to it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHER_RETIRED, designerPackageDir, loadDesignerCatalog } from "../../catalog/ia/tree.js";

export const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export type RetiredReadKind =
  | "id" | "alias" | "retired-data-read" | "unscannable" | "registry-misplaced" | "registry-schema" | "registry-read";
export interface RetiredRead { readonly file: string; readonly line: number; readonly id: string; readonly kind?: RetiredReadKind }

/** Where a package's retired registry may sit, and the only files that may read it. Root-relative posix paths. */
export interface RetiredReadPolicy { readonly registries: readonly string[]; readonly registryReaders: readonly string[] }
export const PUBLISHER_POLICY: RetiredReadPolicy = Object.freeze({
  registries: Object.freeze([posix.join("src", "catalog", "retired.json")]),
  registryReaders: Object.freeze([posix.join("src", "catalog", "ia", "tree.ts")]),
});

/** Both lists are required: losing either one throws instead of shrinking what the scan can see. */
export function retiredIdsFrom(designerIds: Iterable<string>, publisher: readonly { readonly id: string }[]): ReadonlySet<string> {
  const designer = [...designerIds];
  if (!designer.length) throw new TypeError("No Designer retired ids loaded; the retired data is unavailable");
  if (!publisher.length) throw new TypeError("No Publisher retired ids loaded; the retired data is unavailable");
  return new Set([...designer, ...publisher.map(entry => entry.id)]);
}

/**
 * Every retired id Publisher must not read: Designer's and Publisher's own. Designer's IA extension is required, because
 * its in-place retirements would otherwise drop out of the set without a signal.
 */
export function retiredIds(designerDir: string = designerPackageDir()): ReadonlySet<string> {
  if (!existsSync(join(designerDir, "src", "catalog", "ia", "slides.json"))) {
    throw new TypeError("Designer IA extension ia/slides.json is missing; its in-place retirements would drop out of the scan");
  }
  return retiredIdsFrom(loadDesignerCatalog(designerDir).retired, PUBLISHER_RETIRED);
}

/** Output folders, skipped only at the package root and never at any depth. */
const ROOT_OUTPUT = new Set(["node_modules", "dist", "build", "out", ".next", "coverage", ".turbo", ".cache", ".git"]);
const REGISTRY_NAME = "retired.json";
const REGISTRY_REQUIRED = ["id", "retiredAt", "decidedBy", "reason"] as const;
const REGISTRY_KEYS: ReadonlySet<string> = new Set([...REGISTRY_REQUIRED, "replacedBy"]);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const parse = (source: string): unknown => { try { return JSON.parse(source); } catch { return undefined; } };
const baseName = (path: string): string => path.split(/[\\/]/).at(-1)!;

/** A top-level `retired` marker of retiredAt, decidedBy and reason: the document says it is retired. */
export function marksItselfRetired(value: unknown): boolean {
  if (!object(value) || !object(value.retired)) return false;
  return ["retiredAt", "decidedBy", "reason"].every(key => text((value.retired as Record<string, unknown>)[key]));
}

/** The closed registry shape: retirement metadata only, so a registry can carry no live data. */
export const isRegistry = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  && value.every(entry => object(entry) && REGISTRY_REQUIRED.every(key => Object.hasOwn(entry, key))
    && Object.entries(entry).every(([key, field]) => REGISTRY_KEYS.has(key) && text(field)));

/** A `retired.json`'s standing: the registry only at a declared path with the closed shape. Other files: null. */
export function registryStatus(file: string, source: string, policy: RetiredReadPolicy = PUBLISHER_POLICY): "registry" | "registry-misplaced" | "registry-schema" | null {
  if (baseName(file) !== REGISTRY_NAME) return null;
  if (!policy.registries.includes(file)) return "registry-misplaced";
  return isRegistry(parse(source)) ? "registry" : "registry-schema";
}

/** How retired data is exempt from the id scan, or null when the file is scanned. Place and shape decide, never the name. */
export function retiredDataKind(path: string, source: string, ids: ReadonlySet<string>, policy: RetiredReadPolicy = PUBLISHER_POLICY): "registry" | "retired-folder" | "freeze" | null {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1)!;
  if (name === REGISTRY_NAME) return registryStatus(parts.join("/"), source, policy) === "registry" ? "registry" : null;
  if (!name.endsWith(".json")) return null;
  const value = parse(source);
  if (value === undefined) return null;
  if (parts.slice(0, -1).includes("retired")) return "retired-folder";
  if (name.endsWith(".leaf-freeze.json") && object(value) && Array.isArray(value.leafIds) && value.leafIds.length > 0
    && value.leafIds.every(id => typeof id === "string" && ids.has(id))) return "freeze";
  return null;
}

/** True for the retired data that records retirements; everything else is scanned. */
export function isRetiredData(path: string, source: string, ids: ReadonlySet<string> = retiredIds(), policy: RetiredReadPolicy = PUBLISHER_POLICY): boolean {
  return retiredDataKind(path, source, ids, policy) !== null;
}

/** Every entry under `root` except root output folders: regular files to read, and any other entry to report. */
function entries(root: string): { path: string; regular: boolean }[] {
  const out: { path: string; regular: boolean }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!(dir === root && ROOT_OUTPUT.has(entry.name))) walk(path); }
      else out.push({ path, regular: entry.isFile() });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A retired id is read where it appears whole: not inside a longer id, path segment or dotted name. */
export function retiredPattern(ids: ReadonlySet<string>): RegExp {
  const alternatives = [...ids].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join("|");
  return new RegExp(`(?<![A-Za-z0-9_.-])(${alternatives})(?![A-Za-z0-9_-])`, "g");
}

const QUOTED = /(["'`])([^"'`\n]+?)\1/g;
/** What may sit between two literals of one path: a comma, as between join or resolve arguments. */
const ARGUMENT_GAP = /^\s*,\s*$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/** Root-relative spellings a path literal may take for one package file: as itself and as its built copy. */
function spellings(file: string): string[] {
  const out = [file];
  if (file.startsWith("src/")) out.push(`dist/${file.slice(4)}`);
  return out;
}

/** A path literal as root-relative text: relative literals resolve from the file's folder; a leading slash is dropped. */
const rooted = (file: string, literal: string): string => literal.startsWith("./") || literal.startsWith("../")
  ? posix.normalize(posix.join(posix.dirname(file), literal))
  : literal.replace(/^\/+/, "");

/** A `${...}` interpolation matches any text, separators included. */
const wildcard = (segment: string): RegExp =>
  new RegExp(`^${segment.split(/\$\{[^}]*\}/).map(escape).join("[\\s\\S]*")}$`);

/**
 * True when the candidate path names `known` by its trailing segments: the file name must be spelled out and equal,
 * and every segment the two share from the end must agree. Segments above `known` are the package's own location and
 * may be anything. A folder segment holding an interpolation matches the rest of `known` up to that point.
 */
export function pathNames(candidate: string, known: string): boolean {
  const have = candidate.split("/").filter(segment => segment && segment !== ".");
  const want = known.split("/");
  if (!have.length || have.at(-1) !== want.at(-1)) return false;
  for (let back = 2; back <= have.length; back++) {
    const segment = have[have.length - back]!;
    if (segment.includes("${")) return wildcard(segment).test(want.slice(0, Math.max(0, want.length - back + 1)).join("/"));
    if (back > want.length) return true;
    if (segment !== want[want.length - back]) return false;
  }
  return true;
}

/** Every live read of a retired id under `root`, in file and line order. */
export function findRetiredReads(root: string = publisherRoot, ids: ReadonlySet<string> = retiredIds(), policy: RetiredReadPolicy = PUBLISHER_POLICY): RetiredRead[] {
  if (!ids.size) throw new TypeError("No retired ids loaded; the retired data is unavailable");
  const pattern = retiredPattern(ids);
  const reads: RetiredRead[] = [];
  const scanned: { file: string; source: string }[] = [];
  const registries = new Set<string>(); // declared registries with the closed shape: exempt, and read only by declared readers
  const guarded = new Map<string, string>(); // spelling -> root-relative retired data file that must not be read live
  const guard = (file: string) => { for (const spelling of spellings(file)) guarded.set(spelling, file); };
  for (const { path, regular } of entries(root)) {
    const file = relative(root, path).split(sep).join("/");
    if (!regular) { reads.push({ file, line: 0, id: "symlink-or-special", kind: "unscannable" }); continue; }
    let source: string;
    try { source = UTF8.decode(readFileSync(path)); } catch { reads.push({ file, line: 0, id: "not-utf8", kind: "unscannable" }); continue; }
    const status = registryStatus(file, source, policy);
    if (status === "registry") { registries.add(file); continue; }
    if (status !== null) { reads.push({ file, line: 0, id: file, kind: status }); guard(file); }
    const kind = retiredDataKind(file, source, ids, policy);
    if (kind !== null || (file.endsWith(".json") && marksItselfRetired(parse(source)))) guard(file);
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
  const readers = new Set(policy.registryReaders);
  const named = (candidate: string): Set<string> => {
    const out = new Set<string>();
    for (const [spelling, file] of guarded) if (pathNames(candidate, spelling)) out.add(file);
    return out;
  };
  for (const { file, source } of scanned) {
    source.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(pattern)) reads.push({ file, line: index + 1, id: match[1]!, kind: "id" });
    });
    const folders = file.split("/").slice(0, -1);
    const names = folders.flatMap(folder => aliases.has(folder) ? [aliases.get(folder)!] : []);
    const literals = [...source.matchAll(QUOTED)].map(match => ({ text: match[2]!, start: match.index!, end: match.index! + match[0].length }));
    const live = new Set<string>(); // "line\0file" of each live read already reported
    literals.forEach((literal, end) => {
      const line = lineOf(source, literal.start);
      for (const map of names) {
        const id = map.get(literal.text);
        if (id) reads.push({ file, line, id, kind: "alias" });
      }
      const target = rooted(file, literal.text).replace(/^dist\//, "src/");
      if (registries.has(target) && !readers.has(file) && !file.endsWith(".md")) reads.push({ file, line, id: target, kind: "registry-read" });
      // The literals ending here, joined with the comma-separated literals before them; the longest path that names
      // guarded data decides which file is read.
      let start = end;
      while (start > 0 && ARGUMENT_GAP.test(source.slice(literals[start - 1]!.end, literals[start]!.start))) start--;
      for (let from = start; from <= end; from++) {
        const hits = named(rooted(file, literals.slice(from, end + 1).map(part => part.text).join("/")));
        if (!hits.size) continue;
        for (const hit of hits) {
          if (live.has(`${line}\0${hit}`)) continue;
          live.add(`${line}\0${hit}`);
          reads.push({ file, line, id: hit, kind: "retired-data-read" });
        }
        break;
      }
    });
  }
  return reads.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id) || (a.kind ?? "").localeCompare(b.kind ?? ""));
}
