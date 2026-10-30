/** Profile-independent, root-confined cell reads and confirmed batch writes. */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument, type FlatDocument } from "./markdown.js";
import { CELL_ID_PATTERN, cellPath, isoDate, parseConfirmRef, parseLinkRef, positiveInteger, validateGenericTree, type GenericTree } from "./schema.js";

export interface StoredCell {
  id: string;
  version: number;
  status: "draft" | "active" | "retired";
  /** Root-relative permanent path. */
  path: string;
  source: string;
  document: FlatDocument;
}
export interface ActivationContext {
  root: string;
  refs: readonly string[];
  confirm: string;
  /** Exact proposed targets, in caller order. */
  cells: readonly StoredCell[];
  active: Readonly<Record<string, number | null>>;
}
export interface ActivateOptions {
  /** Syntax is checked here; session authenticity belongs to the calling agent. */
  confirm: string;
  beforeActivate?: (context: ActivationContext) => void | boolean | Promise<void | boolean>;
}
interface Layout { root: string; paths: { id: string; version: number; path: string }[]; ids: string[] }
interface Change { path: string; before: string; after: string }

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
/** Check every existing ancestor, including ancestors of the supplied root. */
function safePath(root: string, path: string): string {
  const base = resolve(root); const target = resolve(base, path); const rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail(path, "Path escapes the cell root");
  let current = target;
  for (;;) {
    try { if (lstatSync(current).isSymbolicLink()) fail(path, "Symbolic links are not followed"); }
    catch (error) { if (!missing(error)) throw error; }
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return target;
}
function read(root: string, path: string): string {
  const target = safePath(root, path); let fd: number | undefined;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile()) fail(path, "Expected a regular file");
    const current = lstatSync(safePath(root, path));
    if (opened.dev !== current.dev || opened.ino !== current.ino) fail(path, "File changed during confinement checks");
    return readFileSync(fd, "utf8");
  } finally { if (fd !== undefined) closeSync(fd); }
}
function directory(root: string, path: string, optional = false): string[] {
  const target = safePath(root, path);
  try {
    if (!lstatSync(target).isDirectory()) fail(path, "Expected a directory");
    return readdirSync(target).sort();
  } catch (error) { if (optional && missing(error)) return []; throw error; }
}
function layout(root: string): Layout {
  const base = resolve(root); directory(base, ".");
  const ids = directory(base, "cells", true); const paths: Layout["paths"] = [];
  for (const id of ids) {
    if (!CELL_ID_PATTERN.test(id)) fail(`cells/${id}`, "Expected a permanent shared cell id");
    for (const name of directory(base, `cells/${id}`)) {
      const match = /^v([1-9]\d*)\.md$/.exec(name); const version = Number(match?.[1]);
      if (!match || !positiveInteger(version)) fail(`cells/${id}/${name}`, "Expected v<positive safe integer>.md");
      const path = cellPath(id, version);
      const stat = lstatSync(safePath(base, path));
      if (!stat.isFile()) fail(path, "Expected a regular cell file");
      paths.push({ id, version, path });
    }
  }
  paths.sort((a, b) => a.id.localeCompare(b.id, "en") || a.version - b.version);
  return { root: base, ids, paths };
}
function parseCell(id: string, version: number, source: string): StoredCell {
  const path = cellPath(id, version); const result = parseDocument(source);
  if (!result.ok) fail(path, result.issues.map(issue => `line ${issue.line}: ${issue.message}`).join("; "));
  const document = result.value; const fields = document.fields;
  if (fields.id !== id || fields.version !== version) fail(path, "Frontmatter id/version disagrees with its path");
  if (fields.status !== "draft" && fields.status !== "active" && fields.status !== "retired") fail(path, "Expected draft, active or retired status");
  if (!isoDate(fields.updated)) fail(path, "Expected an updated calendar date");
  // The legacy Strategist profile permits absent links; agent profiles own other keys.
  if (fields.links !== undefined && (!Array.isArray(fields.links) || fields.links.some(link => typeof link !== "string" || !parseLinkRef(link)))) fail(path, "Expected cell link references");
  if (fields.status === "active" || fields.confirmed !== undefined) {
    const confirm = typeof fields.confirmed === "string" ? parseConfirmRef(fields.confirmed) : undefined;
    if (!confirm || (confirm.kind === "migration" && version !== 1)) fail(path, "Expected a valid confirmation; migration is restricted to version 1");
  }
  return { id, version, status: fields.status, path, source, document };
}
function loadCell(root: string, entry: Layout["paths"][number]): StoredCell { return parseCell(entry.id, entry.version, read(root, entry.path)); }
function loadTree(snapshot: Layout): { source: string; tree: GenericTree } {
  const source = read(snapshot.root, "tree.json"); let value: unknown;
  try { value = JSON.parse(source); } catch { fail("tree.json", "Invalid JSON"); }
  // Publisher web trees may contain three grouping levels. Individual profiles narrow this.
  const parsed = validateGenericTree(value, { cellIds: snapshot.ids, maxDepth: 3 });
  if (!parsed.ok) fail("tree.json", parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  return { source, tree: parsed.value };
}
function activeCells(snapshot: Layout, tree: GenericTree): StoredCell[] {
  const cells: StoredCell[] = [];
  for (const id of Object.keys(tree.active).sort()) {
    const version = tree.active[id]; if (version === null || version === undefined) continue;
    const entry = snapshot.paths.find(candidate => candidate.id === id && candidate.version === version);
    if (!entry) fail("tree.json", `Active target ${id}@${version} is missing`);
    const cell = loadCell(snapshot.root, entry);
    if (cell.status !== "active") fail(cell.path, "Status disagrees with the active pointer");
    cells.push(cell);
  }
  return cells;
}

/** Lists all stored versions; no catalog or agent profile is consulted. */
export async function listCells(root: string): Promise<StoredCell[]> {
  const snapshot = layout(root); return snapshot.paths.map(entry => loadCell(snapshot.root, entry));
}
export function readActive(root: string): Promise<StoredCell[]>;
export function readActive(root: string, id: string): Promise<StoredCell | undefined>;
/** Only tree.json pointers are opened; incomplete higher drafts remain invisible. */
export async function readActive(root: string, id?: string): Promise<StoredCell[] | StoredCell | undefined> {
  if (id !== undefined && !CELL_ID_PATTERN.test(id)) fail(id, "Invalid cell id");
  const snapshot = layout(root); const { tree } = loadTree(snapshot);
  if (id !== undefined && (tree.active[id] === null || tree.active[id] === undefined)) return undefined;
  const cells = activeCells(snapshot, id === undefined ? tree : { ...tree, active: { [id]: tree.active[id]! } });
  return id === undefined ? cells : cells[0];
}

/** Changes only authorized physical frontmatter lines; other bytes are untouched. */
function metadata(cell: StoredCell, values: Record<string, string | undefined>): string {
  const lines: { start: number; end: number; text: string; newline: string }[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|$)/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(cell.source)) && match[0]) lines.push({ start: match.index, end: pattern.lastIndex, text: match[1]!, newline: match[2]! });
  const close = lines.findIndex((line, i) => i > 0 && line.text === "---");
  const edits: { start: number; end: number; value: string }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const number = cell.document.fieldLines[key]; const line = number === undefined ? undefined : lines[number - 1];
    if (line) edits.push({ start: line.start, end: value === undefined ? line.end : line.end - line.newline.length, value: value === undefined ? "" : `${key}: ${value}` });
    else if (value !== undefined) {
      const closing = lines[close]!; edits.push({ start: closing.start, end: closing.start, value: `${key}: ${value}${lines[0]!.newline}` });
    }
  }
  let source = cell.source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
