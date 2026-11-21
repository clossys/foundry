#!/usr/bin/env node
/**
 * Codemod: the specimen data attributes and the layout-render harness markers whose first segment
 * was a short opaque token now open with the full word their own module already uses:
 * `data-specimen-*` (the designer specimen layouts, coverage reader and state clone, next to the
 * existing `data-specimen-forced-state`, `data-specimen-unavailable` and `data-specimen-error`),
 * `data-layout-*` (the publisher layout-render harness, next to its `data-layout-slot` read) and
 * `data-provenance-*` (the provenance stamp names in `provenance-attrs.ts`). This rewrites every
 * literal use in package sources, selectors, tests and generators, plus the matching
 * `dataset.<camel>` reads. No old name stays as an alias.
 *
 *   node packages/publisher/scripts/rename-specimen-attrs.mjs          rewrite in place
 *   node packages/publisher/scripts/rename-specimen-attrs.mjs --check  exit 1 on any old name left
 *
 * Never rewritten: vendored upstream copies (`references/`), build output and the compiled
 * designer utilities stylesheet (its own generator re-emits it from the sources). The check still
 * reads the generated stylesheet, so a stale one fails it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEXT = /\.(?:[cm]?[jt]sx?|css|json|md|html)$/;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|references)\//;
const GENERATED = [/^packages\/designer\/styles\/utilities\.css$/];
const SELF = "packages/publisher/scripts/rename-specimen-attrs.mjs";

/**
 * Old attribute -> new attribute, each without its `data-` lead (added below, so this file never
 * spells an old name whole). Longest first, so a name that prefixes another never swallows it.
 */
const RENAMES = [
  ["ds-specimen-coordinates", "specimen-coordinates"],
  ["ds-specimen-capture", "specimen-capture"],
  ["ds-specimen-section", "specimen-section"],
  ["ds-specimen-region", "specimen-region"],
  ["ds-specimen-layout", "specimen-layout"],
  ["ds-specimen-need", "specimen-need"],
  ["ds-specimen-item", "specimen-item"],
  ["ds-state-clone", "specimen-state-clone"],
  ["ds-slot", "provenance-leaf"],
  ["lk12-ready", "layout-ready"],
  ["lk12-fill", "layout-fill"],
];

const camel = name => name.slice("data-".length).replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Each rename as an attribute rule (a whole name: no name character on either side) plus its `dataset` read. */
const RULES = RENAMES.map(([from, to]) => [`data-${from}`, `data-${to}`]).flatMap(([from, to]) => [
  [new RegExp(`(?<![A-Za-z0-9_-])${escape(from)}(?![A-Za-z0-9_-])`, "g"), to],
  [new RegExp(`\\bdataset\\.${camel(from)}\\b`, "g"), `dataset.${camel(to)}`],
]);

const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter(arg => arg !== "--check");
if (unknown.length) {
  console.error(`rename-specimen-attrs: unknown argument ${unknown.join(" ")}`);
  process.exit(2);
}

const files = execFileSync("git", ["ls-files", "-z", "--", "packages"], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0").filter(path => path && path !== SELF && TEXT.test(path) && !SKIPPED.test(path));

const left = [];
let rewritten = 0;
for (const path of files) {
  const absolute = resolve(repository, path);
  let text;
  try { text = readFileSync(absolute, "utf8"); } catch { continue; }
  let next = text;
  for (const [pattern, replacement] of RULES) next = next.replace(pattern, replacement);
  if (next === text) continue;
  if (check || GENERATED.some(pattern => pattern.test(path))) {
    text.split("\n").forEach((line, index) => {
      if (RULES.some(([pattern]) => { pattern.lastIndex = 0; return pattern.test(line); })) left.push(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
    continue;
  }
  writeFileSync(absolute, next);
  rewritten++;
}

if (!check) console.log(`rename-specimen-attrs: rewrote ${rewritten} file(s)`);
if (left.length) {
  console.error(`rename-specimen-attrs: ${left.length} old specimen attribute name(s) left${check ? "" : " in generated files; re-run their generators"}:`);
  for (const line of left) console.error(`  ${line}`);
  process.exit(1);
}
if (check) console.log(`rename-specimen-attrs: no old specimen attribute names in ${files.length} file(s)`);
