#!/usr/bin/env node
// Checks the frame layer (src/frames + src/shell, registered component fills excluded) for the
// WL2/WL3/WL4 errors `checkWiring` reports. --check fails on any finding: there is no committed
// report, no budget and no write mode.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
assert(mode === "--check" && !extra.length, "usage: frames-wiring-residuals.mjs --check");
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
const { framesWiringResiduals } = await import(pathToFileURL(resolve(src, "catalog-core/frames-wiring-residuals.ts")).href);
const { checkWiring, foundryWiringExceptions } = await import(pathToFileURL(resolve(src, "catalog-core/wiring.ts")).href);

const read = path => readFileSync(resolve(root, path), "utf8");
const walk = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const residuals = framesWiringResiduals({ read, walk, checkWiring, exceptions: foundryWiringExceptions() });
if (residuals.length) {
  console.error(`frame layer has ${residuals.length} wiring findings:\n${residuals.map(row => `  ${row.code} ${row.file} ${row.evidence}`).join("\n")}`);
  process.exit(1);
}
console.log("frame layer wiring: 0 findings.");