async function locked<T>(root: string, action: (base: string, stage: string) => Promise<T> | T): Promise<T> {
  const base = resolve(root); directory(base, "."); const lock = safePath(base, ".cell-format-write.lock");
  try { mkdirSync(lock); } catch { fail(".", "Cell root is unavailable or another write is in progress"); }
  try { return await action(base, lock); } finally { rmSync(lock, { recursive: true, force: true }); }
}
function unchanged(root: string, changes: readonly Change[]): void {
  for (const change of changes) if (read(root, change.path) !== change.before) fail(change.path, "File changed during write validation");
}
/** Stage all bytes first, compare snapshots, then replace with rollback on failure. */
function commit(root: string, stage: string, changes: Change[]): void {
  if (new Set(changes.map(change => change.path)).size !== changes.length) fail(".", "Duplicate transaction path");
  unchanged(root, changes);
  changes.forEach((change, i) => writeFileSync(join(stage, String(i)), change.after, { flag: "wx" }));
  unchanged(root, changes); const applied: Change[] = [];
  try {
    changes.forEach((change, i) => {
      if (read(root, change.path) !== change.before) fail(change.path, "File changed during write");
      renameSync(join(stage, String(i)), safePath(root, change.path)); applied.push(change);
    });
  } catch (error) {
    for (const change of applied.reverse()) writeFileSync(safePath(root, change.path), change.before);
    throw error;
  }
}

