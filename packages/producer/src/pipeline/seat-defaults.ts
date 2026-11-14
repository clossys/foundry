/**
 * pipeline/seats.json from the pipeline steps (SOURCE-MIGRATE step 5; records/slot-model/pipeline-seats.ts
 * reads it). One seat per decide step, in pipeline order, under its round (L1) and stage (L2). A
 * seat's default is what the step definition says: `by` its decider, the llm its skill at the mid
 * tier with the `<model:mid>` placeholder (the consumer's seat policy names the model), the human
 * part the skill's first prose line and the step's verb. The L1 and L2 labels are the only authored
 * words: they are kept from the current file, and a round or stage with no label fails the build.
 */
import { seatSlotId } from "../records/slot-model/types.js";
import { PIPELINE_SEATS_SCHEMA, type PipelineSeats, type SeatDefault } from "../records/slot-model/pipeline-seats.js";
import type { IaNode } from "../records/slot-model/types.js";
import { skillLine, skillOf, verbOf } from "./chain.js";
import { isDecide, ROUNDS, roundOf, STAGES } from "./define.js";
import type { Step } from "./define.js";
import { PACKAGE_ROOT } from "./options.js";

export const SEAT_DEFAULT_TIER = "mid" as const;

/** One decide step's package seat default. */
export function seatDefaultOf(step: Step, packageRoot: string = PACKAGE_ROOT): SeatDefault {
  const prompt = skillOf(step, packageRoot).path;
  return {
    by: step.decider === "owner" ? "owner" : `agent:${step.agent}`,
    llm: prompt ? { model: `<model:${SEAT_DEFAULT_TIER}>`, tier: SEAT_DEFAULT_TIER, promptFile: prompt } : null,
    human: { procedure: skillLine(step, packageRoot), command: verbOf(step) },
  };
}

/** The labels a seats file carries: `<round>` and `<round>.<stage>` ids to their label. */
export function seatLabels(doc: Pick<PipelineSeats, "nodes"> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of doc?.nodes ?? []) {
    out.set(node.id, node.label);
    for (const child of node.children) out.set(child.id, child.label);
  }
  return out;
}

/** The seats document the steps define; `labels` supplies every round and stage label. */
export function pipelineSeatsDoc(steps: readonly Step[], labels: ReadonlyMap<string, string>, packageRoot: string = PACKAGE_ROOT): PipelineSeats {
  const decide = steps.filter(isDecide);
  const label = (id: string) => {
    const value = labels.get(id);
    if (!value) throw new Error(`pipeline/seats.json: ${id} has no label; add it to the file's nodes`);
    return value;
  };
  const nodes: IaNode[] = [];
  for (const round of ROUNDS) {
    const children = STAGES.filter(stage => roundOf(stage) === round.id)
      .map(stage => ({ id: stage, slots: decide.filter(step => step.stage === stage).map(step => seatSlotId(step.id)) }))
      .filter(child => child.slots.length)
      .map(child => ({ id: child.id, label: label(child.id), slots: child.slots }));
    if (children.length) nodes.push({ id: round.id, label: label(round.id), children });
  }
  const seats: Record<string, SeatDefault> = {};
  for (const step of decide) seats[step.id] = seatDefaultOf(step, packageRoot);
  return {
    schema: PIPELINE_SEATS_SCHEMA,
    about: "The Producer seat tree: one seat.<step> slot per decide step, under its round and stage, and each seat's package default. Generated from the pipeline steps by scripts/generate-pipeline-seats.mjs; the labels are authored. The model is a tier placeholder the consumer's seat-policy.json fills.",
    nodes, seats,
  };
}
