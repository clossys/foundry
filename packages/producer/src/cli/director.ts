/**
 * `clossys director check …` and `clossys director rate-check …`: Director's own commands.
 * @clossys/director is a library with no filesystem access to its strategy store; this verb
 * injects the single slot-model reader (records/slots.ts) and writer (records/slot-write.ts).
 * The Director commands print their own output, so the result is marked printed.
 */
import { resolve } from "node:path";
import { runDirectorCli, runDirectorRateCli } from "@clossys/director";
import { directorStore } from "../records/slot-write.js";
import { DIRECTOR_CHECKS_USAGE, isDirectorCheck, runDirectorCheck } from "./director-checks.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const DIRECTOR_USAGE = "Usage: clossys director check <command> [args]\n"
  + `${DIRECTOR_CHECKS_USAGE}\n`
  + "       clossys director rate-check <assessment.json>\n"
  + "check runs Director's commands (ground, wont-claim, brief, checks, review, citations, read) over the pinned\n"
  + "Director slots through the slot-model reader and writer; rate-check rates a caller-supplied assessment.";

const exit = (code: number): 0 | 1 | 2 => code === 0 ? 0 : code === 1 ? 1 : 2;

/**
 * The owner's archetype answer records in the workspace the CLI runs in (CHAT-DIR, gap 11: the archetype question is
 * always asked, so its option argv runs from that workspace, as owner.wiring runs it on a scratch copy). Without
 * `--root` the strategy root is `<root>/clossys/agents/director` of the root discovered from `cwd`, as the Producer's
 * own Director checks resolve it (director-checks.ts); an undiscoverable root refuses.
 */
function archetypeArgv(rest: readonly string[], cwd: string): string[] {
  if (rest[0] !== "archetype" || rest.some(word => word === "--root" || word.startsWith("--root="))) return [...rest];
  return [...rest, "--root", resolve(discoverRoot(cwd), "clossys", "agents", "director")];
}

export async function runDirectorVerb(argv: readonly string[], cwd = process.cwd()): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "check" && isDirectorCheck(rest[0])) return runDirectorCheck(rest, cwd);
  if (command === "check") {
    let call: string[];
    try { call = archetypeArgv(rest, cwd); } catch (error) { return { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
    return { exitCode: exit(runDirectorCli(call, directorStore)), message: "", printed: true };
  }
  if (command === "rate-check") return { exitCode: exit(runDirectorRateCli([...rest])), message: "", printed: true };
  if (command === undefined || command === "--help" || command === "-h") return { exitCode: command === undefined ? 2 : 0, message: DIRECTOR_USAGE };
  return { exitCode: 2, message: `clossys director: unknown command ${command}\n${DIRECTOR_USAGE}` };
}
