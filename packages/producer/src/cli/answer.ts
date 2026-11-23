/** `clossys answer <entry> <answer> --by <who> ...` (system.md 12.6): closes one open queue entry. See queue/answer.ts. */
import { resolve } from "node:path";
import { AnswerRefused, answerQueueEntry, VIAS, type AnswerInput, type Via } from "../queue/answer.js";
import { EntryLockedError } from "../queue/entry.js";
import { ReplayRefused, replayAnswersFile, writeAnswersExport } from "../queue/replay.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const ANSWER_USAGE = "Usage: clossys answer <entry-id | queue.<kind>#<id>> <answer> --by owner --via chat|app|cli --quote \"<the owner's words, verbatim>\" [--note <text>] [--root <dir>] [--json]\n"
  + "       clossys answer <entry> <answer> --by agent:<agent> [--note <text>]           # only for entries whose decider is that agent\n"
  + "       clossys answer <entry> <answer> --by code:<cli> --answers <pin ref | producer/queue.approve#<id>> [--note <text>]   # closes a fix or clarify only\n"
  + "  appends one answered event and sets status answered. Exit 1 when a rule refuses it (answer.open-only, answer.decider-match,\n"
  + "  answer.option-valid, answer.quote-required, ledger.append-only); nothing is written then.\n"
  + "       clossys answer --export <file> [--root <dir>]   # writes the recorded owner answers (clossys.answers/1, no ids or times)\n"
  + "       clossys answer --replay <file> [--root <dir>]   # re-applies them in order, no model; exit 1 naming the first answer\n"
  + "  that matches no open question (same queue, subject and ask), writing nothing then; an answer already applied is skipped.";

const VALUE_FLAGS = ["--by", "--via", "--quote", "--note", "--answers", "--root", "--export", "--replay"] as const;
type ValueFlag = typeof VALUE_FLAGS[number];

export async function runAnswerCli(argv: readonly string[], cwd: string, now?: Date): Promise<CliResult> {
  const positional: string[] = [];
  const flags: Partial<Record<ValueFlag, string>> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: ANSWER_USAGE };
    if (arg === "--json") continue;
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${ANSWER_USAGE}`);
      if (flags[arg as ValueFlag] !== undefined) throw new CliUsageError(`${arg} is given twice\n${ANSWER_USAGE}`);
      flags[arg as ValueFlag] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${ANSWER_USAGE}`);
    positional.push(arg);
  }
  const exportFile = flags["--export"], replayFile = flags["--replay"];
  if (exportFile !== undefined || replayFile !== undefined) {
    const extra = Object.keys(flags).filter(flag => flag !== "--root" && flag !== "--export" && flag !== "--replay");
    if (exportFile !== undefined && replayFile !== undefined) throw new CliUsageError(`--export and --replay are separate runs\n${ANSWER_USAGE}`);
    if (positional.length || extra.length) throw new CliUsageError(`--export and --replay take only a file and --root\n${ANSWER_USAGE}`);
    const root = discoverRoot(resolve(cwd, flags["--root"] ?? "."));
    if (exportFile !== undefined) {
      const doc = writeAnswersExport(root, resolve(cwd, exportFile));
      return { exitCode: 0, root, message: `exported  ${doc.answers.length} owner answer(s)  ${exportFile}`, output: { file: exportFile, answers: doc.answers.length } };
    }
    try {
      const steps = replayAnswersFile(root, resolve(cwd, replayFile!), now);
      const lines = steps.map(step => `${step.action === "answered" ? "answered" : "already "}  ${step.queue}  ${step.id}`);
      return { exitCode: 0, root, message: lines.length ? lines.join("\n") : "no answers to replay", output: { steps } };
    } catch (error) {
      if (error instanceof ReplayRefused) return { exitCode: 1, root, message: `replay refused: ${error.message}` };
      if (error instanceof EntryLockedError) return { exitCode: 1, root, message: `replay refused: ${error.message}` };
      throw error;
    }
  }
  if (positional.length !== 2) throw new CliUsageError(`clossys answer takes <entry> and <answer>\n${ANSWER_USAGE}`);
  if (flags["--by"] === undefined) throw new CliUsageError(`clossys answer needs --by\n${ANSWER_USAGE}`);
  const via = flags["--via"];
  if (via !== undefined && !(VIAS as readonly string[]).includes(via)) throw new CliUsageError(`--via must be cli, chat or app, got ${via}\n${ANSWER_USAGE}`);
  const input: AnswerInput = {
    entry: positional[0]!, answer: positional[1]!, by: flags["--by"],
    ...(via !== undefined ? { via: via as Via } : {}),
    ...(flags["--quote"] !== undefined ? { quote: flags["--quote"] } : {}),
    ...(flags["--note"] !== undefined ? { note: flags["--note"] } : {}),
    ...(flags["--answers"] !== undefined ? { answers: flags["--answers"] } : {}),
  };
  const root = discoverRoot(resolve(cwd, flags["--root"] ?? "."));
  try {
    const result = answerQueueEntry(root, input, now);
    const lines = [`answered  ${result.queue}  ${result.id}  (${result.event.by}, ${result.event.via})  ${result.event.answer}`];
    if (result.next) lines.push(`next      ${result.next}`);
    return { exitCode: 0, root, message: lines.join("\n"), output: { queue: result.queue, id: result.id, event: result.event, entry: result.entry, ...(result.next ? { next: result.next } : {}) } };
  } catch (error) {
    if (error instanceof AnswerRefused) return { exitCode: 1, root, message: `answer refused (${error.check}): ${error.message}` };
    if (error instanceof EntryLockedError) return { exitCode: 1, root, message: `answer refused: ${error.message}` };
    throw error;
  }
}
