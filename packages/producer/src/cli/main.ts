import { resolve } from "node:path";
import { resolveAgent } from "../agents.js";
import type { AgentKind } from "../agents.js";
import { CliUsageError, parseArgs, USAGE } from "./args.js";
import type { Verb } from "./args.js";
import { discoverRoot } from "./root.js";

const VERB_AGENTS: Record<Verb, readonly AgentKind[]> = {
  direct: ["director"],
  design: ["designer"],
  write: ["writer"],
  publish: ["publisher"],
  produce: ["director", "designer", "writer", "publisher"],
};

export interface CliResult {
  exitCode: 0 | 2;
  message: string;
  verb?: Verb;
  root?: string;
  check?: boolean;
}

export function runCli(argv: readonly string[], cwd = process.cwd()): CliResult {
  try {
    const args = parseArgs(argv);
    if (args.help) return { exitCode: 0, message: USAGE };
    const verb = args.verb!;
    const root = discoverRoot(resolve(cwd, args.root ?? "."));
    for (const kind of VERB_AGENTS[verb]) resolveAgent(kind);
    return { exitCode: 2, message: `${verb}: not implemented in this build`, verb, root, check: args.check };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, message: error instanceof CliUsageError ? `${message}\n${USAGE}` : message };
  }
}
