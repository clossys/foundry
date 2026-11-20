/**
 * The run trace: every pipeline step execution appends one run record, and the pipeline page and
 * `clossys pipeline status` read nothing else to say whether a step ran, passed, failed or went
 * stale. A record holds what the run actually did, observed, not declared:
 *
 *   step        the defined step that ran (src/pipeline/steps), or `check:<id>` for a check
 *   invocation  the mode words it ran with (`check --slots --readiness`); one step can have several
 *   argv        the sanitized argv: workspace paths relative, the home directory as `~`
 *   start, end  ISO times; exit the exit code
 *   reads       every workspace file the run read (and every directory it listed, path ending in
 *               `/`), with the sha256 of the bytes it saw
 *   writes      every workspace file the run wrote, renamed into place, copied to or removed, with
 *               its sha256 after the run (null when the run removed it)
 *   inputs      sha256 over the sorted reads: the inputs' version as one value
 *   head, tool  the git HEAD commit and the producer version the run used
 *
 * Observation is in-process: the node:fs functions are wrapped (and the builtin ES module exports
 * synced, so `import { readFileSync } from "node:fs"` sees the wrapper) while a collector is active.
 * A child process is observed by preloading trace-preload.js through NODE_OPTIONS (`clossys
 * pipeline trace`, scripts/trace-run.mjs). Paths outside the workspace and under node_modules, .git,
 * .next, .turbo and .clossys are not recorded.
 *
 * The store is local, never committed: `<root>/.clossys/runs/<step>.jsonl`, one JSON record per line,
 * keys in a fixed order, the newest RUNS_KEPT records per invocation kept. Records are keyed by
 * content hashes and relative paths, so a store copied to another checkout means the same thing
 * there. Committing it would rewrite tracked files on every gate run and conflict across branches.
 *
 * So the store is written only into a workspace that ignores it by contract: its root `.gitignore`
 * lists `/.clossys/runs/` (or `/.clossys/`). In any other workspace a run leaves no record (the
 * step shows never run) and writes nothing: a check never dirties a consumer's tree.
 */
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
/**
 * True when a filesystem error only says the path is not there (as ../errors.ts isAbsent). Inlined:
 * this module loads standalone (trace-preload.js, the store tests run it with node directly).
 */
const isAbsent = (error: unknown): boolean => ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException | undefined)?.code ?? "");
/** The CommonJS fs object: its properties are writable, and syncBuiltinESMExports copies them to node:fs's ES exports. */
const fs = require("node:fs") as typeof import("node:fs");

export const RUN_SCHEMA = "clossys.pipeline-run/1";
export const RUNS_DIR = ".clossys/runs";
/** Newest records kept per (step, invocation). */
export const RUNS_KEPT = 3;
/** Set to `0` to run without recording (the record is then simply absent: the step shows never run). */
export const TRACE_ENV = "CLOSSYS_TRACE";
/** The step id a parent (the chain) runs this process as, when its verb is shared by several steps. */
export const STEP_ENV = "CLOSSYS_STEP";
/** A child process traced by a parent appends its observations here (trace-preload.js). */
export const SINK_ENV = "CLOSSYS_TRACE_SINK";

export interface FileVersion { readonly path: string; readonly sha256: string | null }
export interface RunRecord {
  readonly schema: typeof RUN_SCHEMA;
  readonly run: string;
  readonly step: string;
  readonly invocation: string;
  readonly argv: readonly string[];
  readonly start: string;
  readonly end: string;
  readonly exit: number;
  readonly head: string | null;
  readonly tool: string | null;
  readonly inputs: string;
  readonly reads: readonly FileVersion[];
  readonly writes: readonly FileVersion[];
  /** A decide step's submission (`clossys next --submit`): who produced the output and with which skill. */
  readonly decision?: RunDecision;
}
/**
 * What a submitted decide-step output declares about how it was made: the model and tier that ran,
 * the basis, and the skill file (its contract path and the sha256 of the bytes that were read).
 */
