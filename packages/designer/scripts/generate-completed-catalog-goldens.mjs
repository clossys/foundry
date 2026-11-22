#!/usr/bin/env node
// The completed-catalog goldens (src/catalog-core/__golden__/complete-consumption.json and complete-coverage.json)
// are generator output: the consumption report and materialized coverage of the completed fixture library, built by
// the one builder completed-catalog.test.ts compares them with (__fixtures__/completed-catalog-goldens.ts).
//   node scripts/generate-completed-catalog-goldens.mjs --check   exit 1 naming each stale golden
//   node scripts/generate-completed-catalog-goldens.mjs --write   write both goldens
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
if (!["--check", "--write"].includes(mode) || extra.length) { console.error("usage: generate-completed-catalog-goldens.mjs --check|--write"); process.exit(2); }
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(src).href + "/")) {
      for (const ext of [".ts", ".tsx"]) {
        const target = new URL(specifier.slice(0, -3) + ext, context.parentURL);
        if (existsSync(target)) return { url: target.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(src).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
    return next(url, context);
  },
});
const { loadCatalog } = await import(pathToFileURL(resolve(src, "catalog-core/index.ts")).href);
const { completedCatalogGoldens } = await import(pathToFileURL(resolve(src, "catalog-core/__fixtures__/completed-catalog-goldens.ts")).href);
const goldens = completedCatalogGoldens(loadCatalog());
const stale = [];
for (const [name, bytes] of Object.entries(goldens)) {
  const target = resolve(src, "catalog-core/__golden__", name);
  if (mode === "--write") { writeFileSync(target, bytes); continue; }
  let stored; try { stored = readFileSync(target, "utf8"); } catch { stored = undefined; }
  if (stored !== bytes) stale.push(relative(root, target));
}
if (stale.length) { for (const file of stale) console.error(`Completed-catalog golden stale: ${file}; run node scripts/generate-completed-catalog-goldens.mjs --write`); process.exit(1); }
console.log(`completed-catalog goldens ${mode === "--write" ? "written" : "current"}: ${Object.keys(goldens).join(", ")}`);
