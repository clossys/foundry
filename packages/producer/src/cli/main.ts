import { resolve } from "node:path";
import { resolveAgent } from "../agents.js";
import type { AgentKind } from "../agents.js";
import type { PageLintReport } from "../check/page-types.js";
import { CliUsageError, parseArgs, USAGE } from "./args.js";
import type { Verb } from "./args.js";
import { discoverRoot } from "./root.js";
import { runProduce } from "./produce.js";
import { runPageCheck } from "./check.js";

const VERB_AGENTS: Record<Exclude<Verb, "check">, readonly AgentKind[]> = {
  direct: ["director"],
  design: ["designer"],
  write: ["writer"],
  publish: ["publisher"],
  produce: ["director", "designer", "writer", "publisher"],
};

export interface CliResult {
  exitCode: 0 | 1 | 2;
  message: string;
  verb?: Verb;
  root?: string;
  check?: boolean;
  report?: PageLintReport;
  reportPath?: string;
}

export async function runCli(argv: readonly string[], cwd = process.cwd()): Promise<CliResult> {
  try {
    const args = parseArgs(argv);
    if (args.help) return { exitCode: 0, message: USAGE };
    const verb = args.verb!;
    if (verb === "check") return await runPageCheck(args, cwd);
    const root = discoverRoot(resolve(cwd, args.root ?? "."));
    if (verb === "produce") return await runProduce(args, root);
    for (const kind of VERB_AGENTS[verb]) resolveAgent(kind);
    return { exitCode: 2, message: `${verb}: not implemented in this build`, verb, root, check: args.check };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, message: error instanceof CliUsageError ? `${message}\n${USAGE}` : message };
  }
}
