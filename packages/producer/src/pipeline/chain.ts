/**
 * The chain runner (`clossys run`, `clossys next`): the registry walked in pipeline order, with no
 * model calls. Each plumb step runs its command (the contract's `chain`, else its `run`) unless its
 * latest run record is fresh (passed, no input changed since); the walk stops red at the first plumb
 * step that fails, and stops at the first decide step with open work, which `clossys next` hands out
 * as a fixed packet. Openness is read from real files only:
 *   - a step with an `open` counter is open while it counts anything (status.ts counters, per item);
 *   - a pick step (no counter) is open while its seat has an llm and its agent has undecided slots;
 *   - any other decide step is open while no file matches its outputs.
 * The orchestrators themselves are not steps and record nothing; every step they run records itself.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATES_DIR, FOLDER_KIND, SLOT_AGENTS } from "../records/slot-model/types.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import { isDecide } from "./define.js";
import type { Step } from "./define.js";
import { globRegex } from "./globs.js";
import { PACKAGE_ROOT } from "./options.js";
import { readSeats } from "./seats.js";
import type { SeatReport } from "./seats.js";
import { readJson, slotCounts, writerKeysUnapproved } from "./status.js";
import type { PipelineStatus } from "./status.js";
import { STEPS } from "./steps/index.js";
import { appendRecord, buildRecord, invocationOf, readStore, storeFile } from "./trace.js";
import type { StoredRun } from "./trace.js";
import { runState } from "./wiring.js";
import type { RunState } from "./wiring.js";

export const PACKET_SCHEMA = "clossys.next-packet/1";
export const CHAIN_SCHEMA = "clossys.chain-run/1";
export const EXPLAIN_SCHEMA = "clossys.chain-explain/1";

/** Runs one plumb step's command; returns its exit code. Tests inject their own. */
export type Exec = (argv: readonly string[], cwd: string) => number;
const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
/** The built CLI in a child process, its output on stderr so the chain's own output stays parseable. */
export const execCli: Exec = (argv, cwd) => spawnSync(process.execPath, [CLI, ...argv], { cwd, stdio: ["ignore", 2, 2], env: process.env }).status ?? 2;

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const words = (command: string) => command.trim().split(/\s+/);

// ---------------------------------------------------------------- plumb commands
export type ChainCommand =
  | { readonly argv: readonly string[]; readonly cwd: string; readonly invocation: string }
  | { readonly skip: string };

/** A step's package folder: this package for producer steps, its sibling for the others. */
export const packageDir = (step: Step, packageRoot = PACKAGE_ROOT): string => step.package === undefined || step.package === "producer" ? packageRoot : join(packageRoot, "..", step.package);

/** What `clossys run` executes for a plumb step, and the invocation its run record carries. */
export function chainCommand(step: Step, root: string, packageRoot = PACKAGE_ROOT): ChainCommand {
  const chain = step.chain ?? step.run;
  if (chain === undefined) return { skip: "no run" };
  if (typeof chain !== "string") return { skip: chain.skip };
  const argv = words(chain).slice(1);
  if (argv.some(word => /<[^>]+>/.test(word))) return { skip: `its run names placeholders and its contract names no chain command` };
  if (argv[0] === "pipeline" && argv[1] === "trace") {
    // A traced command is package-relative: it runs from the step's package folder.
    return { argv, cwd: packageDir(step, packageRoot), invocation: invocationOf(argv.slice(argv.indexOf("--") + 1)) };
  }
  return { argv, cwd: root, invocation: invocationOf(argv, step.command.cli?.target) };
}

/** The newest record of one step's invocation, or undefined when it never ran. */
export function latestRun(root: string, step: Step, invocation: string): StoredRun | undefined {
  return readStore(root, storeFile(step.id)).filter(run => run.record.invocation === invocation).at(-1);
}

// ---------------------------------------------------------------- open decisions
interface Context {
  readonly root: string;
  readonly steps: readonly Step[];
  readonly agents: PipelineStatus["agents"];
  readonly seats: Record<string, SeatReport>;
}
const contextOf = (root: string, steps: readonly Step[]): Context => ({ root, steps, agents: slotCounts(root), seats: readSeats(root, steps) });

