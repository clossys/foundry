/**
 * Specimen assets (foundry-build-0048 CP1-G2): the bound Next install publishes the specimen PNGs its records reference,
 * so the admin detail page can show them. It copies `clossys/.state` content into the site's `public/` folder, so it is
 * a publish-safety surface: only a PNG that a render `index.json` under RENDERS_DIR names, whose bytes hash to the
 * record's sha256, is copied, and it is copied content-addressed to `public/clossys/renders/<sha256>.png`.
 *
 * A specimen reference is `{ sha256, path }`: the PNG's sha256 and the root-relative path the render index names it by
 * (the index row's `png`). The render index (`clossys.render/1`) records no hash of a PNG's bytes, so the expected
 * sha256 is the reference's; the index decides only which paths may be published.
 *
 * Every reference is checked before anything is written, and the bytes that were checked are the bytes written. A
 * refusal is a named finding and writes nothing for that reference:
 * - `specimen-invalid-ref`: the reference is not `{ sha256: <64 hex>, path: <string> }`;
 * - `specimen-not-indexed`: no render `index.json` under the render root names the path;
 * - `specimen-outside-root`: the path is absolute, climbs out with `..`, passes a symlinked folder, or its real path is
 *   not under the render root's real path;
 * - `specimen-symlink`: the file itself is a symlink (never followed, wherever it points);
 * - `specimen-not-png`: not a regular `.png` file starting with the 8-byte PNG signature;
 * - `specimen-sha256-mismatch`: the bytes do not hash to the reference's sha256;
 * - `specimen-target-not-file`: the public target exists and is not a regular file.
 *
 * Idempotent: the same bytes give the same name, and a target already holding those bytes is left alone, so a
 * reinstall writes no new file. Nothing else under `.state` (an index, an HTML specimen, a cache file) is copied.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { RENDERS_DIR } from "../specimen/render.js";

/** Where the copies land, relative to the site project (Next serves `public/` at the site root). */
export const SPECIMEN_PUBLIC_DIR = "public/clossys/renders";
/** The URL a published specimen is served at. */
export const specimenPublicPath = (sha256: string) => `/clossys/renders/${sha256}.png`;

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256 = /^[0-9a-f]{64}$/;

export type SpecimenRefusalCode =
  | "specimen-invalid-ref" | "specimen-not-indexed" | "specimen-outside-root" | "specimen-symlink"
  | "specimen-not-png" | "specimen-sha256-mismatch" | "specimen-target-not-file";
export interface SpecimenRef { readonly sha256: string; readonly path: string }
export interface SpecimenRefusal { readonly code: SpecimenRefusalCode; readonly path: string; readonly detail: string }
/** A checked specimen: the bytes that passed every check, and where they go. */
export interface SpecimenAsset { readonly path: string; readonly sha256: string; readonly file: string; readonly bytes: Buffer }
export interface SpecimenPlan { readonly assets: readonly SpecimenAsset[]; readonly refusals: readonly SpecimenRefusal[] }

const isRef = (value: unknown): value is SpecimenRef => {
  const row = value as Record<string, unknown> | null;
  return typeof row === "object" && row !== null && typeof row.sha256 === "string" && SHA256.test(row.sha256) && typeof row.path === "string" && row.path.length > 0;
};
const lstatOrNull = (path: string) => { try { return lstatSync(path); } catch { return null; } };
const within = (base: string, path: string) => path.startsWith(base + sep);

/**
 * Every PNG path a render `index.json` under the render root names. The walk never follows a symlink (a linked folder
 * or index is skipped), and an index that is unreadable or not `clossys.render/1` names nothing.
 */
export function indexedPngs(renderRoot: string): Set<string> {
  const named = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name === "index.json") {
        let index: { schema?: unknown; specimens?: unknown };
        try { index = JSON.parse(readFileSync(path, "utf8")) as typeof index; } catch { continue; }
        if (index.schema !== "clossys.render/1" || !Array.isArray(index.specimens)) continue;
        for (const row of index.specimens) {
          const png = (row as { png?: unknown } | null)?.png;
          if (typeof png === "string" && png.length) named.add(png);
        }
      }
    }
  };
  walk(renderRoot);
  return named;
}

