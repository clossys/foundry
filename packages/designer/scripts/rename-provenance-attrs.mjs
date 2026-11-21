#!/usr/bin/env node
/**
 * Codemod: the DOM provenance stamps moved from the short `ds` attribute namespace to the full-word
 * `provenance` one (`DS_ATTR` in src/catalog-core/provenance-attrs.ts is the only source of
 * the names). This rewrites the remaining literal uses in the designer, publisher, producer and
 * writer sources, tests and scripts.
 *
 *   node packages/designer/scripts/rename-provenance-attrs.mjs          rewrite in place
 *   node packages/designer/scripts/rename-provenance-attrs.mjs --check  exit 1 on any old name left
 *
 * Generated outputs (the emitted preview-runtime component indexes, the emitter goldens and the
 * compiled utilities stylesheet) are never rewritten here: their own generators re-emit them from
 * `DS_ATTR`. The check still reads them, so a stale generated file fails it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGES = ["designer", "publisher", "producer", "writer"];
const TEXT = /\.(?:[cm]?[jt]sx?|css|json|md|html)$/;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|references)\//;
const GENERATED = [
  /^packages\/designer\/src\/components\/preview-runtime\/components\/[^/]+\/index\.ts$/,
  /^packages\/designer\/src\/catalog-core\/__golden__\//,
  /^packages\/designer\/styles\/utilities\.css$/,
];
/** Old spelling -> new spelling. Only the three stamps (and their wildcard and dataset forms) move; other `ds` hooks are not stamps. */
const RULES = [
  [/data-ds-(layer|leaf|fill)(?![A-Za-z0-9_-])/g, "data-provenance-$1"],
  [/data-ds-\(\?:layer\|leaf\|fill\)/g, "data-provenance-(?:layer|leaf|fill)"],
  [/data-ds-\*/g, "data-provenance-*"],
  [/\bdataset\.ds(Layer|Leaf|Fill)\b/g, "dataset.provenance$1"],
];

const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter(arg => arg !== "--check");
if (unknown.length) {
  console.error(`rename-provenance-attrs: unknown argument ${unknown.join(" ")}`);
  process.exit(2);
}

const files = execFileSync("git", ["ls-files", "-z", "--", ...PACKAGES.map(name => `packages/${name}`)], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0").filter(path => path && TEXT.test(path) && !SKIPPED.test(path));

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

if (!check) console.log(`rename-provenance-attrs: rewrote ${rewritten} file(s)`);
if (left.length) {
  console.error(`rename-provenance-attrs: ${left.length} old provenance stamp name(s) left${check ? "" : " in generated files; re-run their generators"}:`);
  for (const line of left) console.error(`  ${line}`);
  process.exit(1);
}
if (check) console.log(`rename-provenance-attrs: no old provenance stamp names in ${files.length} file(s)`);