export interface RunDecision {
  readonly model: string;
  readonly tier: string;
  readonly basis: string;
  /** The selection-ladder rung the candidate came from (pipeline/candidate-ladder.ts). */
  readonly ladder?: { readonly rung: string; readonly seed?: string; readonly reason?: string };
  readonly skill: FileVersion;
  /** The recorded output: the candidate file written. */
  readonly output: FileVersion;
}
/** A record as read back from the store, with where it is: the citation the page shows. */
export interface StoredRun { readonly record: RunRecord; readonly store: string; readonly line: number }

const SKIP_SEGMENTS = new Set(["node_modules", ".git", ".next", ".turbo", ".clossys"]);
const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const tracingEnabled = (): boolean => process.env[TRACE_ENV] !== "0";

// ------------------------------------------------------------------ observation

/** What one process saw: absolute path -> sha of the bytes read (directories end in `/`), and the paths written. */
export interface Observation { readonly reads: Map<string, string>; readonly writes: Set<string> }
const newObservation = (): Observation => ({ reads: new Map(), writes: new Set() });

interface TraceState { active: Set<Observation>; originals: Record<string, Function> | null }
const STATE_KEY = Symbol.for("clossys.pipeline.trace");
const state: TraceState = ((globalThis as Record<symbol, unknown>)[STATE_KEY] ??= { active: new Set(), originals: null }) as TraceState;

function toPath(target: unknown): string | null {
  if (typeof target === "string") return resolve(target);
  if (target instanceof URL) return target.protocol === "file:" ? fileURLToPath(target) : null;
  if (Buffer.isBuffer(target)) return resolve(target.toString());
  return null;
}
const encodingOf = (options: unknown): BufferEncoding | undefined =>
  typeof options === "string" ? options as BufferEncoding : options && typeof options === "object" && typeof (options as { encoding?: unknown }).encoding === "string" ? (options as { encoding: BufferEncoding }).encoding : undefined;
const bytesOf = (value: unknown, options: unknown): Uint8Array | null =>
  Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value, encodingOf(options) ?? "utf8") : value instanceof Uint8Array ? value : null;
const listingSha = (names: readonly unknown[]): string => sha(names.map(name => typeof name === "string" ? name : Buffer.isBuffer(name) ? name.toString() : String((name as { name?: unknown }).name)).sort().join("\n"));

function noteRead(target: unknown, value: unknown, options?: unknown): void {
  if (!state.active.size) return;
  const path = toPath(target), bytes = bytesOf(value, options);
  if (!path || !bytes) return;
  const digest = sha(bytes);
  for (const seen of state.active) if (!seen.reads.has(path)) seen.reads.set(path, digest);
}
function noteFileRead(target: unknown): void {
  if (!state.active.size) return;
  const path = toPath(target);
  if (!path) return;
  let digest: string;
  // An absent source is the copy's own failure to report; any other read failure is thrown, never an unrecorded read.
  try { digest = sha(state.originals!.readFileSync!(path) as Buffer); } catch (error) { if (isAbsent(error)) return; throw error; }
  for (const seen of state.active) if (!seen.reads.has(path)) seen.reads.set(path, digest);
}
function noteListing(target: unknown, names: unknown): void {
  if (!state.active.size || !Array.isArray(names)) return;
  const path = toPath(target);
  if (!path) return;
  const digest = listingSha(names);
  for (const seen of state.active) if (!seen.reads.has(`${path}${sep}`)) seen.reads.set(`${path}${sep}`, digest);
}
function noteWrite(target: unknown): void {
  if (!state.active.size) return;
  const path = toPath(target);
  if (path) for (const seen of state.active) seen.writes.add(path);
}

type Fn = (...args: any[]) => any;
const SYNC_READS = ["readFileSync"] as const;
const SYNC_LISTS = ["readdirSync"] as const;
const SYNC_WRITES = ["writeFileSync", "appendFileSync", "unlinkSync", "rmSync"] as const;

