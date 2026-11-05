/**
 * `clossys director check …` and `clossys director rate-check …`: Director's own commands.
 * @clossys/director is a library with no filesystem access to its strategy store; this verb
 * injects the single slot-model reader (records/slots.ts) and writer (records/slot-write.ts).
 * The Director commands print their own output, so the result is marked printed.
 */
import { runDirectorCli, runDirectorRateCli } from "@clossys/director";
import { directorStore } from "../records/slot-write.js";
import type { CliResult } from "./main.js";

export const DIRECTOR_USAGE = "Usage: clossys director check <command> [args]\n"
  + "       clossys director rate-check <assessment.json>\n"
  + "check runs Director's commands (ground, wont-claim, brief, checks, review, citations, read) over the pinned\n"
  + "Director slots through the slot-model reader and writer; rate-check rates a caller-supplied assessment.";

const exit = (code: number): 0 | 1 | 2 => code === 0 ? 0 : code === 1 ? 1 : 2;

export async function runDirectorVerb(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "check") return { exitCode: exit(runDirectorCli([...rest], directorStore)), message: "", printed: true };
  if (command === "rate-check") return { exitCode: exit(runDirectorRateCli([...rest])), message: "", printed: true };
  if (command === undefined || command === "--help" || command === "-h") return { exitCode: command === undefined ? 2 : 0, message: DIRECTOR_USAGE };
  return { exitCode: 2, message: `clossys director: unknown command ${command}\n${DIRECTOR_USAGE}` };
}
