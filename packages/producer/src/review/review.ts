/**
 * `clossys review <base> <head>`: everything a reviewer re-ran by hand, as one deterministic run in a temporary
 * detached worktree of head. The steps (REVIEW_STEPS) and their fail rules are docs/review.md; the report ends with
 * `MECHANICAL: PASS|FAIL <head-sha> <tree-sha>` and the findings list. A model reviewer reads that report plus the
 * doc truth and the packet's scope, and re-runs nothing.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, forbiddenFindings, headHunks, packageOf } from "./changes.js";
import { FOUNDRY_CONFIG, type ReviewConfig } from "./config.js";
import { addWorktree, git, run, scratch, type Worktree } from "./exec.js";
import { buildSet, coveringTests, SOURCE_FILE, TEST_FILE, testCommand } from "./graph.js";
import { applyMutant, COMPILE_ERROR, fileMutants, MUTANT_CAP, selectMutants } from "./mutate.js";
import { compareReceipt, readReceipt, receiptFileFor } from "./receipt.js";
import type { Finding, MutantResult, ReviewReport, StepResult, StepStatus } from "./types.js";

export const REVIEW_SCHEMA = "clossys.review/1";

/** The steps in run order, each with the finding id it raises and when it fails (docs/review.md). */
export const REVIEW_STEPS: readonly { readonly step: string; readonly finding: string; readonly fails: string }[] = [
  { step: "changed", finding: "-", fails: "never: the files and packages of git diff --name-status base...head" },
  { step: "forbidden", finding: "forbidden.*", fails: "any forbidden path below" },
  { step: "install", finding: "install", fails: "the install in the head tree (and the base tree, for the counts) exits non-zero" },
  { step: "build", finding: "build", fails: "a build of a changed package or its prerequisite exits non-zero; each package builds once, dependencies first" },
  { step: "types", finding: "types", fails: "tsc --noEmit -p <package> exits non-zero for a changed workspace package with a tsconfig.json" },
  { step: "tests", finding: "tests", fails: "a touched test file, or a test importing a changed module, exits non-zero run on its own" },
  { step: "counts", finding: "count.increase / count.probe", fails: "a probe finds more of a rule at head than at the merge base, or cannot run at head" },
  { step: "fixtures", finding: "fixture.drift / fixture.generate", fails: "the head generator, run on the base copy of a generated fixture, writes anything diff -r finds in the head's committed copy" },
  { step: "e2e", finding: "e2e", fails: "clossys check --e2e exits non-zero when the producer, designer, writer or publisher package changed" },
  { step: "leak-scan", finding: "leak-scan", fails: "the repository's public-safety check exits non-zero (its output is never stored or printed)" },
  { step: "receipt", finding: "receipt.*", fails: "with --packet: the receipt is missing, names another head, was taken dirty, or a re-run differs in exit code or output tail" },
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

const npmBuild = (name: string) => ["npm", "run", "build", `--workspace=${name}`];
const lastLine = (output: string) => output.trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? "";

export function runReview(options: ReviewOptions): ReviewReport {
  const config = options.config ?? FOUNDRY_CONFIG;
  const log = options.log ?? (() => {});
  const repo = options.repo;
  const base = git(repo, ["rev-parse", "--verify", `${options.base}^{commit}`]);
  const head = git(repo, ["rev-parse", "--verify", `${options.head}^{commit}`]);
  const tree = git(repo, ["rev-parse", `${head}^{tree}`]);
  const mergeBase = git(repo, ["merge-base", base, head]);
  const changes = changedFiles(repo, base, head);
  const files = changes.map(change => change.path);
  const steps: StepResult[] = [], findings: Finding[] = [], mutants: MutantResult[] = [];
  const counts: Record<string, { base: number | null; head: number | null }> = {};
  const step = (name: string, status: StepStatus, detail: string, ms = 0) => { steps.push({ step: name, status, detail, ms }); log(`review: ${name} ${status}${detail ? ` (${detail})` : ""}`); };
  const fail = (id: string, subject: string, detail: string) => findings.push({ id, level: "fail", subject, detail });

  const forbidden = forbiddenFindings(repo, base, head, changes);
  findings.push(...forbidden);
  const trees: Worktree[] = [];
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
      const installed = install(config, at, "head", step, fail);
      const counting = config.counts.length > 0 && changes.length > 0;
      const built = installed && build(at, [...packages, ...(counting ? config.probePackages : [])], step, fail, config.timeoutMs);
      types(at, packages, step, fail, config.timeoutMs);
      const covering = coveringTests(at, files, file => packageOf(at, file));
      const red = tests(at, covering.all, step, fail, config.timeoutMs);
      if (counting && built) countDeltas(repo, mergeBase, at, config, trees, counts, step, fail);
      else step("counts", "skip", counting ? "the head build failed" : "no probes or no changes");
      fixtures(repo, mergeBase, at, files, config, step, fail, findings);
      const e2e = config.e2e && packages.some(pkg => config.e2e!.packages.includes(pkg));
      if (e2e) { const result = run(config.e2e!.argv, at, { timeoutMs: config.timeoutMs }); step("e2e", result.exit ? "fail" : "pass", `exit ${result.exit}`, result.ms); if (result.exit) fail("e2e", config.e2e!.argv.join(" "), lastLine(result.output)); }
      else step("e2e", "skip", "no e2e package changed");
      if (config.leakScan) {
        const result = run(config.leakScan, at, { timeoutMs: config.timeoutMs });
        step("leak-scan", result.exit ? "fail" : "pass", `exit ${result.exit}`, result.ms);
        if (result.exit) fail("leak-scan", config.leakScan.join(" "), `exit ${result.exit}; output withheld, run it in the checkout`);
      } else step("leak-scan", "skip", "no leak scan configured");
      if (options.packet) {
        const file = receiptFileFor(options.packet, options.receipt);
        if (!file) { fail("receipt.missing", options.packet, "no receipt.json for the packet; run clossys receipt --packet"); step("receipt", "fail", "missing"); }
        else {
          const found = compareReceipt(readReceipt(file), head, at, config.timeoutMs);
          findings.push(...found);
          step("receipt", found.length ? "fail" : "pass", `${found.length} mismatch(es)`);
        }
      } else step("receipt", "skip", "no --packet");
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

function install(config: ReviewConfig, at: string, label: string, step: StepFn, fail: FailFn): boolean {
  if (!config.install) { if (label === "head") step("install", "skip", "no install configured"); return true; }
  const result = run(config.install, at, { timeoutMs: config.timeoutMs });
  if (label === "head" || result.exit) step("install", result.exit ? "fail" : "pass", `${label}: exit ${result.exit}`, result.ms);
  if (result.exit) fail("install", `${label}: ${config.install.join(" ")}`, lastLine(result.output));
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
    if (result.exit) { ok = false; fail("build", `${label}: ${workspace.name}`, lastLine(result.output)); }
  }
  const names = order.map(item => item.name + (copied.includes(item.name) ? " (dist from head, unchanged)" : prerequisites.has(item.dir) ? " (prerequisite)" : ""));
  step("build", ok ? "pass" : "fail", `${label}: ${names.join(", ") || "nothing to build"}`, ms);
  return ok;
}

function types(at: string, packages: readonly string[], step: StepFn, fail: FailFn, timeoutMs: number): void {
  const checked: string[] = [];
  let ms = 0, ok = true;
  for (const pkg of packages) {
    if (pkg === "." || !existsSync(join(at, pkg, "tsconfig.json"))) continue;
    const result = run(["npx", "tsc", "--noEmit", "-p", pkg], at, { timeoutMs });
    ms += result.ms;
    checked.push(pkg);
    if (result.exit) { ok = false; fail("types", pkg, lastLine(result.output)); }
  }
  step("types", checked.length ? (ok ? "pass" : "fail") : "skip", checked.join(", ") || "no changed package has a tsconfig.json", ms);
}

/** Each test file on its own; returns the red ones. */
function tests(at: string, files: readonly string[], step: StepFn, fail: FailFn, timeoutMs: number): Set<string> {
  const red = new Set<string>();
  let ms = 0;
  for (const file of files) {
    const command = testCommand(at, packageOf(at, file), file);
    const result = run(command.argv, command.cwd, { timeoutMs });
    ms += result.ms;
    if (result.exit) { red.add(file); fail("tests", file, `exit ${result.exit}: ${lastLine(result.output)}`); }
  }
  step("tests", files.length ? (red.size ? "fail" : "pass") : "skip", `${files.length - red.size}/${files.length} file(s) green`, ms);
  return red;
}

function probe(config: ReviewConfig, at: string): Map<string, Record<string, number> | string> {
  const out = new Map<string, Record<string, number> | string>();
  for (const item of config.counts) {
    const result = run(item.argv, at, { timeoutMs: config.timeoutMs });
    try { out.set(item.id, item.parse(result.stdout)); }
    catch (error) { out.set(item.id, `exit ${result.exit}: ${(error as Error).message}; ${lastLine(result.output)}`); }
  }
  return out;
}

/** Rule finding counts per probe at the merge base and at head; any increase fails. */
function countDeltas(repo: string, mergeBase: string, at: string, config: ReviewConfig, trees: Worktree[], counts: Record<string, { base: number | null; head: number | null }>, step: StepFn, fail: FailFn): void {
  const started = Date.now();
  const baseTree = addWorktree(repo, mergeBase, "base");
  trees.push(baseTree);
  const treeOf = (tree: string, rev: string, dir: string) => { const result = run(["git", "rev-parse", `${rev}:${dir}`], tree); return result.exit ? "" : result.stdout.trim(); };
  const reuse: Reuse = { from: at, same: dir => { const before = treeOf(repo, mergeBase, dir); return before !== "" && before === treeOf(at, "HEAD", dir); } };
  const baseReady = install(config, baseTree.dir, "base", step, fail) && build(baseTree.dir, config.probePackages, step, (id, subject, detail) => fail("count.probe", subject, `base ${id}: ${detail}`), config.timeoutMs, "base", reuse);
  const before = baseReady ? probe(config, baseTree.dir) : new Map<string, string>(config.counts.map(item => [item.id, "base tree did not build"]));
  const after = probe(config, at);
  let increases = 0;
  for (const item of config.counts) {
    const b = before.get(item.id), h = after.get(item.id);
    if (typeof h === "string") { fail("count.probe", item.id, `head: ${h}`); continue; }
    if (typeof b === "string") fail("count.probe", item.id, `base: ${b}`);
    for (const rule of [...new Set([...Object.keys(typeof b === "object" ? b : {}), ...Object.keys(h!)])].sort()) {
      const baseCount = typeof b === "object" ? b[rule] ?? 0 : null, headCount = h![rule] ?? 0;
      counts[`${item.id}:${rule}`] = { base: baseCount, head: headCount };
      if (baseCount !== null && headCount > baseCount) { increases++; fail("count.increase", `${item.id}:${rule}`, `${baseCount} -> ${headCount}`); }
    }
  }
  step("counts", increases || [...after.values()].some(value => typeof value === "string") || !baseReady ? "fail" : "pass", `${Object.keys(counts).length} rule count(s), ${increases} increase(s)`, Date.now() - started);
}

function fixtures(repo: string, mergeBase: string, at: string, files: readonly string[], config: ReviewConfig, step: StepFn, fail: FailFn, findings: Finding[]): void {
  const started = Date.now();
  const due = config.fixtures.filter(item => files.some(file => file.startsWith(`${item.fixture}/`) || item.triggers.some(prefix => file.startsWith(prefix))));
  if (!due.length) { step("fixtures", "skip", "no generated fixture's inputs changed"); return; }
  const done: string[] = [];
  let ok = true;
  for (const item of due) {
    if (!existsSync(join(at, item.generator))) { findings.push({ id: "fixture.skipped", level: "note", subject: item.id, detail: `${item.generator} is not at the head` }); continue; }
    const out = join(scratch("clossys-review-fixture-"), "out");
    const committed = join(at, item.fixture);
    try {
      // The generator reads the fixture where it lives: put the base copy there, run, then restore the head's copy.
      rmSync(committed, { recursive: true, force: true });
      const hasBase = run(["git", "cat-file", "-e", `${mergeBase}:${item.fixture}`], repo).exit === 0;
      if (hasBase) run(`git -C '${repo}' archive --format=tar ${mergeBase} -- '${item.fixture}' | tar -x -C '${at}'`, at);
      else git(at, ["checkout", "HEAD", "--", item.fixture]);
      const result = run(["node", item.generator.slice(item.cwd === "." ? 0 : item.cwd.length + 1), ...item.args.map(arg => arg.replace("{out}", out))], join(at, item.cwd), { timeoutMs: config.timeoutMs });
      rmSync(committed, { recursive: true, force: true });
      git(at, ["checkout", "HEAD", "--", item.fixture]);
      if (result.exit) { ok = false; fail("fixture.generate", item.id, `exit ${result.exit}: ${result.output.trim().split("\n").slice(-1)[0] ?? ""}`); continue; }
      const diff = run(["diff", "-r", out, committed], at);
      if (diff.exit) { ok = false; fail("fixture.drift", item.fixture, diff.output.split("\n").slice(0, 12).join("\n").split(out).join("<regenerated>").split(at).join("<head>")); }
      done.push(item.id);
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  }
  step("fixtures", ok ? (done.length ? "pass" : "skip") : "fail", done.length ? `regenerated ${done.join(", ")}` : "generator not at the head", Date.now() - started);
}

function mutation(repo: string, mergeBase: string, head: string, at: string, files: readonly string[], bySource: Map<string, string[]>, red: Set<string>, seed: string, cap: number, timeoutMs: number, out: MutantResult[], step: StepFn, findings: Finding[]): void {
  const started = Date.now();
  const candidates = files.filter(file => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && existsSync(join(at, file)))
    .flatMap(file => fileMutants(file, readFileSync(join(at, file), "utf8"), headHunks(repo, mergeBase, head, file)));
  const chosen = selectMutants(candidates, seed, cap);
  for (const mutant of chosen) {
    const covering = bySource.get(mutant.file) ?? [];
    const base = { id: mutant.id, file: mutant.file, line: mutant.line, operator: mutant.operator, from: mutant.from.trim(), to: mutant.to.trim() };
    if (!covering.length || covering.some(test => red.has(test))) { out.push({ ...base, status: "uncovered", ...(covering.length ? { by: "a covering test is red at the head" } : {}) }); continue; }
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
