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
 * OWNER_HOLDS keeps a field at its current contract limit when authored copy
 * (records or contract exemplars) no longer fits the catalog budget. Each hold is
 * an open owner decision: copy is never rewritten here, and a hold never loosens
 * a limit beyond the value it already had.
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
    maxChars: 120,
    reason: "Exemplar \"Use a different email\" (21 chars) exceeds the 24-char action budget with 1.3 translation headroom (18); owner decides the exemplar or the budget.",
  },
]);

/** Pure: returns the synced contracts document and the changed fields. */
export function syncPassageContractLimits(catalog, contracts, holds = OWNER_HOLDS) {
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
        if (hold.maxChars < budget) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} is tighter than the budget ${budget}; drop the hold`);
        if (hold.maxChars !== limit.maxChars) throw new Error(`${id}: ${field.key} hold ${hold.maxChars} differs from the current limit ${limit.maxChars}; a hold never loosens`);
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
