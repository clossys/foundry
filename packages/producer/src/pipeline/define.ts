/**
 * R-PIPELINE-IS-CODE and the step standard (docs/step-standard.md): every pipeline step is one action
 * contract, a data file at packages/<package>/actions/<id>/action.json, bound to its code by id
 * (steps/bindings.ts). `defineAction` turns a contract and its binding into the Step the runner, the
 * graph and the canvas read; `pipeline/actions.json` is the generated snapshot of every contract. The
 * graph (`clossys pipeline graph --json`) and the committed `pipeline/graph.json` are built from those
 * steps; edges are derived from output/input glob overlap and options from the verb's parser.
 *
 * Globs are workspace-relative. `pkg:` is relative to this package and `arg:`
 * is a caller-chosen path (a CLI argument).
 */
import { SLOT_AGENTS } from "../records/slot-model/types.js";

export const STEP_KINDS = ["plumb", "decide:creative", "decide:judgment"] as const;
export type StepKind = typeof STEP_KINDS[number];
/**
 * WHEN a step runs: the canvas's columns, grouped by round. Declared once here; every step names one
 * stage as `<round>.<stage>`, and check:pipeline fails a step whose stage is missing or not one of
 * these (stage.missing). The workflow is a cascade, Director, then Designer and Writer side by side,
 * then Publisher; each agent round is brief, make, pin, and You hold every pin.
 *   direct   the Director round
 *     brief     decide what to make: the IA, evidence, config, seats and rules
 *     make      the Director drafts candidates
 *     pin       You pin the Director slots
 *   design   the Designer and Writer round, in the same columns and their own lanes
 *     brief     derive each agent's brief from the pinned Director slots
 *     make      Designer and Writer draft candidates
 *     pin       You pin the Designer and Writer slots and approve Writer keys
 *     select    adopt pinned Designer elements into the library and choose the selection
 *   publish  the Publisher round
 *     make      the Publisher drafts page candidates from the Designer and Writer pins
 *     pin       You pin the Publisher slots
 *     assemble  compile every pin into sections, maps and specimens
 *     check     verify the assembled workspace and Studio
 *     publish   install and serve the published pages
 * Order is (round, stage): every stage of an earlier round comes before every stage of a later one.
 */
export const ROUNDS = [
  { id: "direct", stages: ["brief", "make", "pin"] },
  { id: "design", stages: ["brief", "make", "pin", "select"] },
  { id: "publish", stages: ["make", "pin", "assemble", "check", "publish"] },
] as const;
type RoundStage<R> = R extends { readonly id: infer I extends string; readonly stages: readonly (infer S extends string)[] } ? `${I}.${S}` : never;
export type Round = typeof ROUNDS[number]["id"];
/** `<round>.<stage>`, e.g. `design.make`. */
export type Stage = RoundStage<typeof ROUNDS[number]>;
/** Every stage in (round, stage) order: the canvas's columns left to right. */
export const STAGES: readonly Stage[] = Object.freeze(ROUNDS.flatMap(round => round.stages.map(stage => `${round.id}.${stage}` as Stage)));
/** A stage's round (`design` for `design.make`). */
export const roundOf = (stage: string): string => stage.slice(0, Math.max(0, stage.indexOf(".")));
/** A stage's name inside its round (`make` for `design.make`). */
export const stageName = (stage: string): string => stage.slice(stage.indexOf(".") + 1);

/** One input or output: a glob, an optional `#field` carve-out and the schema its files follow. */
export interface Port { readonly glob: string; readonly schema?: string }

export interface StepCli {
  readonly verb: string;
  /** The flags that select this step's mode of the verb; every one must exist in the verb's parser. */
  readonly flags?: readonly string[];
  /** A verb that parses its own argv names its parser module (package-relative). */
  readonly parser?: string;
  /** A verb whose first argument is `<agent>/<slot>`: the agent this step's mode acts on (`clossys pin designer/<slot>`). */
  readonly target?: string;
}

/**
 * What runs a step, derived from its contract's `run` and its binding (never written by hand).
 * Entries and modules are `<package-relative file>#<export>`.
 */
export interface StepCommand {
  readonly cli?: StepCli;
  readonly entry?: string;
  readonly module?: string | readonly string[];
  readonly script?: string;
  readonly npm?: string;
  readonly skill?: string;
  /** Retired: no step is run by hand. A decision names the clossys verb that records it, or is a listed gap. */
  readonly manual?: never;
  /** Steps whose single module this step composes, in order. */
  readonly steps?: readonly string[];
}

