import { defineStep } from "../define.js";
import type { Step } from "../define.js";
import { LIBRARY_ELEMENTS, candidatesOf, pinsOf, slotsOf } from "./ports.js";

const SKILL = { director: "packages/strategist/skill/SKILL.md", designer: "packages/designer/skill/SKILL.md", writer: "packages/writer/skill/SKILL.md", publisher: "packages/publisher/skill/SKILL.md" } as const;
const UPSTREAM = {
  director: ["clossys/agents/director/_evidence/*.md", "clossys/agents/strategist/findings/*.md"],
  designer: [pinsOf("director"), candidatesOf("director")],
  writer: [pinsOf("director"), candidatesOf("director"), candidatesOf("designer")],
  publisher: [pinsOf("designer"), candidatesOf("designer"), pinsOf("writer"), candidatesOf("writer")],
} as const;

/** Agent candidate creation: one immutable file per option, per L3 slot, written by the agent's skill. */
const candidates = (agent: keyof typeof SKILL, modules: readonly string[]): Step => defineStep({
  id: `${agent}.candidates`, kind: "decide:creative", actor: `agent:${agent}`, stage: "make",
  summary: `Create ${agent[0]!.toUpperCase()}${agent.slice(1)} candidates: one immutable file per option, per L3 slot.`,
  inputs: [...UPSTREAM[agent], slotsOf(agent)],
  outputs: [candidatesOf(agent)],
  command: { skill: SKILL[agent], module: modules }, checks: ["workspace"], open: `slots-without-candidates:${agent}`,
});

export const AGENT_STEPS = [
  candidates("director", ["src/records/slot-write.ts#writeCandidate"]),
  candidates("designer", ["src/records/slot-write.ts#writeCandidate", "src/specimen/catalog-materialization.ts#materializeCatalogCandidate"]),
  candidates("writer", ["src/records/slot-write.ts#writeCandidate"]),
  candidates("publisher", ["src/records/slot-write.ts#writeCandidate"]),
  defineStep({
    id: "designer.library", kind: "decide:creative", actor: "agent:designer", stage: "select",
    summary: "Adopt a Designer element version into the consumer library.",
    inputs: [pinsOf("designer"), candidatesOf("designer")],
    outputs: [LIBRARY_ELEMENTS, "clossys/library/**"],
    command: { skill: SKILL.designer, module: "src/records/library.ts#writeElementVersion" }, checks: ["studio-template"],
  }),
];
