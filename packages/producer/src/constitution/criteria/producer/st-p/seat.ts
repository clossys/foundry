/**
 * Producer seat criteria (ST-P): a seat says who decides one pipeline step, which model and tier
 * runs it from which skill, and how a person does it by hand. Pure.
 */
import { isRecord, words } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";

const BY = /^(?:owner|planner|agent:(?:director|designer|writer|publisher|producer))$/;
const PROMPT = /^packages\/(director|designer|writer|publisher|producer)\/actions\/[a-z][a-z0-9.-]*\/skill\.md$/;

/** seat.assigned: `by` is owner, planner or agent:<agent>; an llm (when set) names a model, a low, mid or high tier and a packages/<agent>/actions/<step>/skill.md prompt; a human (when set) has a procedure sentence and a clossys command; at least one is set, and an owner seat keeps a human procedure. */
export const assigned: Criterion = subject => {
  const seat = subject.json;
  if (!isRecord(seat)) return ["the seat is not a JSON object"];
  const failures: string[] = [];
  if (typeof seat.by !== "string" || !BY.test(seat.by)) failures.push(`by ${JSON.stringify(seat.by)} is not owner, planner or agent:<agent>`);
  const llm = seat.llm, human = seat.human;
  if (llm !== null && llm !== undefined) {
    if (!isRecord(llm)) failures.push("llm is not an object or null");
    else {
      if (typeof llm.model !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(llm.model)) failures.push(`llm model ${JSON.stringify(llm.model)} is not a model id`);
      if (!["low", "mid", "high"].includes(llm.tier as string)) failures.push(`llm tier ${JSON.stringify(llm.tier)} is not low, mid or high`);
      if (typeof llm.promptFile !== "string" || !PROMPT.test(llm.promptFile)) failures.push(`llm promptFile ${JSON.stringify(llm.promptFile)} is not packages/<agent>/actions/<step>/skill.md`);
    }
  }
  if (human !== null && human !== undefined) {
    if (!isRecord(human)) failures.push("human is not an object or null");
    else {
      if (typeof human.procedure !== "string" || words(human.procedure).length < 6 || !/[.;:)]$/.test(human.procedure.trim())) failures.push("human procedure is not a full sentence of at least six words");
      if (typeof human.command !== "string" || !/^clossys [a-z][a-z-]*(?: .*)?$/.test(human.command)) failures.push(`human command ${JSON.stringify(human.command)} is not a clossys verb`);
    }
  }
  if (!isRecord(llm) && !isRecord(human)) failures.push("the seat sets neither an llm nor a human");
  if (seat.by === "owner" && !isRecord(human)) failures.push("an owner seat keeps a human procedure");
  return failures;
};

/** seat.prompt-owner: the llm prompt is a skill of the agent that holds the seat: `agent:<agent>` runs packages/<agent>/actions/<step>/skill.md; an owner or planner seat runs a Producer skill (packages/producer/...). */
export const promptOwner: Criterion = subject => {
  const seat = subject.json;
  if (!isRecord(seat)) return ["the seat is not a JSON object"];
  if (!isRecord(seat.llm)) return [];
  const match = typeof seat.llm.promptFile === "string" ? PROMPT.exec(seat.llm.promptFile) : null;
  if (!match) return [`llm promptFile ${JSON.stringify(seat.llm.promptFile)} is not packages/<agent>/actions/<step>/skill.md`];
  const owner = typeof seat.by === "string" && seat.by.startsWith("agent:") ? seat.by.slice("agent:".length) : "producer";
  return match[1] === owner ? [] : [`llm promptFile ${JSON.stringify(seat.llm.promptFile)} is a ${match[1]} skill; a seat held by ${JSON.stringify(seat.by)} runs a ${owner} skill`];
};
