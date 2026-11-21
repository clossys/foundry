#!/usr/bin/env node
/**
 * stage-check (Producer): the maker's own check of a craft stage's output, run before the stage is
 * recorded (slot-constitution.md section 5b; foundry-feedback-0015, -0018). Every recipe under
 * packages/producer/recipes/ calls it.
 *
 *   clossys recipe check <recipe-id> brief   <slot> <brief.json>      [--root <dir>]
 *   clossys recipe check <recipe-id> diverge <slot> <directions.json> [--root <dir>]
 *   clossys recipe check <recipe-id> draft   <slot> <draft.json>      [--root <dir>]
 *
 * brief and diverge: the shared rules of stage-core.mjs, plus: the brief names the contract's step,
 * and every direction is a feasible seat (a holder of owner, planner or agent:<agent>; a hand of llm,
 * human or llm+human; an owner holds a human hand; an llm hand runs at a tier the seat policy maps,
 * a human-only hand at tier none).
 * draft: the seat meets seat.assigned and seat.prompt-owner (the 3S-ND worklist classes: an invalid
 * holder, a prompt of another agent), and, maker-only, its skill file exists, its model is the one
 * the seat policy maps to its tier, and a human-only policy leaves the llm unset.
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Exit 0 clean, 1 with one line per issue (rule id, the issue, the fix), 2 on a usage error.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGES, checkBriefWith, checkDivergeWith, checkDraftWith, isRecord, issue, readJson, runStageCli, words } from "./stage-core.mjs";

const AGENT = "producer";

const BY = /^(?:owner|planner|agent:(?:director|designer|writer|publisher|producer))$/;
const PROMPT = /^packages\/(director|designer|writer|publisher|producer)\/actions\/[a-z][a-z0-9.-]*\/skill\.md$/;
const HANDS = ["llm", "human", "llm+human"];

/** The seat policy: the model per tier and whether seats are human only. */
export function seatPolicy(root) {
  const path = join(root, "clossys", "seat-policy.json");
  if (!existsSync(path)) return { models: {}, humanOnly: false };
  const policy = readJson(path);
  return { models: isRecord(policy.models) ? policy.models : {}, humanOnly: policy.humanOnly === true };
}
const stepOf = world => isRecord(world.slotDoc.contract) && typeof world.slotDoc.contract.step === "string" ? world.slotDoc.contract.step : undefined;

const HOOKS = {
  brief(root, world, brief, out) {
    const step = stepOf(world);
    if (!step) out.push(issue("R15.1", `${world.slot} contract names no step`, "fix the seat slot's contract before crafting"));
    else if (brief.step !== step) out.push(issue("R15.7", `the brief names step ${JSON.stringify(brief.step)}; the contract names ${step}`, `set "step": "${step}"`));
  },
  direction(root, world, direction, at, out) {
    const axes = isRecord(direction.axes) ? direction.axes : {};
    const { holder, tier, hand } = axes;
    const policy = seatPolicy(root);
    if (typeof holder !== "string" || !BY.test(holder)) out.push(issue("R15.7", `${at} holder ${JSON.stringify(holder)} is not owner, planner or agent:<agent>`, "set holder to owner, planner or agent:<agent>"));
    if (!HANDS.includes(hand)) { out.push(issue("R15.7", `${at} hand ${JSON.stringify(hand)}`, `set hand to ${HANDS.join(", ")}`)); return; }
    if (holder === "owner" && !hand.includes("human")) out.push(issue("R15.7", `${at} is an owner seat with no human hand`, "an owner seat keeps a human procedure: use human or llm+human"));
    if (hand.includes("llm")) {
      if (policy.humanOnly) out.push(issue("R15.7", `${at} runs an llm while the seat policy is human only`, "use hand human, or change the seat policy with clossys seat --policy first"));
      else if (typeof tier !== "string" || typeof policy.models[tier] !== "string") out.push(issue("R15.7", `${at} tier ${JSON.stringify(tier)} has no model in clossys/seat-policy.json`, `use a mapped tier: ${Object.keys(policy.models).join(", ") || "(none)"}`));
    } else if (tier !== "none") out.push(issue("R15.7", `${at} is human only but sets tier ${JSON.stringify(tier)}`, 'set tier to "none" for a human-only seat'));
  },
};

export const checkBrief = (root, slot, brief) => checkBriefWith(root, AGENT, slot, brief, HOOKS);
export const checkDiverge = (root, slot, file) => checkDivergeWith(root, AGENT, slot, file, HOOKS);

// ---- draft --------------------------------------------------------------------------------------