/** Files under root matching a workspace glob (`*` within one segment; `**` is not expanded). */
function matches(root: string, glob: string): string[] {
  const path = glob.split("#")[0]!;
  if (path.startsWith("arg:") || path.startsWith("pkg:") || path.includes("**")) return [];
  let found = [""];
  for (const segment of path.split("/")) {
    const next: string[] = [];
    for (const base of found) {
      if (!segment.includes("*")) { if (existsSync(join(root, base, segment))) next.push(base ? `${base}/${segment}` : segment); continue; }
      const dir = join(root, base);
      let names: string[] = [];
      try { names = statSync(dir).isDirectory() ? readdirSync(dir) : []; } catch { names = []; }
      const pattern = globRegex(segment);
      for (const name of names.filter(name => !name.startsWith(".")).sort()) if (pattern.test(name)) next.push(base ? `${base}/${name}` : name);
    }
    found = next;
  }
  return found;
}

function iaSlots(root: string, agent: string): string[] {
  const ia = readJson(join(root, "clossys", "agents", agent, "ia.json")) as { nodes?: { children?: { slots?: unknown[] }[] }[] } | undefined;
  return (ia?.nodes ?? []).flatMap(node => (node.children ?? []).flatMap(child => (child.slots ?? []).filter((slot): slot is string => typeof slot === "string")));
}

const undecided = (context: Context, agent: string): string[] =>
  (context.agents[agent]?.bySlot ?? []).filter(row => !row.pinned && !row.notNeeded).map(row => `${agent}/${row.slot}`);

/** The open items of one decide step (slot `agent/slot`, seat step id, or the step id itself); empty when decided. */
export function openItems(step: Step, context: Context): string[] {
  if (!isDecide(step)) return [];
  const counter = step.open;
  const root = context.root;
  if (counter === "slots-without-slot-json") {
    const dir = join(root, "clossys", "agents");
    return (existsSync(dir) ? readdirSync(dir).sort() : [])
      // The seat tree's ia.json places seats, which have no slot.json (status.ts counts the same).
      .filter(agent => (FOLDER_KIND as Readonly<Record<string, string>>)[agent] !== "seat")
      .flatMap(agent => iaSlots(root, agent).filter(slot => !existsSync(join(dir, agent, slot, "slot.json"))).map(slot => `${agent}/${slot}`));
  }
  if (counter?.startsWith("slots-without-candidates:")) {
    const agent = counter.slice("slots-without-candidates:".length);
    return (context.agents[agent]?.bySlot ?? []).filter(row => row.candidates === 0).map(row => `${agent}/${row.slot}`);
  }
  if (counter?.startsWith("slots-undecided:")) return undecided(context, counter.slice("slots-undecided:".length));
  if (counter === "writer-keys-unapproved") return [...writerKeysUnapproved(root).keys()].map(slot => `writer/${slot}`);
  if (counter === "seats-open") return context.steps.filter(each => isDecide(each) && context.seats[each.id]?.state !== "assigned").map(each => each.id);
  const pick = /^pick\.([a-z][a-z0-9-]*)$/.exec(step.id);
  if (pick) {
    const seat = context.seats[step.id];
    return seat && seat.llm && seat.llm !== "open" ? undecided(context, pick[1]!) : [];
  }
  const outputs = step.outputs.filter(port => !port.glob.includes("#"));
  return outputs.length && outputs.every(port => matches(root, port.glob).length === 0) ? [step.id] : [];
}