/**
 * Whether `source` (the absolute lexical path of `path`) lies under the render root: not absolute, no `..`, no
 * symlinked folder between the render root and the file, and its folder's real path under the render root's real
 * path. The file's own last segment is never dereferenced here: a symlinked file is `specimen-symlink`'s refusal.
 * Returns the refusal detail, or undefined when contained.
 */
function outsideRoot(renderRoot: string, realRoot: string, path: string, source: string): string | undefined {
  if (isAbsolute(path)) return "an absolute path";
  if (path.split(/[\\/]/).includes("..")) return "a path that climbs with ..";
  if (!within(renderRoot, source)) return "a path outside the render root";
  let cursor = renderRoot;
  for (const segment of relative(renderRoot, source).split(sep).slice(0, -1)) {
    cursor = join(cursor, segment);
    if (lstatOrNull(cursor)?.isSymbolicLink()) return `a symlinked folder (${relative(renderRoot, cursor)})`;
  }
  let real: string;
  try { real = realpathSync(dirname(source)); } catch { return "a folder that does not resolve"; }
  if (real !== realRoot && !within(realRoot, real)) return "a real path outside the render root";
  return undefined;
}

type SourceRead = { readonly kind: "file"; readonly bytes: Buffer } | { readonly kind: "symlink" } | { readonly kind: "not-file" } | { readonly kind: "unreadable"; readonly message: string };

/**
 * Read a contained source without following a symlink at its last segment: lstat refuses a link, and the open is
 * O_NOFOLLOW, so a link swapped in after the lstat is refused too. Only a regular file is read.
 */
function readSource(source: string): SourceRead {
  const stat = lstatOrNull(source);
  if (stat?.isSymbolicLink()) return { kind: "symlink" };
  if (!stat?.isFile()) return { kind: "not-file" };
  let fd: number;
  try { fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") return { kind: "symlink" };
    return { kind: "unreadable", message: error instanceof Error ? error.message : String(error) };
  }
  try {
    if (!fstatSync(fd).isFile()) return { kind: "not-file" };
    return { kind: "file", bytes: readFileSync(fd) };
  } catch (error) { return { kind: "unreadable", message: error instanceof Error ? error.message : String(error) }; }
  finally { closeSync(fd); }
}

/**
 * Check every reference against the render root of the workspace `root`; read no file content outside it and write
 * nothing. References are de-duplicated by path and sha256.
 */
