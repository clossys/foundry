/** `clossys feedback <ref> "<words>" --via chat|app|cli` (flows.md F5 step 1): opens a queue.fix entry. See queue/feedback.ts. */
import { resolve } from "node:path";
import { VIAS, type Via } from "../queue/answer.js";
import { FeedbackRefused, raiseFeedbackOrRequest, type FeedbackInput } from "../queue/feedback.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const FEEDBACK_USAGE = "Usage: clossys feedback <agent>/<slot-id>[/<candidate>][#<record>] \"<the owner's words, verbatim>\" --via chat|app|cli [--quote <words>] [--slug <slug>] [--ref <where said>] [--root <dir>] [--json]\n"
  + "  opens one queue.fix entry: ask = the words, decider = the agent that owns the ref, no default. --via app also needs --quote.\n"
  + "  A ref to a slot the consumer does not hold raises a slot request to its agent instead (clossys request).\n"
  + "  Exit 1 when the ref dangles or the entry would not be valid; nothing is written then.";

const VALUE_FLAGS = ["--via", "--quote", "--slug", "--ref", "--root"] as const;
type ValueFlag = typeof VALUE_FLAGS[number];

export async function runFeedbackCli(argv: readonly string[], cwd: string, now?: Date): Promise<CliResult> {
  const positional: string[] = [];
  const flags: Partial<Record<ValueFlag, string>> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: FEEDBACK_USAGE };
    if (arg === "--json") continue;
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${FEEDBACK_USAGE}`);
      if (flags[arg as ValueFlag] !== undefined) throw new CliUsageError(`${arg} is given twice\n${FEEDBACK_USAGE}`);
      flags[arg as ValueFlag] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${FEEDBACK_USAGE}`);
    positional.push(arg);
  }
  if (positional.length !== 2) throw new CliUsageError(`clossys feedback takes <ref> and "<words>"\n${FEEDBACK_USAGE}`);
  const via = flags["--via"];
  if (via === undefined) throw new CliUsageError(`clossys feedback needs --via chat|app|cli\n${FEEDBACK_USAGE}`);
  if (!(VIAS as readonly string[]).includes(via)) throw new CliUsageError(`--via must be cli, chat or app, got ${via}\n${FEEDBACK_USAGE}`);
  const input: FeedbackInput = {
    ref: positional[0]!, words: positional[1]!, via: via as Via,
    ...(flags["--quote"] !== undefined ? { quote: flags["--quote"] } : {}),
    ...(flags["--slug"] !== undefined ? { slug: flags["--slug"] } : {}),
    ...(flags["--ref"] !== undefined ? { where: flags["--ref"] } : {}),
  };
  const root = discoverRoot(resolve(cwd, flags["--root"] ?? "."));
  try {
    const raised = raiseFeedbackOrRequest(root, input, now);
    if ("request" in raised) {
      const request = raised.request;
      return {
        exitCode: 0, root, output: request,
        message: `${raised.created ? "raised" : "already open"}  request  ${request.id}\n  target  ${request.target} (no slot holds it)\n  decider  agent:${request.target.split("/")[0]} (${request.target.split("/")[0]}.slot: reuse or create)`,
      };
    }
    const entry = raised.entry;
    const subject = `${entry.subject.to}${entry.subject.record ? `#${entry.subject.record}` : ""}`;
    return {
      exitCode: 0, root, output: entry,
      message: `raised  ${entry.queue}  ${entry.id}\n  subject  ${subject}\n  decider  ${entry.decider}`,
    };
  } catch (error) {
    if (error instanceof FeedbackRefused) return { exitCode: 1, root, message: `feedback refused: ${error.message}` };
    throw error;
  }
}