function install(): void {
  if (state.originals) return;
  const originals: Record<string, Function> = {};
  const wrap = (owner: Record<string, unknown>, name: string, key: string, make: (original: Fn) => Fn) => {
    const original = owner[name];
    if (typeof original !== "function") return;
    originals[key] = original;
    owner[name] = make(original as Fn);
  };
  const target = fs as unknown as Record<string, unknown>;
  for (const name of SYNC_READS) wrap(target, name, name, original => function (this: unknown, path: unknown, options?: unknown) {
    const value = original.call(this, path, options);
    noteRead(path, value, options);
    return value;
  });
  for (const name of SYNC_LISTS) wrap(target, name, name, original => function (this: unknown, path: unknown, options?: unknown) {
    const value = original.call(this, path, options);
    noteListing(path, value);
    return value;
  });
  for (const name of SYNC_WRITES) wrap(target, name, name, original => function (this: unknown, path: unknown, ...rest: unknown[]) {
    try { return original.call(this, path, ...rest); } finally { noteWrite(path); }
  });
  wrap(target, "renameSync", "renameSync", original => function (this: unknown, from: unknown, to: unknown) {
    try { return original.call(this, from, to); } finally { noteWrite(from); noteWrite(to); }
  });
  wrap(target, "copyFileSync", "copyFileSync", original => function (this: unknown, from: unknown, to: unknown, mode?: unknown) {
    noteFileRead(from);
    try { return original.call(this, from, to, mode); } finally { noteWrite(to); }
  });
  wrap(target, "createReadStream", "createReadStream", original => function (this: unknown, path: unknown, options?: unknown) {
    noteFileRead(path);
    return original.call(this, path, options);
  });
  wrap(target, "createWriteStream", "createWriteStream", original => function (this: unknown, path: unknown, options?: unknown) {
    noteWrite(path);
    return original.call(this, path, options);
  });
  // Callback forms: the last argument is the callback.
  const callback = (name: string, after: (args: unknown[], result: unknown) => void) => wrap(target, name, name, original => function (this: unknown, ...args: unknown[]) {
    const done = args[args.length - 1];
    if (typeof done !== "function") return original.apply(this, args);
    args[args.length - 1] = (error: unknown, result: unknown) => { if (!error) after(args, result); (done as Fn)(error, result); };
    return original.apply(this, args);
  });
  callback("readFile", (args, result) => noteRead(args[0], result, typeof args[1] === "function" ? undefined : args[1]));
  callback("readdir", (args, result) => noteListing(args[0], result));
  for (const name of ["writeFile", "appendFile", "unlink", "rm"]) callback(name, args => noteWrite(args[0]));
  callback("rename", args => { noteWrite(args[0]); noteWrite(args[1]); });
  callback("copyFile", args => { noteFileRead(args[0]); noteWrite(args[1]); });
  // Promise forms (node:fs/promises is the same object as fs.promises).
  const promises = fs.promises as unknown as Record<string, unknown>;
  const promised = (name: string, after: (args: unknown[], result: unknown) => void) => wrap(promises, name, `promises.${name}`, original => async function (this: unknown, ...args: unknown[]) {
    const result = await original.apply(this, args);
    after(args, result);
    return result;
  });
  promised("readFile", (args, result) => noteRead(args[0], result, args[1]));
  promised("readdir", (args, result) => noteListing(args[0], result));
  for (const name of ["writeFile", "appendFile", "unlink", "rm"]) promised(name, args => noteWrite(args[0]));
  promised("rename", args => { noteWrite(args[0]); noteWrite(args[1]); });
  promised("copyFile", args => { noteFileRead(args[0]); noteWrite(args[1]); });
  state.originals = originals;
  syncBuiltinESMExports();
}

function uninstall(): void {
  if (!state.originals || state.active.size) return;
  const target = fs as unknown as Record<string, unknown>, promises = fs.promises as unknown as Record<string, unknown>;
  for (const [key, original] of Object.entries(state.originals)) {
    if (key.startsWith("promises.")) promises[key.slice("promises.".length)] = original;
    else target[key] = original;
  }
  state.originals = null;
  syncBuiltinESMExports();
}

/** Start observing this process's file reads and writes; `stop` ends it and returns what was seen. */
export function observe(): { readonly observation: Observation; stop(): Observation } {
  install();
  const observation = newObservation();
  state.active.add(observation);
  return { observation, stop() { state.active.delete(observation); uninstall(); return observation; } };
}

