/**
 * The guards the seed causes name: each is a pure lint (or, for the spawner, a probe) that check:heal
 * runs, so a fixed cause that comes back fails a check instead of costing a model run.
 *
 *   packetFindings   one validation command, one expectation; the root check is base-relative
 *                    (causes `contradictory-packet`, `fixed-exit-root-check`)
 *   redFindings      a red is new only after it failed alone and passed on the base (`load-noise-timeout`)
 *   foldPlanFindings a fold fetches a branch before it compares it (`stale-branch-ref`)
 *   probeSpawner     a fixture spawner leaves no child after teardown (`orphan-test-child`)
 */
import { pathToFileURL } from "node:url";
import { processAlive } from "./spawn-fixture.js";

export interface GuardFinding {
  readonly guard: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------------------------
// Packet validation lint.

export type Expectation = { readonly kind: "exit"; readonly code: number } | { readonly kind: "base" };

const COMMAND = /`((?:npm|npx|node|git|clossys|vitest|tsc)\b[^`]*)`/g;
const FIXED_EXIT = /\bexit(?:s|\s+code)?\s+(\d+)\b/gi;
const BASE_RELATIVE = /\bsame exit (?:code )?as (?:the )?base\b|\bbase-relative\b|\bsame as (?:the )?base\b/i;
/** The repository's root check, in the forms a packet names it. */
export const ROOT_CHECK = /^(?:npm (?:run )?check|npm run check:changed|node scripts\/run-check-steps\.mjs\b.*)$/;

const describe = (expectation: Expectation) => expectation.kind === "base" ? "same exit as base" : `exit ${expectation.code}`;
const same = (a: Expectation, b: Expectation) => a.kind === b.kind && (a.kind === "base" || a.code === (b as { code: number }).code);

/** The lines of a packet's `## Validation` section (the whole text when it has none). */
export function validationLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => /^#{1,6}\s+Validation\b/i.test(line));
  if (start < 0) return lines;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^#{1,6}\s+/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Every command a packet's validation names, with each expectation it states for it. */
