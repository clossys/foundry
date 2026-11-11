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
/** The CommonJS fs object: its properties are writable, and syncBuiltinESMExports copies them to node:fs's ES exports. */
const fs = require("node:fs") as typeof import("node:fs");

export const RUN_SCHEMA = "clossys.pipeline-run/1";
export const RUNS_DIR = ".clossys/runs";
/** Newest records kept per (step, invocation). */
export const RUNS_KEPT = 3;
/** Set to `0` to run without recording (the record is then simply absent: the step shows never run). */
export const TRACE_ENV = "CLOSSYS_TRACE";
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
  try { digest = sha(state.originals!.readFileSync!(path) as Buffer); } catch { return; }
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

/** One file's sha256 now, or a directory's listing sha (path ending in `/`); null when it is absent. */
export function currentSha(root: string, path: string): string | null {
  const absolute = join(root, ...path.split("/").filter(Boolean));
  try { return path.endsWith("/") ? listingSha(raw.list(absolute)) : sha(raw.read(absolute)); }
  catch { return null; }
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

function gitHead(root: string): string | null {
  try {
    let gitDir = join(root, ".git");
    const text = raw.read(gitDir).toString();
    if (text.startsWith("gitdir:")) gitDir = resolve(root, text.slice(7).trim());
    return headOf(gitDir);
  } catch {
    try { return headOf(join(root, ".git")); } catch { return null; }
  }
}
function headOf(gitDir: string): string | null {
  const head = raw.read(join(gitDir, "HEAD")).toString().trim();
  if (!head.startsWith("ref:")) return head;
  const ref = head.slice(4).trim();
  const common = (() => { try { return resolve(gitDir, raw.read(join(gitDir, "commondir")).toString().trim()); } catch { return gitDir; } })();
  for (const dir of [gitDir, common]) { try { return raw.read(join(dir, ref)).toString().trim(); } catch { /* next */ } }
  try {
    const packed = raw.read(join(common, "packed-refs")).toString();
    return packed.split("\n").find(line => line.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
  } catch { return null; }
}
let toolVersion: string | null | undefined;
function tool(): string | null {
  if (toolVersion !== undefined) return toolVersion;
  try { const pkg = JSON.parse(raw.read(fileURLToPath(new URL("../../package.json", import.meta.url))).toString()) as { name?: string; version?: string }; toolVersion = `${pkg.name}@${pkg.version}`; }
  catch { toolVersion = null; }
  return toolVersion;
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
  let text: string;
  try { text = raw.read(join(root, ".gitignore")).toString(); } catch { return false; }
  let ignored = false;
  for (const line of text.split(/\r?\n/).map(each => each.trim())) {
    if (STORE_IGNORE_LINES.includes(line)) ignored = true;
    else if (line.startsWith("!") && /(^|\/)\.clossys(\/|$)/.test(line.slice(1).replace(/^\//, ""))) ignored = false;
  }
  return ignored;
}

/**
 * Append one record to its step's store, keeping the newest RUNS_KEPT per invocation; returns its
 * citation, or null (nothing written) when the workspace does not ignore the store (storeIgnored).
 */
export function appendRecord(root: string, record: RunRecord): StoredRun | null {
  if (!storeIgnored(root)) return null;
  const store = storeFile(record.step);
  const file = join(root, ...store.split("/"));
  fs.mkdirSync(dirname(file), { recursive: true });
  const kept = readStore(root, store).map(entry => entry.record);
  kept.push(record);
  const counts = new Map<string, number>();
  const newest = kept.slice().reverse().filter(entry => {
    const count = (counts.get(entry.invocation) ?? 0) + 1;
    counts.set(entry.invocation, count);
    return count <= RUNS_KEPT;
  }).reverse();
  const temp = `${file}.${process.pid}.tmp`;
  raw.write(temp, newest.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  raw.rename(temp, file);
  return { record, store, line: newest.length };
}

/** Every record of one store file, oldest first, with its 1-based line; a malformed line throws. */
export function readStore(root: string, store: string): StoredRun[] {
  let text: string;
  try { text = raw.read(join(root, ...store.split("/"))).toString(); } catch { return []; }
  return text.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    let record: RunRecord;
    try { record = JSON.parse(line) as RunRecord; } catch (error) { throw new Error(`${store}:${index + 1}: not a run record (${error instanceof Error ? error.message : String(error)})`); }
    if (record.schema !== RUN_SCHEMA) throw new Error(`${store}:${index + 1}: schema is ${String(record.schema)}, expected ${RUN_SCHEMA}`);
    return [{ record, store, line: index + 1 }];
  });
}

/** Every record in the workspace's store. */
export function readRuns(root: string): StoredRun[] {
  let names: string[];
  try { names = raw.list(join(root, ...RUNS_DIR.split("/"))); } catch { return []; }
  return names.filter(name => name.endsWith(".jsonl")).sort().flatMap(name => readStore(root, `${RUNS_DIR}/${name}`));
}

/** Observations a traced child process appended to a sink file (one JSON line per process). */
export function readSink(file: string): Observation {
  const observation = newObservation();
  let text: string;
  try { text = raw.read(file).toString(); } catch { return observation; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const seen = JSON.parse(line) as { reads: [string, string][]; writes: string[] };
    for (const [path, digest] of seen.reads) if (!observation.reads.has(path)) observation.reads.set(path, digest);
    for (const path of seen.writes) observation.writes.add(path);
  }
  return observation;
}
export const sinkLine = (observation: Observation): string => `${JSON.stringify({ reads: [...observation.reads], writes: [...observation.writes] })}\n`;