/** The unwrapped fs functions (the store never observes itself). */
const raw = {
  read: (path: string): Buffer => ((state.originals?.readFileSync ?? fs.readFileSync) as typeof fs.readFileSync)(path),
  write: (path: string, data: string) => ((state.originals?.writeFileSync ?? fs.writeFileSync) as typeof fs.writeFileSync)(path, data),
  rename: (from: string, to: string) => ((state.originals?.renameSync ?? fs.renameSync) as typeof fs.renameSync)(from, to),
  list: (path: string): string[] => ((state.originals?.readdirSync ?? fs.readdirSync) as (path: string) => string[])(path),
};

// ------------------------------------------------------------------ records

/** A path as the record shows it: workspace-relative POSIX, or null when it is outside the workspace or under a skipped folder. */
export function workspacePath(root: string, absolute: string): string | null {
  const dir = absolute.endsWith(sep);
  const rel = relative(root, dir ? absolute.slice(0, -1) : absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  const parts = rel.split(sep);
  if (parts.some(part => SKIP_SEGMENTS.has(part))) return null;
  const posix = parts.join("/");
  return dir ? `${posix}/` : posix;
}

/**
 * One file's sha256 now, or a directory's listing sha (path ending in `/`); null when it is absent
 * (a file path that is now a directory has no file there). Any other read failure is thrown.
 */
export function currentSha(root: string, path: string): string | null {
  const absolute = join(root, ...path.split("/").filter(Boolean));
  try { return path.endsWith("/") ? listingSha(raw.list(absolute)) : sha(raw.read(absolute)); }
  catch (error) { if (isAbsent(error) || (error as NodeJS.ErrnoException).code === "EISDIR") return null; throw error; }
}

const HOME = homedir();
/** argv as the record keeps it: absolute paths workspace-relative (or under `~`), values of secret-named flags dropped. */
export function sanitizeArgv(root: string, argv: readonly string[], cwd: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (/^--?[\w-]*(token|secret|password|passwd|credential|api-?key)[\w-]*(=|$)/i.test(arg)) { out.push(arg.replace(/=.*$/, "=<redacted>")); if (!arg.includes("=")) index++; continue; }
    const flag = /^(--?[\w-]+=)(.*)$/.exec(arg);
    out.push(flag ? `${flag[1]}${portablePath(root, flag[2]!, cwd)}` : portablePath(root, arg, cwd));
  }
  return out;
}
/** A path argument workspace-relative, else under `~`, else `<outside>`; any other argument unchanged. */
function portablePath(root: string, arg: string, cwd: string): string {
  if (!isAbsolute(arg) && !arg.startsWith("./") && !arg.startsWith("../")) return arg;
  const absolute = resolve(cwd, arg), rel = relative(root, absolute);
  if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/") || ".";
  return absolute === HOME || absolute.startsWith(`${HOME}${sep}`) ? `~${absolute.slice(HOME.length).split(sep).join("/")}` : "<outside>";
}

/** Flags that change where output goes, not what the step does: they do not make a separate invocation. */
const OUTPUT_FLAGS = new Map<string, boolean>([["--json", false], ["--root", true], ["--out", true], ["--by", true], ["--at", true], ["--report", true]]);
/**
 * The invocation a run belongs to: its mode words. Output-only flags are dropped; a verb whose first
 * argument is `<agent>/<slot>` (pin, pick) keeps only the verb and the agent, because the slot and
 * candidate are the decision's data, not a mode.
 */
export function invocationOf(argv: readonly string[], target?: string): string {
  if (target !== undefined) return `${argv[0] ?? ""} ${target}`.trim();
  const words: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!, flag = arg.split("=")[0]!;
    if (OUTPUT_FLAGS.has(flag)) { if (OUTPUT_FLAGS.get(flag) && !arg.includes("=")) index++; continue; }
    words.push(arg);
  }
  return words.join(" ");
}

