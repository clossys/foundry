/**
 * `clossys review plan <unit>`, `clossys review carry <cleared> <new>` and `clossys review verdict <unit>`: the review
 * budget and the clearance carry-over rule Reviewer owns (R-REVIEW-BUDGET, R-REVIEW-CARRY), run from code.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { carryClearance } from "../review/carry.js";
import { assertExactHead, exactHeadEvidence } from "../review/evidence.js";
import { git } from "../review/exec.js";
import { allowPass, classify, diffFiles, formatPlan, makeVerdict, parseVerdictLog, planReview } from "../review/plan.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

export const PLAN_USAGE = "Usage: clossys review plan <unit> --base <ref> [--head <ref>] [--mechanical <review.json>] [--verdicts <log.jsonl>] [--evidence <github.json>] [--onto <ref>] [--ask <pass>] [--root <repo>] [--json]\n"
  + "       clossys review carry <cleared> <new> [--onto <ref>] [--root <repo>] [--json]\n"
  + "       clossys review verdict <unit> --role blind|second-blind|closure-delta --head <sha> (--clear | --not-clear <reason> --severity P0|P1|P2|P3) [--blind] --log <log.jsonl> [--root <repo>] [--json]\n"
  + "  plan classifies base...head (head defaults to <unit> as a ref) as gate or non-gate from the gate lexicon and prints\n"
  + "  the next pass the budget allows: mechanical, blind, second-blind, closure-delta or none. It ends NEXT: <pass> <head>,\n"
  + "  CLEARED <head>, WAITING <head> or REFUSED <head>: <why>; --ask <pass> exits 1 unless that pass is the one allowed\n"
  + "  (a final pass never is). --mechanical is the clossys review --record of this head; --evidence a saved GitHub review\n"
  + "  snapshot, which must be complete and at the exact head. carry prints CARRY or VOID <new>: <why> (exit 0 or 1):\n"
  + "  a clearance carries only over a default-branch merge (--onto, default origin/main) and an own-path blob change voids it.\n"
  + "  verdict appends CLEAR <sha> or NOT CLEAR <sha>: <reason> with the role to the log; --blind attests that no other\n"
  + "  review file was read for the unit, and a blind or second-blind verdict without it is refused.";

function options(argv: readonly string[], flags: readonly string[], values: readonly string[]) {
  const positional: string[] = [], set = new Set<string>(), given = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.includes(arg)) { set.add(arg); continue; }
    if (values.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${PLAN_USAGE}`);
      if (given.has(arg)) throw new CliUsageError(`${arg} is given twice\n${PLAN_USAGE}`);
      given.set(arg, value);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${PLAN_USAGE}`);
    positional.push(arg);
  }
  return { positional, set, given };
}

const repoRoot = (start: string) => { try { return git(start, ["rev-parse", "--show-toplevel"]); } catch { return start; } };
const commit = (root: string, ref: string) => { try { return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); } catch { throw new CliUsageError(`no commit ${ref}\n${PLAN_USAGE}`); } };
const readJson = (file: string): unknown => {
  if (!existsSync(file)) throw new CliUsageError(`no file at ${file}`);
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new CliUsageError(`${file} is not JSON: ${(error as Error).message}`); }
};

/** The mechanical verdict a `clossys review --record` states for exactly this head, or null. */
function mechanicalAt(record: unknown, head: string): "PASS" | "FAIL" | null {
  const value = record as { schema?: unknown; head?: unknown; verdict?: unknown; line?: unknown } | null;
  if (value?.schema !== "clossys.review/1" || value.head !== head) return null;
  if (value.verdict !== "PASS" && value.verdict !== "FAIL") return null;
  return typeof value.line === "string" && value.line.startsWith(`MECHANICAL: ${value.verdict} ${head}`) ? value.verdict : null;
}

