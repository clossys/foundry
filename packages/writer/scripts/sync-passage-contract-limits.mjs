#!/usr/bin/env node
/**
 * Mirror passage copy budgets from the Writer catalog into the passage slot contracts.
 *
 * src/catalog/slots/passages.json is derived from Designer (derive-passages.mjs);
 * each copy field's `required` and `maxLength.en` is the budget. This script sets
 * src/slot-contracts/contracts/passages.json `limits.fields[key].required` and
 * `.maxChars` to match, leaving every other byte of the contract file as it is
 * (the file is canonical two-space JSON). Default mode checks; --write rewrites.
 *
 * OWNER_HOLDS keeps a field above its catalog budget while authored copy
 * (contract exemplars, or record values passed in) no longer fits that budget.
 * Each hold is an open owner decision: copy is never rewritten here, a hold never
 * loosens a limit beyond the value it already had, a hold must still be needed
 * (some exemplar exceeds floor(budget / 1.3), or some record exceeds the budget)
 * and a hold must be the smallest limit that keeps that copy inside its headroom.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const paths = {
  catalog: resolve(packageRoot, "src/catalog/slots/passages.json"),
  contracts: resolve(packageRoot, "src/slot-contracts/contracts/passages.json"),
};
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

export const OWNER_HOLDS = Object.freeze([
  {
    slot: "passages.sign-in-form",
    field: "actions.back",
    maxChars: 28,
    reason: "Exemplar \"Use a different email\" (21 chars) exceeds the 24-char action budget with 1.3 translation headroom (18); owner decides the exemplar or the budget.",
  },
]);

/** Exemplar headroom rule shared with the slot-contracts test: a value fits a limit when its length <= floor(limit / 1.3). */
export const exemplarCap = maxChars => Math.floor(maxChars / 1.3);

/** Smallest limit whose exemplar cap admits a value of `length` characters. */
export function smallestExemplarLimit(length) {
  let maxChars = length;
  while (exemplarCap(maxChars) < length) maxChars++;
  return maxChars;
}

/** Every exemplar value of `key` in a passage contract slot. */
export function exemplarValues(slot, key) {
  return (slot.references ?? []).flatMap(reference => reference.exemplars ?? [])
    .flatMap(exemplar => exemplar.fields && Object.hasOwn(exemplar.fields, key) ? [exemplar.fields[key]].flat() : []);
}

/**
 * Smallest limit a hold needs, or 0 when nothing needs it: exemplars over the
 * budget's headroom cap, and record values over the budget itself.
 */
export function holdNeed(slot, key, budget, recordValues = []) {
  const length = value => [...value].length;
  const exemplarNeed = exemplarValues(slot, key).filter(value => length(value) > exemplarCap(budget)).map(value => smallestExemplarLimit(length(value)));
  const recordNeed = recordValues.filter(value => length(value) > budget).map(length);
  return Math.max(0, ...exemplarNeed, ...recordNeed);
}

/**
 * Pure: returns the synced contracts document and the changed fields.
 * `records` optionally maps "<slot> <field>" to authored record values for that field.
 */
export function syncPassageContractLimits(catalog, contracts, holds = OWNER_HOLDS, records = new Map()) {
  if (!Array.isArray(catalog)) throw new Error("Catalog passages must be an array");
  if (contracts?.layer !== "passages" || !Array.isArray(contracts.slots)) throw new Error("Contracts must be the passages layer");
  const held = new Map(holds.map(hold => [`${hold.slot} ${hold.field}`, hold]));
  const used = new Set();
  const next = structuredClone(contracts);
  const bySlot = new Map(next.slots.map(slot => [slot.id, slot]));
  const changes = [];
  for (const { id, contract } of catalog) {
    const slot = bySlot.get(id);
    if (!slot) throw new Error(`No passage contract for catalog slot ${id}`);
    const fields = contract?.copy?.fields;
    if (!Array.isArray(fields)) throw new Error(`Catalog slot ${id} has no copy fields`);
    const contractKeys = Object.keys(slot.limits.fields).sort();
    const catalogKeys = fields.map(field => field.key).sort();
    if (JSON.stringify(contractKeys) !== JSON.stringify(catalogKeys)) throw new Error(`${id}: contract fields ${contractKeys.join(",")} differ from catalog fields ${catalogKeys.join(",")}`);
    for (const field of fields) {
      const limit = slot.limits.fields[field.key];
      const budget = field.maxLength?.en;
      if (!Number.isInteger(budget) || budget <= 0 || typeof field.required !== "boolean") throw new Error(`${id}: ${field.key} has no en budget`);
      const hold = held.get(`${id} ${field.key}`);
      let maxChars = budget;
      if (hold) {
        used.add(`${id} ${field.key}`);
        if (hold.maxChars <= budget) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} is not looser than the budget ${budget}; drop the hold`);
        if (hold.maxChars > limit.maxChars) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} is looser than the current limit ${limit.maxChars}; a hold never loosens`);
        const need = holdNeed(slot, field.key, budget, records.get(`${id} ${field.key}`) ?? []);
        if (need === 0) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} is no longer needed (all copy fits the budget ${budget}); drop the hold`);
        if (hold.maxChars !== need) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} is not the smallest limit that fits its copy (${need}); set the hold to ${need}`);
        maxChars = hold.maxChars;
      }
      if (limit.required !== field.required || limit.maxChars !== maxChars) {
        changes.push({ slot: id, field: field.key, from: { required: limit.required, maxChars: limit.maxChars }, to: { required: field.required, maxChars } });
        limit.required = field.required;
        limit.maxChars = maxChars;
      }
    }
  }
  const catalogIds = new Set(catalog.map(row => row.id));
  for (const slot of next.slots) if (!catalogIds.has(slot.id)) throw new Error(`Passage contract ${slot.id} has no catalog slot`);
  for (const key of held.keys()) if (!used.has(key)) throw new Error(`Owner hold ${key} matches no catalog field`);
  return { contracts: next, changes };
}

export function run(argv = process.argv.slice(2)) {
  let write = false;
  for (const argument of argv) {
    if (argument === "--write") write = true;
    else if (argument !== "--check") throw new Error("Usage: sync-passage-contract-limits.mjs [--check|--write]");
  }
  const source = readFileSync(paths.contracts, "utf8");
  const contracts = JSON.parse(source);
  if (canonical(contracts) !== source) throw new Error("Passage contracts are not canonical two-space JSON");
  const { contracts: next, changes } = syncPassageContractLimits(JSON.parse(readFileSync(paths.catalog, "utf8")), contracts);
  for (const change of changes) console.error(`${write ? "synced" : "stale"} ${change.slot} ${change.field}: ${change.from.maxChars} -> ${change.to.maxChars}`);
  for (const hold of OWNER_HOLDS) console.log(`owner hold ${hold.slot} ${hold.field} at ${hold.maxChars}: ${hold.reason}`);
  if (write && changes.length) writeFileSync(paths.contracts, canonical(next));
  console.log(`Writer passage contract limits: ${changes.length} ${write ? "synced" : "stale"}, ${OWNER_HOLDS.length} owner hold(s).`);
  return write ? 0 : changes.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`Writer passage contract sync refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
