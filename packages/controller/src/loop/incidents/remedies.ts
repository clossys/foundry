/**
 * Remedies: the named functions a known cause's `remedy` points at. Each fixes its cause with no
 * model and returns what the heal step re-runs. A remedy never deletes user work, never edits a test
 * and never relaxes a check: it ends stray processes, fetches refs, and asks for the comparison the
 * check is owed (alone, and against the base in the same environment).
 *
 * Every side effect goes through HealEnv, so tests drive a remedy without touching a real process,
 * repository or network.
 */
import type { IncidentRecord, RunResult } from "./types.js";
import { stepBranches } from "./guards.js";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly args: string;
}

export interface HealEnv {
  /** The directory every step runs in. */
  readonly cwd: string;
  /** The one environment the head re-run and the base run share. */
  readonly env: NodeJS.ProcessEnv;
  /** The base revision a base-relative comparison runs on. */
  readonly base: string;
  run(command: string, options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<RunResult>;
  runOnBase(command: string, options: { base: string; cwd: string; env: NodeJS.ProcessEnv }): Promise<RunResult>;
  processes(): Promise<readonly ProcessRow[]>;
  killGroup(pgid: number): Promise<void>;
}

export interface RemedyResult {
  /** One line: what the remedy did. */
  readonly note: string;
  /** The command the heal step re-runs; the record's own command when absent. */
  readonly rerun?: string;
  /** Whether a red re-run is compared with the base in the same environment before it counts as failing. */
  readonly compareBase?: boolean;
}

export type Remedy = (record: IncidentRecord, env: HealEnv) => Promise<RemedyResult>;

/** The test runners whose children a killed run can orphan. */
const TEST_RUNNER = /\bvitest\b|\bnode\b.*\s--test\b|\bjest\b|\bmocha\b|\bplaywright\b/;

/**
 * Ends the process groups of test-runner processes that lost their parent (re-parented to init) and
 * run in this checkout. It never ends its own group, and never a process outside the checkout.
 */
export const killOrphanGroups: Remedy = async (_record, env) => {
  const own = process.pid;
  const rows = await env.processes();
  const ownGroup = rows.find(row => row.pid === own)?.pgid;
  const groups = new Set<number>();
  for (const row of rows) {
    if (row.ppid !== 1 || row.pid === own || row.pgid === ownGroup || row.pgid <= 1) continue;
    if (!TEST_RUNNER.test(row.args) || !row.args.includes(env.cwd)) continue;
    groups.add(row.pgid);
  }
  for (const pgid of groups) await env.killGroup(pgid);
  return { note: groups.size ? `ended ${groups.size} orphaned test process group(s)` : "no orphaned test process group was running" };
};

/** A timeout under load is re-run alone; a red re-run is then compared with the base before it counts. */
export const rerunAloneThenBase: Remedy = async () => ({ note: "re-run alone, then on the base, before reporting a new red", compareBase: true });

/** A root check is judged against the base in the same environment, never against a fixed exit 0. */
export const compareWithBase: Remedy = async () => ({ note: "compare the head with the base in the same environment", compareBase: true });

/** Fetches every branch the failed step compares, so the comparison reads the remote's tip, not a stale local ref. */
export const fetchThenCompare: Remedy = async (record, env) => {
  const branches = [...new Set(stepBranches(`git x ${record.command}`))];
  if (branches.length === 0) return { note: "the step names no branch to fetch" };
  const fetched: string[] = [];
  for (const branch of branches) {
    const result = await env.run(`git fetch origin ${branch}`, { cwd: env.cwd, env: env.env });
    if (result.exit === 0) fetched.push(branch);
  }
  return { note: `fetched ${fetched.length ? fetched.join(", ") : "nothing"} of ${branches.join(", ")} before the compare` };
};

/** Every remedy by the name causes.json gives it. `none` is not a remedy: it means the owner is told. */
export const REMEDIES: Readonly<Record<string, Remedy>> = Object.freeze({
  "kill-orphan-groups": killOrphanGroups,
  "rerun-alone-then-base": rerunAloneThenBase,
  "compare-with-base": compareWithBase,
  "fetch-then-compare": fetchThenCompare,
});

export const NO_REMEDY = "none";
