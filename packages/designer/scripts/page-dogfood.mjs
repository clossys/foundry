#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Reproducible source-only evidence over the Studio pages.
//   --check      conformance: fails while the report is not clean (`ok: false`) or is stale. Freshness alone is
//                never a dogfood clearance.
//   --freshness  the committed report matches what the sources produce now (its findings are not judged).
//   --write      rewrites the committed report.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
export const MODES = ["--check", "--freshness", "--write"];

/**
 * The verdict of one run: the exit code and the lines to print. `existing` is the committed report's text
 * (undefined when absent); `output` is the report the sources produce now.
 */
export function dogfoodVerdict({ mode, report, output, existing }) {
  const errors = [], stale = existing !== output;
  if (mode !== "--write" && stale) errors.push("page-dogfood report is stale; run node scripts/page-dogfood.mjs --write");
  if (mode === "--check" && !report.ok) {
    const rules = {};
    for (const finding of report.findings ?? []) { const code = finding.code ?? finding.rule ?? "unknown"; rules[code] = (rules[code] ?? 0) + 1; }
    const byRule = Object.entries(rules).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([rule, count]) => `${rule} ${count}`).join(", ");
    errors.push(`page-dogfood: pages do not dogfood the design system: ok:false, ${report.findings?.length ?? 0} findings (${byRule || "none listed"})`);
  }
  const state = mode === "--write" ? "written" : mode === "--freshness" ? "current" : "clean";
  const lines = errors.length ? [] : [`page-dogfood report ${state}: ${report.summary?.elements ?? 0} elements; ${report.findings?.length ?? 0} findings${mode === "--freshness" ? " (freshness only; --check judges them)" : ""}`];
  return { exitCode: errors.length ? 1 : 0, errors, lines };
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!MODES.includes(mode) || extra.length) {
    console.error("usage: page-dogfood.mjs --check|--freshness|--write"); process.exitCode = 2; return;
  }
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
  const themes = JSON.parse(readFileSync(resolve(src, "catalog/slots/themes.json"), "utf8"));
  const themeCss = readFileSync(resolve(root, "styles/theme.css"), "utf8");
  const sources = await dogfoodSources([resolve(src, "studio")], root);
  const report = runDogfood({ ...sources, themes, themeCss, now: "2026-10-24" });
  // No time-dependent exceptions or inferred clearances are supplied to this baseline.
  const output = stableStringify(report), path = resolve(src, "catalog/reports/page-dogfood.json");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (mode === "--write") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, output); }
  const verdict = dogfoodVerdict({ mode, report, output, existing });
  for (const line of verdict.errors) console.error(line);
  for (const line of verdict.lines) console.log(line);
  process.exitCode = verdict.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
