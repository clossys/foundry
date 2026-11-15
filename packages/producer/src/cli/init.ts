/**
 * `clossys init [--root <dir>] [--json]`: prepares a consumer workspace for chat agents. Today it adds the
 * agent-neutral views pointer to the consumer's `AGENTS.md` (system.md 14.9), once; a second run changes nothing.
 * Expanding starters (`--starters`) is separate later work.
 */
import { resolve } from "node:path";
import { ensureAgentsPointer } from "../views/agents-pointer.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const INIT_USAGE = "Usage: clossys init [--root <dir>] [--json]\n"
  + "  adds the views pointer block to the workspace AGENTS.md (created when missing) unless it is already there:\n"
  + "  run clossys views list, follow clossys views show <id>, answer only through clossys answer.";

export async function runInitCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let root: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: INIT_USAGE };
    if (arg === "--json") continue;
    if (arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--root requires a value\n${INIT_USAGE}`);
      root = value;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${INIT_USAGE}`);
  }
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const pointer = ensureAgentsPointer(workspace);
  return {
    exitCode: 0, root: workspace, output: pointer,
    message: pointer.outcome === "added" ? `added the views pointer to ${pointer.file}` : `${pointer.file} already has the views pointer`,
  };
}
