/**
 * `clossys unit next <unit> [--step <step>] [--dry-run]` (CP1-UNITNEXT): the Planner runs only the next legal
 * step of a unit and refuses the rest. This is the producer verb over the controller loop's pure adapter
 * (`unitNext` in @clossys/controller/loop, owner rules R-UNIT-STEP-ORDER and R-UNIT-WIP): it reads the unit's
 * records and the git facts around it, and prints the unit's state, the one next legal step, every failed
 * precondition (named), and one fixed-form `NEXT:` verdict line. Nothing here runs a step or starts a session.
 *
 * A unit's records live in one directory, `<records>/<unit>/`:
 *   exec.md      the executor's receipt; its verdict line is `DONE: <sha>` or `BLOCKED: <reason>`
 *   fast.json    the `clossys check --fast --json` record (or fast.txt, ending `FAST PASS|FAIL|INCOMPLETE <sha>`)
 *   mech.json    the `clossys review --json` record (its verdict, head and the base it ran against)
 *   review.md    the reviewer's verdict file, ending `REVIEW: PASS|FAIL <sha>`
 *   checks.json  queued, running and finished checks: [{ id, step, head, status }]
 *   carry.md     present while a carry onto the unit is pending
 * A record with no verdict line counts as a failed step. `<records>/config.json` may set `wipCap` (default 4)
 * and `integration` (the integration ref). Rebase and fold are read from git: the tip in the head, the head
 * in the tip.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CHECK_STATUSES, markSuperseded, nextVerdictLine, parseStepVerdict, RECORDED_STEPS, unitNext, UNIT_STEPS, UNIT_WIP_CAP_DEFAULT, validateLoopState,
  type LoopState, type RecordedStep, type StepRecord, type UnitCheck, type UnitFacts, type UnitNext, type UnitStep,
} from "@clossys/controller/loop";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

export const NEXT_USAGE_LINES = [
  "       clossys unit next <unit> [--step <step>] [--head <sha>] [--dry-run] [--records <dir>] [--integration <ref>] [--branch <branch>]",
  "                         [--wip-cap <n>] [--facts <facts.json>] [--root <repo>] [--state <loop.json>] [--json]",
  "  next   reads the unit's receipts and verdict records and prints its state and the one next legal step (R-UNIT-STEP-ORDER):",
  "         exec, rebase onto the integration tip, check --fast, mech, review, fold. A step past exec needs an installed tree,",
  "         the head rebased onto the current tip, the head unchanged since the last verdict and no carry pending; a failed",
  "         precondition is refused and named. A new unit is pulled only while fewer than the WIP cap (default 4) units are",
  "         past exec and not folded (R-UNIT-WIP). A head change marks the unit's queued and running checks superseded, and",
  "         they are not counted. --step asks whether that step may run now; --head refuses when the head moved from it.",
  "         It ends with one line: NEXT: <unit> <state> <next> <head> [<step>] OK|REFUSED <preconditions>. --dry-run writes",
  "         nothing; without it the superseded marks are written to checks.json.",
  "  --records  the unit records (default: <root>/clossys/.state/planner/units)",
  "  --facts    a JSON object { <unit>: { head, tip, tipInHead, headInTip, installed, carryPending, launched } } read in",
  "             place of git, the install and the launch log for the units it names (fixtures and dry runs)",
];

export const RECORDS_PATH = "clossys/.state/planner/units";
const LOOP_STATE_PATH = "clossys/.state/planner/loop.json";

/** What `next` reads from git; tests pass a fake. */
export interface NextGit {
  /** The commit a ref names, or null. */
  readonly resolve: (root: string, ref: string) => string | null;
  /** Whether `ancestor` is an ancestor of (or is) `descendant`. */
  readonly isAncestor: (root: string, ancestor: string, descendant: string) => boolean;
}

const git = (root: string, args: readonly string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
export const NEXT_GIT: NextGit = {
  resolve: (root, ref) => { const out = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); return out.status === 0 && out.stdout.trim() ? out.stdout.trim() : null; },
  isAncestor: (root, ancestor, descendant) => git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0,
};

class NextReadError extends Error {}

interface Options { positional: string[]; set: Set<string>; given: Map<string, string> }
function options(argv: readonly string[], usage: string): Options {
  const flags = ["--json", "--dry-run"], values = ["--root", "--state", "--records", "--integration", "--branch", "--wip-cap", "--facts", "--step", "--head"];
  const positional: string[] = [], set = new Set<string>(), given = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.includes(arg)) { set.add(arg); continue; }
    if (values.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${usage}`);
      given.set(arg, value);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${usage}`);
    positional.push(arg);
  }
  return { positional, set, given };
}

