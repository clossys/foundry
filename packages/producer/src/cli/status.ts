/**
 * `clossys status [--agent <id>] [--queue open|all] [--ledger <n>] [--json] [--root <dir>]`: the
 * workspace read model (`clossys.status/1`, system.md 12.2) for a chat agent. Read-only and
 * deterministic; it folds the int2 `gaps` and `options` listings in as fields (14.5).
 */
import { resolve } from "node:path";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { checkSlotOptions, classCounts } from "../records/slot-options.js";
import { gapsOf } from "../pipeline/interview.js";
import type { Step } from "../pipeline/define.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { STEPS } from "../pipeline/steps/index.js";
import { statusReport, SLOT_STATES, type SlotState } from "../read/status.js";
import { whereWeStand } from "../read/stage.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const STATUS_USAGE = "Usage: clossys status [--agent director|designer|writer|publisher] [--queue open|all] [--ledger <n>] [--detail] [--json] [--root <dir>]\n"
  + "  the workspace read model (clossys.status/1): slots per agent and state, open queue items, recent ledger runs,\n"
  + "  releases, with stateSha256 to poll cheaply; --agent scopes the queue (and the detail). --detail adds per-slot rows,\n"
  + "  gaps and short option slots (fields outside clossys.status/1). Read-only.\n"
  + "  next: the step clossys run --dry stops at, as { step, agent, skill, kind, tier, model }: tier is none for plumb, mid for\n"
  + "  decide:judgment, high for decide:creative; model is that tier in clossys/seat-policy.json (null while it names none).\n"
  + "  stage, the first rule that holds: setup (next is the Producer's own: config, seats, seat policy, loops); strategy (next is\n"
  + "  the Director's); fill (next is a Designer or Writer step, or a Publisher step that is not a release); release (next is a\n"
  + "  Publisher release); review (nothing open, and a slot awaits confirm, fails or needs a refresh, or a queue entry is open);\n"
  + "  release (nothing open or in review, and a release is unpinned or stale); refine (the chain is done: owner refinement only).";

export async function runStatusCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  let agent: string | undefined, root: string | undefined, queue: string | undefined, ledger: string | undefined, detail = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: STATUS_USAGE };
    if (arg === "--json") continue;
    if (arg === "--detail") { detail = true; continue; }
    if (arg === "--agent" || arg === "--root" || arg === "--queue" || arg === "--ledger") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${STATUS_USAGE}`);
      if (arg === "--agent") agent = value; else if (arg === "--root") root = value; else if (arg === "--queue") queue = value; else ledger = value;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${STATUS_USAGE}`);
  }
  if (agent !== undefined && !(SLOT_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`--agent must be ${SLOT_AGENTS.join(", ")}, got ${agent}\n${STATUS_USAGE}`);
  if (queue !== undefined && queue !== "open" && queue !== "all") throw new CliUsageError(`--queue must be open or all, got ${queue}\n${STATUS_USAGE}`);
  if (ledger !== undefined && !/^\d+$/.test(ledger)) throw new CliUsageError(`--ledger must be a whole number, got ${ledger}\n${STATUS_USAGE}`);
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const { view, plannerPins } = statusReport(workspace, {
    ...(agent ? { agent: agent as SlotAgent } : {}),
    ...(queue ? { queue: queue as "open" | "all" } : {}),
    ...(ledger !== undefined ? { ledger: Number(ledger) } : {}),
    detail,
    gaps: (at, only) => gapsOf(at, { steps, packageRoot, ...(only ? { agent: only } : {}) }),
    options: consumer => { const { slots } = checkSlotOptions(consumer); return { classes: classCounts(slots), slots }; },
    where: (at, core) => whereWeStand(at, core, steps, packageRoot),
  });
  const lines = Object.entries(view.agents).map(([id, row]) =>
    `${id.padEnd(9)} ${String(row.slots).padStart(4)} slot(s)  ${stateCounts(row.byState, plannerPins[id as keyof typeof plannerPins] ?? 0)}`);
  lines.push(`queue ${view.queue.length} open, ledger ${view.ledger.length} run(s), releases ${view.releases.length}; state ${(view.stateSha256 ?? "").slice(0, 12)}`);
  const next = view.next;
  lines.push(`stage ${view.stage}; next ${next ? `${next.step} (${next.agent}, ${next.kind}, tier ${next.tier}${next.model ? `, model ${next.model}` : ""}; skill ${next.skill})` : "none: nothing open"}`);
  return { exitCode: 0, root: workspace, output: view, message: lines.join("\n") };
}

/**
 * One agent's state counts for the message. A planner-basis pin is still `confirm` in the read model
 * (the owner has not confirmed it), but it is shown as "pinned (planner)", apart from an unconfirmed
 * pick, so "confirm" counts only the bulk and agent pins. Display only; `--json` is unchanged.
 */
export function stateCounts(byState: Readonly<Record<SlotState, number>>, planner: number): string {
  return SLOT_STATES.flatMap(state => state === "confirm"
    ? [`pinned (planner) ${planner}`, `confirm ${byState.confirm - planner}`]
    : [`${state} ${byState[state]}`]).join(", ");
}
