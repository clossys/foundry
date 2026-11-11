/**
 * `clossys gaps [--agent <id>] [--json] [--root <dir>]`: what keeps each agent from done, in three
 * kinds (coverage, wiring, request), read from real files (pipeline/interview.ts). Not a step: it
 * reads, prints and records nothing. `clossys next --owner --agent <id>` asks the owner the
 * questions these gaps hold; a request gap is addressed to the upstream agent that must answer it.
 */
import { resolve } from "node:path";
import { GAP_KINDS, gapsOf, INTERVIEW_AGENTS } from "../pipeline/interview.js";
import type { InterviewAgent } from "../pipeline/interview.js";
import type { Step } from "../pipeline/define.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { STEPS } from "../pipeline/steps/index.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const GAPS_USAGE = "Usage: clossys gaps [--agent producer|director|designer|writer|publisher] [--json] [--root <dir>]\n"
  + "  lists each agent's gaps: coverage (open decisions, missing seat policy, failing checks), wiring (no seat, stale\n"
  + "  citations, chain drift) and requests (a downstream need addressed to the upstream agent). Read-only.";

export async function runGapsCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  let agent: string | undefined, root: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: GAPS_USAGE };
    if (arg === "--json") continue;
    if (arg === "--agent" || arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${GAPS_USAGE}`);
      if (arg === "--agent") agent = value; else root = value;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${GAPS_USAGE}`);
  }
  if (agent !== undefined && !(INTERVIEW_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`--agent must be ${INTERVIEW_AGENTS.join(", ")}, got ${agent}\n${GAPS_USAGE}`);
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const gaps = gapsOf(workspace, { steps, packageRoot, ...(agent ? { agent: agent as InterviewAgent } : {}) });
  const lines = gaps.gaps.map(gap => `${gap.kind.padEnd(8)} ${gap.agent.padEnd(9)} ${gap.code.padEnd(28)} ${gap.item}${gap.from ? ` (from ${gap.from})` : ""}${gap.held ? " [held]" : ""}\n         ${gap.message}`);
  lines.push(...gaps.notes.map(note => `note: ${note}`));
  lines.push(`gaps${agent ? ` --agent ${agent}` : ""}: ${gaps.counts.total} (${GAP_KINDS.map(kind => `${kind} ${gaps.counts[kind]}`).join(", ")}; held ${gaps.counts.held})`);
  return { exitCode: 0, root: workspace, output: gaps, message: lines.join("\n") };
}
