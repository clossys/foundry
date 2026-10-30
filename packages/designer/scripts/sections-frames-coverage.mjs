#!/usr/bin/env node
// Source-only evidence. --check checks reproducibility, never conformance or adoption.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { createSurfaceSourceScanner } from "./lib/surface-source-scan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), repo = resolve(root, "../.."), src = resolve(root, "src");
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
const inventory = Object.fromEntries(["tokens", "assets", "components", "sections", "frames"].map(layer => [layer, json(`src/catalog/slots/${layer}.json`)]));
for (const layer of ["tokens", "assets", "components"]) assert.deepEqual(inventory[layer].map(row => row.id).sort(), [...json(`src/catalog/ia/${layer}.leaf-freeze.json`).leafIds].sort(), `${layer} signed leaf inventory changed`);
const leaves = nodes => nodes.flatMap(node => node.leaves ?? leaves(node.children));
for (const layer of ["sections", "frames"]) assert.deepEqual(inventory[layer].map(row => row.id).sort(), leaves(json(`src/catalog/ia/${layer}.json`).nodes).sort(), `${layer} IA differs from slots`);
const docs = readdirSync(resolve(src, "catalog/fills/foundry")).filter(file => /^(?:components|sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(file)).sort().map(file => json(`src/catalog/fills/foundry/${file}`));
const metadata = doc => doc.$extensions["com.clossys.fill"];
// Only the two public repository-owned source roots are admitted. No dependency
// installation, product/private source traversal or network resolution occurs.
const packageRoots = ["designer", "publisher"].map(name => ({ name: JSON.parse(readFileSync(resolve(repo, `packages/${name}/package.json`), "utf8")).name, root: `packages/${name}/src` }));
const packages = Object.fromEntries(packageRoots.map(row => [row.name, row.root]));
const sourceCache = new Map();
const sourceRead = path => {
  if (!packageRoots.some(row => path.startsWith(row.root + "/")) || !/\.[cm]?tsx?$/.test(path) || /\.(?:test|check|spec|stories)\./.test(path)) return undefined;
  if (sourceCache.has(path)) return sourceCache.get(path);
  const absolute = resolve(repo, path);
  if (!existsSync(absolute)) return undefined;
  assert(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink(), "Source must be a regular in-repository file");
  const content = readFileSync(absolute, "utf8"); sourceCache.set(path, content); return content;
};
const graph = createSurfaceSourceScanner({ read: sourceRead, packages });
for (const doc of docs) {
  const meta = metadata(doc), entry = Object.values(doc[meta.slot.split(".")[0]])[0];
  const pointers = [meta.pin?.export, ...(meta.slot.startsWith("components.") ? Object.values(entry.propMap ?? {}) : [])];
  for (const pointer of pointers) if (typeof pointer === "string") graph.addOwner(graph.pointer(meta.pin?.package, pointer), meta.slot);
}
const fills = docs.map(metadata).filter(meta => /^(?:sections|frames)\./.test(meta.slot)).map(meta => ({ id: meta.id, slot: meta.slot, source: meta.source, pin: meta.pin }));
assert.equal(new Set(fills.map(row => row.id)).size, fills.length, "Duplicate surface fill");
const sourceScans = fills.map(fill => graph.scan({ fill: fill.id, packageName: fill.pin?.package, pointer: fill.pin?.export }));
const input = { ...inventory, fills, sourceScans, themeCss: read("styles/theme.css") + "\n" + read("styles/theme-keys.css") };
const report = buildSurfaceConsumption(input), bytes = stableStringify(report);
assert.equal(bytes, stableStringify(buildSurfaceConsumption({ ...input, fills: [...fills].reverse(), sourceScans: [...sourceScans].reverse(), sections: [...inventory.sections].reverse(), frames: [...inventory.frames].reverse() })), "Nondeterministic surface consumption report");
const target = resolve(src, "catalog/reports/sections-frames-consumption.json");
if (mode === "--write") { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
else assert.equal(readFileSync(target, "utf8"), bytes, "Surface report stale; run node scripts/sections-frames-coverage.mjs --write");
console.log(JSON.stringify({ mode, freshness: "current", ...report.summary, conformance: "unmeasured", adoption: "unmeasured" }));
