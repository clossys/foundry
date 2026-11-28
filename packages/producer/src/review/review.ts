/**
 * `clossys review <base> <head>`: everything a reviewer re-ran by hand, as one deterministic run in a temporary
 * detached worktree of head. The steps (REVIEW_STEPS) and their fail rules are docs/review.md (not shipped); the report ends with
 * `MECHANICAL: PASS|FAIL <head-sha> <tree-sha>` and the findings list. A model reviewer reads that report plus the
 * doc truth and the packet's scope, and re-runs nothing.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { changedFiles, forbiddenFindings, headHunks, packageOf } from "./changes.js";
import { FOUNDRY_CONFIG, type GeneratedFixture, type ReviewConfig } from "./config.js";
import { addWorktree, exitText, git, observeRuns, run, scratch, type RunEntry, type RunResult, type Worktree } from "./exec.js";
import { buildSet, coveringTests, isSource, listWorkspaces, testCommand } from "./graph.js";
import { applyMutant, COMPILE_ERROR, fileMutants, MUTANT_CAP, selectMutants } from "./mutate.js";
import { compareReceipt, parsePacket, readReceipt, receiptFileFor } from "./receipt.js";
import type { Finding, MutantResult, ReviewReport, StepResult, StepStatus } from "./types.js";

export const REVIEW_SCHEMA = "clossys.review/1";

/** The steps in run order, each with the finding id it raises and when it fails (docs/review.md (not shipped)). */
export const REVIEW_STEPS: readonly { readonly step: string; readonly finding: string; readonly fails: string }[] = [
  { step: "changed", finding: "-", fails: "never: the files and packages of git diff --name-status base...head" },
  { step: "forbidden", finding: "forbidden.*", fails: "any forbidden path below" },
  { step: "leak-scan", finding: "leak-scan", fails: "the merge base's public-safety script, run unchanged against the head tree, exits non-zero, or the merge base has no such script (its output is never stored or printed)" },
  { step: "install", finding: "install", fails: "the install in the head tree (and the base tree, for the counts) exits non-zero" },
  { step: "build", finding: "build", fails: "a build of a changed package, a probe or fixture package, or a prerequisite exits non-zero; each package builds once, dependencies first" },
  { step: "types", finding: "types", fails: "the typecheck of a changed workspace package with a tsconfig.json exits non-zero" },
  { step: "tests", finding: "tests / tests.base-red (note) / test.uncovered", fails: "a covering test file exits non-zero run on its own and one of its failing tests (`file :: full name` for vitest, else the file) does not also fail run alone at the merge base (nor is listed base-red by a --fast record at this head), or a changed source file has no covering test" },
  { step: "counts", finding: "count.increase / count.probe", fails: "a probe finds more of a rule at head than at the merge base, or cannot run in either tree" },
  { step: "fixtures", finding: "fixture.*", fails: "a registered generator is not at the head; or, for a fixture whose inputs changed, the head generator fails or writes anything diff -r finds against the head's committed copy" },
  { step: "e2e", finding: "e2e", fails: "clossys check --e2e exits non-zero when the producer, designer, writer or publisher package changed" },
  { step: "receipt", finding: "receipt.*", fails: "with --packet: any receipt finding below" },
  { step: "mutation", finding: "mutation.survived (note)", fails: "never: each mutant is reported killed, survived, invalid (does not compile) or uncovered" },
];

export interface ReviewOptions {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly packet?: string;
  readonly receipt?: string;
  readonly seed?: string;
  readonly cap?: number;
  readonly config?: ReviewConfig;
  /** A `clossys check --fast --json` record at this head and merge base: its base-red tests need no base re-run. */
  readonly fast?: string;
  readonly log?: (line: string) => void;
}

/** The rules the verdict applies on top of every step's findings: a review that checked nothing is never a PASS. */
export const FAIL_CLOSED: readonly { readonly id: string; readonly fails: string }[] = [
  { id: "review.no-commands", fails: "the review ran no command (git plumbing aside): nothing checked is never a PASS, an empty diff included" },
  { id: "run.missing", fails: "any command exited 127 (a missing install, tool or file to run): never a PASS, whatever exit a packet expects" },
];

/** What the review ran, as the verdict counts it: every run except git plumbing; 127s by command, once each. */
export function ranOf(entries: readonly RunEntry[]): { commands: number; missing: string[] } {
  const counted = entries.filter(entry => entry.argv0 !== "git");
  return { commands: counted.length, missing: [...new Set(counted.filter(entry => entry.exit === 127).map(entry => entry.command))] };
}