// ---------------------------------------------------------------- packets
export interface PacketOption {
  readonly id: string;
  /** One line. */
  readonly label: string;
  readonly recommended: boolean;
  /** The exact `clossys` argv this answer records; null for the free-text answer. */
  readonly argv: readonly string[] | null;
  /** Placeholders in argv the answerer fills, with what each is. Empty when argv is exact. */
  readonly fill: Readonly<Record<string, string>>;
}
export interface Packet {
  readonly schema: typeof PACKET_SCHEMA;
  readonly step: string;
  readonly agent: string;
  readonly kind: Step["kind"];
  /** Who decides, from the seat: `owner pin`, `agent pick` or the seat's `by`. */
  readonly decider: string;
  readonly seat: { readonly state: SeatReport["state"] | "none"; readonly by: string | null; readonly llm: SeatReport["llm"] | null; readonly human: SeatReport["human"] | null };
  /** The open item: `<agent>/<slot>`, a seat's step id, or the step id. */
  readonly item: string;
  readonly open: number;
  readonly question: string;
  /** The decide step's skill (its contract path) and the sha256 of its bytes now. */
  readonly skill: { readonly path: string; readonly sha256: string | null };
  readonly inputs: {
    readonly brief: string | null;
    readonly contract: unknown;
    readonly options: { readonly count: number; readonly varyOn: string | null } | null;
    readonly files: readonly string[];
  };
  readonly output: { readonly path: string; readonly schema: string };
  readonly checks: readonly string[];
  /** The command that records the answer. */
  readonly record: string;
  /** Owner packets: 2 to 4 answers, the recommended one first, then the free-text answer. */
  readonly options?: readonly PacketOption[];
}

/** The decide step's skill file on disk (packages/<pkg>/actions/<id>/skill.md beside this package). */
export function skillFile(step: Step, packageRoot = PACKAGE_ROOT): string | null {
  if (!step.command.skill || !step.package) return null;
  return join(packageDir(step, packageRoot), "actions", step.id, "skill.md");
}
export function skillOf(step: Step, packageRoot = PACKAGE_ROOT): { path: string; sha256: string | null } {
  const file = skillFile(step, packageRoot);
  let digest: string | null = null;
  try { digest = file ? sha(readFileSync(file)) : null; } catch { digest = null; }
  return { path: step.command.skill ?? "", sha256: digest };
}
/** The skill's first prose line: the question the step answers. */
function skillLine(step: Step, packageRoot: string): string {
  const file = skillFile(step, packageRoot);
  try { return (file ? readFileSync(file, "utf8") : "").split("\n").map(line => line.trim()).find(line => line && !line.startsWith("#") && !line.startsWith("-")) ?? step.summary; }
  catch { return step.summary; }
}

const deciderOf = (step: Step, seat: SeatReport | undefined): string => {
  if (seat && seat.by) return seat.llm && seat.llm !== "open" ? `${seat.by} (llm ${seat.llm.model}, ${seat.llm.tier})` : seat.by;
  return step.decider === "owner" ? "owner pin" : "agent pick";
};

function slotDoc(root: string, item: string): { contract?: unknown; options?: number; varyOn?: string; kind?: string } | undefined {
  const [agent, slot] = [item.slice(0, item.indexOf("/")), item.slice(item.indexOf("/") + 1)];
  try { return readJson(join(root, "clossys", "agents", agent, slot, "slot.json")) as { contract?: unknown; options?: number; varyOn?: string } | undefined; }
  catch { return undefined; }
}
const candidatesOf = (root: string, item: string): string[] => {
  const dir = join(root, "clossys", "agents", ...item.split("/"), CANDIDATES_DIR);
  try { return readdirSync(dir).filter(name => !name.startsWith(".")).sort((a, b) => version(a) - version(b) || (a < b ? -1 : 1)); } catch { return []; }
};
const version = (name: string) => Number(/-v(\d+)\.[a-z]+$/.exec(name)?.[1] ?? 0);

/** Fill `<model:tier>` placeholders from `--model <tier>=<id>` answers. */
function filled(argv: string[], models: Readonly<Record<string, string>>): { argv: string[]; fill: Record<string, string> } {
  const fill: Record<string, string> = {};
  const out = argv.map(word => {
    const match = /^<model:(low|mid|high)>$/.exec(word);
    if (!match) return word;
    const id = models[match[1]!];
    if (id) return id;
    fill[word] = `the model id your account policy maps to the ${match[1]} tier`;
    return word;
  });
  return { argv: out, fill };
}

/** The verb that records a step's decision (its run's verb and target, never placeholders). */
const verbOf = (step: Step): string => step.run ? words(step.run).slice(0, 2).join(" ") : "clossys next";

