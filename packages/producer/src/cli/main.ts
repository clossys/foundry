import type { PageLintReport } from "../check/page-types.js";
import type { RecordSuitesReport } from "../check/record-suites.js";
import type { Verb } from "./args.js";
import { runPipeline } from "../pipeline/runner.js";

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
  /** Printed as-is under --json (clossys pipeline status|graph). */
  output?: unknown;
  /** pin: the decision just written. */
  decision?: unknown;
  /** decisions: every slot's state and the counts. */
  decisions?: unknown;
}

/** Every command runs through the pipeline runner: only a defined step can run (src/pipeline/steps). */
export async function runCli(argv: readonly string[], cwd = process.cwd()): Promise<CliResult> {
  return runPipeline(argv, cwd);
}
