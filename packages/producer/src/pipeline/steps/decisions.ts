import { defineStep } from "../define.js";
import type { Stage } from "../define.js";
import { IA, SEATS, SEAT_PINS, SLOTS, candidatesOf, pinsOf, slotsOf } from "./ports.js";
import type { Agent } from "./ports.js";

/** One `clossys pin` step per agent, at the pin stage of the agent's round; You hold every one. */
const PIN_ROUNDS: readonly (readonly [Agent, Stage])[] = [["director", "direct.pin"], ["designer", "design.pin"], ["writer", "design.pin"], ["publisher", "publish.pin"]];

/** Owner and agent decisions: the only steps that may write decision files (decision-boundary.md). */
export const DECISION_STEPS = [
  defineStep({
    id: "ia", kind: "decide:judgment", actor: "owner", stage: "direct.brief",
    summary: "Place every L3 slot: the agent IA tree and each slot's contract.",
    inputs: [],
    outputs: [IA, SLOTS],
    command: { manual: "owner edits ia.json and slot.json" }, checks: ["workspace"], open: "slots-without-slot-json",
  }),
  defineStep({
    id: "evidence", kind: "decide:judgment", actor: "owner", stage: "direct.brief",
    summary: "Owner answers and director findings the Director cites.",
    inputs: [], outputs: ["clossys/evidence/director/*.md", "clossys/evidence/director/findings/*.md"],
    command: { manual: "owner records answers as evidence files" }, checks: ["workspace"],
  }),
  defineStep({
    id: "workspace.config", kind: "decide:judgment", actor: "owner", stage: "direct.brief",
    summary: "The workspace marker and config the CLI discovers.",
    inputs: [], outputs: ["clossys/clossys.config.ts"],
    command: { manual: "owner edits clossys.config.ts" }, checks: ["workspace"],
  }),
  defineStep({
    id: "seats", kind: "decide:judgment", actor: "owner", stage: "direct.brief",
    summary: "Who decides each decide step: an llm seat, a human seat, or both.",
    inputs: [], outputs: [SEATS, SEAT_PINS],
    command: { manual: "owner writes a seat candidate clossys/agents/producer/<step>/candidates/<step>-v<n>.json and pins it (pin.json)" }, checks: ["pipeline"], open: "seats-open",
  }),
  defineStep({
    id: "rules", kind: "decide:judgment", actor: "owner", stage: "direct.brief",
    summary: "Rule registry rows and gate yes/no.",
    inputs: [], outputs: ["scripts/rules/registry.json"],
    command: { manual: "owner approves rule rows and gates" }, checks: ["rules"],
  }),
  defineStep({
    id: "writer.approve", kind: "decide:judgment", actor: "owner", stage: "design.pin",
    summary: "Owner approves Writer copy keys (status approved).",
    inputs: [candidatesOf("writer")], outputs: ["clossys/agents/writer/*/candidates/*#status"],
    command: { manual: "owner sets a Writer key status to approved" }, checks: ["workspace"], open: "writer-keys-unapproved",
  }),
  ...PIN_ROUNDS.map(([agent, stage]) => defineStep({
    id: `pin.${agent}`, kind: "decide:judgment", actor: "owner", stage,
    summary: `Pin one candidate per ${agent[0]!.toUpperCase()}${agent.slice(1)} L3 slot, or mark the slot not needed.`,
    inputs: [candidatesOf(agent), slotsOf(agent)],
    outputs: [pinsOf(agent), `clossys/agents/${agent}/*/slot.json#notNeeded`],
    command: { cli: { verb: "pin", parser: "src/cli/pin.ts", target: agent }, entry: "src/cli/pin.ts#runPinCli" }, checks: ["decisions", "slot-state", "slot-pins", "pin-propagation", "every-candidate-previewable"],
    open: `slots-undecided:${agent}`,
  })),
  // An agent seat's pick: the same pin.json, written by clossys pick with basis agent at the agent's pin stage.
  // It may replace a bulk, planner or agent pin, never an owner pick (basis picked); Studio shows it as confirm.
  ...PIN_ROUNDS.map(([agent, stage]) => defineStep({
    id: `pick.${agent}`, kind: "decide:judgment", actor: "agent:judge", stage,
    summary: `A judge seat picks one of a ${agent[0]!.toUpperCase()}${agent.slice(1)} slot's options (pin basis agent); Studio shows confirm until the owner pins.`,
    inputs: [candidatesOf(agent), slotsOf(agent)],
    outputs: [`clossys/agents/${agent}/*/pin.json#basis`],
    command: { cli: { verb: "pick", parser: "src/cli/options.ts", target: agent }, entry: "src/cli/options.ts#runPickCli" }, checks: ["decisions", "slot-options"],
  })),
];
