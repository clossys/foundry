/**
 * `clossys heal` (and this package's own `node dist/loop/incidents/bin.js`): the incident loop's verbs.
 *
 *   heal <record.json> [--causes <file>] [--base <rev>] [--no-write]
 *       match one incident record; run its remedy and re-run the step once, or print the owner and
 *       blocker, or print NEW-CAUSE <signature>. Writes <record>.outcome.json beside the record.
 *   heal --report [--records <dir>] [--causes <file>] [--since <iso>] [--until <iso>] [--json]
 *       count records per cause; REPEAT <cause> guard=<rule> (exit 1) for a guarded cause that came back.
 *   heal run --stage <stage> [--dir <dir>] -- <command ...>
 *       run a command; when it fails, write its incident record into <dir>.
 *   heal check [--root <repo>] [--causes <file>] [--registry <file>] [--records <dir>]
 *              [--packet <file>] [--reds <file>] [--fold <file>] [--spawner <module>]
 *       the guard check. With no input flag it checks this repository: causes against the rule
 *       registry, the report over the recorded fixtures, the fixture spawner, and the guard samples.
 *
 * Exit 0 clean or healed, 1 a finding (or not healed), 2 a usage or read error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { causeFindings, readCauses, readRegistryRules } from "./causes.js";
import { foldPlanFindings, packetFindings, probeSpawner, redFindings, type GuardFinding } from "./guards.js";
import { heal } from "./heal.js";
import { REMEDIES, type HealEnv, type ProcessRow } from "./remedies.js";
import { healReport } from "./report.js";
import { incidentRecord, recordFindings } from "./signature.js";
import { runInGroup, signalGroup, waitGroupGone } from "./spawn-fixture.js";
import type { IncidentRecord, RunResult } from "./types.js";

/** This package's root: dist/loop/incidents (or src/loop/incidents) is three levels down. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** The data that ships in src/: causes, recorded fixtures and guard samples. */
export const DATA_DIR = join(PACKAGE_ROOT, "src", "loop", "incidents");
export const DEFAULT_CAUSES = join(DATA_DIR, "causes.json");
export const DEFAULT_RECORDS = join(DATA_DIR, "records");
export const SAMPLES_DIR = join(DATA_DIR, "samples");
/** The spawner the repository's fixtures use, as built. */
export const DEFAULT_SPAWNER = join(PACKAGE_ROOT, "dist", "loop", "incidents", "spawn-fixture.js");
export const REGISTRY_PATH = join("scripts", "rules", "registry.json");

export const HEAL_USAGE = `Usage: clossys heal <record.json> [--causes <file>] [--base <rev>] [--no-write]
       clossys heal --report [--records <dir>] [--causes <file>] [--since <iso>] [--until <iso>] [--json]
       clossys heal run --stage <stage> [--dir <dir>] -- <command ...>
       clossys heal check [--root <repo>] [--causes <file>] [--registry <file>] [--records <dir>]
                          [--packet <file>] [--reds <file>] [--fold <file>] [--spawner <module>]
Matches a failure to a known cause and fixes it with no model; NEW-CAUSE <signature> when no cause matches.
Exit 0 clean or healed, 1 a finding or not healed, 2 a usage or read error.`;

export interface CliOutcome {
  readonly exit: 0 | 1 | 2;
  readonly out: string;
}

class UsageError extends Error {}

