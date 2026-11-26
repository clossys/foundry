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
 * Every request need it prints is filed first as a queue entry (fileInterviewNeeds; a re-run files nothing new);
 * otherwise the packet is not a step and records nothing. A submission is the `<agent>.candidates` step: its
 * declared skill must be the contract's skill, its seat's llm (when assigned) must match the model and
 * tier, its file must pass the output port's schema and the slot model check, and its canonical bytes
 * must differ from every candidate the slot holds, and its selection-ladder record (--rung, --seed,
 * --reason; pipeline/candidate-ladder.ts) must name a seed it adopted or adapted, or the reason no
 * seed fit when it creates; a rejection writes
 * nothing and leaves no run record. An accepted one writes `<name>-v<n>` into the slot's candidates
 * and its run record keeps the model, tier, basis, ladder, skill file and output file with their sha256.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { KIND_EXT, SEAT_AGENT, SLOT_AGENTS, candidateStemIssue, seatStepOf } from "../records/slot-model/types.js";
import type { ModelAgent, SlotAgent } from "../records/slot-model/types.js";

import { candidatesDir, slotDir } from "../records/slot-model/layout.js";
import { jsonBytes } from "../records/slot-model/layout.js";
import { readCandidate, readLedger, readSlot, readSlotEntry } from "../records/slots.js";
import { CandidateRefusal } from "../records/candidate.js";
import { readCandidateText, submissionSources, viewSourceKind } from "../records/slot-current.js";
import type { Actor, AgentId, Tier } from "../records/types.js";
import { appendCraftEvent, CRAFT_STAGES, GuardRefusal, openCraftEvents, submittedBytes, writeCandidate, type CraftStage, type WriteGuard } from "../records/slot-write.js";
import { craftRunRecipe, craftRunRecipeIssues, loadRecipes, recipeSourceIssue, recipeTierIssue } from "../records/recipes.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { nextPacket, openItems, openPackets, skillFile } from "../pipeline/chain.js";
import type { Packet } from "../pipeline/chain.js";
import type { Step } from "../pipeline/define.js";
import { ladderIssues, rungKind, rungsOf } from "../pipeline/candidate-ladder.js";
import type { CandidateLadder } from "../pipeline/candidate-ladder.js";
import { fileInterviewNeeds, gapsOf, INTERVIEW_AGENTS, interviewOf } from "../pipeline/interview.js";
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
import { SUBMIT_TIERS, submitValueIssue } from "./submit-values.js";
import { errorMessage } from "../errors.js";

/** The step a Producer seat slot crafts under: the seats action (`clossys seat` writes the seat). */
const SEAT_STEP = "seats";

export const NEXT_USAGE = "Usage: clossys next [--json] [--root <dir>]\n"
  + "       clossys next --owner [--agent <id>] [--model <tier>=<id>]... [--json] [--root <dir>]\n"
  + "       clossys next <agent>/<slot> --submit <file> --model <id> --tier low|mid|high --basis agent|owner|planner --skill <path> --rung <rung> [--seed <id>] [--reason <text>] [--root <dir>] [--json]\n"
  + "       clossys next <agent>/<slot> --stage brief|diverge|render|critique|refine --model <id> --tier low|mid|high --skill <path> [--file <json>] [--recipe <id>] [--root <dir>] [--json]\n"
  + "  no target: print the one open decide step as a packet (inputs, output path and schema, checks, decider, skill).\n"
  + "  --owner: the interview: the owner questions the gaps hold (clossys gaps), in rounds of at most 4, each with 2-4 answers\n"
  + "  (recommended first, each the exact argv of every call it runs) and a free-text answer; --agent <id> keeps one agent's.\n"
  + "  --model <tier>=<id>: the seat-policy question's recommended answer while clossys/seat-policy.json is missing (never guessed).\n"
  + "  --submit: record one candidate for <agent>/<slot> (the <agent>.candidates step); --skill must be that step's skill: its id or the installed file it names.\n"
  + "  --rung: the ladder rung it came from (adopt, adapt, create; the Designer's L1 stock, L2 partner, L3 question, L4 Foundry);\n"
  + "  --seed names the seed adopted or adapted; --reason says why no seed fit (required to create).\n"
  + "  The candidate is named after the slot leaf (<leaf>-v<n>, R08.1). adapt and create (P2) need the slot's latest verdict to be\n"
  + "  create (for the latest options packet's inputsHash). The submit refuses on any finding of a constitution check whose\n"
  + "  rules.json guard lists submit, on the new file (absolute: findings the slot already had count too).\n"
  + "  --stage: one P2 craft stage (section 5b) as a craft:<stage> slot-ledger event, in order brief, diverge, render, critique,\n"
  + "  then at most 2 refine rounds; diverge takes --file with 3 to 4 {id, idea, axes} directions (cap 4). Refused under a\n"
  + "  plumb recipe (R15.7: its plumb action computes the candidate, so no craft stage is recorded). A Producer seat\n"
  + "  slot (producer/seat.<step>) crafts under the seats action's skill; clossys seat writes the seat.";