function ownerOptions(step: Step, item: string, context: Context, packageRoot: string, models: Readonly<Record<string, string>>): PacketOption[] {
  const options: PacketOption[] = [];
  const add = (label: string, argv: string[] | null) => {
    const done = argv ? filled(argv, models) : { argv: null, fill: {} };
    options.push({ id: String.fromCharCode(97 + options.length), label, recommended: options.length === 0, argv: done.argv, fill: done.fill });
  };
  const root = context.root;
  if (step.id === "seats") {
    const target = context.steps.find(each => each.id === item)!;
    const human = (context.seats[item]?.human !== "open" ? context.seats[item]?.human : null) as { procedure: string; command: string } | null;
    const procedure = human?.procedure ?? skillLine(target, packageRoot);
    const command = human?.command ?? verbOf(target);
    const skill = skillOf(target, packageRoot).path;
    const owner = target.decider === "owner";
    const by = owner ? "owner" : `agent:${target.agent}`;
    const source = /^pick\.(.+)$/.exec(item)?.[1];
    const sourceSeat = source ? context.seats[`${source}.candidates`] : undefined;
    const seatArgs = (tier: string, model: string) => ["clossys", "seat", item, "--by", by, "--model", model, "--tier", tier, "--prompt-file", skill, "--procedure", procedure, "--command", command];
    if (sourceSeat && sourceSeat.llm && sourceSeat.llm !== "open") add(`The llm that made ${source}'s options picks (${sourceSeat.llm.model}, ${sourceSeat.llm.tier}); you confirm in Studio.`, seatArgs(sourceSeat.llm.tier, sourceSeat.llm.model));
    else if (owner) add("You decide; a mid-tier llm drafts a recommendation from the step's skill first.", seatArgs("mid", "<model:mid>"));
    else add(`The ${target.agent} agent does it at mid tier with its skill; you review the result in Studio.`, seatArgs("mid", "<model:mid>"));
    add(owner ? "You decide; a high-tier llm drafts the recommendation." : `The ${target.agent} agent does it at high tier.`, seatArgs("high", "<model:high>"));
    add("Human only, no llm: the seat stays listed open until an llm part is added.", ["clossys", "seat", item, "--by", by, "--no-llm", "--procedure", procedure, "--command", command]);
  } else if (step.id === "ia") {
    const [agent, slot] = [item.slice(0, item.indexOf("/")), item.slice(item.indexOf("/") + 1)];
    add(`Keep ${slot} where ia.json places it and give it its contract.`, ["clossys", "ia", item, "--contract", "<contract.json>"]);
    add(`Drop ${slot} from the ${agent} IA (it has no slot.json, candidates or pin).`, ["clossys", "ia", item, "--remove"]);
  } else if (step.id === "evidence") {
    add("Record your answer as owner evidence the Director cites.", ["clossys", "evidence", "<id>", "--source", "owner", "--observed", new Date().toISOString().slice(0, 10), "--by", "owner", "--body", "<answer.md>"]);
    add("Record a Director finding (observed by the Director, cited as a finding).", ["clossys", "evidence", "<id>", "--finding", "--source", "<source>", "--observed", new Date().toISOString().slice(0, 10), "--by", "agent:director", "--body", "<finding.md>"]);
  } else if (step.id === "workspace.config") {
    add("Start with the default workspace config (export default {}).", ["clossys", "config", "--init"]);
    add("Start from a config file you already have.", ["clossys", "config", "--init", "--from", "<clossys.config.ts>"]);
  } else if (step.id === "rules") {
    add("Start an empty rule registry; add each owner rule with clossys rule as you state it.", ["clossys", "rule", "--init"]);
    add("Record one owner rule now, unenforced until a check enforces it.", ["clossys", "rule", "<R-ID>", "--quote", "<your words>", "--date", new Date().toISOString().slice(0, 10), "--status", "unenforced"]);
  } else if (step.id === "writer.approve") {
    const names = candidatesOf(root, item).filter(name => name.endsWith(".md"));
    const keys = writerKeysUnapproved(root).get(item.slice("writer/".length)) ?? [];
    for (const name of names.slice(-3).reverse()) add(`Approve ${name}${name === names.at(-1) ? ` (its ${keys.length} new key${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""})` : ""}.`, ["clossys", "approve", item, name]);
  } else if (step.id.startsWith("pin.")) {
    const names = candidatesOf(root, item);
    for (const name of names.slice(-3).reverse()) add(`Pin ${name}.`, ["clossys", "pin", item, name, "--basis", "picked"]);
    add("Not needed: the slot ships nothing.", ["clossys", "pin", item, "--not-needed", "--reason", "<why>"]);
  }
  options.splice(4);
  options.push({ id: "other", label: "Something else: answer in your own words.", recommended: false, argv: null, fill: {} });
  return options;
}