const readJson = (path: string, what: string): unknown => {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (error) { throw new NextReadError(`cannot read the ${what} at ${path}: ${(error as Error).message}`); }
  try { return JSON.parse(text); } catch { throw new NextReadError(`the ${what} at ${path} is not JSON`); }
};

function loadLaunches(path: string): LoopState | null {
  if (!existsSync(path)) return null;
  const doc = readJson(path, "loop state");
  const findings = validateLoopState(doc);
  if (findings.length) throw new NextReadError(`the loop state at ${path} is malformed: ${findings.map(item => `${item.path}: ${item.message}`).join("; ")}`);
  return doc as LoopState;
}

/** The unit's step records: each present file, with its verdict or none. */
function loadRecords(dir: string): Partial<Record<RecordedStep, StepRecord>> {
  const names: Record<RecordedStep, readonly string[]> = { exec: ["exec.md"], fast: ["fast.json", "fast.txt"], mech: ["mech.json"], review: ["review.md"] };
  const records: Partial<Record<RecordedStep, StepRecord>> = {};
  for (const step of RECORDED_STEPS) {
    const file = names[step].map(name => join(dir, name)).find(path => existsSync(path));
    if (file) records[step] = { verdict: parseStepVerdict(step, readFileSync(file, "utf8")) };
  }
  return records;
}

function loadChecks(path: string): UnitCheck[] {
  if (!existsSync(path)) return [];
  const doc = readJson(path, "checks");
  const ok = (item: unknown): item is UnitCheck => {
    const row = item as Record<string, unknown>;
    return typeof row === "object" && row !== null && typeof row.id === "string" && typeof row.head === "string"
      && (UNIT_STEPS as readonly string[]).includes(row.step as string) && (CHECK_STATUSES as readonly string[]).includes(row.status as string);
  };
  if (!Array.isArray(doc) || !doc.every(ok)) throw new NextReadError(`the checks at ${path} must be a list of { id, step, head, status } with status one of ${CHECK_STATUSES.join(", ")}`);
  return doc;
}

interface Config { wipCap: number; integration: string | null }
function loadConfig(records: string, opts: Options, usage: string): Config {
  const path = join(records, "config.json");
  const doc = existsSync(path) ? (readJson(path, "records config") as Record<string, unknown>) : {};
  const cap = opts.given.get("--wip-cap") ?? doc.wipCap ?? UNIT_WIP_CAP_DEFAULT;
  const wipCap = Number(cap);
  if (!Number.isInteger(wipCap) || wipCap < 1) throw new CliUsageError(`the WIP cap must be a whole number of at least 1, not ${JSON.stringify(cap)}\n${usage}`);
  const integration = opts.given.get("--integration") ?? (typeof doc.integration === "string" ? doc.integration : null);
  return { wipCap, integration };
}

interface Context { root: string; records: string; launches: LoopState | null; overrides: Record<string, Partial<UnitFacts>>; config: Config; git: NextGit; branch: string | null; branchUnit: string }

function factsOf(unit: string, context: Context): UnitFacts {
  const given = context.overrides[unit];
  const dir = join(context.records, unit);
  const runs = context.launches?.units?.[unit] ?? [];
  const launched = given?.launched ?? runs.length > 0;
  const carryPending = given?.carryPending ?? existsSync(join(dir, "carry.md"));
  const installed = given?.installed ?? existsSync(join(context.root, "node_modules", ".package-lock.json"));
  if (given && typeof given.tip === "string" && typeof given.tipInHead === "boolean" && typeof given.headInTip === "boolean" && given.head !== undefined) {
    return { unit, head: given.head, tip: given.tip, tipInHead: given.tipInHead, headInTip: given.headInTip, installed, carryPending, launched };
  }
  if (!context.config.integration) throw new NextReadError(`no integration ref: pass --integration <ref> or set "integration" in ${join(context.records, "config.json")}`);
  const tip = context.git.resolve(context.root, context.config.integration);
  if (!tip) throw new NextReadError(`the integration ref ${context.config.integration} names no commit; fetch it first`);
  const branch = (unit === context.branchUnit ? context.branch : null) ?? runs.at(-1)?.branch ?? null;
  const head = branch ? context.git.resolve(context.root, `refs/remotes/origin/${branch}`) ?? context.git.resolve(context.root, branch) : null;
  return {
    unit, head, tip, launched, carryPending, installed,
    tipInHead: head !== null && context.git.isAncestor(context.root, tip, head),
    headInTip: head !== null && context.git.isAncestor(context.root, head, tip),
  };
}