interface Flags {
  positional: string[]; json: boolean; owner: boolean; help: boolean; root?: string; agent?: string;
  submit?: string; model?: string; models: Record<string, string>; tier?: string; basis?: string; skill?: string; name?: string; rung?: string; seed?: string; reason?: string;
  stage?: string; file?: string; recipe?: string;
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
    else if (arg === "--stage") flags.stage = value(++index, "--stage");
    else if (arg === "--file") flags.file = value(++index, "--file");
    else if (arg === "--recipe") flags.recipe = value(++index, "--recipe");
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
    ...(packet.ask ? [`  ask       ${packet.ask.argv.join(" ")} (the ${packet.ask.agent} round; its skill ${packet.ask.skill})`] : []),
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

/** `clossys next [--owner]`: the open packet(s). Not a step: it prints, and records only --owner's unfiled request needs. */
export async function runNextCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: NEXT_USAGE };
  if (flags.stage !== undefined) return runNextStageCli(flags, cwd, steps, packageRoot);
  if (flags.positional.length) throw new CliUsageError(`next takes a target only with --submit or --stage\n${NEXT_USAGE}`);
  const root = rootOf(cwd, flags.root);
  if (flags.agent !== undefined && !flags.owner) throw new CliUsageError(`--agent is for next --owner\n${NEXT_USAGE}`);
  if (flags.agent !== undefined && !(INTERVIEW_AGENTS as readonly string[]).includes(flags.agent)) throw new CliUsageError(`--agent must be ${INTERVIEW_AGENTS.join(", ")}, got ${flags.agent}\n${NEXT_USAGE}`);
  if (flags.owner) {
    const agent = flags.agent as InterviewAgent | undefined;
    const filed = fileInterviewNeeds(root, gapsOf(root, { steps, packageRoot, ...(agent ? { agent } : {}) }).gaps, new Date().toISOString().replace(/\.\d+Z$/, "Z"));
    const interview = interviewOf(root, { steps, packageRoot, models: flags.models, ...(agent ? { agent } : {}) });
    // The v1 packets stay for readers of one owner packet per item (Studio); the rounds are the interview.
    const packets = openPackets(root, { steps, packageRoot, models: flags.models, owner: true })
      .filter(packet => !agent || interview.rounds.some(round => round.some(question => question.step === packet.step && question.items.includes(packet.item))));
    const output = { ...interview, packets, filed };
    const notes = [
      ...(filed.created.length ? [`filed ${filed.created.length} request need(s) as queue entries: ${filed.created.join(", ")}`] : []),
      ...filed.refused.map(row => `the queue refused the need ${row.code} ${row.item}: ${row.reason}`),
    ];
    const message = [...notes, interview.count
      ? interview.rounds.flatMap((round, at) => round.map(question => describeQuestion(question, at))).join("\n\n")
      : `next --owner${agent ? ` --agent ${agent}` : ""}: no owner question is open (${interview.gaps.total} gap(s); clossys gaps${agent ? ` --agent ${agent}` : ""} lists them)`].join("\n\n");
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
  // Help needs no workspace; anything else needs its root, and a root that cannot be resolved fails here with its
  // cause (RootDiscoveryError), never as the argv unchanged and a "no open candidates slot" refusal downstream.
  if (argv.includes("--help")) return argv;
  const rootAt = argv.indexOf("--root");
  const root = rootOf(cwd, rootAt < 0 ? undefined : argv[rootAt + 1]);
  const context = { root, steps, agents: slotCounts(root), seats: readSeats(root, steps) };
  for (const step of steps) {
    if (!step.id.endsWith(".candidates")) continue;
    const item = openItems(step, context)[0];
    if (item) return ["next", item, ...argv.slice(1)];
  }
  return argv;
}

