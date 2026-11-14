/**
 * The seat certifier (R05): a Producer seat candidate fits its slot when the slot's contract is a
 * well-formed seat contract (`{step, fixture: {step}}`; the sample seat is package data,
 * pipeline/seats.json) and its step is a node of the step
 * graph (pipeline/graph.json). Its schema is seat.schema.json (`validateCandidate`). A seat, like
 * every slot, is certified only against its standard (planner decision, 2026-11-13): until one
 * exists the seat is uncertified (`no-standard`), never passed by default.
 */
import { seatContractIssues } from "../../records/slot-model/index.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import type { CertifyEnv } from "./env.js";
import { reason, type Reason } from "./types.js";

export function certifySeat(slot: SlotRecord, _candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  const out = seatContractIssues(contract, slot.id).map(issue => reason("fixture", issue.message));
  const step = typeof contract.step === "string" ? contract.step : undefined;
  if (step !== undefined && !env.steps.has(step)) out.push(reason("step", `step ${step} is no node of pipeline/graph.json`));
  return out;
}