export async function runReviewPlanCli(verb: "plan" | "carry" | "verdict", argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv.includes("--help")) return { exitCode: 0, message: PLAN_USAGE };
  if (verb === "carry") {
    const { positional, set, given } = options(argv, ["--json"], ["--onto", "--root"]);
    if (positional.length !== 2) throw new CliUsageError(`review carry needs <cleared> and <new>\n${PLAN_USAGE}`);
    const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
    const onto = given.get("--onto") ?? "origin/main";
    commit(root, positional[0]!); commit(root, positional[1]!); commit(root, onto);
    const result = carryClearance(root, positional[0]!, positional[1]!, onto);
    return { exitCode: result.verdict === "CARRY" ? 0 : 1, root, message: result.line, ...(set.has("--json") ? { output: result } : {}) };
  }
  if (verb === "verdict") {
    const { positional, set, given } = options(argv, ["--json", "--clear", "--blind"], ["--role", "--head", "--not-clear", "--severity", "--log", "--root"]);
    if (positional.length !== 1) throw new CliUsageError(`review verdict needs <unit>\n${PLAN_USAGE}`);
    if (!given.has("--log") || !given.has("--role") || !given.has("--head")) throw new CliUsageError(`review verdict needs --role, --head and --log\n${PLAN_USAGE}`);
    if (set.has("--clear") === given.has("--not-clear")) throw new CliUsageError(`review verdict needs exactly one of --clear and --not-clear <reason>\n${PLAN_USAGE}`);
    const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
    const log = resolve(cwd, given.get("--log")!);
    let record;
    try {
      record = makeVerdict({ unit: positional[0]!, role: given.get("--role")!, head: commit(root, given.get("--head")!), clear: set.has("--clear"), blind: set.has("--blind"), ...(given.has("--not-clear") ? { reason: given.get("--not-clear")! } : {}), ...(given.has("--severity") ? { severity: given.get("--severity")! } : {}) });
      if (existsSync(log)) parseVerdictLog(readFileSync(log, "utf8"), log);
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      return { exitCode: 1, root, message: `REFUSED: ${(error as Error).message}` };
    }
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `${JSON.stringify(record)}\n`);
    return { exitCode: 0, root, message: `${record.role}: ${record.line}`, ...(set.has("--json") ? { output: record } : {}) };
  }
  const { positional, set, given } = options(argv, ["--json"], ["--base", "--head", "--mechanical", "--verdicts", "--evidence", "--onto", "--ask", "--root"]);
  if (positional.length !== 1) throw new CliUsageError(`review plan needs <unit>\n${PLAN_USAGE}`);
  if (!given.has("--base")) throw new CliUsageError(`review plan needs --base <ref>\n${PLAN_USAGE}`);
  const unit = positional[0]!;
  const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
  const head = commit(root, given.get("--head") ?? unit);
  const base = commit(root, given.get("--base")!);
  const onto = given.get("--onto") ?? "origin/main";
  if (given.has("--evidence")) {
    try { assertExactHead(exactHeadEvidence(readJson(resolve(cwd, given.get("--evidence")!))), head); }
    catch (error) {
      if (error instanceof CliUsageError) throw error;
      return { exitCode: 1, root, message: `REFUSED ${head}: ${(error as Error).message}` };
    }
  }
  let verdicts;
  try {
    verdicts = given.has("--verdicts") && existsSync(resolve(cwd, given.get("--verdicts")!))
      ? parseVerdictLog(readFileSync(resolve(cwd, given.get("--verdicts")!), "utf8"), given.get("--verdicts")!).filter(record => record.unit === unit)
      : [];
  } catch (error) { return { exitCode: 1, root, message: `REFUSED ${head}: ${(error as Error).message}` }; }
  const classification = classify(diffFiles(root, base, head));
  const plan = planReview({
    unit, head, classification, verdicts,
    mechanical: given.has("--mechanical") ? mechanicalAt(readJson(resolve(cwd, given.get("--mechanical")!)), head) : null,
    carries: from => { commit(root, onto); const result = carryClearance(root, from, head, onto); return { carry: result.verdict === "CARRY", reason: result.reason }; },
  });
  const ask = given.get("--ask");
  const asked = ask === undefined ? undefined : allowPass(plan, ask);
  const message = [formatPlan(plan, classification), ...(asked ? [asked.allowed ? `ALLOWED: ${ask}` : `REFUSED ${ask}: ${asked.reason}`] : [])].join("\n");
  const exitCode = plan.status === "REFUSED" || (asked && !asked.allowed) ? 1 : 0;
  return { exitCode, root, message, ...(set.has("--json") ? { output: { schema: "clossys.review-plan/1", ...plan, classification, ...(asked ? { ask: { pass: ask, ...asked } } : {}) } } : {}) };
}