function outputOf(step: Step, item: string): { path: string; schema: string } {
  const port = step.packet?.write[0] ?? step.outputs[0];
  const glob = port?.glob ?? "";
  if (item.includes("/") && glob.startsWith("clossys/agents/")) {
    const [agent, slot] = [item.slice(0, item.indexOf("/")), item.slice(item.indexOf("/") + 1)];
    return { path: glob.replace(`clossys/agents/${agent}/*`, `clossys/agents/${agent}/${slot}`).replace("clossys/agents/*/*", `clossys/agents/${agent}/${slot}`), schema: port?.schema ?? "" };
  }
  if (step.id === "seats") return { path: `clossys/agents/producer/${item}/pin.json`, schema: "seat" };
  return { path: glob, schema: port?.schema ?? "" };
}

/** The question a packet asks, one line. */
function questionOf(step: Step, item: string, context: Context, packageRoot: string): string {
  if (step.id === "seats") { const target = context.steps.find(each => each.id === item); return `Who decides ${item}${target ? ` (${target.summary.replace(/\.$/, "")})` : ""}?`; }
  if (step.id === "ia") return `Does ${item} belong in the IA, and what is its contract?`;
  if (step.id === "writer.approve") return `Approve the Writer copy for ${item}?`;
  if (step.id.startsWith("pin.")) return `Which candidate ships for ${item}?`;
  if (item.includes("/") && step.kind === "decide:creative") return `Draft ${item}'s candidates: ${skillLine(step, packageRoot)}`;
  if (item.includes("/")) return `Pick one of ${item}'s candidates.`;
  return skillLine(step, packageRoot);
}

export function packetOf(step: Step, item: string, open: number, context: Context, options: { packageRoot?: string; models?: Readonly<Record<string, string>> } = {}): Packet {
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const seat = context.seats[step.id];
  const agent = item.includes("/") ? item.slice(0, item.indexOf("/")) : step.agent ?? "";
  const doc = item.includes("/") && (SLOT_AGENTS as readonly string[]).includes(agent) ? slotDoc(context.root, item) : undefined;
  const briefStep = context.steps.find(each => each.agent === agent && each.kind === "plumb" && (each.command.cli?.flags ?? []).includes("--brief"));
  const slot = item.includes("/") ? item.slice(item.indexOf("/") + 1) : "<slot>";
  const record = step.kind === "decide:creative"
    ? `clossys next ${item} --submit <file> --model <model> --tier <tier> --basis <basis> --skill ${skillOf(step, packageRoot).path}`
    : step.run?.replace("<agent>/<slot>", item).replace(/(director|designer|writer|publisher)\/<slot>/, item.includes("/") ? item : `$1/${slot}`).replace("<step>", item) ?? verbOf(step);
  const packet: Packet = {
    schema: PACKET_SCHEMA, step: step.id, agent: step.agent ?? "", kind: step.kind, decider: deciderOf(step, seat),
    seat: seat ? { state: seat.state, by: seat.by, llm: seat.llm, human: seat.human } : { state: "none", by: null, llm: null, human: null },
    item, open, question: questionOf(step, item, context, packageRoot), skill: skillOf(step, packageRoot),
    inputs: {
      brief: briefStep?.run ? `${briefStep.run} --json` : null,
      contract: doc?.contract ?? null,
      options: doc && typeof doc.options === "number" ? { count: doc.options, varyOn: doc.varyOn ?? null } : null,
      files: step.packet?.inputs ?? [],
    },
    output: outputOf(step, item),
    checks: step.packet?.checks ?? step.checks,
    record,
  };
  return step.decider === "owner" ? { ...packet, options: ownerOptions(step, item, context, packageRoot, options.models ?? {}) } : packet;
}