/** A step that lands (`adds`) or goes away (`removes`) on another branch. Pending is never passing. */
export interface Pending { readonly branch: string; readonly change: "adds" | "removes" }

/** Named counters of open decisions a decide step leaves, read from real files. */
export type OpenCounter = "slots-without-slot-json" | `slots-without-candidates:${string}` | "writer-keys-unapproved" | `slots-undecided:${string}` | "seats-open";

export interface StepInput {
  readonly id: string;
  readonly kind: StepKind;
  /** `code` for plumb; `owner`, `planner` or `agent:<name>` for decide steps. */
  readonly actor: string;
  readonly stage: Stage;
  readonly summary: string;
  readonly inputs: readonly (string | Port)[];
  readonly outputs: readonly (string | Port)[];
  readonly command: StepCommand;
  readonly checks: readonly string[];
  readonly pending?: Pending;
  readonly open?: OpenCounter;
  /** The standard fields an action contract adds (defineAction sets every one). */
  readonly agent?: ActionAgent;
  readonly package?: string;
  readonly run?: string;
  readonly gap?: ActionGap;
  readonly chain?: ActionChain;
  readonly pass?: ActionPass;
  readonly record?: typeof RUN_RECORD;
  readonly decider?: Decider;
  readonly packet?: ActionPacket;
  readonly uses?: readonly string[];
}

export interface Step extends Omit<StepInput, "inputs" | "outputs"> {
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  /** Decide steps only: the seat decision file (workspace-relative). */
  readonly seat?: string;
}

export interface CheckInput {
  readonly id: string;
  /** Package-relative check scripts. */
  readonly files?: readonly string[];
  /** Producer npm scripts. */
  readonly npm?: readonly string[];
  /** Root npm scripts. */
  readonly rootNpm?: readonly string[];
  /** A CLI verb that is the check. */
  readonly cli?: string;
  /** A clossys subcommand that is the check (`clossys pipeline check`). */
  readonly command?: string;
  readonly pending?: { readonly branch: string };
}
export type Check = CheckInput;

/** Keys that would list graph structure by hand. Edges come from globs, options from parsers, config from the config schema. */
export const HAND_LISTED = ["edges", "next", "after", "before", "upstream", "downstream", "dependsOn", "options", "config", "configKeys"] as const;

const STEP_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const ACTOR = /^(owner|planner|code|agent:[a-z][a-z0-9-]*)$/;

export class StepDefinitionError extends Error {}

// ---------------------------------------------------------------- the step standard
export const ACTION_SCHEMA = "clossys.action/1";
/** W1b's run-record format: every step writes `.clossys/runs/<step>.jsonl` rows of this schema. */
export const RUN_RECORD = "clossys.pipeline-run/1";
export const ACTION_AGENTS = ["director", "designer", "writer", "publisher", "producer", "owner"] as const;
export type ActionAgent = typeof ACTION_AGENTS[number];
export const DECIDERS = ["owner", "agent"] as const;
export type Decider = typeof DECIDERS[number];
/** Exit-code contract shared by every run and pass command: 0 pass, 1 findings, 2 could not run. */
export const EXIT_CONTRACT = Object.freeze({ pass: [0], fail: [1], error: [2] } as const);
export interface ActionPort { readonly glob: string; readonly schema: string }
export interface ActionPass { readonly command: string; readonly exit: { readonly pass: readonly number[]; readonly fail: readonly number[]; readonly error: readonly number[] } }
/** What a decide step's decider is handed (input globs), the files it writes (typed ports) and the checks they must pass. */
export interface ActionPacket { readonly inputs: readonly string[]; readonly write: readonly ActionPort[]; readonly checks: readonly string[] }
/**
 * A decision with no clossys verb yet: the backlog unit that adds one and the command it awaits.
 * check:step-standard fails a gap whose awaited verb the CLI now has (gap.stale).
 */
export interface ActionGap { readonly unit: string; readonly reason: string; readonly awaits: string }
/**
 * How `clossys run` executes a plumb step: the concrete command when the run names placeholders
 * (`<file>`), or `skip` with why the chain never runs it (a server, a caller-chosen target).
 * Absent, the chain runs `run` itself.
 */