/** A file's bytes, or undefined when it is absent; any other read failure is thrown. */
function readPresent(path: string): Buffer | undefined {
  try { return raw.read(path); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
}
/** The commit HEAD names, or null outside a git checkout or when HEAD names an unborn branch. */
function gitHead(root: string): string | null {
  const dotGit = join(root, ".git");
  let directory: boolean;
  try { directory = fs.statSync(dotGit).isDirectory(); } catch (error) { if (isAbsent(error)) return null; throw error; }
  if (directory) return headOf(dotGit);
  // A linked worktree or submodule: `.git` is a file naming the git directory.
  const text = raw.read(dotGit).toString();
  if (!text.startsWith("gitdir:")) throw new Error(`${dotGit}: not a gitdir file`);
  return headOf(resolve(root, text.slice(7).trim()));
}
function headOf(gitDir: string): string | null {
  const head = readPresent(join(gitDir, "HEAD"))?.toString().trim();
  if (head === undefined) return null;
  if (!head.startsWith("ref:")) return head;
  const ref = head.slice(4).trim();
  const commondir = readPresent(join(gitDir, "commondir"));
  const common = commondir ? resolve(gitDir, commondir.toString().trim()) : gitDir;
  for (const dir of [gitDir, common]) { const loose = readPresent(join(dir, ref)); if (loose) return loose.toString().trim(); }
  const packed = readPresent(join(common, "packed-refs"));
  return packed?.toString().split("\n").find(line => line.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
}
let toolVersion: string | null | undefined;
/** This package's `name@version`; null when its package.json is absent. A package.json that is not JSON is thrown. */
function tool(): string | null {
  if (toolVersion !== undefined) return toolVersion;
  const file = fileURLToPath(new URL("../../package.json", import.meta.url));
  const bytes = readPresent(file);
  if (!bytes) return toolVersion = null;
  let pkg: { name?: string; version?: string };
  try { pkg = JSON.parse(bytes.toString()) as typeof pkg; } catch (error) { throw new Error(`${file}: not JSON (${error instanceof Error ? error.message : String(error)})`); }
  return toolVersion = `${pkg.name}@${pkg.version}`;
}

export interface RunInput {
  readonly root: string;
  readonly step: string;
  readonly invocation: string;
  readonly argv: readonly string[];
  readonly start: Date;
  readonly end: Date;
  readonly exit: number;
  readonly observation: Observation;
  readonly decision?: RunDecision;
}

/** The record for one finished run: reads with the sha seen, writes with the sha now. Deterministic for the same inputs. */
export function buildRecord(input: RunInput): RunRecord {
  const reads = new Map<string, string>();
  for (const [absolute, digest] of input.observation.reads) { const path = workspacePath(input.root, absolute); if (path) reads.set(path, digest); }
  const writes = new Map<string, string | null>();
  for (const absolute of input.observation.writes) { const path = workspacePath(input.root, absolute); if (path && !path.startsWith(`${RUNS_DIR}/`)) writes.set(path, currentSha(input.root, path)); }
  const readList = [...reads].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, digest]) => ({ path, sha256: digest }));
  const writeList = [...writes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, digest]) => ({ path, sha256: digest }));
  const inputs = sha(readList.map(entry => `${entry.path}\0${entry.sha256}`).join("\n"));
  const body = {
    step: input.step, invocation: input.invocation, argv: [...input.argv], start: input.start.toISOString(), end: input.end.toISOString(),
    exit: input.exit, head: gitHead(input.root), tool: tool(), inputs, reads: readList, writes: writeList,
    ...(input.decision ? { decision: input.decision } : {}),
  };
  return { schema: RUN_SCHEMA, run: sha(JSON.stringify(body)).slice(0, 16), ...body };
}

/** A step id as a store file name: `check:pipeline` -> `check.pipeline.jsonl`. */
export const storeFile = (step: string): string => `${RUNS_DIR}/${step.replace(/[^a-z0-9.-]/gi, ".")}.jsonl`;

/** `.gitignore` lines that ignore the store: the store directory or the whole `.clossys/` directory, anchored or not. */
export const STORE_IGNORE_LINES: readonly string[] = [".clossys/runs/", ".clossys/runs", ".clossys/", ".clossys"].flatMap(line => [line, `/${line}`]);

