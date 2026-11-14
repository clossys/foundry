/**
 * `clossys craft <stage> <agent>/<slot> --model <id> --tier low|mid|high --skill <path> [--file <json>] [--recipe <id>]`:
 * the P2 craft stages (slot-constitution.md section 5b) by name. One implementation: it is
 * `clossys next <agent>/<slot> --stage <stage> ...` (cli/next.ts runNextStageCli), so the order
 * refusal, the 3-4 directions, the pairwise-distinct axes and the assembled brief are the same
 * whichever spelling runs. `craft brief` assembles the pinned inputs, the contract and the
 * standard's requirements and taste anchors (cli/craft-brief.ts).
 */
import type { Step } from "../pipeline/define.js";
import { STEPS } from "../pipeline/steps/index.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { CRAFT_STAGES } from "../records/slot-write.js";
import { runNextCli } from "./next.js";

export const CRAFT_USAGE = "Usage: clossys craft brief|diverge|render|critique|refine <agent>/<slot> --model <id> --tier low|mid|high --skill <path> [--file <json>] [--recipe <id>] [--root <dir>] [--json]\n"
  + "  brief assembles the slot's pinned inputs, contract and standard (requirements, taste anchors); refused with a fix when one is missing.\n"
  + "  diverge takes 3-4 directions whose values differ pairwise on every axis (the brief's recipe axes); stages run in order.\n";

export async function runCraftCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS): Promise<CliResult> {
  const [stage, ...rest] = argv;
  if (stage === undefined || stage === "--help") return { exitCode: stage ? 0 : 2, message: CRAFT_USAGE };
  if (!(CRAFT_STAGES as readonly string[]).includes(stage)) throw new CliUsageError(`craft stage must be ${CRAFT_STAGES.join(", ")}, got ${stage}\n${CRAFT_USAGE}`);
  if (rest.includes("--stage") || rest.includes("--submit")) throw new CliUsageError(`craft takes the stage as its first argument; submit with clossys next --submit\n${CRAFT_USAGE}`);
  return runNextCli([...rest, "--stage", stage], cwd, steps);
}
