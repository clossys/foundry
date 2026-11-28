/**
 * `clossys check --fast` (Reviewer owns it): the obvious reds of a diff in minutes, before any review.
 *
 * The changed files are `git diff --name-only <base>...HEAD`. Steps, in order, stopping on the first red:
 *   1. typecheck: `npm run typecheck` in each touched workspace package that declares one;
 *   2. related: per changed file, its nearest tests in its own package (the test files that import it directly, or,
 *      when none does, those at the first import depth where any does; a changed test file is its own), run first,
 *      then the tests that name a changed data file and the root `check:*` scripts that read a changed root file (a
 *      check with a sibling gate test runs through that test; the whole-repository check stays in root `check`). A
 *      package's vitest files run in one process per package and tier, so vitest's worker pool shards them across
 *      cores and the package's globalSetup build runs once; node tests and root checks each run as their own process;
 *   3. alone: every file that failed in step 2 runs again by itself, once. A file that passes alone is load noise. A file
 *      that fails alone is run alone again at the merge-base, in a temporary detached tree: red there too is base-red
 *      and does not fail the step; anything else (passes at base, absent at base, or base could not run) is red.
 * Crashes (the crash rider): a test file with no result row after a signal exit (128 or above, or its vitest worker
 * exiting on a signal) is a crash, never a fail or base-red. Crashed files run again alone, one process per file (the
 * per-file fallback), at head and at base; a file that then fails alone is base-compared like any other, and a crash
 * left after the fallback makes the verdict FAST INCOMPLETE. Every abort is recorded with its signature: v8-heap when
 * the output says `JavaScript heap out of memory` (that file runs once more alone at a higher heap limit), else
 * v8-abort. Non-test commands (each typecheck and each root check script run as wired) that exit non-zero at head run
 * at base too: the same exit and no finding (normalized output line) new at head is base-red, anything else is red.
 * No ruling file is ever needed to read a verdict.
 * Step 2 has a time budget (BUDGET_MS); past it the running process is stopped and the verdict is FAST INCOMPLETE,
 * never a pass, with the files left unrun. Base results are computed here every time, only for the files that fail
 * alone at head; there is no stored baseline of any kind. A run that executes no command is never a pass.
 * Any test file that takes over SLOW_MS run alone is listed under slow; it does not fail the run.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { availableParallelism, constants as osConstants } from "node:os";
import { getHeapStatistics } from "node:v8";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addWorktree, git, scratch, type Worktree } from "../review/exec.js";
import { changedFiles, type Change } from "../review/changes.js";
import { importGraph, listWorkspaces, SOURCE_FILE, TEST_FILE, type Workspace } from "../review/graph.js";

/** The agent that owns this verb, its skill rule and its record. */
export const FAST_OWNER = "reviewer";
export const FAST_SCHEMA = "clossys.fast-check/1";
/** The related step's time budget: five minutes. */
export const BUDGET_MS = 300_000;
/** A test file that takes longer than this run alone is listed under slow. */
export const SLOW_MS = 2_000;
/** A related-run time over this many times SLOW_MS lists a file as slow without an alone re-run. */
export const SURE_SLOW = 4;

export type FastVerdict = "FAST PASS" | "FAST FAIL" | "FAST INCOMPLETE";
export type StepName = "typecheck" | "related" | "alone";
export interface FastStep { readonly step: StepName; readonly status: "pass" | "fail" | "incomplete" | "skipped"; readonly seconds: number; readonly line: string }
export interface FastCommand { readonly step: StepName | "base"; readonly run: string; readonly cwd: string; readonly exit: number; readonly seconds: number; readonly stopped?: boolean }
/** One test unit: a test file (vitest or node --test) or a root check script. */
export interface FastTest { readonly id: string; readonly pkg: string; readonly messages: readonly string[] }
/** How a process died: v8-heap (the output says the heap ran out), else v8-abort (any other signal exit). */
export type AbortSignature = "v8-abort" | "v8-heap";
/** A test file still crashing after the per-file fallback: the run is FAST INCOMPLETE. */
export interface FastCrash extends FastTest { readonly signature: AbortSignature; readonly exit: number }
/** Every crash seen, in any step and tree, including those a later run cleared. */
export interface FastAbort { readonly id: string; readonly step: StepName | "base"; readonly signature: AbortSignature; readonly exit: number; readonly heapMb?: number }
/** measured: "alone" (its alone re-run) or "related" (over SURE_SLOW times the threshold in the related run). */
export interface SlowTest { readonly id: string; readonly pkg: string; readonly seconds: number; readonly measured: "alone" | "related"; readonly owner?: string }
export interface FastRecord {
  readonly schema: typeof FAST_SCHEMA;
  readonly owner_agent: typeof FAST_OWNER;
  readonly verdict: FastVerdict;
  readonly head: string;
  readonly base: string;
  readonly baseRef: string;
  readonly changed: readonly string[];
  readonly packages: readonly string[];
  readonly steps: readonly FastStep[];
  readonly commands: readonly FastCommand[];
  /** Failed alone at head and not at base: these fail the run. */
  readonly red: readonly FastTest[];
  /** Failed alone at head and alone at base: reported, never failing. */
  readonly baseRed: readonly FastTest[];
  /** Failed (or crashed) in the related step and passed alone. */
  readonly noise: readonly FastTest[];
  /** Crashed alone after the per-file fallback: the verdict is FAST INCOMPLETE, never base-red. */
  readonly crash: readonly FastCrash[];
  readonly aborts: readonly FastAbort[];
  /** Selected but not run because the related step ran out of its budget. */
  readonly unrun: readonly string[];
  readonly slow: readonly SlowTest[];
  readonly budgetSeconds: number;
  readonly slowSeconds: number;
  readonly reason?: string;
  /** --file-requests: one line per slow test, the request filed (or already open) for it. */
  readonly requests?: readonly string[];
  /** The last printed line: `<verdict> <head sha>`. */
  readonly line: string;
}

