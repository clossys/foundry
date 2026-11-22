#!/usr/bin/env node
// Source-only evidence. --check checks reproducibility, never conformance or adoption.
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { measureFoundrySurfaces } from "./lib/foundry-surface-consumption.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const read = path => readFileSync(resolve(root, path), "utf8"), json = path => JSON.parse(read(path));
const [mode, ...extra] = process.argv.slice(2);
assert(["--check", "--write"].includes(mode) && !extra.length, "usage: sections-frames-coverage.mjs --check|--write");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(src).href + "/")) {
      const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(target)) return { url: target.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(src).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
    return next(url, context);
  },
});
const { buildSurfaceConsumption } = await import(pathToFileURL(resolve(src, "catalog-core/surface-consumption.ts")).href);
const { stableStringify } = await import(pathToFileURL(resolve(src, "catalog-core/stable.ts")).href);
const inventory = Object.fromEntries(["themes", "assets", "components", "sections", "frames"].map(layer => [layer, json(`src/catalog/slots/${layer}.json`)]));
// Expected leaves are the signed freeze plus its explicit amendment files, exactly as the source loader checks them.
const { checkFrozenLeafSets } = await import(pathToFileURL(resolve(src, "catalog-core/leaf-freeze.ts")).href);
for (const layer of ["themes", "assets", "components"]) {
  const ids = inventory[layer].map(row => row.id);
  assert.equal(new Set(ids).size, ids.length, `${layer} duplicate leaf`);
  assert.deepEqual(checkFrozenLeafSets([], ids.map(id => ({ id, layer })), [layer]).filter(finding => finding.source === "slots"), [], `${layer} signed leaf inventory changed`);
}
const leaves = nodes => nodes.flatMap(node => node.leaves ?? leaves(node.children));
for (const layer of ["sections", "frames"]) assert.deepEqual(inventory[layer].map(row => row.id).sort(), leaves(json(`src/catalog/ia/${layer}.json`).nodes).sort(), `${layer} IA differs from slots`);
// The report measures through the same scanner setup as the descriptor measurements
// (registered componentLeaf factory, native EmptyState ownership), never a second copy of it.
const { report, input } = measureFoundrySurfaces(root, buildSurfaceConsumption);
const { fills, sourceScans } = input;
const bytes = stableStringify(report);
assert.equal(bytes, stableStringify(buildSurfaceConsumption({ ...input, fills: [...fills].reverse(), sourceScans: [...sourceScans].reverse(), sections: [...inventory.sections].reverse(), frames: [...inventory.frames].reverse() })), "Nondeterministic surface consumption report");
const target = resolve(src, "catalog/reports/sections-frames-consumption.json");
if (mode === "--write") { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
else assert.equal(readFileSync(target, "utf8"), bytes, `Surface report stale: ${relative(process.cwd(), target)}; run node scripts/sections-frames-coverage.mjs --write`);
console.log(JSON.stringify({ mode, freshness: "current", ...report.summary, conformance: "unmeasured", adoption: "unmeasured" }));