/** Every open decide step's packets, in pipeline order (one per open item). */
export function openPackets(root: string, options: { steps?: readonly Step[]; packageRoot?: string; models?: Readonly<Record<string, string>>; owner?: boolean } = {}): Packet[] {
  const steps = options.steps ?? STEPS;
  const context = contextOf(root, steps);
  return steps.filter(step => isDecide(step) && (!options.owner || step.decider === "owner")).flatMap(step => {
    const items = openItems(step, context);
    return items.map(item => packetOf(step, item, items.length, context, options));
  });
}

/** The one open decide step's first packet: the step the chain stops at. */
export function nextPacket(root: string, options: { steps?: readonly Step[]; packageRoot?: string; models?: Readonly<Record<string, string>> } = {}): Packet | null {
  const steps = options.steps ?? STEPS;
  const context = contextOf(root, steps);
  for (const step of steps) {
    if (!isDecide(step)) continue;
    const items = openItems(step, context);
    if (items.length) return packetOf(step, items[0]!, items.length, context, options);
  }
  return null;
}

// ---------------------------------------------------------------- the walk
export type RowState = "fresh" | "ran" | "would-run" | "failed" | "skipped" | "decided" | "open" | "not-reached" | "outside";
export interface ChainRow {
  readonly step: string;
  readonly kind: Step["kind"];
  readonly state: RowState;
  readonly detail: string;
  /** The latest run record's state for the chain's invocation (plumb), or never-run. */
  readonly last: RunState;
  readonly changed: readonly string[];
}
export interface ChainResult {
  readonly schema: typeof CHAIN_SCHEMA;
  readonly dry: boolean;
  readonly rows: readonly ChainRow[];
  /** The decide step the walk stopped at, with its first packet. */
  readonly stop: { readonly step: string; readonly open: number; readonly decider: string; readonly packet: Packet } | null;
  /** The plumb step that failed, with its exit code and record. */
  readonly failed: { readonly step: string; readonly exit: number; readonly store: string | null } | null;
  /** Plumb steps whose latest record is stale (an input changed since), wherever they sit: the cascade. */
  readonly stale: readonly { readonly step: string; readonly changed: readonly string[] }[];
}
export interface ChainOptions {
  readonly from?: string;
  readonly until?: string;
  readonly dry?: boolean;
  readonly steps?: readonly Step[];
  readonly packageRoot?: string;
  readonly exec?: Exec;
}

function lastOf(root: string, step: Step, command: ChainCommand): { last: RunState; changed: string[]; run?: StoredRun } {
  if ("skip" in command) return { last: "never-run", changed: [] };
  const run = latestRun(root, step, command.invocation);
  if (!run) return { last: "never-run", changed: [] };
  const state = runState(root, run.record);
  return { last: state.state, changed: state.changed, run };
}

