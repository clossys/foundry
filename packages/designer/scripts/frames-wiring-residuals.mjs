#!/usr/bin/env node
// Generates src/catalog/reports/frames-wiring-residuals.json: the WL2/WL3/WL4 findings `checkWiring`
// still reports over the frame layer (src/frames + src/shell, registered component fills excluded).
// --check fails when the committed report differs from the scan. --write regenerates it, but only
// ever shrinks it: a finding absent from the committed report is a new defect, and --write refuses it.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const REPORT = "src/catalog/reports/frames-wiring-residuals.json";
const [mode, ...extra] = process.argv.slice(2);
assert(["--check", "--write"].includes(mode) && !extra.length, "usage: frames-wiring-residuals.mjs --check|--write");
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
const { framesWiringResiduals, residualGrowth } = await import(pathToFileURL(resolve(src, "catalog-core/frames-wiring-residuals.ts")).href);
const { checkWiring, foundryWiringExceptions } = await import(pathToFileURL(resolve(src, "catalog-core/wiring.ts")).href);

const read = path => readFileSync(resolve(root, path), "utf8");
const walk = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const next = framesWiringResiduals({ read, walk, checkWiring, exceptions: foundryWiringExceptions() });
const text = `${JSON.stringify(next, null, 2)}\n`;
const committed = existsSync(resolve(root, REPORT)) ? JSON.parse(read(REPORT)) : undefined;

if (mode === "--check") {
  if (!committed || read(REPORT) !== text) { console.error(`${REPORT} is stale: run node scripts/frames-wiring-residuals.mjs --write`); process.exit(1); }
  console.log(`${REPORT} is current (${next.residuals.length} residual findings).`);
} else {
  if (committed) {
    const added = residualGrowth(committed.residuals, next.residuals);
    if (added.length) { console.error(`refusing to grow ${REPORT}; new findings:\n${added.map(row => `  ${row.code} ${row.file} ${row.evidence}`).join("\n")}`); process.exit(1); }
  }
  writeFileSync(resolve(root, REPORT), text);
  console.log(`wrote ${REPORT} (${next.residuals.length} residual findings).`);
}
