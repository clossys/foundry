#!/usr/bin/env node
/**
 * The leaf retirement verb (owner D2 / LAD-1 / LAD-2, 2026-11-11). Retiring marks a placed leaf in
 * src/catalog/retired.json; the leaf stays placed and registered, so its id is never reused, and nothing is deleted.
 *
 *   node scripts/retire-leaf.mjs --id <leaf> --by <who> --reason <text> [--replaced-by <leaf>] [--at YYYY-MM-DD]
 *
 * loadBuildCatalog re-checks the same rules (catalog-core/retired-leaves.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const designer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYERS = ["themes", "assets", "components", "sections", "frames"];

const leavesOf = nodes => nodes.flatMap(node => "leaves" in node ? node.leaves : leavesOf(node.children));

/** leaf id -> layer, from the committed IA placement trees. */
export function placedLeaves(root = designer) {
  const placed = new Map();
  for (const layer of LAYERS) {
    const ia = JSON.parse(readFileSync(path.join(root, "src/catalog/ia", `${layer}.json`), "utf8"));
    for (const id of leavesOf(ia.nodes)) placed.set(id, layer);
  }
  return placed;
}

/** Pure: returns the new retired list, or throws with the refusal. */
export function retireLeaf(retired, placed, { id, by, reason, replacedBy, at }) {
  if (!id || !by || !reason) throw new Error("retire-leaf: --id, --by and --reason are required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new Error(`retire-leaf: --at must be YYYY-MM-DD, got ${at}`);
  if (!placed.has(id)) throw new Error(`retire-leaf: ${id} is not a placed leaf`);
  if (retired.some(entry => entry.id === id)) throw new Error(`retire-leaf: ${id} is already retired`);
  if (replacedBy !== undefined) {
    if (!placed.has(replacedBy)) throw new Error(`retire-leaf: replacement ${replacedBy} is not a placed leaf`);
    if (placed.get(replacedBy) !== placed.get(id)) throw new Error(`retire-leaf: replacement ${replacedBy} is in another layer`);
    if (replacedBy === id || retired.some(entry => entry.id === replacedBy)) throw new Error(`retire-leaf: replacement ${replacedBy} is retired`);
  }
  if (retired.some(entry => entry.replacedBy === id)) throw new Error(`retire-leaf: ${id} is the replacement of a retired leaf`);
  const entry = { id, retiredAt: at, ...(replacedBy === undefined ? {} : { replacedBy }), decidedBy: by, reason };
  return [...retired, entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function parse(argv) {
  const options = { at: new Date().toISOString().slice(0, 10) };
  const names = { "--id": "id", "--by": "by", "--reason": "reason", "--replaced-by": "replacedBy", "--at": "at" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    if (!key || argv[index + 1] === undefined) throw new Error(`retire-leaf: unknown or incomplete argument ${argv[index]}`);
    options[key] = argv[index + 1];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = path.join(designer, "src/catalog/retired.json");
    const next = retireLeaf(JSON.parse(readFileSync(file, "utf8")), placedLeaves(), parse(process.argv.slice(2)));
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`retired ${next.length} leaves`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