export class FastUsageError extends Error { readonly exitCode = 2; }

export interface FastOptions {
  /** The repository (any directory in it). */
  readonly repo: string;
  /** The base ref; the default is the merge-base with the current branch's upstream. */
  readonly base?: string;
  readonly budgetMs?: number;
  readonly slowMs?: number;
  readonly log?: (line: string) => void;
}

// --- selection --------------------------------------------------------------------------------------------------

type Tier = 1 | 2;
interface Unit {
  /** Repo-relative test file, or `npm run <script>` for a root check. */
  readonly id: string;
  readonly kind: "vitest" | "node";
  /** Workspace dir, or "." for the root. */
  readonly pkg: string;
  /** Repo-relative file the unit runs (the test file or the check script). */
  readonly file: string;
  /** node units: argv after `node`, relative to cwd. */
  readonly args?: readonly string[];
  /** Repo-relative working directory. */
  readonly cwd: string;
  readonly tier: Tier;
}

/** A file's text, or undefined when there is no such file (a read error other than absence throws). */
const readText = (file: string): string | undefined => existsSync(file) ? readFileSync(file, "utf8") : undefined;

/** A vitest include glob as a regex over package-relative paths (`**`, `*`, `?`, `{a,b}`, `?(a|b)`, `[ab]`). */
export function globRegex(glob: string): RegExp {
  let out = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") { out += glob[index + 2] === "/" ? "(?:.*/)?" : ".*"; index += glob[index + 2] === "/" ? 2 : 1; }
    else if (char === "*") out += "[^/]*";
    else if (char === "?" && glob[index + 1] === "(") { const end = glob.indexOf(")", index); out += `(?:${glob.slice(index + 2, end)})?`; index = end; }
    else if (char === "?") out += "[^/]";
    else if (char === "{") { const end = glob.indexOf("}", index); out += `(?:${glob.slice(index + 1, end).split(",").map(part => part.replace(/[.+^$()|\\]/g, "\\$&")).join("|")})`; index = end; }
    else if (char === "[") { const end = glob.indexOf("]", index); out += glob.slice(index, end + 1); index = end; }
    else out += char.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];

/** The vitest include patterns of a package, or undefined when the package does not run vitest. */
export function vitestInclude(tree: string, workspace: Workspace): RegExp[] | undefined {
  const manifest = JSON.stringify(workspace.manifest);
  if (!manifest.includes("\"vitest\"") && !/\bvitest\b/.test(workspace.manifest.scripts?.test ?? "")) return undefined;
  for (const name of ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs"]) {
    const text = readText(join(tree, workspace.dir, name));
    if (text === undefined) continue;
    const block = /\binclude\s*:\s*\[([^\]]*)\]/.exec(text);
    if (!block) break;
    const globs = [...block[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)].map(match => match[1]!);
    if (globs.length) return globs.map(globRegex);
  }
  return DEFAULT_INCLUDE.map(globRegex);
}

const IGNORED_DIR = /(^|\/)(?:node_modules|dist|\.next|build)\//;