export type ActionChain = string | { readonly skip: string };
/** packages/<package>/actions/<id>/action.json (pipeline/schemas/action.schema.json). */
export interface ActionContract {
  readonly schema: typeof ACTION_SCHEMA;
  readonly id: string;
  readonly agent: ActionAgent;
  readonly kind: StepKind;
  readonly stage: Stage;
  readonly summary: string;
  readonly run?: string;
  readonly gap?: ActionGap;
  readonly chain?: ActionChain;
  readonly inputs: readonly ActionPort[];
  readonly outputs: readonly ActionPort[];
  readonly pass: ActionPass;
  readonly record: typeof RUN_RECORD;
  readonly checks: readonly string[];
  readonly uses: readonly string[];
  readonly decider?: Decider;
  readonly packet?: ActionPacket;
  readonly skill?: "skill.md";
  readonly open?: OpenCounter;
  readonly pending?: Pending;
}
/** One row of the generated snapshot pipeline/actions.json: the contract and where it lives. */
export interface ActionSource { readonly package: string; readonly path: string; readonly contract: ActionContract }
/** The code a contract binds to by id (steps/bindings.ts): a handler entry, a verb's own parser, a script or modules. */
export interface Binding {
  readonly entry?: string;
  readonly parser?: string;
  readonly script?: string;
  readonly module?: string | readonly string[];
}

/** A parsed `run`: a clossys verb mode, or a traced command (`clossys pipeline trace <id> -- <command>`). */
export type ParsedRun =
  | { readonly form: "cli"; readonly verb: string; readonly flags: readonly string[]; readonly target?: string; readonly words: readonly string[] }
  | { readonly form: "trace"; readonly step: string; readonly command: readonly string[]; readonly npm?: string; readonly script?: string };

const TARGET = /^(director|designer|writer|publisher)\//;
/**
 * Read a run (or pass) command. Mode flags are bare `--flag` words not followed by a value; the target
 * is the first `<agent>/...` positional. `<...>` words are placeholders for caller values.
 */
export function parseRun(run: string): ParsedRun {
  const words = run.trim().split(/\s+/);
  if (words[0] !== "clossys" || !words[1]) throw new StepDefinitionError(`run ${JSON.stringify(run)} is not a clossys command`);
  if (words[1] === "pipeline" && words[2] === "trace") {
    const split = words.indexOf("--");
    const step = words[3];
    const command = split < 0 ? [] : words.slice(split + 1);
    if (!step || split !== 4 || command.length === 0) throw new StepDefinitionError(`run ${JSON.stringify(run)}: a traced run is clossys pipeline trace <id> -- <command>`);
    const npm = command[0] === "npm" && command[1] === "run" ? command.slice(2).find(word => !word.startsWith("-")) : undefined;
    const script = command[0] === "node" ? command.slice(1).find(word => !word.startsWith("-")) : undefined;
    return { form: "trace", step, command, ...(npm ? { npm } : {}), ...(script ? { script } : {}) };
  }
  const rest = words.slice(2);
  const flags: string[] = [];
  let target: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    if (word.startsWith("--")) {
      const next = rest[index + 1];
      if (next === undefined || next.startsWith("--")) flags.push(word);
      else index++;
    } else if (target === undefined && TARGET.test(word)) target = word.slice(0, word.indexOf("/"));
  }
  return { form: "cli", verb: words[1], flags, ...(target ? { target } : {}), words };
}

/**
 * The actor a contract implies: code for plumb; owner for an owner decision; the judge seat for an
 * agent's judgment (pick); the agent itself for its creative work (candidates).
 */
export const actorOf = (contract: Pick<ActionContract, "kind" | "decider" | "agent">): string =>
  contract.kind === "plumb" ? "code" : contract.decider === "owner" ? "owner" : contract.kind === "decide:judgment" ? "agent:judge" : `agent:${contract.agent}`;
/** A decide action's skill file, workspace-relative. */
export const actionSkillPath = (pkg: string, id: string): string => `packages/${pkg}/actions/${id}/skill.md`;

/**
 * The only way a contract becomes a step: its run and binding derive `command` (cli verb and mode,
 * handler entry, parser, npm script or script file, the decide skill), its kind and decider derive the
 * actor. Structural rules live in check:step-standard; this refuses only what cannot be built.
 */
