/**
 * `clossys review <base> <head>`: everything a reviewer re-ran by hand, as one deterministic run in a temporary
 * detached worktree of head. The steps (REVIEW_STEPS) and their fail rules are docs/review.md; the report ends with
 * `MECHANICAL: PASS|FAIL <head-sha> <tree-sha>` and the findings list. A model reviewer reads that report plus the
 * doc truth and the packet's scope, and re-runs nothing.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { changedFiles, forbiddenFindings, headHunks, packageOf } from "./changes.js";
import { FOUNDRY_CONFIG, type GeneratedFixture, type ReviewConfig } from "./config.js";
import { addWorktree, exitText, git, run, scratch, type RunResult, type Worktree } from "./exec.js";
import { buildSet, coveringTests, isSource, testCommand } from "./graph.js";
import { applyMutant, COMPILE_ERROR, fileMutants, MUTANT_CAP, selectMutants } from "./mutate.js";
import { compareReceipt, parsePacket, readReceipt, receiptFileFor } from "./receipt.js";
import type { Finding, MutantResult, ReviewReport, StepResult, StepStatus } from "./types.js";

export const REVIEW_SCHEMA = "clossys.review/1";

/** The steps in run order, each with the finding id it raises and when it fails (docs/review.md). */
export const REVIEW_STEPS: readonly { readonly step: string; readonly finding: string; readonly fails: string }[] = [
  { step: "changed", finding: "-", fails: "never: the files and packages of git diff --name-status base...head" },
  { step: "forbidden", finding: "forbidden.*", fails: "any forbidden path below" },
  { step: "leak-scan", finding: "leak-scan", fails: "the merge base's public-safety script, run unchanged against the head tree, exits non-zero, or the merge base has no such script (its output is never stored or printed)" },
  { step: "install", finding: "install", fails: "the install in the head tree (and the base tree, for the counts) exits non-zero" },
  { step: "build", finding: "build", fails: "a build of a changed package, a probe or fixture package, or a prerequisite exits non-zero; each package builds once, dependencies first" },
  { step: "types", finding: "types", fails: "the typecheck of a changed workspace package with a tsconfig.json exits non-zero" },
  { step: "tests", finding: "tests / test.uncovered", fails: "a covering test file exits non-zero run on its own, or a changed source file has no covering test" },
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
  readonly log?: (line: string) => void;
}

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

  const forbidden = forbiddenFindings(repo, base, head, changes);
  findings.push(...forbidden);
  const trees: Worktree[] = [];
  let baseWorktree: Worktree | undefined;
  /** The merge base's tree, made once on first use (leak scan, counts). */
  const baseAt = () => { if (!baseWorktree) { baseWorktree = addWorktree(repo, mergeBase, "base"); trees.push(baseWorktree); } return baseWorktree.dir; };
  let packages: string[] = [];
  try {
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
      const red = tests(at, covering.all, covering.uncovered, step, fail, config.timeoutMs);
      if (counting && built) countDeltas(repo, mergeBase, at, baseAt, config, counts, step, fail);
      else step("counts", "skip", counting ? "the head build failed" : "no probes or no changes");
      fixtures(repo, mergeBase, head, at, due, config, step, fail);
      const e2e = config.e2e && packages.some(pkg => config.e2e!.packages.includes(pkg));
      if (e2e) { const result = run(config.e2e!.argv, at, { timeoutMs: config.timeoutMs }); step("e2e", result.exit ? "fail" : "pass", exitText(result), result.ms); if (result.exit) fail("e2e", config.e2e!.argv.join(" "), failed(result, 1)); }
      else step("e2e", "skip", "no e2e package changed");
      if (options.packet) receipt(resolve(options.packet), options.receipt, head, at, config.timeoutMs, step, fail, findings);
      else step("receipt", "skip", "no --packet");
      mutation(repo, mergeBase, head, at, files, covering.bySource, red, options.seed ?? "0", options.cap ?? MUTANT_CAP, config.timeoutMs, mutants, step, findings);
    }
  } finally {
    for (const item of trees) item.remove();
  }
  const verdict = findings.some(finding => finding.level === "fail") ? "FAIL" : "PASS";
  return { schema: REVIEW_SCHEMA, base, head, tree, changed: { files, packages }, steps, counts, mutants, findings, verdict };
}

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

/** Each covering test file on its own, and a finding for each changed source no test covers; returns the red tests. */
function tests(at: string, files: readonly string[], uncovered: readonly string[], step: StepFn, fail: FailFn, timeoutMs: number): Set<string> {
  const red = new Set<string>();
  let ms = 0;
  for (const file of files) {
    const command = testCommand(at, packageOf(at, file), file);
    const result = run(command.argv, command.cwd, { timeoutMs });
    ms += result.ms;
    if (result.exit) { red.add(file); fail("tests", file, failed(result, 1)); }
  }
  for (const source of uncovered) fail("test.uncovered", source, "changed, and no test file reaches it through the import graph");
  const status = red.size || uncovered.length ? "fail" : files.length ? "pass" : "skip";
  step("tests", status, `${files.length - red.size}/${files.length} file(s) green, ${uncovered.length} changed source(s) uncovered`, ms);
  return red;
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
  lines.push(`findings: ${report.findings.length}`);
  for (const finding of report.findings) lines.push(`  ${finding.level === "fail" ? "FAIL" : "note"} ${finding.id} ${finding.subject}: ${finding.detail.split("\n").join("\n      ")}`);
  lines.push(`MECHANICAL: ${report.verdict} ${report.head} ${report.tree}`);
  return lines.join("\n");
}
