import { defineStep } from "../define.js";
import { CANDIDATES, IA, PINS, SEATS, SLOTS, candidatesOf } from "./ports.js";

/** Owner and agent decisions: the only steps that may write decision files (decision-boundary.md). */
export const DECISION_STEPS = [
  defineStep({
    id: "ia", kind: "decide:judgment", actor: "owner", stage: "direct",
    summary: "Place every L3 slot: the agent IA tree and each slot's contract.",
    inputs: [],
    outputs: [IA, SLOTS],
    command: { manual: "owner edits ia.json and slot.json" }, checks: ["workspace"], open: "slots-without-slot-json",
  }),
  defineStep({
    id: "evidence", kind: "decide:judgment", actor: "owner", stage: "direct",
    summary: "Owner answers and strategist findings the Director cites.",
    inputs: [], outputs: ["clossys/evidence/director/*.md", "clossys/evidence/strategist/findings/*.md"],
    command: { manual: "owner records answers as evidence files" }, checks: ["workspace"],
  }),
  defineStep({
    id: "workspace.config", kind: "decide:judgment", actor: "owner", stage: "direct",
    summary: "The workspace marker and config the CLI discovers.",
    inputs: [], outputs: ["clossys/clossys.config.ts"],
    command: { manual: "owner edits clossys.config.ts" }, checks: ["workspace"],
  }),
  defineStep({
    id: "seats", kind: "decide:judgment", actor: "owner", stage: "direct",
    summary: "Who decides each decide step: an llm seat, a human seat, or both.",
    inputs: [], outputs: [SEATS],
    command: { manual: "owner writes clossys/agents/producer/<step>/seat.json" }, checks: ["pipeline"], open: "seats-open",
  }),
  defineStep({
    id: "rules", kind: "decide:judgment", actor: "owner", stage: "direct",
    summary: "Rule registry rows and gate yes/no.",
    inputs: [], outputs: ["scripts/rules/registry.json"],
    command: { manual: "owner approves rule rows and gates" }, checks: ["rules"],
  }),
  defineStep({
    id: "selection", kind: "decide:judgment", actor: "owner", stage: "pin",
    summary: "The consumer's component selection and release events.",
    inputs: ["clossys/library/**"], outputs: ["clossys/selection.json"],
    command: { module: "src/records/selection.ts#writeSelection" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.approve", kind: "decide:judgment", actor: "owner", stage: "pin",
    summary: "Owner approves Writer copy keys (status approved).",
    inputs: [candidatesOf("writer")], outputs: ["clossys/agents/writer/*/candidates/*#status"],
    command: { manual: "owner sets a Writer key status to approved" }, checks: ["workspace"], open: "writer-keys-unapproved",
  }),
  defineStep({
    id: "pin", kind: "decide:judgment", actor: "owner", stage: "pin",
    summary: "Pin one candidate per L3 slot, or mark the slot not needed.",
    inputs: [...CANDIDATES, SLOTS],
    outputs: [PINS, "clossys/agents/*/*/slot.json#notNeeded"],
    command: { cli: { verb: "pin", parser: "src/cli/pin.ts" }, entry: "src/cli/pin.ts#runPinCli" }, checks: ["decisions", "slot-state"],
    open: "slots-undecided",
  }),
];