/** Copies the active version to an unused draft after every existing version. */
export async function propose(root: string, id: string): Promise<StoredCell> {
  if (!CELL_ID_PATTERN.test(id)) fail(id, "Invalid cell id");
  return locked(root, base => {
    const snapshot = layout(base); const { source: treeSource, tree } = loadTree(snapshot);
    if (tree.retired?.includes(id)) fail(id, "Retired cell ids cannot be reused");
    const active = activeCells(snapshot, tree).find(cell => cell.id === id);
    if (!active) fail(id, "Cannot propose without an active version");
    const versions = snapshot.paths.filter(entry => entry.id === id).map(entry => entry.version);
    const version = Math.max(...versions) + 1;
    if (!positiveInteger(version)) fail(id, "No positive safe version is available");
    const source = metadata(active, { version: String(version), status: "draft", confirmed: undefined });
    const proposed = parseCell(id, version, source);
    if (read(base, active.path) !== active.source || read(base, "tree.json") !== treeSource) fail(id, "Active source changed during proposal");
    // Exclusive creation guarantees existing active, retired and draft bytes are never overwritten.
    writeFileSync(safePath(base, proposed.path), source, { flag: "wx" }); return proposed;
  });
}

/** Activates only explicit drafts after owner confirmation and optional profile validation. */
export async function activate(root: string, refs: readonly string[], options: ActivateOptions): Promise<StoredCell[]> {
  const confirmation = typeof options?.confirm === "string" ? parseConfirmRef(options.confirm) : undefined;
  if (!confirmation) fail("confirm", "A valid user confirmation is required");
  if (!Array.isArray(refs) || refs.length === 0) fail("refs", "Expected at least one exact cell reference");
  const requested = [...refs]; const parsed = requested.map(ref => typeof ref === "string" ? parseLinkRef(ref) : undefined);
  if (parsed.some(ref => !ref || ref.agent !== undefined)) fail("refs", "Expected same-root id@version references");
  const targets = parsed as NonNullable<ReturnType<typeof parseLinkRef>>[];
  if (new Set(targets.map(ref => ref.cell)).size !== targets.length) fail("refs", "A batch may target each cell only once");
  if (confirmation.kind === "migration" && targets.some(ref => ref.version !== 1)) fail("confirm", "Migration confirmation is restricted to version 1");
  return locked(root, async (base, stage) => {
    const snapshot = layout(base); const { source: treeSource, tree } = loadTree(snapshot);
    const all = snapshot.paths.map(entry => loadCell(base, entry));
    activeCells(snapshot, tree);
    for (const cell of all) if (cell.status === "active" && tree.active[cell.id] !== cell.version) fail(cell.path, "Status disagrees with the active pointer");
    const cells = targets.map(ref => {
      const cell = all.find(candidate => candidate.id === ref.cell && candidate.version === ref.version);
      if (!cell || cell.status !== "draft") fail(`${ref.cell}@${ref.version}`, "Activation target must be an existing draft");
      if (tree.retired?.includes(cell.id)) fail(cell.id, "Retired cell ids cannot be reused");
      return cell;
    });
    const changed: Change[] = []; const activated: StoredCell[] = [];
    for (const cell of cells) {
      const source = metadata(cell, { status: "active", confirmed: options.confirm });
      activated.push(parseCell(cell.id, cell.version, source)); changed.push({ path: cell.path, before: cell.source, after: source });
      for (const sibling of all.filter(candidate => candidate.id === cell.id && candidate.version !== cell.version && candidate.status !== "retired")) changed.push({ path: sibling.path, before: sibling.source, after: metadata(sibling, { status: "retired" }) });
    }
    const active = { ...tree.active }; for (const cell of cells) active[cell.id] = cell.version;
    changed.push({ path: "tree.json", before: treeSource, after: JSON.stringify({ ...tree, active }, null, 2) + "\n" });
    if (options.beforeActivate && await options.beforeActivate({ root: base, refs: requested, confirm: options.confirm, cells: structuredClone(cells), active: { ...tree.active } }) === false) fail("activate", "Profile validation vetoed activation");
    // Include untouched files so asynchronous validation cannot silently race any cell snapshot.
    unchanged(base, [{ path: "tree.json", before: treeSource, after: treeSource }, ...all.map(cell => ({ path: cell.path, before: cell.source, after: cell.source }))]);
    const latest = layout(base);
    if (JSON.stringify(latest.paths) !== JSON.stringify(snapshot.paths)) fail("cells", "Cell layout changed during validation");
    commit(base, stage, changed); return activated;
  });
}