export const DRAFT_CHECKS = Object.freeze({
  "seat.assigned": draft => {
    const seat = draft.json;
    if (!isRecord(seat)) return [{ what: "the seat is not a JSON object", fix: 'write {"by", "llm", "human"}' }];
    const out = [];
    if (typeof seat.by !== "string" || !BY.test(seat.by)) out.push({ what: `by ${JSON.stringify(seat.by)} is not owner, planner or agent:<agent>`, fix: "set by to owner, planner or agent:<director|designer|writer|publisher|producer>" });
    const { llm, human } = seat;
    if (llm !== null && llm !== undefined) {
      if (!isRecord(llm)) out.push({ what: "llm is not an object or null", fix: 'set llm to {"model", "tier", "promptFile"} or null' });
      else {
        if (typeof llm.model !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(llm.model)) out.push({ what: `llm model ${JSON.stringify(llm.model)} is not a model id`, fix: "use the model id the seat policy maps to the tier" });
        if (!["low", "mid", "high"].includes(llm.tier)) out.push({ what: `llm tier ${JSON.stringify(llm.tier)} is not low, mid or high`, fix: "set tier to low, mid or high" });
        if (typeof llm.promptFile !== "string" || !PROMPT.test(llm.promptFile)) out.push({ what: `llm promptFile ${JSON.stringify(llm.promptFile)} is not packages/<agent>/actions/<step>/skill.md`, fix: "point promptFile at the holder's skill file" });
      }
    }
    if (human !== null && human !== undefined) {
      if (!isRecord(human)) out.push({ what: "human is not an object or null", fix: 'set human to {"procedure", "command"} or null' });
      else {
        if (typeof human.procedure !== "string" || words(human.procedure).length < 6 || !/[.;:)]$/.test(human.procedure.trim())) out.push({ what: "human procedure is not a full sentence of at least six words", fix: "write the by-hand procedure as a sentence of six words or more, ending in punctuation" });
        if (typeof human.command !== "string" || !/^clossys [a-z][a-z-]*(?: .*)?$/.test(human.command)) out.push({ what: `human command ${JSON.stringify(human.command)} is not a clossys verb`, fix: 'set command to "clossys <verb> ..."' });
      }
    }
    if (!isRecord(llm) && !isRecord(human)) out.push({ what: "the seat sets neither an llm nor a human", fix: "set an llm, a human, or both" });
    if (seat.by === "owner" && !isRecord(human)) out.push({ what: "an owner seat has no human procedure", fix: "give the owner seat a human procedure" });
    return out;
  },
  "seat.prompt-owner": draft => {
    const seat = draft.json;
    if (!isRecord(seat)) return [{ what: "the seat is not a JSON object", fix: 'write {"by", "llm", "human"}' }];
    if (!isRecord(seat.llm)) return [];
    const match = typeof seat.llm.promptFile === "string" ? PROMPT.exec(seat.llm.promptFile) : null;
    if (!match) return [{ what: `llm promptFile ${JSON.stringify(seat.llm.promptFile)} is not packages/<agent>/actions/<step>/skill.md`, fix: "point promptFile at the holder's skill file" }];
    const owner = typeof seat.by === "string" && seat.by.startsWith("agent:") ? seat.by.slice("agent:".length) : "producer";
    return match[1] === owner ? [] : [{ what: `llm promptFile is a ${match[1]} skill; a seat held by ${JSON.stringify(seat.by)} runs a ${owner} skill`, fix: `use a skill under packages/${owner}/actions/, or hold the seat as agent:${match[1]}` }];
  },
});

/** Maker-only: the skill file exists, the model is the policy's for the tier, a human-only policy has no llm. */
function draftExtra(root, world, draft) {
  const seat = draft.json;
  if (!isRecord(seat)) return [];
  const out = [];
  const policy = seatPolicy(root);
  if (isRecord(seat.llm)) {
    const { model, tier, promptFile } = seat.llm;
    if (policy.humanOnly) out.push(issue("R20", "the seat runs an llm while clossys/seat-policy.json is human only", "set llm to null"));
    if (typeof promptFile === "string" && PROMPT.test(promptFile) && !existsSync(join(PACKAGES, promptFile.slice("packages/".length)))) out.push(issue("R07", `promptFile ${promptFile} does not exist`, "point at an existing skill file, or request the skill from its agent first"));
    const mapped = typeof tier === "string" ? policy.models[tier] : undefined;
    if (typeof mapped === "string" && model !== mapped) out.push(issue("R20", `llm model ${JSON.stringify(model)} is not the seat policy's ${mapped} for tier ${tier}`, `set model to ${mapped}, or change the seat policy with clossys seat --policy first`));
  }
  return out;
}

export const checkDraft = (root, slot, draft) => checkDraftWith(root, AGENT, slot, draft, DRAFT_CHECKS, draftExtra);

export const main = (argv, cwd = process.cwd()) => runStageCli(AGENT, { brief: checkBrief, diverge: checkDiverge, draft: checkDraft }, argv, cwd);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2));
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