const reject = (message: string): CliResult => ({ exitCode: 1, unrecorded: true, message: `next --submit refused: ${message}` });

/**
 * Whether `--skill` names the step's skill: its logical id (`packages/<agent>/actions/<step>/skill.md`, what the run
 * records), or a path, relative to the working folder, that resolves to the same file as the installed skill the id
 * names (`node_modules/@clossys/<agent>/actions/<step>/skill.md` in a consumer; CHAT-DIR gap 13).
 */
function isStepSkill(given: string, step: Step, packageRoot: string, cwd: string): boolean {
  if (given === step.command.skill) return true;
  const file = skillFile(step, packageRoot);
  if (!file) return false;
  try { return realpathSync(resolve(cwd, given)) === realpathSync(file); } catch { return false; }
}

/** `clossys next <agent>/<slot> --submit <file> ...`: the `<agent>.candidates` step. */
export async function runNextSubmitCli(argv: readonly string[], cwd: string, step?: Step, packageRoot = PACKAGE_ROOT, guard: WriteGuard = true): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.stage !== undefined) return runNextStageCli(flags, cwd, step ? [step] : STEPS, packageRoot);
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
  const valueIssue = submitValueIssue(flags);
  if (valueIssue !== undefined) throw new CliUsageError(`${valueIssue}\n${NEXT_USAGE}`);
  // The selection ladder: a seed adopted or adapted is named, a created candidate says why no seed fit.
  const ladder: CandidateLadder | undefined = flags.rung === undefined ? undefined
    : { rung: flags.rung, ...(flags.seed !== undefined ? { seed: flags.seed } : {}), ...(flags.reason !== undefined ? { reason: flags.reason } : {}) };
  const ladderFindings = ladderIssues(agent, ladder);
  if (ladderFindings.length) return reject(`ladder ${ladderFindings.map(issue => `${issue.rule}: ${issue.detail}`).join("; ")}`);
  // The skill is the contract's: a submission made with any other skill is not this step's output.
  const contractSkill = owning.command.skill;
  if (!contractSkill || !isStepSkill(flags.skill!, owning, packageRoot, cwd)) return reject(`--skill ${flags.skill} is not ${owning.id}'s skill (${contractSkill ?? "none"}, or the installed file it names)`);
  const skillPath = skillFile(owning, packageRoot);
  let skillBytes: Buffer;
  try { skillBytes = readFileSync(skillPath!); } catch (error) { return reject(`${owning.id}'s skill ${contractSkill} cannot be read: ${errorMessage(error)}`); }
  const root = rootOf(cwd, flags.root);
  const consumer = join(root, "clossys");
  const seat = readSeat(root, owning);
  if (seat && seat.llm && seat.llm !== "open" && (seat.llm.model !== flags.model || seat.llm.tier !== flags.tier)) return reject(`${owning.id}'s seat assigns ${seat.llm.model} at ${seat.llm.tier}, not ${flags.model} at ${flags.tier}`);
  const entry = readSlotEntry(consumer, agent as SlotAgent, slot);
  if (!entry) return reject(`unknown slot ${target} (not in ${agent} ia.json)`);
  const file = resolve(cwd, flags.submit);
  let bytes: string;
  try { bytes = readFileSync(file, "utf8"); } catch (error) { return reject(`cannot read ${flags.submit}: ${errorMessage(error)}`); }
  const schema = owning.packet?.write[0]?.schema ?? owning.outputs[0]?.schema;
  if (!schema) return reject(`${owning.id} names no output schema`);
  // R08.1: a candidate's stem is its slot's leaf or a record its contract declares, whatever the submitted file is called.
  const nameIssue = flags.name === undefined ? undefined : candidateStemIssue(slot, readSlot(consumer, agent as SlotAgent, slot).contract, flags.name);
  if (nameIssue) return reject(`--name ${flags.name} for ${target} ${nameIssue}; a candidate is named <leaf>-v<n> (R08.1)`);
  const stem = flags.name ?? slot.split(".").at(-1)!;
  const ext = file.endsWith(".json") ? "json" : "md";
  const schemaIssues = validateFile(schema, `clossys/agents/${agent}/${slot}/candidates/${stem}-v1.${ext}`, bytes, packageRoot);
  if (schemaIssues.length) return reject(`${flags.submit} fails schema ${schema}: ${schemaIssues.slice(0, 5).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  let content: unknown = bytes;
  if (ext === "json") { try { content = JSON.parse(bytes); } catch (error) { return reject(`${flags.submit} is not JSON: ${errorMessage(error)}`); } }
  // One source per candidate: a header kind and a body kind that disagree would let one reader judge a kind the guard never sees.
  const sources = submissionSources(content);
  if (new Set(sources.map(each => each.kind ?? "(none)")).size > 1) return reject(`source-kind-mismatch: ${sources.map(each => `${each.at} kind ${each.kind ?? "(none)"}`).join(", ")} disagree; fix: carry one source, the clossys header's (or meta.source of a body with no header)`);
  // A candidate byte-identical to one the slot holds adds no option: refused before anything is written.
  // The bytes writeCandidate would write: the slot kind's extension decides the serialization.
  const family = readSlot(consumer, agent as SlotAgent, slot).kind;
  const canonical = KIND_EXT[family] === "md" ? String(content) : jsonBytes(content);
  const digest = sha(canonical);
  // U37/U38: under clossys.slot/2 the submission is written as one clossys.candidate/1 file (records/slot-write.ts
  // submittedBytes, the one submit serializer: the header created by this submission's agent, skill, model and tier).
  // Its identity with a held candidate is judged on the bytes and on the content digest of the one candidate reader
  // (records/slots.ts readCandidate over slot-current.ts readCandidateText: the view and the header without its
  // per-file provenance). The probe is the bytes writeCandidate would write; a submission it refuses is refused
  // by writeCandidate below, in its order, with its message.
  let rawSlot: unknown;
  try { rawSlot = JSON.parse(readFileSync(join(entry.dir, "slot.json"), "utf8")); }
  catch (error) { return reject(`${target} slot.json cannot be read: ${errorMessage(error)}`); }
  const createdBy: Actor = { actor: "agent", agent: agent as AgentId, skill: contractSkill, skillSha256: sha(skillBytes), model: flags.model!, tier: flags.tier! as Tier };
  const probe = `${stem}-v1.${KIND_EXT[family]}`;
  let probeBytes = canonical;
  // Only the serializer's refusal of these bytes (CandidateRefusal) leaves the probe as the bytes themselves; any other
  // error is a fault and propagates.
  try { probeBytes = submittedBytes(entry.dir, agent as SlotAgent, slot, family, probe, canonical, "2000-01-01T00:00:00Z", createdBy); } catch (error) {
    if (!(error instanceof CandidateRefusal)) throw error;
    probeBytes = canonical;
  }
  const probeRead = readCandidateText(rawSlot, agent as ModelAgent, slot, probe, probeBytes);
  const contentDigest = probeRead.contentDigest;
  for (const name of entry.candidates) {
    // A held candidate that cannot be read is a broken record: its identity with the submission is unknown, so the
    // submission is refused with the cause, never judged against it as if it were absent.
    let held: { sha256: string; contentDigest: string };
    try { held = readCandidate(consumer, agent as SlotAgent, slot, name); }
    catch (error) { return reject(`${target} candidate ${name} cannot be read: ${errorMessage(error)}`); }
    if (held.sha256 === digest) return reject(`${flags.submit} is byte-identical to ${target} candidate ${name}; submit a candidate that differs`);
    if (held.contentDigest === contentDigest) return reject(`${flags.submit} has the same content as ${target} candidate ${name} (it differs only in header provenance or JSON layout); submit a candidate that differs`);
  }
  // P2 (adapt, create) only after the slot's latest verdict is create, for the latest options packet's inputs:
  // a slot-state precondition, refused after the submission's own content checks.
  const p2 = p2Refusal(entry.dir, agent, ladder!);
  if (p2) return reject(p2);
  // The recipe code chooses for the slot's standard decides the source kinds a P2 candidate may carry (recipe.json
  // sources), judged on the kind of the view the guard reads (the probe's view, the bytes writeCandidate writes).
  const p2Rung = ["adapt", "create"].includes(String(rungKind(agent, ladder!.rung)));
  const recipeRefused = craftRecipeRefusal(root, entry.dir, agent, String(readSlot(consumer, agent as SlotAgent, slot).standard ?? ""), viewSourceKind(probe, probeRead.view), flags.tier!, p2Rung);
  if (recipeRefused) return reject(recipeRefused);
  // The guard is absolute (section 4): the writer runs every constitution check whose rules.json
  // guard lists submit on the tree with the new file and its event in place, and refuses on any
  // finding about the new file, whatever the check's status and whether the slot had it before.
  const skill = { path: contractSkill, sha256: sha(skillBytes) };
  // The run decision is the submit event's provenance in the slot ledger (records/ledger.ts), not only the run record.
  let written: { name: string; sha256: string };
  try {
    written = writeCandidate(consumer, agent as SlotAgent, slot, stem, content, {
      canonical: true,
      provenance: { verb: "submit", by: flags.basis === "agent" ? `agent:${owning.id}` : flags.basis!, skill, model: flags.model!, tier: flags.tier! },
      fields: { basis: flags.basis!, rung: ladder!.rung, ...(ladder!.seed !== undefined ? { seed: ladder!.seed } : {}), ...(ladder!.reason !== undefined ? { reason: ladder!.reason } : {}), ladder: ladder! },
      guard,
      header: { createdBy },
    });
  } catch (error) {
    if (error instanceof GuardRefusal) return { ...reject(error.message), output: { schema: "clossys.next-submit-refused/1", slot: target, verb: error.verb, checks: error.checks, findings: error.findings } };
    return reject(error instanceof Error ? error.message : String(error));
  }
  const writtenFile = join(candidatesDir(slotDir(consumer, agent as SlotAgent, slot)), written.name);
  const outputPath = workspacePath(root, writtenFile) ?? `clossys/agents/${agent}/${slot}/candidates/${written.name}`;
  const runDecision = {
    model: flags.model!, tier: flags.tier!, basis: flags.basis!, ladder: ladder!,
    skill,
    output: { path: outputPath, sha256: written.sha256 },
  };
  return {
    exitCode: 0, root, runDecision, output: { schema: "clossys.next-submit/1", step: owning.id, slot: target, candidate: written.name, ...runDecision },
    message: `next --submit: ${target} candidate ${written.name} (${written.sha256.slice(0, 12)}) by ${flags.model} (${flags.tier}, ${flags.basis}, rung ${ladder!.rung}) with ${contractSkill} (${runDecision.skill.sha256.slice(0, 12)})`,
  };
}

