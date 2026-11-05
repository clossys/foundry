/**
 * R-PIPELINE-IS-CODE: every pipeline step is one `defineStep` call next to the
 * verb or module it runs. The graph (`clossys pipeline graph --json`) and the
 * committed `pipeline/graph.json` are built from these definitions; edges are
 * derived from output/input glob overlap and options from the verb's parser.
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

/** What runs a step. Entries and modules are `<package-relative file>#<export>`. */
export interface StepCommand {
  readonly cli?: StepCli;
  readonly entry?: string;
  readonly module?: string | readonly string[];
  readonly script?: string;
  readonly npm?: string;
  readonly skill?: string;
  readonly manual?: string;
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
  readonly pending?: { readonly branch: string };
}
export type Check = CheckInput;

/** Keys that would list graph structure by hand. Edges come from globs, options from parsers, config from the config schema. */
export const HAND_LISTED = ["edges", "next", "after", "before", "upstream", "downstream", "dependsOn", "options", "config", "configKeys"] as const;

const STEP_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const ACTOR = /^(owner|planner|code|agent:[a-z][a-z0-9-]*)$/;

export class StepDefinitionError extends Error {}

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
  if (!["cli", "entry", "module", "script", "npm", "skill", "manual", "steps"].some(key => (command as Record<string, unknown>)[key] !== undefined)) fail("command names nothing that runs it");
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