/** The workspace dir holding file (the longest workspace dir that prefixes it), or "." for the root. */
const packageOf = (workspaces: readonly Workspace[], file: string): string =>
  workspaces.filter(workspace => file.startsWith(`${workspace.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0]?.dir ?? ".";

/** A single `node <script> [args]` npm script (no shell operators or quoting), as [script, args]. */
const plainNodeScript = (command: string): [string, string[]] | undefined => {
  if (/[&|;<>`$'"\\]/.test(command)) return undefined;
  const words = command.trim().split(/\s+/);
  if (words[0] !== "node" || !words[1] || !/\.(?:mjs|cjs|js)$/.test(words[1]) || words.slice(2).some(word => word.startsWith("-") && word.includes("="))) return undefined;
  return [words[1].replace(/^\.\//, ""), words.slice(2)];
};

const basenameOf = (file: string) => posix.basename(file);
/**
 * Names nearly every script and test mentions (a manifest, a lockfile, a tsconfig): a mention of one says nothing about
 * reading this file. Code files are matched through the import graph instead of by name.
 */
const GENERIC_NAME = /^(?:package\.json|package-lock\.json|tsconfig(?:\.[a-z]+)?\.json|README\.md)$/;

interface Selection { readonly units: Unit[]; readonly packages: string[] }

/**
 * Every test unit the changed files select, tier 1 (changed tests, direct importers, tests and root checks that name a
 * changed data file, root npm scripts whose entry changed) first. baseScripts: the root manifest's scripts at the base.
 */
export function selectUnits(tree: string, changes: readonly Change[], baseScripts: Readonly<Record<string, string>> = {}): Selection {
  const workspaces = listWorkspaces(tree);
  const byDir = new Map(workspaces.map(workspace => [workspace.dir, workspace]));
  const changed = changes.map(change => change.path);
  const gone = changes.filter(change => change.status === "D" || !existsSync(join(tree, change.path))).map(change => change.path).filter(file => SOURCE_FILE.test(file));
  const packages = [...new Set(changed.map(file => packageOf(workspaces, file)).filter(dir => dir !== "."))].sort();
  const graph = importGraph(tree, gone);
  const tracked = graph.files;
  const includes = new Map(packages.map(dir => [dir, vitestInclude(tree, byDir.get(dir)!)]));
  const isVitest = (pkg: string, file: string) => {
    if (pkg === "." || !TEST_FILE.test(file) || IGNORED_DIR.test(file)) return false;
    const rel = file.slice(pkg.length + 1);
    return (includes.get(pkg) ?? []).some(regex => regex.test(rel));
  };
  const isNodeTest = (pkg: string, file: string) => /\.test\.(?:mjs|cjs|js)$/.test(file) && !IGNORED_DIR.test(file) && !isVitest(pkg, file)
    && (pkg === "." ? /^(?:scripts|\.github\/scripts)\//.test(file) : file.startsWith(`${pkg}/`));
  const tierOf = new Map<string, Tier>();
  const want = (file: string, tier: Tier) => { if (!existsSync(join(tree, file))) return; const now = tierOf.get(file); if (now === undefined || tier < now) tierOf.set(file, tier); };
  // Who imports each changed file, by depth: depth 1 (direct) is tier 1, deeper is tier 2.
  for (const file of changed) {
    const pkg = packageOf(workspaces, file);
    const isTest = (candidate: string) => packageOf(workspaces, candidate) === pkg && (isVitest(pkg, candidate) || isNodeTest(pkg, candidate));
    if (isTest(file)) want(file, 1);
    const depth = new Map<string, number>([[file, 0]]);
    const queue = [file, ...(pkg === "." ? [] : [`${pkg}/*`])];
    if (pkg !== ".") depth.set(`${pkg}/*`, 0);
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]!;
      for (const from of graph.importers.get(node) ?? []) {
        if (depth.has(from)) continue;
        depth.set(from, depth.get(node)! + 1);
        queue.push(from);
      }
    }
    // The nearest tests only: the tests that import the file directly, or, when none does, the tests at the first
    // depth where any does. The full transitive set is the mechanical review's (clossys review), not this gate's.
    const reached = [...depth].filter(([candidate, distance]) => distance > 0 && isTest(candidate));
    const nearest = Math.min(...reached.map(([, distance]) => distance));
    for (const [candidate, distance] of reached) if (distance === nearest) want(candidate, 1);
    // The `.test` sibling of a changed file, and every test of its scope that names the file (a fixture, a JSON
    // contract or a doc read by path), are direct.
    const sibling = file.replace(/\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/, match => `.test${match}`);
    if (sibling !== file && isTest(sibling)) want(sibling, 1);
  }
  // Tests (and root check scripts) that name a changed file: one read per candidate file.
  const names = changed.map(file => ({ file, pkg: packageOf(workspaces, file), name: basenameOf(file) }))
    .filter(item => !SOURCE_FILE.test(item.file) && !GENERIC_NAME.test(item.name) && item.name.length > 3);
  const candidates = tracked.filter(file => TEST_FILE.test(file));
  for (const candidate of candidates) {
    const pkg = packageOf(workspaces, candidate);
    const mine = names.filter(item => item.pkg === pkg && item.file !== candidate);
    if (!mine.length || !(isVitest(pkg, candidate) || isNodeTest(pkg, candidate))) continue;
    const text = readText(join(tree, candidate)) ?? "";
    if (mine.some(item => text.includes(item.name))) want(candidate, 2);
  }
  // Root check scripts that read a changed root file: a plain `node scripts/<x>.mjs [args]` npm script whose script,
  // or a module it imports, is the change or names it.
  const units: Unit[] = [];
  const rootChanged = changed.filter(file => packageOf(workspaces, file) === "." && file !== "package.json").map(file => ({ file, name: basenameOf(file), named: names.some(item => item.file === file) }));
  const scripts = (JSON.parse(readText(join(tree, "package.json")) ?? "{}") as { scripts?: Record<string, string> }).scripts ?? {};
  // A changed root manifest runs the npm scripts whose own entry it adds or changes.
  const entryChanged = new Set(changed.includes("package.json") ? Object.keys(scripts).filter(name => scripts[name] !== baseScripts[name]) : []);
  if (rootChanged.length || entryChanged.size) {
    const imports = new Map<string, Set<string>>();
    for (const [target, froms] of graph.importers) for (const from of froms) { let set = imports.get(from); if (!set) imports.set(from, set = new Set()); set.add(target); }
    const closure = (start: string) => { const seen = new Set([start]); const queue = [start]; for (let i = 0; i < queue.length; i++) for (const next of imports.get(queue[i]!) ?? []) if (!seen.has(next) && !next.endsWith("/*")) { seen.add(next); queue.push(next); } return seen; };
    for (const [name, command] of Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b))) {
      if (!name.startsWith("check:")) continue;
      const plain = plainNodeScript(command);
      if (!plain || !/^(?:scripts|\.github\/scripts)\//.test(plain[0]) || TEST_FILE.test(plain[0]) || !existsSync(join(tree, plain[0]))) continue;
      const reach = closure(plain[0]);
      const reads = entryChanged.has(name) || rootChanged.some(item => reach.has(item.file) || (item.named && [...reach].some(file => (readText(join(tree, file)) ?? "").includes(item.name))));
      if (!reads) continue;
      // A check with its own gate test runs through that test here (seconds); the check itself, a whole-repository
      // run that can take minutes, stays in the root `check`. A check with no test runs as it is wired.
      const test = plain[0].replace(/\.(mjs|cjs|js)$/, ".test.$1");
      if (existsSync(join(tree, test))) want(test, 2);
      else units.push({ id: `npm run ${name}`, kind: "node", pkg: ".", file: plain[0], cwd: ".", args: [plain[0], ...plain[1]], tier: 2 });
    }
  }
  for (const [file, tier] of tierOf) {
    const pkg = packageOf(workspaces, file);
    if (isVitest(pkg, file)) units.push({ id: file, kind: "vitest", pkg, file, cwd: pkg, tier });
    else units.push({ id: file, kind: "node", pkg, file, cwd: pkg, args: ["--test", pkg === "." ? file : file.slice(pkg.length + 1)], tier });
  }
  units.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  return { units, packages };
}

// --- processes --------------------------------------------------------------------------------------------------

interface Exec { readonly exit: number; readonly output: string; readonly ms: number; readonly stopped: boolean }
const OUTPUT_CAP = 1024 * 1024;

/** Run argv in cwd; past deadline (epoch ms) the process group is stopped (exit 124, stopped true). */
function exec(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}, deadline?: number): Promise<Exec> {
  const start = Date.now();
  return new Promise(resolvePromise => {
    let output = "";
    let stopped = false;
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const keep = (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > OUTPUT_CAP) output = output.slice(-OUTPUT_CAP); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // A group that already exited is ESRCH: there is nothing left to stop. Any other error is real.
    const kill = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
    let hard: NodeJS.Timeout | undefined;
    const timer = deadline === undefined ? undefined : setTimeout(() => { stopped = true; kill("SIGTERM"); hard = setTimeout(() => kill("SIGKILL"), 5_000); }, Math.max(0, deadline - start));
    child.on("error", error => { output += String(error); });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (hard) clearTimeout(hard);
      // A signal exit is 128 plus the signal's number, as a shell reports it.
      const exit = stopped ? 124 : code ?? 128 + (signal ? osConstants.signals[signal] ?? 0 : 0);
      resolvePromise({ exit, output, ms: Date.now() - start, stopped });
    });
  });
}