/** The fail-closed findings of what ran (FAIL_CLOSED). */
export function failClosed(ran: { readonly commands: number; readonly missing: readonly string[] }): Finding[] {
  const out: Finding[] = [];
  if (ran.commands === 0) out.push({ id: "review.no-commands", level: "fail", subject: "review", detail: "no command ran: nothing was checked, so this is not a PASS" });
  for (const command of ran.missing) out.push({ id: "run.missing", level: "fail", subject: command.slice(0, 200), detail: "exit 127: not installed or not found" });
  return out;
}

/** The verdict of a findings list: FAIL on any fail-level finding. */
export const verdictOf = (findings: readonly Finding[]): "PASS" | "FAIL" => findings.some(finding => finding.level === "fail") ? "FAIL" : "PASS";

/** Arguments the review refuses before it runs anything (the CLI reports them as usage errors). */
export class ReviewArgumentError extends Error {}

const npmBuild = (name: string) => ["npm", "run", "build", `--workspace=${name}`];
const lastLine = (output: string) => output.trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? "";
/** The last few lines that are not npm's own wrapper lines: the failing tool's message. */
const RULE_LINE = /^[\s\u23af\u2500=-]*(?:\[\d+\/\d+\][\s\u23af\u2500=-]*)?$/;
const tailLines = (output: string, count = 4) => output.trim().split("\n").filter(line => line.trim() && !/^npm (error|ERR!)/.test(line) && !RULE_LINE.test(line)).slice(-count).map(line => line.slice(0, 200)).join(" | ") || lastLine(output);
/** A failed run as a finding detail: exit code (and timeout), then the tool's last lines. */
const failed = (result: RunResult, lines = 4) => `${exitText(result)}: ${tailLines(result.output, lines)}`;

export function runReview(options: ReviewOptions): ReviewReport {
  const config = options.config ?? FOUNDRY_CONFIG;
  const log = options.log ?? (() => {});
  const repo = options.repo;
  if (options.receipt && !options.packet) throw new ReviewArgumentError("--receipt needs --packet: a receipt is held to its packet's own Validation list");
  const base = git(repo, ["rev-parse", "--verify", `${options.base}^{commit}`]);
  const head = git(repo, ["rev-parse", "--verify", `${options.head}^{commit}`]);
  const tree = git(repo, ["rev-parse", `${head}^{tree}`]);
  const mergeBase = git(repo, ["merge-base", base, head]);
  if (mergeBase === head && head !== base) throw new ReviewArgumentError(`head ${head.slice(0, 9)} is an ancestor of base ${base.slice(0, 9)}, so base...head is empty: are <base> and <head> swapped?`);
  const changes = changedFiles(repo, base, head);
  const files = changes.map(change => change.path);
  const steps: StepResult[] = [], findings: Finding[] = [], mutants: MutantResult[] = [];
  const counts: Record<string, { base: number | null; head: number | null }> = {};
  const step = (name: string, status: StepStatus, detail: string, ms = 0) => { steps.push({ step: name, status, detail, ms }); log(`review: ${name} ${status}${detail ? ` (${detail})` : ""}`); };
  const fail = (id: string, subject: string, detail: string) => findings.push({ id, level: "fail", subject, detail });

  const entries: RunEntry[] = [];
  const red = { newRed: [] as string[], baseRed: [] as string[] };
  const fastBaseRed = options.fast ? fastRecordBaseRed(options.fast, head, mergeBase, fail) : undefined;
  const forbidden = forbiddenFindings(repo, base, head, changes);
  findings.push(...forbidden);
  const trees: Worktree[] = [];
  let baseWorktree: Worktree | undefined;
  /** The merge base's tree, made once on first use (leak scan, counts). */
  const baseAt = () => { if (!baseWorktree) { baseWorktree = addWorktree(repo, mergeBase, "base"); trees.push(baseWorktree); } return baseWorktree.dir; };
  let packages: string[] = [];
  observeRuns(entry => entries.push(entry), () => { try {
    if (!changes.length && !options.packet) {
      step("changed", "pass", "no changes");
      for (const name of REVIEW_STEPS.slice(1).map(item => item.step)) step(name, name === "forbidden" ? "pass" : "skip", name === "forbidden" ? "0 finding(s)" : "empty diff");
    } else {
      const headTree = addWorktree(repo, head, "head");
      trees.push(headTree);
      const at = headTree.dir;
      packages = [...new Set(files.map(file => packageOf(at, file)))].sort();
      step("changed", "pass", `${files.length} file(s), ${packages.length} package(s)`);
      step("forbidden", forbidden.length ? "fail" : "pass", `${forbidden.length} finding(s)`);
      if (config.leakScan) leakScan(config.leakScan.npmScript, at, baseAt(), config.timeoutMs, step, fail);
      else step("leak-scan", "skip", "no leak scan configured");
      const installed = install(config, at, "head", step, fail);
      const counting = config.counts.length > 0 && changes.length > 0;
      const due = config.fixtures.filter(item => files.some(file => file.startsWith(`${item.fixture}/`) || item.triggers.some(prefix => file.startsWith(prefix))));
      const built = installed && build(at, [...packages, ...(counting ? config.probePackages : []), ...due.flatMap(item => item.needs)], step, fail, config.timeoutMs);
      types(at, packages, config, step, fail);
      const covering = coveringTests(at, changes, file => packageOf(at, file));
      const baseRun = baseRunner(repo, mergeBase, at, trees, config.timeoutMs);
      const tested = tests(at, covering.all, covering.uncovered, step, fail, findings, baseRun, fastBaseRed, config.timeoutMs);
      red.newRed.push(...tested.newRed);
      red.baseRed.push(...tested.baseRed);
      if (counting && built) countDeltas(repo, mergeBase, at, baseAt, config, counts, step, fail);
      else step("counts", "skip", counting ? "the head build failed" : "no probes or no changes");
      fixtures(repo, mergeBase, head, at, due, config, step, fail);
      const e2e = config.e2e && packages.some(pkg => config.e2e!.packages.includes(pkg));
      if (e2e) { const result = run(config.e2e!.argv, at, { timeoutMs: config.timeoutMs }); step("e2e", result.exit ? "fail" : "pass", exitText(result), result.ms); if (result.exit) fail("e2e", config.e2e!.argv.join(" "), failed(result, 1)); }
      else step("e2e", "skip", "no e2e package changed");
      if (options.packet) receipt(resolve(options.packet), options.receipt, head, at, config.timeoutMs, step, fail, findings);
      else step("receipt", "skip", "no --packet");
      mutation(repo, mergeBase, head, at, files, covering.bySource, tested.red, options.seed ?? "0", options.cap ?? MUTANT_CAP, config.timeoutMs, mutants, step, findings);
    }
  } finally {
    for (const item of trees) item.remove();
  } });
  const ran = ranOf(entries);
  findings.push(...failClosed(ran));
  const verdict = verdictOf(findings);
  return { schema: REVIEW_SCHEMA, base, head, tree, changed: { files, packages }, steps, counts, mutants, findings, ran, newRed: red.newRed.sort(), baseRed: red.baseRed.sort(), verdict, line: `MECHANICAL: ${verdict} ${head} ${tree}` };
}

