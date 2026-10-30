#!/usr/bin/env node
// Canonical current descriptor facts; historical reports and freeze validators are untouched.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureFoundrySurfaces } from "./lib/foundry-surface-consumption.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
assert(["--write", "--check"].includes(mode) && !extra.length, "usage: generate-surface-consumption.mjs --write|--check");
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
const { measurements, report } = measureFoundrySurfaces(root, buildSurfaceConsumption);
const target = resolve(src, "catalog/surface-consumption.data.json"), bytes = stableStringify(measurements);
if (mode === "--write") writeFileSync(target, bytes);
else assert.equal(readFileSync(target, "utf8"), bytes, "Surface descriptor measurements stale; run generate-surface-consumption.mjs --write");
const { generatedFoundrySectionFiles } = await import(pathToFileURL(resolve(src, "importers/foundry-sections.ts")).href);
const { generatedFoundryFrameFiles } = await import(pathToFileURL(resolve(src, "importers/foundry-frames.ts")).href);
const { generatedSpecimenPackageFiles } = await import(pathToFileURL(resolve(src, "importers/specimen-sections.ts")).href);
for (const [name, contents] of Object.entries({ ...generatedFoundrySectionFiles(), ...generatedFoundryFrameFiles(), ...generatedSpecimenPackageFiles() })) {
  const path = resolve(src, "catalog/fills/foundry", name);
  if (mode === "--write") writeFileSync(path, contents);
  else assert.equal(readFileSync(path, "utf8"), contents, `Generated descriptor stale: ${name}`);
}
console.log(JSON.stringify({ mode, descriptors: report.summary.descriptors, measured: report.summary.scanned, measurement: "source-only lower-bound", runtime: "unmeasured" }));