/** Every other unit in the records directory that is past exec and not folded. */
function pastExecOthers(unit: string, context: Context): string[] {
  if (!existsSync(context.records)) return [];
  const others = readdirSync(context.records).filter(name => name !== unit && statSync(join(context.records, name)).isDirectory()).sort();
  return others.filter(other => unitNext(factsOf(other, context), loadRecords(join(context.records, other))).pastExec);
}

function render(result: UnitNext, facts: UnitFacts, asked: UnitStep | undefined, extra: { cap: number; pastExec: number; wrote: boolean }): string {
  return [
    `unit: ${result.unit}`,
    `state: ${result.state}`,
    `next: ${result.next ?? "none"} (${result.reason})`,
    `head: ${facts.head ?? "(none)"}; integration tip: ${facts.tip}`,
    ...result.holding.map(item => `holds: ${item.step} ${item.line}`),
    `wip: ${extra.pastExec} other unit(s) past exec and not folded, cap ${extra.cap}`,
    ...result.superseded.map(check => `superseded: ${check.id} (${check.step} at ${check.head})${extra.wrote ? "" : " (dry run: not written)"}`),
    `live checks: ${result.live.length}`,
    ...result.refused.map(item => `refused ${item.precondition} ${item.rule} (owner ${item.owner}): ${item.message}`),
    nextVerdictLine(result, facts.head, asked),
  ].join("\n");
}

export async function runNextVerb(argv: readonly string[], cwd: string, repoRoot: (cwd: string) => string, usage: string, gitDeps: NextGit = NEXT_GIT): Promise<CliResult> {
  const opts = options(argv, usage);
  if (opts.positional.length !== 1) throw new CliUsageError(`unit next needs exactly one unit id\n${usage}`);
  const unit = opts.positional[0]!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(unit)) throw new CliUsageError(`unit next: ${JSON.stringify(unit)} is not a unit id\n${usage}`);
  const askedRaw = opts.given.get("--step");
  if (askedRaw !== undefined && !(UNIT_STEPS as readonly string[]).includes(askedRaw)) throw new CliUsageError(`--step must be one of ${UNIT_STEPS.join(", ")}\n${usage}`);
  const asked = askedRaw as UnitStep | undefined;
  const root = opts.given.has("--root") ? resolve(cwd, opts.given.get("--root")!) : repoRoot(cwd);
  const records = resolve(cwd, opts.given.get("--records") ?? join(root, RECORDS_PATH));
  try {
    const overrides = opts.given.has("--facts") ? (readJson(resolve(cwd, opts.given.get("--facts")!), "facts") as Record<string, Partial<UnitFacts>>) : {};
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) throw new NextReadError("the facts file must be an object keyed by unit id");
    const context: Context = {
      root, records, overrides, git: gitDeps, branch: opts.given.get("--branch") ?? null, branchUnit: unit,
      launches: loadLaunches(resolve(cwd, opts.given.get("--state") ?? join(root, LOOP_STATE_PATH))),
      config: loadConfig(records, opts, usage),
    };
    const facts = factsOf(unit, context);
    const dir = join(records, unit);
    const checksPath = join(dir, "checks.json");
    const checks = loadChecks(checksPath);
    const pastExec = pastExecOthers(unit, context).length;
    const result = unitNext(facts, loadRecords(dir), checks, { cap: context.config.wipCap, pastExec }, asked, opts.given.get("--head"));
    const dryRun = opts.set.has("--dry-run");
    const wrote = !dryRun && result.superseded.length > 0;
    if (wrote) writeFileSync(checksPath, `${JSON.stringify(markSuperseded(checks, facts.head), null, 2)}\n`);
    const message = render(result, facts, asked, { cap: context.config.wipCap, pastExec, wrote });
    return { exitCode: result.refused.length ? 1 : 0, message, output: { ...result, facts, asked: asked ?? null, wipCap: context.config.wipCap, pastExecOthers: pastExec, wrote, verdict: nextVerdictLine(result, facts.head, asked) } };
  } catch (error) {
    if (error instanceof NextReadError) return { exitCode: 2, message: `unit next: ${error.message}` };
    throw error;
  }
}
