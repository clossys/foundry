#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Reproducible source-only evidence: freshness is not a dogfood conformance clearance.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
if (!["--check", "--write"].includes(mode) || extra.length) {
  console.error("usage: page-dogfood.mjs --check|--write"); process.exitCode = 2;
} else {
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
  const { runDogfood } = await import(pathToFileURL(resolve(src, "catalog-core/dogfood.ts")).href);
  const { dogfoodSources } = await import(pathToFileURL(resolve(src, "library-cli/cli.ts")).href);
  const { stableStringify } = await import(pathToFileURL(resolve(src, "catalog-core/stable.ts")).href);
  const tokens = JSON.parse(readFileSync(resolve(src, "catalog/slots/tokens.json"), "utf8"));
  const themeCss = readFileSync(resolve(root, "styles/theme.css"), "utf8");
  const sources = await dogfoodSources([resolve(src, "studio")], root);
  const report = runDogfood({ ...sources, tokens, themeCss, now: "2026-10-24" });
  // No time-dependent exceptions or inferred clearances are supplied to this baseline.
  const output = stableStringify(report), path = resolve(src, "catalog/reports/page-dogfood.json");
  if (mode === "--write") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, output); }
  else if (!existsSync(path) || readFileSync(path, "utf8") !== output) { console.error("page-dogfood report is stale; run node scripts/page-dogfood.mjs --write"); process.exitCode = 1; }
  if (!process.exitCode) console.log(`page-dogfood report ${mode === "--write" ? "written" : "current"}: ${report.summary.elements} elements; ${report.findings.length} findings (${report.ok ? "clean" : "unresolved; report freshness only"})`);
}