/**
 * The base-red tests of a `clossys check --fast --json` record (ids: the test file, and `file :: name` for each failing
 * test it names), held to this head and merge base: any other record is a fast.record FAIL and lends nothing.
 */
function fastRecordBaseRed(file: string, head: string, mergeBase: string, fail: FailFn): Set<string> | undefined {
  let record: { schema?: unknown; head?: unknown; base?: unknown; baseRed?: { id?: unknown; messages?: unknown }[] };
  try { record = JSON.parse(readFileSync(file, "utf8")) as typeof record; }
  catch (error) { fail("fast.record", file, `unreadable: ${(error as Error).message.split("\n")[0]}`); return undefined; }
  if (record.schema !== "clossys.fast-check/1") { fail("fast.record", file, "not a clossys.fast-check/1 record"); return undefined; }
  if (record.head !== head || record.base !== mergeBase) { fail("fast.record", file, `taken at ${String(record.head).slice(0, 12)} over ${String(record.base).slice(0, 12)}, reviewing ${head.slice(0, 12)} over the merge base ${mergeBase.slice(0, 12)}`); return undefined; }
  const out = new Set<string>();
  for (const item of Array.isArray(record.baseRed) ? record.baseRed : []) {
    if (typeof item.id !== "string") continue;
    out.add(item.id);
    for (const message of Array.isArray(item.messages) ? item.messages : []) if (typeof message === "string") out.add(`${item.id} :: ${message}`);
  }
  return out;
}

/** Listed base-red by a fast record: the file itself, or a failing-test message that starts with the test's name. */
const listedBaseRed = (listed: Set<string>, id: string) => listed.has(id) || [...listed].some(entry => entry.startsWith(`${id}: `));

type StepFn = (name: string, status: StepStatus, detail: string, ms?: number) => void;
type FailFn = (id: string, subject: string, detail: string) => void;

