#!/usr/bin/env node
// Descriptor writer only. Source observations come from the existing native measurement generator.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
assert(["--write", "--check"].includes(mode) && !extra.length, "usage: generate-specimen-package-catalog.mjs --write|--check");
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
const { generatedSpecimenSectionPackageFiles } = await import(pathToFileURL(resolve(src, "importers/specimen-sections.package.ts")).href);
const files = generatedSpecimenSectionPackageFiles();
for (const [name, text] of Object.entries(files)) {
  const path = resolve(src, "catalog/fills/foundry", name);
  if (mode === "--write") writeFileSync(path, text);
  else assert.equal(readFileSync(path, "utf8"), text, `Specimen package descriptor stale: ${name}`);
}
console.log(JSON.stringify({ mode, descriptors: Object.keys(files).length, measurement: "existing native source-consumption observations only" }));