export function planSpecimenAssets(root: string, refs: readonly unknown[]): SpecimenPlan {
  const renderRoot = resolve(root, RENDERS_DIR);
  const assets: SpecimenAsset[] = [];
  const refusals: SpecimenRefusal[] = [];
  const refuse = (code: SpecimenRefusalCode, path: string, detail: string) => { refusals.push({ code, path, detail: `${code}: ${path}: ${detail}` }); };
  // The render root itself must be the real folder under the workspace (no symlinked `clossys`, `.state` or `renders`).
  const realOf = (path: string) => { try { return realpathSync(path); } catch { return undefined; } };
  const realRoot = realOf(renderRoot), rootReal = realOf(root);
  const rootUsable = realRoot !== undefined && rootReal !== undefined && realRoot === join(rootReal, RENDERS_DIR);
  const named = rootUsable ? indexedPngs(renderRoot) : new Set<string>();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!isRef(ref)) { refuse("specimen-invalid-ref", String((ref as { path?: unknown } | null)?.path ?? "(none)"), "a specimen reference needs a 64-hex sha256 and a path"); continue; }
    const key = `${ref.path}\0${ref.sha256}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!rootUsable) { refuse("specimen-not-indexed", ref.path, `the render root ${RENDERS_DIR} is missing or not a real folder of the workspace`); continue; }
    if (!named.has(ref.path)) { refuse("specimen-not-indexed", ref.path, `no render index.json under ${RENDERS_DIR} names it`); continue; }
    const source = resolve(root, ref.path);
    const outside = outsideRoot(renderRoot, realRoot!, ref.path, source);
    if (outside !== undefined) { refuse("specimen-outside-root", ref.path, `${outside}; only files under ${RENDERS_DIR} are published`); continue; }
    if (!ref.path.endsWith(".png")) { refuse("specimen-not-png", ref.path, "the path does not end in .png"); continue; }
    const read = readSource(source);
    if (read.kind === "symlink") { refuse("specimen-symlink", ref.path, "the file is a symlink, which is never followed"); continue; }
    if (read.kind === "not-file") { refuse("specimen-not-png", ref.path, "not a regular file"); continue; }
    if (read.kind !== "file") { refuse("specimen-not-png", ref.path, `unreadable (${read.message})`); continue; }
    const bytes = read.bytes;
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) { refuse("specimen-not-png", ref.path, "the bytes do not start with the PNG signature"); continue; }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== ref.sha256) { refuse("specimen-sha256-mismatch", ref.path, `the bytes hash to ${sha256}, the reference says ${ref.sha256}`); continue; }
    assets.push({ path: ref.path, sha256, file: `${SPECIMEN_PUBLIC_DIR}/${sha256}.png`, bytes });
  }
  return { assets, refusals };
}

/**
 * Write each checked asset into the site project. A target already holding the same bytes is unchanged; a target
 * that exists and is not a regular file (a symlink, a folder) is refused and never written through.
 */
export async function writeSpecimenAssets(site: string, assets: readonly SpecimenAsset[]): Promise<{ written: string[]; unchanged: string[]; refusals: SpecimenRefusal[] }> {
  const written: string[] = [], unchanged: string[] = [], refusals: SpecimenRefusal[] = [];
  const done = new Set<string>();
  for (const asset of assets) {
    if (done.has(asset.file)) continue;
    done.add(asset.file);
    const target = join(site, ...asset.file.split("/"));
    const stat = lstatOrNull(target);
    if (stat && !stat.isFile()) { refusals.push({ code: "specimen-target-not-file", path: asset.path, detail: `specimen-target-not-file: ${asset.file} exists and is not a regular file` }); continue; }
    if (stat && readFileSync(target).equals(asset.bytes)) { unchanged.push(asset.file); continue; }
    await mkdir(join(site, ...SPECIMEN_PUBLIC_DIR.split("/")), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, asset.bytes);
    await rename(temp, target);
    written.push(asset.file);
  }
  return { written, unchanged, refusals };
}

/** The specimen references the records snapshot's candidate rows carry (`candidates[<agent>/<slot>][].specimen`). */
export function recordSpecimenRefs(records: { readonly ports: { readonly candidates: Readonly<Record<string, readonly unknown[]>> } }): unknown[] {
  const refs: unknown[] = [];
  for (const rows of Object.values(records.ports.candidates)) for (const row of rows) {
    const specimen = (row as { specimen?: unknown } | null)?.specimen;
    if (specimen !== undefined && specimen !== null) refs.push(specimen);
  }
  return refs;
}

/**
 * The records with each candidate's specimen path resolved to its public path (`specimenPublicPath`). A specimen the
 * plan did not accept resolves to null, so no `.state` path is served. Nothing else in a row changes.
 */
export function resolveRecordSpecimens<T extends { readonly ports: { readonly candidates: Readonly<Record<string, readonly unknown[]>> } }>(records: T, assets: readonly SpecimenAsset[]): T {
  const published = new Map(assets.map(asset => [`${asset.path}\0${asset.sha256}`, asset.sha256]));
  const candidates = Object.fromEntries(Object.entries(records.ports.candidates).map(([key, rows]) => [key, rows.map(row => {
    const specimen = (row as { specimen?: unknown } | null)?.specimen;
    if (specimen === undefined || specimen === null) return row;
    const sha256 = isRef(specimen) ? published.get(`${specimen.path}\0${specimen.sha256}`) : undefined;
    return { ...(row as object), specimen: sha256 === undefined ? null : { ...(specimen as object), path: specimenPublicPath(sha256) } };
  })]));
  return { ...records, ports: { ...records.ports, candidates } };
}
