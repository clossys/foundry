import { resolve } from "node:path";
import type { PageLintReport } from "../check/page-types.js";
import type { RecordSuitesReport } from "../check/record-suites.js";
import { runSpecimenCli } from "./specimen.js";
import { runMigrateCli } from "./migrate.js";
import { CliUsageError, parseArgs, USAGE } from "./args.js";
import type { Verb } from "./args.js";
import { discoverRoot } from "./root.js";
import { runProduce } from "./produce.js";
import { runCheck } from "./check.js";
import { runPublish, runPublishCheck } from "./publish.js";
import { runWrite } from "./write.js";
import { runDesign } from "./design.js";
import { runDirect } from "./direct.js";

export interface CliResult {
  exitCode: 0 | 1 | 2;
  message: string;
  verb?: Verb;
  root?: string;
  check?: boolean;
  report?: PageLintReport;
  suites?: RecordSuitesReport;
  slots?: import("../check/slot-resolve.js").SlotResolveReport;
  reportPath?: string;
  brief?: unknown;
  checks?: unknown;
  compilation?: unknown;
}

export async function runCli(argv: readonly string[], cwd = process.cwd()): Promise<CliResult> {
  try {
    // `specimen` has its own subcommands and flags; it never reaches the shared parser.
    if (argv[0] === "specimen") return await runSpecimenCli(argv.slice(1), cwd);
    // `migrate` is a one-shot codemod namespace with its own flags.
    if (argv[0] === "migrate") return await runMigrateCli(argv.slice(1), cwd);
    const args = parseArgs(argv);
    if (args.help) return { exitCode: 0, message: USAGE };
    const verb = args.verb!;
    if (verb === "check") return await runCheck(args, cwd);
    const root = discoverRoot(resolve(cwd, args.root ?? "."));
    if (verb === "produce") return await runProduce(args, root);
    if (verb === "write") return await runWrite(args, root);
    if (verb === "design") return await runDesign(args, root);
    if (verb === "direct") return await runDirect(args, root);
    if (args.install) return await runPublish(args, root, cwd);
    return await runPublishCheck(args, root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, message: error instanceof CliUsageError ? `${message}\n${USAGE}` : message };
  }
}