type LedgerRow = Record<string, unknown>;

/**
 * Why a P2 submission (an adapt or create rung, or one closing an open craft run) is refused by its recipe, or
 * undefined. Code chooses the recipe (records/recipes.ts standardRecipe: the one recipe producing for the slot's
 * `standardId`), never the events: an open run whose events name another recipe, an unknown one or one not producing
 * the standard is refused (craftRunRecipeIssues); then the candidate's source `kind` (the view's, viewSourceKind) must
 * be one of that recipe's `sources` (recipeSourceIssue), and the submission's `tier` at or above the recipe's `tier`
 * (recipeTierIssue). A P2 rung with no open run on a slot whose standard has no one recipe refuses nothing here: R15.5
 * reports the standard.
 */
export function craftRecipeRefusal(root: string, slotDir: string, agent: string, standardId: string, kind: string | undefined, tier: string, p2Rung = false): string | undefined {
  const open = openCraftEvents((readLedger(slotDir, "slot")?.events ?? []) as unknown as LedgerRow[]);
  if (!open.length && !p2Rung) return undefined;
  const recipes = loadRecipes(root);
  const runIssues = craftRunRecipeIssues(open, recipes, agent, standardId);
  if (runIssues.length) return `craft-recipe: ${runIssues.join("; ")}; fix: craft the run under the recipe that produces for the slot's standard (clossys next --stage brief records it), naming no other`;
  const recipe = craftRunRecipe(open, recipes, agent, standardId);
  const issue = recipe && recipeSourceIssue(recipe, kind);
  if (issue) return `${issue}; fix: submit a ${recipe!.doc!.sources!.join(" or ")} candidate (meta.source.kind) that the recipe's checks (${(recipe!.doc!.checks ?? []).join(", ") || "none named"}) judge`;
  return recipe && recipeTierIssue(recipe, tier);
}