export function runChain(root: string, options: ChainOptions = {}): ChainResult {
  const steps = options.steps ?? STEPS;
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const exec = options.exec ?? execCli;
  const ids = steps.map(step => step.id);
  for (const [flag, id] of [["--from", options.from], ["--until", options.until]] as const) if (id !== undefined && !ids.includes(id)) throw new Error(`${flag} ${id}: no step has this id (clossys run --explain lists them)`);
  const from = options.from === undefined ? 0 : ids.indexOf(options.from);
  const until = options.until === undefined ? steps.length - 1 : ids.indexOf(options.until);
  if (until < from) throw new Error(`--until ${options.until} comes before --from ${options.from}`);
  const rows: ChainRow[] = [];
  let stop: ChainResult["stop"] = null;
  let failed: ChainResult["failed"] = null;
  let context = contextOf(root, steps);
  steps.forEach((step, index) => {
    const command = isDecide(step) ? null : chainCommand(step, root, packageRoot);
    const seen = command ? lastOf(root, step, command) : { last: "never-run" as RunState, changed: [] as string[] };
    const row = (state: RowState, detail: string, last = seen.last, changed = seen.changed) => rows.push({ step: step.id, kind: step.kind, state, detail, last, changed });
    if (index < from || index > until) return row("outside", index < from ? "before --from" : "after --until");
    if (stop || failed) return row("not-reached", `${stop ? `the chain stopped at ${stop.step}` : `the chain stopped red at ${failed!.step}`}${command && !("skip" in command) ? `; last run ${seen.last}` : ""}`);
    if (isDecide(step)) {
      const items = openItems(step, context);
      if (!items.length) return row("decided", "nothing open");
      const packet = packetOf(step, items[0]!, items.length, context, { packageRoot });
      stop = { step: step.id, open: items.length, decider: packet.decider, packet };
      return row("open", `${items.length} open (${items.slice(0, 3).join(", ")}${items.length > 3 ? ", ..." : ""}); decided by ${packet.decider}; clossys next`);
    }
    if ("skip" in command!) return row("skipped", command!.skip);
    const shown = `clossys ${command!.argv.join(" ")}`;
    if (seen.last === "passed") return row("fresh", `${shown}: inputs unchanged since its last run`);
    if (options.dry) return row("would-run", `${shown} (${seen.last}${seen.changed.length ? `: ${seen.changed.slice(0, 3).join(", ")}` : ""})`);
    const before = readStore(root, storeFile(step.id)).length;
    const start = new Date();
    const exit = exec(command!.argv, command!.cwd);
    const after = readStore(root, storeFile(step.id));
    let store: string | null = after.length > before || (after.length && after.at(-1)!.record.start >= start.toISOString()) ? after.at(-1)!.store : null;
    if (exit !== 0 && store === null) {
      // The command left no record (it could not start, or it is not recorded): the chain records the failure.
      const record = appendRecord(root, buildRecord({ root, step: step.id, invocation: command!.invocation, argv: [...command!.argv], start, end: new Date(), exit, observation: { reads: new Map(), writes: new Set() } }));
      store = record ? `${record.store}:${record.line}` : null;
    }
    const now = lastOf(root, step, command!);
    if (exit !== 0) {
      failed = { step: step.id, exit, store };
      return row("failed", `${shown} exited ${exit}`, now.last, now.changed);
    }
    // A plumb step may change what later decide steps count.
    context = contextOf(root, steps);
    return row("ran", `${shown} exited 0`, now.last, now.changed);
  });
  const stale = steps.flatMap(step => {
    if (isDecide(step)) return [];
    const command = chainCommand(step, root, packageRoot);
    const seen = lastOf(root, step, command);
    return seen.last === "stale" ? [{ step: step.id, changed: seen.changed }] : [];
  });
  return { schema: CHAIN_SCHEMA, dry: Boolean(options.dry), rows, stop, failed, stale };
}

// ---------------------------------------------------------------- explain
export interface ExplainRow {
  readonly step: string;
  readonly agent: string;
  readonly kind: Step["kind"];
  /** code for plumb; the seat's holder (or the contract's decider while the seat is open) for decide steps. */
  readonly decider: string;
  /** The latest run record's state across the step's invocations; never-run when it has none. */
  readonly last: RunState;
  readonly open: number;
}
export interface Explain {
  readonly schema: typeof EXPLAIN_SCHEMA;
  readonly rows: readonly ExplainRow[];
  readonly counts: Readonly<Record<Step["kind"], number>>;
}

/** The whole graph as one table: what `clossys run --explain` prints and `/api/pipeline/explain` serves. */
export function explainChain(root: string, options: { steps?: readonly Step[]; packageRoot?: string } = {}): Explain {
  const steps = options.steps ?? STEPS;
  const context = contextOf(root, steps);
  const rows = steps.map(step => {
    const records = readStore(root, storeFile(step.id));
    const latest = records.at(-1);
    const last: RunState = latest ? runState(root, latest.record).state : "never-run";
    const seat = context.seats[step.id];
    const decider = isDecide(step) ? (seat?.state === "assigned" ? deciderOf(step, seat) : `${step.decider ?? "owner"} (seat ${seat?.state ?? "none"})`) : "code";
    return { step: step.id, agent: step.agent ?? "", kind: step.kind, decider, last, open: openItems(step, context).length };
  });
  const counts = { plumb: 0, "decide:creative": 0, "decide:judgment": 0 } as Record<Step["kind"], number>;
  for (const row of rows) counts[row.kind]++;
  return { schema: EXPLAIN_SCHEMA, rows, counts };
}

export type { SlotAgent };