/**
 * Whether the workspace ignores the run store by contract: its root `.gitignore` has one of
 * STORE_IGNORE_LINES and no later negation re-includes anything under `.clossys/`.
 */
export function storeIgnored(root: string): boolean {
  const bytes = readPresent(join(root, ".gitignore"));
  if (!bytes) return false;
  const text = bytes.toString();
  let ignored = false;
  for (const line of text.split(/\r?\n/).map(each => each.trim())) {
    if (STORE_IGNORE_LINES.includes(line)) ignored = true;
    else if (line.startsWith("!") && /(^|\/)\.clossys(\/|$)/.test(line.slice(1).replace(/^\//, ""))) ignored = false;
  }
  return ignored;
}

/** Bytes a store scan reads at a time: a scan holds one chunk and one line, never the whole store. */
export const STORE_SCAN_CHUNK = 1 << 20;
/**
 * Every line of a store file in order (the text after the last newline too, when not empty), read
 * in STORE_SCAN_CHUNK pieces: memory is one chunk plus the longest line, whatever the store's size.
 * A missing store has no lines.
 */
function* storeLines(file: string): Generator<Buffer> {
  let fd: number;
  try { fd = fs.openSync(file, "r"); } catch (error) { if (isAbsent(error)) return; throw error; }
  try {
    const chunk = Buffer.alloc(STORE_SCAN_CHUNK);
    let pending: Buffer[] = [];
    for (;;) {
      const size = fs.readSync(fd, chunk, 0, STORE_SCAN_CHUNK, null);
      if (!size) break;
      const view = chunk.subarray(0, size);
      let start = 0;
      for (let end = view.indexOf(10, start); end !== -1; end = view.indexOf(10, start)) {
        pending.push(view.subarray(start, end));
        yield pending.length === 1 ? Buffer.from(pending[0]!) : Buffer.concat(pending);
        pending = [];
        start = end + 1;
      }
      if (start < size) pending.push(Buffer.from(view.subarray(start)));
    }
    if (pending.length) yield Buffer.concat(pending);
  } finally { fs.closeSync(fd); }
}
/** A line readStore skips: only whitespace. A record line starts with `{` and is never decoded here. */
const blankLine = (bytes: Buffer): boolean => bytes[0] !== 0x7b && !bytes.toString("utf8").trim();
/** One store line as a run record; a malformed line or another schema throws, naming `store:line`. */
function parseStoreLine(store: string, line: number, text: string): RunRecord {
  let record: RunRecord;
  try { record = JSON.parse(text) as RunRecord; } catch (error) { throw new Error(`${store}:${line}: not a run record (${error instanceof Error ? error.message : String(error)})`); }
  if (record.schema !== RUN_SCHEMA) throw new Error(`${store}:${line}: schema is ${String(record.schema)}, expected ${RUN_SCHEMA}`);
  return record;
}
/**
 * The invocation of one store line. buildRecord writes schema, run, step and invocation first, so a
 * record this module wrote names its invocation in its first bytes and is not parsed whole; any
 * other line is parsed and checked as readStore checks it.
 */
const INVOCATION_PREFIX = /^\{"schema":"clossys\.pipeline-run\/1","run":"[0-9a-f]*","step":"(?:[^"\\]|\\.)*","invocation":("(?:[^"\\]|\\.)*")/;
function invocationOfLine(store: string, line: number, bytes: Buffer): string {
  const head = INVOCATION_PREFIX.exec(bytes.subarray(0, 16384).toString("utf8"));
  if (head) return JSON.parse(head[1]!) as string;
  return parseStoreLine(store, line, bytes.toString("utf8")).invocation;
}

/**
 * Append one record to its step's store, keeping the newest RUNS_KEPT per invocation; returns its
 * citation, or null (nothing written) when the workspace does not ignore the store (storeIgnored).
 *
 * The store is scanned line by line and never held whole: a store gains one record per distinct
 * invocation (every `clossys ia <slot>` is one), and a record lists every file its run read, so
 * reading it whole made each run's memory and time grow with every earlier run. When no invocation
 * goes over RUNS_KEPT the record is appended; otherwise the kept lines are copied, unchanged, to a
 * sibling that replaces the store.
 */
export function appendRecord(root: string, record: RunRecord): StoredRun | null {
  if (!storeIgnored(root)) return null;
  const store = storeFile(record.step);
  const file = join(root, ...store.split("/"));
  fs.mkdirSync(dirname(file), { recursive: true });
  const counts = new Map<string, number>();
  let lines = 0, endsInNewline = true;
  for (const bytes of storeLines(file)) {
    lines++;
    if (blankLine(bytes)) continue;
    const invocation = invocationOfLine(store, lines, bytes);
    counts.set(invocation, (counts.get(invocation) ?? 0) + 1);
  }
  let size = 0;
  try { size = fs.statSync(file).size; } catch (error) { if (!isAbsent(error)) throw error; /* a new store */ }
  if (size) { const fd = fs.openSync(file, "r"); try { const last = Buffer.alloc(1); fs.readSync(fd, last, 0, 1, size - 1); endsInNewline = last[0] === 10; } finally { fs.closeSync(fd); } }
  counts.set(record.invocation, (counts.get(record.invocation) ?? 0) + 1);
  const text = JSON.stringify(record);
  if (Math.max(...counts.values()) <= RUNS_KEPT) {
    const fd = fs.openSync(file, "a");
    try { fs.writeSync(fd, `${endsInNewline ? "" : "\n"}${text}\n`); } finally { fs.closeSync(fd); }
    return { record, store, line: lines + 1 };
  }
  // Keep the newest RUNS_KEPT of each invocation: the first (count - RUNS_KEPT) of it are dropped.
  const dropping = new Map([...counts].filter(([, count]) => count > RUNS_KEPT).map(([invocation, count]) => [invocation, count - RUNS_KEPT]));
  const temp = `${file}.${process.pid}.tmp`;
  const out = fs.openSync(temp, "w");
  let written = 0;
  try {
    const consider = (bytes: Buffer, invocation: string) => {
      const drop = dropping.get(invocation) ?? 0;
      if (drop > 0) { dropping.set(invocation, drop - 1); return; }
      fs.writeSync(out, bytes); fs.writeSync(out, "\n"); written++;
    };
    let line = 0;
    for (const bytes of storeLines(file)) {
      line++;
      if (blankLine(bytes)) continue;
      consider(bytes, invocationOfLine(store, line, bytes));
    }
    consider(Buffer.from(text), record.invocation);
  } finally { fs.closeSync(out); }
  raw.rename(temp, file);
  return { record, store, line: written };
}

/** Every record of one store file, oldest first, with its 1-based line; a malformed line throws. Read line by line. */
export function readStore(root: string, store: string): StoredRun[] {
  const runs: StoredRun[] = [];
  let line = 0;
  for (const bytes of storeLines(join(root, ...store.split("/")))) {
    line++;
    const text = bytes.toString("utf8");
    if (!text.trim()) continue;
    runs.push({ record: parseStoreLine(store, line, text), store, line });
  }
  return runs;
}

/** Every record in the workspace's store. */
export function readRuns(root: string): StoredRun[] {
  let names: string[];
  try { names = raw.list(join(root, ...RUNS_DIR.split("/"))); } catch (error) { if (isAbsent(error)) return []; throw error; }
  return names.filter(name => name.endsWith(".jsonl")).sort().flatMap(name => readStore(root, `${RUNS_DIR}/${name}`));
}

/** Observations a traced child process appended to a sink file (one JSON line per process). */
export function readSink(file: string): Observation {
  const observation = newObservation();
  let text: string;
  try { text = raw.read(file).toString(); } catch (error) { if (isAbsent(error)) return observation; throw error; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const seen = JSON.parse(line) as { reads: [string, string][]; writes: string[] };
    for (const [path, digest] of seen.reads) if (!observation.reads.has(path)) observation.reads.set(path, digest);
    for (const path of seen.writes) observation.writes.add(path);
  }
  return observation;
}
export const sinkLine = (observation: Observation): string => `${JSON.stringify({ reads: [...observation.reads], writes: [...observation.writes] })}\n`;