/** A pool of `width` workers over items, in order; returns results in item order. */
async function pool<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]!); }
  }));
  return results;
}

const plain = (output: string) => output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
const tail = (output: string, lines = 3) => plain(output).split("\n").map(line => line.trim()).filter(Boolean).slice(-lines);

/** A heap-limit abort, as V8 prints it. */
const HEAP = /JavaScript heap out of memory|Reached heap limit/;
/** The heap limit (MB) a v8-heap file runs at once more: twice this process's, and at least 8 GB. */
export const HEAP_RETRY_MB = Math.max(8192, 2 * Math.ceil(getHeapStatistics().heap_size_limit / 1048576));
const heapEnv = (): NodeJS.ProcessEnv => ({ NODE_OPTIONS: [process.env.NODE_OPTIONS, `--max-old-space-size=${HEAP_RETRY_MB}`].filter(Boolean).join(" ") });
const signatureOf = (output: string): AbortSignature => HEAP.test(output) ? "v8-heap" : "v8-abort";

/**
 * A command's findings: its distinct output lines, with the tree it ran in written as <root> and durations as <t>, so
 * the same finding at head and at base compares equal.
 */
export function findingsOf(output: string, tree: string): string[] {
  const lines = plain(output).split("\n").map(line => line.split(tree).join("<root>").replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, "<t>").trim()).filter(Boolean);
  return [...new Set(lines)].sort();
}

/** A non-test command that failed at head against its run at base: base-red only on the same exit and no new finding. */
export function compareCommand(head: { exit: number; findings: readonly string[] }, base: { exit: number; findings: readonly string[] } | undefined): { same: boolean; fresh: string[] } {
  if (!base) return { same: false, fresh: [...head.findings] };
  const fresh = head.findings.filter(finding => !base.findings.includes(finding));
  return { same: base.exit === head.exit && !fresh.length, fresh };
}

const REPORTER = fileURLToPath(new URL("../../src/check/fast-reporter.mjs", import.meta.url));

interface UnitResult {
  readonly unit: Unit;
  readonly status: "pass" | "fail" | "unrun" | "crash";
  readonly ms: number;
  readonly messages: readonly string[];
  readonly signature?: AbortSignature;
  /** The process exit (node units, and vitest crashes). */
  readonly exit?: number;
  /** node units that failed: their findings (findingsOf), for the base compare of non-test commands. */
  readonly findings?: readonly string[];
}

/** A root check script run as wired (not a test file): a non-test command. */
const isCommand = (unit: Unit) => unit.id.startsWith("npm run ");

class Runner {
  readonly commands: FastCommand[] = [];
  readonly aborts: FastAbort[] = [];
  private readonly width = Math.max(1, availableParallelism() - 1);
  constructor(private readonly repo: string, private readonly log?: (line: string) => void) {}

  private display(argv: readonly string[], tree: string): string {
    return argv.map(arg => arg === process.execPath ? "node" : arg === REPORTER ? "fast-reporter.mjs" : /\/vitest\/vitest\.mjs$/.test(arg) ? "vitest" : arg.startsWith(`${tree}/`) ? relative(tree, arg) : arg).join(" ");
  }

  async command(step: FastCommand["step"], argv: readonly string[], tree: string, cwd: string, env?: NodeJS.ProcessEnv, deadline?: number): Promise<Exec> {
    const result = await exec(argv, join(tree, cwd), env, deadline);
    const entry: FastCommand = { step, run: this.display(argv, tree), cwd, exit: result.exit, seconds: Math.round(result.ms / 100) / 10, ...(result.stopped ? { stopped: true } : {}) };
    this.commands.push(entry);
    this.log?.(`  ${step}: ${entry.run} (in ${cwd}) exit ${entry.exit}, ${entry.seconds}s`);
    return result;
  }

  async typecheck(pkg: string, tree = this.repo, step: FastCommand["step"] = "typecheck"): Promise<Exec & { findings: string[] }> {
    const result = await this.command(step, ["npm", "run", "--silent", "typecheck"], tree, pkg);
    return { ...result, findings: result.exit === 0 ? [] : findingsOf(result.output, tree) };
  }

  private crashed(step: FastCommand["step"], result: UnitResult, env?: NodeJS.ProcessEnv): UnitResult {
    if (result.status === "crash") this.aborts.push({ id: result.unit.id, step, signature: result.signature!, exit: result.exit!, ...(env ? { heapMb: HEAP_RETRY_MB } : {}) });
    return result;
  }