function options(argv: readonly string[], valued: readonly string[], flags: readonly string[]): { values: Map<string, string>; flags: Set<string>; positional: string[] } {
  const values = new Map<string, string>(), set = new Set<string>(), positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (valued.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      values.set(arg, value);
    } else if (flags.includes(arg)) set.add(arg);
    else if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}`);
    else positional.push(arg);
  }
  return { values, flags: set, positional };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Every incident record in a directory (outcome files and other JSON are skipped). */
export function readRecords(dir: string): IncidentRecord[] {
  if (!existsSync(dir)) return [];
  const out: IncidentRecord[] = [];
  for (const name of readdirSync(dir).filter(file => file.endsWith(".json") && !file.endsWith(".outcome.json")).sort()) {
    const value = readJson(join(dir, name));
    const findings = recordFindings(value);
    if (findings.length) throw new UsageError(`${join(dir, name)}: ${findings.join("; ")}`);
    out.push(value as IncidentRecord);
  }
  return out;
}

function listProcesses(): ProcessRow[] {
  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,pgid=,args="], { encoding: "utf8" });
  if (ps.status !== 0) return [];
  return ps.stdout.split("\n").map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), args: match[4]! }));
}

/**
 * Runs a command on the base revision in a temporary worktree beside the checkout, with the same
 * environment object and the checkout's own node_modules linked in: the head and the base differ only
 * in their tracked files. A checkout without node_modules cannot give the base a loadable tree, and
 * says so (exit 2) instead of measuring a tree that cannot load.
 */
async function runOnBaseWorktree(command: string, options: { base: string; cwd: string; env: NodeJS.ProcessEnv }): Promise<RunResult> {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: options.cwd, encoding: "utf8" });
  if (top.status !== 0) return { exit: 2, output: `heal: ${options.cwd} is not a git checkout; no base to compare with` };
  const repo = top.stdout.trim();
  const modules = join(repo, "node_modules");
  if (!existsSync(modules)) return { exit: 2, output: `heal: ${repo} has no node_modules to link into the base tree` };
  const tree = join(mkdtempSync(join(tmpdir(), "heal-base-")), "tree");
  const add = spawnSync("git", ["worktree", "add", "--detach", tree, options.base], { cwd: repo, encoding: "utf8" });
  if (add.status !== 0) return { exit: 2, output: `heal: git worktree add ${options.base} failed: ${add.stderr.trim()}` };
  try {
    symlinkSync(modules, join(tree, "node_modules"), "dir");
    const relative = options.cwd.startsWith(repo) ? options.cwd.slice(repo.length) : "";
    return await runInGroup(command, { cwd: join(tree, relative), env: options.env });
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: repo, encoding: "utf8" });
  }
}

/** The real environment: commands run in their own process group, which ends with them. */
export function systemEnv(cwd: string, base: string): HealEnv {
  const env = { ...process.env };
  return {
    cwd, env, base,
    run: (command, options) => runInGroup(command, options),
    runOnBase: runOnBaseWorktree,
    processes: async () => listProcesses(),
    killGroup: async pgid => {
      signalGroup(pgid, "SIGTERM");
      if (!(await waitGroupGone(pgid, 2_000))) signalGroup(pgid, "SIGKILL");
    },
  };
}

async function runHeal(argv: readonly string[], cwd: string, env?: HealEnv): Promise<CliOutcome> {
  const parsed = options(argv, ["--causes", "--base"], ["--no-write"]);
  if (parsed.positional.length !== 1) throw new UsageError("heal takes exactly one record file");
  const path = resolve(cwd, parsed.positional[0]!);
  const value = readJson(path);
  const findings = recordFindings(value);
  if (findings.length) throw new UsageError(`${path}: ${findings.join("; ")}`);
  const causes = readCauses(resolve(cwd, parsed.values.get("--causes") ?? DEFAULT_CAUSES)).causes;
  const result = await heal(value as IncidentRecord, { causes, env: env ?? systemEnv(cwd, parsed.values.get("--base") ?? "origin/main") });
  if (!parsed.flags.has("--no-write")) writeFileSync(path.replace(/\.json$/, "") + ".outcome.json", JSON.stringify(result.record, null, 2) + "\n");
  return { exit: result.exit, out: result.lines.join("\n") };
}

function runReport(argv: readonly string[], cwd: string): CliOutcome {
  const parsed = options(argv, ["--records", "--causes", "--since", "--until"], ["--report", "--json"]);
  if (parsed.positional.length) throw new UsageError(`heal --report takes no record file`);
  for (const key of ["--since", "--until"]) {
    const value = parsed.values.get(key);
    if (value !== undefined && Number.isNaN(Date.parse(value))) throw new UsageError(`${key} must be an ISO 8601 time`);
  }
  const records = readRecords(resolve(cwd, parsed.values.get("--records") ?? DEFAULT_RECORDS));
  const causes = readCauses(resolve(cwd, parsed.values.get("--causes") ?? DEFAULT_CAUSES)).causes;
  const report = healReport(records, causes, { since: parsed.values.get("--since"), until: parsed.values.get("--until") });
  return { exit: report.exit, out: parsed.flags.has("--json") ? JSON.stringify(report, null, 2) : report.lines.join("\n") };
}

async function runRecordCommand(argv: readonly string[], cwd: string): Promise<CliOutcome> {
  const split = argv.indexOf("--");
  if (split < 0 || split === argv.length - 1) throw new UsageError("heal run needs -- <command ...>");
  const parsed = options(argv.slice(0, split), ["--stage", "--dir"], []);
  const stage = parsed.values.get("--stage");
  if (!stage) throw new UsageError("heal run needs --stage <stage>");
  const command = argv.slice(split + 1).join(" ");
  const result = await runInGroup(command, { cwd, env: { ...process.env } });
  if (result.exit === 0) return { exit: 0, out: result.output.trimEnd() };
  const record = incidentRecord({ stage, command, exit: result.exit, output: result.output });
  const dir = resolve(cwd, parsed.values.get("--dir") ?? join("node_modules", ".cache", "incidents"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${record.at.replace(/[:.]/g, "-")}-${stage.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { exit: 1, out: `${result.output.trimEnd()}\nINCIDENT ${stage} exit ${result.exit}: recorded ${basename(file)} in ${parsed.values.get("--dir") ?? "node_modules/.cache/incidents"}; next: clossys heal <record>` };
}

const guardLines = (findings: readonly GuardFinding[]) => findings.map(finding => `${finding.guard}\t${finding.message}`);

async function runCheck(argv: readonly string[], cwd: string): Promise<CliOutcome> {
  const parsed = options(argv, ["--root", "--causes", "--registry", "--records", "--packet", "--reds", "--fold", "--spawner"], []);
  if (parsed.positional.length) throw new UsageError("heal check takes no positional argument");
  const given = (key: string) => parsed.values.has(key);
  const path = (key: string) => resolve(cwd, parsed.values.get(key)!);
  const whole = !["--causes", "--records", "--packet", "--reds", "--fold", "--spawner"].some(given);
  const root = resolve(cwd, parsed.values.get("--root") ?? resolve(PACKAGE_ROOT, "..", ".."));
  const lines: string[] = [];
  let failed = false;
  const section = (name: string, findings: readonly string[]) => {
    lines.push(`${findings.length ? "FAIL" : "ok"}  ${name}${findings.length ? `: ${findings.length} finding(s)` : ""}`);
    lines.push(...findings.map(line => `  ${line}`));
    if (findings.length) failed = true;
  };

  if (whole || given("--causes")) {
    const causesPath = given("--causes") ? path("--causes") : DEFAULT_CAUSES;
    const registryPath = given("--registry") ? path("--registry") : join(root, REGISTRY_PATH);
    if (!existsSync(registryPath)) throw new UsageError(`no rule registry at ${registryPath}; pass --registry`);
    const owners = (agent: string) => existsSync(join(root, "packages", agent, "package.json"));
    section(`causes ${basename(causesPath)}: every cause is guarded by an enforced rule`, causeFindings(readJson(causesPath), readRegistryRules(registryPath), Object.keys(REMEDIES), { owners }));
  }
  if (whole || given("--records")) {
    const report = healReport(readRecords(given("--records") ? path("--records") : DEFAULT_RECORDS), readCauses(DEFAULT_CAUSES).causes);
    section("report: no guarded cause came back after its guard landed", report.repeats.map(repeat => `REPEAT ${repeat.cause} guard=${repeat.guard} at=${repeat.at} \`${repeat.command}\``));
  }
  if (whole || given("--packet")) section("packet: one expectation per command, root check base-relative", guardLines(packetFindings(readFileSync(given("--packet") ? path("--packet") : join(SAMPLES_DIR, "packet.md"), "utf8"))));
  if (whole || given("--reds")) section("reds: a new red failed alone and passed on the base", guardLines(redFindings(readJson(given("--reds") ? path("--reds") : join(SAMPLES_DIR, "reds.json")) as never)));
  if (whole || given("--fold")) section("fold: every compared branch is fetched first", guardLines(foldPlanFindings(readJson(given("--fold") ? path("--fold") : join(SAMPLES_DIR, "fold.json")) as never)));
  if (whole || given("--spawner")) {
    const spawner = given("--spawner") ? path("--spawner") : DEFAULT_SPAWNER;
    if (!existsSync(spawner)) throw new UsageError(`no spawner module at ${spawner} (build @clossys/controller first)`);
    section("spawner: no child survives teardown", guardLines(await probeSpawner(spawner, { label: relative(cwd, spawner) || spawner })));
  }
  lines.push(`check:heal: ${failed ? "FAIL" : "PASS"}`);
  return { exit: failed ? 1 : 0, out: lines.join("\n") };
}

/** The verb's entry. `env` replaces the real environment (tests). */
export async function healMain(argv: readonly string[], cwd: string = process.cwd(), env?: HealEnv): Promise<CliOutcome> {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { exit: argv.length === 0 ? 2 : 0, out: HEAL_USAGE };
    if (argv[0] === "run") return await runRecordCommand(argv.slice(1), cwd);
    if (argv[0] === "check") return await runCheck(argv.slice(1), cwd);
    if (argv.includes("--report")) return runReport(argv, cwd);
    return await runHeal(argv, cwd, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exit: 2, out: `heal: ${message}${error instanceof UsageError ? `\n${HEAL_USAGE}` : ""}` };
  }
}
