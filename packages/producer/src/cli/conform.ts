/**
 * `clossys conform [--agent <id> | --all] [--json] [--repo <dir>] [--consumer <dir>]`: the conformance report
 * (foundry-build-0048 U1). Judges each agent against the conformance standard (src/conform/assertions.json)
 * and its dogfood rows, prints one RED/GREEN line per assertion with every red row, and exits 1 while any
 * cell is red. Report-only: it reads, prints and records nothing, and no gate runs it.
 */
import { join, resolve } from "node:path";
import { CONFORM_AGENTS, readConformModel, type ConformAgent } from "../conform/model.js";
import { readProbeFacts } from "../conform/dogfood.js";
import { readProducerModel } from "../conform/producer.js";
import { conform, formatReport, readRegistry } from "../conform/run.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

/** U9: Producer is a subject too, judged on its own wiring rows; then the four content agents. */
export const CONFORM_SUBJECTS = ["producer", ...CONFORM_AGENTS] as const;

export const CONFORM_USAGE = "Usage: clossys conform [--agent producer|director|designer|writer|publisher | --all] [--json] [--repo <dir>] [--consumer <dir>]\n"
  + "  judges Producer's wiring and each agent against the conformance standard and its dogfood rows; prints RED/GREEN per assertion and\n"
  + "  every red row. Exits 1 while any cell is red. Report-only; reads the producer test fixture by default.";

export async function runConformCli(argv: readonly string[], _cwd: string): Promise<CliResult> {
  let agent: string | undefined, repo = resolve(PRODUCER_ROOT, "../.."), consumer: string | undefined, json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: CONFORM_USAGE };
    if (arg === "--json") { json = true; continue; }
    if (arg === "--all") continue;
    if (arg === "--agent" || arg === "--repo" || arg === "--consumer") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${CONFORM_USAGE}`);
      if (arg === "--agent") agent = value; else if (arg === "--repo") repo = resolve(value); else consumer = resolve(value);
      continue;
    }
    throw new CliUsageError(`Unknown option ${arg}\n${CONFORM_USAGE}`);
  }
  if (agent !== undefined && !(CONFORM_SUBJECTS as readonly string[]).includes(agent)) throw new CliUsageError(`--agent must be one of ${CONFORM_SUBJECTS.join(", ")}\n${CONFORM_USAGE}`);
  const root = consumer ?? join(repo, "packages/producer/test-fixtures/consumer/clossys");
  const agents = agent === "producer" ? [] : agent ? [agent as ConformAgent] : CONFORM_AGENTS;
  const model = readConformModel(repo, root, agents);
  const producer = agent === undefined || agent === "producer" ? readProducerModel(root) : undefined;
  const facts = agents.length ? await readProbeFacts(model) : { emptyL2Detected: {}, requestVerb: false, critiqueMonorepoPath: false, iaContract: {}, pinGate: {} };
  const report = conform(model, readRegistry(), facts, producer);
  return { exitCode: report.ok ? 0 : 1, message: formatReport(report), ...(json ? { output: report } : {}) };
}