  /**
   * One vitest process over files of one package in tree; alone runs one file at a time on one worker. The reporter
   * writes each file's line as the file ends, so a stopped run still has the results of every file that finished.
   */
  async vitest(step: FastCommand["step"], tree: string, pkg: string, units: readonly Unit[], alone: boolean, deadline?: number, env?: NodeJS.ProcessEnv): Promise<UnitResult[]> {
    let bin: string;
    try { bin = join(dirname(createRequire(join(tree, pkg, "package.json")).resolve("vitest/package.json")), "vitest.mjs"); }
    catch (error) { return units.map(unit => ({ unit, status: "fail" as const, ms: 0, messages: [`vitest does not resolve from ${pkg}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`] })); }
    const out = join(scratch("clossys-fast-"), "results.jsonl");
    const argv = [process.execPath, bin, "run", "--reporter", REPORTER, ...(alone ? ["--maxWorkers=1", "--no-file-parallelism"] : []), ...units.map(unit => unit.file.slice(pkg.length + 1))];
    const byFile = new Map(units.map(unit => [unit.file, unit]));
    const done = new Map<string, UnitResult>();
    // A line a stop cut short names no file: that file has no result, so it counts as unrun (stopped) or failed.
    const parseErrors: string[] = [];
    const result = await this.command(step, argv, tree, pkg, { ...env, CLOSSYS_FAST_RESULTS: out, CI: "1" }, deadline);
    for (const line of (readText(out) ?? "").split("\n").filter(Boolean)) {
      let row: { file: string; state: string; ms: number; messages: string[] };
      try { row = JSON.parse(line) as typeof row; } catch (error) { parseErrors.push(String(error)); continue; }
      const unit = byFile.get(relative(tree, row.file));
      if (!unit || done.has(unit.file) || row.state === "queued" || row.state === "pending") continue;
      done.set(unit.file, { unit, status: row.state === "failed" ? "fail" : "pass", ms: row.ms, messages: row.messages });
    }
    // A file with no row after a signal exit of vitest itself (128 or above), or whose worker vitest reports exiting on a
    // signal, or in a run that ran out of heap, crashed: it is never a plain fail.
    const workers = new Set([...plain(result.output).matchAll(/Worker exited unexpectedly with signal \w+[^\n]*?running test file (\S+)/g)].map(match => relative(tree, match[1]!)));
    const heap = HEAP.test(result.output);
    return units.map(unit => {
      const row = done.get(unit.file);
      if (row) return row;
      if (result.stopped) return { unit, status: "unrun" as const, ms: 0, messages: [] };
      if (result.exit >= 128 || workers.has(unit.file) || heap) {
        const signature = signatureOf(result.output);
        return this.crashed(step, { unit, status: "crash", ms: result.ms, signature, exit: result.exit, messages: [`crash (${signature}): vitest exited ${result.exit} with no result for this file`, ...tail(result.output)] }, env);
      }
      return { unit, status: "fail" as const, ms: 0, messages: [`vitest exited ${result.exit} with no result for this file`, ...parseErrors.slice(0, 1), ...tail(result.output)] };
    });
  }

  async node(step: FastCommand["step"], tree: string, unit: Unit, deadline?: number, env?: NodeJS.ProcessEnv): Promise<UnitResult> {
    const result = await this.command(step, [process.execPath, ...unit.args!], tree, unit.cwd, env ?? {}, deadline);
    if (result.stopped) return { unit, status: "unrun", ms: result.ms, messages: [] };
    if (result.exit >= 128 || (result.exit !== 0 && HEAP.test(result.output))) {
      const signature = signatureOf(result.output);
      return this.crashed(step, { unit, status: "crash", ms: result.ms, signature, exit: result.exit, messages: [`crash (${signature}): exit ${result.exit}`, ...tail(result.output)] }, env);
    }
    if (result.exit === 0) return { unit, status: "pass", ms: result.ms, messages: [], exit: 0 };
    return { unit, status: "fail", ms: result.ms, exit: result.exit, findings: findingsOf(result.output, tree), messages: [`exit ${result.exit}`, ...tail(result.output)] };
  }

  /** One unit in its own process; a v8-heap crash runs once more alone at HEAP_RETRY_MB. */
  async single(step: FastCommand["step"], tree: string, unit: Unit): Promise<UnitResult> {
    const once = async (env?: NodeJS.ProcessEnv) => unit.kind === "vitest" ? (await this.vitest(step, tree, unit.pkg, [unit], true, undefined, env))[0]! : this.node(step, tree, unit, undefined, env);
    const first = await once();
    return first.status === "crash" && first.signature === "v8-heap" ? once(heapEnv()) : first;
  }

  /**
   * The alone step in one tree: batch (a package's failed vitest files in one single-worker process, each node unit in
   * its own) and then the per-file fallback: every crashed file (crashed in the related step, or in the batch) alone, one
   * process per file. Every file's last result is returned; each is base-compared by the caller.
   */
  async settle(step: FastCommand["step"], tree: string, batch: readonly Unit[], crashed: readonly Unit[]): Promise<UnitResult[]> {
    const out = new Map<string, UnitResult>();
    for (const result of batch.length ? await this.alone(step, tree, batch) : []) out.set(result.unit.id, result);
    const fallback = [...crashed, ...[...out.values()].filter(result => result.status === "crash").map(result => result.unit)];
    for (const unit of fallback) out.set(unit.id, await this.single(step, tree, unit));
    return [...out.values()];
  }

