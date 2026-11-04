#!/usr/bin/env node
/**
 * check:no-selection-store: pins live only in the slot model, read through
 * packages/producer/src/records/slots.ts. The legacy pin store `clossys/selection.json`
 * (schema clossys.selection/1) and every reader of it are gone, and stay gone.
 *
 * A finding is:
 *   - store    `<root>/clossys/selection.json` exists;
 *   - reader   a code file names the store: a quoted "clossys/selection.json", the
 *              clossys.selection/1 schema id, or a join()/resolve() path call with a quoted
 *              "selection.json" segment.
 * Code files are .ts/.tsx/.mts/.cts/.js/.mjs/.cjs under packages/<pkg>/{src,bin,scripts},
 * packages/producer/studio/{app,lib,components} and the root scripts/ folder, outside tests
 * (*.test.*, *.spec.*), __fixtures__ and fixtures folders, node_modules and dist. A generated
 * designer library package's own `selection.json` value file (written and parsed by name, never
 * joined onto a consumer root) is not a pin store and is not matched.
 *
 * Usage: node scripts/check-no-selection-store.mjs [--root DIR] [--json]
 * Exit 0 with no finding, 1 on any finding, 2 on a usage error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SELF = "scripts/check-no-selection-store.mjs";
const STORE = ["selection", "json"].join(".");
const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
const SKIP_DIR = new Set(["node_modules", "dist", "__fixtures__", "fixtures", ".git", ".next"]);
const TEST = /\.(?:test|spec)\.[^.]+$/;
const q = `["'\`]`;
const RULES = [
  { what: "names the store path", pattern: new RegExp(`${q}clossys/${STORE.replace(".", "\\.")}${q}`) },
  { what: "names the store schema", pattern: new RegExp(`clossys\\.${"selection"}/1`) },
  { what: "joins a path onto the store", pattern: new RegExp(`\\b(?:join|resolve)\\([^)\\n]*${q}${STORE.replace(".", "\\.")}${q}`) },
];

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (CODE.test(name) && !TEST.test(name)) out.push(full);
  }
  return out;
}

/** Code files in scope, repository-relative with forward slashes. */
export function scopeFiles(root) {
  const files = [];
  const packages = join(root, "packages");
  if (existsSync(packages)) for (const pkg of readdirSync(packages).sort()) {
    for (const part of ["src", "bin", "scripts"]) walk(join(packages, pkg, part), files);
  }
  for (const part of ["app", "lib", "components"]) walk(join(root, "packages/producer/studio", part), files);
  walk(join(root, "scripts"), files);
  return [...new Set(files)].map(file => relative(root, file).split(sep).join("/")).filter(file => file !== SELF);
}

/** Every finding for a repository root: [{ rule, file, line?, detail }]. */
export function selectionStoreFindings(root) {
  const findings = [];
  if (existsSync(join(root, "clossys", STORE))) findings.push({ rule: "store", file: `clossys/${STORE}`, detail: "the legacy pin store exists; pins live only in clossys/agents/<agent>/<slot>/pin.json" });
  for (const file of scopeFiles(root)) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const rule of RULES) if (rule.pattern.test(text)) findings.push({ rule: "reader", file, line: index + 1, detail: `${rule.what}; read pins through packages/producer/src/records/slots.ts` });
    });
  }
  return findings;
}

function main(argv) {
  const at = argv.indexOf("--root");
  if (at >= 0 && !argv[at + 1]) { console.error("usage: check-no-selection-store.mjs [--root DIR] [--json]"); return 2; }
  const root = resolve(at >= 0 ? argv[at + 1] : join(here, ".."));
  const findings = selectionStoreFindings(root);
  if (argv.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
  for (const f of findings) console.error(`FAIL ${f.rule} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.detail}`);
  console.log(findings.length ? `check:no-selection-store: ${findings.length} finding(s)` : "check:no-selection-store: ok; no selection.json store and no reader of it");
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
