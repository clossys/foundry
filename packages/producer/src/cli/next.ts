/**
 * `clossys next`: the one open decide step as a fixed packet, and the verb that records an agent's
 * candidate for it (the `*.candidates` steps).
 *
 *   clossys next [--json] [--root <dir>]
 *   clossys next --owner [--agent <id>] [--model <tier>=<id>]... [--json] [--root <dir>]
 *   clossys next <agent>/<slot> --submit <file> --model <id> --tier low|mid|high --basis agent|owner|planner --skill <path> --rung <rung> [--seed <id>] [--reason <text>] [--name <stem>] [--root <dir>] [--json]
 *
 * --owner is the interview (pipeline/interview.ts): the owner questions the gaps hold, grouped and in
 * rounds of at most 4, each option the exact argv of every call it runs; --agent keeps one agent's.
 * The packet is not a step and records nothing. A submission is the `<agent>.candidates` step: its
 * declared skill must be the contract's skill, its seat's llm (when assigned) must match the model and
 * tier, its file must pass the output port's schema and the slot model check, and its canonical bytes
 * must differ from every candidate the slot holds, and its selection-ladder record (--rung, --seed,
 * --reason; pipeline/candidate-ladder.ts) must name a seed it selected or adapted, or the reason no
 * seed fit when it creates; a rejection writes
 * nothing and leaves no run record. An accepted one writes `<name>-v<n>` into the slot's candidates
 * and its run record keeps the model, tier, basis, ladder, skill file and output file with their sha256.
 */
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CANDIDATE_NAME, KIND_EXT, SLOT_AGENTS } from "../records/slot-model/types.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import { candidatesDir, slotDir } from "../records/slot-model/layout.js";
import { checkSlotModel } from "../records/slot-check.js";
import { jsonBytes } from "../records/slot-model/layout.js";
import { readCandidate, readSlot, readSlotEntry } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";
import { nextPacket, openItems, openPackets, skillFile } from "../pipeline/chain.js";
import type { Packet } from "../pipeline/chain.js";
import type { Step } from "../pipeline/define.js";
import { ladderIssues } from "../pipeline/candidate-ladder.js";
import type { CandidateLadder } from "../pipeline/candidate-ladder.js";
import { INTERVIEW_AGENTS, interviewOf } from "../pipeline/interview.js";
import type { InterviewAgent, Question } from "../pipeline/interview.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { validateFile } from "../pipeline/schema.js";
import { readSeat, readSeats } from "../pipeline/seats.js";
import { slotCounts } from "../pipeline/status.js";
import { STEPS } from "../pipeline/steps/index.js";
import { workspacePath } from "../pipeline/trace.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const NEXT_USAGE = "Usage: clossys next [--json] [--root <dir>]\n"
  + "       clossys next --owner [--agent <id>] [--model <tier>=<id>]... [--json] [--root <dir>]\n"
  + "       clossys next <agent>/<slot> --submit <file> --model <id> --tier low|mid|high --basis agent|owner|planner --skill <path> --rung <rung> [--seed <id>] [--reason <text>] [--name <stem>] [--root <dir>] [--json]\n"
  + "  no target: print the one open decide step as a packet (inputs, output path and schema, checks, decider, skill).\n"
  + "  --owner: the interview: the owner questions the gaps hold (clossys gaps), in rounds of at most 4, each with 2-4 answers\n"
  + "  (recommended first, each the exact argv of every call it runs) and a free-text answer; --agent <id> keeps one agent's.\n"
  + "  --model <tier>=<id>: the seat-policy question's recommended answer while clossys/seat-policy.json is missing (never guessed).\n"
  + "  --submit: record one candidate for <agent>/<slot> (the <agent>.candidates step); --skill must be that step's skill.\n"
  + "  --rung: the selection-ladder rung it came from (select, adapt, create; the Designer's L1 stock, L2 partner, L3 question, L4 Foundry);\n"
  + "  --seed names the seed selected or adapted; --reason says why no seed fit (required to create).";

const TIERS = ["low", "mid", "high"] as const;
const BASES = ["agent", "owner", "planner"] as const;