  /**
   * The related step: the vitest processes one after another, tier 1 then tier 2 (each process's pool uses the cores;
   * two vitest processes of one package would race on its globalSetup build), and beside them every node unit in one
   * pool, tier 1 first. Past the deadline nothing new starts and the running process is stopped.
   */
  async related(units: readonly Unit[], deadline: number): Promise<UnitResult[]> {
    const late = (unit: Unit): UnitResult => ({ unit, status: "unrun", ms: 0, messages: [] });
    const vitest = async () => {
      const out: UnitResult[] = [];
      for (const tier of [1, 2] as const) for (const [pkg, list] of byPackage(units.filter(unit => unit.tier === tier))) {
        out.push(...(Date.now() >= deadline ? list.map(late) : await this.vitest("related", this.repo, pkg, list, false, deadline)));
      }
      return out;
    };
    const node = units.filter(item => item.kind === "node");
    const width = units.some(item => item.kind === "vitest") ? Math.max(1, Math.floor(this.width / 2)) : this.width;
    const [ran, nodes] = await Promise.all([vitest(), pool(node, width, async unit => Date.now() >= deadline ? late(unit) : this.node("related", this.repo, unit, deadline))]);
    return [...ran, ...nodes];
  }

  /**
   * Each unit alone, once, in tree: a package's vitest files one at a time on one worker, and beside that process the
   * node units one after another (two single-file runners, never a batch).
   */
  async alone(step: FastCommand["step"], tree: string, units: readonly Unit[]): Promise<UnitResult[]> {
    const vitest = async () => {
      const out: UnitResult[] = [];
      for (const [pkg, list] of byPackage(units)) out.push(...await this.vitest(step, tree, pkg, list, true));
      return out;
    };
    const node = async () => {
      const out: UnitResult[] = [];
      for (const unit of units.filter(item => item.kind === "node")) out.push(await this.node(step, tree, unit));
      return out;
    };
    const [ran, nodes] = this.width > 1 ? await Promise.all([vitest(), node()]) : [await vitest(), await node()];
    return [...ran, ...nodes];
  }
}

/** The vitest units by package, packages in name order. */
const byPackage = (units: readonly Unit[]): [string, Unit[]][] => {
  const map = new Map<string, Unit[]>();
  for (const unit of units.filter(item => item.kind === "vitest")) { const list = map.get(unit.pkg) ?? []; list.push(unit); map.set(unit.pkg, list); }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
};

/** A detached tree of the merge-base with the checkout's installed dependencies linked in (never installed). */
function baseTree(repo: string, sha: string): Worktree {
  const tree = addWorktree(repo, sha, "fast-base");
  for (const dir of [".", ...listWorkspaces(repo).map(workspace => workspace.dir)]) {
    const from = join(repo, dir, "node_modules"), to = join(tree.dir, dir, "node_modules");
    if (!existsSync(from) || existsSync(to) || !existsSync(join(tree.dir, dir))) continue;
    symlinkSync(from, to, "dir");
  }
  return tree;
}

// --- the run ----------------------------------------------------------------------------------------------------

const seconds = (ms: number) => Math.round(ms / 100) / 10;
const list = (items: readonly string[], max = 5) => items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")}, +${items.length - max} more`;

/** The base ref when none is given: the current branch's upstream. Refuses (no fallback) when there is none. */
export function resolveBase(repo: string, base?: string): { ref: string; sha: string } {
  let ref = base;
  if (ref === undefined) {
    try { ref = git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]); }
    catch { throw new FastUsageError("check --fast: no base: this branch has no upstream; pass --base <ref> (there is no fallback base)"); }
  }
  try { return { ref, sha: git(repo, ["merge-base", ref, "HEAD"]) }; }
  catch (error) { throw new FastUsageError(`check --fast: no merge-base of ${ref} and HEAD: ${error instanceof Error ? error.message : String(error)}`); }
}

