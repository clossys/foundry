/**
 * The Producer seat tree is package data (SOURCE-MIGRATE step 5): pipeline/seats.json holds the
 * seat IA (one `seat.<step>` slot per decide step, under its round and stage, with the labels) and
 * each seat's package default (by, prompt file, default tier and the human procedure and command),
 * the model a tier placeholder `<model:tier>` the consumer's seat policy fills. It is generated from
 * the pipeline steps by scripts/generate-pipeline-seats.mjs; only the labels are authored.
 *
 * A consumer keeps its seat pins and seat-policy.json. Its producer ia.json and seat slot.json files
 * are `clossys ia sync` views of this file: a seat contract names its step only (`{step, fixture:
 * {step}}`), the sample seat is the package default here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCER_ROOT } from "../../package-path.js";
import type { IaNode } from "./types.js";

export const PIPELINE_SEATS_FILE = "pipeline/seats.json";
export const PIPELINE_SEATS_SCHEMA = "clossys.pipeline-seats/1";
/** The producer ia.json `source`: the package file the seat tree is generated from. */
export const PRODUCER_IA_SOURCE = `@clossys/producer#${PIPELINE_SEATS_FILE}`;

/** A seat's package default: seat.schema.json, the llm model a `<model:low|mid|high>` placeholder. */
export interface SeatDefault {
  readonly by: string;
  readonly llm: { readonly model: string; readonly tier: "low" | "mid" | "high"; readonly promptFile: string } | null;
  readonly human: { readonly procedure: string; readonly command: string } | null;
}
export interface PipelineSeats {
  readonly schema: typeof PIPELINE_SEATS_SCHEMA;
  readonly about: string;
  readonly nodes: readonly IaNode[];
  readonly seats: Readonly<Record<string, SeatDefault>>;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** pipeline/seats.json of this Producer package (or `root`); a malformed file throws. */
export function readPipelineSeats(root: string = PRODUCER_ROOT): PipelineSeats {
  const doc = JSON.parse(readFileSync(join(root, PIPELINE_SEATS_FILE), "utf8")) as unknown;
  if (!object(doc) || doc.schema !== PIPELINE_SEATS_SCHEMA || !Array.isArray(doc.nodes) || !object(doc.seats)) throw new Error(`${PIPELINE_SEATS_FILE}: not a ${PIPELINE_SEATS_SCHEMA} file`);
  const placed = new Set<string>();
  for (const node of doc.nodes as IaNode[]) for (const child of node.children) for (const id of child.slots) {
    if (placed.has(id)) throw new Error(`${PIPELINE_SEATS_FILE}: ${id} is placed twice`);
    placed.add(id);
    if (!Object.hasOwn(doc.seats, id.replace(/^seat\./, ""))) throw new Error(`${PIPELINE_SEATS_FILE}: ${id} has no seat default`);
  }
  for (const step of Object.keys(doc.seats)) if (!placed.has(`seat.${step}`)) throw new Error(`${PIPELINE_SEATS_FILE}: the seat default ${step} is not placed`);
  return doc as unknown as PipelineSeats;
}