export function defineAction(contract: ActionContract, binding: Binding | undefined, pkg: string): Step {
  const fail = (message: string): never => { throw new StepDefinitionError(`action ${contract.id}: ${message}`); };
  if (contract.schema !== ACTION_SCHEMA) fail(`schema must be ${ACTION_SCHEMA}`);
  if ((contract.run === undefined) === (contract.gap === undefined)) fail("names exactly one of run or gap");
  const decide = contract.kind !== "plumb";
  const skill = decide ? { skill: actionSkillPath(pkg, contract.id) } : {};
  let command: StepCommand;
  if (contract.run !== undefined) {
    const run = parseRun(contract.run);
    if (run.form === "cli") {
      if (!binding?.entry) fail(`clossys ${run.verb} needs a bound handler entry`);
      const cli: StepCli = { verb: run.verb, ...(run.flags.length ? { flags: run.flags } : {}), ...(binding!.parser ? { parser: binding!.parser } : {}), ...(run.target ? { target: run.target } : {}) };
      // A verb may also name the library modules its handler serves (designer.candidates: the catalog materializer).
      command = { cli, entry: binding!.entry, ...skill, ...(binding!.module ? { module: binding!.module } : {}) };
    } else {
      if (run.step !== contract.id) fail(`a traced run traces its own id, not ${run.step}`);
      if (!binding?.script) fail("a traced run needs its bound script");
      command = { ...(run.npm ? { npm: run.npm } : {}), script: binding!.script, ...skill };
    }
  } else {
    if (!decide) fail("only a decide action may be a gap; a plumb action names its run");
    command = { ...skill, ...(binding?.module ? { module: binding.module } : {}) };
  }
  return defineStep({
    id: contract.id, kind: contract.kind, actor: actorOf(contract), stage: contract.stage, summary: contract.summary,
    inputs: contract.inputs, outputs: contract.outputs, command, checks: contract.checks,
    ...(contract.pending ? { pending: contract.pending } : {}), ...(contract.open ? { open: contract.open } : {}),
    agent: contract.agent, package: pkg, ...(contract.run !== undefined ? { run: contract.run } : { gap: contract.gap! }),
    ...(contract.chain !== undefined ? { chain: contract.chain } : {}),
    pass: contract.pass, record: contract.record,
    ...(contract.decider ? { decider: contract.decider } : {}), ...(contract.packet ? { packet: contract.packet } : {}),
    uses: contract.uses,
  });
}

export const isDecide = (step: Pick<Step, "kind">): boolean => step.kind !== "plumb";
/** A decide step's seat: the pin of its seat folder (the pinned candidate is the seat; records/slots.ts readSeatText). */
export const seatPath = (id: string): string => `clossys/agents/producer/${id}/pin.json`;
const toPort = (value: string | Port): Port => typeof value === "string" ? { glob: value } : value;

export function defineStep(input: StepInput): Step {
  const fail = (message: string): never => { throw new StepDefinitionError(`step ${input.id}: ${message}`); };
  if (!STEP_ID.test(input.id)) fail("id must be a dotted lowercase name");
  if (!STEP_KINDS.includes(input.kind)) fail("kind must be plumb, decide:creative or decide:judgment");
  if (!ACTOR.test(input.actor)) fail("actor must be owner, planner, code or agent:<name>");
  if (input.kind === "plumb" && input.actor !== "code") fail("a plumb step's actor is code");
  if (input.kind !== "plumb" && input.actor === "code") fail("a decide step needs a deciding actor, not code");
  if (!STAGES.includes(input.stage)) fail(`stage must be one of ${STAGES.join(", ")}`);
  for (const key of HAND_LISTED) if (Object.hasOwn(input, key)) fail(`${key} is listed by hand; it is derived`);
  const command = input.command;
  if ((command as Record<string, unknown>).manual !== undefined) fail("manual is not a step form; name the clossys verb that records the decision, or list the step as a gap");
  if (!["cli", "entry", "module", "script", "npm", "skill", "steps"].some(key => (command as Record<string, unknown>)[key] !== undefined)) fail("command names nothing that runs it");
  if (command.cli && !command.entry) fail("a CLI step names its entry");
  if (command.cli?.target !== undefined && !(SLOT_AGENTS as readonly string[]).includes(command.cli.target)) fail(`cli.target must be one of ${SLOT_AGENTS.join(", ")}`);
  const step: Step = {
    ...input,
    inputs: input.inputs.map(toPort),
    outputs: input.outputs.map(toPort),
    ...(input.kind !== "plumb" ? { seat: seatPath(input.id) } : {}),
  };
  return Object.freeze(step);
}

export function defineCheck(input: CheckInput): Check {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) throw new StepDefinitionError(`check ${input.id}: id must be a lowercase name`);
  return Object.freeze({ ...input });
}