export async function runFast(options: FastOptions): Promise<FastRecord> {
  const budgetMs = options.budgetMs ?? BUDGET_MS, slowMs = options.slowMs ?? SLOW_MS;
  let repo: string;
  try { repo = git(resolve(options.repo), ["rev-parse", "--show-toplevel"]); }
  catch { throw new FastUsageError(`check --fast: ${options.repo} is not in a git repository`); }
  const { ref, sha: base } = resolveBase(repo, options.base);
  const head = git(repo, ["rev-parse", "HEAD"]);
  const dirty = git(repo, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw new FastUsageError(`check --fast: the checkout has uncommitted changes to tracked files; a FAST record names a commit, so commit first:\n${dirty.split("\n").slice(0, 5).join("\n")}`);
  const changes = changedFiles(repo, base, head);
  const runner = new Runner(repo, options.log);
  const steps: FastStep[] = [];
  const red: FastTest[] = [], baseRed: FastTest[] = [], noise: FastTest[] = [], slow: SlowTest[] = [], crash: FastCrash[] = [];
  let unrun: string[] = [];
  const manifestChange = changes.find(change => change.path === "package.json");
  const baseManifest = manifestChange && manifestChange.status !== "A" ? git(repo, ["show", `${base}:package.json`]) : "{}";
  const baseScripts = (JSON.parse(baseManifest) as { scripts?: Record<string, string> }).scripts ?? {};
  const { units, packages } = changes.length ? selectUnits(repo, changes, baseScripts) : { units: [], packages: [] };
  const finish = (verdict: FastVerdict, reason?: string): FastRecord => ({
    schema: FAST_SCHEMA, owner_agent: FAST_OWNER, verdict, head, base, baseRef: ref, changed: changes.map(change => change.path), packages,
    steps, commands: runner.commands, red, baseRed, noise, crash, aborts: runner.aborts, unrun, slow, budgetSeconds: seconds(budgetMs), slowSeconds: seconds(slowMs),
    ...(reason ? { reason } : {}), line: `${verdict} ${head}`,
  });
  /** A finished step: its line carries its wall time, so the record's line is the printed one. */
  const done = (step: StepName, status: FastStep["status"], text: string) => { const took = seconds(Date.now() - started); steps.push({ step, status, seconds: took, line: `${text} [${took}s]` }); };
  let started = Date.now();
  const skip = (...names: StepName[]) => { for (const step of names) steps.push({ step, status: "skipped", seconds: 0, line: `${step}: skipped` }); };
  if (!changes.length) { skip("typecheck", "related", "alone"); return finish("FAST FAIL", `empty diff ${ref}...HEAD: nothing to check`); }

  // One detached merge-base tree, made on first need (a red at head) and removed when the run ends.
  let tree: Worktree | undefined;
  let baseError: string | undefined;
  const baseDir = (): string | undefined => {
    if (tree || baseError) return tree?.dir;
    try { tree = baseTree(repo, base); } catch (error) { baseError = error instanceof Error ? error.message.split("\n")[0]! : String(error); }
    return tree?.dir;
  };
  try {
    // 1. typecheck every touched package that declares one. A red at head runs at base too: the same exit and the same
    // findings there is base-red; any finding new at head stops the run before any test.
    started = Date.now();
    const typed = packages.filter(dir => typeof listWorkspaces(repo).find(workspace => workspace.dir === dir)?.manifest.scripts?.typecheck === "string");
    const width = Math.max(1, Math.floor(availableParallelism() / 2));
    const checks = await pool(typed, width, async dir => ({ dir, result: await runner.typecheck(dir) }));
    const typeRed = checks.filter(check => check.result.exit !== 0);
    const atBase = typeRed.length && baseDir() ? await pool(typeRed, width, async check => {
      const manifest = readText(join(tree!.dir, check.dir, "package.json"));
      return typeof (JSON.parse(manifest ?? "{}") as { scripts?: Record<string, unknown> }).scripts?.typecheck === "string" ? await runner.typecheck(check.dir, tree!.dir, "base") : undefined;
    }) : [];
    const typeNew: { dir: string; why: string; base: string }[] = [];
    typeRed.forEach((check, index) => {
      const there = atBase[index];
      const { same, fresh } = compareCommand(check.result, there);
      if (same) baseRed.push({ id: `typecheck ${check.dir}`, pkg: check.dir, messages: [`exit ${check.result.exit}, ${check.result.findings.length} finding(s), the same at base`] });
      else typeNew.push({ dir: check.dir, why: `exit ${check.result.exit}: ${fresh[0] ?? tail(check.result.output, 1)[0] ?? "no output"}`, base: there ? `base exit ${there.exit}${there.exit === 0 ? "" : `, ${fresh.length} finding(s) new at head`}` : baseError ? `base could not run: ${baseError}` : "absent at base" });
    });
    if (typeNew.length) {
      done("typecheck", "fail", `typecheck: FAIL ${typeNew.map(item => `${item.dir} (${item.why}) [${item.base}]`).join("; ")}`);
      skip("related", "alone");
      return finish("FAST FAIL", "typecheck");
    }
    const typeBase = baseRed.filter(item => item.id.startsWith("typecheck "));
    done("typecheck", "pass", typed.length ? `typecheck: pass (${typed.length} package(s): ${list(typed)})${typeBase.length ? `, ${typeBase.length} base-red (${list(typeBase.map(item => item.pkg))})` : ""}` : "typecheck: no touched package declares a typecheck script");

    // 2. related tests, within the budget.
    started = Date.now();
    const related = await runner.related(units, started + budgetMs);
    unrun = related.filter(result => result.status === "unrun").map(result => result.unit.id);
    const failed = related.filter(result => result.status === "fail");
    const crashed = related.filter(result => result.status === "crash");
    const ran = related.length - unrun.length;
    const crashNote = crashed.length ? `${crashed.length} crashed (${list(crashed.map(result => `${result.unit.id} ${result.signature}`))})` : "";
    if (unrun.length) {
      done("related", "incomplete", `related: INCOMPLETE after the ${seconds(budgetMs)}s budget: ${unrun.length} of ${related.length} test unit(s) left unrun (${list(unrun)})${failed.length ? `; ${failed.length} failed so far (${list(failed.map(result => result.unit.id))})` : ""}${crashNote ? `; ${crashNote}` : ""}`);
      skip("alone");
      return finish("FAST INCOMPLETE", "related step budget");
    }
    const rerun = [...failed, ...crashed];
    done("related", rerun.length ? "fail" : "pass", !related.length ? "related: no test reaches the changed files"
      : rerun.length ? `related: ${failed.length} of ${ran} test unit(s) failed${crashNote ? `, ${crashNote}` : ""}, re-run alone: ${list(rerun.map(result => result.unit.id))}`
      : `related: pass (${ran} test unit(s))`);

    // 3. alone: the failures (and the borderline slow candidates) once each by themselves at head, crashed files one
    // process per file, and beside that run (another tree, so no shared build) the same files the same way at the
    // merge-base: only files that failed at head ever run at base, never a whole package. The base compare reads each
    // file's last result on both sides, after the per-file fallback.
    started = Date.now();
    const passing = related.filter(result => result.status === "pass" && result.ms > slowMs);
    // A file over SURE_SLOW times the threshold in the related run is slow alone too (a shared core inflates a file's own
    // time by far less): it is listed from that measurement and not re-run. Borderline files are re-run alone.
    for (const result of passing.filter(item => item.ms > SURE_SLOW * slowMs)) slow.push({ id: result.unit.id, pkg: result.unit.pkg, seconds: seconds(result.ms), measured: "related", ...ownerOf(repo, result.unit.pkg) });
    const batch = [...failed.map(result => result.unit), ...passing.filter(item => item.ms <= SURE_SLOW * slowMs).map(result => result.unit)];
    const fallback = crashed.map(result => result.unit);
    const there = new Map<string, UnitResult>();
    const baseRun = async () => {
      if (!rerun.length || !baseDir()) return;
      const present = (unit: Unit) => existsSync(join(tree!.dir, unit.file));
      for (const result of await runner.settle("base", tree!.dir, failed.map(item => item.unit).filter(present), fallback.filter(present))) there.set(result.unit.id, result);
    };
    const [alone] = await Promise.all([runner.settle("alone", repo, batch, fallback), baseRun()]);
    for (const result of alone) if (result.status === "pass" && result.ms > slowMs) slow.push({ id: result.unit.id, pkg: result.unit.pkg, seconds: seconds(result.ms), measured: "alone", ...ownerOf(repo, result.unit.pkg) });
    const rerunIds = new Set(rerun.map(result => result.unit.id));
    const atHead = new Map(alone.map(result => [result.unit.id, result]));
    for (const first of rerun) {
      const result = atHead.get(first.unit.id)!;
      const entry = { id: result.unit.id, pkg: result.unit.pkg, messages: result.messages };
      const atBaseResult = there.get(result.unit.id);
      const baseNote = atBaseResult ? `at base: ${atBaseResult.status}${atBaseResult.signature ? ` (${atBaseResult.signature})` : ""}` : baseError ? `base could not run: ${baseError}` : "absent at base";
      if (result.status === "pass") { noise.push({ ...entry, messages: first.messages }); continue; }
      // A crash left after the fallback is unknown, never a fail and never base-red, whatever base did.
      if (result.status === "crash") { crash.push({ ...entry, signature: result.signature!, exit: result.exit!, messages: [...entry.messages, baseNote] }); continue; }
      if (isCommand(result.unit)) {
        const base = atBaseResult?.status === "fail" ? { exit: atBaseResult.exit!, findings: atBaseResult.findings ?? [] } : undefined;
        const { same, fresh } = compareCommand({ exit: result.exit!, findings: result.findings ?? [] }, base);
        if (same) baseRed.push({ ...entry, messages: [`exit ${result.exit}, ${result.findings?.length ?? 0} finding(s), the same at base`] });
        else red.push({ ...entry, messages: [...entry.messages, base ? `new at head: ${list(fresh, 3) || `exit ${result.exit} (base exit ${base.exit})`}` : baseNote] });
        continue;
      }
      if (atBaseResult?.status === "fail") baseRed.push(entry);
      else red.push({ ...entry, messages: [...entry.messages, atBaseResult?.status === "pass" ? "passes alone at base" : baseNote] });
    }
    const rerunCount = batch.length + fallback.length;
    const baseRedHere = baseRed.filter(item => rerunIds.has(item.id));
    const parts = [
      `${rerunCount} re-run`, ...(red.length ? [`${red.length} red (${list(red.map(item => item.id))})`] : []),
      ...(baseRedHere.length ? [`${baseRedHere.length} base-red (${list(baseRedHere.map(item => item.id))})`] : []),
      ...(noise.length ? [`${noise.length} load noise (${list(noise.map(item => item.id))})`] : []),
      ...(crash.length ? [`${crash.length} crash (${list(crash.map(item => `${item.id} ${item.signature}`))})`] : []),
    ];
    done("alone", red.length ? "fail" : crash.length ? "incomplete" : "pass", rerunCount ? `alone: ${parts.join(", ")}` : "alone: nothing to re-run");
    if (red.length) return finish("FAST FAIL", "red");
    if (crash.length) return finish("FAST INCOMPLETE", `crash: ${crash.length} test file(s) still crash alone (${list(crash.map(item => `${item.id} ${item.signature}`))}); a crash is never a pass or base-red`);
    if (!runner.commands.length) return finish("FAST FAIL", "the diff changed files but no command ran: nothing checked is never a pass");
    return finish("FAST PASS");
  } finally {
    tree?.remove();
  }
}

/** The printed lines of a record: one per step, the red and base-red details, slow tests, requests, then the verdict. */
export function formatFast(record: FastRecord): string {
  return [
    `check --fast: ${record.changed.length} changed file(s) ${record.baseRef}...HEAD (base ${record.base.slice(0, 12)}), ${record.commands.length} command(s)`,
    ...record.steps.map(step => step.line),
    ...record.red.map(item => `red: ${item.id}: ${item.messages.join(" | ")}`),
    ...record.baseRed.map(item => `base-red: ${item.id} (${/^(?:typecheck|npm run) /.test(item.id) ? "the same exit and findings" : "also fails alone"} at base ${record.base.slice(0, 12)})`),
    ...record.crash.map(item => `crash: ${item.id} (${item.signature}, exit ${item.exit}): ${item.messages.join(" | ")}`),
    ...(record.slow.length ? ["slow:", ...record.slow.map(item => `  ${item.id} ${item.seconds}s ${item.measured === "alone" ? "alone" : `in the related run, over ${SURE_SLOW}x the ${record.slowSeconds}s budget (not re-run)`}${item.owner ? ` (owner ${item.owner})` : ""}`)] : []),
    ...(record.reason && record.verdict !== "FAST PASS" && !["red", "typecheck"].includes(record.reason) ? [`reason: ${record.reason}`] : []),
    ...(record.requests ?? []),
    record.line,
  ].join("\n");
}

const ownerOf = (repo: string, pkg: string): { owner?: string } => { const owner = owningAgent(repo, pkg); return owner ? { owner } : {}; };

/** The agent that owns a package's tests: its skill's `clossys-<agent>` name, else its enclosing package's, else its manifest name. */
export function owningAgent(repo: string, pkg: string): string | undefined {
  if (pkg === ".") return undefined;
  for (let dir = pkg; dir !== "." && dir !== ""; dir = posix.dirname(dir)) {
    const skill = readText(join(repo, dir, "skill", "SKILL.md"));
    const name = skill && /^name:\s*clossys-([a-z][a-z0-9-]*)\s*$/m.exec(skill)?.[1];
    if (name) return name;
  }
  const manifest = JSON.parse(readText(join(repo, pkg, "package.json")) ?? "{}") as { name?: string };
  const last = manifest.name?.split("/").pop();
  return last && /^[a-z][a-z0-9-]*$/.test(last) ? last : undefined;
}