const isCreate = (event: LedgerRow | undefined) => !!event && (event.create === true || event.verdict === "create" || event.kind === "create");

/**
 * The P2 precondition (section 5, P2): an adapt or create rung needs the slot's latest `verdict`
 * event to be `create`, and when the latest `options` packet names an inputsHash the verdict must
 * carry the same one. Adopt needs no verdict. Returns the refusal, or undefined.
 */
export function p2Refusal(slotDir: string, agent: string, ladder: CandidateLadder): string | undefined {
  const kind = rungKind(agent, ladder.rung);
  if (kind !== "adapt" && kind !== "create") return undefined;
  const events = (readLedger(slotDir, "slot")?.events ?? []) as unknown as LedgerRow[];
  const verdict = [...events].reverse().find(event => event.op === "verdict");
  const options = [...events].reverse().find(event => event.op === "options");
  if (!isCreate(verdict)) return `rung ${ladder.rung} (${kind}) is P2, which needs the slot's latest verdict to be create; ${verdict ? `it is ${String(verdict.verdict ?? verdict.kind ?? "not create")}` : "the slot has no verdict"} (clossys options, then clossys verdict --record)`;
  const now = options?.inputsHash;
  if (typeof now === "string" && verdict!.inputsHash !== now) return `the slot's create verdict is for inputsHash ${String(verdict!.inputsHash ?? "none")}, not the latest options packet's ${now}; re-run P1`;
  return undefined;
}