export function packetExpectations(markdown: string): Map<string, Expectation[]> {
  const out = new Map<string, Expectation[]>();
  for (const line of validationLines(markdown)) {
    const commands = [...line.matchAll(COMMAND)].map(match => match[1]!.trim().replace(/\s+/g, " "));
    if (commands.length === 0) continue;
    // Expectations read outside the backticks, so a command's own flags are never an expectation.
    const prose = line.replace(/`[^`]*`/g, " ");
    const expectations: Expectation[] = [...prose.matchAll(FIXED_EXIT)].map(match => ({ kind: "exit", code: Number(match[1]) }));
    if (BASE_RELATIVE.test(prose)) expectations.push({ kind: "base" });
    for (const command of commands) {
      const list = out.get(command) ?? [];
      for (const expectation of expectations) if (!list.some(seen => same(seen, expectation))) list.push(expectation);
      out.set(command, list);
    }
  }
  return out;
}

/** Packet lint: one command with two expectations is refused, and the root check is never a fixed exit. */
export function packetFindings(markdown: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  for (const [command, expectations] of packetExpectations(markdown)) {
    if (expectations.length > 1) {
      out.push({ guard: "R-PACKET-ONE-EXPECTATION", message: `\`${command}\` has two expectations (${expectations.map(describe).join(" and ")}): a validation command states exactly one` });
    }
    if (ROOT_CHECK.test(command) && expectations.some(expectation => expectation.kind === "exit")) {
      out.push({ guard: "R-ROOT-CHECK-BASE-RELATIVE", message: `root check \`${command}\` is held to a fixed exit; the mechanical runner compares it with the base in the same environment (same exit as base)` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// New-red classification.

export type RunState = "pass" | "fail" | "timeout";
export type RedVerdict = "new" | "pre-existing" | "noise" | "unconfirmed";

export interface RedEntry {
  readonly test: string;
  /** How it ended in the full run. */
  readonly head: RunState;
  /** Re-run alone on the head, in the same environment. */
  readonly alone?: RunState;
  /** Run on the base, in the same environment. */
  readonly base?: RunState;
  /** What the report calls it. */
  readonly verdict: RedVerdict;
}

/** The one verdict a red may carry: new only when it fails alone and passes on the base. */
export function classifyRed(entry: Pick<RedEntry, "head" | "alone" | "base">): RedVerdict {
  if (entry.head === "pass") return "noise";
  if (entry.alone === undefined) return "unconfirmed";
  if (entry.alone === "pass") return "noise";
  if (entry.base === undefined) return "unconfirmed";
  return entry.base === "pass" ? "new" : "pre-existing";
}

/** A reds report calls a red `new` only when classifyRed does: a timeout is re-run alone, then on the base. */
export function redFindings(report: { reds?: readonly RedEntry[] }): GuardFinding[] {
  const out: GuardFinding[] = [];
  for (const entry of report.reds ?? []) {
    const derived = classifyRed(entry);
    if (entry.verdict === "new" && derived !== "new") {
      const missing = entry.alone === undefined ? "a re-run alone" : entry.alone === "pass" ? "a failing re-run alone (it passed alone: load noise)" : entry.base === undefined ? "a base run" : "a passing base run (the base is red too)";
      out.push({ guard: "R-NEW-RED-CONFIRMED", message: `new red ${entry.test} (${entry.head}) is reported without ${missing}` });
    } else if (entry.verdict !== derived && !(entry.verdict === "unconfirmed" && derived !== "new")) {
      out.push({ guard: "R-NEW-RED-CONFIRMED", message: `red ${entry.test} is reported as ${entry.verdict}; its runs say ${derived}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fold plan lint.

const COMPARE = /^git\s+(?:merge-tree|merge-base|merge|rev-parse|diff|log|rev-list|cherry|range-diff)\b/;
const FETCH = /^git\s+fetch\s+(\S+)\s+(.+)$/;
const BRANCH = /^(?:refs\/remotes\/)?(?:origin\/)?([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)$/;
const NOT_A_BRANCH = /^-|^\.|\.(?:json|md|mjs|ts|js)$/;

/** The branch names one fold step names, without the remote prefix. */
export function stepBranches(step: string): string[] {
  return step.trim().split(/\s+/).slice(2)
    .flatMap(token => token.split(/\.{2,3}/))
    .map(token => token.replace(/[\^~]\d*$/, ""))
    .filter(token => !NOT_A_BRANCH.test(token))
    .map(token => BRANCH.exec(token)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** A fold compares a branch only after fetching it in the same plan: a local ref may be stale. */
export function foldPlanFindings(plan: { steps?: readonly string[] }): GuardFinding[] {
  const out: GuardFinding[] = [];
  const fetched = new Set<string>();
  for (const [index, raw] of (plan.steps ?? []).entries()) {
    const step = raw.trim().replace(/\s+/g, " ");
    const fetch = FETCH.exec(step);
    if (fetch) {
      for (const token of fetch[2]!.split(" ")) {
        const name = token.split(":")[0]!.replace(/^\+/, "");
        const branch = BRANCH.exec(name)?.[1] ?? name;
        fetched.add(branch);
      }
      continue;
    }
    if (!COMPARE.test(step)) continue;
    for (const branch of stepBranches(step)) {
      if (!fetched.has(branch)) out.push({ guard: "R-FOLD-FETCH-FIRST", message: `step ${index + 1} \`${step}\`: ${branch} is compared before it was fetched (git fetch origin ${branch} first; a local ref may be stale)` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fixture spawner probe.

interface SpawnerModule {
  spawnFixture(command: string, args: readonly string[], options?: object): { pid: number; child: import("node:child_process").ChildProcess; teardown(graceMs?: number): Promise<void> };
}

/** A script for the probe's parent: it starts a grandchild that ignores SIGTERM, prints its pid, then waits. */
const PARENT = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000)\"], { stdio: 'ignore' });",
  "process.stdout.write('grandchild ' + child.pid + '\\n');",
  "setTimeout(() => {}, 30000);",
].join("\n");

/**
 * Spawns a parent that starts a grandchild through the spawner module, tears the parent down, and
 * reports a finding when the grandchild is still alive. The probe never leaves its own child behind:
 * a survivor is killed before the finding is returned.
 */
export async function probeSpawner(modulePath: string, { waitMs = 1_500, label = modulePath }: { waitMs?: number; label?: string } = {}): Promise<GuardFinding[]> {
  const module = await import(pathToFileURL(modulePath).href) as Partial<SpawnerModule>;
  if (typeof module.spawnFixture !== "function") return [{ guard: "R-FIXTURE-NO-ORPHAN", message: `${label} exports no spawnFixture(command, args, options)` }];
  const fixture = module.spawnFixture(process.execPath, ["-e", PARENT], { stdio: ["ignore", "pipe", "ignore"] });
  const grandchild = await new Promise<number | undefined>(accept => {
    let text = "";
    const timer = setTimeout(() => accept(undefined), waitMs * 2);
    fixture.child.stdout?.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const match = /grandchild (\d+)/.exec(text);
      if (match) { clearTimeout(timer); accept(Number(match[1])); }
    });
  });
  await fixture.teardown(300);
  if (grandchild === undefined) {
    try { process.kill(-fixture.pid, "SIGKILL"); } catch { /* already gone */ }
    return [{ guard: "R-FIXTURE-NO-ORPHAN", message: `${label}: the probe's parent never reported its child` }];
  }
  const until = Date.now() + waitMs;
  while (Date.now() < until && processAlive(grandchild)) await new Promise(accept => setTimeout(accept, 25));
  if (!processAlive(grandchild)) return [];
  try { process.kill(grandchild, "SIGKILL"); } catch { /* already gone */ }
  return [{ guard: "R-FIXTURE-NO-ORPHAN", message: `a child of the fixture survived teardown: ${label} ends the parent, not its process group` }];
}
