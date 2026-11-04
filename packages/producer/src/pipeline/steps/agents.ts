import { defineStep } from "../define.js";
import type { Step } from "../define.js";

const SKILL = { director: "packages/strategist/skill/SKILL.md", designer: "packages/designer/skill/SKILL.md", writer: "packages/writer/skill/SKILL.md", publisher: "packages/publisher/skill/SKILL.md" } as const;
const CANDIDATE_SCHEMA = { director: "candidate-brief", designer: "candidate-element", writer: "candidate-strings", publisher: "candidate-publisher" } as const;
const UPSTREAM = {
  director: ["clossys/agents/director/_evidence/*.md", "clossys/agents/strategist/findings/*.md"],
  designer: ["clossys/agents/director/*/pin.json", "clossys/agents/director/*/candidates/*"],
  writer: ["clossys/agents/director/*/pin.json", "clossys/agents/director/*/candidates/*", "clossys/agents/designer/*/candidates/*"],
  publisher: ["clossys/agents/designer/*/pin.json", "clossys/agents/designer/*/candidates/*", "clossys/agents/writer/*/pin.json", "clossys/agents/writer/*/candidates/*"],
} as const;

/** Agent candidate creation: one immutable file per option, per L3 slot, written by the agent's skill. */
const candidates = (agent: keyof typeof SKILL, modules: readonly string[]): Step => defineStep({
  id: `${agent}.candidates`, kind: "decide:creative", actor: `agent:${agent}`, stage: "derive",
  summary: `Create ${agent[0]!.toUpperCase()}${agent.slice(1)} candidates: one immutable file per option, per L3 slot.`,
  inputs: [...UPSTREAM[agent], `clossys/agents/${agent}/*/slot.json`],
  outputs: [{ glob: `clossys/agents/${agent}/*/candidates/*`, schema: CANDIDATE_SCHEMA[agent] }],
  command: { skill: SKILL[agent], module: modules }, checks: ["workspace"], open: `slots-without-candidates:${agent}`,
});

export const AGENT_STEPS = [
  candidates("director", ["src/records/slot-write.ts#writeCandidate"]),
  candidates("designer", ["src/records/slot-write.ts#writeCandidate", "src/specimen/catalog-materialization.ts#materializeCatalogCandidate"]),
  candidates("writer", ["src/records/slot-write.ts#writeCandidate"]),
  candidates("publisher", ["src/records/slot-write.ts#writeCandidate"]),
  defineStep({
    id: "designer.library", kind: "decide:creative", actor: "agent:designer", stage: "derive",
    summary: "Adopt a Designer element version into the consumer library.",
    inputs: ["clossys/agents/designer/*/pin.json", "clossys/agents/designer/*/candidates/*"],
    outputs: ["clossys/library/*/*/v*/element.json", "clossys/library/**"],
    command: { skill: SKILL.designer, module: "src/records/library.ts#writeElementVersion" }, checks: ["studio-template"],
  }),
];