interface Flags {
  positional: string[]; json: boolean; owner: boolean; help: boolean; root?: string; agent?: string;
  submit?: string; model?: string; models: Record<string, string>; tier?: string; basis?: string; skill?: string; name?: string; rung?: string; seed?: string; reason?: string;
}
function parse(argv: readonly string[]): Flags {
  const flags: Flags = { positional: [], json: false, owner: false, help: false, models: {} };
  const value = (index: number, name: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${name} requires a value\n${NEXT_USAGE}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--owner") flags.owner = true;
    else if (arg === "--root") flags.root = value(++index, "--root");
    else if (arg === "--agent") flags.agent = value(++index, "--agent");
    else if (arg === "--submit") flags.submit = value(++index, "--submit");
    else if (arg === "--model") {
      const given = value(++index, "--model");
      const tiered = /^(low|mid|high)=(.+)$/.exec(given);
      if (tiered) flags.models[tiered[1]!] = tiered[2]!; else flags.model = given;
    }
    else if (arg === "--tier") flags.tier = value(++index, "--tier");
    else if (arg === "--basis") flags.basis = value(++index, "--basis");
    else if (arg === "--skill") flags.skill = value(++index, "--skill");
    else if (arg === "--name") flags.name = value(++index, "--name");
    else if (arg === "--rung") flags.rung = value(++index, "--rung");
    else if (arg === "--seed") flags.seed = value(++index, "--seed");
    else if (arg === "--reason") flags.reason = value(++index, "--reason");
    else if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${NEXT_USAGE}`);
    else flags.positional.push(arg);
  }
  return flags;
}
const rootOf = (cwd: string, root: string | undefined) => discoverRoot(resolve(cwd, root ?? "."));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function describe(packet: Packet): string {
  const lines = [
    `next: ${packet.step} (${packet.kind}), ${packet.open} open; decided by ${packet.decider}`,
    `  item      ${packet.item}`,
    `  question  ${packet.question}`,
    `  skill     ${packet.skill.path}${packet.skill.sha256 ? ` (${packet.skill.sha256.slice(0, 12)}), read ${packet.skill.file}` : " (missing)"}`,
    ...(packet.inputs.brief ? [`  brief     ${packet.inputs.brief}`] : []),
    ...(packet.inputs.options ? [`  options   ${packet.inputs.options.count}${packet.inputs.options.varyOn ? `, vary on ${packet.inputs.options.varyOn}` : ""}`] : []),
    ...(packet.inputs.files.length ? [`  reads     ${packet.inputs.files.join(", ")}`] : []),
    `  writes    ${packet.output.path} (schema ${packet.output.schema})`,
    `  checks    ${packet.checks.join(", ") || "none"}`,
    `  record    ${packet.record}`,
  ];
  for (const option of packet.options ?? []) lines.push(`  ${option.id}) ${option.label}${option.recommended ? " [recommended]" : ""}${option.argv ? `\n       ${option.argv.map(word => /\s/.test(word) ? JSON.stringify(word) : word).join(" ")}` : ""}`);
  return lines.join("\n");
}

function describeQuestion(question: Question, round: number): string {
  const lines = [`round ${round + 1} ${question.agent} ${question.id}${question.requestedBy.length ? ` (requested by ${question.requestedBy.join(", ")})` : ""}${question.after.length ? ` after ${question.after.join(", ")}` : ""}`, `  ${question.question}`];
  for (const option of question.options) {
    lines.push(`  ${option.id}) ${option.label}${option.recommended ? " [recommended]" : ""}`);
    for (const call of option.calls.slice(0, 2)) lines.push(`       ${call.map(word => /\s/.test(word) ? JSON.stringify(word) : word).join(" ")}`);
    if (option.calls.length > 2) lines.push(`       ... ${option.calls.length - 2} more call(s)`);
  }
  lines.push(`  other) ${question.freeText.label} (${question.freeText.verb})`);
  return lines.join("\n");
}

/** `clossys next [--owner]`: the open packet(s). Not a step: it reads, prints and records nothing. */
export async function runNextCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: NEXT_USAGE };
  if (flags.positional.length) throw new CliUsageError(`next takes a target only with --submit\n${NEXT_USAGE}`);
  const root = rootOf(cwd, flags.root);
  if (flags.agent !== undefined && !flags.owner) throw new CliUsageError(`--agent is for next --owner\n${NEXT_USAGE}`);
  if (flags.agent !== undefined && !(INTERVIEW_AGENTS as readonly string[]).includes(flags.agent)) throw new CliUsageError(`--agent must be ${INTERVIEW_AGENTS.join(", ")}, got ${flags.agent}\n${NEXT_USAGE}`);
  if (flags.owner) {
    const agent = flags.agent as InterviewAgent | undefined;
    const interview = interviewOf(root, { steps, packageRoot, models: flags.models, ...(agent ? { agent } : {}) });
    // The v1 packets stay for readers of one owner packet per item (Studio); the rounds are the interview.
    const packets = openPackets(root, { steps, packageRoot, models: flags.models, owner: true })
      .filter(packet => !agent || interview.rounds.some(round => round.some(question => question.step === packet.step && question.items.includes(packet.item))));
    const output = { ...interview, packets };
    const message = interview.count
      ? interview.rounds.flatMap((round, at) => round.map(question => describeQuestion(question, at))).join("\n\n")
      : `next --owner${agent ? ` --agent ${agent}` : ""}: no owner question is open (${interview.gaps.total} gap(s); clossys gaps${agent ? ` --agent ${agent}` : ""} lists them)`;
    return { exitCode: 0, root, output, message };
  }
  const packet = nextPacket(root, { steps, packageRoot, models: flags.models });
  return { exitCode: 0, root, output: packet ?? { schema: "clossys.next-packet/1", step: null }, message: packet ? describe(packet) : "next: no decide step is open; clossys run runs the rest of the chain" };
}

/**
 * The argv a bare `clossys next --submit <file> ...` stands for: the first open candidates packet's
 * target inserted after the verb. Any other argv is returned unchanged.
 */
export function submitTarget(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS): readonly string[] {
  if (argv[0] !== "next" || !argv.includes("--submit")) return argv;
  if (argv.slice(1).some(arg => /^(director|designer|writer|publisher)\//.test(arg))) return argv;
  const rootAt = argv.indexOf("--root");
  let root: string;
  try { root = rootOf(cwd, rootAt < 0 ? undefined : argv[rootAt + 1]); } catch { return argv; }
  const context = { root, steps, agents: slotCounts(root), seats: readSeats(root, steps) };
  for (const step of steps) {
    if (!step.id.endsWith(".candidates")) continue;
    const item = openItems(step, context)[0];
    if (item) return ["next", item, ...argv.slice(1)];
  }
  return argv;
}

const reject = (message: string): CliResult => ({ exitCode: 1, unrecorded: true, message: `next --submit refused: ${message}` });

/** `clossys next <agent>/<slot> --submit <file> ...`: the `<agent>.candidates` step. */
export async function runNextSubmitCli(argv: readonly string[], cwd: string, step?: Step, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: NEXT_USAGE };
  if (flags.submit === undefined) return runNextCli(argv, cwd, STEPS, packageRoot);
  const [target, ...extra] = flags.positional;
  if (!target) return reject("no open candidates slot to submit to; name <agent>/<slot>");
  if (extra.length) throw new CliUsageError(`Unexpected argument: ${extra[0]}\n${NEXT_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash), slot = target.slice(slash + 1);
  if (slash < 1 || !slot || !(SLOT_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`next target must be <agent>/<slot> with agent ${SLOT_AGENTS.join(", ")}, got ${target}\n${NEXT_USAGE}`);
  const owning = step ?? STEPS.find(each => each.id === `${agent}.candidates`);
  if (!owning || owning.id !== `${agent}.candidates`) return reject(`${target} is not a candidates slot of a defined step`);
  for (const [flag, given] of [["--model", flags.model], ["--tier", flags.tier], ["--basis", flags.basis], ["--skill", flags.skill]] as const) if (!given) throw new CliUsageError(`next --submit requires ${flag}\n${NEXT_USAGE}`);
  if (!(TIERS as readonly string[]).includes(flags.tier!)) throw new CliUsageError(`--tier must be ${TIERS.join(", ")}, got ${flags.tier}\n${NEXT_USAGE}`);
  if (!(BASES as readonly string[]).includes(flags.basis!)) throw new CliUsageError(`--basis must be ${BASES.join(", ")}, got ${flags.basis}\n${NEXT_USAGE}`);
  // The selection ladder: a seed selected or adapted is named, a created candidate says why no seed fit.
  const ladder: CandidateLadder | undefined = flags.rung === undefined ? undefined
    : { rung: flags.rung, ...(flags.seed !== undefined ? { seed: flags.seed } : {}), ...(flags.reason !== undefined ? { reason: flags.reason } : {}) };
  const ladderFindings = ladderIssues(agent, ladder);
  if (ladderFindings.length) return reject(`ladder ${ladderFindings.map(issue => `${issue.rule}: ${issue.detail}`).join("; ")}`);
  // The skill is the contract's: a submission made with any other skill is not this step's output.
  const contractSkill = owning.command.skill;
  if (!contractSkill || flags.skill !== contractSkill) return reject(`--skill ${flags.skill} is not ${owning.id}'s skill (${contractSkill ?? "none"})`);
  const skillPath = skillFile(owning, packageRoot);
  let skillBytes: Buffer;
  try { skillBytes = readFileSync(skillPath!); } catch { return reject(`${owning.id}'s skill ${contractSkill} is missing`); }
  const root = rootOf(cwd, flags.root);
  const consumer = join(root, "clossys");
  const seat = readSeat(root, owning);
  if (seat && seat.llm && seat.llm !== "open" && (seat.llm.model !== flags.model || seat.llm.tier !== flags.tier)) return reject(`${owning.id}'s seat assigns ${seat.llm.model} at ${seat.llm.tier}, not ${flags.model} at ${flags.tier}`);
  const entry = readSlotEntry(consumer, agent as SlotAgent, slot);
  if (!entry) return reject(`unknown slot ${target} (not in ${agent} ia.json)`);
  const file = resolve(cwd, flags.submit);
  let bytes: string;
  try { bytes = readFileSync(file, "utf8"); } catch { return reject(`cannot read ${flags.submit}`); }
  const schema = owning.packet?.write[0]?.schema ?? owning.outputs[0]?.schema;
  if (!schema) return reject(`${owning.id} names no output schema`);
  const stem = flags.name ?? (CANDIDATE_NAME.exec(basename(file))?.[1] ?? slot.split(".").at(-1)!);
  const ext = file.endsWith(".json") ? "json" : "md";
  const schemaIssues = validateFile(schema, `clossys/agents/${agent}/${slot}/candidates/${stem}-v1.${ext}`, bytes, packageRoot);
  if (schemaIssues.length) return reject(`${flags.submit} fails schema ${schema}: ${schemaIssues.slice(0, 5).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  let content: unknown = bytes;
  if (ext === "json") { try { content = JSON.parse(bytes); } catch { return reject(`${flags.submit} is not JSON`); } }
  // A candidate byte-identical to one the slot holds adds no option: refused before anything is written.
  // The bytes writeCandidate would write: the slot kind's extension decides the serialization.
  const canonical = KIND_EXT[readSlot(consumer, agent as SlotAgent, slot).kind] === "md" ? String(content) : jsonBytes(content);
  const digest = sha(canonical);
  for (const name of entry.candidates) {
    let held: string | null = null;
    try { held = readCandidate(consumer, agent as SlotAgent, slot, name).sha256; } catch { held = null; }
    if (held === digest) return reject(`${flags.submit} is byte-identical to ${target} candidate ${name}; submit a candidate that differs`);
  }
  // The slot model check is the output's check: a submission may not add an issue the model did not have.
  const before = new Set(checkSlotModel(consumer).map(issue => `${issue.code} ${issue.path} ${issue.message}`));
  let written: { name: string; sha256: string };
  try { written = writeCandidate(consumer, agent as SlotAgent, slot, stem, content, { canonical: true }); }
  catch (error) { return reject(error instanceof Error ? error.message : String(error)); }
  const writtenFile = join(candidatesDir(slotDir(consumer, agent as SlotAgent, slot)), written.name);
  const added = checkSlotModel(consumer).map(issue => `${issue.code} ${issue.path} ${issue.message}`).filter(issue => !before.has(issue));
  if (added.length) {
    unlinkSync(writtenFile);
    return reject(`${written.name} fails the slot model check: ${added.slice(0, 5).join("; ")}`);
  }
  const outputPath = workspacePath(root, writtenFile) ?? `clossys/agents/${agent}/${slot}/candidates/${written.name}`;
  const runDecision = {
    model: flags.model!, tier: flags.tier!, basis: flags.basis!, ladder: ladder!,
    skill: { path: contractSkill, sha256: sha(skillBytes) },
    output: { path: outputPath, sha256: written.sha256 },
  };
  return {
    exitCode: 0, root, runDecision, output: { schema: "clossys.next-submit/1", step: owning.id, slot: target, candidate: written.name, ...runDecision },
    message: `next --submit: ${target} candidate ${written.name} (${written.sha256.slice(0, 12)}) by ${flags.model} (${flags.tier}, ${flags.basis}, rung ${ladder!.rung}) with ${contractSkill} (${runDecision.skill.sha256.slice(0, 12)})`,
  };
}