/** Characters that would make a package.json script line more than one plain command. */
const SHELL_SYNTAX = /[|&;<>()$`\\"'*?]/;

/**
 * The merge base's public-safety script (its root package.json script `name`, `node <script> <args>`), unchanged,
 * run with the head tree as its working directory before anything installs there: the head cannot rewire or replace
 * the scanner it is judged by. Only the exit code is kept; nothing of its output is stored or printed.
 */
function leakScan(name: string, at: string, baseDir: string, timeoutMs: number, step: StepFn, fail: FailFn): void {
  let line: unknown;
  try { line = (JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts?.[name]; } catch { line = undefined; }
  const words = typeof line === "string" ? line.trim().split(/\s+/) : [];
  const script = words[1] ?? "";
  if (words[0] !== "node" || !script || SHELL_SYNTAX.test(String(line)) || !existsSync(join(baseDir, script))) {
    const why = typeof line !== "string" ? `the merge base's package.json has no "${name}" script` : `the merge base's "${name}" script is not one \`node <script> <args>\` command whose script it holds`;
    step("leak-scan", "fail", why);
    fail("leak-scan", name, `${why}; refusing to judge the head without it`);
    return;
  }
  const result = run(["node", join(baseDir, script), ...words.slice(2)], at, { timeoutMs });
  step("leak-scan", result.exit ? "fail" : "pass", `the merge base's ${name} on the head tree: ${exitText(result)}`, result.ms);
  if (result.exit) fail("leak-scan", name, `${exitText(result)}; output withheld, run npm run ${name} in the checkout`);
}

function install(config: ReviewConfig, at: string, label: string, step: StepFn, fail: FailFn): boolean {
  if (!config.install) { if (label === "head") step("install", "skip", "no install configured"); return true; }
  const result = run(config.install, at, { timeoutMs: config.timeoutMs });
  if (label === "head" || result.exit) step("install", result.exit ? "fail" : "pass", `${label}: ${exitText(result)}`, result.ms);
  if (result.exit) fail("install", `${label}: ${config.install.join(" ")}`, failed(result, 1));
  return result.exit === 0;
}

/** A built tree to take an unchanged package's dist/ from: the package's git tree is the same at both revisions. */
interface Reuse { readonly from: string; readonly same: (dir: string) => boolean }

function build(at: string, targets: readonly string[], step: StepFn, fail: FailFn, timeoutMs: number, label = "head", reuse?: Reuse): boolean {
  const { order, prerequisites } = buildSet(at, targets);
  let ok = true, ms = 0;
  const copied: string[] = [];
  for (const workspace of order) {
    // An unchanged prerequisite builds to the same output in both trees: the base tree copies the head tree's dist/.
    if (reuse && prerequisites.has(workspace.dir) && reuse.same(workspace.dir) && existsSync(join(reuse.from, workspace.dir, "dist"))) {
      cpSync(join(reuse.from, workspace.dir, "dist"), join(at, workspace.dir, "dist"), { recursive: true });
      copied.push(workspace.name);
      continue;
    }
    const result = run(npmBuild(workspace.name), at, { timeoutMs });
    ms += result.ms;
    if (result.exit) { ok = false; fail("build", `${label}: ${workspace.name}`, failed(result)); }
  }
  const names = order.map(item => item.name + (copied.includes(item.name) ? " (dist from head, unchanged)" : prerequisites.has(item.dir) ? " (prerequisite)" : ""));
  step("build", ok ? "pass" : "fail", `${label}: ${names.join(", ") || "nothing to build"}`, ms);
  return ok;
}

function types(at: string, packages: readonly string[], config: ReviewConfig, step: StepFn, fail: FailFn): void {
  const checked: string[] = [];
  let ms = 0, ok = true;
  for (const pkg of packages) {
    if (pkg === "." || !existsSync(join(at, pkg, "tsconfig.json"))) continue;
    const result = run(config.typecheck.map(arg => arg.replace("{pkg}", pkg)), at, { timeoutMs: config.timeoutMs });
    ms += result.ms;
    checked.push(pkg);
    if (result.exit) { ok = false; fail("types", pkg, failed(result, 2)); }
  }
  step("types", checked.length ? (ok ? "pass" : "fail") : "skip", checked.join(", ") || "no changed package has a tsconfig.json", ms);
}

/** The failing tests of one test file's run: `file :: full name` per vitest FAIL line, else the file itself. */
export function failingTests(file: string, pkg: string, output: string): string[] {
  const rel = pkg === "." ? file : file.slice(pkg.length + 1);
  const names = new Set<string>();
  for (const raw of output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").split("\n")) {
    const match = /^\s*FAIL\s+(\S+)\s+>\s+(.+?)\s*$/.exec(raw);
    if (match && match[1] === rel) names.add(`${file} :: ${match[2]!.replace(/\s+\d+(?:\.\d+)?m?s$/, "")}`);
  }
  return names.size ? [...names].sort() : [file];
}

