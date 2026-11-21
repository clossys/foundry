import type { PageLintReport } from "../check/page-types.js";
import type { RecordSuitesReport } from "../check/record-suites.js";
import type { Verb } from "./args.js";
import { resolve } from "node:path";
import { LegacyStateError, legacyStateAt } from "../engine/state-dir.js";
import { runPipeline } from "../pipeline/runner.js";
import { discoverRoot } from "./root.js";

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
  /** The command already printed its own output (clossys director); nothing more is printed. */
  printed?: boolean;
  /** A refusal that leaves no run record (a rejected `clossys next --submit`): nothing was decided. */
  unrecorded?: boolean;
  /** A decide step's submission, kept in its run record (trace.ts RunDecision). */
  runDecision?: import("../pipeline/trace.js").RunDecision;
}

/**
 * The commands that run on a workspace whose engine state is still in the legacy root folder: the help, the engine
 * check (it reads only and names the layout finding) and `clossys migrate state`, the one verb that moves the folder.
 */
const runsOnLegacyState = (argv: readonly string[]): boolean =>
  argv.length === 0 || argv[0] === "help" || argv.includes("--help") || argv.includes("-h")
  || (argv[0] === "migrate" && argv[1] === "state")
  || (argv[0] === "check" && argv.includes("--engine"));

/** The workspace a command names: `--root <dir>` when given, else the one around `cwd`; undefined when there is none. */
function commandRoot(argv: readonly string[], cwd: string): string | undefined {
  const at = argv.findIndex(arg => arg === "--root" || arg.startsWith("--root="));
  const given = at < 0 ? undefined : argv[at]!.includes("=") ? argv[at]!.slice("--root=".length) : argv[at + 1];
  try { return discoverRoot(resolve(cwd, given ?? ".")); } catch { return undefined; }
}

/**
 * A workspace whose engine state is still in LEGACY_STATE_DIR refuses every other command before it runs (exit 2,
 * nothing read or written): a write would start a second log or state tree in STATE_DIR beside it, after which
 * `clossys migrate state` could not move it without a merge, and a read would answer from the empty STATE_DIR. The
 * engine writers refuse on their own too (state-dir.ts refuseLegacyState), for callers that do not come through here.
 */
export function legacyStateRefusal(argv: readonly string[], cwd: string): CliResult | undefined {
  if (runsOnLegacyState(argv)) return undefined;
  const root = commandRoot(argv, cwd);
  if (root === undefined || !legacyStateAt(root)) return undefined;
  return { exitCode: 2, root, message: `clossys ${argv[0]}: refused: ${new LegacyStateError(root).message}` };
}

/** Every command runs through the pipeline runner: only a defined step can run (src/pipeline/steps). */
export async function runCli(argv: readonly string[], cwd = process.cwd()): Promise<CliResult> {
  const legacy = legacyStateRefusal(argv, cwd);
  if (legacy) return legacy;
  // `clossys release` (flows.md F8) is the release loop's code steps, not a pipeline step.
  if (argv[0] === "release") return (await import("./release.js")).runReleaseCli(argv.slice(1), cwd);
  return runPipeline(argv, cwd);
}