/**
 * `clossys next <agent>/<slot> --stage <stage> ...` (also `clossys craft <stage> <agent>/<slot> ...`,
 * cli/craft.ts): one P2 craft stage (section 5b) as a `craft:<stage>` slot-ledger event through the
 * writer, which refuses a stage out of order (brief, diverge, render, critique, then at most 2
 * refine rounds), any stage under a plumb recipe (R15.7, the judge's predicate), a diverge outside
 * 3 to 4 directions and a diverge whose directions share a value on an axis. The brief is assembled here (cli/craft-brief.ts). Craft runs only on a P2 slot: its
 * latest verdict is create.
 */
export async function runNextStageCli(flags: Flags, cwd: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): Promise<CliResult> {
  const refuse = (message: string): CliResult => ({ exitCode: 1, unrecorded: true, message: `next --stage refused: ${message}` });
  const [target, ...extra] = flags.positional;
  if (!target) throw new CliUsageError(`next --stage needs <agent>/<slot>\n${NEXT_USAGE}`);
  if (extra.length) throw new CliUsageError(`Unexpected argument: ${extra[0]}\n${NEXT_USAGE}`);
  if (flags.submit !== undefined) throw new CliUsageError(`--stage and --submit are separate calls\n${NEXT_USAGE}`);
  const stage = flags.stage!;
  if (!(CRAFT_STAGES as readonly string[]).includes(stage)) throw new CliUsageError(`--stage must be ${CRAFT_STAGES.join(", ")}, got ${stage}\n${NEXT_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash), slot = target.slice(slash + 1);
  // A Producer seat slot (producer/seat.<step>) crafts like any slot; its step is the seats action (clossys seat writes the seat).
  const seat = agent === SEAT_AGENT && seatStepOf(slot) !== undefined;
  if (slash < 1 || !slot || !(seat || (SLOT_AGENTS as readonly string[]).includes(agent))) throw new CliUsageError(`next --stage target must be <agent>/<slot> with agent ${SLOT_AGENTS.join(", ")}, or producer/seat.<step>, got ${target}\n${NEXT_USAGE}`);
  for (const [flag, given] of [["--model", flags.model], ["--tier", flags.tier], ["--skill", flags.skill]] as const) if (!given) throw new CliUsageError(`next --stage requires ${flag}\n${NEXT_USAGE}`);
  if (!(SUBMIT_TIERS as readonly string[]).includes(flags.tier!)) throw new CliUsageError(`--tier must be ${SUBMIT_TIERS.join(", ")}, got ${flags.tier}\n${NEXT_USAGE}`);
  const owning = steps.find(each => each.id === (seat ? SEAT_STEP : `${agent}.candidates`));
  if (!owning) return refuse(`${target} is not a candidates slot of a defined step`);
  const contractSkill = owning.command.skill;
  if (!contractSkill || !isStepSkill(flags.skill!, owning, packageRoot, cwd)) return refuse(`--skill ${flags.skill} is not ${owning.id}'s skill (${contractSkill ?? "none"}, or the installed file it names)`);
  let skillBytes: Buffer;
  try { skillBytes = readFileSync(skillFile(owning, packageRoot)!); } catch (error) { return refuse(`${owning.id}'s skill ${contractSkill} cannot be read: ${errorMessage(error)}`); }
  const root = rootOf(cwd, flags.root);
  const consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, agent as ModelAgent, slot);
  if (!entry) return refuse(`unknown slot ${target} (not in ${agent} ia.json)`);
  // Craft is P2: checked as the agent's create rung (L4 for the Designer, create otherwise).
  const createRung = rungsOf(agent).find(rung => rungKind(agent, rung) === "create")!;
  const p2 = p2Refusal(entry.dir, agent, { rung: createRung });
  if (p2) return refuse(p2.replace(/^rung \S+ \(create\) is P2/, "craft is P2"));
  let fields: Record<string, unknown> = {};
  if (flags.file !== undefined) {
    try { fields = JSON.parse(readFileSync(resolve(cwd, flags.file), "utf8")) as Record<string, unknown>; }
    catch (error) { return refuse(`cannot read ${flags.file} as JSON: ${errorMessage(error)}`); }
    if (Array.isArray(fields)) fields = { directions: fields };
    if (!fields || typeof fields !== "object") return refuse(`${flags.file} is not a JSON object`);
  }
  if (flags.recipe !== undefined) fields = { ...fields, recipe: flags.recipe };
  if (stage === "brief") {
    // Stage 1 is assembled, not typed (foundry-feedback-0018): the pinned inputs, the contract and
    // the standard's requirements and taste anchors, refused here when any of them is missing.
    if (Object.hasOwn(fields, "assembled")) return refuse("the brief's assembled part is the CLI's (pinned inputs, contract, standard); drop assembled from --file");
    const { assembleBrief } = await import("./craft-brief.js");
    const made = assembleBrief(root, consumer, agent as SlotAgent, slot, flags.recipe);
    if ("refusal" in made) return refuse(`craft:brief refused: ${made.refusal}`);
    fields = { ...fields, assembled: made.brief };
  }
  // A --recipe naming the recipe code chooses for the slot's standard binds the stage's tier (recipeTierIssue), judged
  // after the brief's own refusals and before the event is written. A --recipe naming any other recipe is refused as
  // before (the brief's assembly, or craftRunRecipeIssues at the write).
  if (flags.recipe !== undefined) {
    const chosen = craftRunRecipe([], loadRecipes(root), agent, String(readSlot(consumer, agent as SlotAgent, slot).standard ?? ""));
    const belowTier = chosen?.id === flags.recipe ? recipeTierIssue(chosen, flags.tier!) : undefined;
    if (belowTier) return refuse(belowTier);
  }
  let event;
  try {
    event = appendCraftEvent(consumer, agent as ModelAgent, slot, stage as CraftStage, fields, {
      by: `agent:${owning.id}`, skill: { path: contractSkill, sha256: sha(skillBytes) }, model: flags.model!, tier: flags.tier!,
    });
  } catch (error) { return refuse(error instanceof Error ? error.message : String(error)); }
  return { exitCode: 0, root, output: { schema: "clossys.next-stage/1", slot: target, event }, message: `next --stage: ${target} ${event.op} by ${flags.model} (${flags.tier})` };
}