/** One red test file: its failing tests at head, and with the file run alone at the merge base (null: no such file there). */
export interface RedObservation { readonly file: string; readonly head: readonly string[]; readonly base: readonly string[] | null }

/**
 * New red and base-red, from what ran: a failing test at head is base-red when the same id (`file :: name`, or the
 * file) also failed at the merge base, or when a --fast record at this head lists it base-red; every other is new red.
 * A file that fails at base for another reason (a different test, or failing to load) lends its head failures nothing.
 */
export function splitRed(observed: readonly RedObservation[], listed?: Set<string>): { newRed: { id: string; file: string }[]; baseRed: { id: string; file: string; by: "base" | "fast" }[] } {
  const newRed: { id: string; file: string }[] = [], baseRed: { id: string; file: string; by: "base" | "fast" }[] = [];
  for (const item of observed) for (const id of item.head) {
    if (listed && listedBaseRed(listed, id)) baseRed.push({ id, file: item.file, by: "fast" });
    else if (item.base?.includes(id)) baseRed.push({ id, file: item.file, by: "base" });
    else newRed.push({ id, file: item.file });
  }
  return { newRed: newRed.sort((a, b) => a.id.localeCompare(b.id)), baseRed: baseRed.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** What a mechanical run observed, as a parity record keeps it: the commands with their exits, and each red test file. */
export interface MechanicalObservation {
  /** Commands run in all (tests included). */
  readonly ran: number;
  readonly missing?: readonly string[];
  /** Packet commands with the exit each was expected to give and gave. */
  readonly commands: readonly { readonly run: string; readonly expect: number; readonly exit: number }[];
  readonly red: readonly RedObservation[];
}

/**
 * The verdict and lists the review's own rules give an observation: FAIL on any new red test, any packet command not
 * at its expected exit (or exiting 127), or nothing run at all (FAIL_CLOSED); base-red tests are reported only.
 */
export function mechanicalVerdict(observation: MechanicalObservation): { verdict: "PASS" | "FAIL"; newRed: string[]; baseRed: string[]; commandReds: string[] } {
  const split = splitRed(observation.red);
  const commandReds = observation.commands.filter(command => command.exit !== command.expect || command.exit === 127).map(command => `\`${command.run}\` exit ${command.exit} expected ${command.expect}`);
  const closed = failClosed({ commands: observation.ran, missing: [...(observation.missing ?? []), ...observation.commands.filter(command => command.exit === 127).map(command => command.run)] });
  const verdict = split.newRed.length || commandReds.length || closed.length ? "FAIL" : "PASS";
  return { verdict, newRed: split.newRed.map(item => item.id), baseRed: split.baseRed.map(item => item.id), commandReds };
}

/** Runs one test file alone at the merge base: its failing tests, or null when the merge base has no such file. */
type BaseRun = (file: string) => Set<string> | null;

/** A lazily made merge-base tree with the head tree's installed dependencies linked in (never installed), as check --fast does. */
function baseRunner(repo: string, mergeBase: string, at: string, trees: Worktree[], timeoutMs: number): BaseRun {
  let dir: string | undefined;
  const cache = new Map<string, Set<string> | null>();
  return file => {
    if (cache.has(file)) return cache.get(file)!;
    if (!dir) {
      const tree = addWorktree(repo, mergeBase, "base-red");
      trees.push(tree);
      dir = tree.dir;
      for (const ws of [".", ...listWorkspaces(at).map(workspace => workspace.dir)]) {
        const from = join(at, ws, "node_modules"), to = join(dir, ws, "node_modules");
        if (existsSync(from) && !existsSync(to) && existsSync(join(dir, ws))) symlinkSync(from, to, "dir");
      }
    }
    let out: Set<string> | null = null;
    if (existsSync(join(dir, file))) {
      const pkg = packageOf(dir, file), command = testCommand(dir, pkg, file);
      const result = run(command.argv, command.cwd, { timeoutMs });
      out = new Set(result.exit ? failingTests(file, pkg, result.output) : []);
    }
    cache.set(file, out);
    return out;
  };
}

/**
 * Each covering test file on its own, and a finding for each changed source no test covers. A red file's failing
 * tests are each new red (a tests FAIL) unless the same test also fails with the file run alone at the merge base, or
 * the --fast record lists it base-red: then it is base-red, a note. Returns the red files and both lists.
 */
function tests(at: string, files: readonly string[], uncovered: readonly string[], step: StepFn, fail: FailFn, findings: Finding[], baseRun: BaseRun, fastBaseRed: Set<string> | undefined, timeoutMs: number): { red: Set<string>; newRed: string[]; baseRed: string[] } {
  const red = new Set<string>(), observed: RedObservation[] = [], results = new Map<string, RunResult>();
  let ms = 0;
  for (const file of files) {
    const pkg = packageOf(at, file), command = testCommand(at, pkg, file);
    const result = run(command.argv, command.cwd, { timeoutMs });
    ms += result.ms;
    if (!result.exit) continue;
    red.add(file);
    results.set(file, result);
    const head = failingTests(file, pkg, result.output);
    // The merge base runs only when a failing test is not already listed base-red by the --fast record.
    const base = fastBaseRed && head.every(id => listedBaseRed(fastBaseRed, id)) ? [] : baseRun(file);
    observed.push({ file, head, base: base === null ? null : [...base] });
  }
  const split = splitRed(observed, fastBaseRed);
  for (const item of split.baseRed) findings.push({ id: "tests.base-red", level: "note", subject: item.id, detail: item.by === "fast" ? "listed base-red by the --fast record at this head" : "also fails run alone at the merge base" });
  for (const item of split.newRed) fail("tests", item.id, failed(results.get(item.file)!, 1));
  const newRed = split.newRed.map(item => item.id), baseRed = split.baseRed.map(item => item.id);
  for (const source of uncovered) fail("test.uncovered", source, "changed, and no test file reaches it through the import graph");
  const status = newRed.length || uncovered.length ? "fail" : files.length ? "pass" : "skip";
  step("tests", status, `${files.length - red.size}/${files.length} file(s) green, ${newRed.length} new red, ${baseRed.length} base-red, ${uncovered.length} changed source(s) uncovered`, ms);
  return { red, newRed, baseRed };
}

function probe(config: ReviewConfig, at: string): Map<string, Record<string, number> | string> {
  const out = new Map<string, Record<string, number> | string>();
  for (const item of config.counts) {
    const result = run(item.argv, at, { timeoutMs: config.timeoutMs });
    try { out.set(item.id, item.parse(result.stdout)); }
    catch (error) { out.set(item.id, `${exitText(result)}: ${(error as Error).message}; ${lastLine(result.output)}`); }
  }
  return out;
}

/** Rule finding counts per probe at the merge base and at head; any increase fails. */
function countDeltas(repo: string, mergeBase: string, at: string, baseAt: () => string, config: ReviewConfig, counts: Record<string, { base: number | null; head: number | null }>, step: StepFn, fail: FailFn): void {
  const started = Date.now();
  const baseTree = { dir: baseAt() };
  const treeOf = (tree: string, rev: string, dir: string) => { const result = run(["git", "rev-parse", `${rev}:${dir}`], tree); return result.exit ? "" : result.stdout.trim(); };
  const reuse: Reuse = { from: at, same: dir => { const before = treeOf(repo, mergeBase, dir); return before !== "" && before === treeOf(at, "HEAD", dir); } };
  const baseReady = install(config, baseTree.dir, "base", step, fail) && build(baseTree.dir, config.probePackages, step, (id, subject, detail) => fail("count.probe", subject, `base ${id}: ${detail}`), config.timeoutMs, "base", reuse);
  const before = baseReady ? probe(config, baseTree.dir) : new Map<string, string>(config.counts.map(item => [item.id, "base tree did not build"]));
  const after = probe(config, at);
  let increases = 0, broken = 0;
  for (const item of config.counts) {
    const b = before.get(item.id), h = after.get(item.id);
    if (typeof h === "string") { broken++; fail("count.probe", item.id, `head: ${h}`); continue; }
    if (typeof b === "string") { broken++; fail("count.probe", item.id, `base: ${b}`); }
    for (const rule of [...new Set([...Object.keys(typeof b === "object" ? b : {}), ...Object.keys(h!)])].sort()) {
      const baseCount = typeof b === "object" ? b[rule] ?? 0 : null, headCount = h![rule] ?? 0;
      counts[`${item.id}:${rule}`] = { base: baseCount, head: headCount };
      if (baseCount !== null && headCount > baseCount) { increases++; fail("count.increase", `${item.id}:${rule}`, `${baseCount} -> ${headCount}`); }
    }
  }
  step("counts", increases || broken || !baseReady ? "fail" : "pass", `${Object.keys(counts).length} rule count(s), ${increases} increase(s), ${broken} probe(s) that did not run`, Date.now() - started);
}

/** git archive of rev's path, extracted under into without a shell; the error text, or null when both exit 0. */
function extract(repo: string, rev: string, path: string, into: string): string | null {
  mkdirSync(into, { recursive: true });
  const tar = spawnSync("git", ["-C", repo, "archive", "--format=tar", rev, "--", path], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) return `git archive ${rev.slice(0, 9)} -- ${path}: exit ${tar.status ?? "signal"}: ${String(tar.stderr ?? "").trim().split("\n").slice(-1)[0] ?? ""}`;
  const untar = spawnSync("tar", ["-x", "-C", into], { input: tar.stdout, maxBuffer: 1 << 20 });
  if (untar.status !== 0) return `tar -x: exit ${untar.status ?? "signal"}: ${String(untar.stderr ?? "").trim().split("\n").slice(-1)[0] ?? ""}`;
  return null;
}

/**
 * Every registered generator must be at the head. Each due fixture (its inputs changed): the base's committed copy
 * is put where an in-place generator would read it, the head's generator writes into a temp folder, the head tree's
 * copy is restored, and diff -r compares the output with the head's committed copy (extracted from git).
 */
function fixtures(repo: string, mergeBase: string, head: string, at: string, due: readonly GeneratedFixture[], config: ReviewConfig, step: StepFn, fail: FailFn): void {
  const started = Date.now();
  let ok = true;
  const present = (item: GeneratedFixture) => {
    if (existsSync(join(at, item.generator))) return true;
    const had = run(["git", "cat-file", "-e", `${mergeBase}:${item.generator}`], repo).exit === 0;
    fail("fixture.generator-missing", item.id, `${item.generator} is registered but not at the head${had ? "; the merge base has it, so this change deleted it" : ""}`);
    ok = false;
    return false;
  };
  const ready = config.fixtures.filter(present).filter(item => due.includes(item));
  const done: string[] = [];
  for (const item of ready) {
    const work = scratch("clossys-review-fixture-");
    const out = join(work, "out"), committed = join(work, "committed");
    const inTree = join(at, item.fixture);
    try {
      let staged: string | null = null;
      if (run(["git", "cat-file", "-e", `${mergeBase}:${item.fixture}`], repo).exit === 0) {
        rmSync(inTree, { recursive: true, force: true });
        staged = extract(repo, mergeBase, item.fixture, at);
      }
      const result = staged ? undefined : run(["node", item.generator.slice(item.cwd === "." ? 0 : item.cwd.length + 1), ...item.args.map(arg => arg.replace("{out}", out))], join(at, item.cwd), { timeoutMs: config.timeoutMs });
      rmSync(inTree, { recursive: true, force: true });
      git(at, ["checkout", "HEAD", "--", item.fixture]);
      if (staged) { ok = false; fail("fixture.extract", item.id, `base copy: ${staged}`); continue; }
      if (result!.exit) { ok = false; fail("fixture.generate", item.id, failed(result!, 1)); continue; }
      for (const mark of item.outputMarks) rmSync(join(out, mark), { force: true });
      const copied = extract(repo, head, item.fixture, committed);
      if (copied) { ok = false; fail("fixture.extract", item.id, `head copy: ${copied}`); continue; }
      const diff = run(["diff", "-r", out, join(committed, item.fixture)], at);
      if (diff.exit) { ok = false; fail("fixture.drift", item.fixture, diff.output.split("\n").slice(0, 12).join("\n").split(out).join("<regenerated>").split(join(committed, item.fixture)).join("<head>")); }
      done.push(item.id);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const detail = [done.length ? `regenerated ${done.join(", ")}` : "", due.length ? "" : "no generated fixture's inputs changed"].filter(Boolean).join("; ");
  step("fixtures", ok ? (done.length ? "pass" : "skip") : "fail", detail || "nothing regenerated", Date.now() - started);
}

/** The packet's commands parsed again, its receipt held to them and re-run at the head. */
function receipt(packet: string, explicit: string | undefined, head: string, at: string, timeoutMs: number, step: StepFn, fail: FailFn, findings: Finding[]): void {
  let expected;
  try { expected = parsePacket(readFileSync(packet, "utf8"), packet); }
  catch (error) { fail("receipt.packet", packet, `cannot parse the packet: ${(error as Error).message}`); step("receipt", "fail", "packet unreadable"); return; }
  const file = receiptFileFor(packet, explicit);
  if (!file) { fail("receipt.missing", packet, `no receipt.json${explicit ? ` at ${explicit}` : " for the packet"}; run clossys receipt --packet`); step("receipt", "fail", "missing"); return; }
  let recorded;
  try { recorded = readReceipt(file); }
  catch (error) { fail("receipt.missing", file, (error as Error).message); step("receipt", "fail", "unreadable"); return; }
  const found = compareReceipt(recorded, expected, head, at, timeoutMs);
  findings.push(...found);
  step("receipt", found.length ? "fail" : "pass", `${expected.commands.length} packet command(s), ${found.length} finding(s)`);
}

function mutation(repo: string, mergeBase: string, head: string, at: string, files: readonly string[], bySource: Map<string, string[]>, red: Set<string>, seed: string, cap: number, timeoutMs: number, out: MutantResult[], step: StepFn, findings: Finding[]): void {
  const started = Date.now();
  const candidates = files.filter(file => isSource(file) && existsSync(join(at, file)))
    .flatMap(file => fileMutants(file, readFileSync(join(at, file), "utf8"), headHunks(repo, mergeBase, head, file)));
  const chosen = selectMutants(candidates, seed, cap);
  for (const mutant of chosen) {
    // Only the covering tests green at the head can kill a mutant; a red one says nothing about it.
    const all = bySource.get(mutant.file) ?? [], covering = all.filter(test => !red.has(test));
    const base = { id: mutant.id, file: mutant.file, line: mutant.line, operator: mutant.operator, from: mutant.from.trim(), to: mutant.to.trim() };
    if (!covering.length) { out.push({ ...base, status: "uncovered", ...(all.length ? { by: "every covering test is red at the head" } : {}) }); continue; }
    const path = join(at, mutant.file), original = readFileSync(path, "utf8");
    let result: MutantResult = { ...base, status: "survived" };
    try {
      writeFileSync(path, applyMutant(original, mutant));
      for (const test of covering) {
        const command = testCommand(at, packageOf(at, test), test);
        const ran = run(command.argv, command.cwd, { timeoutMs });
        if (ran.exit) { result = { ...base, status: COMPILE_ERROR.test(ran.output) ? "invalid" : "killed", by: test }; break; }
      }
    } finally {
      writeFileSync(path, original);
    }
    if (readFileSync(path, "utf8") !== original) throw new Error(`${mutant.file}: could not restore after ${mutant.id}`);
    out.push(result);
    if (result.status === "survived") findings.push({ id: "mutation.survived", level: "note", subject: mutant.id, detail: `${base.from} -> ${base.to}` });
  }
  const tally = (status: MutantResult["status"]) => out.filter(item => item.status === status).length;
  step("mutation", chosen.length ? "pass" : "skip", `${chosen.length}/${candidates.length} mutant(s): ${tally("killed")} killed, ${tally("survived")} survived, ${tally("invalid")} invalid, ${tally("uncovered")} uncovered`, Date.now() - started);
}

/** The text report: steps, counts, mutants, findings, then the verdict line. */
export function formatReview(report: ReviewReport): string {
  const lines = [`clossys review ${report.base.slice(0, 9)}...${report.head.slice(0, 9)}`, `changed: ${report.changed.files.length} file(s) in ${report.changed.packages.join(", ") || "(none)"}`, "steps:"];
  for (const item of report.steps) lines.push(`  ${item.step.padEnd(10)} ${item.status.padEnd(4)} ${item.detail}${item.ms ? ` [${Math.round(item.ms / 1000)}s]` : ""}`);
  const increased = Object.entries(report.counts).filter(([, value]) => value.base !== null && value.head! > value.base);
  lines.push(`counts: ${Object.keys(report.counts).length} rule count(s), ${increased.length} increased`);
  for (const [key, value] of Object.entries(report.counts)) if (value.base !== value.head) lines.push(`  ${key}: ${value.base ?? "?"} -> ${value.head ?? "?"}`);
  lines.push(`mutants: ${report.mutants.length}`);
  for (const mutant of report.mutants) lines.push(`  ${mutant.status.padEnd(9)} ${mutant.id}${mutant.by ? ` by ${mutant.by}` : ""}`);
  lines.push(`ran: ${report.ran.commands} command(s), ${report.ran.missing.length} missing (exit 127)`);
  lines.push(`red: ${report.newRed.length} new, ${report.baseRed.length} base-red`);
  for (const id of report.newRed) lines.push(`  new red  ${id}`);
  for (const id of report.baseRed) lines.push(`  base-red ${id}`);
  lines.push(`findings: ${report.findings.length}`);
  for (const finding of report.findings) lines.push(`  ${finding.level === "fail" ? "FAIL" : "note"} ${finding.id} ${finding.subject}: ${finding.detail.split("\n").join("\n      ")}`);
  lines.push(report.line);
  return lines.join("\n");
}
